type LogArgs = unknown[];

/** Lightweight console-based replacement for pino (edge runtime friendly). */
export const logger = {
  info: (...args: LogArgs) => console.log("[info]", ...args),
  warn: (...args: LogArgs) => console.warn("[warn]", ...args),
  error: (...args: LogArgs) => console.error("[error]", ...args),
  debug: (...args: LogArgs) => console.debug("[debug]", ...args),
};
