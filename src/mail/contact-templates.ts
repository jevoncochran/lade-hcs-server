import type { MailMessage } from './mailer.js';

// A contact form message, to Lade's own inbox (CONTACT_INBOX, a Google
// Workspace mailbox under its BAA). Visitors may describe health details, so
// this email only ever goes there, and is never logged or stored.

// No line breaks or runs of spaces in a subject line.
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

export const contactMessage = (
  to: string,
  message: {
    name: string;
    email: string;
    phone?: string;
    topic: string; // label
    text: string;
  },
): MailMessage => ({
  to,
  replyTo: message.email,
  subject: oneLine(`Website message from ${message.name}`),
  text:
    `New message from the contact form on ladehcs.com. Reply to this email to answer ${oneLine(message.name)}.\n\n` +
    `Name: ${oneLine(message.name)}\n` +
    `Email: ${message.email}\n` +
    `Phone: ${message.phone || 'Not provided'}\n` +
    `About: ${message.topic}\n\n` +
    `${message.text}\n`,
});
