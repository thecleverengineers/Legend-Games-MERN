import crypto from "node:crypto";
import express from "express";
import bcrypt from "bcrypt";
import { z } from "zod";
import { AppError, asyncHandler } from "../lib/http.js";
import {
  clearSession,
  issueToken,
  requireAuth,
  requireRole,
  setSession,
} from "../middleware/auth.js";
import {
  AuditLog,
  Bet,
  GiftCode,
  GameRound,
  OneTimeCode,
  PaymentRequest,
  PayoutDestination,
  PlatformSetting,
  SalaryRecord,
  User,
  WalletTransaction,
} from "../models/index.js";
import {
  GAMES,
  getOpenRound,
  placeBet,
  publicGame,
} from "../services/games.js";
import {
  attendanceStatus,
  claimAttendance,
  claimDailyCheckin,
  claimDailyDeposit,
  claimFirstDeposit,
  claimInvitation,
  promotionSummary,
  redeemGiftCode,
  teamSummary,
} from "../services/promotions.js";
import {
  createProviderLaunch,
  processProviderEvent,
  providerStatus,
} from "../services/providers.js";
import {
  asMoney,
  createReference,
  creditWallet,
  debitWallet,
  transferWallet,
  withWalletTransaction,
} from "../services/wallet.js";

const router = express.Router();
const moneyInput = z.coerce
  .number()
  .finite()
  .positive()
  .max(1_000_000)
  .transform(asMoney);
const pagination = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  page: z.coerce.number().int().min(1).default(1),
});
const appMode = () => ({
  mode: process.env.APP_MODE || "demo",
  realMoneyEnabled: process.env.REAL_MONEY_ENABLED === "true",
  currency: process.env.CURRENCY || "INR",
});
const idempotencyKey = (req) =>
  String(req.get("x-idempotency-key") || req.body?.idempotencyKey || "")
    .trim()
    .slice(0, 120) || undefined;
const periodKey = (value = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.BUSINESS_TIMEZONE || "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);

const parse = (schema, value) => {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new AppError(
      result.error.issues[0]?.message || "Invalid input",
      422,
      "VALIDATION_ERROR",
    );
  return result.data;
};
const walletView = (wallet = {}) => {
  const cash = asMoney(wallet.cash || 0);
  const bonus = asMoney(wallet.bonus || 0);
  return {
    cash,
    bonus,
    currency: wallet.currency || "INR",
    lifetimeDeposits: asMoney(wallet.lifetimeDeposits || 0),
    lifetimeWithdrawals: asMoney(wallet.lifetimeWithdrawals || 0),
    lifetimeWagered: asMoney(wallet.lifetimeWagered || 0),
    lifetimeWon: asMoney(wallet.lifetimeWon || 0),
    total: asMoney(cash + bonus),
  };
};
const publicUser = (user) => ({
  id: user.id || String(user._id),
  name: user.name,
  email: user.email || undefined,
  phone: user.phone || undefined,
  role: user.role,
  status: user.status,
  avatar: user.avatar || "",
  referralCode: user.referralCode,
  vipLevel: user.vipLevel || 0,
  wallet: walletView(user.wallet),
  kyc: user.kyc || { status: "not_started" },
  createdAt: user.createdAt,
  lastLoginAt: user.lastLoginAt,
});
const publicRound = (round) => ({
  id: round.id || String(round._id),
  game: round.game,
  period: round.period,
  opensAt: round.opensAt,
  closesAt: round.closesAt,
  state: round.state,
  serverSeedHash: round.serverSeedHash,
  serverSeedReveal:
    round.state === "settled" ? round.serverSeedReveal : undefined,
  outcome: round.state === "settled" ? round.outcome : undefined,
  settledAt: round.settledAt,
});
const publicDestination = (destination) => ({
  id: destination.id || String(destination._id),
  type: destination.type,
  label: destination.label,
  masked: destination.masked,
  status: destination.status,
  createdAt: destination.createdAt,
});
const audit = (req, action, subject, metadata = {}) =>
  AuditLog.create({
    actor: req.user?.id,
    action,
    subject,
    metadata,
    ip: req.ip,
  }).catch((error) => console.error("Audit log failed", error));
const noCache = (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
};

const makeReferralCode = async (session) => {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const value = `LG${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    const exists = await User.exists({ referralCode: value }).session(
      session || null,
    );
    if (!exists) return value;
  }
  throw new AppError(
    "Unable to create a referral code",
    500,
    "REFERRAL_CODE_FAILED",
  );
};
const passwordResetHash = (target, code) =>
  crypto
    .createHmac("sha256", process.env.JWT_SECRET)
    .update(`${target}:${code}`)
    .digest("hex");
const targetFromIdentifier = (identifier) =>
  String(identifier || "")
    .trim()
    .toLowerCase();
const maskedDestination = (input) => {
  if (input.type === "upi")
    return input.upiId
      ? input.upiId.replace(/^(.{2}).*(@.*)$/, "$1••••$2")
      : "UPI";
  if (input.type === "crypto")
    return input.address
      ? `${input.address.slice(0, 6)}••••${input.address.slice(-4)}`
      : "Crypto";
  return input.accountNumber
    ? `••••${input.accountNumber.slice(-4)}`
    : "Bank account";
};

router.use(noCache);
router.get("/platform", (_req, res) =>
  res.json({
    ok: true,
    data: { ...appMode(), minimumBet: 10, providers: providerStatus() },
  }),
);
router.get("/health", (_req, res) =>
  res.json({
    ok: true,
    data: { service: "legend-games-mern", time: new Date().toISOString() },
  }),
);

router.post(
  "/auth/register",
  asyncHandler(async (req, res) => {
    const input = parse(
      z
        .object({
          name: z.string().trim().min(2).max(80),
          email: z.string().trim().email().optional(),
          phone: z.string().trim().min(6).max(20).optional(),
          password: z.string().min(10).max(128),
          referralCode: z.string().trim().toUpperCase().max(24).optional(),
        })
        .refine(
          (value) => value.email || value.phone,
          "Enter an email address or phone number",
        ),
      req.body,
    );
    const passwordHash = await bcrypt.hash(input.password, 12);
    const created = await withWalletTransaction(async (session) => {
      const clauses = [
        input.email ? { email: input.email.toLowerCase() } : null,
        input.phone ? { phone: input.phone } : null,
      ].filter(Boolean);
      const existing = await User.findOne({ $or: clauses }).session(session);
      if (existing)
        throw new AppError(
          "An account already exists with those details",
          409,
          "DUPLICATE_ACCOUNT",
        );
      const referrer = input.referralCode
        ? await User.findOne({ referralCode: input.referralCode }).session(
            session,
          )
        : null;
      if (input.referralCode && !referrer)
        throw new AppError(
          "Referral code was not found",
          422,
          "INVALID_REFERRAL",
        );
      const [user] = await User.create(
        [
          {
            name: input.name,
            email: input.email?.toLowerCase(),
            phone: input.phone,
            passwordHash,
            referralCode: await makeReferralCode(session),
            referredBy: referrer?.id,
          },
        ],
        { session },
      );
      if (referrer) {
        await creditWallet({
          userId: referrer.id,
          amount: 10,
          type: "bonus",
          bucket: "bonus",
          reference: `REF-${user.id}`,
          description: "Referral signup reward",
          metadata: { registeredUser: user.id },
          session,
        });
      }
      return user;
    });
    setSession(res, issueToken(created));
    await audit({ ...req, user: created }, "user.registered", {
      user: created.id,
    });
    res.status(201).json({ ok: true, data: { user: publicUser(created) } });
  }),
);

router.post(
  "/auth/login",
  asyncHandler(async (req, res) => {
    const input = parse(
      z.object({
        identifier: z.string().trim().min(3).max(100),
        password: z.string().min(1).max(128),
      }),
      req.body,
    );
    const identifier = targetFromIdentifier(input.identifier);
    const user = await User.findOne({
      $or: [{ email: identifier }, { phone: input.identifier.trim() }],
    }).select("+passwordHash");
    if (!user || !(await bcrypt.compare(input.password, user.passwordHash)))
      throw new AppError(
        "Incorrect sign-in details",
        401,
        "INVALID_CREDENTIALS",
      );
    if (user.status !== "active")
      throw new AppError(
        "This account is unavailable",
        403,
        "ACCOUNT_UNAVAILABLE",
      );
    if (user.mustResetPassword)
      throw new AppError(
        "This migrated account requires a secure password reset before sign-in",
        403,
        "PASSWORD_RESET_REQUIRED",
      );
    user.lastLoginAt = new Date();
    await user.save();
    setSession(res, issueToken(user));
    await audit({ ...req, user }, "user.logged_in", { user: user.id });
    res.json({ ok: true, data: { user: publicUser(user) } });
  }),
);

router.post("/auth/logout", (req, res) => {
  clearSession(res);
  res.status(204).end();
});
router.get("/auth/me", requireAuth, (req, res) =>
  res.json({ ok: true, data: { user: publicUser(req.user) } }),
);
router.patch(
  "/auth/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = parse(
      z.object({
        name: z.string().trim().min(2).max(80).optional(),
        avatar: z.string().trim().max(500).optional(),
      }),
      req.body,
    );
    if (input.avatar && !/^(https?:\/\/|\/)/i.test(input.avatar))
      throw new AppError(
        "Avatar must be a URL or an existing site asset path",
        422,
        "INVALID_AVATAR",
      );
    Object.assign(req.user, input);
    await req.user.save();
    await audit(
      req,
      "user.profile_updated",
      { user: req.user.id },
      Object.keys(input),
    );
    res.json({ ok: true, data: { user: publicUser(req.user) } });
  }),
);
router.post(
  "/auth/change-password",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = parse(
      z.object({
        currentPassword: z.string().min(1),
        newPassword: z.string().min(10).max(128),
      }),
      req.body,
    );
    const user = await User.findById(req.user.id).select("+passwordHash");
    if (
      !user ||
      !(await bcrypt.compare(input.currentPassword, user.passwordHash))
    )
      throw new AppError(
        "Current password is incorrect",
        422,
        "INVALID_PASSWORD",
      );
    user.passwordHash = await bcrypt.hash(input.newPassword, 12);
    user.mustResetPassword = false;
    await user.save();
    await audit(req, "user.password_changed", { user: req.user.id });
    res.status(204).end();
  }),
);

router.post(
  "/auth/password-reset/request",
  asyncHandler(async (req, res) => {
    const input = parse(
      z.object({ identifier: z.string().trim().min(3).max(100) }),
      req.body,
    );
    const target = targetFromIdentifier(input.identifier);
    const user = await User.findOne({
      $or: [{ email: target }, { phone: input.identifier.trim() }],
    });
    const response = {
      accepted: true,
      message: "If the account exists, a reset code has been prepared.",
    };
    if (user) {
      const code = String(crypto.randomInt(100000, 1000000));
      const resolvedTarget = user.email || user.phone;
      await OneTimeCode.deleteMany({
        target: String(resolvedTarget).toLowerCase(),
        purpose: "password_reset",
      });
      await OneTimeCode.create({
        target: String(resolvedTarget).toLowerCase(),
        purpose: "password_reset",
        codeHash: passwordResetHash(String(resolvedTarget).toLowerCase(), code),
        expiresAt: new Date(Date.now() + 10 * 60_000),
      });
      // Real delivery belongs to an SMS/email provider adapter. Returning a code is
      // permitted only during local development, never in a production response.
      if (
        process.env.NODE_ENV !== "production" &&
        process.env.OTP_DEVELOPMENT_MODE === "true"
      )
        response.developmentCode = code;
    }
    res.status(202).json({ ok: true, data: response });
  }),
);
router.post(
  "/auth/password-reset/confirm",
  asyncHandler(async (req, res) => {
    const input = parse(
      z.object({
        identifier: z.string().trim().min(3).max(100),
        code: z.string().regex(/^\d{6}$/),
        newPassword: z.string().min(10).max(128),
      }),
      req.body,
    );
    const user = await User.findOne({
      $or: [
        { email: targetFromIdentifier(input.identifier) },
        { phone: input.identifier.trim() },
      ],
    }).select("+passwordHash");
    if (!user)
      throw new AppError(
        "Reset code is invalid or expired",
        422,
        "INVALID_RESET_CODE",
      );
    const target = String(user.email || user.phone).toLowerCase();
    const record = await OneTimeCode.findOne({
      target,
      purpose: "password_reset",
      consumedAt: null,
      expiresAt: { $gt: new Date() },
    })
      .sort({ createdAt: -1 })
      .select("+codeHash");
    if (
      !record ||
      record.attempts >= 5 ||
      !crypto.timingSafeEqual(
        Buffer.from(record.codeHash),
        Buffer.from(passwordResetHash(target, input.code)),
      )
    ) {
      if (record) {
        record.attempts += 1;
        await record.save();
      }
      throw new AppError(
        "Reset code is invalid or expired",
        422,
        "INVALID_RESET_CODE",
      );
    }
    user.passwordHash = await bcrypt.hash(input.newPassword, 12);
    user.mustResetPassword = false;
    record.consumedAt = new Date();
    await Promise.all([user.save(), record.save()]);
    setSession(res, issueToken(user));
    res.json({ ok: true, data: { user: publicUser(user) } });
  }),
);

router.get(
  "/wallet/summary",
  requireAuth,
  asyncHandler(async (req, res) => {
    const [user, pending] = await Promise.all([
      User.findById(req.user.id),
      PaymentRequest.aggregate([
        {
          $match: {
            user: req.user._id,
            status: { $in: ["pending", "reviewing"] },
          },
        },
        { $group: { _id: "$type", amount: { $sum: "$amount" } } },
      ]),
    ]);
    res.json({
      ok: true,
      data: {
        wallet: walletView(user.wallet),
        pending: {
          deposit: asMoney(
            pending.find((item) => item._id === "deposit")?.amount || 0,
          ),
          withdrawal: asMoney(
            pending.find((item) => item._id === "withdrawal")?.amount || 0,
          ),
        },
      },
    });
  }),
);
router.get(
  "/wallet/transactions",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { limit, page } = parse(pagination, req.query);
    const [transactions, total] = await Promise.all([
      WalletTransaction.find({ user: req.user.id })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      WalletTransaction.countDocuments({ user: req.user.id }),
    ]);
    res.json({ ok: true, data: { transactions, page, total } });
  }),
);
router.get(
  "/wallet/requests",
  requireAuth,
  asyncHandler(async (req, res) => {
    const requests = await PaymentRequest.find({ user: req.user.id })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    res.json({ ok: true, data: { requests } });
  }),
);
router.get(
  "/wallet/destinations",
  requireAuth,
  asyncHandler(async (req, res) => {
    const destinations = await PayoutDestination.find({
      user: req.user.id,
      status: "active",
    })
      .sort({ createdAt: -1 })
      .lean();
    res.json({
      ok: true,
      data: { destinations: destinations.map(publicDestination) },
    });
  }),
);
router.post(
  "/wallet/destinations",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = parse(
      z
        .object({
          type: z.enum(["bank", "upi", "crypto"]),
          label: z.string().trim().min(2).max(80),
          accountName: z.string().trim().max(120).optional(),
          accountNumber: z.string().trim().max(120).optional(),
          ifsc: z.string().trim().max(40).optional(),
          upiId: z.string().trim().max(120).optional(),
          network: z.string().trim().max(40).optional(),
          address: z.string().trim().max(200).optional(),
        })
        .superRefine((value, context) => {
          if (value.type === "bank" && !value.accountNumber)
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Account number is required for a bank destination",
            });
          if (value.type === "upi" && !value.upiId)
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message: "UPI ID is required",
            });
          if (value.type === "crypto" && !value.address)
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Wallet address is required",
            });
        }),
      req.body,
    );
    const destination = await PayoutDestination.create({
      user: req.user.id,
      ...input,
      masked: maskedDestination(input),
    });
    await audit(
      req,
      "wallet.destination_created",
      { destination: destination.id },
      { type: destination.type },
    );
    res.status(201).json({
      ok: true,
      data: { destination: publicDestination(destination) },
    });
  }),
);
router.delete(
  "/wallet/destinations/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const destination = await PayoutDestination.findOneAndUpdate(
      { _id: req.params.id, user: req.user.id, status: "active" },
      { $set: { status: "disabled" } },
      { new: true },
    );
    if (!destination)
      throw new AppError("Destination not found", 404, "DESTINATION_NOT_FOUND");
    await audit(req, "wallet.destination_disabled", {
      destination: destination.id,
    });
    res.status(204).end();
  }),
);

router.post(
  "/wallet/deposits",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = parse(
      z.object({
        amount: moneyInput,
        channel: z.enum(["manual", "upi", "bank", "crypto"]).default("manual"),
        note: z.string().trim().max(500).optional(),
        utr: z.string().trim().max(100).optional(),
        evidenceUrl: z.string().url().max(500).optional(),
      }),
      req.body,
    );
    const key = idempotencyKey(req);
    let request;
    try {
      request = await PaymentRequest.create({
        user: req.user.id,
        type: "deposit",
        amount: input.amount,
        channel: input.channel,
        note: input.note,
        evidence: { utr: input.utr, url: input.evidenceUrl },
        reference: createReference("DEP"),
        idempotencyKey: key,
      });
    } catch (error) {
      if (error?.code === 11000 && key)
        request = await PaymentRequest.findOne({
          user: req.user.id,
          idempotencyKey: key,
        });
      else throw error;
    }
    await audit(
      req,
      "wallet.deposit_requested",
      { request: request.id },
      { amount: request.amount, channel: request.channel },
    );
    res.status(201).json({ ok: true, data: { request, ...appMode() } });
  }),
);
router.post(
  "/wallet/withdrawals",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = parse(
      z.object({
        amount: moneyInput,
        channel: z.enum(["manual", "upi", "bank", "crypto"]).default("manual"),
        destinationId: z.string().optional(),
        note: z.string().trim().max(500).optional(),
      }),
      req.body,
    );
    if (appMode().realMoneyEnabled && req.user.kyc?.status !== "verified")
      throw new AppError(
        "Identity verification is required before withdrawal",
        403,
        "KYC_REQUIRED",
      );
    const key = idempotencyKey(req);
    const result = await withWalletTransaction(async (session) => {
      if (key) {
        const prior = await PaymentRequest.findOne({
          user: req.user.id,
          idempotencyKey: key,
        }).session(session);
        if (prior) return { request: prior, idempotent: true };
      }
      let destination = null;
      if (input.destinationId) {
        destination = await PayoutDestination.findOne({
          _id: input.destinationId,
          user: req.user.id,
          status: "active",
        }).session(session);
        if (!destination)
          throw new AppError(
            "Withdrawal destination was not found",
            404,
            "DESTINATION_NOT_FOUND",
          );
      }
      const reference = createReference("WDL");
      const [request] = await PaymentRequest.create(
        [
          {
            user: req.user.id,
            type: "withdrawal",
            amount: input.amount,
            channel: input.channel,
            destination: destination?.id,
            destinationSnapshot: destination
              ? {
                  type: destination.type,
                  label: destination.label,
                  masked: destination.masked,
                }
              : undefined,
            note: input.note,
            reference,
            idempotencyKey: key,
          },
        ],
        { session },
      );
      await debitWallet({
        userId: req.user.id,
        amount: input.amount,
        type: "withdrawal",
        bucket: "cash",
        reference,
        request: request.id,
        description: "Withdrawal request",
        metadata: { channel: input.channel },
        session,
      });
      return { request, idempotent: false };
    });
    await audit(
      req,
      "wallet.withdrawal_requested",
      { request: result.request.id },
      { amount: result.request.amount, channel: result.request.channel },
    );
    res.status(result.idempotent ? 200 : 201).json({ ok: true, data: result });
  }),
);
router.post(
  "/wallet/transfers",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = parse(
      z.object({
        recipient: z.string().trim().min(3).max(100),
        amount: moneyInput,
        note: z.string().trim().max(140).optional(),
      }),
      req.body,
    );
    const recipient = await User.findOne({
      $or: [
        { email: input.recipient.toLowerCase() },
        { phone: input.recipient },
        { referralCode: input.recipient.toUpperCase() },
      ],
    });
    if (!recipient)
      throw new AppError("Recipient was not found", 404, "RECIPIENT_NOT_FOUND");
    const transfer = await transferWallet({
      fromUserId: req.user.id,
      toUserId: recipient.id,
      amount: input.amount,
      note: input.note || "",
    });
    await audit(
      req,
      "wallet.transferred",
      { recipient: recipient.id },
      { amount: input.amount, reference: transfer.reference },
    );
    req.app.locals.io?.to(`user:${req.user.id}`).emit("wallet:changed");
    req.app.locals.io?.to(`user:${recipient.id}`).emit("wallet:changed");
    res.status(201).json({ ok: true, data: { reference: transfer.reference } });
  }),
);

router.get(
  "/games",
  asyncHandler(async (_req, res) => {
    const available = GAMES.filter((game) => !game.external);
    const rounds = await Promise.all(
      available.map((game) => getOpenRound(game.id)),
    );
    res.json({
      ok: true,
      data: {
        games: GAMES.map(publicGame),
        rounds: rounds.filter(Boolean).map(publicRound),
      },
    });
  }),
);
router.get(
  "/games/:game/round",
  asyncHandler(async (req, res) => {
    const game = GAMES.find(
      (candidate) => candidate.id === req.params.game && !candidate.external,
    );
    if (!game)
      throw new AppError("This game is unavailable", 404, "GAME_NOT_FOUND");
    const round = await getOpenRound(game.id);
    res.json({
      ok: true,
      data: { game: publicGame(game), round: publicRound(round) },
    });
  }),
);
router.get(
  "/games/:game/history",
  asyncHandler(async (req, res) => {
    const game = GAMES.find(
      (candidate) => candidate.id === req.params.game && !candidate.external,
    );
    if (!game)
      throw new AppError("This game is unavailable", 404, "GAME_NOT_FOUND");
    const rounds = await GameRound.find({ game: game.id, state: "settled" })
      .sort({ closesAt: -1 })
      .limit(100)
      .lean();
    res.json({ ok: true, data: { rounds: rounds.map(publicRound) } });
  }),
);
router.post(
  "/games/:game/bets",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = parse(
      z.object({
        selection: z.union([
          z.string().trim().min(1).max(60),
          z.object({}).passthrough(),
        ]),
        amount: moneyInput,
      }),
      req.body,
    );
    const result = await placeBet({
      userId: req.user.id,
      gameId: req.params.game,
      selection: input.selection,
      amount: input.amount,
      idempotencyKey: idempotencyKey(req),
    });
    await audit(
      req,
      "game.bet_placed",
      { bet: result.bet.id, round: result.round?.id },
      {
        game: req.params.game,
        amount: input.amount,
        selection: result.bet.selectionKey,
      },
    );
    req.app.locals.io?.to(`user:${req.user.id}`).emit("wallet:changed");
    res.status(result.idempotent ? 200 : 201).json({
      ok: true,
      data: {
        bet: result.bet,
        round: publicRound(result.round),
        idempotent: result.idempotent,
      },
    });
  }),
);
router.get(
  "/games/history",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { limit, page } = parse(pagination, req.query);
    const [bets, total] = await Promise.all([
      Bet.find({ user: req.user.id })
        .populate(
          "round",
          "period game outcome state serverSeedHash serverSeedReveal closesAt settledAt",
        )
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Bet.countDocuments({ user: req.user.id }),
    ]);
    res.json({ ok: true, data: { bets, page, total } });
  }),
);
router.get(
  "/games/rounds/:id/proof",
  asyncHandler(async (req, res) => {
    const round = await GameRound.findById(req.params.id).lean();
    if (!round) throw new AppError("Round not found", 404, "ROUND_NOT_FOUND");
    if (round.state !== "settled")
      throw new AppError(
        "Proof is released when the round settles",
        409,
        "ROUND_OPEN",
      );
    res.json({
      ok: true,
      data: {
        round: publicRound(round),
        verification: "SHA-256(serverSeedReveal) must equal serverSeedHash.",
      },
    });
  }),
);

router.get("/providers", (_req, res) =>
  res.json({ ok: true, data: { providers: providerStatus() } }),
);
router.post(
  "/providers/:provider/launch",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = parse(
      z.object({
        gameId: z.string().trim().max(100).optional(),
        returnUrl: z.string().url().max(500).optional(),
      }),
      req.body || {},
    );
    const launch = createProviderLaunch({
      provider: req.params.provider,
      user: req.user,
      gameId: input.gameId,
      returnUrl: input.returnUrl,
    });
    await audit(
      req,
      "provider.launch_created",
      { provider: req.params.provider },
      { gameId: input.gameId },
    );
    res.json({ ok: true, data: launch });
  }),
);
router.post(
  "/providers/:provider/callback",
  asyncHandler(async (req, res) => {
    const result = await processProviderEvent({
      provider: req.params.provider,
      payload: req.body,
      signature: req.get("x-provider-signature"),
    });
    res.status(result.duplicate ? 200 : 201).json({
      ok: true,
      data: { accepted: true, duplicate: result.duplicate },
    });
  }),
);

router.get(
  "/promotions",
  requireAuth,
  asyncHandler(async (req, res) =>
    res.json({ ok: true, data: await promotionSummary(req.user) }),
  ),
);
router.post(
  "/promotions/daily-checkin",
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await claimDailyCheckin(req.user.id);
    req.app.locals.io?.to(`user:${req.user.id}`).emit("wallet:changed");
    res.status(201).json({
      ok: true,
      data: {
        amount: result.amount,
        wallet: walletView(result.user.wallet),
        reference: result.reference,
      },
    });
  }),
);
router.post(
  "/promotions/attendance",
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await claimAttendance(req.user.id);
    res.status(201).json({
      ok: true,
      data: {
        amount: result.amount,
        wallet: walletView(result.user.wallet),
        reference: result.reference,
      },
    });
  }),
);
router.post(
  "/promotions/first-deposit",
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await claimFirstDeposit(req.user.id);
    res.status(201).json({
      ok: true,
      data: {
        amount: result.amount,
        wallet: walletView(result.user.wallet),
        reference: result.reference,
      },
    });
  }),
);
router.post(
  "/promotions/daily-deposit",
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await claimDailyDeposit(req.user.id);
    res.status(201).json({
      ok: true,
      data: {
        amount: result.amount,
        wallet: walletView(result.user.wallet),
        reference: result.reference,
      },
    });
  }),
);
router.post(
  "/promotions/invitation/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await claimInvitation(req.user.id, req.params.id);
    res.status(201).json({
      ok: true,
      data: {
        amount: result.amount,
        wallet: walletView(result.user.wallet),
        reference: result.reference,
      },
    });
  }),
);
router.post(
  "/promotions/gift-codes/redeem",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = parse(
      z.object({ code: z.string().trim().min(3).max(120) }),
      req.body,
    );
    const result = await redeemGiftCode(req.user.id, input.code);
    res.status(201).json({
      ok: true,
      data: {
        amount: result.amount,
        wallet: walletView(result.user.wallet),
        reference: result.reference,
      },
    });
  }),
);
router.get(
  "/team",
  requireAuth,
  asyncHandler(async (req, res) =>
    res.json({ ok: true, data: await teamSummary(req.user.id) }),
  ),
);

router.get("/support", requireAuth, (_req, res) =>
  res.json({
    ok: true,
    data: {
      channels: {
        email: process.env.SUPPORT_EMAIL || "",
        telegram: process.env.SUPPORT_TELEGRAM || "",
        whatsapp: process.env.SUPPORT_WHATSAPP || "",
      },
    },
  }),
);
router.post(
  "/feedback",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = parse(
      z.object({
        message: z.string().trim().min(5).max(2000),
        topic: z
          .enum(["support", "bug", "payment", "game", "other"])
          .default("support"),
      }),
      req.body,
    );
    await audit(req, "user.feedback_submitted", { user: req.user.id }, input);
    res.status(201).json({ ok: true, data: { accepted: true } });
  }),
);

router.get(
  "/salary/records",
  requireAuth,
  asyncHandler(async (req, res) => {
    const records = await SalaryRecord.find({ user: req.user.id })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    res.json({ ok: true, data: { records } });
  }),
);

router.get(
  "/settings/public",
  asyncHandler(async (_req, res) => {
    const settings = await PlatformSetting.find({ visibility: "public" })
      .select("key value updatedAt")
      .lean();
    res.json({
      ok: true,
      data: {
        settings: Object.fromEntries(
          settings.map((item) => [item.key, item.value]),
        ),
      },
    });
  }),
);

const staffRoles = ["admin", "manager"];
router.get(
  "/admin/dashboard",
  requireAuth,
  requireRole(...staffRoles),
  asyncHandler(async (_req, res) => {
    const [users, paymentRows, openBets, games, balances] = await Promise.all([
      User.countDocuments(),
      PaymentRequest.aggregate([
        { $match: { status: { $in: ["pending", "reviewing"] } } },
        {
          $group: {
            _id: "$type",
            amount: { $sum: "$amount" },
            count: { $sum: 1 },
          },
        },
      ]),
      Bet.countDocuments({ status: "open" }),
      GameRound.aggregate([
        {
          $group: {
            _id: "$game",
            rounds: { $sum: 1 },
            settled: {
              $sum: { $cond: [{ $eq: ["$state", "settled"] }, 1, 0] },
            },
          },
        },
      ]),
      User.aggregate([
        {
          $group: {
            _id: null,
            cash: { $sum: "$wallet.cash" },
            bonus: { $sum: "$wallet.bonus" },
          },
        },
      ]),
    ]);
    const payments = Object.fromEntries(
      paymentRows.map((row) => [
        row._id,
        { count: row.count, amount: asMoney(row.amount) },
      ]),
    );
    res.json({
      ok: true,
      data: {
        users,
        payments,
        openBets,
        games,
        walletLiability: walletView(balances[0] || {}),
      },
    });
  }),
);
router.get(
  "/admin/users",
  requireAuth,
  requireRole(...staffRoles),
  asyncHandler(async (req, res) => {
    const { limit, page } = parse(pagination, req.query);
    const query = String(req.query.q || "")
      .trim()
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const filter = query
      ? {
          $or: ["name", "email", "phone", "referralCode"].map((field) => ({
            [field]: new RegExp(query, "i"),
          })),
        }
      : {};
    const [users, total] = await Promise.all([
      User.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      User.countDocuments(filter),
    ]);
    res.json({ ok: true, data: { users: users.map(publicUser), page, total } });
  }),
);
router.get(
  "/admin/users/:id",
  requireAuth,
  requireRole(...staffRoles),
  asyncHandler(async (req, res) => {
    const [user, transactions, bets, requests] = await Promise.all([
      User.findById(req.params.id).lean(),
      WalletTransaction.find({ user: req.params.id })
        .sort({ createdAt: -1 })
        .limit(100)
        .lean(),
      Bet.find({ user: req.params.id })
        .populate("round", "period game outcome state closesAt")
        .sort({ createdAt: -1 })
        .limit(100)
        .lean(),
      PaymentRequest.find({ user: req.params.id })
        .sort({ createdAt: -1 })
        .limit(100)
        .lean(),
    ]);
    if (!user) throw new AppError("User not found", 404, "USER_NOT_FOUND");
    res.json({
      ok: true,
      data: { user: publicUser(user), transactions, bets, requests },
    });
  }),
);
router.patch(
  "/admin/users/:id",
  requireAuth,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const input = parse(
      z.object({
        status: z.enum(["active", "suspended", "closed"]).optional(),
        role: z.enum(["player", "agent", "manager", "admin"]).optional(),
        kycStatus: z
          .enum(["not_started", "pending", "verified", "rejected"])
          .optional(),
      }),
      req.body,
    );
    const update = { ...input };
    if (input.kycStatus) {
      update["kyc.status"] = input.kycStatus;
      delete update.kycStatus;
    }
    const user = await User.findByIdAndUpdate(req.params.id, update, {
      new: true,
    });
    if (!user) throw new AppError("User not found", 404, "USER_NOT_FOUND");
    await audit(req, "admin.user_updated", { user: user.id }, input);
    res.json({ ok: true, data: { user: publicUser(user) } });
  }),
);
router.post(
  "/admin/users/:id/adjustments",
  requireAuth,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const input = parse(
      z.object({
        direction: z.enum(["credit", "debit"]),
        amount: moneyInput,
        bucket: z.enum(["cash", "bonus"]).default("cash"),
        reason: z.string().trim().min(8).max(240),
      }),
      req.body,
    );
    const reference = createReference("ADJ");
    const user =
      input.direction === "credit"
        ? await creditWallet({
            userId: req.params.id,
            amount: input.amount,
            type: "adjustment",
            bucket: input.bucket,
            reference,
            description: input.reason,
            metadata: { adjustedBy: req.user.id },
          })
        : await debitWallet({
            userId: req.params.id,
            amount: input.amount,
            type: "adjustment",
            bucket: input.bucket,
            reference,
            description: input.reason,
            metadata: { adjustedBy: req.user.id },
          });
    await audit(
      req,
      "admin.wallet_adjusted",
      { user: user.id },
      { ...input, reference },
    );
    res
      .status(201)
      .json({ ok: true, data: { user: publicUser(user), reference } });
  }),
);
router.get(
  "/admin/payment-requests",
  requireAuth,
  requireRole(...staffRoles),
  asyncHandler(async (req, res) => {
    const filter = {};
    if (["deposit", "withdrawal"].includes(req.query.type))
      filter.type = req.query.type;
    if (req.query.status) filter.status = req.query.status;
    else filter.status = { $in: ["pending", "reviewing"] };
    const requests = await PaymentRequest.find(filter)
      .populate("user", "name email phone wallet kyc")
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    res.json({ ok: true, data: { requests } });
  }),
);
router.post(
  "/admin/payment-requests/:id/review",
  requireAuth,
  requireRole(...staffRoles),
  asyncHandler(async (req, res) => {
    const input = parse(
      z.object({
        decision: z.enum(["approve", "reject"]),
        note: z.string().trim().max(500).optional(),
      }),
      req.body,
    );
    const request = await withWalletTransaction(async (session) => {
      const payment = await PaymentRequest.findOneAndUpdate(
        { _id: req.params.id, status: { $in: ["pending", "reviewing"] } },
        {
          $set: {
            status: input.decision === "approve" ? "paid" : "rejected",
            reviewedBy: req.user.id,
            reviewedAt: new Date(),
            paidAt: input.decision === "approve" ? new Date() : undefined,
            note: input.note,
          },
        },
        { new: true, session },
      );
      if (!payment)
        throw new AppError(
          "Payment request is not pending",
          409,
          "REQUEST_NOT_PENDING",
        );
      if (payment.type === "deposit" && input.decision === "approve") {
        await creditWallet({
          userId: payment.user,
          amount: payment.amount,
          type: "deposit",
          bucket: "cash",
          reference: payment.reference,
          request: payment.id,
          description: "Deposit approved",
          metadata: { reviewedBy: req.user.id },
          session,
        });
      }
      if (payment.type === "withdrawal" && input.decision === "reject") {
        await creditWallet({
          userId: payment.user,
          amount: payment.amount,
          type: "refund",
          bucket: "cash",
          reference: payment.reference,
          request: payment.id,
          description: "Withdrawal request rejected",
          metadata: { reviewedBy: req.user.id },
          session,
        });
      }
      if (payment.type === "withdrawal" && input.decision === "approve")
        await User.updateOne(
          { _id: payment.user },
          { $inc: { "wallet.lifetimeWithdrawals": payment.amount } },
          { session },
        );
      return payment;
    });
    await audit(
      req,
      "admin.payment_reviewed",
      { request: request.id },
      { decision: input.decision, type: request.type, amount: request.amount },
    );
    req.app.locals.io?.to(`user:${request.user}`).emit("wallet:changed");
    res.json({ ok: true, data: { request } });
  }),
);
router.get(
  "/admin/bets",
  requireAuth,
  requireRole(...staffRoles),
  asyncHandler(async (req, res) => {
    const { limit, page } = parse(pagination, req.query);
    const filter = req.query.game ? { game: req.query.game } : {};
    const [bets, total] = await Promise.all([
      Bet.find(filter)
        .populate("user", "name email phone referralCode")
        .populate("round", "period outcome state closesAt")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Bet.countDocuments(filter),
    ]);
    res.json({ ok: true, data: { bets, total, page } });
  }),
);
router.get(
  "/admin/reports",
  requireAuth,
  requireRole(...staffRoles),
  asyncHandler(async (_req, res) => {
    const [ledger, bets, players] = await Promise.all([
      WalletTransaction.aggregate([
        {
          $group: {
            _id: { type: "$type", direction: "$direction" },
            amount: { $sum: "$amount" },
            count: { $sum: 1 },
          },
        },
      ]),
      Bet.aggregate([
        {
          $group: {
            _id: "$game",
            staked: { $sum: "$amount" },
            paid: { $sum: "$payout" },
            count: { $sum: 1 },
          },
        },
      ]),
      User.aggregate([{ $group: { _id: "$role", count: { $sum: 1 } } }]),
    ]);
    res.json({ ok: true, data: { ledger, bets, players } });
  }),
);
router.get(
  "/admin/salary/eligibility",
  requireAuth,
  requireRole(...staffRoles),
  asyncHandler(async (_req, res) => {
    const candidates = await User.find({
      role: { $in: ["agent", "manager"] },
      status: "active",
    })
      .select("name email phone referralCode wallet vipLevel")
      .sort({ "wallet.lifetimeWagered": -1 })
      .limit(200)
      .lean();
    const eligibility = await Promise.all(
      candidates.map(async (user) => ({
        user: publicUser(user),
        directMembers: await User.countDocuments({
          referredBy: user._id,
          status: "active",
        }),
        suggestedAmount: asMoney((user.wallet?.lifetimeWagered || 0) * 0.001),
      })),
    );
    res.json({ ok: true, data: { periodKey: periodKey(), eligibility } });
  }),
);
router.post(
  "/admin/salary",
  requireAuth,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const input = parse(
      z.object({
        userId: z.string().trim().min(1),
        amount: moneyInput,
        type: z.enum(["daily", "weekly", "monthly", "manual"]).default("daily"),
        periodKey: z.string().trim().min(3).max(60).default(periodKey()),
        notes: z.string().trim().max(240).optional(),
      }),
      req.body,
    );
    const record = await withWalletTransaction(async (session) => {
      const user = await User.findById(input.userId).session(session);
      if (!user) throw new AppError("User not found", 404, "USER_NOT_FOUND");
      const reference = `SAL-${input.userId}-${input.type}-${input.periodKey}`;
      let salary;
      try {
        [salary] = await SalaryRecord.create(
          [
            {
              user: user.id,
              amount: input.amount,
              type: input.type,
              periodKey: input.periodKey,
              status: "paid",
              reference,
              createdBy: req.user.id,
              paidAt: new Date(),
              notes: input.notes,
            },
          ],
          { session },
        );
      } catch (error) {
        if (error?.code === 11000)
          throw new AppError(
            "Salary for this period already exists",
            409,
            "SALARY_EXISTS",
          );
        throw error;
      }
      await creditWallet({
        userId: user.id,
        amount: input.amount,
        type: "commission",
        bucket: "cash",
        reference,
        description: `${input.type} salary`,
        metadata: { salaryRecord: salary.id, periodKey: input.periodKey },
        session,
      });
      return salary;
    });
    await audit(
      req,
      "admin.salary_paid",
      { salary: record.id, user: record.user },
      input,
    );
    res.status(201).json({ ok: true, data: { record } });
  }),
);
router.get(
  "/admin/settings",
  requireAuth,
  requireRole(...staffRoles),
  asyncHandler(async (_req, res) => {
    const settings = await PlatformSetting.find({}).sort({ key: 1 }).lean();
    res.json({ ok: true, data: { settings } });
  }),
);
router.put(
  "/admin/settings/:key",
  requireAuth,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const input = parse(
      z.object({
        value: z.unknown(),
        visibility: z.enum(["public", "private"]).default("private"),
      }),
      req.body,
    );
    const key = String(req.params.key || "")
      .trim()
      .toLowerCase();
    if (!/^[a-z0-9._-]{2,80}$/.test(key))
      throw new AppError("Invalid setting key", 422, "INVALID_SETTING_KEY");
    const setting = await PlatformSetting.findOneAndUpdate(
      { key },
      { $set: { ...input, updatedBy: req.user.id } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    await audit(
      req,
      "admin.setting_updated",
      { setting: key },
      { visibility: input.visibility },
    );
    res.json({ ok: true, data: { setting } });
  }),
);
router.get(
  "/admin/gift-codes",
  requireAuth,
  requireRole(...staffRoles),
  asyncHandler(async (_req, res) => {
    const codes = await GiftCode.find({})
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    res.json({ ok: true, data: { codes } });
  }),
);
router.post(
  "/admin/gift-codes",
  requireAuth,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const input = parse(
      z.object({
        code: z
          .string()
          .trim()
          .min(3)
          .max(120)
          .regex(/^[a-zA-Z0-9_-]+$/),
        amount: moneyInput,
        bucket: z.enum(["cash", "bonus"]).default("bonus"),
        maxUses: z.coerce.number().int().min(1).max(1_000_000).default(1),
        expiresAt: z.coerce.date().optional(),
        note: z.string().trim().max(240).optional(),
      }),
      req.body,
    );
    const gift = await GiftCode.create({
      ...input,
      code: input.code.toUpperCase(),
      createdBy: req.user.id,
    });
    await audit(
      req,
      "admin.gift_code_created",
      { gift: gift.id },
      { code: gift.code, amount: gift.amount, maxUses: gift.maxUses },
    );
    res.status(201).json({ ok: true, data: { gift } });
  }),
);
router.post(
  "/admin/rounds/:id/settle",
  requireAuth,
  requireRole("admin"),
  asyncHandler(async (_req, _res) => {
    throw new AppError(
      "Result selection is not available. Rounds settle automatically from their pre-committed seed.",
      403,
      "PROVABLY_FAIR_LOCKED",
    );
  }),
);

router.get(
  "/manager/dashboard",
  requireAuth,
  requireRole("manager", "admin", "agent"),
  asyncHandler(async (req, res) => {
    const team = await teamSummary(req.user.id);
    res.json({ ok: true, data: { ...team, role: req.user.role } });
  }),
);
router.get(
  "/manager/members",
  requireAuth,
  requireRole("manager", "admin", "agent"),
  asyncHandler(async (req, res) => {
    const team = await teamSummary(req.user.id);
    res.json({ ok: true, data: team });
  }),
);

// Compatibility paths preserve the legacy JSON workflow names while moving all
// state changes through the MongoDB services above. New React screens use the
// clearer endpoints above; existing integrations can transition incrementally.
router.post(
  "/webapi/login",
  asyncHandler(async (req, res) => {
    const identifier = String(
      req.body?.username || req.body?.phone || req.body?.email || "",
    ).trim();
    const password = String(req.body?.pwd || req.body?.password || "");
    const user = await User.findOne({
      $or: [{ email: identifier.toLowerCase() }, { phone: identifier }],
    }).select("+passwordHash");
    if (
      !user ||
      !(await bcrypt.compare(password, user.passwordHash)) ||
      user.status !== "active"
    )
      return res
        .status(401)
        .json({ status: false, message: "Invalid credentials" });
    setSession(res, issueToken(user));
    return res.json({
      status: true,
      message: "Login successful",
      data: publicUser(user),
    });
  }),
);
router.get("/webapi/GetUserInfo", requireAuth, (req, res) =>
  res.json({ status: true, data: publicUser(req.user) }),
);
router.post(
  "/webapi/checkIn",
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await claimDailyCheckin(req.user.id);
    res.json({
      status: true,
      message: "Success",
      data: {
        amount: result.amount,
        money: result.user.wallet.cash + result.user.wallet.bonus,
      },
    });
  }),
);
router.post(
  "/webapi/transfer",
  requireAuth,
  asyncHandler(async (req, res) => {
    const recipientValue = String(
      req.body?.phone || req.body?.recipient || "",
    ).trim();
    const recipient = await User.findOne({
      $or: [
        { phone: recipientValue },
        { referralCode: recipientValue.toUpperCase() },
        { email: recipientValue.toLowerCase() },
      ],
    });
    if (!recipient)
      throw new AppError("Recipient was not found", 404, "RECIPIENT_NOT_FOUND");
    const result = await transferWallet({
      fromUserId: req.user.id,
      toUserId: recipient.id,
      amount: req.body?.money || req.body?.amount,
      note: req.body?.note || "",
    });
    res.json({
      status: true,
      message: "Transfer complete",
      data: { reference: result.reference },
    });
  }),
);

export default router;
