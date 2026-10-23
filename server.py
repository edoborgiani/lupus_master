"""Lupus in Tabula companion app - lobby server.

Lobbies live in memory. Each lobby is identified by a 4-letter code; players
connect over a WebSocket and receive the full lobby state on every change.
"""

import asyncio
import random
import string
import time
from dataclasses import dataclass, field
from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

STATIC_DIR = Path(__file__).parent / "static"
CODE_ALPHABET = "".join(c for c in string.ascii_uppercase if c not in "IO")  # avoid I/1, O/0 confusion
MAX_NAME_LEN = 20
MAX_PLAYERS = 30
EMPTY_LOBBY_TTL = 30 * 60  # seconds a lobby survives with nobody connected


@dataclass
class Player:
    id: str
    name: str
    is_master: bool
    sockets: set = field(default_factory=set)

    @property
    def connected(self) -> bool:
        return bool(self.sockets)


@dataclass
class Lobby:
    code: str
    players: dict = field(default_factory=dict)  # player_id -> Player
    watchers: set = field(default_factory=set)  # sockets not yet joined
    created_at: float = field(default_factory=time.time)
    last_active: float = field(default_factory=time.time)

    @property
    def master(self):
        return next((p for p in self.players.values() if p.is_master), None)

    def all_sockets(self):
        socks = set(self.watchers)
        for p in self.players.values():
            socks |= p.sockets
        return socks

    def state(self) -> dict:
        master = self.master
        return {
            "type": "state",
            "code": self.code,
            "master_id": master.id if master else None,
            "players": [
                {"id": p.id, "name": p.name, "is_master": p.is_master, "connected": p.connected}
                for p in self.players.values()
            ],
        }


lobbies: dict[str, Lobby] = {}
app = FastAPI(title="Lupus in Tabula")


def new_code() -> str:
    while True:
        code = "".join(random.choices(CODE_ALPHABET, k=4))
        if code not in lobbies:
            return code


async def broadcast(lobby: Lobby):
    msg = lobby.state()
    for ws in list(lobby.all_sockets()):
        try:
            await ws.send_json(msg)
        except Exception:
            pass


def validate_profile(lobby: Lobby, player_id: str, name, is_master) -> str | None:
    """Return an error message, or None if the profile is acceptable."""
    if not isinstance(name, str) or not name.strip():
        return "Please enter a name."
    name = name.strip()
    if len(name) > MAX_NAME_LEN:
        return f"Name must be at most {MAX_NAME_LEN} characters."
    for p in lobby.players.values():
        if p.id != player_id and p.name.lower() == name.lower():
            return "That name is already taken in this lobby."
    master = lobby.master
    if is_master and master and master.id != player_id:
        return f"{master.name} is already the game master."
    return None


@app.post("/api/lobbies")
async def create_lobby():
    code = new_code()
    lobbies[code] = Lobby(code=code)
    return {"code": code}


@app.get("/api/lobbies/{code}")
async def get_lobby(code: str):
    lobby = lobbies.get(code.upper())
    if not lobby:
        raise HTTPException(404, "Lobby not found")
    return lobby.state()


@app.websocket("/ws/{code}")
async def lobby_socket(ws: WebSocket, code: str, player_id: str):
    lobby = lobbies.get(code.upper())
    await ws.accept()
    if not lobby:
        await ws.send_json({"type": "error", "fatal": True, "message": "Lobby not found."})
        await ws.close()
        return

    player = lobby.players.get(player_id)
    if player:  # reconnecting (page refresh, phone went to sleep, ...)
        player.sockets.add(ws)
        await ws.send_json({"type": "joined", "player_id": player.id})
    else:
        lobby.watchers.add(ws)
    lobby.last_active = time.time()
    await broadcast(lobby)

    try:
        while True:
            msg = await ws.receive_json()
            kind = msg.get("type")
            lobby.last_active = time.time()

            if kind in ("join", "update"):
                name, is_master = msg.get("name"), bool(msg.get("is_master"))
                if kind == "join" and player_id not in lobby.players and len(lobby.players) >= MAX_PLAYERS:
                    await ws.send_json({"type": "error", "message": "This lobby is full."})
                    continue
                error = validate_profile(lobby, player_id, name, is_master)
                if error:
                    await ws.send_json({"type": "error", "message": error})
                    continue
                player = lobby.players.get(player_id)
                if player:
                    player.name, player.is_master = name.strip(), is_master
                else:
                    player = Player(id=player_id, name=name.strip(), is_master=is_master)
                    lobby.players[player_id] = player
                lobby.watchers.discard(ws)
                player.sockets.add(ws)
                await ws.send_json({"type": "joined", "player_id": player_id})
                await broadcast(lobby)

            elif kind == "leave":
                player = lobby.players.pop(player_id, None)
                if player:
                    player.sockets.discard(ws)
                    for other in player.sockets:  # same player in another tab
                        lobby.watchers.add(other)
                lobby.watchers.add(ws)
                await ws.send_json({"type": "left"})
                await broadcast(lobby)

    except (WebSocketDisconnect, ValueError):
        pass
    finally:
        lobby.watchers.discard(ws)
        player = lobby.players.get(player_id)
        if player:
            player.sockets.discard(ws)
        lobby.last_active = time.time()
        await broadcast(lobby)


async def cleanup_loop():
    while True:
        await asyncio.sleep(60)
        now = time.time()
        for code, lobby in list(lobbies.items()):
            if not lobby.all_sockets() and now - lobby.last_active > EMPTY_LOBBY_TTL:
                del lobbies[code]


@app.on_event("startup")
async def start_cleanup():
    asyncio.create_task(cleanup_loop())


@app.get("/")
async def index():
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
