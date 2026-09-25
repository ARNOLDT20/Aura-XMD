const { downloadMediaMessage } = require("@whiskeysockets/baileys");
const fs = require("fs");
const { getQuotedMessage, isOwner } = require("../lib/helpers");
const { downloadSocial, cleanupDownload } = require("../lib/social-downloader");

function unwrap(message) {
  return message?.viewOnceMessage?.message || message?.viewOnceMessageV2?.message || message?.ephemeralMessage?.message || message || {};
}

module.exports = {
  command: ["download", "save", "media", "audio", "mp3", "music", "song", "play", "video"],
  description: "Download media by URL or search name, or extract MP3 audio",
  async run({ sock, msg, jid, args, reply, config, command }) {
    const url = args.find(value => /^https?:\/\//i.test(value));
    const audioCommand = ["audio", "mp3", "music", "song"].includes(command) || args.includes("audio") || args.includes("mp3");
    const searchCommand = ["audio", "mp3", "music", "song", "play", "video"].includes(command);
    const searchText = args.filter(value => !/^\d{3,4}$/.test(value) && !["audio", "mp3"].includes(value.toLowerCase())).join(" ").trim();
    const target = url || (searchCommand && searchText ? `ytsearch1:${searchText}` : null);
    if (target) {
      let result;
      try {
        await reply(url ? "⏳ Fetching the media link. This can take up to 3 minutes..." : `🔎 Searching for “${searchText}”...`);
        result = await downloadSocial(target, null, {
          audio: audioCommand,
          quality: args.find(value => /^\d{3,4}$/.test(value)) || 720
        });
        const caption = `📥 ${result.title}\n⚡ Downloaded free with yt-dlp\n✅ Please respect the creator's rights.`;
        const audio = audioCommand || args.includes("audio") || args.includes("mp3");
        const media = fs.readFileSync(result.filePath);
        await sock.sendMessage(jid, audio
          ? { audio: media, mimetype: "audio/mpeg", fileName: `${result.title.slice(0, 60)}.mp3`, caption }
          : { video: media, mimetype: "video/mp4", caption }, jid.endsWith("@newsletter") ? {} : { quoted: msg });
      } catch (error) {
        await reply(`❌ Social download failed: ${error.message}`);
      } finally {
        cleanupDownload(result);
      }
      return;
    }

    const quoted = getQuotedMessage(msg);
    if (!quoted) return reply("Reply to media with .download/.media, use .media <url>, or search by name with .song <name> / .video <name>");
    const content = unwrap(quoted.message);
    const type = ["imageMessage", "videoMessage", "audioMessage", "documentMessage"].find(key => content[key]);
    if (!type) return reply("This media type cannot be downloaded by the bot.");
    const isViewOnce = Boolean(quoted.message?.viewOnceMessage || quoted.message?.viewOnceMessageV2 || content?.viewOnce);
    if (isViewOnce && !isOwner(sock, config, msg)) return reply("⛔ Only the owner can retrieve view-once media.");
    try {
      const buffer = await downloadMediaMessage(quoted, "buffer", {});
      const media = content[type];
      const key = type.replace("Message", "");
      await sock.sendMessage(jid, {
        [key]: buffer,
        mimetype: media.mimetype,
        caption: media.caption ? `📥 ${media.caption}` : "📥 Downloaded media",
        fileName: media.fileName,
        ptt: type === "audioMessage" ? Boolean(media.ptt) : undefined
      }, jid.endsWith("@newsletter") ? {} : { quoted: msg });
    } catch (error) {
      await reply(`Download failed: ${error.message}`);
    }
  }
};
