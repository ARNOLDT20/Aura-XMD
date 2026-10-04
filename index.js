// Aura-XMD multi-session controller. Each linked number receives its own auth, state, socket, and runtime.
require("./scripts/ensure-deps")();

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require("@whiskeysockets/baileys");
const pino = require("pino");
const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const baseConfig = require("./config");
const store = require("./lib/store");
const { Persistence, safeId } = require("./lib/persistence");
const { containsLink, isGroupAdmin, getParticipantId } = require("./lib/helpers");
const { beautifyText } = require("./lib/beautify");
const { sendModerationWarning } = require("./lib/moderation");

const plugins = new Map();
const aliases = new Map();
const pluginsDir = path.join(__dirname, "plugins");
const sessions = new Map();
const persistence = new Persistence({ databaseUrl: process.env.DATABASE_URL || "", dataDir: path.resolve(__dirname, process.env.DATA_DIR || "data") });
const shortAliases = {
  ping: "p", alive: "a", menu: "m", help: "h", aura: "ar", health: "ht", setname: "sn", pair: "pr",
  channel: "ch", chan: "c", schedule: "sch", antilink: "al", warn: "w", badwords: "bw", promote: "pro", demote: "de", kick: "k", add: "ad", mute: "mu", unmute: "um", groupinfo: "gi", tagall: "ta", open: "op", close: "cl", setsubject: "ss", setdesc: "sd", invite: "inv", statusreact: "sr", status: "st", addstatus: "as", statuspost: "sp", selfstatus: "self", mystatus: "me", groupstatus: "gs", gcstatus: "gc", viewonce: "vv", download: "dl", save: "sv", media: "md", audio: "au", mp3: "mp", music: "mus", song: "sg", play: "pl", video: "vid", prefix: "px", menuimage: "mi", menustyle: "ms", brand: "br"
};

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function getDisconnectCode(lastDisconnect) { return lastDisconnect?.error?.output?.statusCode ?? lastDisconnect?.error?.statusCode; }
function sessionFolder(id) {
  if (id === "controller") return path.resolve(__dirname, process.env.SESSION_FOLDER || "session");
  return path.resolve(__dirname, process.env.SESSION_ROOT || "sessions", safeId(id));
}
function importLegacyControllerSession(folder) {
  if (!baseConfig.blazeSessionId) return;
  const credsPath = path.join(folder, "creds.json");
  if (fs.existsSync(credsPath) && !process.env.FORCE_SESSION_IMPORT) return;
  const encoded = baseConfig.blazeSessionId.replace(/^BLAZE~/i, "").replace(/\s+/g, "");
  let creds;
  try { creds = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")); } catch { throw new Error("BLAZE_SESSION_ID does not decode to valid JSON credentials."); }
  if (!creds?.registered || !creds?.me?.id) throw new Error("Decoded BLAZE_SESSION_ID is missing registered account credentials.");
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  const temp = `${credsPath}.tmp-${process.pid}`;
  fs.writeFileSync(temp, `${JSON.stringify(creds, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, credsPath);
  console.log(`Imported legacy controller session for ${creds.me.id}.`);
}
function stateConfig(id, folder) {
  const state = store.snapshot(id);
  return { ...baseConfig, ...state, sessionId: id, sessionFolder: folder, runtime: { startedAt: Date.now(), connectionState: "starting", lastConnectedAt: null, lastDisconnectedAt: null }, pairManager: manager, totalCommands: configTotalCommands };
}
let configTotalCommands = 0;

function loadPlugins() {
  const commandNames = new Set();
  for (const file of fs.readdirSync(pluginsDir).filter(file => file.endsWith(".js"))) {
    try {
      const fullPath = path.join(pluginsDir, file);
      delete require.cache[require.resolve(fullPath)];
      const plugin = require(fullPath);
      if (!plugin.command || typeof plugin.run !== "function") continue;
      for (const name of (Array.isArray(plugin.command) ? plugin.command : [plugin.command])) {
        const normalized = String(name).trim().toLowerCase();
        commandNames.add(normalized); plugins.set(normalized, plugin);
        if (shortAliases[normalized]) { aliases.set(shortAliases[normalized], normalized); plugins.set(shortAliases[normalized], plugin); }
      }
      console.log(`Loaded plugin: ${file}`);
    } catch (error) { console.error(`Could not load plugin ${file}:`, error.stack || error.message); }
  }
  configTotalCommands = commandNames.size;
  console.log(`Loaded ${commandNames.size} commands and ${plugins.size - commandNames.size} aliases.`);
}

function unwrapMessage(message) {
  let current = message;
  while (current?.ephemeralMessage?.message || current?.viewOnceMessage?.message || current?.documentWithCaptionMessage?.message) current = current.ephemeralMessage?.message || current.viewOnceMessage?.message || current.documentWithCaptionMessage?.message;
  return current || {};
}
function extractText(message) {
  const unwrapped = unwrapMessage(message);
  return (unwrapped.conversation || unwrapped.extendedTextMessage?.text || unwrapped.imageMessage?.caption || unwrapped.videoMessage?.caption || unwrapped.documentMessage?.caption || "").trim();
}
function reactionForStatus(msg, emojis) {
  let hash = 0; for (const char of String(msg.key?.id || msg.key?.participant || "status")) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return emojis[hash % emojis.length] || "✨";
}
async function sendConnectionMessage(runtime) {
  const { sock, config } = runtime;
  if (!config.sendConnectionMessage || !sock.user?.id) return;
  const jid = sock.user.id.split(":")[0] + "@s.whatsapp.net";
  const caption = `╭───〔 ${config.botName} 〕───╮\n│ ✅ Connection successful\n│ ⚡ Your private Aura runtime is online\n│\n│ Send ${config.prefix}menu for commands\n╰────────────────────╯`;
  try { await sock.sendMessage(jid, { text: caption }); } catch (error) { console.error(`[${runtime.id}] connection message failed:`, error.message); }
}
async function reactToStatus(runtime, msg) {
  const current = store.load();
  if (!current.statusReactions.enabled || !current.statusReactions.emojis.length) return;
  try { const emoji = reactionForStatus(msg, current.statusReactions.emojis); await runtime.sock.sendMessage("status@broadcast", { react: { text: emoji, key: msg.key } }); } catch (error) { console.error(`[${runtime.id}] status reaction failed:`, error.message); }
}
function startAutoPoster(runtime) {
  clearInterval(runtime.autoPosterTimer);
  runtime.autoPosterTimer = setInterval(() => store.run(runtime.id, async () => {
    const current = store.load(); if (!current.channel.jid) return;
    try {
      const auto = current.channel.autoPost;
      if (auto.enabled && auto.text && Date.now() - Number(auto.lastPostedAt || 0) >= Math.max(1, Number(auto.intervalMinutes || 60)) * 60000) { await runtime.sock.sendMessage(current.channel.jid, { text: beautifyText(auto.text, runtime.config) }); auto.lastPostedAt = Date.now(); }
      if (current.channel.schedulesEnabled !== false) for (const schedule of current.channel.schedules || []) if (schedule.enabled && schedule.text && Date.now() - Number(schedule.lastPostedAt || 0) >= Math.max(1, Number(schedule.intervalMinutes || 60)) * 60000) { await runtime.sock.sendMessage(current.channel.jid, { text: beautifyText(schedule.text, runtime.config) }); schedule.lastPostedAt = Date.now(); }
      store.save(current);
    } catch (error) { console.error(`[${runtime.id}] auto-post failed:`, error.message); }
  }), 30000);
}
async function enforceAntilink(runtime, msg, jid, text) {
  const current = store.load(); const group = current.groups[jid];
  if (!jid.endsWith("@g.us") || !group) return false;
  const sender = msg.key.participant || msg.key.remoteJid;
  try {
    if (await isGroupAdmin(runtime.sock, jid, sender) || getParticipantId(sender) === getParticipantId(runtime.sock.user?.id)) return false;
    const bad = (group.antilink && containsLink(text)) || (group.badwords && (group.badwordList || []).some(word => word && new RegExp(`(^|\\s)${String(word).replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}(?=\\s|$)`, "i").test(text)));
    if (!bad) return false;
    await runtime.sock.sendMessage(jid, { delete: msg.key });
    await sendModerationWarning(runtime.sock, jid, msg, { reason: "sharing prohibited content", action: "remove", detail: "This content is not allowed here. Kindly follow the group rules." });
    return true;
  } catch (error) { console.error(`[${runtime.id}] moderation failed:`, error.message); return false; }
}

async function requestPairing(runtime, phone) {
  if (runtime.pairingPromise) return runtime.pairingPromise;
  runtime.pairingPromise = new Promise(resolve => { runtime.resolvePairing = resolve; runtime.pairingPhone = phone; });
  const request = async () => {
    try { const code = await runtime.sock.requestPairingCode(phone); runtime.pairingCode = code; runtime.resolvePairing({ code, id: runtime.id }); }
    catch (error) { runtime.resolvePairing({ error: error.message, id: runtime.id }); }
  };
  if (runtime.sock.user) return { error: "This number is already connected." };
  setTimeout(request, 2000);
  return runtime.pairingPromise;
}

async function connectSession(id, phone = "", controller = false) {
  if (sessions.has(id) && sessions.get(id).sock) return sessions.get(id);
  const folder = sessionFolder(id); fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  await persistence.ensureSession(id, phone); await persistence.restoreAuth(id, folder);
  const auth = await useMultiFileAuthState(folder);
  const runtime = { id, sock: null, config: stateConfig(id, folder), auth, starting: true, reconnectTimer: null, autoPosterTimer: null, controller };
  sessions.set(id, runtime);
  let version; try { ({ version } = await fetchLatestBaileysVersion()); } catch {}
  runtime.sock = makeWASocket({ ...(version ? { version } : {}), auth: auth.state, logger: pino({ level: process.env.LOG_LEVEL || "silent" }), printQRInTerminal: false, browser: ["Aura-XMD", "Chrome", "1.0.0"], markOnlineOnConnect: false, syncFullHistory: false, generateHighQualityLinkPreview: false });
  runtime.sock.ev.on("creds.update", async () => { await auth.saveCreds(); await persistence.saveAuth(id, folder); });
  runtime.sock.ev.on("connection.update", async update => {
    const { connection, lastDisconnect } = update;
    if (connection === "connecting") { runtime.config.runtime.connectionState = "connecting"; console.log(`[${id}] connecting`); }
    if (connection === "open") { runtime.config.runtime.connectionState = "open"; runtime.config.runtime.lastConnectedAt = Date.now(); runtime.starting = false; await persistence.ensureSession(id, runtime.sock.user?.id?.split(":")[0] || phone); console.log(`[${id}] connected as ${runtime.sock.user?.id}`); await sendConnectionMessage(runtime); startAutoPoster(runtime); }
    if (connection === "close") {
      runtime.config.runtime.connectionState = "closed"; runtime.config.runtime.lastDisconnectedAt = Date.now(); runtime.starting = false; const code = getDisconnectCode(lastDisconnect);
      if (code === DisconnectReason.loggedOut) { await persistence.markStatus(id, "logged_out"); sessions.delete(id); console.error(`[${id}] logged out; user must pair again.`); return; }
      console.log(`[${id}] connection closed (${code ?? "unknown"}); retrying in ${runtime.config.reconnectDelayMs}ms`);
      runtime.reconnectTimer = setTimeout(() => connectSession(id, phone, controller).catch(error => console.error(`[${id}] reconnect failed:`, error.message)), runtime.config.reconnectDelayMs);
    }
  });
  runtime.sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) await store.run(id, async () => {
      try {
        if (!msg.message) return; const jid = msg.key.remoteJid; if (!jid) return;
        if (jid === "status@broadcast") return reactToStatus(runtime, msg);
        if (msg.key.fromMe && !runtime.config.allowFromMe && !jid.endsWith("@newsletter")) return;
        const text = extractText(msg.message); if (await enforceAntilink(runtime, msg, jid, text)) return;
        if (!text.startsWith(runtime.config.prefix)) return;
        const body = text.slice(runtime.config.prefix.length).trim(); if (!body) return;
        const [rawCommand, ...args] = body.split(/\s+/); const normalized = rawCommand.toLowerCase(); const command = aliases.get(normalized) || normalized; const plugin = plugins.get(normalized); if (!plugin) return;
        await plugin.run({ sock: runtime.sock, msg, jid, args, text, command, config: runtime.config, reply: value => runtime.sock.sendMessage(jid, { text: String(value) }, jid.endsWith("@newsletter") ? {} : { quoted: msg }) });
      } catch (error) { console.error(`[${id}] command error:`, error.stack || error.message); }
    });
  });
  if (!auth.state.creds.registered && controller && baseConfig.phoneNumber) requestPairing(runtime, baseConfig.phoneNumber);
  return runtime;
}

const manager = {
  async pair(phone) {
    const digits = String(phone || "").replace(/\D/g, ""); if (digits.length < 7 || digits.length > 15) throw new Error("Use a full phone number with country code, digits only.");
    if (baseConfig.maxSessions > 0 && sessions.size - (sessions.has("controller") ? 1 : 0) >= baseConfig.maxSessions) throw new Error("The maximum number of linked sessions has been reached.");
    const id = `user_${digits}`; const runtime = await connectSession(id, digits, false); return requestPairing(runtime, digits);
  },
  list: () => [...sessions.values()].map(item => ({ id: item.id, account: item.sock?.user?.id || null, state: item.config.runtime.connectionState }))
};

function json(res, status, body) { res.writeHead(status, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify(body)); }
function startWeb() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (req.method === "GET" && url.pathname === "/") return res.end("<h1>Aura-XMD</h1><p>Multi-session controller is online.</p><p><a href='/pair'>Pair a WhatsApp number</a> · <a href='/health'>Health</a></p>");
    if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { ok: true, sessions: manager.list(), uptime: process.uptime() });
    if (req.method === "GET" && url.pathname === "/pair") return res.end(`<!doctype html><meta name="viewport" content="width=device-width"><title>Aura-XMD Pair</title><style>body{font:16px sans-serif;max-width:500px;margin:40px auto;padding:20px}input,button{font-size:18px;padding:10px;width:100%;margin:8px 0}</style><h1>Aura-XMD Pairing</h1><p>Enter the WhatsApp number with country code and digits only.</p><form method="post"><input name="phone" placeholder="255625606354" required>${baseConfig.pairToken ? '<input name="token" type="password" placeholder="Pair token" required>' : ""}<button>Generate pair code</button></form>`);
    if (req.method === "POST" && url.pathname === "/pair") {
      let body = ""; req.on("data", chunk => { body += chunk; }); req.on("end", async () => { try { const params = new URLSearchParams(body); if (baseConfig.pairToken && params.get("token") !== baseConfig.pairToken) return res.end("Pairing authorization failed."); const result = await manager.pair(params.get("phone")); return res.end(`<h2>Pairing result</h2><p>${result.error ? `Error: ${result.error}` : `Code: <strong>${result.code}</strong>`}</p><p>WhatsApp → Linked devices → Link with phone number instead.</p>`); } catch (error) { return res.end(`<h2>Pairing failed</h2><p>${error.message}</p>`); } }); return; }
    json(res, 404, { error: "not_found" });
  });
  server.listen(Number(process.env.PORT || 3000), "0.0.0.0", () => console.log(`Pairing web server listening on ${process.env.PORT || 3000}`));
}

async function main() {
  await persistence.init();
  const savedStates = await persistence.loadStates();
  const legacyStatePath = path.resolve(__dirname, process.env.DATA_DIR || "data", "state.json");
  if (!savedStates.controller && fs.existsSync(legacyStatePath)) {
    try { savedStates.controller = JSON.parse(fs.readFileSync(legacyStatePath, "utf8")); console.log("Migrated legacy controller state into the controller tenant."); } catch (error) { console.warn("Could not migrate legacy state.json:", error.message); }
  }
  store.initialize(savedStates, (id, state) => persistence.saveState(id, state)); loadPlugins(); startWeb();
  importLegacyControllerSession(sessionFolder("controller"));
  await connectSession("controller", baseConfig.phoneNumber, true);
  for (const row of await persistence.listSessions()) if (row.id !== "controller" && row.status === "active") connectSession(row.id, row.phone, false).catch(error => console.error(`[${row.id}] startup failed:`, error.message));
}
process.on("unhandledRejection", error => console.error("Unhandled rejection:", error));
process.on("uncaughtException", error => console.error("Uncaught exception:", error));
main().catch(error => { console.error("Aura-XMD startup failed:", error.stack || error.message); process.exitCode = 1; });
