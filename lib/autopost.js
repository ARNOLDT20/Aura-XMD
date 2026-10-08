const { URL } = require("url");

function decodeEntities(value = "") {
  return String(value)
    .replace(/<!\[CDATA\[/gi, "")
    .replace(/\]\]>/g, "")
    .replace(/<![\s\S]*?-->/g, "")
    .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, entity) => {
      const lower = entity.toLowerCase();
      if (lower === "amp") return "&";
      if (lower === "lt") return "<";
      if (lower === "gt") return ">";
      if (lower === "quot") return '"';
      if (lower === "apos") return "'";
      if (lower === "nbsp") return " ";
      const code = lower.startsWith("#x") ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(Math.min(code, 0x10ffff)) : "";
    });
}
function stripTags(value = "") {
  return decodeEntities(String(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
function rawTags(block, name) {
  const escaped = String(name).replace(":", "\\:");
  return [...String(block).matchAll(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)</${escaped}>`, "gi"))].map(match => match[1].trim());
}
function rawTag(block, name) { return rawTags(block, name)[0] || ""; }
function tag(block, name) { return stripTags(rawTag(block, name)); }
function attr(block, name) {
  const match = String(block).match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*["']([^"']+)["']`, "i"));
  return match ? decodeEntities(match[1]) : "";
}
function absoluteUrl(value, sourceUrl) {
  try { return value ? new URL(decodeEntities(value.trim()), sourceUrl).toString() : ""; } catch { return ""; }
}
function firstUrlFromHtml(value, sourceUrl) {
  const match = String(value || "").match(/<(?:img|source)\b[^>]*(?:src|data-src|data-original|srcset)=["']([^"']+)["'][^>]*>/i);
  if (!match) return "";
  return absoluteUrl(match[1].split(/\s+/)[0].split(",")[0], sourceUrl);
}
function mediaFromBlock(block, sourceUrl) {
  const candidates = [];
  for (const tagName of ["enclosure", "media:content", "media:thumbnail", "image"]) {
    const regex = new RegExp(`<${tagName.replace(":", "\\:")}\\b[^>]*>?(?:[\\s\\S]*?<\\/${tagName.replace(":", "\\:")}>)?`, "gi");
    for (const match of String(block).matchAll(regex)) {
      const node = match[0];
      const url = attr(node, "url") || attr(node, "href") || (tagName === "image" ? stripTags(node) : "");
      if (url) candidates.push({ url: absoluteUrl(url, sourceUrl), type: attr(node, "type") || "" });
    }
  }
  const atomEnclosure = String(block).match(/<link\b[^>]*rel=["']enclosure["'][^>]*>/i);
  if (atomEnclosure) candidates.push({ url: absoluteUrl(attr(atomEnclosure[0], "href"), sourceUrl), type: attr(atomEnclosure[0], "type") || "" });
  const htmlMedia = firstUrlFromHtml(rawTag(block, "content:encoded") || rawTag(block, "description") || rawTag(block, "summary") || rawTag(block, "content"), sourceUrl);
  if (htmlMedia) candidates.push({ url: htmlMedia, type: "" });
  return candidates.find(item => item.url) || { url: "", type: "" };
}
function parseFeed(body, sourceUrl) {
  const items = [];
  const blocks = [...(body.match(/<item\b[\s\S]*?<\/item>/gi) || []), ...(body.match(/<entry\b[\s\S]*?<\/entry>/gi) || [])];
  for (const block of blocks) {
    const title = tag(block, "title") || "Untitled update";
    const linkHref = String(block).match(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/i);
    const link = absoluteUrl(tag(block, "link") || linkHref?.[1], sourceUrl);
    const richDescription = rawTag(block, "content:encoded") || rawTag(block, "description") || rawTag(block, "summary") || rawTag(block, "content");
    const text = stripTags(richDescription);
    const media = mediaFromBlock(block, sourceUrl);
    const published = tag(block, "pubDate") || tag(block, "published") || tag(block, "updated");
    items.push({ title, text, url: link, mediaUrl: media.url, mediaType: media.type, published, key: link || `${title}:${text}:${media.url}` });
  }
  if (items.length) return items;
  const title = (body.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
  const description = (body.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description|twitter:description)["'][^>]+content=["']([^"']*)["']/i) || [])[1] || "";
  const ogImage = (body.match(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]+content=["']([^"']+)["']/i) || [])[1];
  const article = (body.match(/<article\b[\s\S]*?<\/article>/i) || [])[0] || body;
  const text = stripTags(description || article).slice(0, 6000);
  if (title || text || ogImage) return [{ title: stripTags(title || "Website update"), text, url: sourceUrl, mediaUrl: absoluteUrl(ogImage || firstUrlFromHtml(article, sourceUrl), sourceUrl), mediaType: "", published: "", key: sourceUrl }];
  return [];
}
async function fetchWebsitePosts(sourceUrl, limit = 20) {
  const parsed = new URL(sourceUrl);
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("Website source must use http:// or https://.");
  const response = await fetch(parsed, { headers: { "user-agent": "Aura-XMD/1.1 (+RSS media reader)", accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.8" }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Website returned HTTP ${response.status}.`);
  const body = await response.text();
  return parseFeed(body, sourceUrl).slice(0, Math.max(1, Math.min(50, limit)));
}
module.exports = { fetchWebsitePosts, parseFeed };
