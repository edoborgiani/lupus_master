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
//   secrets/{CODE}/actions/{uid}      tonight's magician/medium choice; readable by its author
//   secrets/{CODE}/nightLog/{round}   what really happened each night, for the master

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getDatabase, ref, get, set, update, remove, push, onValue, onDisconnect, runTransaction,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";
import {
  ROLES, ROLE_ORDER, suggestedCounts, maxWolves, setupError, formatCounts, dealRoles, aliveIds,
  livingWithRole, wolfTarget, nightStatus, resolveNight, tallyVotes, closeVote, winner, nightSteps,
} from "./game.js";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I/O, avoids confusion with 1/0
const MAX_PLAYERS = 30;
const MIN_PLAYERS = 5; // not counting the master
const PLAYING = ["assigned", "night", "day", "over"];
const AUTO_NIGHT_DELAY = 3000; // masterless remote: pause before resolving a complete night
const AUTO_VOTE_DELAY = 5000;  // ... and before closing a vote everyone has cast, so votes can still change
const STEP_LABELS = { sleep: "Sleep", wolves: "🐺 Wolves", magician: "🪄 Magician", medium: "🔮 Medium", dawn: "🌅 Dawn" };

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
let myAction = null;      // magician/medium: tonight's choice
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

const lobbyRef = (...parts) => ref(db, ["lobbies", code, ...parts].join("/"));
const nameKey = (name) => encodeURIComponent(name.trim().toLowerCase()).replace(/\./g, "%2E");
const players = () => lobby?.players || {};
const isMaster = () => !!lobby && lobby.masterId === uid;
const controllerId = () => lobby?.masterId || lobby?.hostId || null;
const isController = () => !!uid && controllerId() === uid;
const isHostOnly = () => isController() && !isMaster(); // masterless remote: the host also plays
const playerIds = () => Object.keys(players()).filter((id) => id !== lobby.masterId);
const playerName = (id) => players()[id]?.name || "(left)";
const listNames = (ids) => ids.map(playerName).join(", ");
const game = () => lobby?.game || null;
const alive = () => game()?.alive || {};
const logEntries = () => Object.values(game()?.log || {});

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
  $("#btn-profile-submit").textContent = joined ? "Save" : "Enter lobby";
  $("#btn-profile-cancel").textContent = joined ? "Cancel" : "Back";
  $("#profile-error").textContent = lobby.game && !joined ? "A game is already in progress in this lobby." : "";
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
    ? `${master?.name || "Someone"} is already the game master.`
    : "The master narrates the game and doesn't play a role. Optional in remote games.";
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
  $("#player-count").textContent = `${playing} player${playing === 1 ? "" : "s"}${hasMaster ? " + master" : ""}`;
  $("#no-master").hidden = hasMaster;
  $("#no-master").textContent = lobby.hostId && players()[lobby.hostId]
    ? `No game master: you can still play a remote game, run by ${playerName(lobby.hostId)}.`
    : "No game master yet.";
}

const isOnline = (id) => !!lobby.presence?.[id];
const isDead = (id) => alive()[id] === false;

function playerRow(id, name) {
  const li = el("li", { class: isDead(id) ? "dead" : "" },
    el("span", { class: "dot" + (isOnline(id) ? "" : " off"), title: isOnline(id) ? "Online" : "Offline" }),
    el("span", { class: "pname" }, name));
  if (id === uid) li.append(badge("you", "you"));
  if (isDead(id)) li.append(badge("💀 dead", ""));
  return li;
}

function badge(text, cls) {
  return el("span", { class: `badge ${cls}` }, text);
}

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

  const runner = lobby.masterId ? "the master" : `${playerName(lobby.hostId)} (host)`;
  if (!phase) {
    if (ctrl) {
      $("#card-start").hidden = false;
      $("#btn-start").disabled = n < MIN_PLAYERS;
      $("#start-hint").textContent = (n < MIN_PLAYERS ? `Waiting for players: ${n} of at least ${MIN_PLAYERS}.` : `${n} players ready.`)
        + (master ? "" : " Without a master you play a remote game, and you play too.");
    } else {
      wait(controllerId() ? `Waiting for ${runner} to start the game…` : "Waiting for a game master to join…");
    }
    return;
  }
  if (phase === "setup") {
    if (ctrl) renderSetup(n);
    else wait(`${runner[0].toUpperCase()}${runner.slice(1)} is choosing the roles…`);
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
    wait("Loading your role…");
  } else if (myRole === null) {
    wait("A game is in progress without you. Wait for the next one!");
  } else {
    renderMyRole();
    (live
      ? { assigned: playerAssigned, night: livePlayerNight, day: livePlayerDay, over: renderOver }
      : { assigned: playerAssigned, night: playerNight, day: renderDay, over: renderOver })[phase]();
  }
  renderLog();
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
  if (!setup || setup.n !== n) {
    // keep the controller's choice if it still fits the new player count, otherwise start from the suggestion
    const keep = setup && n - setup.wolf - setup.magician - setup.medium >= 0;
    const mode = setup?.mode;
    setup = keep ? { ...setup, citizen: n - setup.wolf - setup.magician - setup.medium } : suggestedCounts(n);
    setup.n = n;
    setup.mode = mode;
  }
  if (!setup.mode || (setup.mode === "live" && !hasMaster)) setup.mode = hasMaster ? "live" : "remote";

  $("#card-setup").hidden = false;
  $("#setup-total").textContent = `${n} players`;
  for (const input of document.querySelectorAll('input[name="mode"]')) {
    input.checked = input.value === setup.mode;
    input.disabled = input.value === "live" && !hasMaster;
  }
  $("#mode-live").classList.toggle("disabled", !hasMaster);
  $("#mode-live").title = hasMaster ? "" : "Live games need a game master";
  $("#setup-suggestion").textContent = `Suggested for ${n} players: ${formatCounts(suggestedCounts(n))}.`;

  $("#role-counters").replaceChildren(...ROLE_ORDER.map((r) => {
    const role = ROLES[r];
    const hint = r === "citizen" ? "Fill the remaining places" : role.max === 1 ? "Max 1" : `Max ${maxWolves(n)}`;
    const out = el("output", {}, String(setup[r]));
    let stepper;
    if (r === "citizen") {
      stepper = el("span", { class: "stepper" }, out);
    } else {
      const max = Math.min(role.max ?? Infinity, r === "wolf" ? maxWolves(n) : Infinity);
      stepper = el("span", { class: "stepper" },
        stepButton("−", `Fewer ${role.plural}`, setup[r] <= (role.min ?? 0), () => changeCount(r, -1)),
        out,
        stepButton("+", `More ${role.plural}`, setup[r] >= max || setup.citizen <= 0, () => changeCount(r, +1)));
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
  $("#role-name").textContent = isDead(uid) ? `${role.name} (dead)` : role.name;
  $("#role-desc").textContent = role.desc;
  let packText = "";
  if (myRole === "wolf" && pack) {
    const others = pack.filter((id) => id !== uid);
    packText = others.length ? `Your pack: ${listNames(others)}` : "You are the only wolf.";
  }
  $("#role-pack").textContent = packText;
  $("#game-counts").textContent = game().counts ? `In this game: ${formatCounts(game().counts)}` : "";
}

function renderMasterRoles() {
  $("#card-master-roles").hidden = false;
  $("#master-counts").textContent = game().counts ? formatCounts(game().counts) : "";
  const entries = Object.entries(secrets?.roles || {}).sort(([a, ra], [b, rb]) =>
    (isDead(a) - isDead(b)) || (ROLE_ORDER.indexOf(ra) - ROLE_ORDER.indexOf(rb)) || playerName(a).localeCompare(playerName(b)));
  $("#master-role-list").replaceChildren(...entries.map(([id, r]) => {
    const li = playerRow(id, playerName(id));
    li.append(badge(`${ROLES[r].icon} ${ROLES[r].name}`, r === "wolf" ? "wolf" : r === "citizen" ? "" : "special"));
    return li;
  }));
}

// --- assigned ---

function masterAssigned() {
  const live = game().mode === "live";
  phaseCard("", "Roles dealt",
    text(live
      ? "Ask everyone to check their role in secret on their phone, then put the phones away. You will run the night from here."
      : "Ask everyone to check their role in secret. When you are ready, start the first night."),
    action("🌙 Start night 1", run(startNight)));
}

function playerAssigned() {
  const live = game().mode === "live";
  phaseCard("", "Roles dealt",
    text(live
      ? "Check your role below without letting anyone see it, then put your phone away: the master runs the game out loud."
      : "Check your role below without letting anyone see it. The first night starts soon."),
    hostTools(action("🌙 Start night 1", run(startNight))));
}

/** Buttons only the host sees in a masterless remote game. */
function hostTools(...buttons) {
  if (!isHostOnly()) return null;
  return el("div", { class: "host-tools" }, text("You are the host of this game.", "muted small"), buttons);
}

// --- night, live mode (master) ---

function liveNight() {
  const g = game();
  const roles = secrets.roles || {};
  const steps = nightSteps(g.counts);
  const step = steps.includes(g.step) ? g.step : "sleep";
  const idx = steps.indexOf(step);
  const go = (updates = {}) => update(ref(db), { ...updates, [gamePath("step")]: steps[idx + 1] });
  const back = idx > 0 && step !== "dawn"
    ? action("← Back", run(() => set(ref(db, gamePath("step")), steps[idx - 1])), { cls: "link" })
    : null;
  const progress = el("ul", { class: "steps" }, steps.map((s, i) =>
    el("li", { class: i === idx ? "on" : i < idx ? "done" : "" }, STEP_LABELS[s])));
  const living = aliveIds(alive());
  const title = `🌙 Night ${g.round}`;

  if (step === "sleep") {
    return phaseCard("night", title, progress,
      say("The night falls on the village. Everyone, close your eyes."),
      action("Next: call the wolves", run(() => go())));
  }

  if (step === "wolves") {
    const wolves = livingWithRole(roles, alive(), "wolf");
    const prey = living.filter((id) => roles[id] !== "wolf");
    return phaseCard("night", title, progress,
      say("Wolves, open your eyes… and choose your victim."),
      text(`🐺 The wolves are ${listNames(wolves)}. Tap the player they point at:`),
      choiceList(prey, liveSel, pickLocal),
      action(liveSel ? `Confirm: the wolves attack ${playerName(liveSel)}` : "Select the victim", run(() =>
        go({ [`secrets/${code}/wolfVotes`]: Object.fromEntries(wolves.map((w) => [w, liveSel])) })), { disabled: !liveSel }),
      text("Then: “Wolves, close your eyes.”", "muted small"),
      back);
  }

  if (step === "magician" || step === "medium") {
    const role = ROLES[step];
    const [holder] = livingWithRole(roles, alive(), step);
    const prompt = step === "magician" ? "Magician, open your eyes… whose house do you protect tonight?"
      : "Medium, open your eyes… whose house do you visit tonight?";
    if (!holder) {
      return phaseCard("night", title, progress, say(prompt),
        text(`${role.icon} The ${role.name.toLowerCase()} is dead. Call them anyway, so nobody notices, wait a few seconds, then continue.`),
        action("Continue", run(() => go())), back);
    }
    return phaseCard("night", title, progress, say(prompt),
      text(`${role.icon} ${playerName(holder)} is the ${role.name.toLowerCase()}. Tap the player they point at:`),
      choiceList(living.filter((id) => id !== holder), liveSel, pickLocal),
      action(liveSel ? `Confirm: ${step === "magician" ? "protects" : "visits"} ${playerName(liveSel)}` : "Select a player", run(() =>
        go({ [`secrets/${code}/actions/${holder}`]: liveSel })), { disabled: !liveSel }),
      text(`Then: “${role.name}, close your eyes.”`, "muted small"),
      back);
  }

  // dawn
  const res = resolveNight(roles, alive(), secrets.wolfVotes || {}, secrets.actions || {});
  return phaseCard("night", title, progress,
    say("The sun rises. Everyone, open your eyes."),
    el("p", { class: "big-news" }, res.victim ? `☠️ ${playerName(res.victim)} died tonight` : "🌅 Nobody died tonight"),
    res.reason !== "killed" && text(`🔒 Only for you: ${describeNight(res)}`, "secret-note"),
    action("Announce it and start the day", run(resolveNightNow)),
    action("← Back", run(() => set(ref(db, gamePath("step")), steps[idx - 1])), { cls: "link" }));
}

// --- day, live mode (master) ---

function liveDay() {
  const g = game();
  const vote = g.vote || { ballot: 1 };
  const living = aliveIds(alive());
  const candidates = vote.candidates ? Object.keys(vote.candidates) : living;
  const title = `☀️ Day ${g.round}`;
  const news = nightNews();

  if (vote.done) return dayResult(title, news, vote);

  if (tieMode) {
    const toggle = (id) => {
      if (tieSel.has(id)) tieSel.delete(id);
      else tieSel.add(id);
      renderGame();
    };
    return phaseCard("day", title, news,
      text("Select the players who tied with the most votes:"),
      choiceList(candidates, tieSel, toggle),
      action(tieSel.size >= 2 ? `Start the run-off between ${listNames([...tieSel])}` : "Select at least 2 players",
        run(() => applyVoteResult({ runoff: [...tieSel] })), { disabled: tieSel.size < 2 }),
      action("Cancel", () => { tieMode = false; renderGame(); }, { cls: "link" }));
  }

  const runoff = vote.ballot === 2;
  return phaseCard("day", title, news,
    say(runoff ? `Run-off between ${listNames(candidates)}: vote again!` : "Discuss… then everyone points at who they think is a wolf."),
    text("Tap the player with the most votes:"),
    choiceList(candidates, liveSel, pickLocal),
    action(liveSel ? `Eliminate ${playerName(liveSel)}` : "Select a player", run(() => applyVoteResult({ eliminated: liveSel })), { disabled: !liveSel }),
    runoff
      ? action("Tie again: nobody is eliminated", run(() => applyVoteResult({ eliminated: null })), { cls: "link" })
      : action("It's a tie", () => { tieMode = true; renderGame(); }, { cls: "link" }));
}

// --- live mode (players' phones) ---

function livePlayerNight() {
  const g = game();
  phaseCard("night", `🌙 Night ${g.round}`,
    text(isDead(uid) ? "You are dead: keep your eyes closed and stay silent." : "Put your phone away, close your eyes and follow the master's voice."));
}

function livePlayerDay() {
  const g = game();
  const vote = g.vote || { ballot: 1 };
  const title = `☀️ Day ${g.round}`;
  if (vote.done) return dayResult(title, nightNews(), vote);
  phaseCard("day", title, nightNews(),
    text(vote.ballot === 2
      ? `Run-off between ${listNames(Object.keys(vote.candidates || {}))}: vote again out loud.`
      : "Discuss and vote out loud. The master records the result."));
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
    line("🐺", st.wolves.agreed, st.wolves.agreed ? `Wolves chose ${playerName(st.wolves.target)}` : `Wolves deciding: ${picks}`),
  ];
  if (g.counts?.magician) {
    lines.push(line("🪄", !st.magician || !!acts[st.magician],
      !st.magician ? "The magician is dead" : acts[st.magician]
        ? `${playerName(st.magician)} protects ${playerName(acts[st.magician])}` : `Waiting for ${playerName(st.magician)} (magician)`));
  }
  if (g.counts?.medium) {
    lines.push(line("🔮", !st.medium || !!acts[st.medium],
      !st.medium ? "The medium is dead" : acts[st.medium]
        ? `${playerName(st.medium)} visits ${playerName(acts[st.medium])}` : `Waiting for ${playerName(st.medium)} (medium)`));
  }

  const preview = describeNight(resolveNight(roles, alive(), wv, acts));
  phaseCard("night", `🌙 Night ${g.round}`,
    text("Everyone closes their eyes. Players with a night role choose on their phone."),
    el("ul", { class: "status" }, lines),
    text(`If you resolve now: ${preview}`, "preview"),
    action("🌅 Dawn: resolve the night", () => {
      if (!st.complete && !confirm("Not everyone has chosen yet. Missing choices count as no action. Resolve anyway?")) return;
      run(resolveNightNow)();
    }));
}

function describeNight(res) {
  switch (res.reason) {
    case "protected": return `the wolves attack ${playerName(res.attacked)}, but the magician protects the house. Nobody dies.`;
    case "medium": return `the wolves attack ${playerName(res.attacked)}; the medium is there and dies in their place.`;
    case "killed": return `${playerName(res.victim)} is killed by the wolves.`;
    default: return "the wolves have not agreed on a victim. Nobody dies.";
  }
}

const forceDawn = () => hostTools(action("Someone isn't responding? Resolve the night now", () => {
  if (confirm("Resolve the night now? Missing choices count as no action.")) run(resolveNightNow)();
}, { cls: "link" }));

function playerNight() {
  const g = game();
  const title = `🌙 Night ${g.round}`;
  const living = aliveIds(alive());
  const others = living.filter((id) => id !== uid);

  if (isDead(uid)) return phaseCard("night", title, text("You are dead. Stay silent and enjoy the rest of the game."), forceDawn());

  if (myRole === "wolf") {
    if (!pack) return phaseCard("night", title, text("Loading your pack…"));
    const packRoles = Object.fromEntries(pack.map((id) => [id, "wolf"]));
    const { target, agreed } = wolfTarget(packRoles, alive(), wolfVotes);
    const prey = living.filter((id) => !pack.includes(id));
    const pickers = (id) => {
      const who = Object.keys(wolfVotes).filter((w) => wolfVotes[w] === id && alive()[w] === true);
      return who.length ? el("span", { class: "voters" }, `🐺 ${listNames(who)}`) : null;
    };
    return phaseCard("night", title,
      text(agreed ? `The pack agrees: ${playerName(target)} is tonight's victim.` : "Choose tonight's victim. All living wolves must choose the same player."),
      choiceList(prey, wolfVotes[uid], (id) => set(ref(db, `secrets/${code}/wolfVotes/${uid}`), id), pickers),
      forceDawn());
  }
  if (myRole === "magician" || myRole === "medium") {
    const prompt = myRole === "magician"
      ? "Choose whose house to protect tonight. Nobody in it can be killed."
      : "Choose whose house to visit tonight. If the wolves attack it, you die in their place.";
    return phaseCard("night", title, text(prompt),
      choiceList(others, myAction, (id) => set(ref(db, `secrets/${code}/actions/${uid}`), id)),
      forceDawn());
  }
  phaseCard("night", title, text("Close your eyes… The village sleeps until morning."), forceDawn());
}

// --- day, remote mode ---

function nightNews() {
  const g = game();
  const night = logEntries().find((e) => e.type === "night" && e.round === g.round);
  return el("p", { class: "news" + (night?.victim ? " death" : "") },
    night?.victim ? `☠️ ${playerName(night.victim)} was killed during the night.` : "🌅 Nobody died during the night.");
}

function dayResult(title, news, vote) {
  const g = game();
  const result = vote.eliminated
    ? `⚖️ ${playerName(vote.eliminated)} was eliminated by the village.`
    : "⚖️ Nobody is eliminated today.";
  const next = action(`🌙 Start night ${g.round + 1}`, run(startNight));
  return phaseCard("day", title, news, el("p", { class: "news death" }, result),
    isMaster() ? next : isHostOnly() ? hostTools(next) : text(`Waiting for ${lobby.masterId ? "the master" : playerName(lobby.hostId)} to start the night…`));
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
  const title = `☀️ Day ${g.round}`;

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
    ? `Run-off between ${listNames(candidates)}: vote again, only among them.`
    : canVote ? "Discuss, then vote who you think is a wolf. You can change your vote until the vote closes."
      : "The village is voting. Votes are public.";
  const everyone = voted === living.length;
  phaseCard("day", title, nightNews(), text(intro), list,
    text(everyone && !master ? "Everyone has voted: the vote closes in a few seconds…" : `${voted} of ${living.length} living players have voted.`, "muted small"),
    master && action("⚖️ Close the vote", () => {
      if (!everyone && !confirm("Not everyone has voted yet. Close the vote anyway?")) return;
      run(closeVoteNow)();
    }),
    isDead(uid) && text("You are dead, so you can't vote.", "muted small"),
    hostTools(action("Someone isn't voting? Close the vote now", () => {
      if (confirm("Close the vote now with the votes cast so far?")) run(closeVoteNow)();
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
  const back = action("Back to the lobby", run(endGame));
  phaseCard("", "Game over",
    el("p", { class: "winner" }, g.winner === "wolves" ? "🐺 The wolves win!" : "🏡 The village wins!"),
    el("ul", { class: "plain-list" }, ids.map((id) => {
      const li = playerRow(id, playerName(id));
      li.append(badge(`${ROLES[reveal[id]].icon} ${ROLES[reveal[id]].name}`, reveal[id] === "wolf" ? "wolf" : ""));
      return li;
    })),
    isMaster() ? back : isHostOnly() ? hostTools(back) : text("Waiting for a new game…", "muted small"));
}

// --- history ---

function renderLog() {
  const entries = logEntries();
  if (!entries.length) return;
  const nightLog = isMaster() ? secrets?.nightLog || {} : {};
  $("#game-log").replaceChildren(...entries.map((e) => {
    if (e.type === "night") {
      const detail = nightLog[e.round];
      const secret = detail && detail.reason !== "killed" ? el("span", { class: "secret" }, `🔒 ${describeNight(detail)}`) : null;
      return el("li", {}, `Night ${e.round}: `,
        e.victim ? [el("strong", {}, playerName(e.victim)), " was killed"] : "nobody died", secret);
    }
    if (e.runoff) return el("li", {}, `Day ${e.round}: tie between ${listNames(e.runoff)}, run-off`);
    const votes = e.votes != null ? ` (${e.votes} vote${e.votes === 1 ? "" : "s"})` : "";
    return el("li", {}, `Day ${e.round}: `,
      e.eliminated ? [el("strong", {}, playerName(e.eliminated)), ` eliminated${votes}`] : "nobody eliminated");
  }));
  $("#card-log").hidden = false;
}

// ---------- masterless remote: automatic steps (host's phone only) ----------

function autoAdvance() {
  const g = game();
  if (!g || g.mode !== "remote" || !secrets) return cancelAuto();
  if (g.phase === "night") {
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
    secrets = null;
    revealed = false;
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
    } else if (myRole === "magician" || myRole === "medium") {
      subscribe("action", `secrets/${code}/actions/${uid}`, (v) => { myAction = v; renderGame(); });
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
  unsubLobby = onValue(lobbyRef(), (snap) => onLobby(snap.val()), (err) => goHome(`Could not open lobby: ${err.message}`));
  renderConnection();
}

function onLobby(data) {
  if (!data?.createdAt) {
    goHome(`No lobby with code ${code}.`);
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
  throw new Error("Could not find a free lobby code, please retry.");
}

async function joinCode(input) {
  const c = input.trim().toUpperCase();
  if (!/^[A-Z]{4}$/.test(c)) {
    $("#home-error").textContent = "The code is 4 letters.";
    return;
  }
  const snap = await get(ref(db, `lobbies/${c}/createdAt`));
  if (!snap.exists()) {
    goHome(`No lobby with code ${c}.`);
    return;
  }
  $("#home-error").textContent = "";
  openLobby(c);
}

async function saveProfile(name, wantMaster) {
  const me = players()[uid];
  if (!me && lobby.game) throw new Error("A game is already in progress in this lobby.");
  if (!me && Object.keys(players()).length >= MAX_PLAYERS) throw new Error("This lobby is full.");

  const key = nameKey(name);
  const oldKey = me ? nameKey(me.name) : null;
  const claim = (current) => (current === null || current === uid ? uid : undefined);

  const nameTx = await runTransaction(lobbyRef("names", key), claim);
  if (!nameTx.committed) throw new Error("That name is already taken in this lobby.");

  if (wantMaster) {
    const masterTx = await runTransaction(lobbyRef("masterId"), claim);
    if (!masterTx.committed) {
      if (key !== oldKey) await remove(lobbyRef("names", key));
      const master = players()[masterTx.snapshot.val()];
      throw new Error(`${master?.name || "Someone"} is already the game master.`);
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
  const counts = { wolf: setup.wolf, magician: setup.magician, medium: setup.medium, citizen: setup.citizen };
  const error = setupError(counts, ids.length) || (ids.length < MIN_PLAYERS ? "Not enough players." : "")
    || (setup.mode === "live" && !lobby.masterId ? "Live games need a game master." : "");
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
  return update(ref(db), {
    [gamePath("phase")]: "night",
    [gamePath("round")]: (game().round || 0) + 1,
    [gamePath("step")]: "sleep",
    [gamePath("vote")]: null,
    [`lobbies/${code}/votes`]: null,
    [`secrets/${code}/wolfVotes`]: null,
    [`secrets/${code}/actions`]: null,
  });
}

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
  const res = resolveNight(secrets.roles || {}, alive(), secrets.wolfVotes || {}, secrets.actions || {});
  const updates = { [`secrets/${code}/nightLog/${g.round}`]: compact(res) };
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
      $("#profile-error").textContent = "Please enter a name.";
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
    if (confirm("Leave this lobby?")) run(leaveLobby)();
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
    if (confirm("End this game and go back to the lobby? Roles will be cleared.")) run(endGame)();
  });

  $("#btn-reveal").addEventListener("click", () => {
    revealed = !revealed;
    renderGame();
  });

  $("#btn-copy-code").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(code);
      flash("Code copied!");
    } catch {
      flash(`Code: ${code}`);
    }
  });

  $("#btn-share").addEventListener("click", async () => {
    const url = `${location.origin}${location.pathname}?code=${code}`;
    if (navigator.share) {
      try { await navigator.share({ title: "Lupus in Tabula", text: `Join my game! Code ${code}`, url }); }
      catch { /* user cancelled */ }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      flash("Invite link copied!");
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
  $("#home-error").textContent = `Could not connect: ${err.message}`;
});
