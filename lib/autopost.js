const { URL } = require("url");

function stripTags(value = "") {
  return String(value).replace(/<![\s\S]*?-->/g, "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
}
function tag(block, name) {
  const match = String(block).match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return match ? stripTags(match[1]) : "";
}
function rawTag(block, name) {
  const match = String(block).match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return match ? match[1].trim() : "";
}
function attr(block, name) {
  const match = String(block).match(new RegExp(`${name}=["']([^"']+)["']`, "i"));
  return match ? match[1] : "";
}
function absoluteUrl(value, sourceUrl) {
  try { return value ? new URL(value, sourceUrl).toString() : ""; } catch { return ""; }
}
function parseFeed(body, sourceUrl) {
  const items = [];
  const rssBlocks = body.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  const atomBlocks = body.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
  for (const block of [...rssBlocks, ...atomBlocks]) {
    const title = tag(block, "title") || "Untitled update";
    const linkTag = block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/i);
    const link = absoluteUrl(tag(block, "link") || linkTag?.[1], sourceUrl);
    const description = tag(block, "description") || tag(block, "summary") || tag(block, "content");
    const enclosure = block.match(/<enclosure\b[^>]*url=["']([^"']+)["'][^>]*>/i);
    const mediaUrl = absoluteUrl(enclosure?.[1] || attr(rawTag(block, "media:content"), "url"), sourceUrl);
    items.push({ title, text: description, url: link, mediaUrl, mediaType: "", key: link || `${title}:${description}` });
  }
  if (items.length) return items;
  const title = (body.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
  const description = (body.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']+)["']/i) || [])[1];
  if (title || description) return [{ title: stripTags(title || "Website update"), text: stripTags(description || ""), url: sourceUrl, mediaUrl: "", mediaType: "", key: sourceUrl }];
  return [];
}
async function fetchWebsitePosts(sourceUrl, limit = 20) {
  const parsed = new URL(sourceUrl);
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("Website source must use http:// or https://.");
  const response = await fetch(parsed, { headers: { "user-agent": "Aura-XMD/1.0 autopost reader" }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Website returned HTTP ${response.status}.`);
  const body = await response.text();
  return parseFeed(body, sourceUrl).slice(0, Math.max(1, Math.min(50, limit)));
}
module.exports = { fetchWebsitePosts };
