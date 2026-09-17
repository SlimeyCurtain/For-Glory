# For Glory (prototype)

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
phone rotated sideways — see below).

Everything is click/tap only — there are no keyboard controls.

## Title screen and match flow

The game opens on a title screen ("For Glory" over a stylized aerial
settlement) with a **Start** button and the mobile/desktop toggle.
Pressing Start fades to black while a fresh match (map, economy, both
players) is built, then fades back in on a frozen game board: a big
red **05:00** shrinks into its actual HUD position, followed by a
**3 → 2 → 1 → BEGIN** countdown (each growing from nothing to a large
bold number/word and back down, 2 seconds apiece) — the 3/2/1 beeps
are the same flat, monotone tone every time, and BEGIN answers with a
single louder, higher-pitched one so the payoff is unmistakable. The
match clock only starts moving once BEGIN finishes — nothing ticks
before that, so there's no way to lose time to the intro. Once play
begins, a soft, generative ambient bed (a quiet low drone plus
occasional plucked notes) plays under the match — quiet enough to sit
behind every other cue, not compete with them.

In the closing 10 seconds of a running clock, the timer flashes
red/white every second. When the match ends — by the clock running out
or by a castle being destroyed — the ambient music stops, the board
darkens, the HUD fades out, and a big blue number (you) and a big red
number (the AI) count up together over their respective sides of the
screen. The winning number turns gold (whichever number is higher, on
a timeout; whoever destroyed the castle, on a castle win) with a short
triumphant fanfare layered over the sound of a crowd cheering, victory
text names the winning side, and a white **Exit** button fades to
black and returns to the title screen, ready for a rematch. A tied
score at time-out runs the exact same sequence, except both numbers
turn grey, the text just reads "DRAW", and a low mournful horn plays
instead of the fanfare (no cheering — nobody actually won).

You're assigned to the left or right side at random each match (never
the same side as the AI, obviously) — your color is always blue and
the AI's is always red regardless of which side you land on.

## Core loop implemented

- Five resources: **Gold** (base +5/5s), **Food**, **Straw**, **Wood**,
  and **Stone**. Each resource resolves its own upkeep on its own
  cadence — Gold every 5s, Food/Straw every 3s, Wood every 6s (Lumber
  Mill's own production interval), Stone every 8s (Quarry's) — while
  each building otherwise produces on its own instance-specific
  interval. The game clock is real-time 1:1 — the 5-minute match timer
  is five real minutes, not an abstracted "game time."
- **Running a deficit just draws down your reserve, tick by tick** —
  producing 4 food/3s against 6 food/3s of upkeep is a net -2 every
  tick, and that's fine as long as you have reserve to give. Only once
  the reserve can't cover a tick's full draw does it clamp to zero and
  start punishing: every troop and building that consumes that specific
  resource takes 10 flat HP damage, every tick, for as long as the
  shortfall lasts. The HUD flags the danger before it bites: a
  resource's stored amount and its net rate both turn red the moment
  the rate goes negative.
- Tap any tile to see its terrain, movement/combat effect, and who
  controls it (yours / enemy / unoccupied). If it's yours and empty, a
  **Build** button lists what's buildable there, filtered by terrain
  and adjacency, each with its full resource cost (including a pending
  rebuild discount, if you have one — see below). Tap your own
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
  confirming attacks it — but only if your troop's attack stat actually
  beats that building's defense (see Combat, below); otherwise the
  attack is refused outright and the path-trace won't let you confirm
  it. Archers, which can't attack buildings at all, are blocked the
  same way. Tapping an already-selected troop again swaps the open
  panel to that troop's tile info instead of doing nothing.
- Troops take a base 2 seconds to cross a plains-neutral tile; terrain
  scales that up or down: plains (faster), forest (slower), hills
  (slower — unless your own House sits on that hills tile, which
  cancels the penalty for you while doubling it for nearby enemies),
  rivers/lakes (impassable to ground troops, with the odd natural ford
  carved through), mountains (impassable to ground troops, aside from
  the odd lone peak or ridge to route around).
- **Buildings don't block movement** — troops from either side can
  walk straight through a tile with a building on it, just a little
  slower (+1/8 on top of whatever else applies) since it's still
  physically in the way. **Rubble is the opposite**: a destroyed
  building's remains are genuinely impassable until someone clears (or
  rebuilds) that tile — see Rubble below.
- **Roads** are a dedicated building (2 stone + 4 wood, 4s to build)
  that halve whatever movement penalty their tile's terrain would
  otherwise cost, and boost Plains' speed buff by half again — a Road
  through a Forest still nets faster than the raw Forest despite the
  usual +1/8 building tax. That effect applies to any troop crossing
  it, yours or the enemy's, regardless of who built it. Nothing else
  can be built on a Road tile, and unlike every other building, a Road
  can never be attacked and scores nothing for its first construction.
  Since claiming a tile at all (even with nothing special on it)
  extends your territory, a cheap flat-cost Road is a much better tool
  than an escalating Farm trail for reaching a distant resource in a
  favorable direction.
- **Defend** doubles a troop's defense and roots it in place until you
  move it, attack, or it dies — it survives a combat engagement intact
  instead of being overridden, and you can switch a troop into it
  *mid-fight* without pulling it out of combat (it keeps trading blows,
  just tougher). Archers rely on it: they can strike at range 2 at any
  time, but can't fight an adjacent enemy unless they're defending.
  Spearmen get a one-shot bonus from it instead: once per activation of
  Defend, a Spearman can throw its spear at range 3 for a third more
  damage than its normal melee swing — after that throw it's back to
  fighting at melee range (still with doubled defense) until Defend is
  toggled again.
  Any troop entering Defend — yours or the enemy's — rings out with a
  distinct metallic shield sound, deliberately audible to both players:
  an attentive opponent who hears it and keeps swinging anyway is about
  to waste their troop against a doubled defense for nothing.
- **Troops don't chip away continuously — they swing on a cooldown**,
  randomized per hit so two of the same troop type trading blows don't
  always land in perfect lockstep (a Militia's cooldown re-rolls
  somewhere in 1.3–1.7s, an Archer's in 2.0–2.6s). Every landed swing
  rings out with a metallic clash — with several troops trading blows
  on their own independent cooldowns, it reads as a real scuffle rather
  than a metronome. Each landed swing is
  a straight stat diff: attacker's attack minus defender's defense —
  positive hurts the defender, same as always. A *negative* result at
  **melee range** backfires the difference onto the attacker instead,
  every swing, for as long as it keeps fighting a matchup it can't win.
  At **range** (further than 1 tile), a failed swing is just harmless —
  the attacker is far enough away that a defender's higher stat can't
  reach back, though two ranged units trading fire still risk each
  other normally in whichever direction actually connects. Against a
  building specifically, a losing matchup isn't even allowed to start —
  if a troop's attack doesn't exceed the building's defense, the attack
  order is refused outright. Buildings never take reciprocal damage
  from a failed attack, but the Barracks still counters: any attacker
  whose hit actually lands against it takes 4 flat damage back, on top
  of whatever it dealt.
- **Pillaging a building down to zero HP grants a one-time bonus**
  equal to everything that building was actively producing (e.g.
  destroying a Lumber Mill bordered by 3 forest tiles hands you a
  lump 6 wood, matching its own per-tick output) — a reward for finishing
  the job, not a slow drain over time.
- Destroying an enemy building scores a point; destroying an enemy
  troop scores 0.5. Destroying the enemy castle wins instantly;
  otherwise highest score wins when the 5-minute clock runs out.
  Constructing a building only scores 0.25 the very first time you
  ever put up that building type — extra copies don't score, and
  neither does rebuilding one after it's destroyed.
- **A destroyed building leaves rubble behind, with a crumbling sound
  as it comes down** — a crumbled pile on its tile instead of the spot
  just going empty, so it's never ambiguous whether that patch of
  ground is buildable again yet. Rubble blocks any new construction
  *and* troop movement (it's genuinely impassable, not just unbuildable)
  until someone pays to **Clear Tile**, an action in the rubble's own
  info panel: **5 gold** for your own rubble, or **10 gold** for an
  opponent's, which additionally requires one of your troops to be
  standing right next to it — you're paying soldiers to dig it out, not
  waving a wand from across the map. Clearing a path through an
  opponent's rubble is the only way back into territory their own
  wreckage is blocking.
- **Any destroyed building can be rebuilt at half price and half
  time** once its tile is cleared — specifically, half of whatever
  that exact instance cost and took to build, not half of the current
  (possibly escalated) price. This applies building-by-building; you
  don't need every copy of a type destroyed first, except for
  buildings capped at one at a time (the Barracks), where that's
  already implied. The trade-off: a credit-rebuilt building's first 3
  completed ticks on each of its production feeds yield nothing (still
  tick, just empty-handed) — a bigger real-time setback on buildings
  with long cycles, like the Quarry. Beginning construction, a repair,
  or a rebuild all ring out with the same few hammer knocks.
- **Castles defend themselves**: at level 1 (the only level so far),
  a castle is mechanically a stationed Archer — 10 attack, the same
  2.0–2.6s randomized attack speed, range 2, resolved through the same
  defense-diff formula as any other ranged attack (so a well-defended
  target can shrug it off entirely).

### Buildings

| Building | Built on | Cost | HP / Defense | Produces | Notes |
| --- | --- | --- | --- | --- | --- |
| Farm | Plains | Gold only, escalating per lifetime build (10, 12, 16, 22, ...) | 10 hp / 2 def | 2 food + 5 straw / 3s (4 + 8 near a river/lake) | Unlocks the Barracks |
| Barracks | Plains/Hills | 25 gold + 25 straw | 20 hp / 10 def | Trains troops | Only one active/constructing at a time; trains 3s faster next to a Farm; counters a landed hit for 4 damage |
| Lumber Mill | Plains/Hills, adjacent to Forest | 30 gold + 35 straw | 20 hp / 3 def | 2 wood per adjacent Forest tile / 6s | Unlocks the Archer once active |
| Quarry | Hills, adjacent to Mountains | 20 gold + 30 wood + 40 straw | 25 hp / 4 def | 1 stone per adjacent Mountain tile / 8s | |
| Fisher's Hut | Plains/Hills, adjacent to river/lake | 20 gold + 40 wood + 30 straw | 20 hp / 2 def | 3 gold / 5s | +2 food to any directly adjacent Farm |
| House | Anywhere except river/lake/mountains | 20 wood + 30 stone + 40 straw | 20 hp / 3 def | 1 gold / 5s | Trait depends on the tile it sits on (see its in-game Special Trait box) |
| Road | Plains/Forest/Hills | 4 wood + 2 stone | 10 hp (irrelevant — can't be attacked) | none | Halves its tile's terrain movement penalty (or boosts a Plains buff by half again) for any troop; nothing else can be built on it; scores nothing for its first construction |

### Troops

| Troop | Cost | Stats | Attack Speed | Notes |
| --- | --- | --- | --- | --- |
| Militia | 2 gold + 2 food | 5 atk / 5 def / 10 hp | 1.3–1.7s | Melee, can attack buildings |
| Archer | 4 gold + 2 food + 5 wood | 10 atk / 7 def / 15 hp | 2.0–2.6s | Requires active wood production; strikes at range 2 always, needs Defend to fight adjacent; can't attack buildings |
| Spearman | 4 gold + 4 wood + 2 stone | 20 atk / 10 def / 10 hp | 1.8–2.5s | Requires an active Quarry; melee like a Militia, but can throw its spear once per Defend activation at range 3 for 1/3 more damage; can attack buildings |

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
side's terrain grows around its own castle position. Which player
lands on which side is a coin flip every match — you're never stuck
permanently on one side, and the two players are never on the same
side. Generation always double-checks that a ground path exists
between the two castles and clears the nearest obstacle if a
particular random map would otherwise seal one side off.

## Mobile / desktop

The game renders at a fixed landscape aspect ratio and is scaled
(never stretched) to fit its viewport. It auto-detects touch/coarse
pointer input to guess mobile vs. desktop on first load, and a small
corner button (bottom-right, labeled with whichever mode you'd switch
*to*) lets you override that — the choice persists across reloads. On
the title screen, that same button sits enlarged beneath the Start
button instead of tucked in a corner, then animates down into its
normal pill shape the moment you press Start. **Mobile mode** goes
edge-to-edge like a phone app and shows a "rotate your device" prompt
in portrait. **Desktop mode** presents the game as a centered,
shadowed panel against a dark background instead of bleeding to the
browser window's edges, and never nags about orientation (nobody
rotates a monitor).

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
- `src/ui/GameFlow.ts` — the title screen, start/countdown intro, and
  end-of-match victory sequence; owns creating and tearing down a
  match so replaying doesn't leak the previous game's state.
- `src/ui/sound.ts` — every sound cue (countdown ticks, ambient
  background bed, combat clashes, hammering, crumbling rubble, the
  victory fanfare + crowd cheer, and the defeat/draw horn), all
  synthesized with Web Audio so the game doesn't need to ship any
  audio assets.
