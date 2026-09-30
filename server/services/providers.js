import crypto from "node:crypto";
import { AppError } from "../lib/http.js";
import { ProviderEvent, User } from "../models/index.js";
import {
  asMoney,
  createReference,
  creditWallet,
  debitWallet,
  withWalletTransaction,
} from "./wallet.js";

const providerConfig = {
  jili: {
    label: "JILI",
    enabled: "PROVIDER_JILI_ENABLED",
    launchUrl: "JILI_LAUNCH_URL",
    secret: "JILI_CALLBACK_SECRET",
  },
  jdb: {
    label: "JDB",
    enabled: "PROVIDER_JDB_ENABLED",
    launchUrl: "JDB_LAUNCH_URL",
    secret: "JDB_CALLBACK_SECRET",
  },
  aviator: {
    label: "Aviator",
    enabled: "PROVIDER_AVIATOR_ENABLED",
    launchUrl: "AVIATOR_LAUNCH_URL",
    secret: "AVIATOR_CALLBACK_SECRET",
  },
};

const configFor = (provider) => {
  const config = providerConfig[String(provider || "").toLowerCase()];
  if (!config)
    throw new AppError("Unknown provider", 404, "PROVIDER_NOT_FOUND");
  return config;
};
const isEnabled = (config) =>
  process.env[config.enabled] === "true" &&
  Boolean(process.env[config.launchUrl]) &&
  Boolean(process.env[config.secret]);
const secretFor = (config) => process.env[config.secret] || "";
const safeEqual = (left, right) => {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const canonicalPayload = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalPayload).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalPayload(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

export function providerStatus() {
  return Object.entries(providerConfig).map(([id, config]) => ({
    id,
    label: config.label,
    enabled: isEnabled(config),
  }));
}

export function createProviderLaunch({ provider, user, gameId, returnUrl }) {
  const config = configFor(provider);
  if (!isEnabled(config))
    throw new AppError(
      `${config.label} is not configured yet`,
      503,
      "PROVIDER_NOT_CONFIGURED",
    );
  const timestamp = Date.now().toString();
  const payload = `${user.id}:${gameId || "lobby"}:${timestamp}`;
  const signature = crypto
    .createHmac("sha256", secretFor(config))
    .update(payload)
    .digest("hex");
  const url = new URL(process.env[config.launchUrl]);
  url.searchParams.set("player", user.id);
  url.searchParams.set("game", gameId || "lobby");
  url.searchParams.set("timestamp", timestamp);
  url.searchParams.set("signature", signature);
  if (returnUrl) url.searchParams.set("return_url", returnUrl);
  return {
    url: url.toString(),
    expiresAt: new Date(Number(timestamp) + 5 * 60_000),
    provider,
    gameId: gameId || null,
  };
}

export function verifyProviderSignature(provider, payload, signature) {
  const config = configFor(provider);
  if (!isEnabled(config))
    throw new AppError(
      `${config.label} callback is not enabled`,
      403,
      "PROVIDER_DISABLED",
    );
  const expected = crypto
    .createHmac("sha256", secretFor(config))
    .update(canonicalPayload(payload))
    .digest("hex");
  if (!safeEqual(expected, signature))
    throw new AppError(
      "Provider signature is invalid",
      401,
      "INVALID_PROVIDER_SIGNATURE",
    );
}

/**
 * Provider funds never update a balance before signature validation, unique
 * event storage, and a MongoDB transaction. Provider adapters should map their
 * own payload into { eventId, type, userId, amount, gameId } before calling it.
 */
export async function processProviderEvent({ provider, payload, signature }) {
  verifyProviderSignature(provider, payload, signature);
  const eventId = String(payload?.eventId || payload?.id || "").trim();
  const type = String(payload?.type || payload?.eventType || "").toLowerCase();
  const userId = payload?.userId || payload?.playerId;
  const amount = asMoney(payload?.amount);
  if (
    !eventId ||
    !userId ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    !["credit", "debit", "rollback"].includes(type)
  ) {
    throw new AppError(
      "Provider event is incomplete",
      422,
      "INVALID_PROVIDER_EVENT",
    );
  }
  return withWalletTransaction(async (session) => {
    let event;
    try {
      [event] = await ProviderEvent.create(
        [{ provider, eventId, eventType: type, payload, status: "received" }],
        { session },
      );
    } catch (error) {
      if (error?.code === 11000)
        return {
          duplicate: true,
          event: await ProviderEvent.findOne({ provider, eventId }).session(
            session,
          ),
        };
      throw error;
    }
    const user = await User.findById(userId).session(session);
    if (!user || user.status !== "active") {
      event.status = "rejected";
      event.error = "Player not available";
      await event.save({ session });
      throw new AppError(
        "Provider player is not available",
        404,
        "PROVIDER_USER_NOT_FOUND",
      );
    }
    const reference = `PVD-${provider.toUpperCase()}-${eventId}`;
    if (type === "credit" || type === "rollback") {
      await creditWallet({
        userId: user.id,
        amount,
        type: type === "credit" ? "win" : "refund",
        bucket: "cash",
        reference,
        description: `${provider} ${type}`,
        metadata: { provider, eventId, gameId: payload.gameId },
        session,
      });
    } else {
      await debitWallet({
        userId: user.id,
        amount,
        type: "bet",
        bucket: "cash",
        reference,
        description: `${provider} debit`,
        metadata: { provider, eventId, gameId: payload.gameId },
        wager: true,
        session,
      });
    }
    event.status = "processed";
    event.processedAt = new Date();
    await event.save({ session });
    return { duplicate: false, event, reference };
  });
}

export const providerReference = (provider) =>
  createReference(`PVD-${String(provider || "GEN").toUpperCase()}`);
