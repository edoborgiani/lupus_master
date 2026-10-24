// Lupus in Tabula companion - client (Firebase Realtime Database)
//
// Two ways of playing:
// - live:   everyone at the same table. Phones only deal the roles; the master records the night
//           step by step (who the wolves point at, ...) and the result of the vote.
// - remote: everyone plays on their own phone. The master is optional: without one, the lobby's
//           host plays normally and the game advances by itself when everyone has acted.
// The "controller" (the master, or the host when there is no master) runs the game.
//
// Data layout, one node per lobby (readable by everyone in it):
//   lobbies/{CODE}/createdAt          timestamp, written once when the lobby is created
//   lobbies/{CODE}/hostId             uid of the lobby's creator (passed on when they leave)
//   lobbies/{CODE}/masterId           uid of the game master (claimed with a transaction)
//   lobbies/{CODE}/names/{nameKey}    uid owning that name (keeps names unique)
//   lobbies/{CODE}/players/{uid}      { name, joinedAt }
//   lobbies/{CODE}/presence/{uid}/{connectionId}  true while that tab is online
//   lobbies/{CODE}/game               { phase, mode, counts, round, step, alive, vote, log, winner, reveal }
//   lobbies/{CODE}/votes/{uid}        remote day vote: uid voted against (public, like pointing)
// Secret data, readable only by the controller (and per database.rules.json):
//   secrets/{CODE}/roles/{uid}        role id; each player can read only their own
//   secrets/{CODE}/wolves/{uid}       true; readable by wolves so they know their pack
//   secrets/{CODE}/wolfVotes/{uid}    tonight's victim chosen by each wolf; readable by wolves
//   secrets/{CODE}/actions/{uid}      tonight's seer/magician/medium choice; readable by its author
//   secrets/{CODE}/visions/{uid}/{round}  the seer's answers { target, wolf }; readable by the seer
//   secrets/{CODE}/nightLog/{round}   what really happened each night, for the master

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getDatabase, ref, get, set, update, remove, push, onValue, onDisconnect, runTransaction,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";
import {
  ROLES, ROLE_ORDER, NIGHT_ROLES, suggestedCounts, maxWolves, setupError, formatCounts, dealRoles, aliveIds,
  livingWithRole, wolfTarget, nightStatus, seerSees, resolveNight, tallyVotes, closeVote, winner, nightSteps,
} from "./game.js";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I/O, avoids confusion with 1/0
const MAX_PLAYERS = 30;
const MIN_PLAYERS = 5; // not counting the master
const PLAYING = ["assigned", "night", "day", "over"];
const AUTO_NIGHT_DELAY = 3000; // masterless remote: pause before resolving a complete night
const AUTO_VOTE_DELAY = 5000;  // ... and before closing a vote everyone has cast, so votes can still change
const STEP_LABELS = { sleep: "Sonno", wolves: "🐺 Lupi", seer: "👁️ Veggente", magician: "🪄 Mago", medium: "🔮 Medium", dawn: "🌅 Alba" };
const NIGHT_PROMPTS = {
  seer: "Veggente, apri gli occhi… chi vuoi scoprire stanotte?",
  magician: "Mago, apri gli occhi… quale casa proteggi stanotte?",
  medium: "Medium, apri gli occhi… a casa di chi vai stanotte?",
};
const NIGHT_VERBS = { seer: "guarda", magician: "protegge", medium: "va da" };

const $ = (sel) => document.querySelector(sel);

function store(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { return null; }
}

/** Small DOM builder: el("p", { class: "x", onclick: fn }, "text", child) */
function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) { if (v) e.addEventListener(k.slice(2), v); }
    else if (v === true) e.setAttribute(k, "");
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  e.append(...children.flat().filter((c) => c != null && c !== false));
  return e;
}

/** Drop null fields: Firebase stores nothing for them anyway. */
const compact = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v != null));

let db = null;
let uid = null;
let online = true;
let code = null;          // lobby currently open
let lobby = null;         // latest lobby snapshot
let joined = false;
let firstSnapshot = true;
let unsubLobby = null;
let myConn = null;        // this tab's presence entry

// game state
const subs = {};          // active secret listeners by key
let myRole;               // undefined = loading, null = not in this game
let pack = null;          // wolves' uids, if I'm a wolf
let wolfVotes = {};       // wolves only: tonight's picks of the pack
let myAction = null;      // seer/magician/medium: tonight's choice
let visions = {};         // seer only: { round: { target, wolf } }
let secrets = null;       // controller only: everything under secrets/{CODE}
let setup = null;         // controller only: mode and role counts being chosen
let revealed = false;
// live mode, master's current selection (reset whenever the step changes)
let stepKey = "";
let liveSel = null;
let tieSel = new Set();
let tieMode = false;
// masterless remote: pending automatic step
let autoKey = null;
let autoTimer = null;
let visionKey = null;     // seer answer being written, to avoid writing it twice

const lobbyRef = (...parts) => ref(db, ["lobbies", code, ...parts].join("/"));
const nameKey = (name) => encodeURIComponent(name.trim().toLowerCase()).replace(/\./g, "%2E");
const players = () => lobby?.players || {};
const isMaster = () => !!lobby && lobby.masterId === uid;
const controllerId = () => lobby?.masterId || lobby?.hostId || null;
const isController = () => !!uid && controllerId() === uid;
const isHostOnly = () => isController() && !isMaster(); // masterless remote: the host also plays
const playerIds = () => Object.keys(players()).filter((id) => id !== lobby.masterId);
const playerName = (id) => players()[id]?.name || "(uscito)";
const listNames = (ids) => ids.map(playerName).join(", ");
const game = () => lobby?.game || null;
const alive = () => game()?.alive || {};
const logEntries = () => Object.values(game()?.log || {});
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const visionText = (v) => `${playerName(v.target)} ${v.wolf ? "è un lupo! 🐺" : "non è un lupo."}`;

// ---------- screens ----------

function show(name) {
  for (const s of document.querySelectorAll(".screen")) s.hidden = s.id !== `screen-${name}`;
}

function goHome(error = "") {
  closeLobby();
  store("lupus.lobby", null);
  history.replaceState(null, "", location.pathname);
  $("#home-error").textContent = error;
  show("home");
}

function openProfile() {
  const me = players()[uid];
  $("#input-name").value = me?.name || store("lupus.lastName") || "";
  $("#input-master").checked = lobby.masterId === uid;
  $("#btn-profile-submit").textContent = joined ? "Salva" : "Entra nella stanza";
  $("#btn-profile-cancel").textContent = joined ? "Annulla" : "Indietro";
  $("#profile-error").textContent = lobby.game && !joined ? "In questa stanza c'è già una partita in corso." : "";
  renderMasterToggle();
  show("profile");
  if (!$("#input-name").value) $("#input-name").focus();
}

// ---------- rendering: lobby ----------

function renderMasterToggle() {
  const master = players()[lobby.masterId];
  const takenByOther = !!lobby.masterId && lobby.masterId !== uid;
  const input = $("#input-master");
  input.disabled = takenByOther;
  if (takenByOther) input.checked = false;
  input.closest(".toggle").classList.toggle("disabled", takenByOther);
  $("#master-hint").textContent = takenByOther
    ? `${master?.name || "Qualcuno"} è già il master.`
    : "Il master racconta la partita e non ha un ruolo. Facoltativo nelle partite a distanza.";
}

function renderLobby() {
  for (const e of document.querySelectorAll(".code-label")) e.textContent = code;

  const list = Object.entries(players()).map(([id, p]) => ({ id, name: p.name, isMaster: id === lobby.masterId }));
  list.sort((a, b) => (b.isMaster - a.isMaster) || a.name.localeCompare(b.name));

  $("#player-list").replaceChildren(...list.map((p) => {
    const li = playerRow(p.id, p.name);
    if (p.isMaster) li.append(badge("Master", "master"));
    else if (!lobby.masterId && p.id === lobby.hostId) li.append(badge("Host", "special"));
    return li;
  }));

  const hasMaster = list.some((p) => p.isMaster);
  const playing = list.length - hasMaster;
  $("#player-count").textContent = plural(playing, "giocatore", "giocatori") + (hasMaster ? " + master" : "");
  $("#no-master").hidden = hasMaster;
  $("#no-master").textContent = lobby.hostId && players()[lobby.hostId]
    ? `Nessun master: potete comunque giocare a distanza, con ${playerName(lobby.hostId)} come host.`
    : "Ancora nessun master.";
}

const isOnline = (id) => !!lobby.presence?.[id];
const isDead = (id) => alive()[id] === false;

function playerRow(id, name) {
  const li = el("li", { class: isDead(id) ? "dead" : "" },
    el("span", { class: "dot" + (isOnline(id) ? "" : " off"), title: isOnline(id) ? "Online" : "Offline" }),
    el("span", { class: "pname" }, name));
  if (id === uid) li.append(badge("tu", "you"));
  if (isDead(id)) li.append(badge("💀 fuori gioco", ""));
  return li;
}

function badge(text, cls) {
  return el("span", { class: `badge ${cls}` }, text);
}

const roleBadge = (r) => badge(`${ROLES[r].icon} ${ROLES[r].name}`, r === "wolf" ? "wolf" : r === "citizen" ? "" : "special");

function renderConnection() {
  $("#conn-status").hidden = online || !code;
}

// ---------- rendering: game ----------

function renderGame() {
  const g = game();
  const master = isMaster();
  const ctrl = isController();
  const phase = g?.phase || null;
  const playing = PLAYING.includes(phase);
  const n = playerIds().length;

  const key = `${phase}:${g?.round}:${g?.step}:${g?.vote?.ballot}:${g?.vote?.done}`;
  if (key !== stepKey) {
    stepKey = key;
    liveSel = null;
    tieSel = new Set();
    tieMode = false;
  }

  for (const id of ["card-start", "card-wait", "card-setup", "card-phase", "card-role", "card-master-roles", "card-log"]) {
    $(`#${id}`).hidden = true;
  }
  $("#card-share").hidden = !!g;
  $("#card-players").hidden = playing && master;
  $("#btn-edit").hidden = !!g;
  $("#btn-leave").hidden = !!g && ctrl;

  const runner = lobby.masterId ? "il master" : `${playerName(lobby.hostId)} (host)`;
  if (!phase) {
    if (ctrl) {
      $("#card-start").hidden = false;
      $("#btn-start").disabled = n < MIN_PLAYERS;
      $("#start-hint").textContent = (n < MIN_PLAYERS ? `In attesa di giocatori: ${n} su almeno ${MIN_PLAYERS}.` : `${n} giocatori pronti.`)
        + (master ? "" : " Senza master si gioca a distanza, e giochi anche tu.");
    } else {
      wait(controllerId() ? `In attesa che ${runner} inizi la partita…` : "In attesa di un master…");
    }
    return;
  }
  if (phase === "setup") {
    if (ctrl) renderSetup(n);
    else wait(lobby.masterId ? "Il master sta scegliendo i ruoli…" : `${playerName(lobby.hostId)} sta scegliendo i ruoli…`);
    return;
  }

  const live = g.mode === "live";
  if (master) {
    renderMasterRoles();
    if (secrets) {
      (live
        ? { assigned: masterAssigned, night: liveNight, day: liveDay, over: renderOver }
        : { assigned: masterAssigned, night: masterNight, day: renderDay, over: renderOver })[phase]();
    }
  } else if (myRole === undefined) {
    wait("Caricamento del tuo ruolo…");
  } else if (myRole === null) {
    wait("C'è una partita in corso senza di te. Aspetta la prossima!");
  } else {
    renderMyRole();
    (live
      ? { assigned: playerAssigned, night: livePlayerNight, day: livePlayerDay, over: renderOver }
      : { assigned: playerAssigned, night: playerNight, day: renderDay, over: renderOver })[phase]();
  }
  renderLog();
  if (ctrl && !live) answerSeer();
  if (isHostOnly()) autoAdvance();
}

function wait(msg) {
  $("#wait-text").textContent = msg;
  $("#card-wait").hidden = false;
}

function phaseCard(cls, title, ...content) {
  const card = $("#card-phase");
  card.className = `card ${cls}`;
  card.replaceChildren(el("h2", {}, title), ...content.flat().filter(Boolean));
  card.hidden = false;
}

const text = (t, cls = "phase-text") => el("p", { class: cls }, t);
const say = (t) => el("p", { class: "say" }, `“${t}”`);
const run = (fn) => () => fn().catch((err) => alert(err.message));
const action = (label, onclick, { cls = "primary", disabled = false } = {}) =>
  el("button", { class: cls, disabled, onclick }, label);

/**
 * List of players to choose from; no `onPick` means read-only. `selected` is an id or a Set of ids.
 * `extra(id)` adds a line under the name, `right(id)` content at the end of the row.
 */
function choiceList(ids, selected, onPick, extra = () => null, right = () => null) {
  const isSel = (id) => (selected instanceof Set ? selected.has(id) : id === selected);
  return el("ul", { class: "choices" }, ids.map((id) =>
    el("li", {},
      el("button", {
        class: "choice" + (isSel(id) ? " selected" : ""),
        disabled: !onPick,
        onclick: onPick ? () => Promise.resolve(onPick(id)).catch((err) => alert(err.message)) : null,
      }, el("span", { class: "pname" }, playerName(id), extra(id)), right(id)))));
}

/** Local pick in live mode: just remember it and redraw. */
function pickLocal(id) {
  liveSel = id;
  renderGame();
}

// --- setup (controller) ---

function renderSetup(n) {
  const hasMaster = !!lobby.masterId;
  const specials = (s) => s.wolf + s.seer + s.magician + s.medium;
  if (!setup || setup.n !== n) {
    // keep the controller's choice if it still fits the new player count, otherwise start from the suggestion
    const keep = setup && n - specials(setup) >= 0;
    const mode = setup?.mode;
    setup = keep ? { ...setup, citizen: n - specials(setup) } : suggestedCounts(n);
    setup.n = n;
    setup.mode = mode;
  }
  if (!setup.mode || (setup.mode === "live" && !hasMaster)) setup.mode = hasMaster ? "live" : "remote";

  $("#card-setup").hidden = false;
  $("#setup-total").textContent = `${n} giocatori`;
  for (const input of document.querySelectorAll('input[name="mode"]')) {
    input.checked = input.value === setup.mode;
    input.disabled = input.value === "live" && !hasMaster;
  }
  $("#mode-live").classList.toggle("disabled", !hasMaster);
  $("#mode-live").title = hasMaster ? "" : "Le partite dal vivo hanno bisogno di un master";
  $("#setup-suggestion").textContent = `Suggeriti per ${n} giocatori: ${formatCounts(suggestedCounts(n))}.`;

  $("#role-counters").replaceChildren(...ROLE_ORDER.map((r) => {
    const role = ROLES[r];
    const hint = r === "citizen" ? "Riempiono i posti rimasti" : role.max === 1 ? "Max 1" : `Max ${maxWolves(n)}`;
    const out = el("output", {}, String(setup[r]));
    let stepper;
    if (r === "citizen") {
      stepper = el("span", { class: "stepper" }, out);
    } else {
      const max = Math.min(role.max ?? Infinity, r === "wolf" ? maxWolves(n) : Infinity);
      stepper = el("span", { class: "stepper" },
        stepButton("−", `Meno ${role.plural}`, setup[r] <= (role.min ?? 0), () => changeCount(r, -1)),
        out,
        stepButton("+", `Più ${role.plural}`, setup[r] >= max || setup.citizen <= 0, () => changeCount(r, +1)));
    }
    return el("li", { class: "role-row" },
      el("span", { class: "role-icon" }, role.icon),
      el("span", { class: "role-info" }, role.plural, el("small", {}, hint)),
      stepper);
  }));

  const error = setupError(setup, n);
  $("#setup-error").textContent = error;
  $("#btn-assign").disabled = !!error || n < MIN_PLAYERS;
}

function stepButton(label, aria, disabled, onclick) {
  return el("button", { type: "button", "aria-label": aria, disabled, onclick }, label);
}

function changeCount(role, delta) {
  setup[role] += delta;
  setup.citizen -= delta;
  renderGame();
}

// --- roles ---

function renderMyRole() {
  const role = ROLES[myRole];
  $("#card-role").hidden = false;
  const btn = $("#btn-reveal");
  btn.setAttribute("aria-expanded", String(revealed));
  btn.classList.toggle("team-wolves", role.team === "wolves");
  $("#role-icon").textContent = role.icon;
  $("#role-name").textContent = isDead(uid) ? `${role.name} (fuori gioco)` : role.name;
  $("#role-desc").textContent = role.desc;
  let extra = "";
  if (myRole === "wolf" && pack) {
    const others = pack.filter((id) => id !== uid);
    extra = others.length ? `Il tuo branco: ${listNames(others)}` : "Sei l'unico lupo.";
  } else if (myRole === "seer") {
    const seen = Object.entries(visions).sort(([a], [b]) => a - b);
    extra = seen.length ? `Le tue visioni: ${seen.map(([r, v]) => `notte ${r}, ${visionText(v)}`).join(" · ")}` : "";
  }
  $("#role-pack").textContent = extra;
  $("#game-counts").textContent = game().counts ? `In questa partita: ${formatCounts(game().counts)}` : "";
}

function renderMasterRoles() {
  $("#card-master-roles").hidden = false;
  $("#master-counts").textContent = game().counts ? formatCounts(game().counts) : "";
  const entries = Object.entries(secrets?.roles || {}).sort(([a, ra], [b, rb]) =>
    (isDead(a) - isDead(b)) || (ROLE_ORDER.indexOf(ra) - ROLE_ORDER.indexOf(rb)) || playerName(a).localeCompare(playerName(b)));
  $("#master-role-list").replaceChildren(...entries.map(([id, r]) => {
    const li = playerRow(id, playerName(id));
    li.append(roleBadge(r));
    return li;
  }));
}

// --- assigned ---

function masterAssigned() {
  const live = game().mode === "live";
  phaseCard("", "Ruoli distribuiti",
    text(live
      ? "Chiedi a tutti di guardare il proprio ruolo di nascosto e poi di mettere via il telefono. La notte la guidi tu da qui."
      : "Chiedi a tutti di guardare il proprio ruolo di nascosto. Quando siete pronti, inizia la prima notte."),
    action("🌙 Inizia la notte 1", run(startNight)));
}

function playerAssigned() {
  const live = game().mode === "live";
  phaseCard("", "Ruoli distribuiti",
    text(live
      ? "Guarda il tuo ruolo qui sotto senza farlo vedere a nessuno, poi metti via il telefono: il master guida la partita a voce."
      : "Guarda il tuo ruolo qui sotto senza farlo vedere a nessuno. La prima notte sta per iniziare."),
    hostTools(action("🌙 Inizia la notte 1", run(startNight))));
}

/** Buttons only the host sees in a masterless remote game. */
function hostTools(...buttons) {
  if (!isHostOnly()) return null;
  return el("div", { class: "host-tools" }, text("Sei l'host di questa partita.", "muted small"), buttons);
}

// --- night, live mode (master) ---

function liveNight() {
  const g = game();
  const roles = secrets.roles || {};
  const steps = nightSteps(g.counts);
  const step = steps.includes(g.step) ? g.step : "sleep";
  const idx = steps.indexOf(step);
  const go = (updates = {}) => update(ref(db), { ...updates, [gamePath("step")]: steps[idx + 1] });
  const back = idx > 0
    ? action("← Indietro", run(() => set(ref(db, gamePath("step")), steps[idx - 1])), { cls: "link" })
    : null;
  const progress = el("ul", { class: "steps" }, steps.map((s, i) =>
    el("li", { class: i === idx ? "on" : i < idx ? "done" : "" }, STEP_LABELS[s])));
  const living = aliveIds(alive());
  const title = `🌙 Notte ${g.round}`;

  if (step === "sleep") {
    return phaseCard("night", title, progress,
      say("Scende la notte sul villaggio. Tutti chiudono gli occhi."),
      action("Avanti: chiama i lupi", run(() => go())));
  }

  if (step === "wolves") {
    const wolves = livingWithRole(roles, alive(), "wolf");
    const prey = living.filter((id) => roles[id] !== "wolf");
    return phaseCard("night", title, progress,
      say("Lupi, aprite gli occhi… e scegliete la vostra vittima."),
      text(`🐺 ${wolves.length === 1 ? "Il lupo è" : "I lupi sono"} ${listNames(wolves)}. Tocca il giocatore che indicano:`),
      choiceList(prey, liveSel, pickLocal),
      action(liveSel ? `Conferma: i lupi attaccano ${playerName(liveSel)}` : "Scegli la vittima", run(() =>
        go({ [`secrets/${code}/wolfVotes`]: Object.fromEntries(wolves.map((w) => [w, liveSel])) })), { disabled: !liveSel }),
      text("Poi: “Lupi, chiudete gli occhi.”", "muted small"),
      back);
  }

  if (NIGHT_ROLES.includes(step)) {
    const role = ROLES[step];
    const [holder] = livingWithRole(roles, alive(), step);
    const roleName = role.name.toLowerCase();
    if (!holder) {
      return phaseCard("night", title, progress, say(NIGHT_PROMPTS[step]),
        text(`${role.icon} Il ${roleName} è fuori gioco. Chiamalo comunque, così nessuno se ne accorge, aspetta qualche secondo e continua.`),
        action("Continua", run(() => go())), back);
    }
    const updates = () => {
      const u = { [`secrets/${code}/actions/${holder}`]: liveSel };
      if (step === "seer") u[`secrets/${code}/visions/${holder}/${g.round}`] = { target: liveSel, wolf: seerSees(roles, liveSel) };
      return u;
    };
    const answer = step === "seer" && liveSel
      ? el("p", { class: "vision" + (seerSees(roles, liveSel) ? " wolf" : "") },
        seerSees(roles, liveSel) ? "👍 Sì, è un lupo" : "👎 No, non è un lupo")
      : null;
    return phaseCard("night", title, progress, say(NIGHT_PROMPTS[step]),
      text(`${role.icon} ${playerName(holder)} è il ${roleName}. Tocca il giocatore che indica:`),
      choiceList(living.filter((id) => id !== holder), liveSel, pickLocal),
      answer,
      answer && text("Fai un cenno al veggente: pollice in su se è un lupo, in giù se non lo è.", "muted small"),
      action(liveSel ? `Conferma: ${NIGHT_VERBS[step]} ${playerName(liveSel)}` : "Scegli un giocatore", run(() => go(updates())), { disabled: !liveSel }),
      text(`Poi: “${role.name}, chiudi gli occhi.”`, "muted small"),
      back);
  }

  // dawn
  const res = resolveNight(roles, alive(), secrets.wolfVotes || {}, secrets.actions || {});
  return phaseCard("night", title, progress,
    say("Sorge il sole. Tutti aprono gli occhi."),
    el("p", { class: "big-news" }, res.victim ? `☠️ Vittima della notte: ${playerName(res.victim)}` : "🌅 Stanotte nessuno è morto"),
    res.reason !== "killed" && text(`🔒 Solo per te: ${describeNight(res)}`, "secret-note"),
    action("Annuncialo e inizia il giorno", run(resolveNightNow)),
    back);
}

// --- day, live mode (master) ---

function liveDay() {
  const g = game();
  const vote = g.vote || { ballot: 1 };
  const living = aliveIds(alive());
  const candidates = vote.candidates ? Object.keys(vote.candidates) : living;
  const title = `☀️ Giorno ${g.round}`;
  const news = nightNews();

  if (vote.done) return dayResult(title, news, vote);

  if (tieMode) {
    const toggle = (id) => {
      if (tieSel.has(id)) tieSel.delete(id);
      else tieSel.add(id);
      renderGame();
    };
    return phaseCard("day", title, news,
      text("Seleziona i giocatori a pari voti:"),
      choiceList(candidates, tieSel, toggle),
      action(tieSel.size >= 2 ? `Ballottaggio tra ${listNames([...tieSel])}` : "Seleziona almeno 2 giocatori",
        run(() => applyVoteResult({ runoff: [...tieSel] })), { disabled: tieSel.size < 2 }),
      action("Annulla", () => { tieMode = false; renderGame(); }, { cls: "link" }));
  }

  const runoff = vote.ballot === 2;
  return phaseCard("day", title, news,
    say(runoff ? `Ballottaggio tra ${listNames(candidates)}: si vota di nuovo!` : "Discutete… poi ognuno indichi chi pensa sia un lupo."),
    text("Tocca il giocatore con più voti:"),
    choiceList(candidates, liveSel, pickLocal),
    action(liveSel ? `Elimina ${playerName(liveSel)}` : "Scegli un giocatore", run(() => applyVoteResult({ eliminated: liveSel })), { disabled: !liveSel }),
    runoff
      ? action("Ancora pareggio: nessuno viene eliminato", run(() => applyVoteResult({ eliminated: null })), { cls: "link" })
      : action("C'è un pareggio", () => { tieMode = true; renderGame(); }, { cls: "link" }));
}

// --- live mode (players' phones) ---

function livePlayerNight() {
  const g = game();
  phaseCard("night", `🌙 Notte ${g.round}`,
    text(isDead(uid) ? "Sei fuori gioco: tieni gli occhi chiusi e resta in silenzio." : "Metti via il telefono, chiudi gli occhi e segui la voce del master."));
}

function livePlayerDay() {
  const g = game();
  const vote = g.vote || { ballot: 1 };
  const title = `☀️ Giorno ${g.round}`;
  if (vote.done) return dayResult(title, nightNews(), vote);
  phaseCard("day", title, nightNews(),
    text(vote.ballot === 2
      ? `Ballottaggio tra ${listNames(Object.keys(vote.candidates || {}))}: votate di nuovo a voce.`
      : "Discutete e votate a voce. Il master registra il risultato."));
}

// --- night, remote mode ---

function masterNight() {
  const g = game();
  const roles = secrets.roles || {};
  const wv = secrets.wolfVotes || {};
  const acts = secrets.actions || {};
  const st = nightStatus(roles, alive(), wv, acts);
  const livingWolves = livingWithRole(roles, alive(), "wolf");

  const line = (icon, done, content) => el("li", {}, el("span", { class: "who" }, icon), el("span", { class: done ? "ok" : "pending" }, content));
  const picks = livingWolves.map((w) => `${playerName(w)} → ${wv[w] ? playerName(wv[w]) : "…"}`).join(", ");
  const lines = [
    line("🐺", st.wolves.agreed, st.wolves.agreed ? `I lupi hanno scelto ${playerName(st.wolves.target)}` : `I lupi stanno decidendo: ${picks}`),
  ];
  for (const r of NIGHT_ROLES) {
    if (!g.counts?.[r]) continue;
    const holder = st[r];
    const name = ROLES[r].name.toLowerCase();
    let content;
    if (!holder) content = `Il ${name} è fuori gioco`;
    else if (!acts[holder]) content = `In attesa di ${playerName(holder)} (${name})`;
    else if (r === "seer") content = `${playerName(holder)} guarda ${playerName(acts[holder])}: ${seerSees(roles, acts[holder]) ? "è un lupo" : "non è un lupo"}`;
    else content = `${playerName(holder)} ${NIGHT_VERBS[r]} ${playerName(acts[holder])}`;
    lines.push(line(ROLES[r].icon, !holder || !!acts[holder], content));
  }

  const preview = describeNight(resolveNight(roles, alive(), wv, acts));
  phaseCard("night", `🌙 Notte ${g.round}`,
    text("Tutti chiudono gli occhi. Chi ha un ruolo notturno sceglie dal proprio telefono."),
    el("ul", { class: "status" }, lines),
    text(`Se risolvi ora: ${preview}`, "preview"),
    action("🌅 Alba: risolvi la notte", () => {
      if (!st.complete && !confirm("Non tutti hanno ancora scelto. Le scelte mancanti valgono come nessuna azione. Risolvere comunque?")) return;
      run(resolveNightNow)();
    }));
}

function describeNight(res) {
  switch (res.reason) {
    case "protected": return `i lupi attaccano ${playerName(res.attacked)}, ma il mago protegge la casa. Nessuno muore.`;
    case "medium": return `i lupi attaccano ${playerName(res.attacked)}; il medium è lì e muore al suo posto.`;
    case "killed": return `i lupi uccidono ${playerName(res.victim)}.`;
    default: return "i lupi non si sono messi d'accordo su una vittima. Nessuno muore.";
  }
}

const forceDawn = () => hostTools(action("Qualcuno non risponde? Risolvi la notte adesso", () => {
  if (confirm("Risolvere la notte adesso? Le scelte mancanti valgono come nessuna azione.")) run(resolveNightNow)();
}, { cls: "link" }));

function playerNight() {
  const g = game();
  const title = `🌙 Notte ${g.round}`;
  const living = aliveIds(alive());
  const others = living.filter((id) => id !== uid);

  if (isDead(uid)) return phaseCard("night", title, text("Sei fuori gioco. Resta in silenzio e goditi il resto della partita."), forceDawn());

  if (myRole === "wolf") {
    if (!pack) return phaseCard("night", title, text("Caricamento del branco…"));
    const packRoles = Object.fromEntries(pack.map((id) => [id, "wolf"]));
    const { target, agreed } = wolfTarget(packRoles, alive(), wolfVotes);
    const prey = living.filter((id) => !pack.includes(id));
    const pickers = (id) => {
      const who = Object.keys(wolfVotes).filter((w) => wolfVotes[w] === id && alive()[w] === true);
      return who.length ? el("span", { class: "voters" }, `🐺 ${listNames(who)}`) : null;
    };
    return phaseCard("night", title,
      text(agreed ? `Il branco è d'accordo: stanotte tocca a ${playerName(target)}.` : "Scegli la vittima di stanotte. Tutti i lupi vivi devono scegliere lo stesso giocatore."),
      choiceList(prey, wolfVotes[uid], (id) => set(ref(db, `secrets/${code}/wolfVotes/${uid}`), id), pickers),
      forceDawn());
  }
  if (myRole === "seer") {
    const vision = visions[g.round];
    if (!myAction) {
      return phaseCard("night", title, text("Scegli un giocatore: scoprirai se è un lupo. Una sola visione per notte, e non si può cambiare."),
        choiceList(others, null, (id) => {
          if (!confirm(`Vuoi scoprire ${playerName(id)}? Non potrai cambiare.`)) return;
          return set(ref(db, `secrets/${code}/actions/${uid}`), id);
        }),
        forceDawn());
    }
    return phaseCard("night", title,
      vision ? el("p", { class: "vision" + (vision.wolf ? " wolf" : "") }, visionText(vision)) : text("Gli spiriti stanno rispondendo…"),
      text("Tieni per te la tua visione. Ora chiudi gli occhi fino al mattino."),
      forceDawn());
  }
  if (myRole === "magician" || myRole === "medium") {
    const prompt = myRole === "magician"
      ? "Scegli la casa da proteggere stanotte. Nessuno al suo interno può essere ucciso."
      : "Scegli la casa da visitare stanotte. Se i lupi la attaccano, muori tu al posto del padrone di casa.";
    return phaseCard("night", title, text(prompt),
      choiceList(others, myAction, (id) => set(ref(db, `secrets/${code}/actions/${uid}`), id)),
      forceDawn());
  }
  phaseCard("night", title, text("Chiudi gli occhi… Il villaggio dorme fino al mattino."), forceDawn());
}

// --- day, remote mode ---

function nightNews() {
  const g = game();
  const night = logEntries().find((e) => e.type === "night" && e.round === g.round);
  return el("p", { class: "news" + (night?.victim ? " death" : "") },
    night?.victim ? `☠️ Vittima della notte: ${playerName(night.victim)}.` : "🌅 Stanotte nessuno è morto.");
}

function dayResult(title, news, vote) {
  const g = game();
  const result = vote.eliminated
    ? `⚖️ Il villaggio ha eliminato ${playerName(vote.eliminated)}.`
    : "⚖️ Oggi nessuno viene eliminato.";
  const next = action(`🌙 Inizia la notte ${g.round + 1}`, run(startNight));
  return phaseCard("day", title, news, el("p", { class: "news death" }, result),
    isMaster() ? next : isHostOnly() ? hostTools(next)
      : text(`In attesa che ${lobby.masterId ? "il master" : playerName(lobby.hostId)} inizi la notte…`));
}

function renderDay() {
  const g = game();
  const master = isMaster();
  const vote = g.vote || { ballot: 1 };
  const living = aliveIds(alive());
  const candidates = vote.candidates ? Object.keys(vote.candidates) : living;
  const votes = lobby.votes || {};
  const { counts } = tallyVotes(votes, alive(), vote.candidates || null);
  const voted = votedCount(votes, vote, living);
  const title = `☀️ Giorno ${g.round}`;

  if (vote.done) return dayResult(title, nightNews(), vote);

  const voters = (id) => {
    const who = Object.keys(votes).filter((v) => votes[v] === id && alive()[v] === true && v !== id);
    return who.length ? el("span", { class: "voters" }, `👉 ${listNames(who)}`) : null;
  };
  const canVote = !master && !isDead(uid);
  const shown = candidates
    .filter((id) => !canVote || id !== uid)
    .sort((a, b) => (counts[b] || 0) - (counts[a] || 0) || playerName(a).localeCompare(playerName(b)));
  const list = choiceList(shown, master ? null : votes[uid],
    canVote ? (id) => set(lobbyRef("votes", uid), id) : null,
    voters, (id) => el("span", { class: "tally" }, String(counts[id] || 0)));

  const intro = vote.ballot === 2
    ? `Ballottaggio tra ${listNames(candidates)}: votate di nuovo, solo tra loro.`
    : canVote ? "Discutete, poi vota chi pensi sia un lupo. Puoi cambiare il voto finché la votazione non si chiude."
      : "Il villaggio sta votando. I voti sono pubblici.";
  const everyone = voted === living.length;
  phaseCard("day", title, nightNews(), text(intro), list,
    text(everyone && !lobby.masterId ? "Hanno votato tutti: la votazione si chiude tra pochi secondi…"
      : `Hanno votato ${voted} giocatori vivi su ${living.length}.`, "muted small"),
    master && action("⚖️ Chiudi la votazione", () => {
      if (!everyone && !confirm("Non hanno ancora votato tutti. Chiudere comunque la votazione?")) return;
      run(closeVoteNow)();
    }),
    isDead(uid) && text("Sei fuori gioco, quindi non puoi votare.", "muted small"),
    hostTools(action("Qualcuno non vota? Chiudi la votazione adesso", () => {
      if (confirm("Chiudere adesso la votazione con i voti dati finora?")) run(closeVoteNow)();
    }, { cls: "link" })));
}

const votedCount = (votes, vote, living) =>
  living.filter((id) => votes[id] && (!vote.candidates || vote.candidates[votes[id]])).length;

// --- over ---

function renderOver() {
  const g = game();
  const reveal = g.reveal || {};
  const ids = Object.keys(reveal).sort((a, b) =>
    (ROLE_ORDER.indexOf(reveal[a]) - ROLE_ORDER.indexOf(reveal[b])) || playerName(a).localeCompare(playerName(b)));
  const back = action("Torna alla stanza", run(endGame));
  phaseCard("", "Partita finita",
    el("p", { class: "winner" }, g.winner === "wolves" ? "🐺 Vincono i lupi!" : "🏡 Vince il villaggio!"),
    el("ul", { class: "plain-list" }, ids.map((id) => {
      const li = playerRow(id, playerName(id));
      li.append(roleBadge(reveal[id]));
      return li;
    })),
    isMaster() ? back : isHostOnly() ? hostTools(back) : text("In attesa di una nuova partita…", "muted small"));
}

// --- history ---

function renderLog() {
  const entries = logEntries();
  if (!entries.length) return;
  const nightLog = isMaster() ? secrets?.nightLog || {} : {};
  $("#game-log").replaceChildren(...entries.map((e) => {
    if (e.type === "night") {
      const detail = nightLog[e.round];
      const secret = [];
      if (detail && detail.reason !== "killed") secret.push(`🔒 ${describeNight(detail)}`);
      if (detail?.seen) secret.push(`🔒 il veggente guarda ${playerName(detail.seen)}: ${detail.seenWolf ? "è un lupo" : "non è un lupo"}.`);
      return el("li", {}, `Notte ${e.round}: `,
        e.victim ? ["i lupi uccidono ", el("strong", {}, playerName(e.victim))] : "nessun morto",
        secret.map((s) => el("span", { class: "secret" }, s)));
    }
    if (e.runoff) return el("li", {}, `Giorno ${e.round}: pareggio tra ${listNames(e.runoff)}, ballottaggio`);
    const votes = e.votes != null ? ` (${plural(e.votes, "voto", "voti")})` : "";
    return el("li", {}, `Giorno ${e.round}: `,
      e.eliminated ? ["il villaggio elimina ", el("strong", {}, playerName(e.eliminated)), votes] : "nessuna eliminazione");
  }));
  $("#card-log").hidden = false;
}

// ---------- remote: the controller answers the seer as soon as they choose ----------

function answerSeer() {
  const g = game();
  if (g?.phase !== "night" || !secretsFresh(g)) return;
  const roles = secrets.roles || {};
  const [seer] = livingWithRole(roles, alive(), "seer");
  const target = seer && secrets.actions?.[seer];
  if (!target || secrets.visions?.[seer]?.[g.round]) return;
  const key = `${g.round}:${seer}`;
  if (visionKey === key) return;
  visionKey = key;
  set(ref(db, `secrets/${code}/visions/${seer}/${g.round}`), { target, wolf: seerSees(roles, target) })
    .catch(() => { visionKey = null; });
}

// ---------- masterless remote: automatic steps (host's phone only) ----------

function autoAdvance() {
  const g = game();
  if (!g || g.mode !== "remote" || !secrets) return cancelAuto();
  if (g.phase === "night") {
    if (!secretsFresh(g)) return cancelAuto();
    const st = nightStatus(secrets.roles || {}, alive(), secrets.wolfVotes || {}, secrets.actions || {});
    // the key includes the choices, so a change during the pause restarts it
    if (st.complete) return scheduleAuto(`night:${g.round}:${JSON.stringify([secrets.wolfVotes, secrets.actions])}`, AUTO_NIGHT_DELAY, resolveNightNow);
  } else if (g.phase === "day" && !g.vote?.done) {
    const vote = g.vote || { ballot: 1 };
    const votes = lobby.votes || {};
    const living = aliveIds(alive());
    if (living.length && votedCount(votes, vote, living) === living.length) {
      return scheduleAuto(`vote:${g.round}:${vote.ballot}:${JSON.stringify(votes)}`, AUTO_VOTE_DELAY, closeVoteNow);
    }
  }
  cancelAuto();
}

function scheduleAuto(key, delay, fn) {
  if (autoKey === key) return;
  cancelAuto();
  autoKey = key;
  autoTimer = setTimeout(() => { autoTimer = null; run(fn)(); }, delay);
}

function cancelAuto() {
  clearTimeout(autoTimer);
  autoTimer = null;
  autoKey = null;
}

// ---------- secret subscriptions ----------

function subscribe(key, path, onData) {
  if (subs[key]) return;
  subs[key] = onValue(ref(db, path), (snap) => onData(snap.val()), () => unsubscribe(key));
}

function unsubscribe(key) {
  subs[key]?.();
  delete subs[key];
}

function syncSecrets() {
  const playing = PLAYING.includes(lobby?.game?.phase);
  if (!playing) {
    for (const key of Object.keys(subs)) unsubscribe(key);
    myRole = undefined;
    pack = null;
    wolfVotes = {};
    myAction = null;
    visions = {};
    secrets = null;
    revealed = false;
    visionKey = null;
    cancelAuto();
    if (lobby?.game?.phase !== "setup") setup = null;
    return;
  }
  // the host of a masterless game needs all secrets to run it, but its screen only shows its own role
  if (isController()) subscribe("all", `secrets/${code}`, (val) => { secrets = val || {}; renderGame(); });
  if (isMaster()) return;
  subscribe("role", `secrets/${code}/roles/${uid}`, (val) => {
    myRole = val;
    if (myRole === "wolf") {
      subscribe("pack", `secrets/${code}/wolves`, (w) => { pack = Object.keys(w || {}); renderGame(); });
      subscribe("wolfVotes", `secrets/${code}/wolfVotes`, (v) => { wolfVotes = v || {}; renderGame(); });
    } else if (NIGHT_ROLES.includes(myRole)) {
      subscribe("action", `secrets/${code}/actions/${uid}`, (v) => { myAction = v; renderGame(); });
      if (myRole === "seer") subscribe("visions", `secrets/${code}/visions/${uid}`, (v) => { visions = v || {}; renderGame(); });
    }
    renderGame();
  });
}

// ---------- lobby subscription & presence ----------

function openLobby(newCode) {
  closeLobby();
  code = newCode;
  store("lupus.lobby", code);
  history.replaceState(null, "", `${location.pathname}?code=${code}`);
  unsubLobby = onValue(lobbyRef(), (snap) => onLobby(snap.val()), (err) => goHome(`Impossibile aprire la stanza: ${err.message}`));
  renderConnection();
}

function onLobby(data) {
  if (!data?.createdAt) {
    goHome(`Nessuna stanza con il codice ${code}.`);
    return;
  }
  lobby = data;
  joined = !!players()[uid];
  if (joined && !myConn) {
    myConn = push(lobbyRef("presence", uid));
    registerPresence();
  }
  // the creator may have left without joining (or the lobby predates hosts): the first player to notice takes over
  if (joined && !players()[lobby.hostId]) set(lobbyRef("hostId"), uid).catch(() => {});
  syncSecrets();
  renderLobby();
  renderGame();
  renderMasterToggle();
  if (firstSnapshot) {
    firstSnapshot = false;
    if (joined) show("lobby");
    else openProfile();
  }
}

function registerPresence() {
  // re-run after every reconnect: the server drops the entry when the connection is lost
  if (!myConn) return;
  onDisconnect(myConn).remove();
  set(myConn, true);
}

function dropPresence() {
  if (!myConn) return Promise.resolve();
  const conn = myConn;
  myConn = null;
  return onDisconnect(conn).cancel().then(() => remove(conn));
}

function closeLobby() {
  if (unsubLobby) unsubLobby();
  unsubLobby = null;
  dropPresence();
  code = null;
  lobby = null;
  joined = false;
  firstSnapshot = true;
  setup = null;
  syncSecrets();
  renderConnection();
}

// ---------- actions: lobby ----------

function randomInt(max) {
  return crypto.getRandomValues(new Uint32Array(1))[0] % max;
}

function randomCode() {
  return Array.from({ length: 4 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
}

async function createLobby() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = randomCode();
    const tx = await runTransaction(ref(db, `lobbies/${candidate}/createdAt`),
      (current) => (current === null ? Date.now() : undefined));
    if (tx.committed) {
      await set(ref(db, `lobbies/${candidate}/hostId`), uid);
      openLobby(candidate);
      return;
    }
  }
  throw new Error("Impossibile trovare un codice libero, riprova.");
}

async function joinCode(input) {
  const c = input.trim().toUpperCase();
  if (!/^[A-Z]{4}$/.test(c)) {
    $("#home-error").textContent = "Il codice è di 4 lettere.";
    return;
  }
  const snap = await get(ref(db, `lobbies/${c}/createdAt`));
  if (!snap.exists()) {
    goHome(`Nessuna stanza con il codice ${c}.`);
    return;
  }
  $("#home-error").textContent = "";
  openLobby(c);
}

async function saveProfile(name, wantMaster) {
  const me = players()[uid];
  if (!me && lobby.game) throw new Error("In questa stanza c'è già una partita in corso.");
  if (!me && Object.keys(players()).length >= MAX_PLAYERS) throw new Error("Questa stanza è piena.");

  const key = nameKey(name);
  const oldKey = me ? nameKey(me.name) : null;
  const claim = (current) => (current === null || current === uid ? uid : undefined);

  const nameTx = await runTransaction(lobbyRef("names", key), claim);
  if (!nameTx.committed) throw new Error("Questo nome è già usato in questa stanza.");

  if (wantMaster) {
    const masterTx = await runTransaction(lobbyRef("masterId"), claim);
    if (!masterTx.committed) {
      if (key !== oldKey) await remove(lobbyRef("names", key));
      const master = players()[masterTx.snapshot.val()];
      throw new Error(`${master?.name || "Qualcuno"} è già il master.`);
    }
  } else if (lobby.masterId === uid) {
    await remove(lobbyRef("masterId"));
  }

  if (oldKey && oldKey !== key) await remove(lobbyRef("names", oldKey));
  await set(lobbyRef("players", uid), { name, joinedAt: me?.joinedAt ?? Date.now() });
}

async function leaveLobby() {
  const me = players()[uid];
  const writes = [remove(lobbyRef("players", uid)), dropPresence()];
  if (me) writes.push(remove(lobbyRef("names", nameKey(me.name))));
  if (lobby.masterId === uid) writes.push(remove(lobbyRef("masterId")));
  if (lobby.hostId === uid) {
    // pass the host role to whoever joined first among the others
    const [next] = Object.entries(players()).filter(([id]) => id !== uid).sort(([, a], [, b]) => a.joinedAt - b.joinedAt);
    writes.push(next ? set(lobbyRef("hostId"), next[0]) : remove(lobbyRef("hostId")));
  }
  await Promise.all(writes);
  goHome();
}

// ---------- actions: game (controller only) ----------

const gamePath = (key) => `lobbies/${code}/game/${key}`;

async function assignRoles() {
  const ids = playerIds();
  const counts = Object.fromEntries(ROLE_ORDER.map((r) => [r, setup[r]]));
  const error = setupError(counts, ids.length) || (ids.length < MIN_PLAYERS ? "Non ci sono abbastanza giocatori." : "")
    || (setup.mode === "live" && !lobby.masterId ? "Le partite dal vivo hanno bisogno di un master." : "");
  if (error) throw new Error(error);

  const roles = dealRoles(ids, counts, randomInt);
  const wolves = Object.fromEntries(ids.filter((id) => roles[id] === "wolf").map((id) => [id, true]));
  // one atomic write: players never see the "assigned" phase before their role exists
  await update(ref(db), {
    [`secrets/${code}`]: { roles, wolves },
    [`lobbies/${code}/votes`]: null,
    [`lobbies/${code}/game`]: {
      phase: "assigned", mode: setup.mode, counts, startedAt: Date.now(), round: 0,
      alive: Object.fromEntries(ids.map((id) => [id, true])),
    },
  });
}

function startNight() {
  const round = (game().round || 0) + 1;
  return update(ref(db), {
    [gamePath("phase")]: "night",
    [gamePath("round")]: round,
    [gamePath("step")]: "sleep",
    [gamePath("vote")]: null,
    [`lobbies/${code}/votes`]: null,
    [`secrets/${code}/wolfVotes`]: null,
    [`secrets/${code}/actions`]: null,
    // marks the secrets as belonging to this night (see secretsFresh)
    [`secrets/${code}/nightLog/${round}`]: { reason: "pending" },
  });
}

/**
 * The lobby and the secrets arrive through separate listeners, so for a moment the controller can see the
 * new night's round together with last night's choices. Only act on the secrets once this night's marker is there.
 */
const secretsFresh = (g) => secrets?.nightLog?.[g.round]?.reason === "pending";

/** Writes shared by night and vote results: log entry, death, and the end of the game if someone won. */
function outcome(updates, entry, victim) {
  const roles = secrets.roles || {};
  updates[gamePath(`log/${logEntries().length}`)] = compact(entry);
  const aliveAfter = { ...alive() };
  if (victim) {
    aliveAfter[victim] = false;
    updates[gamePath(`alive/${victim}`)] = false;
  }
  const won = winner(roles, aliveAfter);
  if (won) {
    updates[gamePath("phase")] = "over";
    updates[gamePath("winner")] = won;
    updates[gamePath("reveal")] = roles;
    updates[gamePath("vote")] = null;
  }
  return won;
}

function resolveNightNow() {
  const g = game();
  if (g?.phase !== "night") return Promise.resolve(); // already resolved (e.g. from another tab)
  const roles = secrets.roles || {};
  const acts = secrets.actions || {};
  const res = resolveNight(roles, alive(), secrets.wolfVotes || {}, acts);
  const [seer] = livingWithRole(roles, alive(), "seer");
  const seen = seer ? acts[seer] : null;
  const updates = {
    [`secrets/${code}/nightLog/${g.round}`]: compact({ ...res, seen, seenWolf: seen ? seerSees(roles, seen) : null }),
  };
  const won = outcome(updates, { type: "night", round: g.round, victim: res.victim }, res.victim);
  if (!won) {
    updates[gamePath("phase")] = "day";
    updates[gamePath("vote")] = { ballot: 1 };
    updates[`lobbies/${code}/votes`] = null;
  }
  return update(ref(db), updates);
}

function closeVoteNow() {
  const g = game();
  if (g?.phase !== "day" || g.vote?.done) return Promise.resolve();
  const vote = g.vote || { ballot: 1 };
  return applyVoteResult(closeVote(vote.ballot, lobby.votes || {}, alive(), vote.candidates || null));
}

/** result: { eliminated } or { runoff: [ids] }, optionally with vote `counts` (remote mode). */
function applyVoteResult(result) {
  const g = game();
  const vote = g.vote || { ballot: 1 };
  const updates = {};
  if (result.runoff) {
    updates[gamePath(`log/${logEntries().length}`)] = { type: "vote", round: g.round, ballot: vote.ballot, runoff: result.runoff };
    updates[gamePath("vote")] = { ballot: 2, candidates: Object.fromEntries(result.runoff.map((id) => [id, true])) };
    updates[`lobbies/${code}/votes`] = null;
    return update(ref(db), updates);
  }
  const eliminated = result.eliminated || null;
  const entry = { type: "vote", round: g.round, ballot: vote.ballot, eliminated, votes: result.counts?.[eliminated] };
  const won = outcome(updates, entry, eliminated);
  if (!won) updates[gamePath("vote")] = compact({ ballot: vote.ballot, done: true, eliminated });
  return update(ref(db), updates);
}

function endGame() {
  return update(ref(db), { [`secrets/${code}`]: null, [`lobbies/${code}/game`]: null, [`lobbies/${code}/votes`]: null });
}

// ---------- rules dialog ----------

function setupInfo() {
  $("#btn-info").addEventListener("click", () => $("#info").showModal());
  $("#btn-info-close").addEventListener("click", () => $("#info").close());
  $("#info").addEventListener("click", (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); }); // backdrop
  renderInfoRoles();
}

function renderInfoRoles() {
  $("#info-roles").replaceChildren(...ROLE_ORDER.map((r) => {
    const role = ROLES[r];
    return el("li", {},
      el("div", { class: "role-title" }, `${role.icon} ${role.name}`,
        badge(role.team === "wolves" ? "🐺 Lupi" : "🏡 Villaggio", `team-tag ${role.team === "wolves" ? "wolf" : ""}`)),
      el("p", {}, role.desc),
      el("p", {}, role.info));
  }));
}

// ---------- events ----------

function bindEvents() {
  $("#btn-create").addEventListener("click", async () => {
    const btn = $("#btn-create");
    btn.disabled = true;
    try {
      await createLobby();
    } catch (err) {
      $("#home-error").textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });

  $("#form-join").addEventListener("submit", (e) => {
    e.preventDefault();
    joinCode($("#input-code").value).catch((err) => ($("#home-error").textContent = err.message));
  });

  $("#input-code").addEventListener("input", (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, "");
  });

  $("#form-profile").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("#input-name").value.trim();
    if (!name) {
      $("#profile-error").textContent = "Inserisci un nome.";
      return;
    }
    const btn = $("#btn-profile-submit");
    btn.disabled = true;
    try {
      await saveProfile(name, $("#input-master").checked);
      store("lupus.lastName", name);
      show("lobby");
    } catch (err) {
      $("#profile-error").textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });

  $("#btn-profile-cancel").addEventListener("click", () => {
    if (joined) show("lobby");
    else goHome();
  });

  $("#btn-edit").addEventListener("click", openProfile);

  $("#btn-leave").addEventListener("click", () => {
    if (confirm("Vuoi uscire dalla stanza?")) run(leaveLobby)();
  });

  $("#btn-start").addEventListener("click", run(() => set(lobbyRef("game"), { phase: "setup" })));

  for (const input of document.querySelectorAll('input[name="mode"]')) {
    input.addEventListener("change", () => {
      setup.mode = input.value;
      renderGame();
    });
  }

  $("#btn-suggest").addEventListener("click", () => {
    setup = setup && { mode: setup.mode }; // keep the chosen mode, recompute the counts
    renderGame();
  });

  $("#btn-cancel-setup").addEventListener("click", run(() => remove(lobbyRef("game"))));

  $("#btn-assign").addEventListener("click", async () => {
    const btn = $("#btn-assign");
    btn.disabled = true;
    try {
      await assignRoles();
    } catch (err) {
      $("#setup-error").textContent = err.message;
      btn.disabled = false;
    }
  });

  $("#btn-end-game").addEventListener("click", () => {
    if (confirm("Terminare la partita e tornare alla stanza? I ruoli verranno cancellati.")) run(endGame)();
  });

  $("#btn-reveal").addEventListener("click", () => {
    revealed = !revealed;
    renderGame();
  });

  $("#btn-copy-code").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(code);
      flash("Codice copiato!");
    } catch {
      flash(`Codice: ${code}`);
    }
  });

  $("#btn-share").addEventListener("click", async () => {
    const url = `${location.origin}${location.pathname}?code=${code}`;
    if (navigator.share) {
      try { await navigator.share({ title: "Lupus in Tabula", text: `Gioca con me! Codice ${code}`, url }); }
      catch { /* user cancelled */ }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      flash("Link di invito copiato!");
    } catch {
      flash(url);
    }
  });
}

function flash(msg) {
  $("#copy-feedback").textContent = msg;
  setTimeout(() => ($("#copy-feedback").innerHTML = "&nbsp;"), 2000);
}

// ---------- boot ----------

async function main() {
  setupInfo(); // the rules are readable even before connecting
  if (!firebaseConfig.apiKey || firebaseConfig.apiKey.startsWith("YOUR_")) {
    show("setup");
    return;
  }
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  db = getDatabase(app);

  // anonymous auth gives each browser a stable id, so a refresh puts you back in your seat
  const existing = await new Promise((resolve) => {
    const stop = onAuthStateChanged(auth, (user) => { stop(); resolve(user); });
  });
  uid = (existing || (await signInAnonymously(auth)).user).uid;

  onValue(ref(db, ".info/connected"), (snap) => {
    online = snap.val() === true;
    renderConnection();
    if (online) registerPresence();
  });

  bindEvents();

  const urlCode = new URLSearchParams(location.search).get("code");
  const startCode = urlCode || store("lupus.lobby");
  show("home");
  if (startCode) {
    $("#input-code").value = startCode.toUpperCase();
    await joinCode(startCode);
  }
}

main().catch((err) => {
  console.error(err);
  show("home");
  $("#home-error").textContent = `Impossibile connettersi: ${err.message}`;
});
