const fs = require("fs");

function formatDuration(totalSeconds) {
  let seconds = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(seconds / 86400); seconds %= 86400;
  const hours = Math.floor(seconds / 3600); seconds %= 3600;
  const minutes = Math.floor(seconds / 60); seconds %= 60;
  return [days ? `${days}d` : "", hours ? `${hours}h` : "", minutes ? `${minutes}m` : "", `${seconds}s`]
    .filter(Boolean).join(" ");
}

function sessionFileCount(folder) {
  try {
    return fs.readdirSync(folder).filter(name => name.endsWith(".json") || name.endsWith(".md" )).length;
  } catch {
    return 0;
  }
}

module.exports = {
  command: "health",
  description: "Show bot health, uptime, connection, memory, and latency",
  async run({ sock, jid, msg, reply, config }) {
    const startedAt = config.runtime?.startedAt || Date.now();
    const before = Date.now();
    await reply("⏱️ Checking Aura-XMD health...");
    const latency = Date.now() - before;
    const memory = process.memoryUsage();
    const state = config.runtime || {};
    const account = String(sock.user?.id || "not linked").split(":")[0];
    const sessionFiles = sessionFileCount(config.sessionFolder);
    const status = state.connectionState || (sock.user ? "open" : "starting");
    const icon = status === "open" ? "🟢" : status === "connecting" ? "🟡" : "🔴";

    return reply([
      `╭━━〔 ${config.botName} HEALTH 〕━━╮`,
      `│ ${icon} Connection: ${status}`,
      `│ Account: ${account}`,
      `│ Uptime: ${formatDuration((Date.now() - startedAt) / 1000)}`,
      `│ Reply latency: ${latency}ms`,
      `│ Memory: ${Math.round(memory.rss / 1024 / 1024)}MB RSS`,
      `│ Commands: ${config.totalCommands || 0}`,
      `│ Session files: ${sessionFiles}`,
      `│ Last connected: ${state.lastConnectedAt ? new Date(state.lastConnectedAt).toISOString() : "not yet"}`,
      `│ Last disconnect: ${state.lastDisconnectedAt ? new Date(state.lastDisconnectedAt).toISOString() : "none"}`,
      `╰━━━━━━━━━━━━━━━━━━━━╯`
    ].join("\n"));
  }
};
