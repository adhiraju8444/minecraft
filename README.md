# Blockforge

A voxel survival sandbox that runs in the browser: explore an endless generated world, mine, craft, build, farm, and survive the night — alone, or with friends on a shared multiplayer server that is built into the game.

Blockforge is a fan-made game inspired by classic block-building survival games. It is not affiliated with Mojang or Microsoft. Every texture, model, sound and piece of music is generated in code, so the game ships with no third-party game assets.

## Play

You need [Node.js](https://nodejs.org) 18 or newer.

```sh
npm install
npm start            # game + multiplayer server on http://localhost:8080
```

Open <http://localhost:8080>. **Singleplayer** worlds are saved in your browser; **Multiplayer** joins the shared world on the server the page came from. A browser with WebGL 2 is required (current Chrome, Edge, Firefox or Safari).

**To play with friends over the internet for free**, run `npm run online` instead (or double-click `start-windows.bat` / `start-mac.command`): it prints a public link to share. See [Put it online for free](#put-it-online-for-free).

For single-player only, the game is also a plain static site with no build step: serve the folder with any web server (`npm run static`, `python3 -m http.server 8080`, GitHub Pages, Netlify, Vercel...). ES modules and web workers do not load from `file://`.

## Controls

| Action | Key |
| --- | --- |
| Move | W A S D |
| Jump / swim up / fly up | Space |
| Sneak (won't fall off edges) / fly down | Left Shift |
| Sprint | Left Ctrl, or double-tap W |
| Mine / attack | Left mouse (hold to mine) |
| Place / use / eat / draw bow | Right mouse |
| Pick block | Middle mouse |
| Hotbar | 1–9 or mouse wheel |
| Inventory | E |
| Drop item (Ctrl drops the stack) | Q |
| Chat / command | T / `/` |
| Players online (multiplayer) | Tab (hold) |
| Camera view (first, behind, front) | F5 |
| Debug info | F3 |
| Switch game mode (operators, and single-player worlds that are not Hardcore) | F3 + F4 |
| Hide HUD / screenshot | F1 / F2 |
| Pause | Esc |

Keys can be rebound under Options → Controls.

On phones and tablets an on-screen stick and buttons appear: drag anywhere on the screen to turn the first-person camera left, right, up and down (you can walk with the stick and look with your other thumb at the same time), tap to use or place, and hold still to mine. Sensitivity and Invert Look in Options apply to touch too. **Sprint** and **Sneak** stay on until tapped again, **Drop** drops one item (hold it for the whole stack), **Chat** opens the keyboard, and **Fn** shows the function keys: Mode (F3+F4), Command (`/`), Players (Tab, in multiplayer), Pick block, Camera (F5), Info (F3), HUD (F1) and Photo (F2). Inventory screens get **✕** to close, **Quick Move** (works like shift-click) and **Split** (works like right-click).

**Fullscreen**: the title screen has a Fullscreen button, and Options has a Fullscreen switch for use mid-game. On Android phones it also locks the screen sideways where the browser allows it. iPhones do not let web pages go full screen; there, tap Share → **Add to Home Screen** and start Blockforge from the new icon, which opens full screen. Worlds saved in the browser are not shared with the home-screen app.

Inventory screens support click to pick up or place, right-click to split or place one, shift-click to move a stack, drag to spread items over slots, double-click to gather, and number keys to swap with the hotbar. Every crafting grid has a recipe list; click a recipe to fill the grid from your inventory.

## Features

- **World**: endless seeded terrain with oceans, beaches, rivers, plains, forests, birch forests, taiga, snowy plains, deserts, swamps and snow-capped mountains; caves, lava lakes, coal, iron, gold, lapis and diamond ores, granite, diorite and andesite; trees, flowers, tall grass, sugar cane, cacti and pumpkins.
- **Lighting**: sky light and block light propagate per block, with smooth lighting and ambient occlusion, a day/night cycle with sunrise and sunset colours, stars, a moon, drifting clouds, and rain or snow depending on biome.
- **Survival**: health, hunger with saturation and exhaustion, breath under water, fall, fire, lava, cactus, drowning and suffocation damage, armor, experience levels, death with dropped items, respawning at your bed.
- **Blocks and items**: 109 blocks and over 200 items, tool tiers (wood, stone, iron, gold, diamond) with mining speeds and durability, 135 crafting recipes and 20 furnace recipes, chests, doors, fence gates, ladders, slabs, stairs, beds that skip the night, TNT, flint and steel, buckets of water, lava and milk, bows and arrows.
- **Living world**: flowing water and lava (lava meeting water makes obsidian or cobblestone), falling sand and gravel, spreading fire, growing crops, saplings, sugar cane and cacti, grass spread, leaf decay, farmland that needs water, ice that melts near light.
- **Creatures**: pigs, cows, sheep (shear and dye them) and chickens (they lay eggs) that wander, panic, follow food and breed; zombies, skeletons that shoot arrows and wall-climbing spiders that come out in the dark, with pathfinding and burning in daylight.
- **Modes**: Survival, Creative (flying, instant breaking, a searchable item palette) and Hardcore, plus Spectator through commands; four difficulty levels.
- **Commands**: `/help`, `/gamemode`, `/time`, `/weather`, `/give`, `/tp`, `/summon`, `/kill`, `/seed`, `/difficulty`, `/clear`, `/spawnpoint`, `/setworldspawn`, `/gamerule`, `/xp`, `/heal`, `/setblock`, `/locate`, with Tab completion.
- **Saving**: worlds save to IndexedDB automatically every 30 seconds and when you pause or quit. Several worlds can be kept side by side.
- **Multiplayer**: one shared world per server for you and your friends — see below.
- **Sound**: all effects are synthesised with Web Audio, positioned in stereo, and background music is composed procedurally while you play.

### Not included

Other dimensions, redstone, enchanting, brewing, villages and other structures, boats and minecarts.

## Multiplayer

`npm start` runs one program that does two jobs: it serves the game's web page, and it runs **one shared world** that everyone who opens that page can join. There are no accounts or logins — players just pick a name.

### Playing

1. Start the server (`npm install`, then `npm start`) on the computer that will host the world.
2. Everyone opens the server's address in a browser, clicks **Multiplayer**, types a name and clicks **Join Server**. When the page came from the server itself, the address box can stay empty.
3. Chat with **T**, hold **Tab** to see who is online, and type `/help` for commands. On a phone, use the **Chat** and **Fn** buttons.
4. The first player to join becomes the server's operator (admin), whatever the game mode. Operators switch between Survival, Creative and Spectator with **F3+F4** (**Fn → Mode** on a phone) or `/gamemode`.

The first time a name joins a server, the browser stores a secret key for that server, so nobody else can play as that name there later (each server gets its own key, so one server can never pass your key to another). Names ignore capitals, spaces and underscores: "Bob Smith" and "bob_smith" are the same player. Playing from another browser or device means picking a different name.

### Put it online for free

Free hosting changes often; this was checked against the providers' own documentation in October 2026.

**1. From your own computer — free, no sign-up, the world stays on your computer (recommended)**

1. Install [Node.js](https://nodejs.org) (the LTS version).
2. Download this project (on GitHub: **Code → Download ZIP**) and unzip it.
3. Start it:
   - **Windows**: double-click `start-windows.bat`
   - **Mac**: right-click `start-mac.command` → **Open** (the first time; double-click after that)
   - **Linux** or a terminal: `npm install`, then `npm run online`
4. After a moment a box appears: **"Your game is online! Send this link to your friends"** with an address like `https://some-random-words.trycloudflare.com`. Friends open it, click **Multiplayer**, type a name and join.
5. Press **Ctrl+C** in that window to save and stop. The world is in the `data` folder — copy it now and then as a backup.

How it works: the program starts the server and opens a free [Cloudflare Quick Tunnel](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/) (Cloudflare's official `cloudflared` program is downloaded once into `.tools/`). No Cloudflare account is needed and WebSockets work through it. Catches: the game is online only while your computer is on and the window is open (turn off sleep while hosting); the link changes every time you start it; Cloudflare offers quick tunnels without an uptime guarantee; ~70 KB/s of upload is needed for 10 players. Friends on the same Wi-Fi can also use the local address the server prints (e.g. `http://192.168.1.20:8080`).

**2. Online without your computer — free plans with their limits**

- **Railway free plan** (no card; the world is kept on a small disk, but the server sleeps when nobody plays):
  1. Sign in at [railway.com](https://railway.com) with GitHub, then **New Project → Deploy from GitHub repo** and pick this repository (it builds the included `Dockerfile`).
  2. In the service's **Variables**, add `DATA_DIR=/data`, `TRUST_PROXY=true` and `RAILWAY_RUN_UID=0` (needed so the server can write to the disk).
  3. Add a **Volume** mounted at `/data`.
  4. **Settings → Networking → Generate Domain** (port 8080), and turn on **Serverless** under Settings → Deploy. Share the `….up.railway.app` address.

  Catches: after the 30-day trial the free plan gives $1 of usage a month — roughly 150 hours of play for 3–4 friends — and the server stops when it runs out; the first visit after it slept may need a page reload; Railway staff say free-plan deploys only run outside 08:00–20:00 local time.
- **Oracle Cloud Always Free** (runs 24/7 and keeps the world, but needs a credit card for sign-up and some Linux skills): create an Ubuntu VM, open ports 80/443, install Node.js, run `npm ci --omit=dev` and the server as a systemd service with `DATA_DIR` and `TRUST_PROXY=true`, and put [Caddy](https://caddyserver.com) in front for https. Oracle may reclaim free VMs that stay mostly idle for a week.
- **Not suitable for the multiplayer server**: Render's free plan wipes files whenever it sleeps (the world would reset), Fly.io and Koyeb no longer have free plans for new users, Heroku has no free plan, Glitch stopped hosting, Hugging Face Docker Spaces need a paid plan, and **Vercel, Netlify and GitHub Pages only host web pages** — they cannot run a long-running server with WebSockets and a saved world.

**3. The game page only (single-player) — free**

Any static host works. With **GitHub Pages**: on the repository, **Settings → Pages → Deploy from a branch**, pick the branch and `/ (root)`, and save; the game appears at `https://<user>.github.io/<repo>/`. From such a page, players can still join a multiplayer server by typing its https address in the Multiplayer screen.

**Paid but simple** (a few dollars a month, always on, world kept): Render with the included `render.yaml` (adds a disk), Railway's paid plan, Fly.io with a volume, or any VPS with the `Dockerfile` (`docker run -p 8080:8080 -v blockforge-world:/data blockforge`).

### Settings

The server is configured with environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8080` | Port to listen on |
| `DATA_DIR` | `./data` | Where the world, players and lists are saved |
| `SERVER_NAME` | `Blockforge Server` | Shown in the Multiplayer screen and player list |
| `MOTD` | `A world for friends` | Message shown under the server name |
| `WORLD_NAME` | `Shared World` | Name of the world (used when it is first created) |
| `SEED` | random | World seed (used when the world is first created) |
| `GAMEMODE` | `survival` | Game mode for new players: `survival` or `creative` |
| `DIFFICULTY` | `normal` | `peaceful`, `easy`, `normal` or `hard` (when the world is first created) |
| `MAX_PLAYERS` | `10` | Players allowed at once |
| `PASSWORD` | none | If set, players must enter it to join |
| `PVP` | `true` | Whether players can hurt each other |
| `OPS` | none | Comma-separated names that are operators (admins) |
| `AUTO_OP` | `true` | The first player to join a world that has no operators becomes one. This happens once per world, so a later `deop` sticks |
| `VIEW_DISTANCE` | `10` | Largest view distance (in chunks) the server supports |
| `SIM_DISTANCE` | `5` | Chunks around each player where the world is alive (mobs, crops, water) |
| `AUTOSAVE_SECONDS` | `60` | How often the world is saved |
| `MAX_CONNECTIONS_PER_IP` | `4` | Connections allowed from one address |
| `TRUST_PROXY` | `false` | Set to `true` only behind a reverse proxy or tunnel, so player addresses (for bans and limits) come from its `X-Forwarded-For` header. `npm run online` and `render.yaml` turn it on |
| `TICK_WHEN_EMPTY` | `false` | Keep the world running (time, furnaces, crops) when nobody is online |

### Admin commands

Operators can use `/gamemode`, `/time`, `/weather`, `/give`, `/tp`, `/summon`, `/difficulty`, `/gamerule`, `/setblock`, `/kick`, `/ban`, `/ban-ip`, `/pardon`, `/op`, `/deop`, `/say`, `/save` and `/status`; everyone can use `/list`, `/msg`, `/me`, `/seed` and `/kill`. The same commands can be typed into the server's console without the slash (for example `op Alex`). Press Ctrl+C in the console to save and stop the server.

### How it works, and its limits

- The server runs the world at 20 ticks per second: block updates, water and lava, crops, furnaces and chests, mobs and their AI, dropped items, arrows, TNT, time and weather. Each browser still moves its own player and generates untouched terrain from the world seed itself, so only chunks that players have changed are downloaded.
- Only changed chunks are saved (a few KB each, compressed), so a world that friends build in for months usually takes tens of megabytes. Back it up by copying `DATA_DIR` while the server is stopped.
- A player uses only a few KB/s of bandwidth (about 1–2 KB/s with two players; about 7 KB/s each with ten players standing together), plus a short burst when loading areas that others have built in (about 2 KB per changed chunk). Server work is light — around 1 ms of each 50 ms tick with two players exploring — so one small server comfortably handles a group of friends; the default limit is 10 players. Type `status` in the server console to see load, ping and bandwidth.
- Players' browsers are trusted with their own movement, health and inventory, which keeps the game smooth but means a determined player could cheat by editing the game in their browser. The server checks reach, rates and item data, and operators can kick and ban — fine for friends, not for strangers. Set `PASSWORD` if the server is public.

## Project layout

```
index.html, css/style.css   page and UI styles
js/main.js                  game controller: states, loop, saving, world events
js/data/                    block, item and recipe definitions
js/world/                   generation (in a worker), chunks, lighting, fluids, block rules, physics
js/gfx/                     Three.js renderer, chunk mesher, shaders, sky, particles, models, item icons
js/entity/                  entities, creatures, pathfinding, spawning
js/game/                    player, inventory, interaction rules, commands
js/ui/                      menus, HUD, inventory screens, touch controls
js/audio/                   synthesised sound effects and generative music
js/storage/                 IndexedDB saves
js/net/                     multiplayer: wire protocol, connection, other players and mobs
server/                     multiplayer server: web server, WebSocket, world simulation, saving, commands
server/online.js            npm run online: the server plus a free public link (Cloudflare quick tunnel)
start-windows.bat, start-mac.command   double-click launchers for npm run online
tools/                      dev scripts: art and map previews, browser tests
vendor/three.module.min.js  Three.js r160 (MIT)
```

## Development

- `node tools/preview-art.mjs art.png` renders every texture and item sprite to a sheet.
- `node tools/preview-map.mjs <seed> <radius> map.png` renders a top-down terrain map.
- `npm test` (with the server running and Playwright installed) plays through core mechanics in headless Chromium: movement speed, jumping, crafting, water flow, lava and water, falling sand, smelting, mining, TNT, fall damage, sleeping, and saving and reloading a world.
- `npm run test:server` starts a server with an empty world and checks the network protocol with two scripted players, including who becomes an operator.
- `npm run test:multiplayer` starts a server and has two browsers play together: seeing each other move, building, chat, item drops and pickups, chests, furnaces, mobs, PvP, death and respawn, a server restart, and name protection.
- `npm run test:touch` plays on an emulated phone: Fullscreen, looking around by dragging (both axes, and while walking), every on-screen button and function key, game mode switching, the inventory's Quick Move, Split and close buttons, and chat, then joins a fresh server as its first player and operator.

## Credits

Rendering uses Three.js r160, © three.js authors, MIT licensed (see `vendor/THREE_LICENSE`). The UI font, Pixelify Sans, loads from Google Fonts; the game falls back to a system font offline.
