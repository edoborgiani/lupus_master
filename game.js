// Lupus in Tabula - game rules (pure functions, no Firebase, DOM or text, so they can be tested alone)

export const ROLES = {
  wolf: { team: "wolves", min: 1 },
  seer: { team: "village", max: 1 },
  magician: { team: "village", max: 1 },
  medium: { team: "village", max: 1 },
  mason: { team: "village", group: 2 },  // none, or at least two: they know each other
  prole: { team: "village", max: 1 },    // becomes a wolf if the wolves kill them
  citizen: { team: "village" },
};
export const SPECIAL_ROLES = ["wolf", "seer", "magician", "medium", "mason", "prole"]; // citizens fill the remaining slots
export const ROLE_ORDER = [...SPECIAL_ROLES, "citizen"];
export const NIGHT_ROLES = ["seer", "magician", "medium"]; // roles that pick a player at night (besides the wolves)

/** House rules each group can change. The defaults are the rules the app was first built with. */
export const DEFAULT_RULES = {
  firstNightKill: true,     // the wolves kill on the first night (false: they only recognise each other)
  wolvesWin: "parity",      // "parity": wolves win when as many as the others; "majority": only when more
  seerSees: "team",         // "team": wolf or not; "role": the exact role
  seerUses: "every",        // "every" night, or "once" per game (the seer picks the night, and may skip)
  magicianSelf: false,      // the magician may protect their own house
  magicianRepeat: true,     // the magician may protect the same house two nights in a row
  mediumAwayDies: true,     // wolves attack the medium's own house while the medium is visiting elsewhere: the medium dies
  secondTie: "none",        // tie in the run-off: "none" eliminated, or "random" among the tied
  selfVote: false,          // players may vote for themselves
  reveal: "none",           // roles revealed when leaving the game: "none", "voted" (only by vote), "all"
  masonsWake: "first",      // live: the master calls the masons on the "first" night only, or "every" night
  proleKnows: true,         // the prole knows their role (false: they believe they are a citizen until bitten)
  seerSeesProle: "village", // before the bite the seer sees the prole as "village" (not a wolf) or "wolf"
};
export const RULE_OPTIONS = {
  wolvesWin: ["parity", "majority"],
  seerSees: ["team", "role"],
  seerUses: ["every", "once"],
  secondTie: ["none", "random"],
  reveal: ["none", "voted", "all"],
  masonsWake: ["first", "every"],
  seerSeesProle: ["village", "wolf"],
};
export const withDefaults = (rules) => ({ ...DEFAULT_RULES, ...(rules || {}) });

// ---------- setup ----------

export function suggestedCounts(n) {
  const wolf = Math.max(1, Math.floor(n / 4));
  const seer = 1;
  const magician = 1;
  const medium = n >= 6 ? 1 : 0;
  const mason = n >= 10 ? 2 : 0;
  const prole = n >= 12 ? 1 : 0;
  return { wolf, seer, magician, medium, mason, prole, citizen: n - wolf - seer - magician - medium - mason - prole };
}

export const maxWolves = (n) => Math.ceil(n / 2) - 1; // wolves must start as a minority

/** Returns an error code (translated by the app), or "" when the counts are fine. */
export function setupError(counts, n) {
  if (counts.wolf < 1) return "noWolf";
  if (counts.wolf > maxWolves(n)) return "tooManyWolves";
  if (counts.mason === 1) return "oneMason";
  if (counts.citizen < 0) return "tooManyRoles";
  return "";
}

export function dealRoles(ids, counts, randomInt) {
  const deck = ROLE_ORDER.flatMap((r) => Array(counts[r] || 0).fill(r));
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return Object.fromEntries(ids.map((id, i) => [id, deck[i]]));
}

// ---------- helpers ----------

export const aliveIds = (alive) => Object.keys(alive || {}).filter((id) => alive[id] === true);
export const livingWithRole = (roles, alive, role) => aliveIds(alive).filter((id) => roles[id] === role);

// ---------- night ----------

/** On the first night the wolves may only recognise each other, depending on the rules. */
export const wolvesAct = (rules, round) => withDefaults(rules).firstNightKill || round > 1;

/** The wolves' choice: only valid when every living wolf picked the same target. */
export function wolfTarget(roles, alive, wolfVotes = {}) {
  const wolves = livingWithRole(roles, alive, "wolf");
  const picks = wolves.map((id) => wolfVotes[id]).filter((t) => t && alive[t] === true && roles[t] !== "wolf");
  const agreed = wolves.length > 0 && picks.length === wolves.length && picks.every((t) => t === picks[0]);
  return { target: agreed ? picks[0] : null, agreed, waiting: wolves.filter((id) => !wolfVotes[id]) };
}

/** Players the magician may protect tonight. */
export function protectable(roles, alive, rules, lastProtected = null) {
  const r = withDefaults(rules);
  const [magician] = livingWithRole(roles, alive, "magician");
  return aliveIds(alive).filter((id) => (r.magicianSelf || id !== magician) && (r.magicianRepeat || id !== lastProtected));
}

/** The seer's choice when they keep their power for another night ("once per game" rule). */
export const SKIP = "skip";

/** Whether the seer may still look tonight: always, unless the power is once per game and already used. */
export const seerCanLook = (rules, usedBefore) => withDefaults(rules).seerUses !== "once" || !usedBefore;

/** True if the seer had a vision in a night before `round`. `visions` is { round: vision }. */
export const seerUsedBefore = (visions, round) => Object.keys(visions || {}).some((r) => Number(r) < round && visions[r]);

/** Night status per role, used to tell who still has to act. */
export function nightStatus(roles, alive, wolfVotes = {}, actions = {}, { rules, round = 1, seerUsed = false } = {}) {
  const wolves = wolfTarget(roles, alive, wolfVotes);
  const wolvesDone = !wolvesAct(rules, round) || wolves.agreed;
  const holders = Object.fromEntries(NIGHT_ROLES.map((r) => [r, livingWithRole(roles, alive, r)[0] || null]));
  const seerSpent = !seerCanLook(rules, seerUsed);
  const done = (r) => !holders[r] || !!actions[holders[r]] || (r === "seer" && seerSpent);
  const complete = wolvesDone && NIGHT_ROLES.every(done);
  return { wolves, wolvesDone, ...holders, seerSpent, complete };
}

/** The prole may be dealt openly (role "prole") or hidden as a citizen (listed in `cursed`, which only the controller sees). */
export const trueRole = (roles, id, cursed = {}) => (roles[id] === "citizen" && cursed?.[id] ? "prole" : roles[id]);
export const isProle = (roles, id, cursed = {}) => trueRole(roles, id, cursed) === "prole";

/** What the seer learns about `target`. */
export function seerVision(roles, target, rules, cursed = {}) {
  const r = withDefaults(rules);
  const role = trueRole(roles, target, cursed);
  const vision = { target, wolf: role === "wolf" || (role === "prole" && r.seerSeesProle === "wolf") };
  if (r.seerSees === "role") vision.role = role;
  return vision;
}

/**
 * Resolve the night.
 * - The magician protects a house: nobody in it dies (the medium too, if visiting).
 * - If the wolves attack the house the medium is visiting, the medium dies instead.
 * - If the wolves attack the medium's own house while the medium is away, the rules decide.
 */
export function resolveNight(roles, alive, wolfVotes = {}, actions = {}, { rules, round = 1, lastProtected = null, cursed = {} } = {}) {
  const r = withDefaults(rules);
  const target = wolvesAct(r, round) ? wolfTarget(roles, alive, wolfVotes).target : null;
  const [magician] = livingWithRole(roles, alive, "magician");
  const [medium] = livingWithRole(roles, alive, "medium");
  const pick = magician ? actions[magician] : null;
  const protectedId = pick && protectable(roles, alive, r, lastProtected).includes(pick) ? pick : null;
  const visit = medium ? actions[medium] : null;
  const visitedId = visit && visit !== medium && alive[visit] === true ? visit : null;

  let victim = null;
  let reason = "no-attack";
  if (!wolvesAct(r, round)) reason = "first-night";
  else if (target && target === protectedId) reason = "protected";
  else if (target && target === visitedId) { victim = medium; reason = "medium"; }
  else if (target && target === medium && visitedId && !r.mediumAwayDies) reason = "medium-away";
  else if (target && isProle(roles, target, cursed)) reason = "converted"; // the bite turns the prole into a wolf
  else if (target) { victim = target; reason = "killed"; }
  return { attacked: target, protected: protectedId, visited: visitedId, victim, reason, converted: reason === "converted" ? target : null };
}

// ---------- day ----------

/** Count valid votes: voter alive, target alive, among the candidates (run-off), self-votes per the rules. */
export function tallyVotes(votes = {}, alive, candidates = null, rules) {
  const selfVote = withDefaults(rules).selfVote;
  const counts = {};
  for (const [voter, target] of Object.entries(votes)) {
    if (alive[voter] !== true || alive[target] !== true || (voter === target && !selfVote)) continue;
    if (candidates && !candidates[target]) continue;
    counts[target] = (counts[target] || 0) + 1;
  }
  const max = Math.max(0, ...Object.values(counts));
  const leaders = max > 0 ? Object.keys(counts).filter((id) => counts[id] === max) : [];
  return { counts, max, leaders };
}

/**
 * Close a ballot: one leader is eliminated; a tie on the first ballot starts a run-off;
 * a tie in the run-off spares everyone, or eliminates one of the tied at random, per the rules.
 */
export function closeVote(ballot, votes, alive, candidates = null, rules, randomInt = () => 0) {
  const { counts, leaders } = tallyVotes(votes, alive, candidates, rules);
  if (leaders.length === 1) return { eliminated: leaders[0], runoff: null, counts };
  if (leaders.length > 1 && ballot === 1) return { eliminated: null, runoff: leaders, counts };
  if (leaders.length > 1 && withDefaults(rules).secondTie === "random") {
    return { eliminated: leaders[randomInt(leaders.length)], runoff: null, counts, drawn: true };
  }
  return { eliminated: null, runoff: null, counts };
}

/** Whether a player's role is shown to everyone when they leave the game. `how`: "vote" or "night". */
export const revealsRole = (rules, how) => {
  const reveal = withDefaults(rules).reveal;
  return reveal === "all" || (reveal === "voted" && how === "vote");
};

// ---------- end ----------

/** "village" when no wolves are left; "wolves" when they are as many as (or, per the rules, more than) the others. */
export function winner(roles, alive, rules) {
  const living = aliveIds(alive);
  const wolves = living.filter((id) => roles[id] === "wolf").length;
  const others = living.length - wolves;
  if (wolves === 0) return "village";
  if (withDefaults(rules).wolvesWin === "majority" ? wolves > others : wolves >= others) return "wolves";
  return null;
}

// ---------- live mode ----------

/**
 * Steps the master walks through each night in live mode. Roles in the game are always called, even when dead.
 * With a prole, a last step before dawn tells them whether they were bitten: "prole" calls them, while
 * "check" (prole who doesn't know their role) has everyone look at their phone, so nobody can tell who it was.
 */
export function nightSteps(counts = {}, round = 1, rules) {
  const r = withDefaults(rules);
  const masons = counts.mason && (round === 1 || r.masonsWake === "every");
  const prole = counts.prole ? [r.proleKnows ? "prole" : "check"] : [];
  return ["sleep", "wolves", ...(masons ? ["masons"] : []), ...NIGHT_ROLES.filter((x) => counts[x]), ...prole, "dawn"];
}
