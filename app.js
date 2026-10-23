// Lupus in Tabula companion - client (Firebase Realtime Database)
//
// Data layout, one node per lobby (readable by everyone in it):
//   lobbies/{CODE}/createdAt          timestamp, written once when the lobby is created
//   lobbies/{CODE}/masterId           uid of the game master (claimed with a transaction)
//   lobbies/{CODE}/names/{nameKey}    uid owning that name (keeps names unique)
//   lobbies/{CODE}/players/{uid}      { name, joinedAt }
//   lobbies/{CODE}/presence/{uid}/{connectionId}  true while that tab is online
//   lobbies/{CODE}/game               { phase: "setup" | "assigned", counts, startedAt }
// Secret data, readable only by the master (and per the rules below):
//   secrets/{CODE}/roles/{uid}        role id; each player can read only their own
//   secrets/{CODE}/wolves/{uid}       true; readable by wolves so they know their pack

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getDatabase, ref, get, set, update, remove, push, onValue, onDisconnect, runTransaction,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I/O, avoids confusion with 1/0
const MAX_PLAYERS = 30;
const MIN_PLAYERS = 5; // not counting the master

const ROLES = {
  wolf: {
    name: "Wolf", plural: "Wolves", icon: "🐺", team: "wolves", min: 1,
    desc: "Each night the wolves choose together a player to kill. You win when the wolves are the majority.",
  },
  magician: {
    name: "Magician", plural: "Magicians", icon: "🪄", team: "village", max: 1,
    desc: "Each night you protect one player: the wolves cannot kill them that night.",
  },
  medium: {
    name: "Medium", plural: "Mediums", icon: "🔮", team: "village",
    desc: "Each night you go to a player's house. If the wolves attack that player, you are killed in their place.",
  },
  citizen: {
    name: "Citizen", plural: "Citizens", icon: "🧑‍🌾", team: "village",
    desc: "You are an ordinary villager. During the day, discuss and vote to find and eliminate the wolves.",
  },
};
const SPECIAL_ROLES = ["wolf", "magician", "medium"]; // citizens fill the remaining slots

const $ = (sel) => document.querySelector(sel);

function store(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { return null; }
}

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
let secrets = null;       // master only: { roles, wolves }
let setup = null;         // master only: role counts being chosen
let revealed = false;

const lobbyRef = (...parts) => ref(db, ["lobbies", code, ...parts].join("/"));
const nameKey = (name) => encodeURIComponent(name.trim().toLowerCase()).replace(/\./g, "%2E");
const players = () => lobby?.players || {};
const isMaster = () => !!lobby && lobby.masterId === uid;
const playerIds = () => Object.keys(players()).filter((id) => id !== lobby.masterId);
const playerName = (id) => players()[id]?.name || "(left)";

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
    : "The master narrates the game and doesn't play a role.";
}

function renderLobby() {
  for (const el of document.querySelectorAll(".code-label")) el.textContent = code;

  const list = Object.entries(players()).map(([id, p]) => ({
    id,
    name: p.name,
    isMaster: id === lobby.masterId,
    connected: isOnline(id),
  }));
  list.sort((a, b) => (b.isMaster - a.isMaster) || a.name.localeCompare(b.name));

  $("#player-list").replaceChildren(...list.map((p) => {
    const li = playerRow(p.id, p.name);
    if (p.isMaster) li.append(badge("Master", "master"));
    return li;
  }));

  const hasMaster = list.some((p) => p.isMaster);
  const playing = list.length - hasMaster;
  $("#player-count").textContent = `${playing} player${playing === 1 ? "" : "s"}${hasMaster ? " + master" : ""}`;
  $("#no-master").hidden = hasMaster;
}

const isOnline = (id) => !!lobby.presence?.[id];

function playerRow(id, name) {
  const li = document.createElement("li");
  const dot = document.createElement("span");
  dot.className = "dot" + (isOnline(id) ? "" : " off");
  dot.title = isOnline(id) ? "Online" : "Offline";
  const label = document.createElement("span");
  label.className = "pname";
  label.textContent = name;
  li.append(dot, label);
  if (id === uid) li.append(badge("you", "you"));
  return li;
}

function badge(text, cls) {
  const b = document.createElement("span");
  b.className = `badge ${cls}`;
  b.textContent = text;
  return b;
}

function renderConnection() {
  $("#conn-status").hidden = online || !code;
}

// ---------- rendering: game ----------

function suggestedCounts(n) {
  const wolf = Math.max(1, Math.floor(n / 4));
  const magician = 1;
  const medium = n >= 6 ? 1 : 0;
  return { wolf, magician, medium, citizen: n - wolf - magician - medium };
}

const maxWolves = (n) => Math.ceil(n / 2) - 1; // wolves must start as a minority

function formatCounts(counts) {
  return [...SPECIAL_ROLES, "citizen"]
    .filter((r) => counts[r] > 0)
    .map((r) => `${counts[r]} ${counts[r] === 1 ? ROLES[r].name : ROLES[r].plural}`)
    .join(" · ");
}

function setupError(counts, n) {
  if (counts.wolf < 1) return "There must be at least one wolf.";
  if (counts.wolf > maxWolves(n)) return `Wolves must start as a minority: at most ${maxWolves(n)} with ${n} players.`;
  if (counts.citizen < 0) return "More roles than players.";
  return "";
}

function renderGame() {
  const game = lobby.game;
  const master = isMaster();
  const phase = game?.phase || null;
  const n = playerIds().length;

  for (const id of ["card-start", "card-wait", "card-setup", "card-role", "card-master-roles"]) $(`#${id}`).hidden = true;
  $("#card-share").hidden = !!game;
  $("#card-players").hidden = phase === "assigned" && master;
  $("#btn-edit").hidden = !!game;
  $("#btn-leave").hidden = !!game && master;

  const wait = (text) => {
    $("#wait-text").textContent = text;
    $("#card-wait").hidden = false;
  };

  if (!phase) {
    if (master) {
      $("#card-start").hidden = false;
      $("#btn-start").disabled = n < MIN_PLAYERS;
      $("#start-hint").textContent = n < MIN_PLAYERS
        ? `Waiting for players: ${n} of at least ${MIN_PLAYERS}.`
        : `${n} players ready.`;
    } else {
      wait(lobby.masterId ? "Waiting for the master to start the game…" : "Waiting for a game master to join…");
    }
  } else if (phase === "setup") {
    if (master) renderSetup(n);
    else wait("The master is choosing the roles…");
  } else if (phase === "assigned") {
    if (master) renderMasterRoles();
    else if (myRole) renderMyRole();
    else wait(myRole === null ? "A game is in progress without you. Wait for the next one!" : "Loading your role…");
  }
}

function renderSetup(n) {
  if (!setup || setup.citizen < 0 || setup.n !== n) {
    // (re)start from the suggestion when the player count changes and the current choice no longer fits
    const keep = setup && n - setup.wolf - setup.magician - setup.medium >= 0;
    setup = keep ? { ...setup, citizen: n - setup.wolf - setup.magician - setup.medium } : suggestedCounts(n);
    setup.n = n;
  }
  $("#card-setup").hidden = false;
  $("#setup-total").textContent = `${n} players`;
  $("#setup-suggestion").textContent = `Suggested for ${n} players: ${formatCounts(suggestedCounts(n))}.`;

  $("#role-counters").replaceChildren(...[...SPECIAL_ROLES, "citizen"].map((r) => {
    const role = ROLES[r];
    const li = document.createElement("li");
    li.className = "role-row";
    const icon = document.createElement("span");
    icon.className = "role-icon";
    icon.textContent = role.icon;
    const info = document.createElement("span");
    info.className = "role-info";
    info.textContent = role.plural;
    const hint = document.createElement("small");
    hint.textContent = r === "citizen" ? "Fill the remaining places" : role.max === 1 ? "Max 1" : role.team === "wolves" ? `Max ${maxWolves(n)}` : "";
    info.append(hint);

    const stepper = document.createElement("span");
    stepper.className = "stepper";
    const out = document.createElement("output");
    out.textContent = setup[r];
    if (r === "citizen") {
      stepper.append(out);
    } else {
      const max = Math.min(role.max ?? Infinity, r === "wolf" ? maxWolves(n) : Infinity);
      const minus = stepButton("−", `Fewer ${role.plural}`, setup[r] <= (role.min ?? 0), () => changeCount(r, -1));
      const plus = stepButton("+", `More ${role.plural}`, setup[r] >= max || setup.citizen <= 0, () => changeCount(r, +1));
      stepper.append(minus, out, plus);
    }
    li.append(icon, info, stepper);
    return li;
  }));

  const error = setupError(setup, n);
  $("#setup-error").textContent = error;
  $("#btn-assign").disabled = !!error || n < MIN_PLAYERS;
}

function stepButton(text, label, disabled, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = text;
  b.setAttribute("aria-label", label);
  b.disabled = disabled;
  b.addEventListener("click", onClick);
  return b;
}

function changeCount(role, delta) {
  setup[role] += delta;
  setup.citizen -= delta;
  renderGame();
}

function renderMyRole() {
  const role = ROLES[myRole];
  $("#card-role").hidden = false;
  const btn = $("#btn-reveal");
  btn.setAttribute("aria-expanded", String(revealed));
  btn.classList.toggle("team-wolves", role.team === "wolves");
  $("#role-icon").textContent = role.icon;
  $("#role-name").textContent = role.name;
  $("#role-desc").textContent = role.desc;
  let packText = "";
  if (myRole === "wolf" && pack) {
    const others = pack.filter((id) => id !== uid).map(playerName);
    packText = others.length ? `Your pack: ${others.join(", ")}` : "You are the only wolf.";
  }
  $("#role-pack").textContent = packText;
  $("#game-counts").textContent = lobby.game.counts ? `In this game: ${formatCounts(lobby.game.counts)}` : "";
}

function renderMasterRoles() {
  $("#card-master-roles").hidden = false;
  $("#master-counts").textContent = lobby.game.counts ? formatCounts(lobby.game.counts) : "";
  const order = { wolf: 0, magician: 1, medium: 2, citizen: 3 };
  const entries = Object.entries(secrets?.roles || {})
    .sort(([a, ra], [b, rb]) => (order[ra] - order[rb]) || playerName(a).localeCompare(playerName(b)));
  $("#master-role-list").replaceChildren(...entries.map(([id, r]) => {
    const li = playerRow(id, playerName(id));
    li.append(badge(`${ROLES[r].icon} ${ROLES[r].name}`, r === "wolf" ? "wolf" : r === "citizen" ? "" : "special"));
    return li;
  }));
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
  const assigned = lobby?.game?.phase === "assigned";
  if (assigned && isMaster()) {
    subscribe("all", `secrets/${code}`, (val) => { secrets = val; renderGame(); });
  } else if (assigned) {
    subscribe("role", `secrets/${code}/roles/${uid}`, (val) => {
      myRole = val;
      if (myRole === "wolf") {
        subscribe("pack", `secrets/${code}/wolves`, (w) => { pack = Object.keys(w || {}); renderGame(); });
      }
      renderGame();
    });
  } else {
    for (const key of Object.keys(subs)) unsubscribe(key);
    myRole = undefined;
    pack = null;
    secrets = null;
    revealed = false;
    if (lobby?.game?.phase !== "setup") setup = null;
  }
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
  await Promise.all(writes);
  goHome();
}

// ---------- actions: game (master only) ----------

function shuffle(items) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function assignRoles() {
  const ids = playerIds();
  const counts = { wolf: setup.wolf, magician: setup.magician, medium: setup.medium, citizen: setup.citizen };
  const error = setupError(counts, ids.length) || (ids.length < MIN_PLAYERS ? "Not enough players." : "");
  if (error) throw new Error(error);

  const deck = shuffle(Object.entries(counts).flatMap(([r, k]) => Array(k).fill(r)));
  const roles = {};
  const wolves = {};
  ids.forEach((id, i) => {
    roles[id] = deck[i];
    if (deck[i] === "wolf") wolves[id] = true;
  });
  // one atomic write: players never see the "assigned" phase before their role exists
  await update(ref(db), {
    [`secrets/${code}`]: { roles, wolves },
    [`lobbies/${code}/game`]: { phase: "assigned", counts, startedAt: Date.now() },
  });
}

function endGame() {
  return update(ref(db), { [`secrets/${code}`]: null, [`lobbies/${code}/game`]: null });
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
    if (confirm("Leave this lobby?")) leaveLobby().catch((err) => alert(err.message));
  });

  $("#btn-start").addEventListener("click", () => {
    set(lobbyRef("game"), { phase: "setup" }).catch((err) => alert(err.message));
  });

  $("#btn-suggest").addEventListener("click", () => {
    setup = null;
    renderGame();
  });

  $("#btn-cancel-setup").addEventListener("click", () => {
    remove(lobbyRef("game")).catch((err) => alert(err.message));
  });

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
    if (confirm("End this game and go back to the lobby? Roles will be cleared.")) {
      endGame().catch((err) => alert(err.message));
    }
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

function flash(text) {
  $("#copy-feedback").textContent = text;
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
