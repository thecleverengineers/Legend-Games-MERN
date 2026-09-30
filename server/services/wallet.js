import crypto from "node:crypto";
import mongoose from "mongoose";
import { AppError } from "../lib/http.js";
import { User, WalletTransaction } from "../models/index.js";

const MONEY_SCALE = 100;

export const asMoney = (value) =>
  Math.round((Number(value) + Number.EPSILON) * MONEY_SCALE) / MONEY_SCALE;
export const createReference = (prefix) =>
  `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;

const walletSnapshot = (wallet) => {
  const cash = asMoney(wallet?.cash || 0);
  const bonus = asMoney(wallet?.bonus || 0);
  return { cash, bonus, total: asMoney(cash + bonus) };
};

const requirePositiveAmount = (amount) => {
  const value = asMoney(amount);
  if (!Number.isFinite(value) || value <= 0)
    throw new AppError(
      "Amount must be greater than zero",
      422,
      "INVALID_AMOUNT",
    );
  return value;
};

const transactionOptions = (session) => (session ? { session } : {});

/**
 * All wallet-changing work uses a MongoDB transaction. MongoDB Atlas and a
 * local replica set support this; a standalone MongoDB server deliberately
 * fails instead of risking a partial debit/credit operation.
 */
export async function withWalletTransaction(work, suppliedSession) {
  if (suppliedSession) return work(suppliedSession);
  const session = await mongoose.startSession();
  try {
    let output;
    await session.withTransaction(
      async () => {
        output = await work(session);
      },
      { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } },
    );
    return output;
  } finally {
    await session.endSession();
  }
}

async function existingLedgerEntry({ userId, type, reference, session }) {
  return WalletTransaction.findOne({ user: userId, type, reference }).session(
    session || null,
  );
}

async function writeLedger({
  user,
  type,
  direction,
  bucket,
  amount,
  reference,
  idempotencyKey,
  description,
  request,
  gameRound,
  bet,
  metadata,
  session,
}) {
  const prior = await existingLedgerEntry({
    userId: user.id,
    type,
    reference,
    session,
  });
  if (prior) return prior;
  const [entry] = await WalletTransaction.create(
    [
      {
        user: user.id,
        type,
        direction,
        bucket,
        amount,
        balanceAfter: walletSnapshot(user.wallet),
        reference,
        idempotencyKey,
        description,
        request,
        gameRound,
        bet,
        metadata,
      },
    ],
    transactionOptions(session),
  );
  return entry;
}

/** Credit a cash or bonus bucket and write its immutable ledger entry. */
export async function creditWallet({
  userId,
  amount,
  type,
  reference = createReference("CR"),
  bucket = "cash",
  idempotencyKey,
  description,
  request,
  gameRound,
  bet,
  metadata = {},
  session,
}) {
  const value = requirePositiveAmount(amount);
  if (!["cash", "bonus"].includes(bucket))
    throw new AppError("Invalid wallet bucket", 422, "INVALID_BUCKET");
  return withWalletTransaction(async (activeSession) => {
    const existing = await existingLedgerEntry({
      userId,
      type,
      reference,
      session: activeSession,
    });
    if (existing) {
      const user = await User.findById(userId).session(activeSession);
      if (!user) throw new AppError("Account not found", 404, "USER_NOT_FOUND");
      return user;
    }
    const increments = { [`wallet.${bucket}`]: value };
    if (type === "win") increments["wallet.lifetimeWon"] = value;
    if (type === "deposit") increments["wallet.lifetimeDeposits"] = value;
    const user = await User.findByIdAndUpdate(
      userId,
      { $inc: increments },
      { new: true, ...transactionOptions(activeSession) },
    );
    if (!user) throw new AppError("Account not found", 404, "USER_NOT_FOUND");
    await writeLedger({
      user,
      type,
      direction: "credit",
      bucket,
      amount: value,
      reference,
      idempotencyKey,
      description,
      request,
      gameRound,
      bet,
      metadata,
      session: activeSession,
    });
    return user;
  }, session);
}

/**
 * Debit one bucket, or use cash first then bonus. The conditional update
 * protects balances from races even when several requests arrive at once.
 */
export async function debitWallet({
  userId,
  amount,
  type,
  reference = createReference("DB"),
  bucket = "cash",
  idempotencyKey,
  description,
  request,
  gameRound,
  bet,
  metadata = {},
  wager = false,
  session,
}) {
  const value = requirePositiveAmount(amount);
  if (!["cash", "bonus", "mixed"].includes(bucket))
    throw new AppError("Invalid wallet bucket", 422, "INVALID_BUCKET");
  return withWalletTransaction(async (activeSession) => {
    const existing = await existingLedgerEntry({
      userId,
      type,
      reference,
      session: activeSession,
    });
    if (existing) {
      const user = await User.findById(userId).session(activeSession);
      if (!user) throw new AppError("Account not found", 404, "USER_NOT_FOUND");
      return user;
    }

    let user;
    if (bucket === "mixed") {
      user = await User.findOneAndUpdate(
        {
          _id: userId,
          $expr: { $gte: [{ $add: ["$wallet.cash", "$wallet.bonus"] }, value] },
        },
        [
          {
            $set: {
              "wallet.cash": {
                $cond: [
                  { $gte: ["$wallet.cash", value] },
                  { $subtract: ["$wallet.cash", value] },
                  0,
                ],
              },
              "wallet.bonus": {
                $cond: [
                  { $gte: ["$wallet.cash", value] },
                  "$wallet.bonus",
                  {
                    $subtract: [
                      "$wallet.bonus",
                      { $subtract: [value, "$wallet.cash"] },
                    ],
                  },
                ],
              },
              "wallet.lifetimeWagered": wager
                ? { $add: ["$wallet.lifetimeWagered", value] }
                : "$wallet.lifetimeWagered",
            },
          },
        ],
        { new: true, ...transactionOptions(activeSession) },
      );
    } else {
      const increments = { [`wallet.${bucket}`]: -value };
      if (wager) increments["wallet.lifetimeWagered"] = value;
      user = await User.findOneAndUpdate(
        { _id: userId, [`wallet.${bucket}`]: { $gte: value } },
        { $inc: increments },
        { new: true, ...transactionOptions(activeSession) },
      );
    }
    if (!user)
      throw new AppError(
        "Insufficient playable balance",
        409,
        "INSUFFICIENT_BALANCE",
      );
    await writeLedger({
      user,
      type,
      direction: "debit",
      bucket,
      amount: value,
      reference,
      idempotencyKey,
      description,
      request,
      gameRound,
      bet,
      metadata,
      session: activeSession,
    });
    return user;
  }, session);
}

export async function transferWallet({
  fromUserId,
  toUserId,
  amount,
  reference = createReference("TRF"),
  note = "",
  session,
}) {
  if (String(fromUserId) === String(toUserId))
    throw new AppError(
      "You cannot transfer to yourself",
      422,
      "INVALID_RECIPIENT",
    );
  const value = requirePositiveAmount(amount);
  return withWalletTransaction(async (activeSession) => {
    const sender = await debitWallet({
      userId: fromUserId,
      amount: value,
      type: "transfer_out",
      reference,
      bucket: "mixed",
      description: note || "Wallet transfer sent",
      session: activeSession,
    });
    const recipient = await creditWallet({
      userId: toUserId,
      amount: value,
      type: "transfer_in",
      reference,
      bucket: "cash",
      description: note || "Wallet transfer received",
      session: activeSession,
    });
    return { sender, recipient, reference };
  }, session);
}
