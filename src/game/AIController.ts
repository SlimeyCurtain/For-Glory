import { BUILDINGS, RESOURCE_TICK_MS, TROOPS } from './balance';
import type { BuildingType, ResourceKey, TroopType } from './balance';
import { GameState } from './GameState';
import { hexDistance } from './hex';
import type { PlayerId } from './types';

/** How many troops the AI keeps trained up before it stops re-training and lets gold pile up for infrastructure instead. */
const MAX_STANDING_ARMY = 6;

/**
 * The AI works down this list in order, always saving toward whichever
 * entry is next rather than getting distracted by a lower-priority one it
 * could currently afford -- that's what actually gets it out of "farms +
 * barracks + infinite militia" and into a real economy. Only one Farm is
 * required up front (just enough to unlock Barracks) since a single Farm's
 * straw output alone comfortably covers early build costs, and there's no
 * point stockpiling food before there's steady gold income to actually
 * spend it supporting.
 */
interface WishlistItem {
  type: BuildingType;
  cap: number;
  /** Farms have no upkeep and can only ever help a deficit, so they skip the solvency gate other buildings need. */
  requiresSolvency: boolean;
}
const BUILD_WISHLIST: WishlistItem[] = [
  { type: 'farm', cap: 1, requiresSolvency: false },
  { type: 'barracks', cap: 1, requiresSolvency: true },
  { type: 'lumberMill', cap: 1, requiresSolvency: true },
  // A single Lumber Mill's wood income is usually too thin to ever clear the
  // sustain-margin check for anything that drains wood as upkeep (Fisher's
  // Hut, House, Quarry) -- that margin is a fixed cost while a lone mill's
  // output never grows, so without a second one the AI would hit a
  // permanent wood ceiling and never touch the rest of the tech tree.
  { type: 'lumberMill', cap: 2, requiresSolvency: true },
  { type: 'fishersHut', cap: 1, requiresSolvency: true }, // the AI's actual gold bottleneck -- more gold income than a Farm can ever provide
  { type: 'house', cap: 1, requiresSolvency: true },
  { type: 'quarry', cap: 1, requiresSolvency: true },
];

/**
 * Once every entry above is either built out or genuinely can't be acted on
 * this cycle, the AI shouldn't just stop -- there's no natural end to
 * "building a better settlement", so this pool keeps offering one more of
 * each productive building type, uncapped, for as long as the economy can
 * actually sustain it. `tryBuildFrom` only ever reaches this after the main
 * wishlist above has nothing left to do.
 */
const GROWTH_POOL: WishlistItem[] = [
  { type: 'lumberMill', cap: Infinity, requiresSolvency: true },
  { type: 'fishersHut', cap: Infinity, requiresSolvency: true },
  { type: 'quarry', cap: Infinity, requiresSolvency: true },
  { type: 'house', cap: Infinity, requiresSolvency: true },
  // Deliberately no uncapped Farm entry here (see maybeBuildSurplusFarm) --
  // an unconditional one used to be this pool's only requiresSolvency:false
  // item, which made it the reflexive fallback the instant anything else on
  // either list was merely blocked *this cycle*, not genuinely unsustainable
  // -- most visibly for several cycles in a row right at the start, while
  // the very first Farm is still under construction and hasn't produced any
  // straw yet, which is exactly what every other early building's own
  // solvency check is waiting on. That stacked 3-4 needless Farms (each
  // pricier than the last) before the settlement had even fielded a single
  // troop to justify the food.
];

const ALL_RESOURCES: ResourceKey[] = ['gold', 'food', 'straw', 'wood', 'stone'];

/**
 * A resource landing on an exact tie (or worse) used to be explicitly
 * tolerated here on the theory that "at least +0" is sustainable -- but a
 * tie is still a dead end, since it can never again save toward whatever
 * building would have actually fixed it (this is exactly how the AI used to
 * get stuck forever at 2 Lumber Mills). "+0 or negative" is now refused
 * outright. (A hard +1-per-action floor was tried first and tested live: it
 * blocked Barracks itself -- base gold income is only +1/s, so Barracks'
 * own -0.4/s upkeep alone already fails a >=1 bar -- and stalled the AI at a
 * single Farm for an entire match. "+0 or negative" is the line that's
 * actually enforceable without breaking early game.) The one exception is
 * `hasKnownRescueFor`: a foreseeable dip is fine as long as the AI can name
 * a real, reachable build that fixes it -- even one it can't afford this
 * exact instant, since by definition a *future* fix doesn't have to be.
 */
const MIN_SUSTAIN_RATE = 0;

/**
 * Scripted opponent for the core loop. Priority order, same as a player
 * should think about it: never let a resource run a deficit, then grow the
 * settlement toward a real economy (working down a build wishlist instead
 * of spending opportunistically), and only then commit troops to actually
 * winning -- rather than an endless one-note militia attrition war.
 */
export class AIController {
  private decisionCooldownMs = 0;
  private state: GameState;
  private me: PlayerId;

  constructor(state: GameState, me: PlayerId) {
    this.state = state;
    this.me = me;
  }

  update(dtMs: number) {
    this.decisionCooldownMs -= dtMs;
    if (this.decisionCooldownMs > 0) return;
    this.decisionCooldownMs = 1200;

    this.maybeRebuildRubble();
    this.maybeBuild();
    this.maybeTrain();
    this.maybeAttack();
    this.maybeRepair();
  }

  /** Whether any resource the AI is already invested in is currently losing ground -- the "stop digging" signal. */
  private hasAnyDeficit(): boolean {
    return ALL_RESOURCES.some((r) => this.projectedResourceRatePerSec(r) < -0.05);
  }

  /**
   * `GameState.netResourceRatePerSec`, but also counting upkeep from this
   * player's currently-constructing buildings -- upkeep that's already
   * locked in (the resources were spent to start it, and there's no way to
   * cancel) but doesn't show up in the live rate until the building
   * actually goes active. Without this, a Lumber Mill still mid-construction
   * is invisible to every solvency check -- including one for a *second*
   * Lumber Mill, or for training a troop -- even though its own upkeep is a
   * certainty the instant it finishes. Two Lumber Mills each drawing a
   * little gold upkeep, on top of whatever a Barracks and a Militia already
   * draw, is exactly the kind of combination that can otherwise sum to a
   * perfect, permanent tie with base income the moment the second one
   * activates -- not a deficit (so the "stop digging" guard never trips),
   * just an economy that can never again save toward anything, including
   * the Fisher's Hut or Quarry that would have fixed it.
   */
  private projectedResourceRatePerSec(resource: ResourceKey): number {
    let rate = this.state.netResourceRatePerSec(this.me, resource);
    for (const b of this.state.buildingsOf(this.me)) {
      if (b.state !== 'constructing') continue;
      const amount = BUILDINGS[b.type].upkeep?.[resource];
      if (!amount) continue;
      rate += amount / (RESOURCE_TICK_MS[resource] / 1000);
    }
    return rate;
  }

  /**
   * Whether taking on this much more per-resource upkeep would still leave
   * every affected resource's net rate above `buffer` (MIN_SUSTAIN_RATE by
   * default, i.e. strictly positive) -- the actual thing that starves an
   * economy isn't the one-time cost (issueBuild/issueTrain already refuse
   * what isn't affordable), it's stacking recurring drain faster than
   * production grows to cover it.
   *
   * A resource that would land at or below the floor isn't an automatic
   * refusal, though: if the AI already knows of some other real, reachable
   * build that would produce enough of that same resource to clear the floor
   * again, the dip is a foreseen and remediable one rather than a permanent
   * wall -- see `hasKnownRescueFor`.
   */
  private canSustainUpkeep(upkeep: Partial<Record<ResourceKey, number>>, buffer = MIN_SUSTAIN_RATE): boolean {
    for (const resource of Object.keys(upkeep) as ResourceKey[]) {
      const perTick = upkeep[resource] ?? 0;
      if (perTick === 0) continue;
      const perSecond = perTick / (RESOURCE_TICK_MS[resource] / 1000);
      const projected = this.projectedResourceRatePerSec(resource) + perSecond;
      if (projected > buffer + 0.001) continue;
      // A flat tie (projected == 0) doesn't drain the stockpile -- it's
      // stuck, not losing ground -- so knowing of a someday-reachable fix is
      // enough. An actual negative rate DOES drain the stockpile every tick,
      // risking the real insolvency damage `resolveUpkeepTick` hands out
      // once the reserve runs dry -- that needs a fix that's buildable and
      // affordable *right now*, not just known about.
      const isDraining = projected < -0.001;
      if (!this.hasKnownRescueFor(resource, projected, buffer, isDraining)) return false;
    }
    return true;
  }

  /** Whether `type`'s production (as `spawnBuilding` assigns it) can ever feed `resource` at all -- the domain knowledge already baked into the wishlist's own ordering. */
  private producesResource(type: BuildingType, resource: ResourceKey): boolean {
    switch (type) {
      case 'farm':
        return resource === 'food' || resource === 'straw';
      case 'lumberMill':
        return resource === 'wood';
      case 'quarry':
        return resource === 'stone';
      case 'fishersHut':
        return resource === 'gold';
      case 'house':
        return resource === 'gold' || resource === 'wood';
      default:
        return false;
    }
  }

  /**
   * Whether `type` could ever go up somewhere in this settlement's reach,
   * even though no qualifying tile is claimed yet -- the same terrain search
   * `tryExpandToward` uses, without actually claiming anything.
   */
  private canEventuallyReach(type: BuildingType): boolean {
    const reqTerrain = type === 'quarry' ? 'hills' : BUILDINGS[type].requiresAdjacentTerrain?.[0];
    if (!reqTerrain) return true; // no special terrain needed -- it's just short on ordinary resources for now, not permanently out of reach
    return !!this.state.nearestTerrainTile(this.me, reqTerrain);
  }

  /**
   * Is there some other item the AI already has on its own priority list
   * that would carry `resource` back above `buffer`, either right now or
   * once the settlement can physically reach it? Scans the same priority
   * lists building decisions already work from, in order, so the "rescue"
   * the AI is relying on is always something it would actually go on to
   * build next -- not a hypothetical it has no intention of acting on.
   *
   * `requireImmediate` is the difference between a flat tie and a real
   * deficit (see `canSustainUpkeep`): when true (the dip is actually
   * negative and draining the stockpile every tick), the fix must be
   * buildable AND affordable this exact instant, not merely known about --
   * a live trace of the lenient version proved this matters: the AI took a
   * -0.2 gold/s dip on the promise of a Fisher's Hut it couldn't build for
   * another two minutes, ran gold to zero in the meantime, and insolvency
   * damage killed all three of its own troops before the "rescue" ever
   * landed. A flat tie (projected == 0) never drains anything, so a plan
   * the AI is merely working toward -- reachable but not yet affordable --
   * is a safe enough promise; that leniency is what unblocks the real
   * Lumber-Mill-to-Fisher's-Hut pipeline (the second mill's own gold tie can
   * only ever be fixed by a hut that needs wood the AI doesn't have until
   * that second mill exists).
   */
  private hasKnownRescueFor(resource: ResourceKey, projectedRate: number, buffer: number, requireImmediate: boolean): boolean {
    const territory = this.state.ownedTerritoryTiles(this.me);
    for (const list of [BUILD_WISHLIST, GROWTH_POOL]) {
      for (const item of list) {
        const countOfType = this.state.buildingsOf(this.me).filter((b) => b.type === item.type).length;
        if (countOfType >= item.cap) continue;

        const spot = territory.find(
          (tile) => this.state.canBuildAt(this.me, tile).ok && this.state.availableBuildingsFor(this.me, tile).includes(item.type)
        );
        if (spot) {
          const contribution = this.state.estimateNetResourceContribution(item.type, spot, resource);
          if (contribution > 0 && projectedRate + contribution >= buffer - 0.001 && (!requireImmediate || this.canAfford(item.type))) {
            return true;
          }
          continue;
        }

        if (!requireImmediate && this.producesResource(item.type, resource) && this.canEventuallyReach(item.type)) return true;
      }
    }
    return false;
  }

  /** The upkeep of the next not-yet-built, solvency-gated build target -- what maybeTrain needs to leave room for. */
  private nextPlannedUpkeep(): Partial<Record<ResourceKey, number>> {
    for (const list of [BUILD_WISHLIST, GROWTH_POOL]) {
      for (const item of list) {
        if (!item.requiresSolvency) continue;
        const countOfType = this.state.buildingsOf(this.me).filter((b) => b.type === item.type).length;
        if (countOfType >= item.cap) continue;
        return BUILDINGS[item.type].upkeep ?? {};
      }
    }
    return {};
  }

  private maybeBuild() {
    // The bootstrap wishlist always gets first refusal -- only once it's
    // entirely satisfied (or everything left in it is genuinely blocked
    // this cycle) does the AI fall through to the open-ended growth pool,
    // so early priorities are never crowded out by "just one more farm".
    if (this.tryBuildFrom(BUILD_WISHLIST)) return;
    if (this.tryBuildFrom(GROWTH_POOL)) return;
    this.maybeBuildSurplusFarm();
  }

  /**
   * The one place a Farm still gets built for its own sake (food/straw),
   * rather than as a stepping-stone toward some other terrain (see
   * tryExpandToward) -- and only when there's an actual reason to: no Farm
   * already on the way, and existing food income isn't comfortably ahead of
   * what it's feeding. A Farm's gold cost escalates with every instance
   * ever built, so reaching for "just one more" reflexively, the way an
   * uncapped/unconditional wishlist entry used to, is a real net loss once
   * the settlement already has more food than its army needs.
   */
  private maybeBuildSurplusFarm() {
    if (this.hasAnyDeficit()) return;
    if (this.state.buildingsOf(this.me).some((b) => b.type === 'farm' && b.state !== 'active')) return;
    if (this.state.netResourceRatePerSec(this.me, 'food') > 0.5) return;
    const territory = this.state.ownedTerritoryTiles(this.me);
    const spot = territory.find(
      (tile) => this.state.canBuildAt(this.me, tile).ok && this.state.availableBuildingsFor(this.me, tile).includes('farm')
    );
    if (!spot) return;
    this.state.issueBuild(this.me, spot, 'farm');
  }

  /**
   * Walks `list` top-to-bottom and acts on the first entry it can do
   * anything about. Returns true the instant it takes or commits to an
   * action (built something, claimed an expansion tile, or is deliberately
   * saving toward a specific affordable goal) so the caller knows whether a
   * fallback list should even get a turn -- an entry that's merely at cap or
   * unsustainable right now doesn't stop the walk, it just gets skipped.
   */
  private tryBuildFrom(list: WishlistItem[]): boolean {
    const territory = this.state.ownedTerritoryTiles(this.me);

    for (const item of list) {
      const countOfType = this.state.buildingsOf(this.me).filter((b) => b.type === item.type).length;
      if (countOfType >= item.cap) continue;

      if (item.requiresSolvency) {
        // Fixing an existing deficit always outranks taking on more
        // recurring drain -- this is what stops the AI from digging itself
        // deeper instead of righting the ship.
        if (this.hasAnyDeficit()) return true;
        const upkeep = BUILDINGS[item.type].upkeep;
        if (upkeep && !this.canSustainUpkeep(upkeep)) continue;
      }

      const spot = territory.find(
        (tile) => this.state.canBuildAt(this.me, tile).ok && this.state.availableBuildingsFor(this.me, tile).includes(item.type)
      );
      if (!spot) {
        // No qualifying tile in territory *yet*. If this building needs a
        // specific terrain nearby (Lumber Mill/forest, Fisher's Hut/river,
        // Quarry/hills) that terrain may simply be outside how far the
        // settlement has grown -- claim whatever's closest to it instead of
        // stalling on this forever, which walks territory a ring nearer
        // every cycle until the real spot opens up.
        if (this.tryExpandToward(item.type)) return true;
        continue; // truly nothing to do for this one right now -- try the next priority instead
      }

      if (this.state.issueBuild(this.me, spot, item.type).ok) return true;

      // Unaffordable *yet* is deliberately where the AI stops and saves up
      // instead of spending on something lower-priority -- but only when
      // saving is actually going somewhere. If every resource this item is
      // still short on has a rate too flat to ever close the gap (the
      // classic case: gold pinned at an exact zero once upkeep and base
      // income tie), "saving toward it" would just freeze the AI in place
      // forever. Falling through to the next priority instead is what lets
      // it pivot to something it can actually afford -- e.g. a House, which
      // needs no gold at all -- rather than stalling out the instant two of
      // its own numbers happen to cancel.
      const cost = this.state.previewBuildCost(this.me, item.type);
      const player = this.state.players[this.me];
      const shortResources = (Object.keys(cost) as ResourceKey[]).filter((r) => (cost[r] ?? 0) > player[r]);
      const makingProgress = shortResources.every((r) => this.state.netResourceRatePerSec(this.me, r) > 0.05);
      if (makingProgress) return true;
      continue;
    }
    return false;
  }

  /**
   * `type` needs a tile adjacent to some terrain the settlement's current
   * territory doesn't reach yet. Find that terrain's nearest occurrence on
   * the map, then claim whichever owned-but-unbuilt tile is closest to it --
   * a Road when the AI can actually pay for one, since it's a flat cost with
   * no per-instance escalation and doubles as a speed boost, unlike a Farm
   * trail whose price climbs every time (10, 12, 16, 22, ...). In practice a
   * Road needs wood + stone that don't exist yet before a Lumber Mill or
   * Quarry does -- exactly the buildings this expansion is usually trying to
   * reach -- so early on this always falls back to a Farm, which only costs
   * gold. That one claim pushes territory a ring closer; repeating this over
   * successive cycles walks the settlement toward the resource instead of
   * leaving it permanently locked out of an entire branch of the tech tree.
   */
  private tryExpandToward(type: BuildingType): boolean {
    // Quarry doesn't declare requiresAdjacentTerrain -- any Hills tile
    // qualifies outright rather than needing to be adjacent to one (see
    // BUILDINGS.quarry), so it's handled as a special case here too, the
    // same way availableBuildingsFor special-cases it. Without this, a
    // Quarry that isn't already reachable can never become reachable: this
    // is the only path that ever walks territory toward new terrain at all.
    const reqTerrain = type === 'quarry' ? 'hills' : BUILDINGS[type].requiresAdjacentTerrain?.[0];
    if (!reqTerrain) return false;
    const target = this.state.nearestTerrainTile(this.me, reqTerrain);
    if (!target) return false;
    const claimTile = this.state.closestBuildableTerritoryTile(this.me, target);
    if (!claimTile) return false;
    const options = this.state.availableBuildingsFor(this.me, claimTile);
    // Try whichever of these the AI can actually afford right now, in order
    // of preference -- picking 'road' unconditionally (the old behavior)
    // meant this whole call quietly failed every time early on instead of
    // falling back to the Farm sitting right there as a real option.
    const preferenceOrder: BuildingType[] = ['road', 'farm'];
    const claimType = preferenceOrder.find((t) => options.includes(t) && this.canAfford(t)) ?? options[0];
    if (!claimType) return false;
    return this.state.issueBuild(this.me, claimTile, claimType).ok;
  }

  private canAfford(type: BuildingType): boolean {
    const cost = this.state.previewBuildCost(this.me, type);
    const player = this.state.players[this.me];
    return (Object.keys(cost) as ResourceKey[]).every((r) => (cost[r] ?? 0) <= player[r]);
  }

  /** Whether any enemy troop is close enough to this player's own territory to be a real, immediate threat -- not just somewhere else on the map. */
  private isUnderThreat(): boolean {
    const opp = this.state.opponentOf(this.me);
    const territory = this.state.ownedTerritoryTiles(this.me);
    return this.state.troopsOf(opp).some((t) => territory.some((tile) => hexDistance(t.tile, tile) <= 2));
  }

  /** Whether the settlement has grown past the fragile early game -- once true, training toward a real attack force is worth the upkeep it competes with. */
  private hasEstablishedEconomy(): boolean {
    return this.state.buildingsOf(this.me).some((b) => b.type === 'fishersHut' || b.type === 'quarry' || b.type === 'house');
  }

  private maybeTrain() {
    const barracks = this.state.buildingsOf(this.me).find((b) => b.type === 'barracks' && b.state === 'active' && !b.training);
    if (!barracks) return;
    if (this.hasAnyDeficit()) return; // fixing the economy outranks growing the army

    // A lone standing troop paid for out of habit, with no attack planned and
    // no enemy nearby, is pure waste -- its upkeep competes with the exact
    // infrastructure that would have grown the economy for good. Only train
    // reactively (an enemy is actually closing in) or once the economy has
    // already cleared the early game and can genuinely afford to fund a real
    // attack force.
    if (!this.isUnderThreat() && !this.hasEstablishedEconomy()) return;

    // A standing army has a ceiling -- past it, gold that would go to yet
    // another militia instead piles up toward the build wishlist. Without
    // this the AI happily replaces militia forever and never saves enough
    // for anything else, which reads as "giving up" even though it's
    // technically still doing something every cycle.
    if (this.state.troopsOf(this.me).length >= MAX_STANDING_ARMY) return;

    const hasWood = this.state.buildingsOf(this.me).some((b) => b.type === 'lumberMill' && b.state === 'active');
    const hasFishersHut = this.state.buildingsOf(this.me).some((b) => b.type === 'fishersHut');
    const hasQuarry = this.state.buildingsOf(this.me).some((b) => b.type === 'quarry' && b.state === 'active');
    // Wood is earmarked for the Fisher's Hut (the real gold fix) until it
    // exists -- Archers compete for that same wood, so stick to Militia
    // until there's wood to spare. A Spearman outclasses both on raw stats,
    // so once a Quarry can actually support one, prefer it outright.
    const type: TroopType = hasQuarry
      ? 'spearman'
      : hasWood && hasFishersHut && TROOPS.archer.requiresWoodProduction
        ? 'archer'
        : 'militia';

    // A troop's upkeep is permanent -- it never expires the way a one-time
    // build cost does. Spending a resource's margin down to nothing here
    // would lock out whatever the wishlist is saving toward next on that
    // same resource, which is exactly how the AI used to wall itself off
    // from ever reaching a Lumber Mill once it had a couple of militia
    // trained. Only resources this troop *already* draws on need the extra
    // headroom -- a Militia never touches wood or straw, so a pending
    // Fisher's Hut (which only needs those) has no business blocking it.
    const reserved = this.nextPlannedUpkeep();
    const combined: Partial<Record<ResourceKey, number>> = { ...TROOPS[type].upkeep };
    for (const resource of Object.keys(combined) as ResourceKey[]) {
      if (resource in reserved) combined[resource] = (combined[resource] ?? 0) + (reserved[resource] ?? 0);
    }
    // Gold is the one resource both troops and infrastructure draw on, and a
    // troop's upkeep is forever -- so a militia trained the instant gold
    // clears the same +1 floor a building would need blocks the next
    // building just as effectively as if it had been spent on that
    // building's own upkeep. canSustainUpkeep's default floor (and its
    // rescue-aware exception) already does the right thing here.
    if (!this.canSustainUpkeep(combined)) return;
    this.state.issueTrain(this.me, barracks.id, type);
  }

  private maybeAttack() {
    if (this.hasAnyDeficit()) return; // don't gamble troops away while the economy needs fixing first
    const idleTroops = this.state.troopsOf(this.me).filter((t) => t.order.kind === 'idle');
    // Commit a real, mustered force rather than trickling replacements in
    // one and two at a time as they're trained.
    if (idleTroops.length < MAX_STANDING_ARMY) return;
    const targets = this.state.attackableBuildings(this.me);
    if (targets.length === 0) return;
    // Strike the weakest point rather than a coin flip: whatever's already
    // lowest on HP first, and among equally-healthy options whatever has the
    // least defense -- a real settlement's soft spot, not just whichever
    // building happened to be picked at random.
    const target = [...targets].sort((a, b) => a.hp - b.hp || BUILDINGS[a.type].defense - BUILDINGS[b.type].defense)[0];
    for (const troop of idleTroops) {
      // No separate "attack" order anymore -- moving straight onto the
      // target's own tile is what starts the fight (see
      // GameState.autoBuildingTargetFor), once the troop actually arrives.
      this.state.issueMoveTo(troop.id, target.tile);
    }
  }

  /** Restoring a lost building in place at its half-price credit is always cheaper than starting over fresh elsewhere -- take it the instant it's affordable, before that credit can be forfeited by anything else. */
  private maybeRebuildRubble() {
    // buildingsOf filters destroyed instances out (it's the "still standing" list), so rubble has to be found via the raw map instead.
    const rubble = [...this.state.buildings.values()].find((b) => b.ownerId === this.me && b.state === 'destroyed');
    if (!rubble) return;
    const credit = this.state.rebuildCreditFor(this.me, rubble.type);
    if (!credit) return;
    const player = this.state.players[this.me];
    const affordable = (Object.keys(credit.cost) as ResourceKey[]).every((r) => (credit.cost[r] ?? 0) <= player[r]);
    if (affordable) this.state.issueRebuildRubble(this.me, rubble.id);
  }

  private maybeRepair() {
    const damaged = this.state
      .buildingsOf(this.me)
      .find((b) => b.state === 'active' && !b.repairing && b.hp < b.maxHp * 0.6);
    if (!damaged) return;
    const player = this.state.players[this.me];
    const cost = Math.ceil((damaged.maxHp - damaged.hp) * 0.5);
    if (player.gold >= cost + 20) {
      this.state.issueRepair(this.me, damaged.id);
    }
  }
}
