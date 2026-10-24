# Lupus Master

A web companion for playing **Lupus in Tabula** together. One person creates a lobby and
shares its 4-letter code (or invite link); everyone joins from their phone, picks a name
and says whether they're the game master (only one master per lobby).

## How to play

- **Live**: everyone at the same table. Phones only deal the secret roles; the master's phone
  guides the night step by step (who to call, what to say), records who the wolves, magician
  and medium point at, shows who died at dawn, and records the day's vote.
- **Remote**: everyone plays on their own phone (night choices and votes happen in the app).
  The master is optional: without one, the lobby's host plays too and the game advances by
  itself once everyone has acted.

Roles: Citizens, Wolves, Seer (learns each night whether a player is a wolf), Magician
(protects a house each night, not their own) and Medium (visits a house each night and dies
in place of the wolves' victim). The interface is in Italian or English (⚙️ settings, per
phone) and has a "📖 Regole" guide explaining roles and rules. Whoever runs the game can pick
house rules in the settings (e.g. whether the medium dies when the wolves attack their house
while they're away, whether the magician can protect themselves, run-off ties, revealed roles). Most votes is
eliminated; a tie goes to a run-off; the wolves win when they are as many as the others.

It's a static site (GitHub Pages) backed by **Firebase Realtime Database**, so there is no
server to run.

## One-time Firebase setup

1. Go to https://console.firebase.google.com, click **Create a project** (Google Analytics
   is not needed).
2. **Build → Authentication → Get started → Sign-in method → Anonymous → Enable.**
3. **Build → Realtime Database → Create database.** Pick a location (e.g. Belgium,
   `europe-west1`) and start in **locked mode**.
4. In the Realtime Database **Rules** tab, replace everything with the contents of
   [`database.rules.json`](database.rules.json) and click **Publish**.
5. **Project settings (gear icon) → General → Your apps → Web (`</>`)**. Register an app
   (no Firebase Hosting needed) and copy the `firebaseConfig` values into
   [`firebase-config.js`](firebase-config.js). Make sure `databaseURL` is included.
6. **Authentication → Settings → Authorized domains:** add `edoborgiani.github.io`.

The config values are not secrets; the database rules are what keep data safe (players can
only edit their own entry, and only one person can hold the master role).

## Publish on GitHub Pages

Repository **Settings → Pages → Build and deployment**: Source *Deploy from a branch*,
branch `main`, folder `/ (root)`. The site appears at
`https://edoborgiani.github.io/lupus_master/`.

## Run locally

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. Use a private window to simulate a second player
(each browser profile is a separate player).

## Files

- `index.html`, `style.css`, `app.js` – the app (plain HTML/CSS/JS, no build step).
- `i18n.js` – Italian and English texts.
- `game.js` – the game rules (night resolution, votes, win conditions), no Firebase or DOM.
- `firebase-config.js` – your Firebase project config.
- `database.rules.json` – security rules to paste into the Firebase console.
