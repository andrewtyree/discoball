/**
 * Next.js instrumentation — the error-reporting seam.
 *
 * `onRequestError` receives every unhandled server error (server components,
 * server actions, route handlers) and emits one structured log line. An
 * error-reporting SaaS drops in HERE with one line, e.g. Sentry:
 *
 *   import * as Sentry from "@sentry/nextjs";
 *   export const onRequestError = Sentry.captureRequestError;
 *
 * See docs/ops.md ("Logging & error reporting").
 */
import type { Instrumentation } from "next";

import { logger } from "@/lib/logger";

export function register(): void {
  logger.info("server starting", {
    module: "instrumentation",
    node: process.version,
    runtime: process.env.NEXT_RUNTIME,
    logLevel: process.env.LOG_LEVEL ?? "info",
  });
}

export const onRequestError: Instrumentation.onRequestError = async (
  err,
  request,
  context,
) => {
  logger.error("unhandled request error", {
    module: "instrumentation",
    path: request.path,
    method: request.method,
    routerKind: context.routerKind,
    routePath: context.routePath,
    routeType: context.routeType,
    err,
  });
};
