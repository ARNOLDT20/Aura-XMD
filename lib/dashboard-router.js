const { saveSettings } = require("./dashboard-actions");

async function dashboardAction({ action, params, manager, sessions, store, persistence }) {
  if (action === "save_settings") return saveSettings({ sessions, store, persistence, params });
  if (action === "restart") {
    await manager.restart(String(params.get("sessionId") || "controller"));
    return { message: "Restart requested. The session will reconnect using saved authentication." };
  }
  if (action === "clear_cache") return manager.clearCache(String(params.get("sessionId") || "controller"));
  throw new Error("Unknown dashboard action.");
}

module.exports = { dashboardAction };
