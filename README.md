# Curate Studio · 虚拟策展教学平台

A **Minecraft-scale, block-by-block virtual curation studio** for art & museum teaching.
Teachers create galleries ("sessions") that act as exhibition venues and control what each student may do; students build the gallery block by block, hang artworks, write wall labels, place display cases and lighting; guests browse published galleries read-only in their browser.

Built with **pure Node.js + Three.js, zero third-party dependencies** — you only need `node`.

> 中文简介：老师建立「展厅 / Session」作为策展场地并逐项控制学生权限；学生以 1 单位方块逐块盖展厅、挂画、贴标签、放展柜、调整昼夜光照、上传墙/地板贴图；访客无需登录即可只读浏览已发布的展厅。零第三方依赖，只需安装 Node.js。

---

## Quick start

```bash
cd curate
node server.js        # or double-click start.bat on Windows
```

Open **http://localhost:3000**.

- Teacher sign-up requires the **administrator key** — printed on the server console at startup
  (or set your own with `CURATE_ADMIN_KEY`, see *Configuration*).
- On a fresh database two demo accounts are seeded: `teacher` / `123` and `student` / `123`.
  Change those passwords, or set `CURATE_SEED_DEMO=0` to start with no accounts.

Data lives in `data.json`, uploaded images in `uploads/`. Both are created automatically and are **not** part of this repository.

---

## Configuration (no secrets in the code)

Copy `.env.example` to `.env` (gitignored) and edit:

| Variable | Meaning |
|---|---|
| `PORT` | HTTP port, default `3000` |
| `CURATE_ADMIN_KEY` | Key required to register a **teacher** account |
| `CURATE_SECRET` | HMAC secret used to sign login tokens (changing it logs everybody out) |
| `CURATE_SEED_DEMO` | `0` = don't create demo accounts on a fresh database |
| `CURATE_DEMO_TEACHER_PW` / `CURATE_DEMO_STUDENT_PW` | Passwords for the seeded demo accounts |

If `CURATE_ADMIN_KEY` / `CURATE_SECRET` are unset, random values are generated on first run and stored in `data.json` (`meta.adminKey`, `meta.serverSecret`) — so nothing secret ever lives in the source tree.

---

## Roles

| Role | Can do |
|---|---|
| Guest (not logged in) | Browse published galleries read-only; walk with `W A S D`, fly with `Space`/`Shift`, drag to look; hover small labels to read their text |
| Student | Log in, curate inside the galleries they were invited to, limited by the teacher's per-gallery permissions |
| Teacher | Create galleries, set student permissions (blocks / decor / labels / artworks / delete), manage members and groups, publish, share a link, review and score artworks |

---

## Controls

One unified **Controls** dock sits in the bottom-left corner; click its header to collapse it to a tray.
It also shows a live line for whatever you are aiming at (object name + the action available).

| Key | Action |
|---|---|
| `W A S D` | Walk |
| `Space` / `Shift` | Fly up / down · double-tap `Space` to land |
| Mouse drag | Look around |
| `E` | Place / use (with the current tool) |
| `F` | Interact: open a door, open a window, read a label |
| `Del` | Delete the aimed object |
| `M` | Move tool (grab the aimed object, aim elsewhere, `E` to drop) |
| `1`–`0` | Tools: Browse · Block · Case · Light · Furniture · Barrier · Artwork · Label · Delete · Move |

### Building features

- **Scale**: 1 block = 1 unit, player eye height 1.6 (true Minecraft proportions).
- **Blocks**: 12 procedural "real texture" materials (plaster, brick, wood, stone, concrete, glass, colour, metal, light block, grass, dark, white) plus your own uploaded wall texture.
- **Doors & windows**: aim at a wall block and the door/window takes its place — doors carve a **full-height (~2 m) opening** and swing, double, slide or fold open. Doors and windows each get their own material (wood / black / gold / white / metal / ornate).
- **Artworks**: upload a JPG/PNG, hang it on a wall face, resize it, and pick a frame (wood, black, gold, white, metal, ornate). Viewers can read the label text on hover.
- **Wall labels**: museum-style small cards with text baked onto the card; click one to edit its text and read its comments.
- **Display cases**: vitrine / museum / pedestal / closed box with adjustable length, height and depth, plus built-in case lighting.
- **Lighting & time**: spot / floor / downlight / pendant lights with intensity and colour, and a 0–24 h daylight slider that changes sky, sun and shadows live.
- **Floor & ceiling**: wood, chequer, stone, tile, concrete, grass or flat colour, or upload your own floor texture; optional ceiling (open, black, wood, metal, tile, colour).
- **Furniture & barriers**: chairs, tables, rugs, projectors, queue belts, crowd barriers, water barriers, caution signs.
- **Groups & collaboration**: student groups with "highlight group" filtering, in-gallery chat, and live collaborator avatars (you don't see yourself).
- **Sharing**: publish a gallery and hand out a `?session=<id>` link for read-only visitors.

---

## Project structure

```
curate/
  server.js          # zero-dependency backend: auth/roles, galleries, permissions,
                     # object CRUD, uploads, comments & grading, chat, presence, static files
  start.bat          # one-click Windows launcher (finds Node, opens the browser)
  package.json       # npm start → node server.js
  .env.example       # configuration template (copy to .env, which is gitignored)
  public/
    index.html       # page shell: HUD, toolbar, controls dock, modals
    style.css        # UI styling
    app.js           # Three.js gallery: building, tools, avatars, panels
  data.json          # runtime data        (gitignored, created on first run)
  uploads/           # uploaded images     (gitignored, created on first run)
```

---

## API overview

- Accounts: `POST /api/register`, `POST /api/login`, `POST /api/logout`, `GET /api/me`, `POST /api/profile`
- Galleries: `GET/POST /api/sessions`, `GET/PUT/DELETE /api/sessions/:id` (permissions, members, time, floor, ceiling)
- Objects: `POST /api/sessions/:id/objects`, `PUT/DELETE /api/sessions/:id/objects/:oid`
- Textures: `POST /api/sessions/:id/tex` (`target` = `wall` | `floor`)
- Social: `GET/POST /api/sessions/:id/chat`, `GET/POST /api/sessions/:id/presence`
- Images: `POST /api/upload` (data URL)
- Teachers only: `GET /api/users`, `DELETE /api/users/:id`, `POST /api/users/:id/block`, `POST /api/group`
- Guests: `GET /api/public/sessions`, `GET /api/public/sessions/:id`

Object types: `block`, `wall`, `artwork`, `label`, `case`, `light`, `door`, `window`, `vista`, `pedestal`, `chair`, `table`, `rug`, `projector`, `belt`, `barricade`, `waterbarrier`, `sign`.

---

## Security notes

- Login tokens are `userId.HMAC-SHA256(userId)` signed with `CURATE_SECRET`; they survive server restarts and nobody can forge one without the secret.
- Passwords are stored as `salt:scrypt` hashes, never in clear text.
- Teacher sign-up is gated by `CURATE_ADMIN_KEY`.
- This is a **teaching tool for local/LAN use**. It speaks plain HTTP and has no rate limiting, so put it behind a reverse proxy with TLS if you expose it to the internet, and change the demo passwords.

## License

Not specified yet — add a `LICENSE` file before publishing if you want others to reuse it.
