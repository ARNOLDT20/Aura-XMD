const fs = require("fs");

function formatDuration(totalSeconds) {
  let seconds = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(seconds / 86400); seconds %= 86400;
  const hours = Math.floor(seconds / 3600); seconds %= 3600;
  const minutes = Math.floor(seconds / 60); seconds %= 60;
  return [days ? `${days}d` : "", hours ? `${hours}h` : "", minutes ? `${minutes}m` : "", `${seconds}s`].filter(Boolean).join(" ");
}
module.exports = {
  command: "health",
  description: "Show this linked session health and uptime",
  async run({ sock, reply, config }) {
    const before = Date.now(); await reply("⏱️ Checking Aura-XMD health...");
    const memory = process.memoryUsage(); const runtime = config.runtime || {};
    const account = String(sock.user?.id || "not linked").split(":")[0];
    let sessionFiles = 0; try { sessionFiles = fs.readdirSync(config.sessionFolder).length; } catch {}
    const status = runtime.connectionState || (sock.user ? "open" : "starting");
    const icon = status === "open" ? "🟢" : status === "connecting" ? "🟡" : "🔴";
    return reply(`╭━━〔 ${config.botName} HEALTH 〕━━╮\n│ ${icon} Connection: ${status}\n│ Account: ${account}\n│ Session: ${config.sessionId}\n│ Uptime: ${formatDuration((Date.now() - (runtime.startedAt || Date.now())) / 1000)}\n│ Reply latency: ${Date.now() - before}ms\n│ Memory: ${Math.round(memory.rss / 1024 / 1024)}MB RSS\n│ Commands: ${config.totalCommands || 0}\n│ Session files: ${sessionFiles}\n│ Last connected: ${runtime.lastConnectedAt ? new Date(runtime.lastConnectedAt).toISOString() : "not yet"}\n╰━━━━━━━━━━━━━━━━━━━━╯`);
  }
};
