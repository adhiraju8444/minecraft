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
| Hide HUD / screenshot | F1 / F2 |
| Pause | Esc |

Keys can be rebound under Options → Controls. On phones and tablets an on-screen stick and buttons appear: drag to look, tap to use, and hold to mine.

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
3. Chat with **T**, hold **Tab** to see who is online, and type `/help` for commands.

The first time a name joins, the browser stores a secret key for it, so nobody else can play as that name on the server later. Playing from another browser or device means picking a different name (or copying the `blockforge.playerKey` value from the old browser's local storage).

### Who can join

- **Same Wi-Fi / LAN**: the server prints addresses such as `http://192.168.1.20:8080` when it starts. Friends on the same network open that.
- **Over the internet, from your own computer**: either forward port 8080 on your router to the computer, or run a tunnel such as [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) (`cloudflared tunnel --url http://localhost:8080`) or ngrok, and share the https address it gives you. The world lives on your computer and is online while the server runs.
- **On a hosting service, online all the time**: deploy it as a Node.js web service that supports WebSockets and has a **persistent disk** (the world is saved to files). Point `DATA_DIR` at the disk.
  - **Railway / Fly.io / any Docker host**: use the included `Dockerfile` and mount a volume at `/data`.
  - **Render**: the included `render.yaml` sets up a web service with a disk (disks need a paid instance; without one the world is wiped on every restart or deploy).
  - **A small VPS**: `npm install && npm start`, ideally behind a reverse proxy (Caddy or nginx) for https, and kept running with systemd or pm2.

**Vercel, Netlify and GitHub Pages cannot run the multiplayer server**: they only serve web pages and short-lived functions, not a long-running program with a WebSocket connection and a saved world. You can still put the game page there and run the server somewhere else — players then type the server's address in the Multiplayer screen (use an https/wss server address, because browsers block insecure connections from https pages).

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
| `AUTO_OP` | `true` | With no operators yet, the first player to join becomes one |
| `VIEW_DISTANCE` | `10` | Largest view distance (in chunks) the server supports |
| `SIM_DISTANCE` | `5` | Chunks around each player where the world is alive (mobs, crops, water) |
| `AUTOSAVE_SECONDS` | `60` | How often the world is saved |
| `MAX_CONNECTIONS_PER_IP` | `4` | Connections allowed from one address |
| `TICK_WHEN_EMPTY` | `false` | Keep the world running (time, furnaces, crops) when nobody is online |

### Admin commands

Operators can use `/gamemode`, `/time`, `/weather`, `/give`, `/tp`, `/summon`, `/difficulty`, `/gamerule`, `/setblock`, `/kick`, `/ban`, `/ban-ip`, `/pardon`, `/op`, `/deop`, `/say`, `/save` and `/status`; everyone can use `/list`, `/msg`, `/me`, `/seed` and `/kill`. The same commands can be typed into the server's console without the slash (for example `op Alex`). Press Ctrl+C in the console to save and stop the server.

### How it works, and its limits

- The server runs the world at 20 ticks per second: block updates, water and lava, crops, furnaces and chests, mobs and their AI, dropped items, arrows, TNT, time and weather. Each browser still moves its own player and generates untouched terrain from the world seed itself, so only chunks that players have changed are downloaded.
- Only changed chunks are saved (a few KB each, compressed), so a world that friends build in for months usually takes tens of megabytes. Back it up by copying `DATA_DIR` while the server is stopped.
- A player uses only a few KB/s of bandwidth (about 1–2 KB/s for movement, mobs and chat in testing), plus a short burst when loading areas that others have built in (about 2 KB per changed chunk). Server work is light — around 1 ms of each 50 ms tick with two players exploring — so one small server comfortably handles a group of friends; the default limit is 10 players. Type `status` in the server console to see load, ping and bandwidth.
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
tools/                      dev scripts: art and map previews, browser tests
vendor/three.module.min.js  Three.js r160 (MIT)
```

## Development

- `node tools/preview-art.mjs art.png` renders every texture and item sprite to a sheet.
- `node tools/preview-map.mjs <seed> <radius> map.png` renders a top-down terrain map.
- `npm test` (with the server running and Playwright installed) plays through core mechanics in headless Chromium: movement speed, jumping, crafting, water flow, lava and water, falling sand, smelting, mining, TNT, fall damage, sleeping, and saving and reloading a world.
- `npm run test:server` starts a server with an empty world and checks the network protocol with two scripted players.
- `npm run test:multiplayer` starts a server and has two browsers play together: seeing each other move, building, chat, item drops and pickups, chests, furnaces, mobs, PvP, death and respawn, a server restart, and name protection.

## Credits

Rendering uses Three.js r160, © three.js authors, MIT licensed (see `vendor/THREE_LICENSE`). The UI font, Pixelify Sans, loads from Google Fonts; the game falls back to a system font offline.
