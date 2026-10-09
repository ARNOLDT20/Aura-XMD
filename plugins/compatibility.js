const os = require("os");
const { isOwner } = require("../lib/helpers");

const jokes = ["Why did the developer go broke? Because they used up all their cache.", "A bug walked into a bar. The bartender said: We have a drink named after you. The bug said: You have a drink named Steve?", "I told my code a joke. It did not respond. It was still waiting for a callback."];
const riddles = ["What has keys but cannot open locks? A keyboard.", "What gets wetter as it dries? A towel.", "What has a face and two hands but no arms or legs? A clock."];
const facts = ["Octopuses have three hearts.", "A day on Venus is longer than its year.", "Honey can remain edible for an extremely long time when sealed properly."];
function pick(items) { return items[Math.floor(Math.random() * items.length)]; }

module.exports = {
  command: ["menu2", "uptime", "botinfo", "info", "repeat", "say", "coinflip", "riddle", "funfact", "wouldyou", "rizz", "fancy", "joke", "owner", "repo", "github", "repozip", "groupid", "id", "jid", "mode", "profile", "profile2", "codecheck", "htmlpreview", "short"],
  description: "Working BLAZE-compatible general, fun, and utility commands",
  async run({ sock, msg, jid, args, reply, config, command }) {
    if (command === "menu2") return reply(`Use ${config.prefix}menu for the full Aura-XMD menu.`);
    if (command === "uptime") return reply(`⏱️ ${config.botName} uptime: ${Math.floor(process.uptime())} seconds`);
    if (["botinfo", "info"].includes(command)) return reply(`╭─〔 ${config.botName} 〕\n│ Platform: ${process.platform}\n│ Node: ${process.version}\n│ Memory: ${Math.round(process.memoryUsage().rss / 1048576)} MB\n│ Prefix: ${config.prefix}\n╰──────────────`);
    if (["repeat", "say"].includes(command)) return reply(args.join(" ") || `Usage: ${config.prefix}${command} <text>`);
    if (command === "coinflip") return reply(Math.random() < 0.5 ? "🪙 Heads" : "🪙 Tails");
    if (command === "riddle") return reply(`🧩 ${pick(riddles)}`);
    if (command === "funfact") return reply(`💡 ${pick(facts)}`);
    if (command === "joke") return reply(`😄 ${pick(jokes)}`);
    if (command === "wouldyou") return reply("🎲 Would you rather have unlimited music or unlimited travel?");
    if (command === "rizz") return reply("✨ Are you a keyboard? Because you are just my type.");
    if (command === "fancy") return reply(`✨ ${args.join(" ") || "Aura-XMD"}`);
    if (command === "owner") return reply(`👑 Owner: ${config.ownerName}\nContact: ${config.ownerNumber || "the configured owner account"}`);
    if (["repo", "github"].includes(command)) return reply("🔗 https://github.com/ARNOLDT20/Aura-XMD");
    if (command === "repozip") return reply("📦 Download the repository from https://github.com/ARNOLDT20/Aura-XMD/archive/refs/heads/main.zip");
    if (["groupid", "id", "jid"].includes(command)) return reply(`🆔 ${jid}`);
    if (command === "mode") return reply("🔒 Aura-XMD mode: PRIVATE");
    if (["profile", "profile2"].includes(command)) return reply(`👤 ${String(msg.key?.participant || sock.user?.id || "user").split("@")[0]}`);
    if (command === "codecheck") return reply(args.length ? "✅ Code received. Basic syntax checking is available locally; send a short code block when requesting a review." : "Usage: .codecheck <code>");
    if (command === "htmlpreview") return reply("🌐 HTML preview requires an HTML file or URL. Use .url on replied media for a temporary public URL.");
    if (command === "short") return reply("🎞️ Reply to an image or video with .sticker, .toimage, or .tovideo.");
    if (!isOwner(sock, config, msg) && ["profile2"].includes(command)) return reply("⛔ Owner permission required.");
    return reply("This compatibility command is not available in the current deployment.");
  }
};
