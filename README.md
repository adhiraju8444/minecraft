# Blockforge

A voxel survival sandbox that runs in the browser: explore an endless generated world, mine, craft, build, farm, and survive the night.

Blockforge is a fan-made game inspired by classic block-building survival games. It is not affiliated with Mojang or Microsoft. Every texture, model, sound and piece of music is generated in code, so the game ships with no third-party game assets.

## Play

The game is a static site with no build step. Serve the folder over HTTP (ES modules and web workers do not load from `file://`):

```sh
npm start            # serves on http://localhost:8080
# or
python3 -m http.server 8080
```

Then open <http://localhost:8080>. Any static host (GitHub Pages, Netlify, an S3 bucket) works the same way. A browser with WebGL 2 is required (current Chrome, Edge, Firefox or Safari).

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
- **Sound**: all effects are synthesised with Web Audio, positioned in stereo, and background music is composed procedurally while you play.

### Not included

Multiplayer, other dimensions, redstone, enchanting, brewing, villages and other structures, boats and minecarts.

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
tools/                      dev scripts: art and map previews, browser tests
vendor/three.module.min.js  Three.js r160 (MIT)
```

## Development

- `node tools/preview-art.mjs art.png` renders every texture and item sprite to a sheet.
- `node tools/preview-map.mjs <seed> <radius> map.png` renders a top-down terrain map.
- `node tools/test-browser.mjs` (with the server running and Playwright installed) plays through core mechanics in headless Chromium: movement speed, jumping, crafting, water flow, lava and water, falling sand, smelting, mining, TNT, fall damage, sleeping, and saving and reloading a world.

## Credits

Rendering uses Three.js r160, © three.js authors, MIT licensed (see `vendor/THREE_LICENSE`). The UI font, Pixelify Sans, loads from Google Fonts; the game falls back to a system font offline.
