module.exports = {
  command: ["movie", "film"],
  description: "Look up movie information when OMDB_API_KEY is configured",
  async run({ args, reply, config }) {
    const title = args.join(" ").trim();
    if (!title) return reply("Usage: .movie <title>");
    if (!config.omdbApiKey) return reply("🎬 Movie lookup is not configured. Set OMDB_API_KEY in the deployment environment, then restart Aura-XMD.");
    try {
      const response = await fetch(`https://www.omdbapi.com/?apikey=${encodeURIComponent(config.omdbApiKey)}&t=${encodeURIComponent(title)}&plot=short`, { headers: { "user-agent": "Aura-XMD/1.0" }, signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`OMDb returned HTTP ${response.status}`);
      const data = await response.json();
      if (data.Response === "False") return reply(`🎬 ${data.Error || "Movie not found."}`);
      return reply(`🎬 ${data.Title} (${data.Year})\n⭐ ${data.imdbRating || "N/A"}\n🎭 ${data.Genre || "N/A"}\n\n${data.Plot || "No plot summary."}`);
    } catch (error) { return reply(`❌ Movie lookup failed: ${error.message}`); }
  }
};
