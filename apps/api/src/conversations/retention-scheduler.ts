import { logger } from "../observability/logger.js";
import { purgeExpiredConversations, DEFAULT_RETENTION_DAYS } from "./retention-purge.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Start a daily retention purge scheduler.
 *
 * Reads the retention window from HISTORY_RETENTION_DAYS (default 365).
 * The timer is unref'd so it does not prevent a clean process exit.
 * Safe to call multiple times — each call starts an independent interval.
 *
 * @returns NodeJS.Timeout — call clearInterval() to stop.
 */
export function startRetentionScheduler(): ReturnType<typeof setTimeout> {
  const olderThanDays = Number(
    process.env["HISTORY_RETENTION_DAYS"] ?? DEFAULT_RETENTION_DAYS,
  );

  logger.info(
    { olderThanDays, cadenceDays: 1 },
    "Retention scheduler started — runs daily",
  );

  const timer = setInterval(async () => {
    logger.info({ event: "retention_purge_start", olderThanDays }, "Retention purge job started");
    try {
      const result = await purgeExpiredConversations({ olderThanDays });
      logger.info(
        {
          event: "retention_purge_complete",
          tenantsProcessed: result.tenantsProcessed,
          tenantsErrored: result.tenantsErrored,
          totalDeletedConversations: result.summaries.reduce(
            (sum, s) => sum + s.deletedConversations,
            0,
          ),
        },
        "Retention purge job complete",
      );
    } catch (err) {
      logger.error({ event: "retention_purge_fatal", err }, "Retention purge job failed");
    }
  }, MS_PER_DAY);

  // Unref so the timer does not keep the process alive after graceful shutdown.
  timer.unref();
  return timer;
}
