const fs = require("fs");

function cleanPrefix(value) {
  const prefix = String(value || "").trim();
  if (!prefix || prefix.length > 3 || /\s/.test(prefix)) throw new Error("Prefix must be 1–3 non-space characters.");
  return prefix;
}

async function saveSettings({ sessions, store, persistence, params }) {
  const sessionId = String(params.get("sessionId") || "controller");
  const runtime = sessions.get(sessionId);
  if (!runtime) throw new Error("That session is not active.");
  const state = await store.run(sessionId, async () => {
    const current = store.load();
    if (params.has("prefix")) current.prefix = cleanPrefix(params.get("prefix"));
    if (params.has("botName")) current.botName = String(params.get("botName") || "Aura-XMD").trim().slice(0, 40) || "Aura-XMD";
    if (params.has("watermarkText")) current.watermarkText = String(params.get("watermarkText") || "").trim().slice(0, 80);
    if (params.has("reactionNotice")) current.reactionNotice = String(params.get("reactionNotice") || "").trim().slice(0, 180);
    store.save(current);
    return current;
  });
  runtime.config.prefix = state.prefix; runtime.config.botName = state.botName; runtime.config.watermarkText = state.watermarkText; runtime.config.reactionNotice = state.reactionNotice;
  return { message: `Settings saved for ${sessionId}. New commands must use prefix ${state.prefix}`, settings: { prefix: state.prefix, botName: state.botName, watermarkText: state.watermarkText, reactionNotice: state.reactionNotice } };
}

module.exports = { saveSettings };
