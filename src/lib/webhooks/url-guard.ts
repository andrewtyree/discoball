/**
 * Webhook URL guard — keeps outbound deliveries from being aimed at the
 * server's own network (SSRF). Enforced at webhook creation AND again at
 * delivery time, but only in production unless ALLOW_PRIVATE_WEBHOOKS=1 —
 * local demos post to a localhost receiver.
 *
 * Known simplification (documented in docs/ops.md): the guard checks the
 * URL's literal host, not what its DNS name resolves to at delivery time,
 * so it does not defend against DNS rebinding. Production hardening would
 * resolve-and-pin before connecting.
 */

/** Structural problems — enforced everywhere, every time. */
export function webhookUrlProblem(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "That isn't a valid URL.";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "Webhook URLs must be http:// or https://.";
  }
  if (url.username !== "" || url.password !== "") {
    return "Webhook URLs must not embed credentials.";
  }
  return null;
}

const PRIVATE_V4 = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^0\./,
];

/** Is this hostname loopback / private / link-local? (Literal host only.) */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    return true;
  }
  if (PRIVATE_V4.some((re) => re.test(host))) return true;
  // IPv6: loopback, unspecified, unique-local (fc00::/7), link-local (fe80::/10),
  // and v4-mapped forms of any of the above.
  if (host === "::1" || host === "::") return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(host)) return true;
  if (/^fe[89ab][0-9a-f]:/i.test(host)) return true;
  const v4mapped = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (v4mapped) return isPrivateHost(v4mapped[1]);
  return false;
}

/** Whether the private-host guard applies in this process. */
export function privateHostsBlocked(
  env: { NODE_ENV?: string; ALLOW_PRIVATE_WEBHOOKS?: string } = process.env,
): boolean {
  return env.NODE_ENV === "production" && env.ALLOW_PRIVATE_WEBHOOKS !== "1";
}

/**
 * Full check for one URL under the given environment: structure always,
 * private hosts only where blocked. Returns a user-facing problem or null.
 */
export function webhookDeliveryProblem(
  raw: string,
  env: { NODE_ENV?: string; ALLOW_PRIVATE_WEBHOOKS?: string } = process.env,
): string | null {
  const structural = webhookUrlProblem(raw);
  if (structural) return structural;
  if (privateHostsBlocked(env) && isPrivateHost(new URL(raw).hostname)) {
    return "Webhook URLs must be public addresses (private and loopback hosts are blocked in production).";
  }
  return null;
}
