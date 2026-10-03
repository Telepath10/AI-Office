// Shared helpers: secret redaction for error messages and bounded string tails.

const SECRET_ENV_NAME = /KEY|SECRET|TOKEN|PASSWORD|SESSION|CT0|LOGIN/i;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Strip bearer tokens, credential query params, URL userinfo and known secret env values. */
export function redact(text: string): string {
  let out = String(text ?? "");
  out = out.replace(/Bearer\s+[A-Za-z0-9._~+\/=-]+/gi, "Bearer [REDACTED]");
  out = out.replace(/\b(key|access_token|token|api_key|password|secret)=([^&\s"'<>]+)/gi, "$1=[REDACTED]");
  out = out.replace(/(https?:\/\/)[^\/\s:@]+:[^\/\s@]+@/gi, "$1[REDACTED]@");
  const values = Object.entries(process.env)
    .filter(([name, value]) => SECRET_ENV_NAME.test(name) && typeof value === "string" && value.length >= 6)
    .map(([, value]) => value as string)
    .sort((a, b) => b.length - a.length);
  for (const v of new Set(values)) {
    out = out.replace(new RegExp(escapeRegExp(v), "g"), "[REDACTED]");
  }
  return out;
}

/** Last n characters of text (whole text when shorter). */
export function tail(text: string, n = 600): string {
  const s = String(text ?? "");
  return s.length > n ? s.slice(s.length - n) : s;
}
