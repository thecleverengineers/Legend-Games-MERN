import { AppError } from "../lib/http.js";
import {
  CommissionRecord,
  GiftCode,
  GiftCodeRedemption,
  PromotionClaim,
  User,
  WalletTransaction,
} from "../models/index.js";
import {
  asMoney,
  createReference,
  creditWallet,
  withWalletTransaction,
} from "./wallet.js";

const timezone = () => process.env.BUSINESS_TIMEZONE || "Asia/Kolkata";
const dayKey = (value = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
const dayBounds = (value = new Date()) => {
  const key = dayKey(value);
  const [year, month, day] = key.split("-").map(Number);
  const localMidnightAsUtc = Date.UTC(year, month - 1, day);
  const localized = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(new Date(localMidnightAsUtc))
    .reduce((parts, part) => ({ ...parts, [part.type]: part.value }), {});
  const offset =
    Date.UTC(
      Number(localized.year),
      Number(localized.month) - 1,
      Number(localized.day),
      Number(localized.hour),
      Number(localized.minute),
      Number(localized.second),
    ) - localMidnightAsUtc;
  const start = new Date(localMidnightAsUtc - offset);
  return { key, start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
};

const vipTiers = [
  { level: 0, wagered: 0 },
  { level: 1, wagered: 500 },
  { level: 2, wagered: 2_000 },
  { level: 3, wagered: 10_000 },
  { level: 4, wagered: 50_000 },
  { level: 5, wagered: 250_000 },
  { level: 6, wagered: 1_000_000 },
];

export const getVipLevel = (wagered = 0) =>
  vipTiers.reduce(
    (level, tier) => (wagered >= tier.wagered ? tier.level : level),
    0,
  );

export async function syncVipLevel(userId, session) {
  const user = await User.findById(userId).session(session || null);
  if (!user) throw new AppError("Account not found", 404, "USER_NOT_FOUND");
  const vipLevel = getVipLevel(user.wallet?.lifetimeWagered || 0);
  if (user.vipLevel !== vipLevel) {
    user.vipLevel = vipLevel;
    await user.save(session ? { session } : undefined);
  }
  return user;
}

async function claimAndCredit({
  userId,
  type,
  claimKey,
  amount,
  bucket = "bonus",
  description,
  metadata = {},
  session,
}) {
  const value = asMoney(amount);
  return withWalletTransaction(async (activeSession) => {
    try {
      await PromotionClaim.create(
        [{ user: userId, type, claimKey, amount: value, metadata }],
        { session: activeSession },
      );
    } catch (error) {
      if (error?.code === 11000)
        throw new AppError(
          "This reward has already been claimed",
          409,
          "ALREADY_CLAIMED",
        );
      throw error;
    }
    const reference = createReference("BONUS");
    const user = await creditWallet({
      userId,
      amount: value,
      type: "bonus",
      bucket,
      reference,
      description,
      metadata: { promotion: type, claimKey, ...metadata },
      session: activeSession,
    });
    return { user, amount: value, reference };
  }, session);
}

export async function claimDailyCheckin(userId) {
  return claimAndCredit({
    userId,
    type: "daily_checkin",
    claimKey: dayKey(),
    amount: 5,
    description: "Daily check-in reward",
  });
}

export async function attendanceStatus(userId) {
  const claims = await PromotionClaim.find({ user: userId, type: "attendance" })
    .sort({ createdAt: -1 })
    .limit(31)
    .lean();
  const keys = new Set(claims.map((claim) => claim.claimKey));
  let streak = 0;
  const cursor = new Date();
  for (let offset = 1; offset <= 30; offset += 1) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    if (!keys.has(dayKey(cursor))) break;
    streak += 1;
  }
  const today = dayKey();
  return {
    claimedToday: keys.has(today),
    currentStreak: streak,
    nextReward: [5, 8, 10, 15, 20, 25, 30][Math.min(streak, 6)],
  };
}

export async function claimAttendance(userId) {
  const status = await attendanceStatus(userId);
  return claimAndCredit({
    userId,
    type: "attendance",
    claimKey: dayKey(),
    amount: status.nextReward,
    description: `Attendance day ${status.currentStreak + 1} reward`,
    metadata: { day: status.currentStreak + 1 },
  });
}

export async function claimFirstDeposit(userId) {
  const deposit = await WalletTransaction.findOne({
    user: userId,
    type: "deposit",
    direction: "credit",
  })
    .sort({ createdAt: 1 })
    .lean();
  if (!deposit)
    throw new AppError(
      "Make a completed deposit before claiming this reward",
      409,
      "DEPOSIT_REQUIRED",
    );
  const amount = Math.min(500, asMoney(deposit.amount * 0.1));
  return claimAndCredit({
    userId,
    type: "first_deposit",
    claimKey: "first",
    amount,
    description: "First deposit reward",
    metadata: { depositReference: deposit.reference },
  });
}

export async function claimDailyDeposit(userId) {
  const { key, start, end } = dayBounds();
  const deposits = await WalletTransaction.aggregate([
    {
      $match: {
        user: userId,
        type: "deposit",
        direction: "credit",
        createdAt: { $gte: start, $lt: end },
      },
    },
    { $group: { _id: null, amount: { $sum: "$amount" } } },
  ]);
  const total = asMoney(deposits[0]?.amount || 0);
  if (total <= 0)
    throw new AppError(
      "A completed deposit is required today",
      409,
      "DEPOSIT_REQUIRED",
    );
  return claimAndCredit({
    userId,
    type: "daily_deposit",
    claimKey: key,
    amount: Math.min(250, asMoney(total * 0.02)),
    description: "Daily deposit reward",
    metadata: { deposited: total },
  });
}

export async function invitationStatus(userId) {
  const referrals = await User.find({ referredBy: userId })
    .select("name phone email createdAt status")
    .sort({ createdAt: -1 })
    .lean();
  const claims = await PromotionClaim.find({ user: userId, type: "invitation" })
    .select("claimKey")
    .lean();
  const claimed = new Set(claims.map((claim) => claim.claimKey));
  return {
    referrals,
    claimable: referrals.filter(
      (referral) =>
        referral.status === "active" && !claimed.has(String(referral._id)),
    ),
  };
}

export async function claimInvitation(userId, referralId) {
  const referral = await User.findOne({
    _id: referralId,
    referredBy: userId,
    status: "active",
  }).lean();
  if (!referral)
    throw new AppError(
      "Eligible invited member was not found",
      404,
      "REFERRAL_NOT_FOUND",
    );
  return claimAndCredit({
    userId,
    type: "invitation",
    claimKey: String(referral._id),
    amount: 10,
    description: "Invitation reward",
    metadata: { referral: referral._id },
  });
}

export async function redeemGiftCode(userId, rawCode) {
  const codeValue = String(rawCode || "")
    .trim()
    .toUpperCase();
  if (!codeValue)
    throw new AppError("Enter a gift code", 422, "INVALID_GIFT_CODE");
  return withWalletTransaction(async (session) => {
    const gift = await GiftCode.findOneAndUpdate(
      {
        code: codeValue,
        active: true,
        $expr: { $lt: ["$usedCount", "$maxUses"] },
        $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
      },
      { $inc: { usedCount: 1 } },
      { new: true, session },
    );
    if (!gift)
      throw new AppError(
        "This gift code is unavailable or has expired",
        404,
        "GIFT_CODE_UNAVAILABLE",
      );
    const reference = createReference("GIFT");
    try {
      await GiftCodeRedemption.create(
        [{ code: gift.id, user: userId, amount: gift.amount, reference }],
        { session },
      );
    } catch (error) {
      if (error?.code === 11000) {
        await GiftCode.updateOne(
          { _id: gift.id },
          { $inc: { usedCount: -1 } },
          { session },
        );
        throw new AppError(
          "You have already redeemed this gift code",
          409,
          "GIFT_ALREADY_REDEEMED",
        );
      }
      throw error;
    }
    const user = await creditWallet({
      userId,
      amount: gift.amount,
      type: "bonus",
      bucket: gift.bucket,
      reference,
      description: `Gift code ${gift.code}`,
      metadata: { code: gift.code },
      session,
    });
    return { user, amount: gift.amount, reference, code: gift.code };
  });
}

/** Credits multi-level referral commission when a wager is accepted. */
export async function recordWagerCommission({
  bettorId,
  betId,
  wager,
  session,
}) {
  const rates = [0.001, 0.0005, 0.00025];
  let source = await User.findById(bettorId)
    .select("referredBy")
    .session(session || null);
  for (let index = 0; source?.referredBy && index < rates.length; index += 1) {
    const beneficiary = await User.findById(source.referredBy)
      .select("referredBy status")
      .session(session || null);
    if (!beneficiary || beneficiary.status !== "active") break;
    const amount = asMoney(wager * rates[index]);
    const reference = `COM-${betId}-${index + 1}`;
    if (amount > 0) {
      try {
        await CommissionRecord.create(
          [
            {
              beneficiary: beneficiary.id,
              sourceUser: bettorId,
              level: index + 1,
              type: "wager",
              amount,
              reference,
              periodKey: dayKey(),
            },
          ],
          { session },
        );
        await creditWallet({
          userId: beneficiary.id,
          amount,
          type: "commission",
          bucket: "bonus",
          reference,
          description: `Level ${index + 1} wager commission`,
          metadata: { bet: betId, level: index + 1 },
          session,
        });
      } catch (error) {
        if (error?.code !== 11000) throw error;
      }
    }
    source = beneficiary;
  }
}

export async function promotionSummary(user) {
  const [
    attendance,
    invitations,
    todayDeposit,
    firstDepositClaim,
    dailyDepositClaim,
    commissions,
  ] = await Promise.all([
    attendanceStatus(user.id),
    invitationStatus(user.id),
    WalletTransaction.aggregate([
      {
        $match: {
          user: user._id,
          type: "deposit",
          direction: "credit",
          createdAt: { $gte: dayBounds().start, $lt: dayBounds().end },
        },
      },
      { $group: { _id: null, amount: { $sum: "$amount" } } },
    ]),
    PromotionClaim.exists({
      user: user.id,
      type: "first_deposit",
      claimKey: "first",
    }),
    PromotionClaim.exists({
      user: user.id,
      type: "daily_deposit",
      claimKey: dayKey(),
    }),
    CommissionRecord.aggregate([
      { $match: { beneficiary: user._id } },
      { $group: { _id: null, amount: { $sum: "$amount" } } },
    ]),
  ]);
  const checkinClaimed = await PromotionClaim.exists({
    user: user.id,
    type: "daily_checkin",
    claimKey: dayKey(),
  });
  const depositedToday = asMoney(todayDeposit[0]?.amount || 0);
  return {
    dailyCheckin: { amount: 5, claimed: Boolean(checkinClaimed) },
    attendance,
    firstDeposit: {
      eligible: (user.wallet?.lifetimeDeposits || 0) > 0,
      claimed: Boolean(firstDepositClaim),
    },
    dailyDeposit: {
      depositedToday,
      eligible: depositedToday > 0,
      claimed: Boolean(dailyDepositClaim),
    },
    referral: {
      code: user.referralCode,
      signups: invitations.referrals.length,
      rewardPerSignup: 10,
      claimable: invitations.claimable.map((entry) => ({
        id: entry._id,
        name: entry.name,
        joinedAt: entry.createdAt,
      })),
    },
    vip: {
      level: user.vipLevel,
      currentWagered: user.wallet?.lifetimeWagered || 0,
      tiers: vipTiers,
    },
    commission: { total: asMoney(commissions[0]?.amount || 0) },
  };
}

export async function teamSummary(userId) {
  const direct = await User.find({ referredBy: userId })
    .select("name email phone role status wallet createdAt referralCode")
    .sort({ createdAt: -1 })
    .lean();
  const ids = direct.map((member) => member._id);
  const [wagered, deposits, commissions] = await Promise.all([
    WalletTransaction.aggregate([
      { $match: { user: { $in: ids }, type: "bet" } },
      { $group: { _id: null, amount: { $sum: "$amount" } } },
    ]),
    WalletTransaction.aggregate([
      { $match: { user: { $in: ids }, type: "deposit" } },
      { $group: { _id: null, amount: { $sum: "$amount" } } },
    ]),
    CommissionRecord.aggregate([
      { $match: { beneficiary: userId } },
      { $group: { _id: null, amount: { $sum: "$amount" } } },
    ]),
  ]);
  return {
    members: direct,
    totals: {
      members: direct.length,
      wagered: asMoney(wagered[0]?.amount || 0),
      deposits: asMoney(deposits[0]?.amount || 0),
      commissions: asMoney(commissions[0]?.amount || 0),
    },
  };
}
