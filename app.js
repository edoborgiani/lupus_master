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
//   lobbies/{CODE}/settings           { mode, rules } chosen by the controller before the game
//   lobbies/{CODE}/seen/{uid}         true once the player has looked at their role
//   lobbies/{CODE}/game               { phase, mode, rules, counts, round, step, alive, vote, log, revealed, winner, reveal }
//   lobbies/{CODE}/votes/{uid}        remote day vote: uid voted against (public, like pointing)
// Secret data, readable only by the controller (and per database.rules.json):
//   secrets/{CODE}/roles/{uid}        role id; each player can read only their own
//   secrets/{CODE}/wolves/{uid}       true; readable by wolves so they know their pack
//   secrets/{CODE}/wolfVotes/{uid}    tonight's victim chosen by each wolf; readable by wolves
//   secrets/{CODE}/actions/{uid}      tonight's seer/magician/medium choice; readable by its author
//   secrets/{CODE}/visions/{uid}/{round}  the seer's answers { target, wolf, role? }; readable by the seer
//   secrets/{CODE}/memo/{uid}         { lastProtected } for the magician; readable by its owner
//   secrets/{CODE}/nightLog/{round}   what really happened each night, for the master

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getDatabase, ref, get, set, update, remove, push, onValue, onDisconnect, runTransaction, goOnline, goOffline,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";
import {
  ROLES, ROLE_ORDER, NIGHT_ROLES, DEFAULT_RULES, RULE_OPTIONS, withDefaults, suggestedCounts, maxWolves, setupError,
  dealRoles, aliveIds, livingWithRole, wolfTarget, wolvesAct, protectable, nightStatus, seerVision, resolveNight,
  tallyVotes, closeVote, revealsRole, winner, nightSteps, SKIP, seerCanLook, seerUsedBefore, SPECIAL_ROLES,
} from "./game.js";
import { LANGS, t, getLang, setLang, roleName, roleDesc, roleInfo, guideHtml, translatePage } from "./i18n.js";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I/O, avoids confusion with 1/0
const MAX_PLAYERS = 30;
const MIN_PLAYERS = 5; // not counting the master
const PLAYING = ["assigned", "night", "day", "over"];
const AUTO_NIGHT_DELAY = 3000; // masterless remote: pause before resolving a complete night
const AUTO_VOTE_DELAY = 5000;  // ... and before closing a vote everyone has cast, so votes can still change
const RULE_GROUPS = [
  ["wolf", ["firstNightKill", "wolvesWin"]],
  ["seer", ["seerSees", "seerUses"]],
  ["magician", ["magicianSelf", "magicianRepeat"]],
  ["medium", ["mediumAwayDies"]],
  ["mason", ["masonsWake"]],
  ["prole", ["seerSeesProle"]],
  ["vote", ["secondTie", "selfVote", "reveal"]],
];

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
let visions = {};         // seer only: { round: { target, wolf, role? } }
let memo = {};            // magician only: { lastProtected }
let masons = null;        // masons only: the uids of all masons
let bittenRound = null;   // the night this player was turned into a wolf (prole), if any
let secrets = null;       // controller only: everything under secrets/{CODE}
let setup = null;         // controller only: role counts being chosen
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
const playerName = (id) => players()[id]?.name || t("left");
const listNames = (ids) => ids.map(playerName).join(", ");
const game = () => lobby?.game || null;
const alive = () => game()?.alive || {};
const logEntries = () => Object.values(game()?.log || {});
/** Rules in force: frozen in the game once it starts, otherwise the room's settings. */
const rules = () => withDefaults(game()?.rules || lobby?.settings?.rules);
/** Way of playing chosen for the room; live needs a master. */
const roomMode = () => {
  const m = lobby?.settings?.mode || (lobby?.masterId ? "live" : "remote");
  return m === "live" && !lobby?.masterId ? "remote" : m;
};
/** Whether the seer already had a vision before tonight (for the "once per game" rule), from what this phone knows. */
const seerUsed = (seerId, round) => seerUsedBefore(seerId === uid ? visions : secrets?.visions?.[seerId], round);
const seerSpent = (seerId, round) => !seerCanLook(rules(), seerUsed(seerId, round));
const runnerName = () => (lobby.masterId ? t("theMaster") : t("hostOf", playerName(lobby.hostId)));
/** The role's pixel-art icon (icons/<role>.svg). */
const roleIcon = (r, cls = "ri") => el("img", { class: cls, src: `icons/${r}.svg`, alt: "" });
/** A paragraph led by a role's icon. */
const iconText = (r, s, cls = "phase-text") => el("p", { class: `${cls} with-icon` }, roleIcon(r), el("span", {}, s));
/** Team tag for the guide and settings tiles. */
const teamBadge = (team) => badge([roleIcon(team === "wolves" ? "wolf" : "citizen"), team === "wolves" ? t("teamWolves") : t("teamVillage")],
  `team-tag ${team === "wolves" ? "wolf" : ""}`);
const visionText = (v) => (v.role ? t("isRole", playerName(v.target), roleName(v.role))
  : v.wolf ? t("isWolf", playerName(v.target)) : t("notWolf", playerName(v.target)));
const formatCounts = (counts) => ROLE_ORDER.filter((r) => counts[r] > 0)
  .map((r) => `${counts[r]} ${roleName(r, counts[r])}`).join(" · ");
const describeNight = (res) => t(`res_${res.reason}`, playerName(res.reason === "killed" ? res.victim : res.attacked));

// ---------- screens ----------

function show(name) {
  for (const s of document.querySelectorAll(".screen")) s.hidden = s.id !== `screen-${name}`;
}

function goHome(error = "") {
  // stay connected only while in a room: the free plan counts simultaneous connections
  closeLobby().finally(() => { if (!code) goOffline(db); });
  store("lupus.lobby", null);
  history.replaceState(null, "", location.pathname);
  $("#home-error").textContent = error;
  show("home");
}

function openProfile() {
  const me = players()[uid];
  $("#input-name").value = me?.name || store("lupus.lastName") || "";
  $("#input-master").checked = lobby.masterId === uid;
  $("#profile-error").textContent = lobby.game && !joined ? t("gameInProgress") : "";
  renderProfileButtons();
  renderMasterToggle();
  show("profile");
  if (!$("#input-name").value) $("#input-name").focus();
}

function renderProfileButtons() {
  $("#btn-profile-submit").textContent = joined ? t("save") : t("enterRoom");
  $("#btn-profile-cancel").textContent = joined ? t("cancel") : t("back");
}

// ---------- rendering: lobby ----------

function renderMasterToggle() {
  if (!lobby) return;
  const master = players()[lobby.masterId];
  const takenByOther = !!lobby.masterId && lobby.masterId !== uid;
  const input = $("#input-master");
  input.disabled = takenByOther;
  if (takenByOther) input.checked = false;
  input.closest(".toggle").classList.toggle("disabled", takenByOther);
  $("#master-hint").textContent = takenByOther ? t("masterTaken", master?.name || t("someone")) : t("masterHint");
}

function renderLobby() {
  for (const e of document.querySelectorAll(".code-label")) e.textContent = code;

  const list = Object.entries(players()).map(([id, p]) => ({ id, name: p.name, isMaster: id === lobby.masterId }));
  list.sort((a, b) => (b.isMaster - a.isMaster) || a.name.localeCompare(b.name));

  $("#player-list").replaceChildren(...list.map((p) => {
    const li = playerRow(p.id, p.name);
    if (p.isMaster) li.append(badge(t("master"), "master"));
    else if (!lobby.masterId && p.id === lobby.hostId) li.append(badge(t("host"), "special"));
    const shown = game()?.revealed?.[p.id];
    if (shown) li.append(roleBadge(shown));
    return li;
  }));

  const hasMaster = list.some((p) => p.isMaster);
  const playing = list.length - hasMaster;
  $("#player-count").textContent = t("playersCount", playing) + (hasMaster ? t("plusMaster") : "");
  $("#no-master").hidden = hasMaster;
  $("#no-master").textContent = lobby.hostId && players()[lobby.hostId]
    ? t("noMasterHost", playerName(lobby.hostId)) : t("noMasterYet");
}

const isOnline = (id) => !!lobby.presence?.[id];
const isDead = (id) => alive()[id] === false;
const hasSeen = (id) => !!lobby.seen?.[id];

/** One player row. While the roles are being looked at, the dot shows who has seen theirs instead of who is online. */
function playerRow(id, name) {
  const checking = game()?.phase === "assigned" && alive()[id] !== undefined;
  const dot = checking
    ? el("span", { class: "dot" + (hasSeen(id) ? "" : " waiting"), title: hasSeen(id) ? t("seenYes") : t("seenNo") })
    : el("span", { class: "dot" + (isOnline(id) ? "" : " off"), title: isOnline(id) ? t("online") : t("offline") });
  const li = el("li", { class: isDead(id) ? "dead" : "" }, dot, el("span", { class: "pname" }, name));
  if (id === uid) li.append(badge(t("you"), "you"));
  if (isDead(id)) li.append(el("span", { class: "skull", title: t("out"), "aria-label": t("out") }, "💀"));
  return li;
}

function badge(text, cls) {
  return el("span", { class: `badge ${cls}` }, text);
}

const roleBadge = (r) => badge([roleIcon(r), roleName(r)], r === "wolf" ? "wolf" : r === "citizen" ? "" : "special");

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
  $("#wait-mode").textContent = "";
  $("#card-share").hidden = !!g;
  $("#card-players").hidden = playing && master;
  $("#btn-edit").hidden = !!g;
  $("#btn-leave").hidden = !!g && ctrl;

  const modeLabel = roomMode() === "live" ? t("modeLive") : t("modeRemote");
  if (!phase) {
    if (ctrl) renderStart(n, master);
    else {
      wait(controllerId() ? t("waitStart", runnerName()) : t("waitMaster"));
      if (controllerId()) $("#wait-mode").textContent = t("chosenMode", modeLabel);
    }
    return;
  }
  if (phase === "setup") {
    if (ctrl) renderSetup(n, modeLabel);
    else {
      wait(lobby.masterId ? t("masterChoosing") : t("hostChoosing", playerName(lobby.hostId)));
      $("#wait-mode").textContent = t("chosenMode", modeLabel);
    }
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
    wait(t("loadingRole"));
  } else if (myRole === null) {
    wait(t("notInGame"));
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

const text = (s, cls = "phase-text") => el("p", { class: cls }, s);
const say = (s) => el("p", { class: "say" }, `“${s}”`);
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

// --- before the game (controller) ---

function renderStart(n, master) {
  $("#card-start").hidden = false;
  const hasMaster = !!lobby.masterId;
  for (const input of document.querySelectorAll('input[name="mode"]')) {
    input.checked = input.value === roomMode();
    input.disabled = input.value === "live" && !hasMaster;
  }
  $("#mode-live").classList.toggle("disabled", !hasMaster);
  $("#mode-live").title = hasMaster ? "" : t("liveNeedsMaster");
  $("#btn-start").disabled = n < MIN_PLAYERS;
  $("#start-hint").textContent = (n < MIN_PLAYERS ? t("waitingPlayers", n, MIN_PLAYERS) : t("playersReady", n))
    + (master ? "" : t("noMasterRemote"));
}

function renderSetup(n, modeLabel) {
  const specials = (s) => SPECIAL_ROLES.reduce((sum, r) => sum + (s[r] || 0), 0);
  if (!setup || setup.n !== n) {
    // keep the controller's choice if it still fits the new player count, otherwise start from the suggestion
    const keep = setup && n - specials(setup) >= 0;
    setup = keep ? { ...setup, citizen: n - specials(setup) } : suggestedCounts(n);
    setup.n = n;
  }

  $("#card-setup").hidden = false;
  $("#setup-total").textContent = t("nPlayers", n);
  $("#setup-mode").textContent = t("chosenMode", modeLabel);
  $("#setup-suggestion").textContent = t("suggested", n, formatCounts(suggestedCounts(n)));

  $("#role-counters").replaceChildren(...ROLE_ORDER.map((r) => {
    const role = ROLES[r];
    const hint = r === "citizen" ? t("fillRest") : role.group ? t("zeroOrTwo") : t("max", role.max === 1 ? 1 : maxWolves(n));
    const out = el("output", {}, String(setup[r]));
    let stepper;
    if (r === "citizen") {
      stepper = el("span", { class: "stepper" }, out);
    } else {
      const max = Math.min(role.max ?? Infinity, r === "wolf" ? maxWolves(n) : Infinity);
      stepper = el("span", { class: "stepper" },
        stepButton("−", t("fewer", roleName(r, 2)), setup[r] <= (role.min ?? 0), () => changeCount(r, -1)),
        out,
        stepButton("+", t("more", roleName(r, 2)), setup[r] >= max || setup.citizen < (role.group && !setup[r] ? role.group : 1),
          () => changeCount(r, +1)));
    }
    return el("li", { class: "role-row" },
      el("span", { class: "role-icon" }, roleIcon(r)),
      el("span", { class: "role-info" }, roleName(r, 2), el("small", {}, hint)),
      stepper);
  }));

  const error = setupError(setup, n);
  $("#setup-error").textContent = error ? t(`err_${error}`, maxWolves(n), n) : "";
  $("#btn-assign").disabled = !!error || n < MIN_PLAYERS;
}

function stepButton(label, aria, disabled, onclick) {
  return el("button", { type: "button", "aria-label": aria, disabled, onclick }, label);
}

function changeCount(role, delta) {
  // roles that come in groups (masons) jump straight between 0 and the group size
  const group = ROLES[role].group;
  if (group && ((delta > 0 && !setup[role]) || (delta < 0 && setup[role] === group))) delta *= group;
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
  $("#role-icon").replaceChildren(roleIcon(myRole, "ri-big"));
  $("#role-name").textContent = roleName(myRole) + (isDead(uid) ? t("outSuffix") : "");
  $("#role-desc").textContent = roleDesc(myRole, rules());
  let extra = "";
  if (myRole === "wolf" && pack) {
    const others = pack.filter((id) => id !== uid);
    extra = (bittenRound ? `${t("bitten")} ` : "") + (others.length ? t("yourPack", listNames(others)) : t("onlyWolf"));
  } else if (myRole === "mason" && masons) {
    extra = t("yourMasons", listNames(masons.filter((id) => id !== uid)));
  } else if (myRole === "seer") {
    const seen = Object.entries(visions).filter(([, v]) => v).sort(([a], [b]) => a - b);
    extra = seen.length ? t("yourVisions", seen.map(([r, v]) => `${t("nightN", r)}: ${visionText(v)}`).join(" · ")) : "";
  }
  $("#role-pack").textContent = extra;
  $("#game-counts").textContent = game().counts ? t("inThisGame", formatCounts(game().counts)) : "";
}

function renderMasterRoles() {
  $("#card-master-roles").hidden = false;
  $("#master-counts").textContent = game().counts ? formatCounts(game().counts) : "";
  const entries = Object.entries(secrets?.roles || {}).sort(([a, ra], [b, rb]) =>
    (isDead(a) - isDead(b)) || (ROLE_ORDER.indexOf(ra) - ROLE_ORDER.indexOf(rb)) || playerName(a).localeCompare(playerName(b)));
  $("#master-role-list").replaceChildren(...entries.map(([id, r]) => {
    const li = playerRow(id, playerName(id));
    li.append(roleBadge(r));
    if (secrets.converted?.[id]) li.lastChild.append(t("exProle"));
    return li;
  }));
}

// --- assigned: everyone looks at their role ---

const inGame = () => aliveIds(alive());
const seenCount = () => inGame().filter(hasSeen).length;
const everyoneSeen = () => seenCount() === inGame().length;

function seenStatus(legend = true) {
  const n = inGame().length;
  return [
    text(everyoneSeen() ? t("seenAll") : t("seenCount", seenCount(), n), "seen-note"),
    legend && text(t("seenLegend"), "muted small"),
  ];
}

function startFirstNight() {
  const ready = everyoneSeen();
  return action(ready ? t("startNight", 1) : t("waitSeen"), run(startNight), { disabled: !ready });
}

function masterAssigned() {
  const live = game().mode === "live";
  phaseCard("", t("rolesDealt"),
    text(live ? t("masterAssignedLive") : t("masterAssignedRemote")),
    seenStatus(false),
    startFirstNight());
}

function playerAssigned() {
  const live = game().mode === "live";
  phaseCard("", t("rolesDealt"),
    text(live ? t("playerAssignedLive") : t("playerAssignedRemote")),
    seenStatus(),
    hostTools(startFirstNight()));
}

/** Buttons only the host sees in a masterless remote game. */
function hostTools(...buttons) {
  if (!isHostOnly()) return null;
  return el("div", { class: "host-tools" }, text(t("youAreHost"), "muted small"), buttons);
}

// --- night, live mode (master) ---

function liveNight() {
  const g = game();
  const roles = secrets.roles || {};
  const steps = nightSteps(g.counts, g.round, rules());
  const step = steps.includes(g.step) ? g.step : "sleep";
  const idx = steps.indexOf(step);
  const go = (updates = {}) => update(ref(db), { ...updates, [gamePath("step")]: steps[idx + 1] });
  const back = idx > 0
    ? action(t("back2"), run(() => set(ref(db, gamePath("step")), steps[idx - 1])), { cls: "link" })
    : null;
  const stepRole = { wolves: "wolf", masons: "mason", seer: "seer", magician: "magician", medium: "medium" };
  const progress = el("ul", { class: "steps" }, steps.map((s, i) =>
    el("li", { class: i === idx ? "on" : i < idx ? "done" : "" }, stepRole[s] && roleIcon(stepRole[s]), t(`step_${s}`))));
  const living = aliveIds(alive());
  const title = t("night", g.round);

  if (step === "sleep") {
    return phaseCard("night", title, progress, say(t("saySleep")), action(t("callWolves"), run(() => go())));
  }

  if (step === "wolves") {
    const wolves = livingWithRole(roles, alive(), "wolf");
    if (!wolvesAct(rules(), g.round)) {
      return phaseCard("night", title, progress, say(t("sayWolvesFirst")),
        iconText("wolf", t("wolvesFirstNight", listNames(wolves))),
        action(t("continue"), run(() => go())), text(t("thenWolves"), "muted small"), back);
    }
    const prey = living.filter((id) => roles[id] !== "wolf");
    return phaseCard("night", title, progress,
      say(t("sayWolves")),
      iconText("wolf", t("wolvesAre", wolves.length, listNames(wolves))),
      choiceList(prey, liveSel, pickLocal),
      action(liveSel ? t("confirmAttack", playerName(liveSel)) : t("chooseVictim"), run(() =>
        go({ [`secrets/${code}/wolfVotes`]: Object.fromEntries(wolves.map((w) => [w, liveSel])) })), { disabled: !liveSel }),
      text(t("thenWolves"), "muted small"),
      back);
  }

  if (step === "masons") {
    const living = livingWithRole(roles, alive(), "mason");
    return phaseCard("night", title, progress, say(t("sayMasons")),
      iconText("mason", living.length ? t("masonsAre", listNames(living)) : t("masonsOut")),
      action(t("continue"), run(() => go())), text(t("thenMasons"), "muted small"), back);
  }

  if (NIGHT_ROLES.includes(step)) {
    const [holder] = livingWithRole(roles, alive(), step);
    const name = roleName(step).toLowerCase();
    if (!holder) {
      return phaseCard("night", title, progress, say(t(`say_${step}`)),
        iconText(step, t("roleIsOut", name)), action(t("continue"), run(() => go())), back);
    }
    if (step === "seer" && seerSpent(holder, g.round)) {
      return phaseCard("night", title, progress, say(t(`say_${step}`)),
        iconText(step, t("seerSpentLive", playerName(holder))), action(t("continue"), run(() => go())), back);
    }
    const options = step === "magician"
      ? protectable(roles, alive(), rules(), lastProtected(g.round))
      : living.filter((id) => id !== holder);
    const updates = () => {
      const u = { [`secrets/${code}/actions/${holder}`]: liveSel };
      if (step === "seer") {
        u[`secrets/${code}/visions/${holder}/${g.round}`] = seerVision(roles, liveSel, rules());
        u[`secrets/${code}/memo/${holder}/used`] = true;
      }
      return u;
    };
    let answer = null;
    if (step === "seer" && liveSel) {
      const v = seerVision(roles, liveSel, rules());
      answer = [
        el("p", { class: "vision" + (v.wolf ? " wolf" : "") }, v.role ? t("seerRole", roleName(v.role)) : v.wolf ? t("seerYes") : t("seerNo")),
        text(v.role ? t("seerSignalRole") : t("seerSignal"), "muted small"),
      ];
    }
    return phaseCard("night", title, progress, say(t(`say_${step}`)),
      iconText(step, t("holderIs", playerName(holder), name)),
      choiceList(options, liveSel, pickLocal),
      answer,
      action(liveSel ? t("confirmAction", t(`verb_${step}`), playerName(liveSel)) : t("choosePlayer"),
        run(() => go(updates())), { disabled: !liveSel }),
      text(t("thenClose", roleName(step)), "muted small"),
      step === "seer" && rules().seerUses === "once" && action(t("seerSkipLive"), run(() => go()), { cls: "link" }),
      back);
  }

  // dawn
  const res = resolveNightFromSecrets(g.round);
  return phaseCard("night", title, progress,
    say(t("sayDawn")),
    el("p", { class: "big-news" }, res.victim ? t("victimBig", playerName(res.victim)) : t("nobodyBig")),
    res.reason !== "killed" && text(t("onlyForYou", describeNight(res)), "secret-note"),
    res.converted && text(t("convertedNote", playerName(res.converted)), "secret-note"),
    action(t("announceDay"), run(resolveNightNow)),
    back);
}

// --- day, live mode (master) ---

function liveDay() {
  const g = game();
  const vote = g.vote || { ballot: 1 };
  const living = aliveIds(alive());
  const candidates = vote.candidates ? Object.keys(vote.candidates) : living;
  const title = t("day", g.round);
  const news = nightNews();

  if (vote.done) return dayResult(title, news, vote);

  if (tieMode) {
    const toggle = (id) => {
      if (tieSel.has(id)) tieSel.delete(id);
      else tieSel.add(id);
      renderGame();
    };
    return phaseCard("day", title, news,
      text(t("tiedSelect")),
      choiceList(candidates, tieSel, toggle),
      action(tieSel.size >= 2 ? t("runoffBetween", listNames([...tieSel])) : t("selectTwo"),
        run(() => applyVoteResult({ runoff: [...tieSel] })), { disabled: tieSel.size < 2 }),
      action(t("cancel"), () => { tieMode = false; renderGame(); }, { cls: "link" }));
  }

  const runoff = vote.ballot === 2;
  const random = rules().secondTie === "random";
  return phaseCard("day", title, news,
    say(runoff ? t("sayRunoff", listNames(candidates)) : t("sayVote")),
    text(t("tapMostVotes")),
    choiceList(candidates, liveSel, pickLocal),
    action(liveSel ? t("eliminate", playerName(liveSel)) : t("choosePlayer"), run(() => applyVoteResult({ eliminated: liveSel })), { disabled: !liveSel }),
    runoff
      ? action(random ? t("tieAgainRandom") : t("tieAgainNone"), run(() => applyVoteResult(random
        ? { eliminated: candidates[randomInt(candidates.length)], drawn: true }
        : { eliminated: null })), { cls: "link" })
      : action(t("tie"), () => { tieMode = true; renderGame(); }, { cls: "link" }));
}

// --- live mode (players' phones) ---

function livePlayerNight() {
  phaseCard("night", t("night", game().round), text(isDead(uid) ? t("liveNightDead") : t("liveNight")));
}

function livePlayerDay() {
  const g = game();
  const vote = g.vote || { ballot: 1 };
  const title = t("day", g.round);
  if (vote.done) return dayResult(title, nightNews(), vote);
  phaseCard("day", title, nightNews(),
    text(vote.ballot === 2 ? t("liveRunoff", listNames(Object.keys(vote.candidates || {}))) : t("liveVote")));
}

// --- night, remote mode ---

function masterNight() {
  const g = game();
  const roles = secrets.roles || {};
  const wv = secrets.wolfVotes || {};
  const acts = secrets.actions || {};
  const [seer] = livingWithRole(roles, alive(), "seer");
  const st = nightStatus(roles, alive(), wv, acts, { rules: rules(), round: g.round, seerUsed: seer ? seerUsed(seer, g.round) : false });
  const livingWolves = livingWithRole(roles, alive(), "wolf");

  const line = (icon, done, content) => el("li", {}, el("span", { class: "who" }, icon), el("span", { class: done ? "ok" : "pending" }, content));
  const picks = livingWolves.map((w) => `${playerName(w)} → ${wv[w] ? playerName(wv[w]) : "…"}`).join(", ");
  const lines = [
    line(roleIcon("wolf"), st.wolvesDone, !wolvesAct(rules(), g.round) ? t("wolvesFirst")
      : st.wolves.agreed ? t("wolvesChose", playerName(st.wolves.target)) : t("wolvesDeciding", picks)),
  ];
  for (const r of NIGHT_ROLES) {
    if (!g.counts?.[r]) continue;
    const holder = st[r];
    const name = roleName(r).toLowerCase();
    let content;
    if (!holder) content = t("roleOut", name);
    else if (r === "seer" && st.seerSpent) content = t("seerSpentLine", playerName(holder));
    else if (acts[holder] === SKIP) content = t("seerSkipsLine", playerName(holder));
    else if (!acts[holder]) content = t("waitingFor", playerName(holder), name);
    else if (r === "seer") content = t("seerLooked", playerName(holder), playerName(acts[holder]), visionText(seerVision(roles, acts[holder], rules())));
    else content = t("actionLine", playerName(holder), t(`verb_${r}`), playerName(acts[holder]));
    lines.push(line(roleIcon(r), !holder || !!acts[holder] || (r === "seer" && st.seerSpent), content));
  }

  phaseCard("night", t("night", g.round),
    text(t("remoteNightIntro")),
    el("ul", { class: "status" }, lines),
    text(t("ifResolveNow", describeNight(resolveNightFromSecrets(g.round))), "preview"),
    action(t("dawnButton"), () => {
      if (!st.complete && !confirm(t("confirmIncomplete"))) return;
      run(resolveNightNow)();
    }));
}

const forceDawn = () => hostTools(action(t("forceDawn"), () => {
  if (confirm(t("confirmForceDawn"))) run(resolveNightNow)();
}, { cls: "link" }));

function playerNight() {
  const g = game();
  const title = t("night", g.round);
  const living = aliveIds(alive());
  const others = living.filter((id) => id !== uid);

  if (isDead(uid)) return phaseCard("night", title, text(t("deadNight")), forceDawn());

  if (myRole === "wolf") {
    if (!pack) return phaseCard("night", title, text(t("loadingPack")));
    if (!wolvesAct(rules(), g.round)) return phaseCard("night", title, text(t("firstNightWolf")), forceDawn());
    const packRoles = Object.fromEntries(pack.map((id) => [id, "wolf"]));
    const { target, agreed } = wolfTarget(packRoles, alive(), wolfVotes);
    const prey = living.filter((id) => !pack.includes(id));
    const pickers = (id) => {
      const who = Object.keys(wolfVotes).filter((w) => wolfVotes[w] === id && alive()[w] === true);
      return who.length ? el("span", { class: "voters" }, roleIcon("wolf"), listNames(who)) : null;
    };
    return phaseCard("night", title,
      text(agreed ? t("packAgrees", playerName(target)) : t("chooseVictimRemote")),
      choiceList(prey, wolfVotes[uid], (id) => set(ref(db, `secrets/${code}/wolfVotes/${uid}`), id), pickers),
      forceDawn());
  }
  if (myRole === "seer") {
    const vision = visions[g.round];
    const once = rules().seerUses === "once";
    if (seerSpent(uid, g.round)) return phaseCard("night", title, text(t("seerSpent")), forceDawn());
    if (myAction === SKIP) return phaseCard("night", title, text(t("seerSkipped")), forceDawn());
    if (!myAction) {
      return phaseCard("night", title,
        text(once ? t("seerPromptOnce") : rules().seerSees === "role" ? t("seerPromptRole") : t("seerPrompt")),
        choiceList(others, null, (id) => {
          if (!confirm(t("seerConfirm", playerName(id)))) return;
          return set(ref(db, `secrets/${code}/actions/${uid}`), id);
        }),
        once && action(t("seerSkip"), run(() => set(ref(db, `secrets/${code}/actions/${uid}`), SKIP)), { cls: "secondary" }),
        forceDawn());
    }
    return phaseCard("night", title,
      vision ? el("p", { class: "vision" + (vision.wolf ? " wolf" : "") }, visionText(vision)) : text(t("spiritsAnswering")),
      text(t("keepVision")),
      forceDawn());
  }
  if (myRole === "magician") {
    const r = rules();
    const options = living.filter((id) => (r.magicianSelf || id !== uid) && (r.magicianRepeat || id !== memo.lastProtected));
    return phaseCard("night", title, text(t("magicianPrompt")),
      choiceList(options, myAction, (id) => set(ref(db, `secrets/${code}/actions/${uid}`), id)),
      forceDawn());
  }
  if (myRole === "medium") {
    return phaseCard("night", title, text(t("mediumPrompt")),
      choiceList(others, myAction, (id) => set(ref(db, `secrets/${code}/actions/${uid}`), id)),
      forceDawn());
  }
  phaseCard("night", title, text(t("villageSleeps")), forceDawn());
}

// --- day ---

function nightNews() {
  const g = game();
  const night = logEntries().find((e) => e.type === "night" && e.round === g.round);
  const shown = night?.victim && g.revealed?.[night.victim];
  return [
    el("p", { class: "news" + (night?.victim ? " death" : "") },
      night?.victim ? t("newsVictim", playerName(night.victim)) + (shown ? t("wasRole", roleName(shown)) : "") : t("newsNobody")),
    // only on the bitten prole's own phone
    bittenRound === g.round && el("p", { class: "news death" }, t("bitten")),
  ];
}

function dayResult(title, news, vote) {
  const g = game();
  const shown = vote.eliminated && g.revealed?.[vote.eliminated];
  const result = vote.eliminated
    ? (vote.drawn ? t("drawnBy", playerName(vote.eliminated)) : t("eliminatedBy", playerName(vote.eliminated)))
      + (shown ? t("wasRole", roleName(shown)) : "")
    : t("nobodyEliminated");
  const next = action(t("startNight", g.round + 1), run(startNight));
  return phaseCard("day", title, news, el("p", { class: "news death" }, result),
    isMaster() ? next : isHostOnly() ? hostTools(next)
      : text(t("waitNight", lobby.masterId ? t("theMaster") : playerName(lobby.hostId))));
}

function renderDay() {
  const g = game();
  const master = isMaster();
  const vote = g.vote || { ballot: 1 };
  const living = aliveIds(alive());
  const candidates = vote.candidates ? Object.keys(vote.candidates) : living;
  const votes = lobby.votes || {};
  const r = rules();
  const { counts } = tallyVotes(votes, alive(), vote.candidates || null, r);
  const voted = votedCount(votes, vote, living);
  const title = t("day", g.round);

  if (vote.done) return dayResult(title, nightNews(), vote);

  const voters = (id) => {
    const who = Object.keys(votes).filter((v) => votes[v] === id && alive()[v] === true && (v !== id || r.selfVote));
    return who.length ? el("span", { class: "voters" }, `👉 ${listNames(who)}`) : null;
  };
  const canVote = !master && !isDead(uid);
  const shown = candidates
    .filter((id) => !canVote || id !== uid || r.selfVote)
    .sort((a, b) => (counts[b] || 0) - (counts[a] || 0) || playerName(a).localeCompare(playerName(b)));
  const list = choiceList(shown, master ? null : votes[uid],
    canVote ? (id) => set(lobbyRef("votes", uid), id) : null,
    voters, (id) => el("span", { class: "tally" }, String(counts[id] || 0)));

  const intro = vote.ballot === 2 ? t("remoteRunoff", listNames(candidates)) : canVote ? t("remoteVote") : t("watchVote");
  const everyone = voted === living.length;
  phaseCard("day", title, nightNews(), text(intro), list,
    text(everyone && !lobby.masterId ? t("allVoted") : t("votedCount", voted, living.length), "muted small"),
    master && action(t("closeVote"), () => {
      if (!everyone && !confirm(t("confirmCloseVote"))) return;
      run(closeVoteNow)();
    }),
    isDead(uid) && text(t("deadNoVote"), "muted small"),
    hostTools(action(t("forceClose"), () => {
      if (confirm(t("confirmForceClose"))) run(closeVoteNow)();
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
  const back = action(t("backToRoom"), run(endGame));
  phaseCard("", t("gameOver"),
    el("p", { class: "winner" }, roleIcon(g.winner === "wolves" ? "wolf" : "citizen"), g.winner === "wolves" ? t("wolvesWin") : t("villageWins")),
    el("ul", { class: "plain-list" }, ids.map((id) => {
      const li = playerRow(id, playerName(id));
      li.append(roleBadge(reveal[id]));
      if (g.converted?.[id]) li.lastChild.append(t("exProle"));
      return li;
    })),
    isMaster() ? back : isHostOnly() ? hostTools(back) : text(t("waitNewGame"), "muted small"));
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
      if (detail && detail.reason !== "killed" && detail.reason !== "pending") secret.push(`🔒 ${describeNight(detail)}`);
      if (detail?.seen) secret.push(t("logSeer", playerName(detail.seen), detail.seenWolf ? t("aWolf") : t("notAWolf")));
      return el("li", {}, t("logNight", e.round),
        e.victim ? [t("logKilled"), el("strong", {}, playerName(e.victim))] : t("logNoDeath"),
        secret.map((s) => el("span", { class: "secret" }, s)));
    }
    if (e.runoff) return el("li", {}, t("logRunoff", e.round, listNames(e.runoff)));
    const votes = e.votes != null ? ` (${t("votes", e.votes)})` : "";
    return el("li", {}, t("logDay", e.round),
      e.eliminated ? [t("logEliminated"), el("strong", {}, playerName(e.eliminated)), votes, e.drawn ? t("logDrawn") : ""] : t("logNoElim"));
  }));
  $("#card-log").hidden = false;
}

// ---------- settings: language and house rules ----------

function renderSettings() {
  for (const input of document.querySelectorAll('input[name="lang"]')) input.checked = input.value === getLang();
  const list = $("#rules-list");
  if (!lobby) {
    $("#rules-note").textContent = t("noRoom");
    list.replaceChildren();
    return;
  }
  const locked = !!game();
  const editable = isController() && !locked;
  $("#rules-note").textContent = locked ? t("rulesLocked") : editable ? t("rulesEditable") : t("rulesReadOnly", runnerName());
  list.classList.toggle("rules-disabled", !editable);
  const r = rules();
  const save = (key, value) => set(lobbyRef("settings", "rules", key), value).catch((err) => alert(err.message));
  list.replaceChildren(...RULE_GROUPS.map(([group, keys]) => el("div", { class: "rule-tile" },
    el("div", { class: "role-title" }, group === "vote" ? t("group_vote") : [roleIcon(group), roleName(group)],
      ROLES[group] && teamBadge(ROLES[group].team)),
    ...keys.map((key) => {
      const desc = typeof DEFAULT_RULES[key] === "boolean" ? t(`rule_${key}_desc`) : "";
      const label = el("span", { class: "rule-text" }, t(`rule_${key}`), desc && el("small", {}, desc));
      if (typeof DEFAULT_RULES[key] === "boolean") {
        const input = el("input", { type: "checkbox", disabled: !editable, onchange: (e) => save(key, e.target.checked) });
        input.checked = r[key];
        return el("label", { class: "rule" }, label,
          el("span", { class: "toggle" + (editable ? "" : " disabled") }, input, el("span", { class: "toggle-ui", "aria-hidden": "true" })));
      }
      const select = el("select", { disabled: !editable, onchange: (e) => save(key, e.target.value), "aria-label": t(`rule_${key}`) },
        RULE_OPTIONS[key].map((o) => el("option", { value: o }, t(`opt_${key}_${o}`))));
      select.value = r[key];
      return el("label", { class: "rule stacked" }, label, select);
    }))));
}

function changeLanguage(lang) {
  setLang(lang);
  store("lupus.lang", lang);
  translatePage();
  renderInfoRoles();
  renderSettings();
  if (lobby) {
    renderLobby();
    renderGame();
    renderMasterToggle();
    renderProfileButtons();
  }
}

function renderInfoRoles() {
  $("#guide-note").textContent = lobby ? t("guideRoom") : t("guideDefault");
  $("#guide").innerHTML = guideHtml(rules()); // our own static text, no player input
  for (const list of document.querySelectorAll(".info-roles")) {
    list.replaceChildren(...ROLE_ORDER.map((r) => {
      const role = ROLES[r];
      return el("li", {},
        el("div", { class: "role-title" }, roleIcon(r), roleName(r), teamBadge(role.team)),
        el("p", {}, roleDesc(r, rules())),
        el("p", {}, roleInfo(r)));
    }));
  }
}

function setupSheets() {
  const sheet = (button, dialog, close, onOpen = () => {}) => {
    $(button).addEventListener("click", () => { onOpen(); $(dialog).showModal(); });
    $(close).addEventListener("click", () => $(dialog).close());
    $(dialog).addEventListener("click", (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); }); // backdrop
  };
  sheet("#btn-info", "#info", "#btn-info-close", renderInfoRoles);
  sheet("#btn-settings", "#settings", "#btn-settings-close", renderSettings);
  for (const input of document.querySelectorAll('input[name="lang"]')) {
    input.addEventListener("change", () => changeLanguage(input.value));
  }
}

// ---------- remote: the controller answers the seer as soon as they choose ----------

function answerSeer() {
  const g = game();
  if (g?.phase !== "night" || !secretsFresh(g)) return;
  const roles = secrets.roles || {};
  const [seer] = livingWithRole(roles, alive(), "seer");
  const target = seer && secrets.actions?.[seer];
  if (!target || target === SKIP || secrets.visions?.[seer]?.[g.round] || seerSpent(seer, g.round)) return;
  const key = `${g.round}:${seer}`;
  if (visionKey === key) return;
  visionKey = key;
  update(ref(db), {
    [`secrets/${code}/visions/${seer}/${g.round}`]: seerVision(roles, target, rules()),
    [`secrets/${code}/memo/${seer}/used`]: true,
  }).catch(() => { visionKey = null; });
}

// ---------- masterless remote: automatic steps (host's phone only) ----------

function autoAdvance() {
  const g = game();
  if (!g || g.mode !== "remote" || !secrets) return cancelAuto();
  if (g.phase === "night") {
    if (!secretsFresh(g)) return cancelAuto();
    const [seer] = livingWithRole(secrets.roles || {}, alive(), "seer");
    const st = nightStatus(secrets.roles || {}, alive(), secrets.wolfVotes || {}, secrets.actions || {},
      { rules: rules(), round: g.round, seerUsed: seer ? seerUsed(seer, g.round) : false });
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
    memo = {};
    masons = null;
    bittenRound = null;
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
      if (myRole === "magician") subscribe("memo", `secrets/${code}/memo/${uid}`, (v) => { memo = v || {}; renderGame(); });
    } else if (myRole === "mason") {
      subscribe("masons", `secrets/${code}/masons`, (m) => { masons = Object.keys(m || {}); renderGame(); });
    }
    if (myRole !== "wolf" || bittenRound) {
      subscribe("converted", `secrets/${code}/converted/${uid}`, (r) => { bittenRound = r || null; renderGame(); });
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
  unsubLobby = onValue(lobbyRef(), (snap) => onLobby(snap.val()), (err) => goHome(t("cantOpen", err.message)));
  renderConnection();
}

function onLobby(data) {
  if (!data?.createdAt) {
    goHome(t("noRoomCode", code));
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
  if ($("#settings").open) renderSettings();
  if ($("#info").open) renderInfoRoles();
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
  const left = dropPresence();
  code = null;
  lobby = null;
  joined = false;
  firstSnapshot = true;
  setup = null;
  syncSecrets();
  renderConnection();
  return left;
}

// ---------- actions: lobby ----------

function randomInt(max) {
  return crypto.getRandomValues(new Uint32Array(1))[0] % max;
}

function randomCode() {
  return Array.from({ length: 4 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
}

async function createLobby() {
  goOnline(db);
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
  throw new Error(t("noFreeCode"));
}

async function joinCode(input) {
  const c = input.trim().toUpperCase();
  if (!/^[A-Z]{4}$/.test(c)) {
    $("#home-error").textContent = t("codeLetters");
    return;
  }
  goOnline(db);
  const snap = await get(ref(db, `lobbies/${c}/createdAt`));
  if (!snap.exists()) {
    goHome(t("noRoomCode", c));
    return;
  }
  $("#home-error").textContent = "";
  openLobby(c);
}

async function saveProfile(name, wantMaster) {
  const me = players()[uid];
  if (!me && lobby.game) throw new Error(t("gameInProgress"));
  if (!me && Object.keys(players()).length >= MAX_PLAYERS) throw new Error(t("roomFull"));

  const key = nameKey(name);
  const oldKey = me ? nameKey(me.name) : null;
  const claim = (current) => (current === null || current === uid ? uid : undefined);

  const nameTx = await runTransaction(lobbyRef("names", key), claim);
  if (!nameTx.committed) throw new Error(t("nameTaken"));

  if (wantMaster) {
    const masterTx = await runTransaction(lobbyRef("masterId"), claim);
    if (!masterTx.committed) {
      if (key !== oldKey) await remove(lobbyRef("names", key));
      const master = players()[masterTx.snapshot.val()];
      throw new Error(t("masterTaken", master?.name || t("someone")));
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
  const err = setupError(counts, ids.length);
  if (err) throw new Error(t(`err_${err}`, maxWolves(ids.length), ids.length));
  if (ids.length < MIN_PLAYERS) throw new Error(t("notEnough"));

  const roles = dealRoles(ids, counts, randomInt);
  const pick = (role) => Object.fromEntries(ids.filter((id) => roles[id] === role).map((id) => [id, true]));
  const wolves = pick("wolf");
  const masonSet = pick("mason");
  // one atomic write: players never see the "assigned" phase before their role exists
  await update(ref(db), {
    [`secrets/${code}`]: compact({ roles, wolves, masons: Object.keys(masonSet).length ? masonSet : null }),
    [`lobbies/${code}/votes`]: null,
    [`lobbies/${code}/seen`]: null,
    [`lobbies/${code}/game`]: {
      phase: "assigned", mode: roomMode(), rules: rules(), counts, startedAt: Date.now(), round: 0,
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

const lastProtected = (round) => secrets?.nightLog?.[round - 1]?.protected || null;

function resolveNightFromSecrets(round) {
  return resolveNight(secrets.roles || {}, alive(), secrets.wolfVotes || {}, secrets.actions || {},
    { rules: rules(), round, lastProtected: lastProtected(round) });
}

/** Writes shared by night and vote results: log entry, death, revealed role and the end of the game if someone won. */
function outcome(updates, entry, victim, how, roles = secrets.roles || {}) {
  updates[gamePath(`log/${logEntries().length}`)] = compact(entry);
  const aliveAfter = { ...alive() };
  if (victim) {
    aliveAfter[victim] = false;
    updates[gamePath(`alive/${victim}`)] = false;
    if (revealsRole(rules(), how)) updates[gamePath(`revealed/${victim}`)] = roles[victim];
  }
  const won = winner(roles, aliveAfter, rules());
  if (won) {
    updates[gamePath("phase")] = "over";
    updates[gamePath("winner")] = won;
    updates[gamePath("reveal")] = roles;
    if (secrets.converted) updates[gamePath("converted")] = secrets.converted;
    updates[gamePath("vote")] = null;
  }
  return won;
}

function resolveNightNow() {
  const g = game();
  if (g?.phase !== "night") return Promise.resolve(); // already resolved (e.g. from another tab)
  const roles = secrets.roles || {};
  const acts = secrets.actions || {};
  const res = resolveNightFromSecrets(g.round);
  const [seer] = livingWithRole(roles, alive(), "seer");
  const [magician] = livingWithRole(roles, alive(), "magician");
  const seen = seer && acts[seer] !== SKIP ? acts[seer] : null;
  const updates = {
    [`secrets/${code}/nightLog/${g.round}`]: compact({ ...res, seen, seenWolf: seen ? seerVision(roles, seen, rules()).wolf : null }),
  };
  if (magician) updates[`secrets/${code}/memo/${magician}`] = compact({ lastProtected: res.protected });
  let rolesAfter = roles;
  if (res.converted) {
    // the bitten prole joins the pack from now on
    const id = res.converted;
    rolesAfter = { ...roles, [id]: "wolf" };
    updates[`secrets/${code}/roles/${id}`] = "wolf";
    updates[`secrets/${code}/wolves/${id}`] = true;
    updates[`secrets/${code}/converted/${id}`] = g.round;
  }
  const won = outcome(updates, { type: "night", round: g.round, victim: res.victim }, res.victim, "night", rolesAfter);
  if (won && res.converted) updates[gamePath("converted")] = { ...(secrets.converted || {}), [res.converted]: g.round };
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
  return applyVoteResult(closeVote(vote.ballot, lobby.votes || {}, alive(), vote.candidates || null, rules(), randomInt));
}

/** result: { eliminated, drawn? } or { runoff: [ids] }, optionally with vote `counts` (remote mode). */
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
  const drawn = result.drawn || null;
  const entry = { type: "vote", round: g.round, ballot: vote.ballot, eliminated, drawn, votes: result.counts?.[eliminated] };
  const won = outcome(updates, entry, eliminated, "vote");
  if (!won) updates[gamePath("vote")] = compact({ ballot: vote.ballot, done: true, eliminated, drawn });
  return update(ref(db), updates);
}

function endGame() {
  return update(ref(db), {
    [`secrets/${code}`]: null, [`lobbies/${code}/game`]: null, [`lobbies/${code}/votes`]: null, [`lobbies/${code}/seen`]: null,
  });
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
      $("#profile-error").textContent = t("enterName");
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
    if (confirm(t("confirmLeave"))) run(leaveLobby)();
  });

  for (const input of document.querySelectorAll('input[name="mode"]')) {
    input.addEventListener("change", () => set(lobbyRef("settings", "mode"), input.value).catch((err) => alert(err.message)));
  }

  $("#btn-start").addEventListener("click", run(() => set(lobbyRef("game"), { phase: "setup" })));

  $("#btn-suggest").addEventListener("click", () => {
    setup = null;
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
    if (confirm(t("confirmEnd"))) run(endGame)();
  });

  $("#btn-reveal").addEventListener("click", () => {
    revealed = !revealed;
    if (revealed && !hasSeen(uid)) set(lobbyRef("seen", uid), true).catch(() => {});
    renderGame();
  });

  $("#btn-copy-code").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(code);
      flash(t("copied"));
    } catch {
      flash(t("codeIs", code));
    }
  });

  $("#btn-share").addEventListener("click", async () => {
    const url = `${location.origin}${location.pathname}?code=${code}`;
    if (navigator.share) {
      try { await navigator.share({ title: "Lupus in Tabula", text: t("inviteText", code), url }); }
      catch { /* user cancelled */ }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      flash(t("linkCopied"));
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

/** Sign in anonymously; if Firebase is briefly refusing new sign-ins (too many from this network), wait and retry. */
async function signInWithRetry(auth) {
  for (let attempt = 1; ; attempt++) {
    try {
      return (await signInAnonymously(auth)).user;
    } catch (err) {
      if (err.code !== "auth/too-many-requests" || attempt >= 6) throw err;
      $("#screen-loading p").textContent = t("connecting");
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    }
  }
}

async function main() {
  // language: saved choice, otherwise the phone's language when it's one we have
  const saved = store("lupus.lang");
  setLang(LANGS.includes(saved) ? saved : (navigator.language || "it").slice(0, 2) === "en" ? "en" : "it");
  translatePage();
  setupSheets(); // rules and settings work even before connecting

  if (!firebaseConfig.apiKey || firebaseConfig.apiKey.startsWith("YOUR_")) {
    show("setup");
    return;
  }
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  db = getDatabase(app);
  goOffline(db); // connect only when creating or joining a room

  // anonymous auth gives each browser a stable id, so a refresh puts you back in your seat
  const existing = await new Promise((resolve) => {
    const stop = onAuthStateChanged(auth, (user) => { stop(); resolve(user); });
  });
  uid = (existing || await signInWithRetry(auth)).uid;

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
  $("#home-error").textContent = t("cantConnect", err.message);
});
