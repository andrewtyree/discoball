/**
 * Client IP extraction for rate-limit keys.
 *
 * Behind the demo's single proxy (or none), the first hop of
 * `x-forwarded-for` is the best available identity. It is spoofable by a
 * direct client — acceptable here because the IP only partitions rate-limit
 * buckets (a spoofer gains fresh buckets, not access), and per-email keying
 * still throttles targeted attempts. Production would trust only the header
 * written by its own edge proxy.
 */
export function clientIpFrom(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  return "unknown";
}
