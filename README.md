# Legend Games — React, MongoDB, Node.js and PM2

This package is a full MERN runtime for the supplied Legend Games codebase.
It keeps the original source, EJS pages, browser bundles, game artwork, banners,
JSON catalogues and static files unchanged under `src/`, while the production
runtime is now:

- React/Vite client in `client/`
- Express/Node API in `server/`
- MongoDB models and an idempotent MySQL importer
- PM2 API and single settlement-worker processes

The React routes retain the legacy navigation families: home, authentication,
wallet, recharge/withdrawal/transfer history, Win Go, TRX Win Go, K3, 5D,
Aviator, JILI, JDB, promotions, attendance, invitation/team, VIP, profile,
support, manager, and admin paths. Read [FEATURE_PARITY.md](FEATURE_PARITY.md)
for the exact route and feature mapping.

## Run locally

```bash
cp .env.example .env
# Set MONGODB_URI, JWT_SECRET, ADMIN_EMAIL and ADMIN_PASSWORD in .env
npm install
npm --prefix client install
npm run db:indexes
npm run seed
npm run dev
```

Open `http://localhost:5173`. The Vite client proxies `/api` to the Node API.
MongoDB transactions are required for wallet updates; use MongoDB Atlas or a
local replica set, not a standalone `mongod`, for actual wallet/game testing.

## Production with PM2

```bash
npm install
npm --prefix client install
npm run build
npm run db:indexes
npm run seed
npm run pm2:start
npx pm2 save
```

The PM2 topology is defined in [ecosystem.config.cjs](ecosystem.config.cjs):

- `legend-games-api` serves the API, React build and all original public assets.
- `legend-games-worker` creates and settles game rounds. Keep one worker.

Read [PM2_DEPLOY.md](PM2_DEPLOY.md) before exposing the service publicly.

## Data migration

Back up the MySQL database first, then fill the `MYSQL_*` variables in your
untracked `.env` and run:

```bash
npm run migrate:mysql
```

The importer handles users, opening balances, deposits, withdrawals, generic
transactions, game histories (Win Go, TRX Win Go, K3 and 5D), claimed rewards
and detected saved payout destinations. It does **not** import legacy passwords,
tokens, OTPs, IP addresses, keys, or direct-result settings. Imported users are
required to reset their passwords. See [MIGRATION.md](MIGRATION.md).

## Important deployment controls

`APP_MODE=demo` and `REAL_MONEY_ENABLED=false` are the defaults. Do not enable
real-money operations or an external provider until legal/compliance, KYC/AML,
age controls, payment-provider verification, operational monitoring and a
licensed game/provider integration are in place. Existing visual/UI assets and
user-facing flows are retained; unsafe legacy implementation details are not
carried into the new runtime.
