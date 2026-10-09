const os = require("os");
function pick(items) { return items[Math.floor(Math.random() * items.length)]; }
module.exports = {
  command: ["base64", "unbase64", "urlencode", "urldecode", "roll", "flip", "pick", "calculate", "calc", "timenow", "date", "weather", "wikipedia", "wiki", "npm"],
  description: "Portable utility commands adapted from the archive",
  async run({ reply, args, command }) {
    const input = args.join(" ").trim();
    if (["base64", "unbase64"].includes(command)) {
      if (!input) return reply(`Usage: .${command} <text>`);
      try { return reply(command === "base64" ? Buffer.from(input).toString("base64") : Buffer.from(input, "base64").toString("utf8")); } catch (error) { return reply(`❌ ${error.message}`); }
    }
    if (command === "urlencode") return reply(encodeURIComponent(input));
    if (command === "urldecode") { try { return reply(decodeURIComponent(input)); } catch { return reply("❌ Invalid encoded URL."); } }
    if (["roll", "flip"].includes(command)) return reply(command === "roll" ? `🎲 ${1 + Math.floor(Math.random() * 6)}` : pick(["🪙 Heads", "🪙 Tails"]));
    if (command === "pick") return reply(input ? pick(input.split(",").map(x => x.trim()).filter(Boolean)) : "Usage: .pick option 1, option 2");
    if (["calculate", "calc"].includes(command)) {
      if (!/^[\d\s+\-*/().%]+$/.test(input)) return reply("❌ Only basic arithmetic is allowed.");
      try { return reply(`🧮 ${Function(`"use strict"; return (${input})`)()}`); } catch { return reply("❌ Invalid calculation."); }
    }
    if (["timenow", "date"].includes(command)) return reply(new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeStyle: "medium", timeZone: "Africa/Nairobi" }).format(new Date()));
    if (command === "weather") {
      if (!input) return reply("Usage: .weather <city>");
      try { const r = await fetch(`https://wttr.in/${encodeURIComponent(input)}?format=3`, { headers: { "user-agent": "Aura-XMD/1.0" }, signal: AbortSignal.timeout(15000) }); return reply(await r.text()); } catch (error) { return reply(`❌ Weather failed: ${error.message}`); }
    }
    if (["wikipedia", "wiki"].includes(command)) {
      if (!input) return reply("Usage: .wiki <topic>");
      try { const r = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(input)}`, { headers: { "user-agent": "Aura-XMD/1.0" }, signal: AbortSignal.timeout(15000) }); const data = await r.json(); return reply(data.extract ? `📚 ${data.title}\n\n${data.extract.slice(0, 2500)}\n\n${data.content_urls?.desktop?.page || ""}` : "No Wikipedia summary found."); } catch (error) { return reply(`❌ Wikipedia failed: ${error.message}`); }
    }
    if (command === "npm") {
      if (!input) return reply("Usage: .npm <package>");
      try { const r = await fetch(`https://registry.npmjs.org/${encodeURIComponent(input)}/latest`, { signal: AbortSignal.timeout(15000) }); if (!r.ok) return reply("Package not found."); const d = await r.json(); return reply(`📦 ${d.name}@${d.version}\n${d.description || "No description"}\n${d.homepage || d.repository?.url || ""}`); } catch (error) { return reply(`❌ NPM lookup failed: ${error.message}`); }
    }
  }
};
