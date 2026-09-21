"use strict";
/*
 * Curate Studio backend (zero dependencies, node server.js)
 * Roles: teacher / student; guests browse published galleries read-only.
 * Features: gallery sessions, student permissions, object CRUD, texture upload,
 * artwork review + comments, groups, chat, presence. Seed creates only accounts.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Optional local .env (zero-dependency). This file is gitignored: never commit real secrets.
(function loadEnvFile() {
  try {
    const f = path.join(__dirname, ".env");
    if (!fs.existsSync(f)) return;
    fs.readFileSync(f, "utf8").split(/\r?\n/).forEach((line) => {
      if (/^\s*#/.test(line)) return;
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!m) return;
      if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    });
  } catch (e) {}
})();

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const UPLOAD = path.join(ROOT, "uploads");
const DB = path.join(ROOT, "data.json");
if (!fs.existsSync(PUBLIC)) fs.mkdirSync(PUBLIC, { recursive: true });
if (!fs.existsSync(UPLOAD)) fs.mkdirSync(UPLOAD, { recursive: true });

let db = { users: [], sessions: [] };
const TOKENS = {};
const PRESENCE = {};

const genId = () => crypto.randomBytes(8).toString("hex");
function hashPass(pw) { const s = crypto.randomBytes(16).toString("hex"); return s + ":" + crypto.scryptSync(pw, s, 64).toString("hex"); }
function verifyPass(pw, stored) {
  if (!stored || stored.indexOf(":") < 0) return false;
  const p = stored.split(":"), salt = p[0], hex = p.slice(1).join(":");
  const v = crypto.scryptSync(pw, salt, 64).toString("hex");
  try { return crypto.timingSafeEqual(Buffer.from(hex, "hex"), Buffer.from(v, "hex")); } catch (e) { return false; }
}
const publicUser = (u) => ({ id: u.id, username: u.username, role: u.role, name: u.name, group: u.group || "", profile: u.profile || null });
function addUser(username, password, role, name, group) { const u = { id: genId(), username, password: hashPass(password), role, name, group: group || "", profile: { color: "#4a7bd0", skin: "#d9a678", hair: "#3a2a1a" }, blockedUntil: 0 }; db.users.push(u); return u; }
// Secrets are never hard-coded in this file. Resolution order:
//   1) environment variable (CURATE_ADMIN_KEY / CURATE_SECRET, e.g. from .env)
//   2) value previously generated into the local data.json (gitignored)
//   3) freshly generated random value, then persisted
let ADMIN_KEY = "";
let SECRET = "";
function metaGet(k) { return (db.meta && db.meta[k]) || ""; }
function metaSet(k, v) { db.meta = db.meta || {}; db.meta[k] = v; }
function initSecrets() {
  let dirty = false;
  ADMIN_KEY = process.env.CURATE_ADMIN_KEY || metaGet("adminKey");
  SECRET = process.env.CURATE_SECRET || metaGet("serverSecret");
  if (!ADMIN_KEY) { ADMIN_KEY = crypto.randomBytes(12).toString("hex"); metaSet("adminKey", ADMIN_KEY); dirty = true; }
  if (!SECRET) { SECRET = crypto.randomBytes(32).toString("hex"); metaSet("serverSecret", SECRET); dirty = true; }
  if (dirty) save();
}
function signToken(uid) { return uid + "." + crypto.createHmac("sha256", SECRET).update(uid).digest("hex"); }
function verifyToken(t) { const dot = t.indexOf("."); if (dot < 0) return null; const uid = t.slice(0, dot), sig = t.slice(dot + 1); const want = crypto.createHmac("sha256", SECRET).update(uid).digest("hex"); try { return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want)) ? uid : null; } catch (e) { return null; } }

function seed() { db = { users: [], sessions: [], meta: {} }; if (process.env.CURATE_SEED_DEMO === "0") { save(); return; } addUser("teacher", process.env.CURATE_DEMO_TEACHER_PW || "123", "teacher", "Demo Teacher", ""); addUser("student", process.env.CURATE_DEMO_STUDENT_PW || "123", "student", "Demo Student", "Group 1"); console.log("[seed] demo accounts created (teacher, student). Change these passwords, or set CURATE_SEED_DEMO=0."); save(); }
const DBBAK = DB + ".bak";
function load() { let src = DB; if (!fs.existsSync(DB) && fs.existsSync(DBBAK)) src = DBBAK; if (fs.existsSync(src)) { try { db = JSON.parse(fs.readFileSync(src, "utf8")); if (src !== DB) { try { fs.copyFileSync(src, DB); } catch (e) {} } } catch (e) { db = { users: [], sessions: [] }; seed(); } } else seed(); }
function save() { try { if (fs.existsSync(DB)) fs.copyFileSync(DB, DBBAK); } catch (e) {} fs.writeFileSync(DB, JSON.stringify(db, null, 2)); }

function readBody(req) { return new Promise((resolve) => { let d = ""; req.on("data", (c) => { d += c; if (d.length > 2e7) req.destroy(); }); req.on("end", () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { resolve({}); } }); req.on("error", () => resolve({})); }); }
function authUser(req) { const t = (req.headers["authorization"] || "").replace(/^Bearer\s+/i, "").trim(); if (!t) return null; const uid = verifyToken(t); return (uid && db.users.find((u) => u.id === uid)) || null; }
const send = (res, code, obj) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(obj)); };
const full = (s) => JSON.parse(JSON.stringify(s));
function permForAction(type) {
  if (type === "wall" || type === "door" || type === "window" || type === "block" || type === "vista") return "canPlaceWalls";
  if (type === "pedestal" || type === "light" || type === "case" || type === "chair" || type === "table" || type === "rug" || type === "projector" || type === "belt" || type === "barricade" || type === "waterbarrier" || type === "sign") return "canPlaceDecor";
  if (type === "label") return "canPlaceLabels";
  if (type === "artwork") return "canPlaceArtworks";
  return null;
}
function canStudent(user, s, key) { return !!(user && user.role === "student" && s.members.includes(user.id) && s.perms[key]); }

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon" };
function serve(res, fp) { fs.readFile(fp, (e, b) => { if (e) { res.writeHead(404); res.end("Not found"); return; } res.writeHead(200, { "Content-Type": MIME[path.extname(fp).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store" }); res.end(b); }); }

async function handle(req, res) {
  const u = new URL(req.url, "http://x");
  const p = decodeURIComponent(u.pathname);
  const m = req.method;

  if (m === "GET") {
    if (p.startsWith("/uploads/")) return serve(res, path.join(UPLOAD, p.slice(9)));
    if (p === "/" || p === "/index.html") return serve(res, path.join(PUBLIC, "index.html"));
    if (p === "/api/public/sessions") return send(res, 200, db.sessions.filter((s) => s.isPublished).map((s) => ({ id: s.id, title: s.title, description: s.description, isPublished: s.isPublished, owner: s.owner })));
    const pm = p.match(/^\/api\/public\/sessions\/([^/]+)$/);
    if (pm) { const s = db.sessions.find((x) => x.id === pm[1]); if (!s || !s.isPublished) return send(res, 404, { error: "Gallery not found or unpublished" }); return send(res, 200, full(s)); }
    const user = authUser(req);
    if (p === "/api/me") return send(res, 200, { user: user ? publicUser(user) : null });
    if (p === "/api/sessions") {
      if (!user) return send(res, 401, { error: "Please log in" });
      const list = user.role === "teacher" ? db.sessions.filter((s) => s.owner === user.id) : db.sessions.filter((s) => s.members.includes(user.id) || s.isPublished);
      return send(res, 200, list.map((s) => ({ id: s.id, title: s.title, description: s.description, isPublished: s.isPublished, owner: s.owner, perms: s.perms, members: s.members, canEdit: s.owner === user.id })));
    }
    if (p === "/api/students") { if (!user || user.role !== "teacher") return send(res, 403, { error: "Teachers only" }); return send(res, 200, db.users.filter((x) => x.role === "student").map(publicUser)); }
    if (p === "/api/users") { if (!user || user.role !== "teacher") return send(res, 403, { error: "Teachers only" }); return send(res, 200, db.users.map((u) => ({ ...publicUser(u), blockedUntil: u.blockedUntil || 0 }))); }
    const sn = p.match(/^\/api\/sessions\/([^/]+)$/);
    if (sn) { const s = db.sessions.find((x) => x.id === sn[1]); if (!s) return send(res, 404, { error: "Gallery not found" }); const owner = user && s.owner === user.id, member = user && s.members.includes(user.id); if (!owner && !member && !s.isPublished) return send(res, 403, { error: "Forbidden" }); return send(res, 200, { ...full(s), canEdit: owner, canStudentEdit: !!(member && user && user.role === "student") }); }
    const ch = p.match(/^\/api\/sessions\/([^/]+)\/chat$/); if (ch) { const s = db.sessions.find((x) => x.id === ch[1]); return send(res, 200, s ? (s.chat || []).slice(-100) : []); }
    const pr = p.match(/^\/api\/sessions\/([^/]+)\/presence$/); if (pr) { const map = PRESENCE[pr[1]] || {}; const now = Date.now(); return send(res, 200, Object.values(map).filter((v) => now - v.t < 9000).map((v) => ({ uid: v.uid, name: v.name, color: v.color, x: v.x, z: v.z }))); }
    return serve(res, path.join(PUBLIC, p));
  }

  if (m === "POST") {
    const body = await readBody(req);
    if (p === "/api/register") { const { username, password, role, name, adminKey } = body; if (!username || !password) return send(res, 400, { error: "Missing username or password" }); if (db.users.find((x) => x.username === username)) return send(res, 409, { error: "Username already exists" }); if (role === "teacher" && adminKey !== ADMIN_KEY) return send(res, 403, { error: "Invalid administrator key" }); addUser(username, password, role === "teacher" ? "teacher" : "student", name || username); save(); return send(res, 200, { ok: true }); }
    if (p === "/api/login") { const { username, password } = body; const u = db.users.find((x) => x.username === username); if (!u || !verifyPass(password || "", u.password)) return send(res, 401, { error: "Invalid username or password" }); if (u.blockedUntil && u.blockedUntil > Date.now()) return send(res, 403, { error: "This account is temporarily blocked" }); const token = signToken(u.id); return send(res, 200, { token, user: publicUser(u) }); }
    if (p === "/api/logout") { const t = (req.headers["authorization"] || "").replace(/^Bearer\s+/i, ""); if (t) delete TOKENS[t]; return send(res, 200, { ok: true }); }
    if (p === "/api/upload") { if (!authUser(req)) return send(res, 401, { error: "Please log in" }); const m2 = /^data:image\/(png|jpeg|jpg|gif|webp);base64,(.+)$/i.exec(body.dataUrl || ""); if (!m2) return send(res, 400, { error: "Unsupported image format (png/jpg only)" }); const ext = m2[1].toLowerCase() === "jpeg" ? "jpg" : m2[1].toLowerCase(); const name = genId() + "." + ext; fs.writeFileSync(path.join(UPLOAD, name), Buffer.from(m2[2], "base64")); return send(res, 200, { url: "/uploads/" + name }); }

    const user = authUser(req);
    if (p === "/api/sessions") { if (!user || user.role !== "teacher") return send(res, 403, { error: "Teachers only" }); if (!body.title) return send(res, 400, { error: "Title is required" }); const s = { id: genId(), title: body.title, description: body.description || "", owner: user.id, isPublished: false, time: 12, wallTex: null, ceiling: { mode: "none", y: 10, color: "#e8e6e1" }, perms: { canPlaceWalls: true, canPlaceDecor: true, canPlaceLabels: true, canPlaceArtworks: true, canDelete: true }, members: [], objects: [], chat: [], floor: { pattern: "wood", color: "#8a5a2a", image: null } }; db.sessions.push(s); save(); return send(res, 200, full(s)); }
    const ob = p.match(/^\/api\/sessions\/([^/]+)\/objects$/);
    if (ob) {
      const s = db.sessions.find((x) => x.id === ob[1]); if (!s) return send(res, 404, { error: "Gallery not found" });
      const pk = permForAction(body.type); if (!pk) return send(res, 400, { error: "Unknown object type" });
      const okO = user && user.role === "teacher" && s.owner === user.id, okS = canStudent(user, s, pk);
      if (!okO && !okS) return send(res, 403, { error: "You cannot place this here" });
      const obj = { id: genId(), type: body.type, pos: body.pos || [0, 0, 0], rot: body.rot || 0, scale: body.scale || [1, 1, 1], text: body.text || "", image: body.image || null, mat: body.mat || null, frame: body.frame || null, subtype: body.subtype || null, open: !!body.open, intensity: body.intensity != null ? Number(body.intensity) : null, color: body.color || null, ltype: body.ltype || null, comments: [], creatorName: user.name, creatorGroup: user.group || "", review: null };
      s.objects.push(obj); save(); return send(res, 200, obj);
    }
    const chp = p.match(/^\/api\/sessions\/([^/]+)\/chat$/);
    if (chp) { const s = db.sessions.find((x) => x.id === chp[1]); if (!s) return send(res, 404, { error: "Gallery not found" }); if (!user) return send(res, 401, { error: "Please log in" }); const msg = { id: genId(), uid: user.id, name: user.name, text: String(body.text || "").slice(0, 500), t: Date.now() }; s.chat = (s.chat || []).concat(msg).slice(-200); save(); return send(res, 200, msg); }
    const cmp = p.match(/^\/api\/sessions\/([^/]+)\/objects\/([^/]+)\/comments$/);
    if (cmp) { const s = db.sessions.find((x) => x.id === cmp[1]); if (!s) return send(res, 404, { error: "Gallery not found" }); const obj = s.objects.find((o) => o.id === cmp[2]); if (!obj) return send(res, 404, { error: "Object not found" }); if (!user) return send(res, 401, { error: "Please log in" }); obj.comments = obj.comments || []; obj.comments.push({ name: user.name, text: String(body.text || "").slice(0, 300), t: Date.now() }); save(); return send(res, 200, obj.comments); }
    const prp = p.match(/^\/api\/sessions\/([^/]+)\/presence$/);
    if (prp) { const map = PRESENCE[prp[1]] = PRESENCE[prp[1]] || {}; if (user) { map[user.id] = { uid: user.id, name: user.name, color: body.color || "#19d3ff", x: body.x || 0, z: body.z || 0, t: Date.now() }; return send(res, 200, { ok: true }); } return send(res, 401, { error: "Please log in" }); }
    const txp = p.match(/^\/api\/sessions\/([^/]+)\/tex$/);
    if (txp) {
      const s = db.sessions.find((x) => x.id === txp[1]); if (!s) return send(res, 404, { error: "Gallery not found" });
      const okT = user && user.role === "teacher" && s.owner === user.id, okS = user && user.role === "student" && s.members.includes(user.id);
      if (!okT && !okS) return send(res, 403, { error: "Forbidden" });
      const m2 = /^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i.exec(body.dataUrl || ""); if (!m2) return send(res, 400, { error: "Unsupported image format" });
      const ext = m2[1].toLowerCase() === "jpeg" ? "jpg" : m2[1].toLowerCase(); const name = genId() + "." + ext; fs.writeFileSync(path.join(UPLOAD, name), Buffer.from(m2[2], "base64")); const url = "/uploads/" + name;
      if (body.target === "floor") { s.floor = s.floor || {}; s.floor.image = url; } else { s.wallTex = url; }
      save(); return send(res, 200, { url, target: body.target });
    }
    const gp = p.match(/^\/api\/students\/([^/]+)\/group$/);
    if (gp) { if (!user || user.role !== "teacher") return send(res, 403, { error: "Teachers only" }); const st = db.users.find((x) => x.id === gp[1]); if (!st) return send(res, 404, { error: "Student not found" }); st.group = String(body.group || "").slice(0, 40); save(); return send(res, 200, publicUser(st)); }
    if (p === "/api/profile") { if (!user) return send(res, 401, { error: "Please log in" }); user.profile = { color: body.color || "#4a7bd0", skin: body.skin || "#d9a678", hair: body.hair || "#3a2a1a" }; save(); return send(res, 200, publicUser(user)); }
    const ub = p.match(/^\/api\/users\/([^/]+)\/block$/);
    if (ub) { if (!user || user.role !== "teacher") return send(res, 403, { error: "Teachers only" }); const t = db.users.find((x) => x.id === ub[1] && x.role === "student"); if (!t) return send(res, 404, { error: "Student not found" }); const hours = Math.max(0, Math.round(Number(body.hours) || 0)); t.blockedUntil = hours ? Date.now() + hours * 3600e3 : 0; save(); return send(res, 200, publicUser(t)); }
    return send(res, 404, { error: "Not found" });
  }

  if (m === "PUT") {
    const body = await readBody(req); const user = authUser(req);
    const sn = p.match(/^\/api\/sessions\/([^/]+)$/);
    if (sn) {
      const s = db.sessions.find((x) => x.id === sn[1]); if (!s) return send(res, 404, { error: "Gallery not found" });
      if (!user || s.owner !== user.id) return send(res, 403, { error: "Only the owner can edit" });
      if (typeof body.title === "string") s.title = body.title;
      if (typeof body.description === "string") s.description = body.description;
      if (typeof body.isPublished === "boolean") s.isPublished = body.isPublished;
      if (typeof body.time === "number") s.time = Math.max(0, Math.min(24, body.time));
      if (body.ceiling && typeof body.ceiling === "object") s.ceiling = { mode: String(body.ceiling.mode || "none"), y: Number(body.ceiling.y) || 10, color: String(body.ceiling.color || "#e8e6e1") };
      if (body.floor && typeof body.floor === "object") s.floor = { pattern: String(body.floor.pattern || "wood"), color: String(body.floor.color || "#8a5a2a"), image: (body.floor.image !== undefined ? body.floor.image : (s.floor && s.floor.image) || null) };
      if (body.perms) { const P = s.perms; ["canPlaceWalls", "canPlaceDecor", "canPlaceLabels", "canPlaceArtworks", "canDelete"].forEach((k) => { if (typeof body.perms[k] === "boolean") P[k] = body.perms[k]; }); }
      if (Array.isArray(body.members)) s.members = body.members.filter((id) => db.users.some((u) => u.id === id && u.role === "student"));
      save(); return send(res, 200, full(s));
    }
    const o2 = p.match(/^\/api\/sessions\/([^/]+)\/objects\/([^/]+)$/);
    if (o2) {
      const s = db.sessions.find((x) => x.id === o2[1]); if (!s) return send(res, 404, { error: "Gallery not found" });
      const obj = s.objects.find((o) => o.id === o2[2]); if (!obj) return send(res, 404, { error: "Object not found" });
      if (body.review && user && user.role === "teacher" && s.owner === user.id) { obj.review = { score: body.review.score, comment: String(body.review.comment || "").slice(0, 500) }; save(); return send(res, 200, obj); }
      const okO = user && user.role === "teacher" && s.owner === user.id, okS = canStudent(user, s, permForAction(obj.type));
      if (!okO && !okS) return send(res, 403, { error: "Forbidden" });
      ["pos", "rot", "scale", "text", "image", "type", "mat", "frame", "subtype", "open", "intensity", "color", "ltype"].forEach((k) => { if (body[k] !== undefined) obj[k] = body[k]; });
      save(); return send(res, 200, obj);
    }
    return send(res, 404, { error: "Not found" });
  }

  if (m === "DELETE") {
    const user = authUser(req);
    const du = p.match(/^\/api\/users\/([^/]+)$/);
    if (du) { if (!user || user.role !== "teacher") return send(res, 403, { error: "Teachers only" }); const t = db.users.find((x) => x.id === du[1] && x.role === "student"); if (!t) return send(res, 404, { error: "Student not found" }); db.users = db.users.filter((x) => x.id !== t.id); db.sessions.forEach((s) => { if (Array.isArray(s.members)) s.members = s.members.filter((m) => m !== t.id); }); save(); return send(res, 200, { ok: true }); }
    const o3 = p.match(/^\/api\/sessions\/([^/]+)\/objects\/([^/]+)$/);
    if (o3) { const s = db.sessions.find((x) => x.id === o3[1]); if (!s) return send(res, 404, { error: "Gallery not found" }); const obj = s.objects.find((o) => o.id === o3[2]); if (!obj) return send(res, 404, { error: "Object not found" }); const okO = user && user.role === "teacher" && s.owner === user.id, okS = user && user.role === "student" && s.members.includes(user.id) && !!s.perms.canDelete; if (!okO && !okS) return send(res, 403, { error: "Forbidden" }); s.objects = s.objects.filter((o) => o.id !== obj.id); save(); return send(res, 200, { ok: true }); }
    const s2 = p.match(/^\/api\/sessions\/([^/]+)$/);
    if (s2) { const s = db.sessions.find((x) => x.id === s2[1]); if (!s) return send(res, 404, { error: "Gallery not found" }); if (!user || s.owner !== user.id) return send(res, 403, { error: "Only the owner can delete" }); db.sessions = db.sessions.filter((x) => x.id !== s.id); save(); return send(res, 200, { ok: true }); }
    return send(res, 404, { error: "Not found" });
  }
  return send(res, 405, { error: "Method not allowed" });
}

load();
initSecrets();
http.createServer((req, res) => { handle(req, res).catch((e) => { try { send(res, 500, { error: "Server error" }); } catch (_) {} }); }).listen(PORT, () => {
  console.log("Curate Studio running: http://localhost:" + PORT);
  console.log("Teacher sign-up admin key: " + ADMIN_KEY + (process.env.CURATE_ADMIN_KEY ? "  (from CURATE_ADMIN_KEY)" : "  (stored in data.json → meta.adminKey)"));
  console.log("Local-only, never committed: data.json, data.json.bak, uploads/, .env");
});
