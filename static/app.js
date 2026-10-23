// Lupus in Tabula companion - client

const $ = (sel) => document.querySelector(sel);

function store(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { return null; }
}

function randomId() {
  // crypto.randomUUID is only available on https/localhost, so fall back for LAN play
  if (crypto.randomUUID) return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}

const playerId = store("lupus.playerId") || randomId();
store("lupus.playerId", playerId);

let ws = null;
let lobby = null;          // latest state from the server
let joined = false;
let reconnectTimer = null;
let reconnectDelay = 500;

// ---------- screens ----------

function show(name) {
  for (const s of document.querySelectorAll(".screen")) s.hidden = s.id !== `screen-${name}`;
}

function goHome(error = "") {
  closeSocket();
  lobby = null;
  joined = false;
  store("lupus.lobby", null);
  history.replaceState(null, "", "/");
  $("#home-error").textContent = error;
  show("home");
}

function openProfile() {
  const me = lobby?.players.find((p) => p.id === playerId);
  $("#input-name").value = me?.name || store("lupus.lastName") || "";
  $("#input-master").checked = !!me?.is_master;
  $("#btn-profile-submit").textContent = joined ? "Save" : "Enter lobby";
  $("#btn-profile-cancel").textContent = joined ? "Cancel" : "Back";
  $("#profile-error").textContent = "";
  renderMasterToggle();
  show("profile");
  if (!$("#input-name").value) $("#input-name").focus();
}

// ---------- rendering ----------

function renderMasterToggle() {
  if (!lobby) return;
  const master = lobby.players.find((p) => p.id === lobby.master_id);
  const takenByOther = master && master.id !== playerId;
  const input = $("#input-master");
  input.disabled = takenByOther;
  if (takenByOther) input.checked = false;
  input.closest(".toggle").classList.toggle("disabled", takenByOther);
  $("#master-hint").textContent = takenByOther
    ? `${master.name} is already the game master.`
    : "The master narrates the game and doesn't play a role.";
}

function renderLobby() {
  for (const el of document.querySelectorAll(".code-label")) el.textContent = lobby.code;

  const players = [...lobby.players].sort((a, b) =>
    (b.is_master - a.is_master) || a.name.localeCompare(b.name));
  const list = $("#player-list");
  list.replaceChildren(...players.map((p) => {
    const li = document.createElement("li");
    const dot = document.createElement("span");
    dot.className = "dot" + (p.connected ? "" : " off");
    dot.title = p.connected ? "Online" : "Offline";
    const name = document.createElement("span");
    name.className = "pname";
    name.textContent = p.name;
    li.append(dot, name);
    if (p.id === playerId) li.append(badge("you", "you"));
    if (p.is_master) li.append(badge("Master", "master"));
    return li;
  }));

  const playing = lobby.players.filter((p) => !p.is_master).length;
  $("#player-count").textContent = `${playing} player${playing === 1 ? "" : "s"}${lobby.master_id ? " + master" : ""}`;
  $("#no-master").hidden = !!lobby.master_id;
}

function badge(text, cls) {
  const b = document.createElement("span");
  b.className = `badge ${cls}`;
  b.textContent = text;
  return b;
}

// ---------- socket ----------

function connect(code) {
  closeSocket();
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws/${code}?player_id=${encodeURIComponent(playerId)}`);
  const sock = ws;

  sock.onopen = () => {
    reconnectDelay = 500;
    $("#conn-status").hidden = true;
  };

  sock.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    switch (msg.type) {
      case "state": {
        const first = !lobby;
        lobby = msg;
        store("lupus.lobby", lobby.code);
        if (history.state !== lobby.code) history.replaceState(lobby.code, "", `/?code=${lobby.code}`);
        renderLobby();
        renderMasterToggle();
        if (first && !joined) openProfile();
        break;
      }
      case "joined":
        joined = true;
        show("lobby");
        break;
      case "left":
        goHome();
        break;
      case "error":
        if (msg.fatal) goHome(msg.message);
        else $("#profile-error").textContent = msg.message;
        break;
    }
  };

  sock.onclose = () => {
    if (sock !== ws) return; // replaced or closed on purpose
    ws = null;
    $("#conn-status").hidden = false;
    reconnectTimer = setTimeout(() => connect(code), reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 8000);
  };
}

function closeSocket() {
  clearTimeout(reconnectTimer);
  $("#conn-status").hidden = true;
  if (ws) {
    const sock = ws;
    ws = null;
    sock.close();
  }
}

function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  else $("#profile-error").textContent = "Not connected, retrying…";
}

async function joinCode(code) {
  code = code.trim().toUpperCase();
  if (!/^[A-Z]{4}$/.test(code)) {
    $("#home-error").textContent = "The code is 4 letters.";
    return;
  }
  const res = await fetch(`/api/lobbies/${code}`);
  if (!res.ok) {
    $("#home-error").textContent = `No lobby with code ${code}.`;
    return;
  }
  $("#home-error").textContent = "";
  lobby = null;
  joined = false;
  connect(code);
}

// ---------- events ----------

$("#btn-create").addEventListener("click", async () => {
  const btn = $("#btn-create");
  btn.disabled = true;
  try {
    const res = await fetch("/api/lobbies", { method: "POST" });
    const { code } = await res.json();
    await joinCode(code);
  } catch {
    $("#home-error").textContent = "Could not create a lobby. Is the server running?";
  } finally {
    btn.disabled = false;
  }
});

$("#form-join").addEventListener("submit", (e) => {
  e.preventDefault();
  joinCode($("#input-code").value);
});

$("#input-code").addEventListener("input", (e) => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, "");
});

$("#form-profile").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = $("#input-name").value.trim();
  if (!name) {
    $("#profile-error").textContent = "Please enter a name.";
    return;
  }
  store("lupus.lastName", name);
  send({ type: joined ? "update" : "join", name, is_master: $("#input-master").checked });
});

$("#btn-profile-cancel").addEventListener("click", () => {
  if (joined) show("lobby");
  else goHome();
});

$("#btn-edit").addEventListener("click", () => {
  openProfile();
});

$("#btn-leave").addEventListener("click", () => {
  if (confirm("Leave this lobby?")) send({ type: "leave" });
});

function inviteLink() {
  return `${location.origin}/?code=${lobby.code}`;
}

function flash(text) {
  $("#copy-feedback").textContent = text;
  setTimeout(() => ($("#copy-feedback").innerHTML = "&nbsp;"), 2000);
}

$("#btn-copy-code").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(lobby.code);
    flash("Code copied!");
  } catch {
    flash(`Code: ${lobby.code}`);
  }
});

$("#btn-share").addEventListener("click", async () => {
  const url = inviteLink();
  if (navigator.share) {
    try { await navigator.share({ title: "Lupus in Tabula", text: `Join my game! Code ${lobby.code}`, url }); }
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

// ---------- boot ----------

const urlCode = new URLSearchParams(location.search).get("code");
const startCode = urlCode || store("lupus.lobby");
if (startCode) {
  $("#input-code").value = startCode.toUpperCase();
  joinCode(startCode).then(() => {
    if (!ws && urlCode === null) goHome(); // remembered lobby no longer exists
  });
} else {
  show("home");
}
