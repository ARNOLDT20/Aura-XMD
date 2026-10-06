const { AsyncLocalStorage } = require("async_hooks");

const asyncContext = new AsyncLocalStorage();
const defaults = {
  botName: "Aura-XMD",
  watermarkText: "BLAZE TECH",
  reactionNotice: "React ❤️ and share this update ✨",
  prefix: ".",
  menuImagePath: "assets/aura-menu.jpg",
  menuStyle: "aura",
  channel: { jid: "", autoPost: { enabled: false, intervalMinutes: 60, text: "" }, schedules: [], schedulesEnabled: true, targets: {} },
  statusReactions: { enabled: true, emojis: ["✨", "🔥", "💜", "🌟", "😊", "👏", "⚡"] },
  groups: {}
};

let states = new Map();
let persist = async () => {};

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function merge(base, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return base;
  for (const [key, item] of Object.entries(value)) {
    if (item && typeof item === "object" && !Array.isArray(item) && base[key] && typeof base[key] === "object") merge(base[key], item);
    else base[key] = item;
  }
  return base;
}
function currentId() { return asyncContext.getStore() || "controller"; }
function load() {
  const id = currentId();
  if (!states.has(id)) states.set(id, merge(clone(defaults), {}));
  return clone(states.get(id));
}
function save(state) {
  const id = currentId();
  states.set(id, merge(clone(defaults), state));
  Promise.resolve(persist(id, states.get(id))).catch(error => console.error("State persistence failed:", error.message));
}
function run(id, callback) { return asyncContext.run(id, callback); }
function initialize(savedStates = {}, saveState = async () => {}) {
  persist = saveState;
  states = new Map(Object.entries(savedStates).map(([id, state]) => [id, merge(clone(defaults), state)]));
}
function snapshot(id) { return clone(states.get(id) || merge(clone(defaults), {})); }
module.exports = { load, save, run, initialize, snapshot, defaults: clone(defaults) };
