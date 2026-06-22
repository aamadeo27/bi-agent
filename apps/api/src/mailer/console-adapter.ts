import { logger } from "../observability/logger.js";
import type { MailerPort } from "./port.js";

/**
 * Console/stub mailer for dev — prints invite details to stdout.
 * Swap for an SMTP or SES adapter in production.
 */
export const consoleMailer: MailerPort = {
  async sendInvite({ to, displayName, inviteUrl }) {
    logger.info({ to, displayName, inviteUrl }, "[mailer:console] invite email dispatched");
    // Also write to stdout so it's visible in dev docker-compose logs.
    process.stdout.write(
      `\n--- INVITE EMAIL ---\nTo: ${to} (${displayName})\nInvite URL: ${inviteUrl}\n--------------------\n`
    );
  },
};
