import type { MailMessage } from './mailer.js';

// Plain-text account emails. No PHI: they never mention rides, riders or
// health details. Links carry one-time tokens; the website pages that open
// them must send `Referrer-Policy: no-referrer` so tokens don't leak.

const signature = '\n\nLade Health Care Services';

export const verifyEmail = (to: string, link: string): MailMessage => ({
  to,
  subject: 'Confirm your email address',
  text:
    `Confirm your email address to finish setting up your account:\n\n${link}\n\n` +
    `This link expires in 24 hours. If you didn't create an account, you can ignore this email.` +
    signature,
});

export const alreadyRegistered = (
  to: string,
  loginLink: string,
  resetLink: string,
): MailMessage => ({
  to,
  subject: 'You already have an account',
  text:
    `Someone (hopefully you) tried to create an account with this email address, ` +
    `but you already have one.\n\nSign in: ${loginLink}\n` +
    `Forgot your password? ${resetLink}\n\n` +
    `If this wasn't you, you can ignore this email. Your account hasn't changed.` +
    signature,
});

export const resetPassword = (to: string, link: string): MailMessage => ({
  to,
  subject: 'Reset your password',
  text:
    `Use this link to choose a new password:\n\n${link}\n\n` +
    `It expires in 1 hour and works once. If you didn't ask to reset your password, ` +
    `you can ignore this email.` +
    signature,
});

export const passwordChanged = (to: string): MailMessage => ({
  to,
  subject: 'Your password was changed',
  text:
    `The password for your account was just changed and you were signed out everywhere.\n\n` +
    `If you didn't do this, contact Lade Health Care Services right away.` +
    signature,
});
