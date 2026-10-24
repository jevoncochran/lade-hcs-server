import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation.js';
import { PaymentStatus } from '../generated/prisma/client.js';
import * as emails from '../mail/booking-templates.js';
import { Mailer, type MailMessage } from '../mail/mailer.js';
import { PrismaService } from '../prisma/prisma.service.js';

export type StaffAction =
  'confirmed' | 'cancelled' | 'no_show' | 'completed' | 'charge_retried';

// Booking emails to the customer who booked and to staff. Sent after the
// change is saved, and never allowed to undo or block it: a failed email
// is logged (booking id only) and the booking carries on.
@Injectable()
export class BookingNotificationsService {
  private readonly logger = new Logger(BookingNotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: Mailer,
    private readonly config: ConfigService<Env, true>,
  ) {}

  // The card is saved: the request reaches Lade.
  async requestReceived(bookingId: string) {
    const booking = await this.load(bookingId);
    if (!booking) return;
    const staff = await this.activeStaffEmails();

    await this.deliver(bookingId, 'request_received', [
      emails.requestReceived(
        booking.requesterEmail,
        booking.reference,
        this.link('/account'),
      ),
      ...staff.map((email) =>
        emails.staffNewRequest(
          email,
          booking.reference,
          this.link(`/admin/bookings/${booking.id}`),
        ),
      ),
    ]);
  }

  // After a staff action and any charge it triggered.
  async afterStaffAction(bookingId: string, action: StaffAction) {
    const booking = await this.load(bookingId);
    if (!booking) return;

    const to = booking.requesterEmail;
    const ref = booking.reference;
    const account = this.link('/account');
    const payment = booking.payments[0];
    const owed = booking.charges.reduce((sum, c) => sum + c.amountCents, 0);
    const charged = payment?.status === PaymentStatus.CHARGED;
    const declined = payment?.status === PaymentStatus.FAILED;
    const fee: emails.Fee = owed > 0 ? { cents: owed, charged } : null;
    const failed = declined
      ? [emails.chargeFailed(to, ref, owed, this.link('/contact'))]
      : [];

    const messages: Record<StaffAction, MailMessage[]> = {
      confirmed: [emails.rideConfirmed(to, ref, account)],
      cancelled: [emails.rideCancelled(to, ref, fee, account), ...failed],
      no_show: [emails.noShow(to, ref, fee, account), ...failed],
      // No answer from the card yet: the receipt comes with the retry.
      completed: charged ? [emails.receipt(to, ref, owed, account)] : failed,
      // Staff retry while talking to the customer: only the good news.
      charge_retried: charged ? [emails.receipt(to, ref, owed, account)] : [],
    };
    await this.deliver(bookingId, action, messages[action]);
  }

  // The customer cancelled on the website: their confirmation (with any
  // fee), and a heads-up to every active staff member.
  async cancelledByCustomer(bookingId: string) {
    await this.afterStaffAction(bookingId, 'cancelled');
    const booking = await this.load(bookingId);
    if (!booking) return;
    const staff = await this.activeStaffEmails();
    await this.deliver(
      bookingId,
      'cancelled_by_customer',
      staff.map((email) =>
        emails.staffRideCancelled(
          email,
          booking.reference,
          this.link(`/admin/bookings/${booking.id}`),
        ),
      ),
    );
  }

  private async activeStaffEmails() {
    const staff = await this.prisma.staffUser.findMany({
      where: { isActive: true },
      select: { email: true },
    });
    return staff.map((member) => member.email);
  }

  private load(bookingId: string) {
    return this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        reference: true,
        requesterEmail: true,
        payments: { orderBy: { createdAt: 'desc' }, take: 1 },
        charges: { select: { amountCents: true } },
      },
    });
  }

  private async deliver(
    bookingId: string,
    kind: string,
    messages: MailMessage[],
  ) {
    for (const message of messages) {
      try {
        await this.mailer.send(message);
      } catch (error) {
        this.logger.error(
          `Booking email "${kind}" for booking ${bookingId} wasn't sent: ${error instanceof Error ? error.name : 'unknown error'}`,
        );
      }
    }
  }

  private link(path: string) {
    return `${this.config.get('SITE_URL', { infer: true })}${path}`;
  }
}
