# Lupus Master

A web companion for playing **Lupus in Tabula** together. One person creates a lobby and
shares its 4-letter code (or invite link); everyone joins from their phone, picks a name
and says whether they're the game master (only one master per lobby).

## Run locally

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn server:app --host 0.0.0.0 --port 8000
```

Open http://localhost:8000. Other people on the same Wi-Fi can join at
`http://<your-computer-ip>:8000` (find the IP with `ipconfig getifaddr en0` on macOS).

## How it works

- `server.py`: FastAPI app. Lobbies are kept in memory and synced to every client over a
  WebSocket. Lobbies with nobody connected are deleted after 30 minutes.
- `static/`: plain HTML/CSS/JS client. Each browser gets a persistent player id, so
  refreshing the page or the phone going to sleep reconnects you to the same seat.
