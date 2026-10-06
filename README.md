# Aura-XMD · BLAZE TECH

A multi-session WhatsApp bot built with [Baileys](https://github.com/WhiskeySockets/Baileys). It loads command plugins from `plugins/`, persists isolated user sessions in PostgreSQL, and reconnects after transient connection failures.

[![Deploy to Heroku](https://www.herokucdn.com/deploy/button.svg)](https://heroku.com/deploy?template=https://github.com/ARNOLDT20/Aura-XMD)

The Heroku button opens the official `app.json` template. It asks for `DATABASE_URL` and `SESSION_ENCRYPTION_KEY`; paste Render's **external** PostgreSQL URL if you want Heroku to use the same database. Never commit that URL.

## Requirements

- Node.js 20 or newer
- A WhatsApp account that can link another device
- Network access to WhatsApp Web

## Install and run

From the directory containing `package.json` and `index.js`:

```bash
npm install
npm start
```

Do not start `node index.js` directly on a new server. `npm start` runs a dependency check first and automatically runs `npm ci` from the lockfile when `node_modules/` is missing.

### Pterodactyl deployment

Upload the project files, including `package.json`, `package-lock.json`, `scripts/ensure-deps.js`, and `start.sh`. Do not upload an old or partial `node_modules/` directory. Configure the server as follows:

| Panel setting | Value |
| --- | --- |
| Startup command | `bash start.sh` |
| Install command | `npm ci --omit=dev --no-audit --no-fund` |
| Working directory | The directory containing `package.json` |
| Node image | Node.js 20 or newer |

If the panel has no separate install-command field, `bash start.sh` still installs missing dependencies automatically before starting the bot. The entrypoint also performs this check itself, so Katabump's default direct command `node index.js` is supported as well. If you use the startup command `npm start` instead, the same bootstrap runs through the `prestart` script. The server must have outbound HTTPS access so npm can reach the registry during the first boot.

### Heroku and other platforms

Aura-XMD is a persistent controller plus WhatsApp session service. The included `Procfile` starts one web process with `npm start`; that process also serves `/pair` and `/health`. The existing `start` script remains compatible with Katabump, Render, Railway, Fly.io, Docker, and generic Node hosts.

For Heroku, deploy the repository and use one web dyno. You can reuse the same Render database; do **not** provision a second Heroku Postgres add-on:

```bash
heroku create your-aura-xmd-app
heroku config:set PHONE_NUMBER=255700000000 PUBLIC_URL='https://your-aura-xmd-app.herokuapp.com' -a your-aura-xmd-app
heroku ps:scale web=1 -a your-aura-xmd-app
heroku logs --tail -a your-aura-xmd-app
```

After creating the Heroku app, set the **Render external PostgreSQL URL** as the Heroku config variable. Do this from your own terminal so the password never enters GitHub:

```bash
export RENDER_DATABASE_URL='postgresql://USER:PASSWORD@EXTERNAL_RENDER_HOST/auraxmd?sslmode=require'
heroku config:set DATABASE_URL="$RENDER_DATABASE_URL" -a your-aura-xmd-app
heroku config:set SESSION_ENCRYPTION_KEY="$(openssl rand -hex 32)" -a your-aura-xmd-app
```

Use the **external** URL from Render's database **Connect** menu. A Render internal URL works only for services running inside the same Render region; it will not work from Heroku. Never paste the database password into `app.json`, source code, or a public issue.

Alternatively, use the repository's `app.json` for Heroku app configuration. Do not put a session code in `app.json` or commit it to GitHub. Heroku dynos have ephemeral filesystems, so use PostgreSQL; a local `session/` directory alone is not durable there.

### Render: choose Web Service, not Static Site

Aura-XMD must be deployed as a **Render Web Service**. Do not choose **Static Site**: Static Sites cannot run Node.js, Baileys WebSockets, the persistent connection loop, or the `/pair` server.

1. In Render, choose **New + → Web Service** and connect `ARNOLDT20/Aura-XMD`.
2. Set the runtime to Node.js and use:

```text
Build command: npm ci --omit=dev --no-audit --no-fund
Start command: npm start
```

3. Create a Render PostgreSQL database in the same region.
4. Put the database's **Internal Database URL** into the Web Service's `DATABASE_URL` variable.
5. Add `SESSION_ENCRYPTION_KEY`, `PUBLIC_URL`, and optionally `PAIR_TOKEN`.
6. Deploy. Your pairing page will be `https://YOUR-SERVICE.onrender.com/pair`.

Use Render's **External Database URL** only when the bot runs outside Render, such as on Heroku. Do not run the Render and Heroku bot instances at the same time against the same database.

Platforms that support Docker can use the included `Dockerfile`; it installs Node.js, Python, FFmpeg, and npm dependencies without affecting the normal Node deployment:

```bash
docker build -t aura-xmd .
docker run --restart unless-stopped -e BLAZE_SESSION_ID='your-private-session-code' aura-xmd
```

For Render/Railway/Fly.io, use a persistent web/background service with Node.js 20+, install with `npm ci --omit=dev --no-audit --no-fund`, start with `npm start`, and set `DATABASE_URL`. The HTTP listener is included so the same process can expose the pairing link; it does not replace the WhatsApp WebSocket connection.

### Create the database — easiest setup

You do **not** need to create tables manually. Aura-XMD creates its `aura_sessions` table automatically on first boot.

#### Render

1. Open **Render Dashboard → New + → PostgreSQL**, or use the [Render Postgres creation page](https://dashboard.render.com/new/database).
2. Give it a name and select the **same region** as the Aura-XMD web service.
3. Create the database and open its **Connect** menu.
4. Copy the **internal database URL** into the Aura-XMD service environment variable named `DATABASE_URL`.
5. Add these environment variables to the Aura-XMD service:

```env
DATABASE_URL=the-render-internal-postgres-url
SESSION_ENCRYPTION_KEY=generate-a-long-random-secret
PUBLIC_URL=https://your-service.onrender.com
PAIR_TOKEN=choose-a-private-pair-token
```

6. Deploy or restart the service. Open `https://your-service.onrender.com/pair`.

Render recommends the internal URL when the service and database are in the same region. See the [official Render Postgres connection guide](https://render.com/docs/postgresql-creating-connecting).

#### Heroku with the same Render database

If you want Heroku to use the same Render database, skip Heroku Postgres provisioning. Create the Heroku app, then set the Render **external** URL:

```bash
heroku create your-aura-xmd-app
export RENDER_DATABASE_URL='postgresql://USER:PASSWORD@EXTERNAL_RENDER_HOST/auraxmd?sslmode=require'
heroku config:set DATABASE_URL="$RENDER_DATABASE_URL" -a your-aura-xmd-app
heroku config:set SESSION_ENCRYPTION_KEY="$(openssl rand -hex 32)" -a your-aura-xmd-app
heroku config:set PUBLIC_URL="https://your-aura-xmd-app.herokuapp.com" -a your-aura-xmd-app
heroku config:set PAIR_TOKEN="choose-a-private-pair-token" -a your-aura-xmd-app
heroku ps:scale web=1 -a your-aura-xmd-app
```

Heroku's app config stores `DATABASE_URL` securely and Aura-XMD creates its `aura_sessions` table automatically. If you prefer a separate Heroku database, provision one with the [official Heroku Postgres guide](https://devcenter.heroku.com/articles/provisioning-heroku-postgres) instead.

#### Any other host

Create a PostgreSQL database with that provider, copy its connection URL into `DATABASE_URL`, and set `SESSION_ENCRYPTION_KEY`, `PUBLIC_URL`, and optionally `PAIR_TOKEN`. Start Aura-XMD with:

```bash
npm ci --omit=dev --no-audit --no-fund
npm start
```

## Multi-number architecture and first connection

Aura-XMD runs one controller plus isolated user runtimes. Every linked number gets its own Baileys authentication files, command configuration, channel schedules, group settings, reconnect loop, and health state. One user's logout or reconnect does not replace another user's socket.

For production on Heroku, Render, Railway, or another ephemeral platform, set `DATABASE_URL` to PostgreSQL. Set a long random `SESSION_ENCRYPTION_KEY` too; Aura encrypts session JSON blobs before storing them in the database. Without `DATABASE_URL`, it uses `data/sessions.json` as a local development fallback; that fallback is not durable on Heroku/Render restarts.

The controller can create another isolated number from WhatsApp:

```text
.pair 255625606354
.pr 255625606354
```

The user enters the returned code at **WhatsApp → Linked devices → Link a device → Link with phone number instead**. Each paired number is restored automatically from PostgreSQL on the next deployment.

Pairing codes are short-lived and single-use. Generate a fresh code, enter it immediately, and use the exact digits-only number with country code (for example `255625606354`, not `+255 625 606 354`). Remove any old failed Aura-XMD entry from **WhatsApp → Linked devices** before retrying. Do not run two Aura-XMD deployments while pairing the same number.

The process also serves a browser pairing page at `/pair` and a JSON service check at `/health`. Set `PUBLIC_URL` to the public HTTPS app URL, then open:

```text
https://your-public-host.example/pair
```

## Owner dashboard

Aura-XMD includes a mobile-first owner dashboard at `/dashboard`. It is inspired by the supplied neon bot-console design but redesigned for Aura-XMD and BLAZE TECH. It shows:

- Live online, connecting, and offline session counts
- Every isolated WhatsApp runtime and linked account
- System uptime and automatic 10-second refresh
- Node.js version, platform, architecture, hostname, and memory use
- Loaded command and alias totals
- PostgreSQL versus local-fallback status
- Quick links to pairing, health, and the public portal

Protect it in production with a dashboard token:

```env
DASHBOARD_TOKEN=use-a-long-random-secret
```

Then open:

```text
https://your-public-host.example/dashboard?token=use-a-long-random-secret
```

If `DASHBOARD_TOKEN` is not set, Aura-XMD falls back to `PAIR_TOKEN`; in local development with neither token set, the dashboard is open. Never leave both unset on a public deployment. The dashboard never displays database passwords, session credentials, or auth blobs.

If the pairing page is public, set `PAIR_TOKEN` so only people with that secret can create sessions. The WhatsApp `.pair` command remains available through the linked controller account.

The first/controller number still needs one initial login. It can be paired with `PHONE_NUMBER`, or an existing `BLAZE_SESSION_ID` can be imported for migration. New user numbers do not need session IDs: they are created with `.pair` or the web form.

Existing single-session installs remain compatible: the controller continues using `session/`, and an existing `data/state.json` is migrated into the controller tenant on first startup.

## First connection

The bot uses a pairing code for a fresh installation. Set `PHONE_NUMBER` to the WhatsApp number being linked, including the country code and digits only; do not include `+`, spaces, parentheses, or hyphens.

Linux/macOS example:

```bash
PHONE_NUMBER=255700000000 OWNER_NAME=Arnold npm start
```

When the code appears in the console, open WhatsApp and choose **Linked devices → Link a device → Link with phone number instead**, then enter the code. After pairing, the credentials are saved under `session/`, so later restarts connect automatically without requesting another code.

For panels that provide an environment-variable screen, add `PHONE_NUMBER` there instead of placing it in source code. For multi-number production, use PostgreSQL and keep `DATABASE_URL` private. A local `session/` directory is still supported for the controller and single-server development, but it is not a replacement for a persistent database on ephemeral platforms.

## Configuration

The following environment variables are supported:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PHONE_NUMBER` | empty | First-run pairing number, digits only with country code |
| `BLAZE_SESSION_ID` | empty | Base64 BLAZE session code, optionally prefixed with `BLAZE~` |
| `BOT_NAME` | `Aura-XMD` | Name shown by the bot |
| `OWNER_NAME` | `Arnold` | Owner label used by `.alive` |
| `OWNER_NUMBER` | placeholder | Owner number label, digits only |
| `PREFIX` | `.` | Command prefix |
| `ALLOW_SELF_MESSAGES` | `false` | Set `true` to allow commands sent from the bot account for testing |
| `SEND_CONNECTION_MESSAGE` | `true` | Send a success message to the linked account when connected |
| `SESSION_FOLDER` | `session` | Authentication directory, resolved relative to the project |
| `DATABASE_URL` | empty | PostgreSQL URL for durable multi-session auth and state |
| `SESSION_ENCRYPTION_KEY` | empty | Encrypts auth blobs stored in PostgreSQL; strongly recommended |
| `PUBLIC_URL` | empty | Public URL shown in pairing instructions |
| `PAIR_TOKEN` | empty | Optional token protecting the web pairing form |
| `MAX_SESSIONS` | `0` | Maximum additional linked sessions; `0` means unlimited |
| `PORT` | `3000` | HTTP port for `/pair` and `/health` |
| `RECONNECT_DELAY_MS` | `5000` | Delay between transient reconnect attempts |
| `LOG_LEVEL` | `silent` | Pino log level; use `info` while diagnosing connection issues |

Never commit or publicly share `session/`; it contains the WhatsApp credentials. If credentials were exposed, unlink the device from WhatsApp and remove the session directory before pairing again.

### Import a BLAZE session code

For a session code generated by the BLAZE session tool, place the value in a private environment variable before starting the bot:

```bash
BLAZE_SESSION_ID='BLAZE~base64-session-value' npm start
```

On startup, the bot removes the optional `BLAZE~` prefix, decodes and validates the Base64 JSON, and writes it to `session/creds.json` before Baileys loads authentication. An existing `session/creds.json` is never overwritten unless `FORCE_SESSION_IMPORT=1` is also set. The session code is sensitive and must not be committed, logged, or pasted into chat. The imported `creds.json` alone may still require the matching Baileys key files generated by the session tool; if WhatsApp rejects the connection, use the tool's complete multi-file session export.

## Commands

- `.menu` — list commands
- `.ping` — check response
- `.alive` — show bot status
- `.health` / `.ht` — show connection, uptime, memory, session, command count, and reply latency
- `.pair <phone-number>` / `.pr` — create an isolated linked-number session

## Add a plugin

Create a JavaScript file in `plugins/` that exports `command` and `run`:

```js
module.exports = {
  command: "hello",
  async run({ reply }) {
    await reply("Hello!");
  }
};
```

Restart the bot after adding or changing plugins.

## Troubleshooting

- **`Cannot find module '@whiskeysockets/baileys'`:** run `npm install` in the same directory as `package.json` and `index.js`.
- **No pairing code:** set `PHONE_NUMBER` to digits only and restart after removing an incomplete `session/` directory.
- **Logged out:** stop the bot, remove `session/`, set `PHONE_NUMBER`, and pair again.
- **Repeated reconnects:** confirm the server allows outbound WebSocket connections and that the session directory is writable and persistent.
- **Another device replaced the connection:** close duplicate bot instances; the code intentionally does not reconnect after a connection is replaced.

When the bot connects, it sends a confirmation message to the linked account. Commands from the linked account are enabled by default so owner-only tools and self/group status commands work directly. Set `ALLOW_SELF_MESSAGES=false` if you explicitly want to disable self-command processing.

## Aura features

The bot sends a branded Aura image card when connected and `.menu` returns the same image with a categorized command caption. Use `.setname <name>` or `.aura name <name>` to change the persisted bot name.

### WhatsApp channels

Owner commands configure a channel by JID and can post immediately or on an interval:

```text
.channel set 120363000000000000@newsletter
.channel post Your announcement
.channel auto on 60 Your scheduled announcement
.channel auto off
.channel status
```

To discover a newsletter JID, open that newsletter and send `.channel jid`. The bot returns the exact `@newsletter` JID. You can then configure it from a private chat with `.channel set <jid>`, or configure it directly inside the newsletter with `.channel set here`. Newsletter self-messages now correctly resolve to the linked owner, so channel setup no longer incorrectly reports missing ownership. The process must remain online for auto-posting to run. The settings are saved in `data/state.json`.

Multiple recurring posts can be managed independently:

```text
.schedule add 60 Good morning from Aura-XMD
.schedule add 360 Remember to check today's update
.schedule list
.schedule pause 1
.schedule resume 1
.schedule remove 2
.schedule on
.schedule off
```

### Automatic post beautification

Channel text posts, scheduled posts, and status text are automatically wrapped in an Aura watermark header and a footer notice encouraging reactions and sharing. Image and video posts receive a visual watermark when FFmpeg supports the media type. To post channel media, reply to an image or video with:

```text
.channel media Optional caption
```

The owner can customize the branding:

```text
.brand watermark My Aura Channel
.brand notice React and share for more updates
.brand
```

### Status reactions

Status updates are reacted to automatically with a deterministic emoji selected from the configured set. Configure it with:

```text
.statusreact on
.statusreact off
.statusreact emojis ✨🔥💜🌟😊👏⚡
```

### Prefix, status posting, and media tools

The owner can change the command prefix at runtime. The new prefix is persisted across restarts:

```text
.prefix set !
!menu
```

Status posting supports a personal status or a group-targeted status. For media, reply to an image, video, or audio message:

```text
.addstatus self text Aura is online
.addstatus 120363000000000000@g.us text Group-only update
.addstatus self
```

The owner can retrieve quoted view-once media with `.viewonce` or `.vv`. Use this only for media you are authorized to access; the command requires replying to the original message.

Use `.help` or `.h` for a detailed, categorized guide showing every command and its usage. Reply to regular media with `.download`, `.media`, `.dl`, or `.sv` to retrieve it. View-once downloads remain owner-only.

### Plugin-based group moderation

All active moderation behavior remains in the plugin system. Group admins can enable `.antilink on`, configure `.badwords on`, add terms with `.badwords add <word>`, and issue tagged warnings with `.warn @user [reason]`. Warnings politely identify the violating member, explain that the content is prohibited, and send a playful BLAZE TECH chase sticker. Three manual warnings remove the member when Aura is an administrator. Administrators and the linked owner are exempt from automatic moderation.

### Free social-media downloader

The URL downloader uses the bundled open-source `yt-dlp` executable and needs **no API key, account, or paid service**. The package also uses the installed Node.js runtime for modern YouTube extraction and FFmpeg for merging video and audio.

Use the bot command for public links from YouTube, TikTok, Instagram, Facebook, X/Twitter, Pinterest, and other platforms supported by yt-dlp:

```text
.media https://www.tiktok.com/@user/video/123
.audio https://www.youtube.com/watch?v=example
.mp3 https://www.youtube.com/watch?v=example
.song Calm Down Rema
.music Faded Alan Walker
.play Believer Imagine Dragons
.video nature documentary
.download https://www.tiktok.com/@user/video/123
.download https://www.youtube.com/watch?v=example audio
.dl https://www.instagram.com/reel/example 720
```

The new `.media` command is a convenient general downloader. `.song`, `.music`, and `.play` search YouTube by name and return MP3 audio; `.video` searches by name and returns video. `.audio` and `.mp3` also search by name when no URL is supplied, while `.download <url> audio` remains supported. The plugin downloads media locally, sends it back to WhatsApp, and removes the temporary file afterward. Adding a number such as `720` requests a video quality ceiling. Availability depends on public source access, and WhatsApp uploads are limited to practical media sizes.

### Short aliases

Every command has a short alias, including `.p` for `.ping`, `.a` for `.alive`, `.m` for `.menu`, `.ch` for `.channel`, `.sch` for `.schedule`, `.al` for `.antilink`, `.sr` for `.statusreact`, `.vv` for `.viewonce`, `.md` for `.media`, `.au` for `.audio`, `.mp` for `.mp3`, `.mus` for `.music`, `.sg` for `.song`, `.pl` for `.play`, `.vid` for `.video`, and `.px` for `.prefix`. The full list is shown at the bottom of `.menu`.

For direct status posting, use `.selfstatus` or `.me` in any chat. In a group, use `.groupstatus` or `.gc`; reply to a media message to post that media to the group-targeted status:

```text
.selfstatus My personal update
.groupstatus Group-only update
.groupstatus
```

### Custom menu image and style

Reply to an image with `.menuimage set` to save it as the menu and connection image. Reset to the built-in Aura image with `.menuimage reset`. Available caption styles are:

```text
.menustyle aura
.menustyle minimal
.menustyle royal
.menustyle neon
```

The menu is organized vertically into readable sections. Use `.menu core`, `.menu channels`, `.menu groups`, `.menu status`, `.menu tools`, or `.menu` for all categories.

### Group administration

The bot must be a group administrator for moderation actions. Available commands include `.promote`, `.demote`, `.kick`, `.add`, `.mute`, `.unmute`, `.open`, `.close`, `.tagall`, `.groupinfo`, `.invite`, `.setsubject`, and `.setdesc`.

Antilink is configured separately for each group:

```text
.antilink on
.antilink off
.antilink
```

When enabled, non-admin links are removed and the group receives a warning. Keep `data/state.json` private because it contains channel and moderation settings.
