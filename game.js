// Lupus in Tabula - game rules (pure functions, no Firebase or DOM, so they can be tested alone)

export const ROLES = {
  wolf: {
    name: "Wolf", plural: "Wolves", icon: "🐺", team: "wolves", min: 1,
    desc: "Each night the wolves agree on a player to kill. You win when the wolves are as many as the others.",
  },
  magician: {
    name: "Magician", plural: "Magicians", icon: "🪄", team: "village", max: 1,
    desc: "Each night you protect one player's house (not your own): nobody there can be killed that night.",
  },
  medium: {
    name: "Medium", plural: "Mediums", icon: "🔮", team: "village", max: 1,
    desc: "Each night you visit another player's house. If the wolves attack it, you are killed in their place.",
  },
  citizen: {
    name: "Citizen", plural: "Citizens", icon: "🧑‍🌾", team: "village",
    desc: "You are an ordinary villager. During the day, discuss and vote to find and eliminate the wolves.",
  },
};
export const SPECIAL_ROLES = ["wolf", "magician", "medium"]; // citizens fill the remaining slots
export const ROLE_ORDER = [...SPECIAL_ROLES, "citizen"];

// ---------- setup ----------

export function suggestedCounts(n) {
  const wolf = Math.max(1, Math.floor(n / 4));
  const magician = 1;
  const medium = n >= 6 ? 1 : 0;
  return { wolf, magician, medium, citizen: n - wolf - magician - medium };
}

export const maxWolves = (n) => Math.ceil(n / 2) - 1; // wolves must start as a minority

export function setupError(counts, n) {
  if (counts.wolf < 1) return "There must be at least one wolf.";
  if (counts.wolf > maxWolves(n)) return `Wolves must start as a minority: at most ${maxWolves(n)} with ${n} players.`;
  if (counts.citizen < 0) return "More roles than players.";
  return "";
}

export function formatCounts(counts) {
  return ROLE_ORDER
    .filter((r) => counts[r] > 0)
    .map((r) => `${counts[r]} ${counts[r] === 1 ? ROLES[r].name : ROLES[r].plural}`)
    .join(" · ");
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

/** The wolves' choice: only valid when every living wolf picked the same target. */
export function wolfTarget(roles, alive, wolfVotes = {}) {
  const wolves = livingWithRole(roles, alive, "wolf");
  const picks = wolves.map((id) => wolfVotes[id]).filter((t) => t && alive[t] === true && roles[t] !== "wolf");
  const agreed = wolves.length > 0 && picks.length === wolves.length && picks.every((t) => t === picks[0]);
  return { target: agreed ? picks[0] : null, agreed, waiting: wolves.filter((id) => !wolfVotes[id]) };
}

/** Night status per role, used to tell the master who still has to act. */
export function nightStatus(roles, alive, wolfVotes = {}, actions = {}) {
  const wolves = wolfTarget(roles, alive, wolfVotes);
  const [magician] = livingWithRole(roles, alive, "magician");
  const [medium] = livingWithRole(roles, alive, "medium");
  const complete = wolves.agreed && (!magician || !!actions[magician]) && (!medium || !!actions[medium]);
  return { wolves, magician, medium, complete };
}

/**
 * Resolve the night.
 * - The magician protects a house: nobody in it dies (the medium too, if visiting).
 * - If the wolves attack the house the medium is visiting, the medium dies instead.
 */
export function resolveNight(roles, alive, wolfVotes = {}, actions = {}) {
  const { target } = wolfTarget(roles, alive, wolfVotes);
  const [magician] = livingWithRole(roles, alive, "magician");
  const [medium] = livingWithRole(roles, alive, "medium");
  const valid = (by, t) => (t && t !== by && alive[t] === true ? t : null);
  const protectedId = magician ? valid(magician, actions[magician]) : null;
  const visitedId = medium ? valid(medium, actions[medium]) : null;

  let victim = null;
  let reason = "no-attack";
  if (target && target === protectedId) reason = "protected";
  else if (target && target === visitedId) { victim = medium; reason = "medium"; }
  else if (target) { victim = target; reason = "killed"; }
  return { attacked: target, protected: protectedId, visited: visitedId, victim, reason };
}

// ---------- day ----------

/** Count valid votes: voter alive, target alive, not themselves, and among the candidates (run-off). */
export function tallyVotes(votes = {}, alive, candidates = null) {
  const counts = {};
  for (const [voter, target] of Object.entries(votes)) {
    if (alive[voter] !== true || alive[target] !== true || voter === target) continue;
    if (candidates && !candidates[target]) continue;
    counts[target] = (counts[target] || 0) + 1;
  }
  const max = Math.max(0, ...Object.values(counts));
  const leaders = max > 0 ? Object.keys(counts).filter((id) => counts[id] === max) : [];
  return { counts, max, leaders };
}

/** Close a ballot: one leader is eliminated; a tie on the first ballot starts a run-off; a second tie spares everyone. */
export function closeVote(ballot, votes, alive, candidates = null) {
  const { counts, leaders } = tallyVotes(votes, alive, candidates);
  if (leaders.length === 1) return { eliminated: leaders[0], runoff: null, counts };
  if (leaders.length > 1 && ballot === 1) return { eliminated: null, runoff: leaders, counts };
  return { eliminated: null, runoff: null, counts };
}

// ---------- end ----------

/** "village" when no wolves are left, "wolves" when they are at least as many as everyone else. */
export function winner(roles, alive) {
  const living = aliveIds(alive);
  const wolves = living.filter((id) => roles[id] === "wolf").length;
  if (wolves === 0) return "village";
  if (wolves >= living.length - wolves) return "wolves";
  return null;
}

// ---------- live mode ----------

/** Steps the master walks through each night in live mode. Roles in the game are always called, even when dead. */
export function nightSteps(counts = {}) {
  return ["sleep", "wolves", ...(counts.magician ? ["magician"] : []), ...(counts.medium ? ["medium"] : []), "dawn"];
}
