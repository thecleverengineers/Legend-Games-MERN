# Legacy feature parity map

The legacy implementation remains untouched in `src/`. This table maps its
functional areas to the React/Mongo/Node implementation and retained React
aliases. Aliases allow existing bookmarks to transition without losing the
feature family or artwork.

| Legacy area / paths | React route(s) | Node / MongoDB implementation |
| --- | --- | --- |
| Login, registration, forgot/reset password | `/login`, `/register`, `/forgot` | `/api/auth/*`, JWT cookie session, bcrypt and one-time reset codes |
| Home and game catalogue | `/`, `/home`, `/games` | `/api/games`, preserved `src/public` artwork/catalogue files |
| Win Go 1/3/5/10 minute | `/games/wingo-1m`, `/win/:minutes`, `/wingo` | committed-seed `GameRound` and `Bet` records |
| TRX Win Go 1/3/5/10 minute | `/games/trx-wingo-1m`, `/trx_wingo/:minutes` | `GameRound`/`Bet`, source-ready for TRX block adapter |
| K3 1/3/5/10 minute | `/games/k3-1m`, `/k3/:minutes` | K3 selection validation, payout resolution and round history |
| 5D 1/3/5/10 minute | `/games/five-d-1m`, `/5d/:minutes` | exact/position/total selections and settlement history |
| Aviator | `/games/aviator`, `/aviator` | provider launch/callback adapter with signed-event processing |
| JILI categories | `/games/jili-slots`, `/jili/*` | licensed provider launch/callback adapter and existing JILI artwork/catalogue |
| JDB categories | `/games/jdb-games`, `/jdb/*` | licensed provider launch/callback adapter and existing JDB artwork/catalogue |
| Wallet, recharge, withdrawal | `/wallet`, `/wallet/recharge`, `/wallet/withdrawal` | immutable `WalletTransaction`, `PaymentRequest`, destination records |
| Wallet transfer and transfer history | `/wallet`, `/wallet/transfer` | atomic MongoDB debit/credit transfer + ledger records |
| Game history and result lists | `/history`, `/game_history` | `/api/games/history`, game round proof/history APIs |
| Daily check-in, attendance and task records | `/rewards`, `/checkIn`, `/attendance/*`, `/dailytask/*` | `PromotionClaim` daily/attendance rules |
| First/daily recharge rewards | `/rewards`, `/first_deposit_bonus` | first/daily deposit reward claims |
| Invitation bonus, promotion/team/subordinates | `/rewards`, `/promotion/*`, `/team` | referrals, invitation claims, team and commission summaries |
| VIP/rebate/commission | `/rewards`, `/team`, `/vip`, `/rebate` aliases | lifetime wager tiers and `CommissionRecord` ledger |
| Gift/red-envelope redemption | `/rewards`, `/redenvelopes` alias | `GiftCode`, redemption uniqueness and ledger credit |
| Profile, avatar, password, settings | `/profile`, `/settings/*`, `/myProfile` | profile/password APIs with cookie-authenticated account state |
| Salary records and admin eligibility | `/salary`, `/recordsalary`, `/getrecord` | `SalaryRecord`, player history and admin eligibility/payment APIs |
| Admin operational settings | admin settings API | versioned `PlatformSetting` records with public/private visibility |
| Support, feedback and notices | `/support`, `/feedback`, `/notification` aliases | configured channels and feedback audit trail |
| Manager members/metrics | `/manager`, `/manager/*` | `/api/manager/dashboard`, `/api/manager/members` |
| Admin members, payments, gifts, reports | `/admin`, `/admin/manager/*` | role-scoped `/api/admin/*`, audit logs, payment reviews, gift-code creation |
| Legacy JSON sign-in/user/check-in/transfer calls | `/api/webapi/*` compatibility paths | compatibility handlers route state through the new services |

## Operational safety changes

The following legacy implementation details are deliberately not reproduced as
runtime behavior: hard-coded credentials, unverified payment/provider callbacks,
plaintext/weak password patterns, non-transactional balance updates, and admin
selection of game results. They are preserved only in the untouched legacy
reference source. The new runtime gives the same player-facing game and
operations flows, but settles internal rounds from a pre-committed seed and
requires signed, idempotent provider events.
