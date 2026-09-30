import mongoose from "mongoose";

const { Schema, model } = mongoose;
const money = { type: Number, required: true, min: 0 };

const walletSchema = new Schema(
  {
    cash: { ...money, default: 0 },
    bonus: { ...money, default: 0 },
    currency: { type: String, default: "INR", uppercase: true },
    lifetimeDeposits: { ...money, default: 0 },
    lifetimeWithdrawals: { ...money, default: 0 },
    lifetimeWagered: { ...money, default: 0 },
    lifetimeWon: { ...money, default: 0 },
  },
  { _id: false },
);

const userSchema = new Schema(
  {
    legacyId: { type: String, index: true, sparse: true },
    name: { type: String, trim: true, maxlength: 80, default: "Player" },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      unique: true,
      sparse: true,
    },
    phone: { type: String, trim: true, unique: true, sparse: true },
    passwordHash: { type: String, required: true, select: false },
    mustResetPassword: { type: Boolean, default: false },
    role: {
      type: String,
      enum: ["player", "agent", "manager", "admin"],
      default: "player",
    },
    status: {
      type: String,
      enum: ["active", "suspended", "closed"],
      default: "active",
    },
    avatar: { type: String, default: "" },
    referralCode: {
      type: String,
      trim: true,
      uppercase: true,
      unique: true,
      sparse: true,
    },
    referredBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    vipLevel: { type: Number, default: 0, min: 0, max: 10 },
    wallet: { type: walletSchema, default: () => ({}) },
    kyc: {
      status: {
        type: String,
        enum: ["not_started", "pending", "verified", "rejected"],
        default: "not_started",
      },
      verifiedAt: Date,
      notes: { type: String, maxlength: 500 },
    },
    legacy: { inviteCode: String, originalRole: String, importedAt: Date },
    lastLoginAt: Date,
  },
  { timestamps: true, toJSON: { virtuals: true } },
);
userSchema.virtual("wallet.total").get(function total() {
  return Number(
    ((this.wallet?.cash || 0) + (this.wallet?.bonus || 0)).toFixed(2),
  );
});
userSchema.index({ role: 1, status: 1, createdAt: -1 });
userSchema.index({ referredBy: 1, createdAt: -1 });

const walletTransactionSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: [
        "deposit",
        "withdrawal",
        "transfer_in",
        "transfer_out",
        "bet",
        "win",
        "bonus",
        "adjustment",
        "refund",
        "commission",
        "void",
      ],
      required: true,
    },
    direction: { type: String, enum: ["credit", "debit"], required: true },
    bucket: { type: String, enum: ["cash", "bonus", "mixed"], default: "cash" },
    amount: money,
    currency: { type: String, default: "INR" },
    balanceAfter: {
      cash: { ...money, default: 0 },
      bonus: { ...money, default: 0 },
      total: { ...money, default: 0 },
    },
    status: {
      type: String,
      enum: ["pending", "completed", "rejected", "cancelled"],
      default: "completed",
    },
    reference: { type: String, trim: true, required: true, index: true },
    idempotencyKey: { type: String, trim: true, sparse: true },
    request: { type: Schema.Types.ObjectId, ref: "PaymentRequest" },
    gameRound: { type: Schema.Types.ObjectId, ref: "GameRound" },
    bet: { type: Schema.Types.ObjectId, ref: "Bet" },
    description: { type: String, trim: true, maxlength: 240 },
    metadata: Schema.Types.Mixed,
  },
  { timestamps: true },
);
walletTransactionSchema.index({ user: 1, createdAt: -1 });
walletTransactionSchema.index(
  { user: 1, reference: 1, type: 1 },
  { unique: true },
);

const payoutDestinationSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: { type: String, enum: ["bank", "upi", "crypto"], required: true },
    label: { type: String, trim: true, maxlength: 80, required: true },
    accountName: { type: String, trim: true, maxlength: 120 },
    accountNumber: { type: String, trim: true, maxlength: 120, select: false },
    ifsc: { type: String, trim: true, maxlength: 40 },
    upiId: { type: String, trim: true, lowercase: true, maxlength: 120 },
    network: { type: String, trim: true, maxlength: 40 },
    address: { type: String, trim: true, maxlength: 200, select: false },
    masked: { type: String, trim: true, maxlength: 120 },
    status: { type: String, enum: ["active", "disabled"], default: "active" },
  },
  { timestamps: true },
);
payoutDestinationSchema.index({ user: 1, type: 1, createdAt: -1 });

const paymentRequestSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: { type: String, enum: ["deposit", "withdrawal"], required: true },
    amount: money,
    currency: { type: String, default: "INR" },
    channel: {
      type: String,
      enum: ["manual", "upi", "bank", "crypto"],
      default: "manual",
    },
    status: {
      type: String,
      enum: [
        "pending",
        "reviewing",
        "approved",
        "rejected",
        "paid",
        "failed",
        "cancelled",
      ],
      default: "pending",
      index: true,
    },
    reference: { type: String, required: true, unique: true, index: true },
    idempotencyKey: { type: String, trim: true, sparse: true },
    destination: { type: Schema.Types.ObjectId, ref: "PayoutDestination" },
    destinationSnapshot: Schema.Types.Mixed,
    evidence: {
      utr: { type: String, trim: true, maxlength: 100 },
      url: { type: String, trim: true, maxlength: 500 },
    },
    provider: {
      name: { type: String, trim: true, maxlength: 60 },
      eventId: { type: String, trim: true, maxlength: 160 },
    },
    note: { type: String, trim: true, maxlength: 500 },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User" },
    reviewedAt: Date,
    paidAt: Date,
  },
  { timestamps: true },
);
paymentRequestSchema.index(
  { user: 1, idempotencyKey: 1 },
  { unique: true, sparse: true },
);
paymentRequestSchema.index({ type: 1, status: 1, createdAt: -1 });

const gameRoundSchema = new Schema(
  {
    game: { type: String, required: true, index: true },
    period: { type: String, required: true },
    opensAt: { type: Date, required: true },
    closesAt: { type: Date, required: true, index: true },
    state: {
      type: String,
      enum: ["open", "settling", "settled", "void"],
      default: "open",
      index: true,
    },
    serverSeed: { type: String, required: true, select: false },
    serverSeedHash: { type: String, required: true },
    serverSeedReveal: { type: String, default: "" },
    outcome: Schema.Types.Mixed,
    source: {
      type: String,
      enum: ["demo_seed", "tron_block", "provider"],
      default: "demo_seed",
    },
    sourceReference: Schema.Types.Mixed,
    settlementStartedAt: Date,
    settledAt: Date,
  },
  { timestamps: true },
);
gameRoundSchema.index({ game: 1, period: 1 }, { unique: true });
gameRoundSchema.index({ state: 1, closesAt: 1 });

const betSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    round: {
      type: Schema.Types.ObjectId,
      ref: "GameRound",
      required: true,
      index: true,
    },
    game: { type: String, required: true, index: true },
    selection: { type: Schema.Types.Mixed, required: true },
    selectionKey: { type: String, required: true, trim: true, maxlength: 160 },
    idempotencyKey: { type: String, trim: true, sparse: true },
    amount: money,
    odds: { type: Number, required: true, min: 0 },
    payout: { ...money, default: 0 },
    stakeTransaction: { type: Schema.Types.ObjectId, ref: "WalletTransaction" },
    status: {
      type: String,
      enum: ["open", "won", "lost", "void"],
      default: "open",
      index: true,
    },
    settledAt: Date,
  },
  { timestamps: true },
);
betSchema.index({ user: 1, createdAt: -1 });
betSchema.index({ round: 1, status: 1 });
betSchema.index({ user: 1, idempotencyKey: 1 }, { unique: true, sparse: true });

const promotionClaimSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: [
        "daily_checkin",
        "attendance",
        "first_deposit",
        "daily_deposit",
        "invitation",
        "referral",
        "vip",
        "commission",
      ],
      required: true,
    },
    claimKey: { type: String, required: true },
    amount: money,
    metadata: Schema.Types.Mixed,
  },
  { timestamps: true },
);
promotionClaimSchema.index({ user: 1, type: 1, claimKey: 1 }, { unique: true });

const commissionRecordSchema = new Schema(
  {
    beneficiary: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    sourceUser: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    level: { type: Number, min: 1, max: 10, required: true },
    type: {
      type: String,
      enum: ["wager", "deposit", "salary"],
      required: true,
    },
    amount: money,
    reference: { type: String, required: true, index: true },
    periodKey: { type: String, required: true },
  },
  { timestamps: true },
);
commissionRecordSchema.index({ beneficiary: 1, periodKey: 1, type: 1 });
commissionRecordSchema.index(
  { beneficiary: 1, reference: 1 },
  { unique: true },
);

const giftCodeSchema = new Schema(
  {
    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      unique: true,
    },
    amount: money,
    bucket: { type: String, enum: ["cash", "bonus"], default: "bonus" },
    maxUses: { type: Number, min: 1, default: 1 },
    usedCount: { type: Number, min: 0, default: 0 },
    active: { type: Boolean, default: true },
    expiresAt: Date,
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    note: { type: String, trim: true, maxlength: 240 },
  },
  { timestamps: true },
);

const giftCodeRedemptionSchema = new Schema(
  {
    code: { type: Schema.Types.ObjectId, ref: "GiftCode", required: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    amount: money,
    reference: { type: String, required: true, unique: true },
  },
  { timestamps: true },
);
giftCodeRedemptionSchema.index({ code: 1, user: 1 }, { unique: true });

const oneTimeCodeSchema = new Schema(
  {
    target: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    purpose: {
      type: String,
      enum: ["password_reset", "verify_phone", "verify_email"],
      required: true,
    },
    codeHash: { type: String, required: true, select: false },
    expiresAt: { type: Date, required: true, expires: 0 },
    attempts: { type: Number, default: 0, min: 0 },
    consumedAt: Date,
  },
  { timestamps: true },
);
oneTimeCodeSchema.index({ target: 1, purpose: 1, createdAt: -1 });

const salaryRecordSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    amount: money,
    type: {
      type: String,
      enum: ["daily", "weekly", "monthly", "manual"],
      default: "daily",
    },
    periodKey: { type: String, required: true },
    status: {
      type: String,
      enum: ["eligible", "paid", "void"],
      default: "eligible",
    },
    reference: { type: String, required: true, unique: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    paidAt: Date,
    notes: { type: String, trim: true, maxlength: 240 },
  },
  { timestamps: true },
);
salaryRecordSchema.index({ user: 1, periodKey: 1, type: 1 }, { unique: true });

const platformSettingSchema = new Schema(
  {
    key: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
    },
    value: Schema.Types.Mixed,
    visibility: {
      type: String,
      enum: ["public", "private"],
      default: "private",
    },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

const providerEventSchema = new Schema(
  {
    provider: { type: String, required: true, index: true },
    eventId: { type: String, required: true },
    eventType: { type: String, required: true },
    payload: Schema.Types.Mixed,
    processedAt: Date,
    status: {
      type: String,
      enum: ["received", "processed", "rejected", "failed"],
      default: "received",
    },
    error: { type: String, maxlength: 500 },
  },
  { timestamps: true },
);
providerEventSchema.index({ provider: 1, eventId: 1 }, { unique: true });

const auditLogSchema = new Schema(
  {
    actor: { type: Schema.Types.ObjectId, ref: "User" },
    action: { type: String, required: true, index: true },
    subject: Schema.Types.Mixed,
    ip: String,
    metadata: Schema.Types.Mixed,
  },
  { timestamps: true },
);

export const User = model("User", userSchema);
export const WalletTransaction = model(
  "WalletTransaction",
  walletTransactionSchema,
);
export const PayoutDestination = model(
  "PayoutDestination",
  payoutDestinationSchema,
);
export const PaymentRequest = model("PaymentRequest", paymentRequestSchema);
export const GameRound = model("GameRound", gameRoundSchema);
export const Bet = model("Bet", betSchema);
export const PromotionClaim = model("PromotionClaim", promotionClaimSchema);
export const CommissionRecord = model(
  "CommissionRecord",
  commissionRecordSchema,
);
export const GiftCode = model("GiftCode", giftCodeSchema);
export const GiftCodeRedemption = model(
  "GiftCodeRedemption",
  giftCodeRedemptionSchema,
);
export const OneTimeCode = model("OneTimeCode", oneTimeCodeSchema);
export const SalaryRecord = model("SalaryRecord", salaryRecordSchema);
export const PlatformSetting = model("PlatformSetting", platformSettingSchema);
export const ProviderEvent = model("ProviderEvent", providerEventSchema);
export const AuditLog = model("AuditLog", auditLogSchema);
