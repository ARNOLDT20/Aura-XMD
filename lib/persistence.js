const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function safeId(value) {
  return String(value || "default").replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 100) || "default";
}

function walkFiles(folder, current = folder, output = {}) {
  if (!fs.existsSync(current)) return output;
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const full = path.join(current, entry.name);
    const relative = path.relative(folder, full);
    if (entry.isDirectory()) walkFiles(folder, full, output);
    else output[relative] = fs.readFileSync(full).toString("base64");
  }
  return output;
}

function restoreFiles(folder, files) {
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  for (const [relative, encoded] of Object.entries(files || {})) {
    const target = path.resolve(folder, relative);
    if (!target.startsWith(path.resolve(folder) + path.sep)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.writeFileSync(target, Buffer.from(encoded, "base64"), { mode: 0o600 });
  }
}

class Persistence {
  constructor({ databaseUrl = "", dataDir }) {
    this.databaseUrl = databaseUrl;
    this.dataDir = dataDir;
    this.localFile = path.join(dataDir, "sessions.json");
    this.pool = null;
    this.encryptionKey = process.env.SESSION_ENCRYPTION_KEY ? crypto.createHash("sha256").update(process.env.SESSION_ENCRYPTION_KEY).digest() : null;
    this.local = { sessions: {}, states: {} };
  }

  async init() {
    fs.mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
    try { this.local = JSON.parse(fs.readFileSync(this.localFile, "utf8")); } catch {}
    if (this.databaseUrl) {
      const { Pool } = require("pg");
      this.pool = new Pool({ connectionString: this.databaseUrl, ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false } });
      await this.pool.query(`CREATE TABLE IF NOT EXISTS aura_sessions (id TEXT PRIMARY KEY, phone TEXT, status TEXT NOT NULL DEFAULT 'active', auth JSONB, state JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    }
  }

  async listSessions() {
    if (this.pool) return (await this.pool.query("SELECT id, phone, status FROM aura_sessions WHERE status <> 'deleted' ORDER BY created_at")).rows;
    return Object.values(this.local.sessions);
  }

  async getSession(id) {
    if (this.pool) return (await this.pool.query("SELECT * FROM aura_sessions WHERE id=$1", [id])).rows[0] || null;
    return this.local.sessions[id] || null;
  }

  async ensureSession(id, phone = "") {
    const now = new Date().toISOString();
    if (this.pool) {
      await this.pool.query(`INSERT INTO aura_sessions (id, phone, status) VALUES ($1,$2,'active') ON CONFLICT (id) DO UPDATE SET phone=COALESCE(NULLIF($2,''), aura_sessions.phone), status='active', updated_at=NOW()`, [id, phone]);
      return;
    }
    this.local.sessions[id] = { id, phone, status: "active", updated_at: now };
    this.flushLocal();
  }

  async markStatus(id, status) {
    if (this.pool) await this.pool.query("UPDATE aura_sessions SET status=$2, updated_at=NOW() WHERE id=$1", [id, status]);
    else if (this.local.sessions[id]) { this.local.sessions[id].status = status; this.local.sessions[id].updated_at = new Date().toISOString(); this.flushLocal(); }
  }

  async removeSession(id) {
    if (this.pool) await this.pool.query("DELETE FROM aura_sessions WHERE id=$1", [id]);
    else { delete this.local.sessions[id]; delete this.local.states[id]; this.flushLocal(); }
  }

  async restoreAuth(id, folder) {
    const row = await this.getSession(id);
    if (row?.auth) restoreFiles(folder, this.unseal(row.auth));
  }

  async saveAuth(id, folder) {
    const auth = this.seal(walkFiles(folder));
    if (this.pool) await this.pool.query("UPDATE aura_sessions SET auth=$2, updated_at=NOW() WHERE id=$1", [id, auth]);
    else if (this.local.sessions[id]) { this.local.sessions[id].auth = auth; this.local.sessions[id].updated_at = new Date().toISOString(); this.flushLocal(); }
  }

  async loadStates() {
    if (this.pool) {
      const rows = (await this.pool.query("SELECT id, state FROM aura_sessions WHERE state IS NOT NULL")).rows;
      return Object.fromEntries(rows.map(row => [row.id, row.state]));
    }
    return this.local.states || {};
  }

  async saveState(id, state) {
    if (this.pool) await this.pool.query("UPDATE aura_sessions SET state=$2, updated_at=NOW() WHERE id=$1", [id, state]);
    else { this.local.states[id] = state; this.flushLocal(); }
  }

  flushLocal() {
    const tmp = `${this.localFile}.tmp-${process.pid}-${crypto.randomBytes(3).toString("hex")}`;
    fs.writeFileSync(tmp, `${JSON.stringify(this.local, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tmp, this.localFile);
  }

  seal(value) {
    if (!this.encryptionKey) return value;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.encryptionKey, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
    return { encrypted: true, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
  }

  unseal(value) {
    if (!value?.encrypted) return value;
    if (!this.encryptionKey) throw new Error("SESSION_ENCRYPTION_KEY is required to restore encrypted sessions.");
    const decipher = crypto.createDecipheriv("aes-256-gcm", this.encryptionKey, Buffer.from(value.iv, "base64"));
    decipher.setAuthTag(Buffer.from(value.tag, "base64"));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.data, "base64")), decipher.final()]).toString("utf8"));
  }
}

module.exports = { Persistence, safeId };
