// Lupus in Tabula - regole del gioco (funzioni pure, senza Firebase né DOM, così si possono testare da sole)

export const ROLES = {
  wolf: {
    name: "Lupo", plural: "Lupi", icon: "🐺", team: "wolves", min: 1,
    desc: "Ogni notte i lupi scelgono insieme un giocatore da uccidere. Vincete quando i lupi sono tanti quanti gli altri.",
    info: "Di notte i lupi si riconoscono e si accordano su una vittima: devono essere tutti d'accordo. "
      + "Di giorno fingono di essere innocenti e cercano di far eliminare gli abitanti del villaggio.",
  },
  seer: {
    name: "Veggente", plural: "Veggenti", icon: "👁️", team: "village", max: 1,
    desc: "Ogni notte indichi un giocatore e scopri se è un lupo oppure no.",
    info: "Una sola visione per notte, e non si può cambiare. Usa ciò che scopri per guidare il villaggio, "
      + "ma attento: se i lupi capiscono chi sei, sarai il loro prossimo bersaglio.",
  },
  magician: {
    name: "Mago", plural: "Maghi", icon: "🪄", team: "village", max: 1,
    desc: "Ogni notte proteggi la casa di un giocatore (non la tua): nessuno al suo interno può essere ucciso quella notte.",
    info: "Puoi proteggere la stessa persona più notti di fila. La protezione vale per tutta la casa: "
      + "se il medium è in visita lì, è salvo anche lui.",
  },
  medium: {
    name: "Medium", plural: "Medium", icon: "🔮", team: "village", max: 1,
    desc: "Ogni notte vai a casa di un altro giocatore. Se i lupi attaccano quella casa, muori tu al suo posto.",
    info: "Non puoi visitare te stesso. Se il mago protegge la casa che visiti, vi salvate entrambi. "
      + "Se invece i lupi attaccano proprio te, non c'è nessuno a salvarti.",
  },
  citizen: {
    name: "Cittadino", plural: "Cittadini", icon: "🧑‍🌾", team: "village",
    desc: "Sei un semplice abitante del villaggio. Di giorno discuti e vota per scoprire ed eliminare i lupi.",
    info: "Non hai poteri notturni, ma il tuo voto conta: osserva, ascolta e smaschera i lupi.",
  },
};
export const SPECIAL_ROLES = ["wolf", "seer", "magician", "medium"]; // i cittadini riempiono i posti rimasti
export const ROLE_ORDER = [...SPECIAL_ROLES, "citizen"];
export const NIGHT_ROLES = ["seer", "magician", "medium"]; // ruoli che scelgono un giocatore di notte (oltre ai lupi)

// ---------- preparazione ----------

export function suggestedCounts(n) {
  const wolf = Math.max(1, Math.floor(n / 4));
  const seer = 1;
  const magician = 1;
  const medium = n >= 6 ? 1 : 0;
  return { wolf, seer, magician, medium, citizen: n - wolf - seer - magician - medium };
}

export const maxWolves = (n) => Math.ceil(n / 2) - 1; // i lupi devono partire in minoranza

export function setupError(counts, n) {
  if (counts.wolf < 1) return "Serve almeno un lupo.";
  if (counts.wolf > maxWolves(n)) return `I lupi devono partire in minoranza: al massimo ${maxWolves(n)} con ${n} giocatori.`;
  if (counts.citizen < 0) return "Ci sono più ruoli che giocatori.";
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

// ---------- utilità ----------

export const aliveIds = (alive) => Object.keys(alive || {}).filter((id) => alive[id] === true);
export const livingWithRole = (roles, alive, role) => aliveIds(alive).filter((id) => roles[id] === role);

// ---------- notte ----------

/** La scelta dei lupi: valida solo se tutti i lupi vivi hanno scelto lo stesso bersaglio. */
export function wolfTarget(roles, alive, wolfVotes = {}) {
  const wolves = livingWithRole(roles, alive, "wolf");
  const picks = wolves.map((id) => wolfVotes[id]).filter((t) => t && alive[t] === true && roles[t] !== "wolf");
  const agreed = wolves.length > 0 && picks.length === wolves.length && picks.every((t) => t === picks[0]);
  return { target: agreed ? picks[0] : null, agreed, waiting: wolves.filter((id) => !wolfVotes[id]) };
}

/** Stato della notte per ruolo, per dire al master chi deve ancora agire. */
export function nightStatus(roles, alive, wolfVotes = {}, actions = {}) {
  const wolves = wolfTarget(roles, alive, wolfVotes);
  const holders = Object.fromEntries(NIGHT_ROLES.map((r) => [r, livingWithRole(roles, alive, r)[0] || null]));
  const complete = wolves.agreed && NIGHT_ROLES.every((r) => !holders[r] || !!actions[holders[r]]);
  return { wolves, ...holders, complete };
}

/** La visione del veggente: true se il giocatore indicato è un lupo. */
export const seerSees = (roles, target) => roles[target] === "wolf";

/**
 * Risolve la notte.
 * - Il mago protegge una casa: nessuno lì dentro muore (nemmeno il medium, se è in visita).
 * - Se i lupi attaccano la casa che il medium sta visitando, muore il medium al posto del padrone di casa.
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

// ---------- giorno ----------

/** Conta i voti validi: votante vivo, bersaglio vivo, non se stesso, e tra i candidati (ballottaggio). */
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

/** Chiude una votazione: un solo più votato viene eliminato; un pareggio al primo turno porta al ballottaggio; un secondo pareggio non elimina nessuno. */
export function closeVote(ballot, votes, alive, candidates = null) {
  const { counts, leaders } = tallyVotes(votes, alive, candidates);
  if (leaders.length === 1) return { eliminated: leaders[0], runoff: null, counts };
  if (leaders.length > 1 && ballot === 1) return { eliminated: null, runoff: leaders, counts };
  return { eliminated: null, runoff: null, counts };
}

// ---------- fine ----------

/** "village" quando non restano lupi, "wolves" quando i lupi sono almeno quanti gli altri. */
export function winner(roles, alive) {
  const living = aliveIds(alive);
  const wolves = living.filter((id) => roles[id] === "wolf").length;
  if (wolves === 0) return "village";
  if (wolves >= living.length - wolves) return "wolves";
  return null;
}

// ---------- modalità dal vivo ----------

/** Passi che il master segue ogni notte dal vivo. I ruoli in gioco vengono sempre chiamati, anche se fuori gioco. */
export function nightSteps(counts = {}) {
  return ["sleep", "wolves", ...NIGHT_ROLES.filter((r) => counts[r]), "dawn"];
}
