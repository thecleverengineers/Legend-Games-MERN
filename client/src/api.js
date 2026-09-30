const writeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export async function api(path, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const headers = {
    ...(options.body ? { "content-type": "application/json" } : {}),
    ...(options.headers || {}),
  };
  if (
    writeMethods.has(method) &&
    !headers["x-idempotency-key"] &&
    globalThis.crypto?.randomUUID
  )
    headers["x-idempotency-key"] = globalThis.crypto.randomUUID();
  const response = await fetch(`/api${path}`, {
    credentials: "include",
    ...options,
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok)
    throw new Error(
      payload?.error?.message ||
        payload?.message ||
        "Something went wrong. Please try again.",
    );
  return payload.data;
}

export const inr = (value) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
export const dateTime = (value) =>
  value
    ? new Intl.DateTimeFormat("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "—";
export const shortDate = (value) =>
  value
    ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(
        new Date(value),
      )
    : "—";
