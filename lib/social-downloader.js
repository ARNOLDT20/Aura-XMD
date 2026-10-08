const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const bundledBinary = path.join(__dirname, "..", "bin", "yt-dlp");
const YTDLP = fs.existsSync(bundledBinary) ? bundledBinary : "yt-dlp";

function getPlatform(url) {
  if (/^ytsearch\d*:/i.test(url)) return "YouTube search";
  const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  if (host.includes("youtube") || host === "youtu.be") return "YouTube";
  if (host.includes("tiktok")) return "TikTok";
  if (host.includes("instagram")) return "Instagram";
  if (host.includes("facebook")) return "Facebook";
  if (host.includes("twitter") || host === "x.com") return "X";
  return "social media";
}

function runYtDlp(args, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const child = spawn(YTDLP, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("The free downloader timed out. Try a shorter video or a more specific search name."));
    }, timeoutMs);
    child.stdout.on("data", chunk => { stdout += chunk.toString(); });
    child.stderr.on("data", chunk => { stderr += chunk.toString(); });
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", code => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.slice(-1600) || `yt-dlp exited with ${code}`));
    });
  });
}

function commonArgs(output) {
  return ["--no-playlist", "--no-warnings", "--no-part", "--no-check-certificates", "--retries", "3", "--fragment-retries", "3", "--socket-timeout", "20", "--extractor-args", "youtube:player_client=android", "--js-runtimes", "node", "--restrict-filenames", "--max-filesize", "80M", "-o", output];
}
function profiles(url, output, audio, quality) {
  const height = Number(quality) || 720;
  const primary = commonArgs(output);
  if (audio) primary.push("-x", "--audio-format", "mp3", "--audio-quality", "0", "-f", "bestaudio/best");
  else primary.push("-f", `bv*[height<=${height}]+ba/b[height<=${height}]/b`, "--merge-output-format", "mp4");
  primary.push(url);

  const fallback = commonArgs(output);
  if (audio) fallback.push("-x", "--audio-format", "mp3", "--audio-quality", "5", "-f", "bestaudio/best");
  else fallback.push("-f", `best[height<=${height}]/best`, "--merge-output-format", "mp4");
  fallback.push(url);
  return [primary, fallback];
}

async function downloadSocial(url, _unusedToken, { audio = false, quality = 720 } = {}) {
  if (!/^https?:\/\//i.test(url) && !/^ytsearch\d*:/i.test(url)) {
    throw new Error("Use a public URL or a video/song search name.");
  }
  const platform = getPlatform(url);
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-download-"));
  const output = path.join(workDir, "%(title).80B [%(id)s].%(ext)s");
  let lastError;
  try {
    for (const args of profiles(url, output, audio, quality)) {
      try {
        const result = await runYtDlp(args);
        const files = fs.readdirSync(workDir).filter(file => !file.endsWith(".part") && !file.endsWith(".ytdl"));
        if (!files.length) throw new Error("yt-dlp completed without creating a media file.");
        const filePath = path.join(workDir, files[0]);
        const title = path.basename(filePath).replace(/\s*\[[^\]]+\]\.[^.]+$/, "").replace(/[_]+/g, " ").trim() || `${platform} download`;
        return { filePath, title, platform, workDir, log: result.stderr };
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(`${platform} download failed: ${lastError?.message || "no media was returned"}`);
  } catch (error) {
    fs.rmSync(workDir, { recursive: true, force: true });
    throw error;
  }
}

function cleanupDownload(result) {
  if (result?.workDir) fs.rmSync(result.workDir, { recursive: true, force: true });
}

module.exports = { YTDLP, downloadSocial, cleanupDownload, getPlatform };
