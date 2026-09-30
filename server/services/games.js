import crypto from "node:crypto";
import { AppError } from "../lib/http.js";
import { Bet, GameRound, WalletTransaction } from "../models/index.js";
import {
  asMoney,
  createReference,
  creditWallet,
  debitWallet,
  withWalletTransaction,
} from "./wallet.js";
import { recordWagerCommission, syncVipLevel } from "./promotions.js";

const gameImage = (fallback) => fallback;
const intervals = [1, 3, 5, 10];
const lotteryVariants = (prefix, name, category, image, source = "demo_seed") =>
  intervals.map((minutes) => ({
    id: `${prefix}-${minutes}m`,
    legacyId: `${prefix}${minutes === 1 ? "" : minutes}`,
    legacyPaths:
      prefix === "wingo"
        ? minutes === 1
          ? ["/wingo"]
          : [`/win/${minutes}`]
        : prefix === "trx-wingo"
          ? minutes === 1
            ? ["/trx_wingo"]
            : [`/trx_wingo/${minutes}`]
          : prefix === "k3"
            ? minutes === 1
              ? ["/k3"]
              : [`/k3/${minutes}`]
            : minutes === 1
              ? ["/5d"]
              : [`/5d/${minutes}`],
    name: `${name} ${minutes} Min`,
    shortName: name,
    category,
    kind: prefix === "five-d" ? "five_d" : prefix === "k3" ? "k3" : "wingo",
    intervalMs: minutes * 60_000,
    image,
    source,
    external: false,
  }));

export const GAMES = [
  ...lotteryVariants(
    "wingo",
    "Win Go",
    "Lottery",
    gameImage("/images/logo-wingo.webp"),
  ),
  ...lotteryVariants(
    "trx-wingo",
    "TRX Win Go",
    "TRX Lottery",
    gameImage("/assets/png/trx16-27318f43.png"),
    "tron_block",
  ),
  ...lotteryVariants("k3", "K3", "Dice", gameImage("/images/lottery79.jpg")),
  ...lotteryVariants(
    "five-d",
    "5D",
    "Number",
    gameImage("/images/espgame3.png"),
  ),
  {
    id: "aviator",
    name: "Aviator",
    shortName: "Aviator",
    category: "Crash",
    kind: "provider",
    image: "/games_icons/aviator_icon.jpeg",
    external: true,
    provider: "aviator",
    legacyPaths: ["/aviator"],
  },
  {
    id: "jili-slots",
    name: "JILI Slots",
    shortName: "JILI",
    category: "Slots",
    kind: "provider",
    image: "/images/casino.webp",
    external: true,
    provider: "jili",
    legacyPaths: [
      "/jili/slots",
      "/jili/fishing",
      "/jili/lobby",
      "/jili/casino",
      "/jili/poker",
    ],
  },
  {
    id: "jdb-games",
    name: "JDB Games",
    shortName: "JDB",
    category: "Casino",
    kind: "provider",
    image: "/images/fishing.webp",
    external: true,
    provider: "jdb",
    legacyPaths: [
      "/jdb/slots",
      "/jdb/fishing",
      "/jdb/casino",
      "/jdb/poker",
      "/jdb/original",
      "/jdb/popular",
      "/jdb/quick",
    ],
  },
];

const getGame = (gameId) => GAMES.find((game) => game.id === gameId);
export const publicGame = (game) =>
  game && { ...game, choices: gameChoices(game) };
const roundPeriod = (game, closesAt) =>
  `${game.id}-${Math.floor(closesAt.getTime() / game.intervalMs)}`;
const seedHash = (seed) =>
  crypto.createHash("sha256").update(seed).digest("hex");
const sha = (value) => crypto.createHash("sha256").update(value).digest();

function nextClose(game, now = Date.now()) {
  return new Date(Math.floor(now / game.intervalMs + 1) * game.intervalMs);
}

export function gameChoices(game) {
  if (!game || game.external) return [];
  if (game.kind === "wingo")
    return [
      "green",
      "red",
      "violet",
      ...Array.from({ length: 10 }, (_item, number) => String(number)),
    ];
  if (game.kind === "k3")
    return [
      "small",
      "big",
      ...Array.from({ length: 16 }, (_item, index) => `sum-${index + 3}`),
      "triple:any",
      "pair:1",
      "pair:2",
      "pair:3",
      "pair:4",
      "pair:5",
      "pair:6",
    ];
  return [];
}

function wingoColor(number) {
  if ([1, 3, 7, 9].includes(number)) return ["green"];
  if ([2, 4, 6, 8].includes(number)) return ["red"];
  return number === 0 ? ["red", "violet"] : ["green", "violet"];
}

const k3SumOdds = {
  3: 207,
  4: 69,
  5: 34.5,
  6: 20.7,
  7: 13.8,
  8: 10.35,
  9: 8.28,
  10: 6.9,
  11: 6.9,
  12: 8.28,
  13: 10.35,
  14: 13.8,
  15: 20.7,
  16: 34.5,
  17: 69,
  18: 207,
};

export function normaliseSelection(game, requested) {
  if (!game || game.external)
    throw new AppError(
      "This game is not available for direct play",
      422,
      "GAME_UNAVAILABLE",
    );
  const raw =
    typeof requested === "string" ? requested.trim().toLowerCase() : requested;
  if (game.kind === "wingo") {
    if (["green", "red", "violet"].includes(raw))
      return { key: raw, value: raw, odds: raw === "violet" ? 4.5 : 1.95 };
    if (/^[0-9]$/.test(raw))
      return { key: `number:${raw}`, value: raw, odds: 9 };
  }
  if (game.kind === "k3") {
    if (["small", "big"].includes(raw))
      return { key: raw, value: raw, odds: 1.95 };
    const sum = /^sum-(3|4|5|6|7|8|9|10|11|12|13|14|15|16|17|18)$/.exec(raw);
    if (sum) return { key: raw, value: raw, odds: k3SumOdds[Number(sum[1])] };
    if (raw === "triple:any") return { key: raw, value: raw, odds: 24 };
    const triple = /^triple:([1-6])$/.exec(raw);
    if (triple) return { key: raw, value: raw, odds: 150 };
    const pair = /^pair:([1-6])$/.exec(raw);
    if (pair) return { key: raw, value: raw, odds: 8.7 };
    const single = /^single:([1-6])$/.exec(raw);
    if (single) return { key: raw, value: raw, odds: 1.95 };
  }
  if (game.kind === "five_d") {
    if (typeof raw === "string" && /^\d{5}$/.test(raw))
      return { key: `exact:${raw}`, value: raw, odds: 9000 };
    const position =
      typeof raw === "string" && /^position:([0-4]):([0-9])$/.exec(raw);
    if (position) return { key: raw, value: raw, odds: 9 };
    if (
      typeof raw === "string" &&
      /^total:(?:[0-9]|[1-3][0-9]|4[0-5])$/.test(raw)
    )
      return { key: raw, value: raw, odds: 4.5 };
  }
  throw new AppError(
    "This selection is not available for the game",
    422,
    "INVALID_SELECTION",
  );
}

export function gameOutcome(game, serverSeed) {
  const digest = sha(`${game.id}:${serverSeed}`);
  if (game.kind === "wingo") {
    const number = digest[0] % 10;
    return { number, colors: wingoColor(number) };
  }
  if (game.kind === "k3") {
    const dice = [
      (digest[0] % 6) + 1,
      (digest[1] % 6) + 1,
      (digest[2] % 6) + 1,
    ];
    return { dice, sum: dice.reduce((total, die) => total + die, 0) };
  }
  const numbers = Array.from(digest.subarray(0, 5), (byte) => byte % 10);
  return {
    number: numbers.join(""),
    numbers,
    total: numbers.reduce((total, number) => total + number, 0),
  };
}

export function oddsForOutcome(game, selectionKey, outcome) {
  if (game.kind === "wingo") {
    if (selectionKey.startsWith("number:"))
      return Number(selectionKey.slice(-1)) === outcome.number ? 9 : 0;
    return outcome.colors.includes(selectionKey)
      ? selectionKey === "violet"
        ? 4.5
        : 1.95
      : 0;
  }
  if (game.kind === "k3") {
    const { dice, sum } = outcome;
    if (selectionKey === "small") return sum <= 10 ? 1.95 : 0;
    if (selectionKey === "big") return sum >= 11 ? 1.95 : 0;
    if (selectionKey.startsWith("sum-"))
      return selectionKey === `sum-${sum}` ? k3SumOdds[sum] : 0;
    if (selectionKey === "triple:any") return new Set(dice).size === 1 ? 24 : 0;
    const triple = /^triple:([1-6])$/.exec(selectionKey);
    if (triple) return dice.every((die) => die === Number(triple[1])) ? 150 : 0;
    const pair = /^pair:([1-6])$/.exec(selectionKey);
    if (pair)
      return dice.filter((die) => die === Number(pair[1])).length >= 2
        ? 8.7
        : 0;
    const single = /^single:([1-6])$/.exec(selectionKey);
    if (single) return dice.includes(Number(single[1])) ? 1.95 : 0;
  }
  if (game.kind === "five_d") {
    if (selectionKey.startsWith("exact:"))
      return selectionKey.slice(6) === outcome.number ? 9000 : 0;
    const position = /^position:([0-4]):([0-9])$/.exec(selectionKey);
    if (position)
      return outcome.numbers[Number(position[1])] === Number(position[2])
        ? 9
        : 0;
    if (selectionKey.startsWith("total:"))
      return Number(selectionKey.slice(6)) === outcome.total ? 4.5 : 0;
  }
  return 0;
}

export async function getOpenRound(gameId) {
  const game = getGame(gameId);
  if (!game || game.external) return null;
  const now = new Date();
  let round = await GameRound.findOne({
    game: game.id,
    state: "open",
    closesAt: { $gt: now },
  }).sort({ closesAt: 1 });
  if (round) return round;
  const closesAt = nextClose(game);
  const opensAt = new Date(closesAt.getTime() - game.intervalMs);
  const serverSeed = crypto.randomBytes(32).toString("hex");
  try {
    round = await GameRound.create({
      game: game.id,
      period: roundPeriod(game, closesAt),
      opensAt,
      closesAt,
      serverSeed,
      serverSeedHash: seedHash(serverSeed),
      source: game.source || "demo_seed",
    });
  } catch (error) {
    if (error?.code === 11000)
      return GameRound.findOne({
        game: game.id,
        state: "open",
        closesAt: { $gt: now },
      }).sort({ closesAt: 1 });
    throw error;
  }
  return round;
}

export async function createAllOpenRounds() {
  await Promise.all(
    GAMES.filter((game) => !game.external).map((game) => getOpenRound(game.id)),
  );
}

export async function placeBet({
  userId,
  gameId,
  selection,
  amount,
  idempotencyKey,
}) {
  const game = getGame(gameId);
  if (!game || game.external)
    throw new AppError("This game is unavailable", 404, "GAME_NOT_FOUND");
  const wager = asMoney(amount);
  if (!(wager >= 10))
    throw new AppError("Minimum stake is ₹10", 422, "MINIMUM_STAKE");
  const pick = normaliseSelection(game, selection);
  const openRound = await getOpenRound(game.id);
  return withWalletTransaction(async (session) => {
    if (idempotencyKey) {
      const prior = await Bet.findOne({ user: userId, idempotencyKey }).session(
        session,
      );
      if (prior) return { bet: prior, idempotent: true };
    }
    const lockedRound = await GameRound.findOne({
      _id: openRound.id,
      state: "open",
      closesAt: { $gt: new Date() },
    }).session(session);
    if (!lockedRound)
      throw new AppError("The betting window has closed", 409, "ROUND_CLOSED");
    const [bet] = await Bet.create(
      [
        {
          user: userId,
          round: lockedRound.id,
          game: game.id,
          selection: pick.value,
          selectionKey: pick.key,
          idempotencyKey,
          amount: wager,
          odds: pick.odds,
        },
      ],
      { session },
    );
    const reference = createReference("BET");
    await debitWallet({
      userId,
      amount: wager,
      type: "bet",
      reference,
      bucket: "mixed",
      gameRound: lockedRound.id,
      bet: bet.id,
      description: `${game.name} bet: ${pick.key}`,
      metadata: {
        game: game.id,
        period: lockedRound.period,
        selection: pick.key,
      },
      wager: true,
      session,
    });
    const transaction = await WalletTransaction.findOne({
      user: userId,
      type: "bet",
      reference,
    }).session(session);
    bet.stakeTransaction = transaction?.id;
    await bet.save({ session });
    await recordWagerCommission({
      bettorId: userId,
      betId: bet.id,
      wager,
      session,
    });
    await syncVipLevel(userId, session);
    return { bet, round: lockedRound, idempotent: false };
  });
}

async function claimRoundForSettlement() {
  const now = new Date();
  return GameRound.findOneAndUpdate(
    {
      $or: [
        { state: "open", closesAt: { $lte: now } },
        {
          state: "settling",
          settlementStartedAt: { $lte: new Date(now.getTime() - 60_000) },
        },
      ],
    },
    { $set: { state: "settling", settlementStartedAt: now } },
    { new: true },
  ).select("+serverSeed");
}

async function settleOneRound(round) {
  const game = getGame(round.game);
  if (!game) {
    await GameRound.updateOne(
      { _id: round.id, state: "settling" },
      {
        $set: {
          state: "void",
          settledAt: new Date(),
          serverSeedReveal: round.serverSeed || "",
        },
      },
    );
    return null;
  }
  const outcome = gameOutcome(game, round.serverSeed);
  const bets = await Bet.find({ round: round.id, status: "open" });
  for (const record of bets) {
    await withWalletTransaction(async (session) => {
      const bet = await Bet.findOne({ _id: record.id, status: "open" }).session(
        session,
      );
      if (!bet) return;
      const odds = oddsForOutcome(game, bet.selectionKey, outcome);
      const payout = asMoney(bet.amount * odds);
      bet.status = payout > 0 ? "won" : "lost";
      bet.odds = odds || bet.odds;
      bet.payout = payout;
      bet.settledAt = new Date();
      await bet.save({ session });
      if (payout > 0) {
        await creditWallet({
          userId: bet.user,
          amount: payout,
          type: "win",
          reference: `WIN-${bet.id}`,
          bucket: "cash",
          gameRound: round.id,
          bet: bet.id,
          description: `${game.name} ${round.period} win`,
          metadata: { outcome, odds },
          session,
        });
      }
    });
  }
  const finalRound = await GameRound.findOneAndUpdate(
    { _id: round.id, state: "settling" },
    {
      $set: {
        state: "settled",
        outcome,
        serverSeedReveal: round.serverSeed,
        settledAt: new Date(),
      },
    },
    { new: true },
  );
  return finalRound;
}

export async function settleDueRounds(io) {
  let settled = 0;
  for (;;) {
    const round = await claimRoundForSettlement();
    if (!round) break;
    try {
      const completed = await settleOneRound(round);
      if (completed) {
        settled += 1;
        io?.emit("round:settled", {
          game: completed.game,
          period: completed.period,
          outcome: completed.outcome,
          serverSeedHash: completed.serverSeedHash,
          serverSeedReveal: completed.serverSeedReveal,
        });
      }
    } catch (error) {
      await GameRound.updateOne(
        { _id: round.id, state: "settling" },
        { $set: { state: "open" }, $unset: { settlementStartedAt: 1 } },
      );
      throw error;
    }
  }
  return settled;
}

export function startGameClock(io) {
  const tick = async () => {
    await createAllOpenRounds();
    await settleDueRounds(io);
  };
  tick().catch((error) => console.error("Game clock tick failed", error));
  return setInterval(
    () =>
      tick().catch((error) => console.error("Game clock tick failed", error)),
    1_000,
  );
}
