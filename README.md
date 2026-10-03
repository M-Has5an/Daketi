# Robber Daketi 2

A complete Node.js / Socket.IO card game for 2–6 seats, with bots covering empty seats. The existing rank-matching rules remain; the rules engine, multiplayer flow, interface, and artwork have been rebuilt.

## Run locally

Use Node.js 22.18 or newer. From this folder:

```powershell
npm ci
npm start
```

Open http://localhost:3000. Create a table, share its invitation, and deal when everyone is ready. Unclaimed seats become bots. Installation prepares the locally bundled Socket.IO browser client automatically. No CDN, image API, database, or frontend framework is required.

To retain rooms across local restarts, copy `.env.example` to `.env`, set `ROOM_STORE_FILE=.data/rooms.json`, and run `npm start`. Do not put snapshots or secrets inside `public/`. File storage is for local development or a server with persistent disk.

## Playing

- Draw one card, then play a card. Discarding adds it to the table and passes the turn.
- Match ranks, regardless of suit. Capture all matching cards on the table and the consecutive matching top group of every matching rival pile. Matching your own top card also permits capture.
- A capture earns another draw while cards remain in the deck. After the deck empties, every play passes; empty hands are skipped.
- 2–10 score 5 points, J/Q/K score 10, and A scores 20. The highest pile score wins. Ties share the win; leftover table cards score nothing.
- All connected/reserved human players vote for a rematch. The starting seat rotates; cumulative wins and points remain for that seat while its owner stays at the table.

Keyboard: left/right arrows select, Enter captures, D draws, X discards, Escape clears. Settings include rank/suit sorting, three card backs, sound and volume, reduced motion, and simpler visuals. Inspect any pile to see its full public contents. Portrait and landscape both work.

## Private draw mode

Triple-click/tap **your own score**, with less than 500 ms between clicks, during a round. The same gesture disables it. When enabled, its controls appear only in your local Settings dialog.

Only **one human seat per room** can own it. Other players receive no mode flag, ownership field, strength, announcement, special avatar, glow, or distinct animation duration. An unsuccessful activation attempt receives a neutral local response and cannot take ownership away from another player.

- Gentle: a 55% chance of improving the owner's draw; no opponent sabotage.
- Classic: prioritizes steals, own-pile matches, table matches, then card value; other draws avoid strengthening the owner.
- Strong: adds a penalty for valuable opponent captures to the classic opponent-draw filter.

Ownership is reserved through a 90-second reconnect window. Bias pauses while its owner is disconnected. Leaving, reservation expiry, finishing the round, or starting a rematch clears ownership. A replacement guest never inherits it. Other people can still infer biased play from outcomes; the implementation hides explicit status, not mathematical evidence of nonrandom draws.

## What changed

| Area | Delivered |
|---|---|
| Visuals | Emerald felt, charcoal/brass palette, custom 52-card SVG deck with correct pip counts, mirrored court illustrations, three patterned backs, fanned hand, seated opponents, top-run/count badges, capture previews, score counters, responsive dialogs |
| Motion/audio | Deal flights, private draw reveal, discard/capture/steal flights, score floats, extra-turn banners, result confetti, synthesized sound effects, reduced-motion and simple-visual options |
| Room flow | Six-character codes, shareable invites, ready lobby, host start/transfer, automatic seat reconnect, temporary bot cover, stale bot cancellation, unanimous rematches, rotating starter, tied winners, round statistics and seat totals |
| Correctness/privacy | Shared server/browser rules, legal-deal validation, authoritative turn/phase/card checks, stale-move rejection, hidden opponent hands and drawn-card events, safe player-name rendering, session-bound seats, duplicate-tab protection, request limits, origin checks |
| Hosting | Browser-only graphics/audio, event-driven updates, local assets, paused empty tables, room/session expiry, health endpoint, Render blueprint, optional static build, installable shell cache, optional durable room checkpoints |

The installable shell caches public interface assets only. Multiplayer still requires a connection. The old prototypes remain in `old/` as reference and are neither served nor imported.

## Render deployment

The root `render.yaml` runs the whole game on one free Node web service. Connect this repository to Render as a Blueprint, or configure an existing web service:

| Setting | Value |
|---|---|
| Runtime / instance | Node / Free |
| Build | `npm ci --omit=dev` |
| Start | `npm start` |
| Node | `22` (at least 22.18) |
| Health path | `/health` |

Render supplies `PORT`; the server binds `0.0.0.0`. Use one Node process and one web-service instance. There is no distributed room lock or multi-instance Socket.IO adapter.

Render's free web service can sleep after 15 minutes without inbound HTTP or WebSocket messages, takes about a minute to wake, and can restart at any time. Its filesystem is ephemeral. Without external storage, a restart removes rooms; the client returns to the lobby cleanly. See [Render's free-service documentation](https://render.com/docs/free). The free compute plan is constrained, so local load results are not a promise of 90 players on Render. Monitor actual CPU, memory, bandwidth, and connection reliability on the deployed service.

### Durable room checkpoints

To restore rooms after Render restarts, configure an Upstash Redis database and put these **server-only** variables in Render's environment:

```text
UPSTASH_REDIS_REST_URL=https://YOUR-DATABASE.upstash.io
UPSTASH_REDIS_REST_TOKEN=YOUR-REST-TOKEN
ROOM_STORE_NAMESPACE=daketi:v2
```

Never set `ROOM_STORE_FILE` as durable storage on a free Render service. Never put Redis credentials into `config.js`, a static-site variable, or the repository. Snapshots contain private hands, deck order, session tokens, and mode ownership and must stay private. Use a separate namespace/database for each deployment.

Checkpoints coalesce changes, save at most once per 750 ms while storage is healthy, and avoid overlapping writes during an outage. Restoration reserves human seats for reconnect and continues once someone returns. Snapshots expire after 24 hours; inactive rooms expire sooner (waiting 2 hours, active 20 minutes, finished 30 minutes). A sudden crash can roll back to the latest successful checkpoint. If configured storage cannot load at startup, startup fails rather than silently overwriting saved rooms. No permanent accounts or cross-room leaderboard are introduced.

The Redis adapter uses the [official authenticated REST command interface](https://upstash.com/docs/redis/features/restapi). As checked on 2026-10-03, [Upstash's free Redis plan](https://upstash.com/pricing/redis) lists 256 MB, 500,000 commands/month and 10 GB bandwidth. A write every 750 ms is up to 4,800 commands per active hour; both provider quotas and Render's external-traffic limits still apply. Live third-party storage requires your own credentials and has not been provisioned in this project.

### Optional fast-loading static frontend

Keep the Socket.IO backend on Render and serve the frontend separately from Render Static Sites or Cloudflare Pages. This lets the interface and themed waiting notice load while the backend wakes. It does not eliminate backend cold starts.

1. Deploy the backend and note its HTTPS origin, e.g. `https://your-game-api.onrender.com`.
2. Build the frontend with `DAKETI_API_URL` set to that origin:

   ```powershell
   $env:DAKETI_API_URL='https://your-game-api.onrender.com'
   npm ci --omit=dev
   npm run build:static
   ```

3. Publish `dist/` on your static host. With a Git-connected build use the same commands and environment variable. `DAKETI_API_URL` is public; it is not a secret.
4. Set backend `ALLOWED_ORIGINS` to the exact static frontend HTTPS origin. For multiple approved origins use a comma-separated list without trailing slashes. Redeploy the backend.
5. Verify create/join, ready/start, moves, browser reload reconnect, and rematches through the static URL. Both sites must use HTTPS.

`deploy/render-split.yaml` is an alternative two-service Blueprint; fill `DAKETI_API_URL` and `ALLOWED_ORIGINS` with the actual reciprocal public origins. Use this instead of the root Blueprint when you want two services. Set no-cache headers for `index.html`, `config.js`, and `sw.js` if your chosen host permits them.

[Render Static Sites](https://render.com/docs/static-sites) provide free CDN hosting with included bandwidth/build allowances. [Cloudflare Pages](https://developers.cloudflare.com/pages/platform/limits/) is another free static-host choice. Migrating the Socket.IO backend to Cloudflare Durable Objects would be a separate architecture and protocol change, so this version keeps the working Node backend.

## Verification

```powershell
npm run check
npm test
npm run test:load
```

`npm test` checks the rules and real WebSocket multiplayer sessions, including exclusive private ownership, hidden draw events, malformed requests, stale bot cancellation, reconnect reservation, host transfer, rematches, restart recovery, and continuous checkpointing. Rules simulations finish 450 seeded games across 2–6 seats and all bot levels, conserving all 52 unique cards and 380 total card points after every action.

Some restricted Windows sandboxes prohibit child-process spawning. In that environment run the same suite without test-file subprocess isolation:

```powershell
node --test --experimental-test-isolation=none test/rules.test.js test/server.test.js test/http.test.js
```

The load script creates 15 six-seat rooms and 90 real WebSocket clients on localhost, plays one full round at each table, and reports memory, CPU, event-loop delay and traffic. Both server and simulated clients share one process; action animations and human think time are accelerated. Set `LOAD_ROOMS` to choose another count and `LOAD_REPORT` to save its JSON output. Do not interpret these numbers as a production capacity guarantee.

## Structure

- `server.js`: validated room/session lifecycle, personalized events, room scheduling and persistence coordination.
- `public/shared/game.js`: pure rules, scoring, seeded shuffle, captures, bot strategy and snapshot restoration.
- `server/storage.js`: memory, local-file or optional Upstash checkpoint storage.
- `public/client.js`, `cards.js`, `audio.js`, `style.css`: UI, SVG artwork, animations, input and preferences.
- `scripts/`: client preparation, syntax checks, static build and load testing.
- `test/`: rules and multiplayer regression suite.
- `old/`: untouched archival prototypes.

Bots use their own hand and public table/pile information for move selection. Medium values captured points and opponent loss; hard additionally estimates exposed-stack risk and known remaining ranks. Ordinary bots never inspect another player's hand.
