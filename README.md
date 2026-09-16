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

- Five resources: **Gold** (base +5/5s), **Food**, **Straw**, **Wood**,
  and **Stone**. Each resource resolves its own upkeep on its own
  cadence — Gold every 5s, Food/Straw every 3s, Wood every 8s, Stone
  every 6s — while each building produces on its own instance-specific
  interval. The game clock is real-time 1:1 — the 5-minute match timer
  is five real minutes, not an abstracted "game time."
- **If you can't cover a resource's upkeep tick even from a full
  reserve, that resource starts destroying its own consumers** —
  troops first, then buildings — one at a time until the shortfall
  clears. The HUD flags this before it happens: a resource's stored
  amount and its net rate turn red the moment its rate goes negative,
  so you can see a shortfall coming.
- Tap any tile to see its terrain, movement/combat effect, and who
  controls it (yours / enemy / unoccupied). If it's yours and empty, a
  **Build** button lists what's buildable there, filtered by terrain
  and adjacency, each with its full resource cost. Tap your own
  building to see its status, live production, train troops, repair
  it, or read its **Special Trait**.
- **Territory isn't a fixed half of the map** — it's every tile with
  one of your buildings on it, plus that tile's immediate neighbors.
  You start able to build only around your castle, and each new
  building pushes your territory outward, so expansion has to be
  earned rather than assumed.
- Tap your own troop to open its action menu: **Move / Attack**,
  **Defend**, **Heal**, or **Intercept** (only shown when an enemy
  troop is actively marching toward one of your buildings). Its panel
  also shows a **Special Trait** box when it has one.
- **Move / Attack puts you in control of the route**: tap adjacent
  tiles one at a time to trace the troop's path by hand (tap a tile
  already in the route to rewind to it). This is deliberate — it lets
  you pick a flanking route through a mountain pass or a river ford
  instead of always taking the shortest line, so invasions can be
  about picking a smart approach rather than pure front-line
  attrition. If your traced path ends next to an enemy building,
  confirming attacks it (troops that can't attack buildings, like the
  Archer, are blocked from confirming this); otherwise it's just a
  reposition.
- Troops move in real time along the path you drew. Terrain affects
  movement speed and combat stats: plains (faster), forest (slower),
  hills (slower — unless your own House sits on that hills tile, which
  cancels the penalty for you while doubling it for nearby enemies),
  rivers/lakes (impassable to ground troops, with the odd natural ford
  carved through), mountains (impassable to ground troops, aside from
  the odd lone peak or ridge to route around).
- **Defend** doubles a troop's defense and roots it in place until you
  move it, attack, or it dies — it survives a combat engagement intact
  instead of being overridden. Archers rely on it: they can strike at
  range 2 at any time, but can't fight an adjacent enemy unless
  they're defending.
- Pillaging an enemy building damages it and drains bonus gold/food to
  the attacker; destroying it scores a point. Destroying enemy troops
  scores 0.5. Destroying the enemy castle wins instantly; otherwise
  highest score wins when the 5-minute clock runs out. Constructing a
  building only scores 0.25 the very first time you ever put up that
  building type — extra copies don't score, and neither does
  rebuilding one after it's destroyed (rebuilding is just cheaper/
  faster, not a repeated point).
- **Rebuilding is discounted**: if every standing copy of a building
  type has been destroyed, putting up a new one takes 3s off that
  type's normal build time (e.g. a Farm rebuilds in 2s instead of 5s).
  Building an additional copy while one is still standing doesn't get
  the discount.
- **Castles defend themselves**: any enemy troop that wanders within 2
  tiles of a castle gets hit for 20 flat damage (ignoring defense) on
  a cooldown. Barracks fight back too: a non-siege unit pillaging one
  takes 4 flat damage per second, defense or not.

### Buildings

| Building | Built on | Cost | Produces | Notes |
| --- | --- | --- | --- | --- |
| Farm | Plains | Gold only, escalating per lifetime build (10, 12, 16, 22, ...) | 2 food + 5 straw / 3s (4 + 8 near a river/lake) | Unlocks the Barracks |
| Barracks | Plains/Hills | 25 gold + 25 straw | Trains troops | Only one active/constructing at a time; trains 3s faster next to a Farm |
| Lumber Mill | Plains/Hills, adjacent to Forest | 30 gold + 35 straw | 2 wood per adjacent Forest tile / 8s | Unlocks the Archer once active |
| Quarry | Hills, adjacent to Mountains | 20 gold + 30 wood + 40 straw | 1 stone per adjacent Mountain tile / 6s | |
| Fisher's Hut | Plains/Hills, adjacent to river/lake | 20 gold + 50 wood + 30 straw | 3 gold / 5s | +2 food to any directly adjacent Farm |
| House | Anywhere except river/lake/mountains | 20 wood + 30 stone + 40 straw | 1 gold / 5s | Trait depends on the tile it sits on (see its in-game Special Trait box) |

### Troops

| Troop | Cost | Stats | Notes |
| --- | --- | --- | --- |
| Militia | 2 gold + 2 food | 5 atk / 5 def / 10 hp | Melee, can attack buildings |
| Archer | 4 gold + 2 food + 5 wood | 10 atk / 7 def / 15 hp | Requires active wood production; strikes at range 2 always, needs Defend to fight adjacent; can't attack buildings |

## Map

Each match generates a fresh randomized hex map: each side gets its
own independently generated territory (not mirrored) with wandering
mountain ranges plus a few lone peaks, dense forest clusters plus
stray trees, a modest hills cluster, a long meandering river (with a
couple of natural fords), and a genuine lake (5+ contiguous water
tiles) — no fixed no-man's-land in the middle. Each castle sits a
fixed 4 tiles in from its side's map edge, with its row rolled
independently (at least 4 tiles from the top/bottom) each match, so
the two castles don't always line up parallel to each other and each
side's terrain grows around its own castle position. Generation always
double-checks that a ground path exists between the two castles and
clears the nearest obstacle if a particular random map would otherwise
seal one side off.

## Mobile / desktop

The game renders at a fixed landscape aspect ratio and is scaled
(never stretched) to fit its viewport. It auto-detects touch/coarse
pointer input to guess mobile vs. desktop on first load, and a small
corner button (bottom-right, labeled with whichever mode you'd switch
*to*) lets you override that — the choice persists across reloads.
**Mobile mode** goes edge-to-edge like a phone app and shows a "rotate
your device" prompt in portrait. **Desktop mode** presents the game as
a centered, shadowed panel against a dark background instead of
bleeding to the browser window's edges, and never nags about
orientation (nobody rotates a monitor).

## Not yet built (intentionally out of scope for this pass)

- Real networked 1v1 (currently local + scripted AI)
- Siege units (the only thing that will ever be able to target a castle directly)
- Boats and bridges for crossing rivers
- Castle attack upgrades (mentioned as a future hook, not built yet)
- A real balancing pass on the current buildings/troops/economy

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
