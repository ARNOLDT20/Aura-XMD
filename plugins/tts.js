function googleAudioUrl(text, lang = "en-US", slow = false) {
  const encoded = encodeURIComponent(String(text).slice(0, 1800));
  return `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(lang)}&q=${encoded}&ttsspeed=${slow ? "0.6" : "1.0"}`;
}
module.exports = {
  command: ["tts", "tts2", "tts3", "trt"],
  description: "Convert text to speech using the free Google TTS endpoint",
  async run({ sock, jid, args, reply, msg, command }) {
    let lang = "en-US";
    if (["ur", "urdu"].includes((args[0] || "").toLowerCase())) { lang = "ur"; args.shift(); }
    if (["sw", "swahili"].includes((args[0] || "").toLowerCase())) { lang = "sw"; args.shift(); }
    if (["ar", "arabic"].includes((args[0] || "").toLowerCase())) { lang = "ar"; args.shift(); }
    const text = args.join(" ").trim();
    if (!text) return reply(`Usage: .${command} [en|sw|ur|ar] <text>`);
    try {
      const url = googleAudioUrl(text, lang, command === "trt");
      const response = await fetch(url, { headers: { "user-agent": "Aura-XMD/1.0" }, signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`Google TTS returned HTTP ${response.status}`);
      return sock.sendMessage(jid, { audio: { url }, mimetype: "audio/mpeg", ptt: true }, jid.endsWith("@newsletter") ? {} : { quoted: msg });
    } catch (error) { return reply(`❌ TTS failed: ${error.message}`); }
  }
};
