# Settlement Clash (prototype)

A 1v1 real-time settlement-building PvP game on a hex map. This is a
playable first-pass prototype of the core loop, running local
(hotseat-style) against a simple scripted AI opponent so it's
solo-testable. Real networked PvP is a separate future phase.

## Run it

```bash
npm install
npm run dev
```

Open the printed localhost URL in a landscape browser window (or a
phone rotated sideways — see below). You play the blue settlement
(left side); the red settlement (right) is the AI opponent.

Everything is click/tap only — there are no keyboard controls.

## Core loop implemented

- Gold income every 5s; build a **Farm** for food income, then a
  **Barracks** (needs gold + food) to train **Swordsmen** (needs gold
  + food, takes time).
- Tap any tile to see its terrain, movement/combat effect, and who
  controls it (yours / enemy / unoccupied). If it's yours and empty, a
  **Build** button lists what's buildable there — Farms only go on
  plains, Barracks go on plains or hills. Tap your own building to see
  its status, train troops, or repair it.
- **Territory isn't a fixed half of the map** — it's every tile with
  one of your buildings on it, plus that tile's immediate neighbors.
  You start able to build only around your castle, and each new
  building pushes your territory outward, so expansion has to be
  earned rather than assumed.
- Tap your own troop to open its action menu: **Move / Attack**,
  **Defend**, **Heal**, or **Intercept** (only shown when an enemy
  troop is actively marching toward one of your buildings).
- **Move / Attack puts you in control of the route**: tap adjacent
  tiles one at a time to trace the troop's path by hand (tap a tile
  already in the route to rewind to it). This is deliberate — it lets
  you pick a flanking route through a mountain pass or a river ford
  instead of always taking the shortest line, so invasions can be
  about picking a smart approach rather than pure front-line
  attrition. If your traced path ends next to an enemy building,
  confirming attacks it; otherwise it's just a reposition.
- Troops move in real time along the path you drew. Terrain affects
  movement speed and combat stats: plains (faster), forest/desert
  (slower, desert also weakens combat stats), hills (slower),
  rivers/lakes (impassable to ground troops, with the odd natural ford
  carved through), mountains (impassable to swordsmen, aside from the
  odd lone peak or ridge to route around).
- Pillaging an enemy building damages it and drains bonus gold/food to
  the attacker; destroying it scores a point. Destroying enemy troops
  scores 0.5. Destroying the enemy castle wins instantly; otherwise
  highest score wins when the 5-minute clock runs out. Constructing a
  building only scores 0.25 the first time you ever put up that
  building type (or when you rebuild one after every copy of that type
  was destroyed) — spamming extra farms doesn't farm points too.
- **Economy**: base income is 5 gold per 5s. Each active Barracks costs
  -2 gold per 5s to maintain, and each living Swordsman costs -1
  gold/-1 food per 5s — those upkeep costs and the base gold all
  resolve together on that shared 5s tick. Farms are different: each
  one ticks food on its own schedule, independent of the shared tick —
  a plain farm gives +2 food every 5s, but a farm built on plains next
  to a river or lake gives +3 food every 2.5s.
- **Castles defend themselves**: any enemy troop that wanders within 2
  tiles of a castle gets hit for 20 flat damage (ignoring defense) on
  a cooldown — comfortably a one-shot kill on a 20-HP Swordsman.
  Barracks fight back too: a non-siege unit pillaging one takes 4 flat
  damage per second, defense or not.

## Map

Each match generates a fresh randomized hex map: on each side, a
mirrored, procedurally generated territory with wandering mountain
ranges plus a few lone peaks, dense forest clusters plus stray trees,
a modest hills cluster, a long meandering river (with a couple of
natural fords), and a genuine lake (5+ contiguous water tiles) — no
fixed no-man's-land in the middle. Each castle sits a fixed 4 tiles in
from its side's map edge, with its row randomized (at least 4 tiles
from the top/bottom) each match, so it's a hub with room to build
around rather than backed into a corner in the same spot every game.
Generation always double-checks that a ground path exists between the
two castles and clears the nearest obstacle if a particular random map
would otherwise seal one side off.

## Mobile

The game renders at a fixed landscape aspect ratio and is scaled
(never stretched) to fit the viewport, the same way in a phone browser
as on a desktop. In portrait orientation it shows a "rotate your
device" prompt instead of trying to squeeze the map into a narrow
screen.

## Not yet built (intentionally out of scope for this pass)

- Real networked 1v1 (currently local + scripted AI)
- Siege units (the only thing that will ever be able to target a castle directly)
- Boats and bridges for crossing rivers
- Building-to-building synergy/debuff auras beyond the farm's
  water-adjacency bonus
- Castle attack upgrades (mentioned as a future hook, not built yet)
- Additional troop types, buildings, and a real balancing pass

## Project layout

- `src/game/` — engine-agnostic game logic: hex math (`hex.ts`),
  balance constants (`balance.ts`), map generation (`mapGen.ts`), A*
  pathfinding (`pathfinding.ts`), the core simulation (`GameState.ts`),
  and the scripted opponent (`AIController.ts`).
- `src/scenes/MainScene.ts` — Phaser rendering of the hex map,
  buildings, and troops.
- `src/scenes/art.ts` — the stylized-board-game rendering: gradient
  hex shading, per-terrain props (trees, peaks, ripples, wheat), and
  hand-drawn vector icons for buildings/troops. Deterministic per-tile
  randomness, so the same map always looks the same.
- `src/ui/UIController.ts` — DOM-based HUD and action menus.
