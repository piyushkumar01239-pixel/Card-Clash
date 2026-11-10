# Card Clash

Card Clash is an original, UNO-inspired real-time multiplayer shedding-card game. It uses React/Vite, Express, Socket.IO, and optional MongoDB persistence. The server owns the deck, private player hands, turns, card validation, special effects, and win detection. Guests can play without creating an account or configuring MongoDB.

## Requirements

- Node.js 20 or newer
- npm 10 or newer
- MongoDB Atlas for registered accounts, saved match results, player statistics, and the leaderboard

## Run locally

From the project directory in PowerShell:

```powershell
npm install
Copy-Item server\.env.example server\.env
Copy-Item client\.env.example client\.env
npm run dev
```

Open `http://localhost:5173` in two or more browsers/devices. Create a room, share the room code or invite link, join with at least one other player, and let the host start the game. MongoDB is optional for guest multiplayer.

Run the production client build and server rule tests:

```powershell
npm run build
npm test
```

### Environment variables

| Variable | Where | Required | Purpose |
|---|---|---:|---|
| `PORT` | Server | No | HTTP/Socket.IO port; Render supplies this in production. |
| `CLIENT_URL` | Server | Yes in production | Comma-separated exact frontend origins allowed by CORS, e.g. `https://card-clash.example`. |
| `JWT_SECRET` | Server | Yes in production | Long, unique signing secret. Never commit it or use the development fallback in production. |
| `MONGODB_URI` | Server | No for guest-only play; yes for accounts/stats | MongoDB Atlas connection string. |
| `MONGODB_DNS_SERVERS` | Server | No | DNS servers used to retry an Atlas SRV lookup if the system resolver refuses it. Defaults to `1.1.1.1,1.0.0.1`. |
| `VITE_API_URL` | Client | Yes in production | Public backend origin, e.g. `https://card-clash-api.onrender.com`; no trailing slash. |

`server/.env.example` and `client/.env.example` are templates. Do not commit `.env` files.

## Game rules and current behavior

- Rooms support 2–8 players; only the host can start, and the server deals seven cards to each player.
- Cards match by active color or face value. Wild cards require a valid color selection.
- Skip, Reverse, Draw Two, Wild, and Wild Draw Four effects are applied on the server.
- Drawing ends the player's turn; the drawn card cannot be played during that same turn.
- The game ends when a player empties their hand. Stacking and Wild Draw Four challenges are not implemented.
- Opponents receive card counts, never private hands. During a live match, disconnected players have 60 seconds to reconnect using their room code and browser/account identity.
- MongoDB accounts use bcrypt password hashing. Completed matches update registered players' wins/losses/games and populate recent match history. Guest results are not persisted.
- The dashboard currently reports match totals, wins, win rate, and recent matches. It does not claim machine-learning recommendations or provide detailed per-card analytics.

## Deploy

No public deployment has been performed by this project setup; configure the services below to obtain your own URLs.

### 1. MongoDB Atlas

1. Create a MongoDB Atlas project and cluster.
2. Create a database user with a strong password.
3. Configure Network Access for your deployment. For broader access, prefer a secured network policy rather than exposing credentials.
4. Copy the application connection string and replace its database name with `cardclash`.
5. Add the URI to the Render service as `MONGODB_URI`. URL-encode special characters in the database user's password.

### 2. Backend on Render

1. Push the repository to GitHub and create a Render **Web Service** from it.
2. Set **Root Directory** to `server`, **Build Command** to `npm install`, and **Start Command** to `npm start`.
3. Set `NODE_ENV=production`, `CLIENT_URL` to the exact Vercel site origin, `JWT_SECRET` to a unique long random value, and `MONGODB_URI` to the Atlas URI.
4. Deploy and verify `https://<your-render-service>.onrender.com/api/health`. The response should show `"ok": true`; `"database": true` indicates MongoDB is connected.
5. Keep the service available continuously for real-time rooms; sleeping instances interrupt live matches.

### 3. Frontend on Vercel

1. Import the GitHub repository into Vercel.
2. Set **Root Directory** to `client`, **Framework Preset** to Vite, **Build Command** to `npm run build`, and **Output Directory** to `dist`.
3. Set `VITE_API_URL` to the Render backend origin (without a trailing slash), then deploy.
4. Set the backend's `CLIENT_URL` to the final Vercel origin and redeploy/restart the backend. Vite environment variables are embedded at build time, so redeploy the frontend after changing `VITE_API_URL`.
5. Test the deployed frontend with two separate browsers/devices, not only the health endpoint.

### Upload to GitHub

Create a repository on GitHub, then from the project directory:

```powershell
git init
git add .
git commit -m "Prepare Card Clash for deployment"
git branch -M main
git remote add origin https://github.com/<your-user>/<your-repository>.git
git push -u origin main
```

Review `.gitignore` and confirm no `.env`, secrets, or `node_modules` are included before pushing.

## Known deployment considerations

Rooms currently live in server memory. A single Render instance is required for players in the same room; horizontal scaling needs a shared Socket.IO adapter and shared room/game storage. Add production rate limiting, abuse monitoring, and a tested backup/recovery policy before operating a large public service. The included automated tests cover core server game rules; MongoDB auth and deployed browser/device behavior require the corresponding configured services.
