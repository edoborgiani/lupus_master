// Lupus in Tabula - game rules (pure functions, no Firebase, DOM or text, so they can be tested alone)

export const ROLES = {
  wolf: { team: "wolves", min: 1 },
  damned: { team: "wolves", max: 1 },   // wins with the wolves and knows them, but isn't one: no kills, counts as a villager
  seer: { team: "village", max: 1 },
  gravedigger: { team: "village", max: 1 }, // learns the role of yesterday's executed player
  magician: { team: "village", max: 1 },
  medium: { team: "village", max: 1 },   // the night-walker (sonnambulo): only the name changed
  mime: { team: "village", max: 1 },     // on the first night copies another player's role
  mason: { team: "village", group: 2 },  // none, or at least two: they know each other
  prole: { team: "village", max: 1 },    // becomes a wolf if the wolves kill them
  mayor: { team: "village", max: 1 },    // may decide the day's vote alone
  citizen: { team: "village" },
};
export const SPECIAL_ROLES = ["wolf", "damned", "seer", "magician", "medium", "gravedigger", "mime", "mason", "prole", "mayor"]; // citizens fill the remaining slots
export const ROLE_ORDER = [...SPECIAL_ROLES, "citizen"];
export const NIGHT_ROLES = ["seer", "magician", "medium"]; // roles that pick a player every night (besides the wolves)
export const ACTING_ROLES = [...NIGHT_ROLES, "mime", "gravedigger"]; // ... plus the mime (first night) and the gravedigger (no pick)

/** House rules each group can change. The defaults are the rules the app was first built with. */
export const DEFAULT_RULES = {
  firstNightKill: true,     // the wolves kill on the first night (false: they only recognise each other)
  wolvesWin: "parity",      // "parity": wolves win when as many as the others; "majority": only when more
  seerSees: "team",         // "team": wolf or not; "role": the exact role
  seerUses: "every",        // "every" night, or "once" per game (the seer picks the night, and may skip)
  gravediggerUses: "every", // the gravedigger digs "every" night, or "once" per game
  magicianSelf: false,      // the magician may protect their own house
  magicianRepeat: true,     // the magician may protect the same house two nights in a row
  mediumAwayDies: true,     // wolves attack the medium's own house while the medium is visiting elsewhere: the medium dies
  mediumWolfHouse: false,   // the medium who visits a wolf's house dies there (so a night can have two victims)
  secondTie: "none",        // tie in the run-off: "none" eliminated, or "random" among the tied
  selfVote: false,          // players may vote for themselves
  reveal: "none",           // roles revealed when leaving the game: "none", "voted" (only by vote), "all"
  masonsWake: "first",      // live: the master calls the masons on the "first" night only, or "every" night
  hybridVote: "hands",      // hybrid games: the day vote by show of "hands" (the master records it) or on "phones"
  mayorUses: "once",        // the mayor decides the vote alone "once" per game, or "every" day
  proleKnows: true,         // the prole knows their role (false: they believe they are a citizen until bitten)
  seerSeesProle: "village", // before the bite the seer sees the prole as "village" (not a wolf) or "wolf"
};
export const RULE_OPTIONS = {
  wolvesWin: ["parity", "majority"],
  seerSees: ["team", "role"],
  seerUses: ["every", "once"],
  gravediggerUses: ["every", "once"],
  secondTie: ["none", "random"],
  reveal: ["none", "voted", "all"],
  masonsWake: ["first", "every"],
  hybridVote: ["hands", "phones"],
  mayorUses: ["once", "every"],
  seerSeesProle: ["village", "wolf"],
};
export const withDefaults = (rules) => ({ ...DEFAULT_RULES, ...(rules || {}) });

// ---------- setup ----------

// Balanced starting setups, found by simulating thousands of games for each player count
// (wolf, seer, magician, medium, masons, prole, damned); everyone else is a citizen.
const SUGGESTED = {
  5: [1, 1, 0, 0, 0, 0, 0], 6: [1, 1, 0, 0, 0, 1, 0], 7: [1, 1, 1, 0, 0, 1, 1],
  8: [2, 1, 1, 1, 0, 0, 0], 9: [2, 1, 1, 1, 0, 1, 0], 10: [2, 1, 1, 1, 2, 1, 0], 11: [2, 1, 1, 1, 2, 0, 1],
  12: [2, 1, 1, 1, 2, 1, 1], 13: [2, 1, 1, 1, 2, 1, 1], 14: [3, 1, 1, 1, 2, 0, 0], 15: [3, 1, 1, 1, 2, 0, 0],
  16: [3, 1, 1, 1, 2, 1, 0], 17: [3, 1, 1, 1, 2, 1, 0], 18: [3, 1, 1, 1, 2, 0, 1], 19: [3, 1, 1, 1, 2, 0, 1],
  20: [3, 1, 1, 1, 2, 1, 1], 21: [3, 1, 1, 1, 2, 1, 1], 22: [4, 1, 1, 1, 2, 0, 0], 23: [4, 1, 1, 1, 2, 0, 0],
  24: [4, 1, 1, 1, 2, 1, 0], 25: [4, 1, 1, 1, 2, 1, 0], 26: [4, 1, 1, 1, 2, 0, 1], 27: [4, 1, 1, 1, 2, 0, 1],
  28: [4, 1, 1, 1, 2, 1, 1], 29: [4, 1, 1, 1, 2, 1, 1], 30: [5, 1, 1, 1, 2, 1, 0],
};

export function suggestedCounts(n) {
  const [wolf, seer, magician, medium, mason, prole, damned] = SUGGESTED[Math.min(30, Math.max(5, n))];
  const optional = { gravedigger: 0, mime: 0, mayor: 0 }; // the master adds them if they like
  return { wolf, seer, magician, medium, mason, prole, damned, ...optional, citizen: n - wolf - seer - magician - medium - mason - prole - damned };
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

/** Players a magician may protect tonight (`lastProtected`: their choice last night). */
export function protectable(roles, alive, rules, lastProtected = null, magician = null) {
  const r = withDefaults(rules);
  return aliveIds(alive).filter((id) => (r.magicianSelf || id !== magician) && (r.magicianRepeat || id !== lastProtected));
}

/** The seer's (or gravedigger's) choice when they keep their power for another night ("once per game" rule). */
export const SKIP = "skip";
/** The gravedigger's action: dig up yesterday's executed player. */
export const DIG = "dig";

/** Whether the seer may still look tonight: always, unless the power is once per game and already used. */
export const seerCanLook = (rules, usedBefore) => withDefaults(rules).seerUses !== "once" || !usedBefore;

/** True if the seer had a vision in a night before `round`. `visions` is { round: vision }. */
export const seerUsedBefore = (visions, round) => Object.keys(visions || {}).some((r) => Number(r) < round && visions[r]);

/** Whether the gravedigger may still dig tonight: every night, or once per game. */
export const graveCanDig = (rules, usedBefore) => withDefaults(rules).gravediggerUses !== "once" || !usedBefore;

/** Who the gravedigger can dig up tonight: the player eliminated by yesterday's vote, if any. `log`: game log entries. */
export function graveTarget(log = [], round) {
  const entry = log.filter((e) => e.type === "vote" && e.round === round - 1 && e.eliminated).pop();
  return entry ? entry.eliminated : null;
}

/**
 * Night status, used to tell who still has to act. Every role is a list of living holders (the mime may duplicate one).
 * `seerUsed(id)` / `graveUsed(id)`: whether that player already used a once-per-game power before tonight.
 */
export function nightStatus(roles, alive, wolfVotes = {}, actions = {},
  { rules, round = 1, seerUsed = () => false, graveTarget: grave = null, graveUsed = () => false } = {}) {
  const wolves = wolfTarget(roles, alive, wolfVotes);
  const wolvesDone = !wolvesAct(rules, round) || wolves.agreed;
  const holders = Object.fromEntries(ACTING_ROLES.map((r) => [r, livingWithRole(roles, alive, r)]));
  // holders with nothing to do tonight
  const idle = (r, id) => (r === "seer" && !seerCanLook(rules, seerUsed(id))) || (r === "mime" && round !== 1)
    || (r === "gravedigger" && (!grave || !graveCanDig(rules, graveUsed(id))));
  const complete = wolvesDone && ACTING_ROLES.every((r) => holders[r].every((id) => !!actions[id] || idle(r, id)));
  return { wolves, wolvesDone, holders, idle, complete };
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

/** What the gravedigger finds: the exact role on phones, only wolf or not in live games (the master answers with a thumb). */
export function graveFinding(roles, target, cursed = {}, exact = true) {
  const role = trueRole(roles, target, cursed);
  return exact ? { target, wolf: role === "wolf", role } : { target, wolf: role === "wolf" };
}

/** The role the mime takes from `target` on the first night: the exact one, or in live games only wolf or citizen. */
export function mimeCopy(roles, target, cursed = {}, exact = true) {
  const role = trueRole(roles, target, cursed);
  return exact ? role : role === "wolf" ? "wolf" : "citizen";
}

/**
 * Resolve the night. Magicians and mediums may be more than one (the mime can copy them).
 * - A magician protects a house: nobody in it dies (a medium too, if visiting).
 * - If the wolves attack a house a medium is visiting, the medium dies instead.
 * - If the wolves attack a medium's own house while the medium is away, the rules decide.
 * - House rule: a medium who visits a wolf's house dies there (`extras`), unless a magician protects that house.
 *   With the wolves' own victim, that makes two deaths in one night (`victims`).
 * `lastProtected`: { magician: who they protected last night }.
 */
export function resolveNight(roles, alive, wolfVotes = {}, actions = {}, { rules, round = 1, lastProtected = {}, cursed = {} } = {}) {
  const r = withDefaults(rules);
  const target = wolvesAct(r, round) ? wolfTarget(roles, alive, wolfVotes).target : null;
  const protectedIds = livingWithRole(roles, alive, "magician")
    .map((m) => (actions[m] && protectable(roles, alive, r, lastProtected?.[m], m).includes(actions[m]) ? actions[m] : null))
    .filter(Boolean);
  const visits = {}; // medium -> house they visit
  for (const m of livingWithRole(roles, alive, "medium")) {
    if (actions[m] && actions[m] !== m && alive[actions[m]] === true) visits[m] = actions[m];
  }
  const mediumsAt = (house) => Object.keys(visits).filter((m) => visits[m] === house);

  let victims = [];
  let reason = "no-attack";
  if (!wolvesAct(r, round)) reason = "first-night";
  else if (target && protectedIds.includes(target)) reason = "protected";
  else if (target && mediumsAt(target).length) { victims = mediumsAt(target); reason = "medium"; }
  else if (target && visits[target] && !r.mediumAwayDies) reason = "medium-away";
  else if (target && isProle(roles, target, cursed)) reason = "converted"; // the bite turns the prole into a wolf
  else if (target) { victims = [target]; reason = "killed"; }
  const extras = r.mediumWolfHouse
    ? Object.keys(visits).filter((m) => roles[visits[m]] === "wolf" && !protectedIds.includes(visits[m]) && !victims.includes(m))
    : [];
  return {
    attacked: target, protected: protectedIds, visits, victim: victims[0] || null, reason,
    converted: reason === "converted" ? target : null, extras, victims: [...victims, ...extras],
  };
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

/** Whether a mayor may still decide a vote alone (`used`: they already did once in this game). */
export const mayorCanDecide = (rules, used) => withDefaults(rules).mayorUses === "every" || !used;

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

/**
 * Remote games: how often each villager's night suspect (the pick made without a night action) was really a wolf.
 * `picks`: { uid: { round: target } }; `converted`: { uid: round } (a bitten prole is a wolf only after that night).
 * Picks made while the picker was a wolf (or by the damned, who knows the wolves) don't count.
 */
export function suspectStats(picks = {}, roles = {}, converted = {}) {
  const wolfAt = (id, round) => roles[id] === "wolf" && !(converted[id] >= round);
  const stats = {};
  for (const [id, byRound] of Object.entries(picks || {})) {
    let right = 0;
    let total = 0;
    for (const [round, target] of Object.entries(byRound || {})) {
      if (!target || wolfAt(id, Number(round)) || roles[id] === "damned") continue;
      total++;
      if (wolfAt(target, Number(round))) right++;
    }
    if (total) stats[id] = { right, total };
  }
  return stats;
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
  const mime = counts.mime && round === 1 ? ["mime"] : [];
  const grave = counts.gravedigger ? ["gravedigger"] : [];
  const prole = counts.prole ? [r.proleKnows ? "prole" : "check"] : [];
  return ["sleep", "wolves", ...(masons ? ["masons"] : []), ...mime, ...NIGHT_ROLES.filter((x) => counts[x]), ...grave, ...prole, "dawn"];
}
