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
- Tap an empty tile in your territory to build; tap your own building
  to see its status, train troops, or repair it.
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
- Pillaging an enemy building damages it and drains bonus
  gold/food to the attacker; destroying it scores a point. Destroying
  enemy troops scores 0.5. Completing construction/repairs scores
  0.25. Destroying the enemy castle wins instantly; otherwise highest
  score wins when the 5-minute clock runs out.

## Map

Each match generates a fresh randomized hex map: a desert band down
the center, and on each side a mirrored, procedurally generated
territory with wandering mountain ranges plus a few lone peaks, dense
forest clusters plus stray trees, a modest hills cluster, a long
meandering river (with a couple of natural fords), and a genuine lake
(5+ contiguous water tiles). Each castle sits a few tiles in from the
map's edge — a hub with room to build around it — rather than backed
into the corner. Generation always double-checks that a ground path
exists between the two castles and clears the nearest obstacle if a
particular random map would otherwise seal one side off.

## Mobile

The game renders at a fixed landscape aspect ratio and is scaled
(never stretched) to fit the viewport, the same way in a phone browser
as on a desktop. In portrait orientation it shows a "rotate your
device" prompt instead of trying to squeeze the map into a narrow
screen.

## Not yet built (intentionally out of scope for this pass)

- Real networked 1v1 (currently local + scripted AI)
- Siege units / castle-only targeting
- Boats and bridges for crossing rivers
- Per-building terrain buffs/debuffs and building-to-building synergy
  bonuses
- Additional troop types, buildings, and balancing pass

## Project layout

- `src/game/` — engine-agnostic game logic: hex math (`hex.ts`),
  balance constants (`balance.ts`), map generation (`mapGen.ts`), A*
  pathfinding (`pathfinding.ts`), the core simulation (`GameState.ts`),
  and the scripted opponent (`AIController.ts`).
- `src/scenes/MainScene.ts` — Phaser rendering of the hex map,
  buildings, and troops.
- `src/ui/UIController.ts` — DOM-based HUD and action menus.
