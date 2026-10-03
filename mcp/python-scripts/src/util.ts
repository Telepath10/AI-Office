// Shared helpers: secret redaction and tail-trimming for error messages.

const SECRET_ENV_NAME = /KEY|SECRET|TOKEN|PASSWORD|SESSION|CT0|LOGIN/i;

function secretEnvValues(): string[] {
  const vals = new Set<string>();
  for (const [name, value] of Object.entries(process.env)) {
    if (!value || value.length < 6 || !SECRET_ENV_NAME.test(name)) continue;
    vals.add(value);
  }
  // Longest first so a value containing another is replaced whole.
  return [...vals].sort((a, b) => b.length - a.length);
}

/** Strip credentials from text that may end up in tool output or logs. */
export function redact(text: string): string {
  let out = String(text ?? "");
  for (const v of secretEnvValues()) out = out.split(v).join("[REDACTED]");
  return out
    .replace(/Bearer\s+[A-Za-z0-9._~+\/=-]+/g, "Bearer [REDACTED]")
    .replace(/\b(key|apikey|access_token|token|api_key|password|secret)=(?!\[REDACTED\])[^&\s"'<>]+/gi, "$1=[REDACTED]")
    .replace(/(https?:\/\/)[^\/\s:@]+:[^\/\s@]+@/g, "$1[REDACTED]@");
}

/** Last n characters of text (trimmed), prefixed with an ellipsis when cut. */
export function tail(text: string, n = 600): string {
  const s = String(text ?? "").trim();
  return s.length > n ? "…" + s.slice(-n) : s;
}
