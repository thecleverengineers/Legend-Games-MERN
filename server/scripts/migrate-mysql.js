/*
 * One-way, idempotent legacy MySQL importer.
 *
 * It preserves account, wallet, payment, game and reward history without ever
 * copying legacy passwords, tokens, OTPs, IP addresses, private keys or direct
 * game-result controls into the new runtime. Every imported account must reset
 * its password through a verified delivery provider before it can sign in.
 */
import "dotenv/config";
import crypto from "node:crypto";
import bcrypt from "bcrypt";
import mysql from "mysql2/promise";
import mongoose from "mongoose";
import {
  Bet,
  GameRound,
  PaymentRequest,
  PayoutDestination,
  PromotionClaim,
  User,
  WalletTransaction,
} from "../models/index.js";

const required = [
  "MONGODB_URI",
  "MYSQL_HOST",
  "MYSQL_USER",
  "MYSQL_PASSWORD",
  "MYSQL_DATABASE",
];
const missing = required.filter((name) => !process.env[name]);
if (missing.length)
  throw new Error(`Missing environment variables: ${missing.join(", ")}`);

const amount = (value) =>
  Math.max(0, Math.round((Number(value) || 0) * 100) / 100);
const nonEmpty = (value) =>
  value !== undefined &&
  value !== null &&
  String(value).trim() &&
  String(value).trim() !== "0";
const dateFromLegacy = (value) => {
  if (!value) return new Date();
  if (value instanceof Date) return value;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0)
    return new Date(numeric > 1_000_000_000_000 ? numeric : numeric * 1000);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
};
const hashSeed = (seed) =>
  crypto.createHash("sha256").update(seed).digest("hex");
const legacyRef = (prefix, table, id) => `${prefix}-LEGACY-${table}-${id}`;
const walletBalance = (cash, bonus) => ({
  cash: amount(cash),
  bonus: amount(bonus),
  total: amount(amount(cash) + amount(bonus)),
});
const masked = (value) => {
  const text = String(value || "");
  return text.length < 5 ? "••••" : `••••${text.slice(-4)}`;
};

const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});

async function tableRows(table) {
  try {
    const [rows] = await connection.query(`SELECT * FROM \`${table}\``);
    return rows;
  } catch (error) {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_TABLE_ERROR"].includes(error.code))
      return [];
    throw error;
  }
}

async function uniqueReferralCode(preferred, legacyId) {
  const initial = nonEmpty(preferred)
    ? String(preferred)
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9_-]/g, "")
        .slice(0, 24)
    : "";
  const choices = [initial, `LG${String(legacyId).toUpperCase()}`];
  for (let attempt = 0; attempt < 12; attempt += 1)
    choices.push(`LG${crypto.randomBytes(5).toString("hex").toUpperCase()}`);
  for (const candidate of choices.filter(Boolean)) {
    if (!(await User.exists({ referralCode: candidate }))) return candidate;
  }
  throw new Error(
    `Unable to allocate a referral code for legacy user ${legacyId}`,
  );
}

async function upsertLegacyUser(row, lookupByPhone, lookupByCode) {
  const legacyId = String(row.id);
  const phone = nonEmpty(row.phone) ? String(row.phone).trim() : undefined;
  const email = nonEmpty(row.email)
    ? String(row.email).trim().toLowerCase()
    : undefined;
  if (!phone && !email) return null;
  let user = await User.findOne({ legacyId });
  if (!user) user = await User.findOne(phone ? { phone } : { email });
  const originalCode = nonEmpty(row.code)
    ? String(row.code).trim().toUpperCase()
    : "";
  const referralCode =
    user?.referralCode || (await uniqueReferralCode(originalCode, legacyId));
  const cash = amount(row.money);
  const bonus = amount(row.bonus_money);
  const createdAt = dateFromLegacy(row.time || row.createdAt || row.today);
  const originalRole = String(row.level ?? row.user_level ?? "player");
  const role =
    Number(row.level) === 1
      ? "manager"
      : Number(row.level) > 1
        ? "agent"
        : "player";
  const status =
    Number(row.status) === 1 || row.status === "active"
      ? "active"
      : "suspended";
  const avatar = nonEmpty(row.avatar)
    ? `/images/${String(row.avatar).replace(/^\/+/, "")}`
    : "";
  const update = {
    legacyId,
    name:
      String(row.name_user || row.username || phone || email)
        .trim()
        .slice(0, 80) || "Player",
    email,
    phone,
    referralCode,
    mustResetPassword: true,
    role,
    status,
    avatar,
    vipLevel: Math.max(0, Number(row.user_level || row.rank || 0)),
    wallet: {
      cash,
      bonus,
      currency: "INR",
      lifetimeDeposits: amount(row.total_money),
      lifetimeWithdrawals: 0,
      lifetimeWagered: 0,
      lifetimeWon: 0,
    },
    kyc: { status: Number(row.veri) === 1 ? "verified" : "not_started" },
    legacy: {
      inviteCode: nonEmpty(row.invite)
        ? String(row.invite).trim().toUpperCase()
        : "",
      originalRole,
      importedAt: new Date(),
    },
  };
  if (user) {
    // Do not overwrite a person who has already signed into the new service.
    if (!user.lastLoginAt) Object.assign(user, update);
    await user.save();
  } else {
    user = await User.create({
      ...update,
      passwordHash: await bcrypt.hash(crypto.randomUUID(), 12),
      createdAt,
      updatedAt: createdAt,
    });
  }
  if (phone) lookupByPhone.set(phone, user);
  if (originalCode) lookupByCode.set(originalCode, user);
  const openingReference = legacyRef("OPEN", "users", legacyId);
  await WalletTransaction.updateOne(
    { user: user.id, type: "adjustment", reference: openingReference },
    {
      $setOnInsert: {
        user: user.id,
        type: "adjustment",
        direction: "credit",
        bucket: "mixed",
        amount: amount(cash + bonus),
        balanceAfter: walletBalance(cash, bonus),
        reference: openingReference,
        description: "Imported legacy opening balance",
        metadata: { legacyTable: "users", legacyId },
        createdAt,
        updatedAt: createdAt,
      },
    },
    { upsert: true },
  );
  return user;
}

async function importPaymentRows(table, type, users) {
  const rows = await tableRows(table);
  let imported = 0;
  for (const row of rows) {
    const user = users.get(String(row.phone || ""));
    if (!user) continue;
    const value = amount(row.money ?? row.amount);
    if (!value) continue;
    const reference = legacyRef(
      type === "deposit" ? "DEP" : "WDL",
      table,
      row.id,
    );
    const completed =
      Number(row.status) === 1 ||
      ["approved", "paid", "success"].includes(
        String(row.status).toLowerCase(),
      );
    const status = completed ? "paid" : "rejected";
    const createdAt = dateFromLegacy(row.time || row.createdAt);
    const request = await PaymentRequest.findOneAndUpdate(
      { reference },
      {
        $setOnInsert: {
          user: user.id,
          type,
          amount: value,
          currency: "INR",
          channel: "manual",
          status,
          reference,
          evidence: nonEmpty(row.utr) ? { utr: String(row.utr) } : undefined,
          note: "Imported legacy payment record",
          reviewedAt: completed ? createdAt : undefined,
          paidAt: completed ? createdAt : undefined,
          createdAt,
          updatedAt: createdAt,
        },
      },
      { new: true, upsert: true },
    );
    await WalletTransaction.updateOne(
      { user: user.id, type, reference },
      {
        $setOnInsert: {
          user: user.id,
          request: request.id,
          type,
          direction: type === "deposit" ? "credit" : "debit",
          bucket: "cash",
          amount: value,
          balanceAfter: walletBalance(0, 0),
          reference,
          status: completed ? "completed" : "rejected",
          description: `Imported legacy ${type}`,
          metadata: { legacyTable: table, legacyId: row.id },
          createdAt,
          updatedAt: createdAt,
        },
      },
      { upsert: true },
    );
    imported += 1;
  }
  return imported;
}

const gameTableDefinitions = [
  {
    table: "minutes_1",
    game: "wingo-1m",
    selection: (row) => row.bet || row.game || row.join_bet,
    payout: (row) => row.get || row.win || 0,
  },
  {
    table: "result_k3",
    game: "k3-1m",
    selection: (row) => row.bet || row.join_bet || row.game,
    payout: (row) => row.get || row.win || 0,
  },
  {
    table: "result_5d",
    game: "five-d-1m",
    selection: (row) => row.bet || row.join_bet || row.game,
    payout: (row) => row.get || row.win || 0,
  },
  {
    table: "trx_wingo_bets",
    game: "trx-wingo-1m",
    selection: (row) => row.bet || row.join_bet || row.game,
    payout: (row) => row.get || row.win || 0,
  },
];

async function importGameRows(definition, users) {
  const rows = await tableRows(definition.table);
  let imported = 0;
  for (const row of rows) {
    const user = users.get(String(row.phone || ""));
    if (!user) continue;
    const createdAt = dateFromLegacy(row.time || row.createdAt || row.today);
    const periodValue = String(
      row.period ||
        row.id_product ||
        row.id ||
        `${createdAt.getTime()}-${user.id}`,
    );
    const period = `legacy-${definition.table}-${periodValue}`.slice(0, 240);
    const seed = `legacy-import:${definition.table}:${period}`;
    const outcome = {
      imported: true,
      result: row.result ?? row.amount ?? null,
      sourceTable: definition.table,
    };
    const round = await GameRound.findOneAndUpdate(
      { game: definition.game, period },
      {
        $setOnInsert: {
          game: definition.game,
          period,
          opensAt: createdAt,
          closesAt: createdAt,
          state: "settled",
          serverSeed: seed,
          serverSeedHash: hashSeed(seed),
          serverSeedReveal: seed,
          outcome,
          source: "demo_seed",
          settledAt: createdAt,
          createdAt,
          updatedAt: createdAt,
        },
      },
      { new: true, upsert: true },
    );
    const selected = String(definition.selection(row) || "legacy").slice(
      0,
      160,
    );
    const payout = amount(definition.payout(row));
    const stake = amount(row.money ?? row.amount);
    const reference = legacyRef(
      "BET",
      definition.table,
      row.id || `${user.id}-${period}`,
    );
    await Bet.updateOne(
      { user: user.id, round: round.id, idempotencyKey: reference },
      {
        $setOnInsert: {
          user: user.id,
          round: round.id,
          game: definition.game,
          selection: selected,
          selectionKey: `legacy:${selected}`.slice(0, 160),
          idempotencyKey: reference,
          amount: stake,
          odds: 0,
          payout,
          status: payout > 0 ? "won" : "lost",
          settledAt: createdAt,
          createdAt,
          updatedAt: createdAt,
        },
      },
      { upsert: true },
    );
    imported += 1;
  }
  return imported;
}

async function importClaimedRewards(users) {
  const rows = await tableRows("claimed_rewards");
  let imported = 0;
  for (const row of rows) {
    const user = users.get(String(row.phone || ""));
    if (!user) continue;
    const kind = String(row.type || "bonus").toLowerCase();
    const type = [
      "daily_checkin",
      "attendance",
      "first_deposit",
      "daily_deposit",
      "invitation",
      "referral",
      "vip",
      "commission",
    ].includes(kind)
      ? kind
      : "daily_checkin";
    const claimKey = `legacy-${row.id}`;
    const createdAt = dateFromLegacy(row.time || row.createdAt);
    await PromotionClaim.updateOne(
      { user: user.id, type, claimKey },
      {
        $setOnInsert: {
          user: user.id,
          type,
          claimKey,
          amount: amount(row.amount),
          metadata: { legacyRewardId: row.reward_id, legacyType: row.type },
          createdAt,
          updatedAt: createdAt,
        },
      },
      { upsert: true },
    );
    imported += 1;
  }
  return imported;
}

async function importTransactionRows(users) {
  const rows = await tableRows("transactions");
  let imported = 0;
  for (const row of rows) {
    const user = users.get(String(row.phone || ""));
    if (!user) continue;
    const descriptor =
      `${row.transactionTypeId || ""} ${row.transferTypeId || ""} ${row.details || ""}`.toLowerCase();
    const type = descriptor.includes("withdraw")
      ? "withdrawal"
      : descriptor.includes("deposit") || descriptor.includes("recharge")
        ? "deposit"
        : descriptor.includes("transfer")
          ? "transfer_in"
          : descriptor.includes("reward") || descriptor.includes("bonus")
            ? "bonus"
            : "adjustment";
    const direction =
      descriptor.includes("withdraw") ||
      descriptor.includes("debit") ||
      descriptor.includes("sent")
        ? "debit"
        : "credit";
    const createdAt = dateFromLegacy(row.time || row.createdAt);
    const reference = legacyRef("TXN", "transactions", row.id);
    await WalletTransaction.updateOne(
      { user: user.id, type, reference },
      {
        $setOnInsert: {
          user: user.id,
          type,
          direction,
          bucket: type === "bonus" ? "bonus" : "cash",
          amount: amount(row.amount),
          balanceAfter: walletBalance(0, 0),
          reference,
          status: Number(row.status) === 1 ? "completed" : "rejected",
          description: String(
            row.details || "Imported legacy transaction",
          ).slice(0, 240),
          metadata: {
            legacyTable: "transactions",
            legacyId: row.id,
            transactionTypeId: row.transactionTypeId,
            transferTypeId: row.transferTypeId,
          },
          createdAt,
          updatedAt: createdAt,
        },
      },
      { upsert: true },
    );
    imported += 1;
  }
  return imported;
}

async function importSavedDestinations(users) {
  const possibleTables = ["user_bank", "bank_user", "banks"];
  let imported = 0;
  for (const table of possibleTables) {
    const rows = await tableRows(table);
    for (const row of rows) {
      const user = users.get(String(row.phone || row.user_phone || ""));
      const accountNumber =
        row.accountNumber || row.account_number || row.stk || row.number;
      const upiId = row.upiId || row.upi_id;
      const address = row.address || row.wallet_address;
      if (!user || (!accountNumber && !upiId && !address)) continue;
      const type = upiId ? "upi" : address ? "crypto" : "bank";
      const label = String(
        row.name || row.bank_name || row.account_name || type,
      ).slice(0, 80);
      await PayoutDestination.updateOne(
        { user: user.id, type, label },
        {
          $setOnInsert: {
            user: user.id,
            type,
            label,
            accountName: row.account_name || row.name,
            accountNumber: accountNumber ? String(accountNumber) : undefined,
            ifsc: row.ifsc,
            upiId: upiId ? String(upiId) : undefined,
            network: row.network,
            address: address ? String(address) : undefined,
            masked: masked(accountNumber || upiId || address),
          },
        },
        { upsert: true },
      );
      imported += 1;
    }
  }
  return imported;
}

try {
  await mongoose.connect(process.env.MONGODB_URI);
  const legacyUsers = await tableRows("users");
  const byPhone = new Map();
  const byCode = new Map();
  for (const row of legacyUsers) await upsertLegacyUser(row, byPhone, byCode);

  for (const user of byPhone.values()) {
    const invite = user.legacy?.inviteCode;
    if (!invite || user.referredBy) continue;
    const parent =
      byCode.get(invite) || (await User.findOne({ referralCode: invite }));
    if (parent && String(parent.id) !== String(user.id))
      await User.updateOne(
        { _id: user.id },
        { $set: { referredBy: parent.id } },
      );
  }

  const [deposits, withdrawals, rewards, destinations, transactions] =
    await Promise.all([
      importPaymentRows("recharge", "deposit", byPhone),
      importPaymentRows("withdraw", "withdrawal", byPhone),
      importClaimedRewards(byPhone),
      importSavedDestinations(byPhone),
      importTransactionRows(byPhone),
    ]);
  let bets = 0;
  for (const definition of gameTableDefinitions)
    bets += await importGameRows(definition, byPhone);

  console.log(
    JSON.stringify(
      {
        users: byPhone.size,
        deposits,
        withdrawals,
        bets,
        rewards,
        destinations,
        transactions,
        note: "Legacy credentials and direct result controls were intentionally not imported.",
      },
      null,
      2,
    ),
  );
} finally {
  await connection.end();
  await mongoose.disconnect();
}
