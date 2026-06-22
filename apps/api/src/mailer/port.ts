/** Mailer abstraction — swap console adapter (dev) for SMTP/SES in prod. */
export interface MailerPort {
  sendInvite(params: {
    to: string;
    displayName: string;
    inviteUrl: string;
  }): Promise<void>;
}
