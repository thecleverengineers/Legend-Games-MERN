# MySQL to MongoDB migration

This is a one-way import from the supplied legacy schema into the MERN runtime.
It is safe to re-run: records use stable legacy references and upserts rather
than creating duplicates.

## Before importing

1. Take and verify a MySQL backup. Do not use the only production database copy.
2. Create a new MongoDB Atlas database (or a local replica set) and use a new
   `.env` that is not committed to source control.
3. Run `npm run db:indexes` before the importer.
4. Keep the legacy deployment online/read-only until totals and samples have
   been reconciled.

## Import

```bash
cp .env.example .env
# Set MONGODB_URI and the MYSQL_* fields in the untracked .env
npm run migrate:mysql
```

The command prints a JSON count summary. Then compare user counts, current
wallet totals, payment totals, and random user/game history samples before any
cutover.

| Legacy source | MongoDB destination | Notes |
| --- | --- | --- |
| `users` | `users`, opening `wallettransactions` | Existing balances and referral relationships are retained. |
| `recharge`, `withdraw` | `paymentrequests`, `wallettransactions` | Historic records only; balances are not re-applied. |
| `transactions` | `wallettransactions` | Generic legacy ledger/history. |
| `minutes_1` | `gamerounds`, `bets` | Win Go history. |
| `trx_wingo_bets` | `gamerounds`, `bets` | TRX Win Go history. |
| `result_k3` | `gamerounds`, `bets` | K3 history. |
| `result_5d` | `gamerounds`, `bets` | 5D history. |
| `claimed_rewards` | `promotionclaims` | Historic activity/reward claims. |
| detected bank tables | `payoutdestinations` | Account data remains hidden from API responses. |

## Credentials and sensitive data

The old code contains unsafe password representations and operational values.
The importer intentionally does not copy plaintext passwords, low-cost hashes,
MD5/session tokens, OTPs, IP addresses, private keys, provider secrets, or
manual result settings. Imported users receive a random password hash and
`mustResetPassword=true`; configure verified email/SMS delivery before asking
them to reset.

## Cutover checklist

1. Build the client with `npm run build`.
2. Set production cookie/CORS settings and rotate all historical credentials.
3. Start PM2 with `npm run pm2:start`.
4. Confirm API health at `/api/health`, a test sign-in, wallet ledger, player
   history, and one non-production game round.
5. Keep `REAL_MONEY_ENABLED=false` until the required regulated workflow is
   formally approved and payment callbacks are signed/verified.
