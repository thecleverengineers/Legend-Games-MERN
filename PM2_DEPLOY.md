# PM2 deployment guide

## Prerequisites

- Node.js 20+ and npm
- MongoDB Atlas or a MongoDB replica set (transactions enabled)
- A reverse proxy/TLS endpoint for the API process
- An untracked production `.env` file

## Install and build

```bash
npm install
npm --prefix client install
npm run build
npm run db:indexes
npm run seed
```

Set at least the following in `.env`:

```dotenv
NODE_ENV=production
MONGODB_URI=mongodb+srv://...
JWT_SECRET=a-long-unique-random-value-at-least-32-characters
COOKIE_SECURE=true
CLIENT_ORIGIN=https://your-domain.example
APP_MODE=demo
REAL_MONEY_ENABLED=false
```

## Start and maintain

```bash
npm run pm2:start
npx pm2 status
npx pm2 logs
npx pm2 save
npx pm2 startup
```

Use `npm run pm2:reload` after a tested release. PM2 starts exactly two
processes: one API and one worker. Do not scale the worker process count above
one; it is the settlement owner. API scale-out can be added later after Socket.IO
adapter and deployment topology review.

## Reverse proxy expectations

Forward normal HTTP traffic and WebSocket upgrades to `127.0.0.1:5000`. Keep
`CLIENT_ORIGIN` restricted to the real React origin(s). The Node API serves the
compiled React client plus all supplied public assets, so a separate static host
is not required.

## Release checks

1. `curl https://your-domain.example/api/health`
2. Sign in with a non-production account.
3. Verify the wallet ledger and a test deposit/withdrawal review.
4. Verify one internal game round opens, settles and reveals its seed proof.
5. Check `npx pm2 logs legend-games-api` and `npx pm2 logs legend-games-worker`.

Never put actual secret values in `.env.example`, the source repository, PM2
ecosystem file, browser code or provider launch URLs.
