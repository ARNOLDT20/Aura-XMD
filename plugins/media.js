const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { downloadMediaMessage } = require("@whiskeysockets/baileys");
const { getQuotedMessage } = require("../lib/helpers");

function unwrap(message) {
  return message?.viewOnceMessage?.message || message?.viewOnceMessageV2?.message || message?.ephemeralMessage?.message || message || {};
}
function mediaInfo(quoted) {
  const content = unwrap(quoted?.message);
  for (const [type, key, mimetype] of [["imageMessage", "image", "image/jpeg"], ["videoMessage", "video", "video/mp4"], ["stickerMessage", "sticker", "image/webp"]]) {
    if (content[type]) return { type, key, mimetype, data: content[type] };
  }
  return null;
}
function runFfmpeg(input, output, args) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-y", "-i", input, ...args, output], { stdio: ["ignore", "ignore", "pipe"] });
    let error = "";
    child.stderr.on("data", chunk => { error += chunk.toString(); });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve() : reject(new Error(error.slice(-500) || `ffmpeg exited with ${code}`)));
  });
}
async function convert(buffer, sourceType, target) {
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-media-"));
  const input = path.join(dir, sourceType === "sticker" ? "input.webp" : sourceType === "video" ? "input.mp4" : "input.jpg");
  const output = path.join(dir, target === "sticker" ? "output.webp" : target === "image" ? "output.jpg" : "output.mp4");
  fs.writeFileSync(input, buffer, { mode: 0o600 });
  try {
    if (target === "sticker") await runFfmpeg(input, output, ["-vcodec", "libwebp", "-vf", "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=white@0.0", "-loop", "0", "-an", "-preset", "default"]);
    if (target === "image") await runFfmpeg(input, output, ["-frames:v", "1", "-q:v", "3"]);
    if (target === "video") await runFfmpeg(input, output, ["-t", "10", "-movflags", "+faststart", "-pix_fmt", "yuv420p", "-vf", "scale=720:-2"]);
    return fs.readFileSync(output);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
async function uploadUrl(buffer, fileName, mimetype) {
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mimetype }), fileName);
  const response = await fetch("https://0x0.st", { method: "POST", body: form, signal: AbortSignal.timeout(30000) });
  const url = (await response.text()).trim();
  if (!response.ok || !/^https?:\/\//.test(url)) throw new Error(`Free upload service returned HTTP ${response.status}.`);
  return url;
}

module.exports = {
  command: ["sticker", "s", "toimage", "photo", "tovideo", "url", "url2"],
  description: "Convert replied media to sticker, image, video, or a temporary URL",
  async run({ sock, msg, jid, args, reply, command }) {
    const quoted = getQuotedMessage(msg);
    const media = mediaInfo(quoted);
    if (command === "url" || command === "url2") {
      if (!media) return reply("Reply to an image, video, or sticker with .url");
      try {
        const buffer = await downloadMediaMessage(quoted, "buffer", {});
        const url = await uploadUrl(buffer, `aura-${media.key}`, media.mimetype);
        return reply(`🔗 Temporary media URL (expires according to the free host):\n${url}`);
      } catch (error) { return reply(`❌ Could not create URL: ${error.message}`); }
    }
    if (!media) return reply("Reply to an image, video, or sticker first.");
    const target = ["sticker", "s"].includes(command) ? "sticker" : command === "toimage" || command === "photo" ? "image" : "video";
    if (target === "sticker" && media.type === "stickerMessage") return reply("That is already a sticker.");
    try {
      const buffer = await downloadMediaMessage(quoted, "buffer", {});
      if (target === "sticker") return sock.sendMessage(jid, { sticker: await convert(buffer, media.key, "sticker") }, { quoted: msg });
      if (target === "image") return sock.sendMessage(jid, { image: await convert(buffer, media.key, "image"), caption: "🖼️ Converted by Aura-XMD" }, { quoted: msg });
      return sock.sendMessage(jid, { video: await convert(buffer, media.key, "video"), caption: "🎞️ Converted by Aura-XMD", mimetype: "video/mp4" }, { quoted: msg });
    } catch (error) { return reply(`❌ Conversion failed: ${error.message}`); }
  }
};
