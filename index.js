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
const { beautifyText, decorateCaption, watermarkMedia } = require("./lib/beautify");
const { fetchWebsitePosts } = require("./lib/autopost");
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
function autopostTargets(state) { state.channel ||= {}; state.channel.targets ||= {}; return state.channel.targets; }
function autopostItemText(item, config) { return beautifyText([item.title, item.text, item.url].filter(Boolean).join("\n\n"), config); }
async function sendAutopostItem(runtime, jid, item) {
  const mediaUrl = item.mediaUrl || "";
  if (!mediaUrl) return runtime.sock.sendMessage(jid, { text: autopostItemText(item, runtime.config) });
  try {
    const response = await fetch(mediaUrl, { headers: { "user-agent": "Aura-XMD/1.0 autopost sender" }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`media HTTP ${response.status}`);
    const mimetype = response.headers.get("content-type") || "application/octet-stream";
    const buffer = await watermarkMedia(Buffer.from(await response.arrayBuffer()), mimetype, runtime.config);
    const caption = decorateCaption([item.title, item.text, item.url].filter(Boolean).join("\n\n"), runtime.config);
    if (mimetype.startsWith("image/")) return runtime.sock.sendMessage(jid, { image: buffer, mimetype, caption });
    if (mimetype.startsWith("video/")) return runtime.sock.sendMessage(jid, { video: buffer, mimetype, caption });
    if (mimetype.startsWith("audio/")) return runtime.sock.sendMessage(jid, { audio: buffer, mimetype, ptt: false });
    return runtime.sock.sendMessage(jid, { document: buffer, mimetype, fileName: item.title || "aura-post" });
  } catch (error) { console.warn(`[${runtime.id}] media autopost fallback: ${error.message}`); return runtime.sock.sendMessage(jid, { text: autopostItemText(item, runtime.config) }); }
}
async function processAutoPosts(runtime) {
  if (runtime.autoPosting || runtime.config.runtime.connectionState !== "open") return;
  runtime.autoPosting = true;
  try { await store.run(runtime.id, async () => {
    const current = store.load(); const targets = autopostTargets(current); const now = Date.now();
    for (const [jid, target] of Object.entries(targets)) {
      if (!target?.enabled || !/^([\w.-]+)@(newsletter|g\.us|s\.whatsapp\.net)$/.test(jid)) continue;
      target.queue ||= [];
      if (target.sourceUrl && now - Number(target.lastFetchedAt || 0) >= Math.max(1, Number(target.fetchIntervalMinutes || 30)) * 60000) {
        try { const posts = await fetchWebsitePosts(target.sourceUrl, 20); const known = new Set(target.queue.map(item => item.key)); for (const post of posts.reverse()) if (!known.has(post.key)) { target.queue.push(post); known.add(post.key); } target.queue = target.queue.slice(-50); target.lastFetchedAt = now; target.lastError = ""; } catch (error) { target.lastFetchedAt = now; target.lastError = error.message; console.error(`[${runtime.id}] fetch failed for ${jid}:`, error.message); }
      }
      if (target.queue.length && now - Number(target.lastPostedAt || 0) >= Math.max(1, Number(target.intervalMinutes || 60)) * 60000) { const item = target.queue.shift(); await sendAutopostItem(runtime, jid, item); target.lastPostedAt = Date.now(); }
    }
    // Keep older .channel auto and .schedule configurations working unless that JID is managed by a new target.
    if (current.channel.jid && !targets[current.channel.jid]) {
      const auto = current.channel.autoPost;
      if (auto.enabled && auto.text && now - Number(auto.lastPostedAt || 0) >= Math.max(1, Number(auto.intervalMinutes || 60)) * 60000) { await runtime.sock.sendMessage(current.channel.jid, { text: beautifyText(auto.text, runtime.config) }); auto.lastPostedAt = Date.now(); }
      if (current.channel.schedulesEnabled !== false) for (const schedule of current.channel.schedules || []) if (schedule.enabled && schedule.text && now - Number(schedule.lastPostedAt || 0) >= Math.max(1, Number(schedule.intervalMinutes || 60)) * 60000) { await runtime.sock.sendMessage(current.channel.jid, { text: beautifyText(schedule.text, runtime.config) }); schedule.lastPostedAt = Date.now(); }
    }
    store.save(current);
  }); } catch (error) { console.error(`[${runtime.id}] auto-post cycle failed:`, error.message); } finally { runtime.autoPosting = false; }
}
function startAutoPoster(runtime) { clearInterval(runtime.autoPosterTimer); runtime.autoPosterTimer = setInterval(() => processAutoPosts(runtime), 30000); processAutoPosts(runtime); }
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

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function requestPairing(runtime, phone) {
  if (runtime.config.runtime.connectionState === "open" && runtime.sock.user) return { error: "This number is already connected. Remove it from WhatsApp Linked devices before pairing again." };
  if (runtime.pairingCode && Date.now() - runtime.pairingIssuedAt < 110000) return { code: runtime.pairingCode, id: runtime.id };
  if (runtime.pairingPromise) return runtime.pairingPromise;
  runtime.pairingPromise = (async () => {
    let lastError = "WhatsApp socket was not ready.";
    // Render and Heroku can take several seconds to establish the first WebSocket.
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      if (runtime.config.runtime.connectionState === "open" && runtime.sock.user) return { error: "This number is already connected." };
      await sleep(attempt === 1 ? 7000 : 4000);
      try {
        const code = await Promise.race([
          runtime.sock.requestPairingCode(phone),
          sleep(15000).then(() => { throw new Error("WhatsApp pairing request timed out"); })
        ]);
        if (code) { runtime.pairingCode = String(code).replace(/\s+/g, ""); runtime.pairingIssuedAt = Date.now(); console.log(`[${runtime.id}] Pairing code: ${runtime.pairingCode}`); console.log("WhatsApp → Linked devices → Link a device → Link with phone number instead"); return { code: runtime.pairingCode, id: runtime.id }; }
      } catch (error) { lastError = error.message; console.warn(`[${runtime.id}] pairing attempt ${attempt}/6 failed: ${lastError}`); }
    }
    return { error: `WhatsApp did not accept a pairing request after several attempts: ${lastError}` };
  })();
  const result = await runtime.pairingPromise;
  runtime.pairingPromise = null;
  return result;
}

async function connectSession(id, phone = "", controller = false) {
  if (sessions.has(id) && sessions.get(id).sock) return sessions.get(id);
  const folder = sessionFolder(id); fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  await persistence.ensureSession(id, phone); await persistence.restoreAuth(id, folder);
  const auth = await useMultiFileAuthState(folder);
  const runtime = { id, sock: null, config: stateConfig(id, folder), auth, starting: true, reconnectTimer: null, autoPosterTimer: null, controller };
  sessions.set(id, runtime);
  let version; try { ({ version } = await fetchLatestBaileysVersion()); } catch {}
  runtime.sock = makeWASocket({ ...(version ? { version } : {}), auth: auth.state, logger: pino({ level: process.env.LOG_LEVEL || "silent" }), printQRInTerminal: false, browser: ["Ubuntu", "Chrome", "20.0.04"], markOnlineOnConnect: false, syncFullHistory: false, generateHighQualityLinkPreview: false });
  runtime.sock.ev.on("creds.update", async () => { await auth.saveCreds(); await persistence.saveAuth(id, folder); });
  runtime.sock.ev.on("connection.update", async update => {
    const { connection, lastDisconnect } = update;
    if (connection === "connecting") { runtime.config.runtime.connectionState = "connecting"; console.log(`[${id}] connecting`); }
    if (connection === "open") { runtime.config.runtime.connectionState = "open"; runtime.config.runtime.lastConnectedAt = Date.now(); runtime.starting = false; await persistence.ensureSession(id, runtime.sock.user?.id?.split(":")[0] || phone); console.log(`[${id}] connected as ${runtime.sock.user?.id}`); await sendConnectionMessage(runtime); startAutoPoster(runtime); }
    if (connection === "close") {
      runtime.config.runtime.connectionState = "closed"; runtime.config.runtime.lastDisconnectedAt = Date.now(); runtime.starting = false; const code = getDisconnectCode(lastDisconnect);
      if (code === DisconnectReason.loggedOut) { await persistence.removeSession(id); try { fs.rmSync(sessionFolder(id), { recursive: true, force: true }); } catch {} sessions.delete(id); console.error(`[${id}] stale/invalid credentials removed; user can pair again.`); return; }
      clearInterval(runtime.autoPosterTimer);
      runtime.sock = null;
      sessions.delete(id);
      console.log(`[${id}] connection closed (${code ?? "unknown"}); creating a fresh socket in ${runtime.config.reconnectDelayMs}ms`);
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
    const id = `user_${digits}`;
    const existing = sessions.get(id);
    if (existing?.config.runtime.connectionState === "open" && existing.sock?.user) return { error: "This number is already connected. Remove it from WhatsApp Linked devices before pairing again." };
    if (existing) { clearTimeout(existing.reconnectTimer); clearInterval(existing.autoPosterTimer); try { existing.sock?.end?.(new Error("replaced by fresh pairing request")); } catch {} sessions.delete(id); }
    await persistence.removeSession(id);
    try { fs.rmSync(sessionFolder(id), { recursive: true, force: true }); } catch {}
    return requestPairing(await connectSession(id, digits, false), digits);
  },
  list: () => [...sessions.values()].map(item => ({ id: item.id, account: item.sock?.user?.id || null, state: item.config.runtime.connectionState }))
};

function json(res, status, body) { res.writeHead(status, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify(body)); }
function html(value) { return String(value || "").replace(/[&<>\"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char])); }
function dashboardAuthorized(url) { return !baseConfig.dashboardToken || url.searchParams.get("token") === baseConfig.dashboardToken; }
function dashboardData(req) {
  const memory = process.memoryUsage();
  const items = manager.list();
  const autopost = items.map(item => ({ sessionId: item.id, targets: Object.entries(store.snapshot(item.id).channel?.targets || {}).map(([jid, target]) => ({ jid, enabled: Boolean(target.enabled), sourceUrl: target.sourceUrl || "", queueLength: (target.queue || []).length, intervalMinutes: target.intervalMinutes || 60, fetchIntervalMinutes: target.fetchIntervalMinutes || 30, lastPostedAt: target.lastPostedAt || 0, lastFetchedAt: target.lastFetchedAt || 0, lastError: target.lastError || "" })) }));
  return { ok: true, generatedAt: new Date().toISOString(), botName: baseConfig.botName, ownerName: baseConfig.ownerName, uptime: process.uptime(), startedAt: baseConfig.runtime.startedAt, memory: { rss: memory.rss, heapUsed: memory.heapUsed, heapTotal: memory.heapTotal, external: memory.external }, platform: process.platform, arch: process.arch, node: process.version, hostname: require("os").hostname(), commands: configTotalCommands, aliases: aliases.size, database: Boolean(process.env.DATABASE_URL), publicUrl: baseConfig.publicUrl || null, sessions: items, autopost, online: items.filter(item => item.state === "open").length, connecting: items.filter(item => item.state === "connecting").length, offline: items.filter(item => !["open", "connecting"].includes(item.state)).length };
}
function dashboardPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Aura-XMD Dashboard</title><style>
  :root{color-scheme:dark;--bg:#070812;--panel:#111426cc;--panel2:#171b31;--line:#ffffff16;--text:#f6f7ff;--muted:#9ca8ca;--cyan:#62e8ff;--purple:#a276ff;--pink:#ff68c5;--green:#56e6a2;--red:#ff6681;--amber:#ffc86b}*{box-sizing:border-box}body{margin:0;min-height:100vh;color:var(--text);font:14px Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;background:radial-gradient(circle at 5% 0,#35246d 0,transparent 28%),radial-gradient(circle at 100% 20%,#123d51 0,transparent 32%),var(--bg)}.app{width:min(1180px,100%);margin:auto;padding:25px 18px 35px}.top{display:flex;justify-content:space-between;align-items:center;gap:18px;margin-bottom:22px}.brand{display:flex;align-items:center;gap:12px}.orb{width:45px;height:45px;border-radius:15px;display:grid;place-items:center;font-size:22px;font-weight:900;color:#080914;background:linear-gradient(135deg,var(--cyan),var(--purple) 55%,var(--pink));box-shadow:0 0 30px #a276ff66}.brand h1{font-size:21px;margin:0}.brand small{color:var(--muted);letter-spacing:.15em;text-transform:uppercase;font-size:10px}.actions{display:flex;gap:9px;flex-wrap:wrap}.btn{border:1px solid var(--line);border-radius:11px;padding:10px 13px;color:var(--text);background:#ffffff0d;text-decoration:none;cursor:pointer;font-weight:700}.btn.primary{border:0;background:linear-gradient(100deg,var(--cyan),var(--purple),var(--pink));color:#090a14}.hero{padding:25px;border:1px solid var(--line);border-radius:24px;background:linear-gradient(120deg,#171832cc,#0d1726cc);box-shadow:0 25px 80px #0008;display:flex;justify-content:space-between;align-items:center;gap:20px;margin-bottom:18px}.eyebrow{color:var(--cyan);font-size:11px;font-weight:900;letter-spacing:.18em;text-transform:uppercase}.hero h2{font-size:clamp(25px,4vw,39px);margin:9px 0 8px}.hero p{color:var(--muted);margin:0;line-height:1.6}.pulse{min-width:160px;text-align:center;border:1px solid #56e6a255;border-radius:18px;padding:20px;background:#56e6a20b}.dot{width:12px;height:12px;background:var(--green);display:inline-block;border-radius:50%;box-shadow:0 0 20px var(--green);margin-right:8px}.pulse strong{display:block;margin-top:10px;color:var(--green);font-size:18px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:12px 0}.stat,.panel{border:1px solid var(--line);background:var(--panel);border-radius:18px;box-shadow:0 15px 45px #0004;backdrop-filter:blur(16px)}.stat{padding:18px}.stat .label{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.11em}.stat .value{font-size:25px;font-weight:900;margin-top:9px}.cyan{color:var(--cyan)}.purple{color:var(--purple)}.pink{color:var(--pink)}.green{color:var(--green)}.layout{display:grid;grid-template-columns:1.4fr .8fr;gap:14px;margin-top:14px}.panel{padding:20px}.panel h3{margin:0 0 15px;font-size:16px}.sub{font-size:12px;color:var(--muted)}.table-wrap{overflow:auto}.table{width:100%;border-collapse:collapse;min-width:560px}.table th{color:#8491b6;font-size:10px;text-transform:uppercase;letter-spacing:.1em;text-align:left;padding:10px 8px;border-bottom:1px solid var(--line)}.table td{padding:13px 8px;border-bottom:1px solid #ffffff0c;color:#dce1f3}.badge{display:inline-flex;align-items:center;gap:6px;border-radius:99px;padding:5px 9px;font-size:11px;font-weight:800}.badge.open{color:var(--green);background:#56e6a218}.badge.connecting{color:var(--amber);background:#ffc86b18}.badge.closed,.badge.logged_out{color:var(--red);background:#ff668118}.row{display:flex;justify-content:space-between;gap:15px;padding:12px 0;border-bottom:1px solid #ffffff0d}.row:last-child{border-bottom:0}.row span:first-child{color:var(--muted)}.foot{text-align:center;color:#7180a6;font-size:11px;margin-top:22px}@media(max-width:800px){.grid{grid-template-columns:repeat(2,1fr)}.layout{grid-template-columns:1fr}.hero{align-items:flex-start;flex-direction:column}.pulse{width:100%}}@media(max-width:450px){.app{padding:16px 11px}.top{align-items:flex-start;flex-direction:column}.actions{width:100%}.actions .btn{flex:1;text-align:center}.grid{gap:8px}.stat{padding:13px}.stat .value{font-size:20px}.hero{padding:20px}}
  </style></head><body><main class="app"><header class="top"><div class="brand"><div class="orb">A</div><div><h1>Aura-XMD</h1><small>BLAZE TECH · Owner console</small></div></div><nav class="actions"><a class="btn" href="/pair">Pair number</a><a class="btn" href="/health">Health JSON</a><button class="btn primary" id="refresh">Refresh</button></nav></header><section class="hero"><div><div class="eyebrow">Live operations dashboard</div><h2>Welcome, <span id="owner">Owner</span>.</h2><p>Monitor every isolated Aura-XMD runtime, pairing activity, resources, and deployment health from one place.</p></div><div class="pulse"><span class="dot"></span> LIVE<strong id="liveText">Checking…</strong></div></section><section class="grid"><div class="stat"><div class="label">System uptime</div><div class="value cyan" id="uptime">—</div></div><div class="stat"><div class="label">Online sessions</div><div class="value green" id="online">—</div></div><div class="stat"><div class="label">Total sessions</div><div class="value purple" id="total">—</div></div><div class="stat"><div class="label">Memory used</div><div class="value pink" id="memory">—</div></div></section><div class="layout"><section class="panel"><h3>Connected runtimes <span class="sub" id="updated"></span></h3><div class="table-wrap"><table class="table"><thead><tr><th>Session</th><th>Account</th><th>Status</th><th>Last state</th></tr></thead><tbody id="sessions"><tr><td colspan="4" class="sub">Loading sessions…</td></tr></tbody></table></div></section><aside class="panel"><h3>Deployment overview</h3><div class="row"><span>Bot version</span><b>Aura-XMD</b></div><div class="row"><span>Platform</span><b id="platform">—</b></div><div class="row"><span>Node runtime</span><b id="node">—</b></div><div class="row"><span>Hostname</span><b id="hostname">—</b></div><div class="row"><span>Commands</span><b id="commands">—</b></div><div class="row"><span>Database</span><b id="database">—</b></div></aside></div><section class="panel" style="margin-top:14px"><h3>Quick actions</h3><div class="actions"><a class="btn primary" href="/pair">＋ Pair another WhatsApp number</a><a class="btn" href="/">Open public portal</a></div></section><section class="panel" style="margin-top:14px"><h3>Autopost control center</h3><p class="sub">Each session and JID has its own queue. Configure a website/RSS source, then publish one queued item at a time.</p><form id="targetForm" class="grid" style="grid-template-columns:repeat(2,1fr);margin-top:14px"><input class="input" name="sessionId" placeholder="Session ID (controller)" value="controller" required><input class="input" name="jid" placeholder="Target JID · 1203...@newsletter" required><input class="input" name="sourceUrl" placeholder="Website or RSS URL (https://...)" required><input class="input" name="intervalMinutes" type="number" min="1" value="60" placeholder="Post every minutes"><input class="input" name="fetchIntervalMinutes" type="number" min="1" value="30" placeholder="Fetch every minutes"><button class="btn primary" type="submit">Save target</button></form><form id="postForm" class="grid" style="grid-template-columns:repeat(2,1fr);margin-top:10px"><input class="input" name="sessionId" placeholder="Session ID" value="controller" required><input class="input" name="jid" placeholder="Target JID" required><input class="input" name="title" placeholder="Post title"><input class="input" name="url" placeholder="Post link"><textarea class="input" name="text" placeholder="Manual text post" style="min-height:76px;grid-column:1/-1"></textarea><input class="input" name="mediaUrl" placeholder="Optional image/video/audio URL"><button class="btn" type="submit">Add one post to queue</button></form><div id="autopostRows" style="margin-top:18px"><span class="sub">Loading autopost targets…</span></div></section><div class="foot">Made with love by ARNOLDT20 · Aura-XMD operations console · Auto-refresh 10s</div></main><script>
  const q=new URLSearchParams(location.search); const token=q.get('token')||''; const fmtBytes=n=>{if(!n)return '0 MB';const u=['B','KB','MB','GB'];let i=0;while(n>=1024&&i<3){n/=1024;i++}return n.toFixed(i?1:0)+' '+u[i]};const fmtTime=s=>{s=Math.floor(s||0);const d=Math.floor(s/86400);s%=86400;const h=Math.floor(s/3600);s%=3600;const m=Math.floor(s/60);const sec=s%60;return (d?d+'d ':'')+(h?String(h).padStart(2,'0')+':':'')+String(m).padStart(2,'0')+':'+String(sec).padStart(2,'0')};const esc=v=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));async function load(){try{const r=await fetch('/api/dashboard?token='+encodeURIComponent(token),{cache:'no-store'});if(!r.ok)throw new Error('Unauthorized');const d=await r.json();document.getElementById('owner').textContent=d.ownerName||'Owner';document.getElementById('uptime').textContent=fmtTime(d.uptime);document.getElementById('online').textContent=d.online;document.getElementById('total').textContent=d.sessions.length;document.getElementById('memory').textContent=fmtBytes(d.memory.heapUsed);document.getElementById('liveText').textContent=d.online+' online';document.getElementById('platform').textContent=d.platform+' / '+d.arch;document.getElementById('node').textContent=d.node;document.getElementById('hostname').textContent=d.hostname;document.getElementById('commands').textContent=d.commands+' + '+d.aliases+' aliases';document.getElementById('database').textContent=d.database?'PostgreSQL':'Local fallback';renderAuto(d);document.getElementById('updated').textContent='· '+new Date(d.generatedAt).toLocaleTimeString();document.getElementById('sessions').innerHTML=d.sessions.length?d.sessions.map(s=>'<tr><td><b>'+esc(s.id)+'</b></td><td>'+esc(s.account||'Awaiting pairing')+'</td><td><span class="badge '+esc(s.state)+'">● '+esc(s.state)+'</span></td><td>'+esc(s.account?'Linked account':'Not linked')+'</td></tr>').join(''):'<tr><td colspan="4" class="sub">No active sessions yet.</td></tr>'}catch(e){document.getElementById('liveText').textContent='Unavailable';document.getElementById('sessions').innerHTML='<tr><td colspan="4" class="sub">Dashboard authorization or service connection failed.</td></tr>'}}document.getElementById('refresh').onclick=load;load();setInterval(load,10000);
  const postAuto=async(form,action)=>{const data=new URLSearchParams(new FormData(form));data.set('action',action||'save_target');data.set('token',token);const r=await fetch('/api/autopost',{method:'POST',body:data});const out=await r.json();if(!out.ok)throw new Error(out.error||'Request failed');return out};const renderAuto=d=>{const rows=(d.autopost||[]).flatMap(x=>(x.targets||[]).map(t=>({sessionId:x.sessionId,...t})));document.getElementById('autopostRows').innerHTML=rows.length?rows.map(t=>'<div class="row"><span><b>'+esc(t.jid)+'</b><br><small>'+esc(t.sessionId)+' · '+(t.enabled?'every '+t.intervalMinutes+'m':'paused')+' · '+t.queueLength+' queued'+(t.sourceUrl?' · source configured':'')+'</small>'+(t.lastError?'<br><small style="color:var(--red)">'+esc(t.lastError)+'</small>':'')+'</span><span class="actions"><button class="btn" data-auto="fetch" data-session="'+esc(t.sessionId)+'" data-jid="'+esc(t.jid)+'">Fetch</button><button class="btn" data-auto="clear" data-session="'+esc(t.sessionId)+'" data-jid="'+esc(t.jid)+'">Clear</button><button class="btn" data-auto="remove" data-session="'+esc(t.sessionId)+'" data-jid="'+esc(t.jid)+'">Remove</button></span></div>').join(''):'<span class="sub">No targets configured. Add a website/RSS source or a manual post above.</span>';document.querySelectorAll('[data-auto]').forEach(b=>b.onclick=async()=>{const f=new FormData();f.set('sessionId',b.dataset.session);f.set('jid',b.dataset.jid);f.set('token',token);f.set('action',b.dataset.auto==='fetch'?'fetch_now':b.dataset.auto);try{const r=await fetch('/api/autopost',{method:'POST',body:new URLSearchParams(f)});const o=await r.json();if(!o.ok)throw new Error(o.error);await load();alert(o.message)}catch(e){alert(e.message)}})};document.getElementById('targetForm').onsubmit=async e=>{e.preventDefault();try{const o=await postAuto(e.target,'save_target');alert(o.message);await load()}catch(x){alert(x.message)}};document.getElementById('postForm').onsubmit=async e=>{e.preventDefault();try{const o=await postAuto(e.target,'add_post');alert(o.message);e.target.reset();await load()}catch(x){alert(x.message)}};
  </script></body></html>`;
}
function dashboardGatePage() {
  return page("Owner dashboard", `<section class="card"><div class="eyebrow">Private owner console</div><h2>Unlock Aura-XMD dashboard.</h2><p class="lead">Enter the <b>DASHBOARD_TOKEN</b> configured in your Render or Heroku environment variables.</p><form method="get" action="/dashboard"><label class="field" for="token">Dashboard token</label><input class="input" id="token" name="token" type="password" autocomplete="current-password" placeholder="Paste your private token" required><button class="btn" type="submit">Open dashboard</button></form><div class="links"><a href="/pair">Pair a number</a><a href="/health">Health</a></div></section>`);
}
function readRequestBody(req) {
  return new Promise(resolve => {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => resolve(new URLSearchParams(body)));
  });
}
async function autopostAction(params) {
  const sessionId = String(params.get("sessionId") || "controller");
  if (!sessions.has(sessionId)) throw new Error("That session is not active. Pair or restore it first.");
  const jid = String(params.get("jid") || "").trim();
  if (!/^([\w.-]+)@(newsletter|g\.us|s\.whatsapp\.net)$/.test(jid)) throw new Error("Use a valid WhatsApp JID, such as 120363...@newsletter or 255...@g.us.");
  const action = params.get("action") || "save_target";
  let result;
  await store.run(sessionId, async () => {
    const state = store.load(); const targets = autopostTargets(state); const current = targets[jid] || { enabled: true, intervalMinutes: 60, fetchIntervalMinutes: 30, sourceUrl: "", queue: [], lastPostedAt: 0, lastFetchedAt: 0, lastError: "" };
    if (action === "save_target") { current.enabled = params.get("enabled") !== "false"; current.intervalMinutes = Math.max(1, Math.min(10080, Number(params.get("intervalMinutes") || 60))); current.fetchIntervalMinutes = Math.max(1, Math.min(10080, Number(params.get("fetchIntervalMinutes") || 30))); current.sourceUrl = String(params.get("sourceUrl") || "").trim(); targets[jid] = current; result = { message: `Autopost target saved for ${jid}.` }; }
    else if (action === "add_post") { current.queue ||= []; current.queue.push({ title: String(params.get("title") || "Manual post"), text: String(params.get("text") || "").trim(), url: String(params.get("url") || "").trim(), mediaUrl: String(params.get("mediaUrl") || "").trim(), mediaType: "", key: `manual:${Date.now()}:${Math.random()}` }); current.queue = current.queue.slice(-50); targets[jid] = current; result = { message: "Post added to the isolated queue." }; }
    else if (action === "toggle") { current.enabled = params.get("enabled") === "true"; targets[jid] = current; result = { message: `Autopost ${current.enabled ? "enabled" : "paused"} for ${jid}.` }; }
    else if (action === "clear") { current.queue = []; targets[jid] = current; result = { message: `Queue cleared for ${jid}.` }; }
    else if (action === "remove") { delete targets[jid]; result = { message: `Autopost target removed for ${jid}.` }; }
    else throw new Error("Unknown autopost action.");
    store.save(state);
  });
  return result;
}
async function fetchNowForTarget(sessionId, jid) {
  if (!sessions.has(sessionId)) throw new Error("That session is not active.");
  let result;
  await store.run(sessionId, async () => { const state = store.load(); const target = autopostTargets(state)[jid]; if (!target?.sourceUrl) throw new Error("Set a website or RSS source URL first."); const posts = await fetchWebsitePosts(target.sourceUrl, 20); target.queue ||= []; const known = new Set(target.queue.map(item => item.key)); for (const post of posts.reverse()) if (!known.has(post.key)) { target.queue.push(post); known.add(post.key); } target.queue = target.queue.slice(-50); target.lastFetchedAt = Date.now(); target.lastError = ""; store.save(state); result = { message: `${posts.length} source item(s) fetched; ${target.queue.length} queued.` }; });
  return result;
}
function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${html(title)} · Aura-XMD</title><style>
  :root{color-scheme:dark;--bg:#070b18;--card:rgba(18,25,52,.78);--line:rgba(160,174,255,.2);--text:#f5f7ff;--muted:#aeb8d8;--violet:#9b7bff;--cyan:#62e8ff;--pink:#ff75c8}*{box-sizing:border-box}body{margin:0;min-height:100vh;font-family:Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;color:var(--text);background:radial-gradient(circle at 15% 10%,#282066 0,transparent 34%),radial-gradient(circle at 90% 90%,#143e59 0,transparent 35%),var(--bg);display:grid;place-items:center;padding:24px}.shell{width:min(100%,560px)}.brand{display:flex;align-items:center;gap:13px;margin:0 auto 18px;justify-content:center}.orb{width:48px;height:48px;border-radius:16px;background:linear-gradient(135deg,var(--cyan),var(--violet) 55%,var(--pink));box-shadow:0 0 34px #8275ff88;display:grid;place-items:center;font-size:23px;font-weight:900;color:#080b19}.brand h1{font-size:24px;letter-spacing:.04em;margin:0}.brand small{display:block;color:var(--muted);font-size:11px;letter-spacing:.16em;text-transform:uppercase;margin-top:3px}.card{background:var(--card);border:1px solid var(--line);border-radius:28px;padding:30px;box-shadow:0 24px 90px #0008;backdrop-filter:blur(22px)}.eyebrow{color:var(--cyan);font-size:12px;font-weight:800;letter-spacing:.18em;text-transform:uppercase}.card h2{font-size:32px;line-height:1.08;margin:10px 0 12px}.lead{color:var(--muted);line-height:1.65;margin:0 0 24px}.field{display:block;color:var(--muted);font-size:13px;font-weight:700;margin:14px 0 8px}.input{width:100%;border:1px solid var(--line);border-radius:14px;background:#080d20;color:var(--text);padding:15px 16px;font-size:17px;outline:none}.input:focus{border-color:var(--cyan);box-shadow:0 0 0 4px #62e8ff18}.btn{width:100%;border:0;border-radius:14px;padding:15px 18px;margin-top:18px;background:linear-gradient(100deg,var(--cyan),var(--violet) 60%,var(--pink));color:#080b19;font-weight:900;font-size:16px;cursor:pointer;box-shadow:0 12px 28px #7e7cff44}.btn:hover{filter:brightness(1.1);transform:translateY(-1px)}.hint{font-size:12px;color:var(--muted);line-height:1.6;margin-top:18px}.steps{display:grid;gap:10px;margin:22px 0 0;padding:0;list-style:none}.steps li{display:flex;gap:10px;align-items:flex-start;color:var(--muted);font-size:13px}.num{flex:0 0 22px;height:22px;border-radius:8px;display:grid;place-items:center;background:#ffffff12;color:var(--cyan);font-weight:800}.code{font-size:42px;letter-spacing:.16em;text-align:center;margin:25px 0;color:var(--cyan);font-weight:900;text-shadow:0 0 24px #62e8ff66}.success{border:1px solid #62e8ff44;background:#62e8ff0d;border-radius:18px;padding:15px;color:var(--muted);line-height:1.6}.links{text-align:center;margin-top:20px;font-size:13px}.links a{color:var(--cyan);text-decoration:none;margin:0 8px}.footer{text-align:center;color:#8490b7;font-size:11px;margin-top:18px;letter-spacing:.08em}@media(max-width:480px){.card{padding:23px;border-radius:23px}.card h2{font-size:27px}.code{font-size:31px}}
  </style></head><body><main class="shell"><div class="brand"><div class="orb">A</div><div><h1>Aura-XMD</h1><small>BLAZE TECH · Multi-session gateway</small></div></div>${body}<div class="footer">Made with love by ARNOLDT20</div></main></body></html>`;
}
function startWeb() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (req.method === "GET" && url.pathname === "/") return res.end(page("Welcome", `<section class="card"><div class="eyebrow">Private WhatsApp runtime</div><h2>Connect your number to Aura.</h2><p class="lead">Pair a new number in seconds. Every connected number receives its own isolated session and stays active independently.</p><a class="btn" href="/pair" style="display:block;text-align:center;text-decoration:none">Open secure pairing</a><div class="links"><a href="/dashboard">Owner dashboard</a><a href="/health">System health</a></div></section>`));
    if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { ok: true, sessions: manager.list(), uptime: process.uptime(), dashboard: `${baseConfig.publicUrl || `http://${req.headers.host || "localhost"}`}/dashboard` });
    if (req.method === "GET" && ["/dashboard", "/panel", "/owner"].includes(url.pathname)) { if (!dashboardAuthorized(url)) return res.end(dashboardGatePage()); return res.end(dashboardPage()); }
    if (req.method === "GET" && url.pathname === "/api/dashboard") { if (!dashboardAuthorized(url)) return json(res, 401, { ok: false, error: "unauthorized", message: "Open /dashboard and enter DASHBOARD_TOKEN." }); return json(res, 200, dashboardData(req)); }
    if (req.method === "POST" && url.pathname === "/api/autopost") { const params = await readRequestBody(req); const tokenUrl = new URL(`http://${req.headers.host || "localhost"}/?token=${encodeURIComponent(params.get("token") || "")}`); if (!dashboardAuthorized(tokenUrl)) return json(res, 401, { ok: false, error: "unauthorized" }); try { const result = params.get("action") === "fetch_now" ? await fetchNowForTarget(params.get("sessionId"), params.get("jid")) : await autopostAction(params); return json(res, 200, { ok: true, ...result }); } catch (error) { return json(res, 400, { ok: false, error: error.message }); } }
    if (req.method === "GET" && url.pathname === "/pair") return res.end(page("Pair your number", `<section class="card"><div class="eyebrow">Step 01 · Create a session</div><h2>Pair your WhatsApp number.</h2><p class="lead">Use the full number with country code. Do not include <b>+</b>, spaces, or dashes.</p><form method="post"><label class="field" for="phone">WhatsApp number</label><input class="input" id="phone" name="phone" inputmode="numeric" autocomplete="tel" placeholder="255625606354" required>${baseConfig.pairToken ? '<label class="field" for="token">Pair token</label><input class="input" id="token" name="token" type="password" placeholder="Enter the private pair token" required>' : ""}<button class="btn" type="submit">Generate pairing code</button></form><ol class="steps"><li><span class="num">1</span><span>Enter your number and generate a code.</span></li><li><span class="num">2</span><span>Open WhatsApp → Linked devices.</span></li><li><span class="num">3</span><span>Choose “Link with phone number instead”.</span></li></ol></section>`));
    if (req.method === "POST" && url.pathname === "/pair") {
      let body = ""; req.on("data", chunk => { body += chunk; }); req.on("end", async () => { try { const params = new URLSearchParams(body); if (baseConfig.pairToken && params.get("token") !== baseConfig.pairToken) return res.end(page("Pairing denied", `<section class="card"><div class="eyebrow">Access denied</div><h2>That pair token is not valid.</h2><p class="lead">Ask the Aura-XMD administrator for the current pairing token.</p><a class="btn" href="/pair" style="display:block;text-align:center;text-decoration:none">Try again</a></section>`)); const result = await manager.pair(params.get("phone")); return res.end(page(result.error ? "Pairing failed" : "Pairing code", `<section class="card"><div class="eyebrow">${result.error ? "Could not create session" : "Step 02 · Link your phone"}</div><h2>${result.error ? "Pairing needs attention." : "Your code is ready."}</h2>${result.error ? `<p class="lead">${html(result.error)}</p>` : `<div class="code">${html(result.code)}</div><div class="success"><b>Next:</b> Open WhatsApp → Linked devices → Link a device → Link with phone number instead, then enter the code above. Keep this page open until the phone is linked.</div>`}<div class="links"><a href="/pair">Pair another number</a><a href="/health">System health</a></div></section>`)); } catch (error) { return res.end(page("Pairing failed", `<section class="card"><div class="eyebrow">Error</div><h2>We could not start pairing.</h2><p class="lead">${html(error.message)}</p><a class="btn" href="/pair" style="display:block;text-align:center;text-decoration:none">Try again</a></section>`)); } }); return; }
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
