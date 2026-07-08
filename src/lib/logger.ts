/**
 * Structured logging.
 *
 * Every server-side log line is a single JSON object so log aggregators
 * (CloudWatch, Loki, Datadog, `docker logs` + jq) can filter on fields
 * instead of grepping prose. Usage:
 *
 *   import { logger } from "@/lib/logger";
 *   logger.info("generation run completed", { runId, recordCount });
 *   logger.error("webhook delivery failed", { webhookId, err });
 *
 * `child(context)` returns a logger that stamps the given fields onto every
 * line, so a subsystem can bind e.g. `{ module: "webhooks" }` once.
 *
 * The formatting core (`formatLogLine`, `shouldLog`, `serializeError`) is
 * pure and unit-tested; only the thin emitter touches the console and the
 * clock. Line shape: `{"time":"…","level":"info","msg":"…", …context}`.
 * `LOG_LEVEL` (debug|info|warn|error, default "info") sets the threshold.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogContext = Record<string, unknown>;

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export const LOG_LEVELS = Object.keys(LEVEL_ORDER) as LogLevel[];

/** Is `level` at or above the configured `threshold`? */
export function shouldLog(level: LogLevel, threshold: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[threshold];
}

/** Coerce an unknown LOG_LEVEL value to a valid threshold (default "info"). */
export function parseLogLevel(raw: string | undefined): LogLevel {
  return raw && (LOG_LEVELS as string[]).includes(raw) ? (raw as LogLevel) : "info";
}

/** Flatten an Error (or anything thrown) into JSON-safe fields. */
export function serializeError(err: unknown): { name: string; message: string; stack?: string } {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, ...(err.stack ? { stack: err.stack } : {}) };
  }
  return { name: "NonError", message: String(err) };
}

/**
 * Render one log line. Reserved keys (`time`, `level`, `msg`) win over
 * context; `undefined` values are dropped (JSON.stringify would anyway, but
 * dropping keeps key order stable); Error values are expanded via
 * `serializeError`; circular references degrade to "[circular]" rather than
 * throwing inside the logger.
 */
export function formatLogLine(
  level: LogLevel,
  msg: string,
  context: LogContext,
  time: Date,
): string {
  const entry: Record<string, unknown> = { time: time.toISOString(), level, msg };
  for (const [key, value] of Object.entries(context)) {
    if (value === undefined || key === "time" || key === "level" || key === "msg") continue;
    entry[key] = value instanceof Error ? serializeError(value) : value;
  }
  const seen = new WeakSet<object>();
  return JSON.stringify(entry, (_key, value: unknown) => {
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) return "[circular]";
      seen.add(value);
    }
    if (typeof value === "bigint") return value.toString();
    return value;
  });
}

export interface Logger {
  debug(msg: string, context?: LogContext): void;
  info(msg: string, context?: LogContext): void;
  warn(msg: string, context?: LogContext): void;
  error(msg: string, context?: LogContext): void;
  child(context: LogContext): Logger;
}

function emit(level: LogLevel, line: string): void {
  // warn/error go to stderr so `docker logs` severity streams stay separable.
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function createLogger(base: LogContext = {}): Logger {
  const log = (level: LogLevel, msg: string, context: LogContext = {}) => {
    if (!shouldLog(level, parseLogLevel(process.env.LOG_LEVEL))) return;
    emit(level, formatLogLine(level, msg, { ...base, ...context }, new Date()));
  };
  return {
    debug: (msg, context) => log("debug", msg, context),
    info: (msg, context) => log("info", msg, context),
    warn: (msg, context) => log("warn", msg, context),
    error: (msg, context) => log("error", msg, context),
    child: (context) => createLogger({ ...base, ...context }),
  };
}

/** App-wide root logger. Subsystems bind their own via `logger.child(...)`. */
export const logger = createLogger();
