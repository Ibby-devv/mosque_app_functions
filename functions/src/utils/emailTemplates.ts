// ============================================================================
// EMAIL TEMPLATES FOR DONATION RECEIPTS & NOTIFICATIONS
// Location: mosque_app_functions/src/utils/emailTemplates.ts
// ============================================================================
// 
// MIGRATION NOTICE: This file now uses React Email for template rendering.
// The old HTML string templates have been migrated to React Email components.
// 
// For new code, import directly from '../emails/index.js' instead.
// ============================================================================

import { render } from "@react-email/render";
import { logger } from "firebase-functions";
import { Resend } from "resend";

// Re-export config and utilities from the new email module
export {
  isValidEmail,
  normalizeEmail,
  DEFAULT_EMAIL_CONFIG,
  COLORS,
  type EmailConfig,
  type EmailResult,
} from "../emails/index.js";

// Import React Email templates
import {
  getOneTimeDonationReceiptEmail,
  getRecurringWelcomeEmail,
  getRecurringReceiptEmail,
  getPaymentFailedEmail,
  getSubscriptionCancelledEmail,
  getRefundConfirmationEmail,
  getDisputeAlertEmail,
  isValidEmail,
  normalizeEmail,
  DEFAULT_EMAIL_CONFIG,
} from "../emails/index.js";

// ============================================================================
// BACKWARDS COMPATIBLE INTERFACES
// These match the old interface signatures for drop-in replacement
// ============================================================================

export interface OneTimeDonationData {
  donorName: string;
  amount: number;
  currency: string;
  receiptNumber: string;
  date: string;
  donationType: string;
  campaignName?: string;
  cardLast4?: string;
  cardBrand?: string;
}

export interface RecurringWelcomeData {
  donorName: string;
  amount: number;
  currency: string;
  frequency: string;
  donationType: string;
  campaignName?: string;
  nextPaymentDate: string;
  /**
   * @deprecated Portal URLs expire quickly. Do not embed in emails.
   */
  manageUrl?: string;
}

export interface MonthlyReceiptData {
  donorName: string;
  amount: number;
  currency: string;
  receiptNumber: string;
  date: string;
  frequency: string;
  donationType: string;
  campaignName?: string;
  nextPaymentDate: string;
  /**
   * @deprecated Portal URLs expire quickly. Do not embed in emails.
   */
  manageUrl?: string;
}

export interface PaymentFailedData {
  donorName: string;
  amount: number;
  currency: string;
  frequency: string;
  attemptCount: number;
  nextRetryDate?: string;
  /**
   * @deprecated Portal URLs expire quickly. Do not embed in emails.
   */
  updatePaymentUrl?: string;
}

export interface SubscriptionCancelledData {
  donorName: string;
  amount: number;
  currency: string;
  frequency: string;
  donationType: string;
  totalDonated?: number;
  startDate?: string;
}

export interface RefundData {
  donorName: string;
  amount: number;
  currency: string;
  receiptNumber: string;
  refundReason?: string;
  originalDate: string;
}

export interface DisputeAlertEmailParams {
  disputeAmount: string;
  disputeDueDate: string;
  disputeReason: string;
  donorEmail: string;
  donorName: string;
  receiptNumber: string;
  disputeId: string;
}

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  from?: string;
}

// ============================================================================
// BACKWARDS COMPATIBLE EMAIL SENDING
// ============================================================================

/**
 * Sends an email with raw HTML content (backwards compatible)
 * @param params Email parameters including recipient, subject, and HTML content
 * @returns true if email was sent successfully, false otherwise
 */
export async function sendEmail(params: SendEmailParams): Promise<boolean> {
  // Validate email address
  if (!isValidEmail(params.to)) {
    logger.warn("Invalid email address provided", { to: params.to });
    return false;
  }

  const normalizedTo = normalizeEmail(params.to);

  try {
    // Short-circuit during local emulator runs
    if (
      process.env.FUNCTIONS_EMULATOR === "true" ||
      process.env.FIREBASE_EMULATOR_HUB
    ) {
      logger.info("(EMULATOR) Skipping real email send, simulating success", {
        to: normalizedTo,
        subject: params.subject,
      });
      return true;
    }

    if (!process.env.RESEND_API_KEY) {
      logger.error("RESEND_API_KEY not configured");
      return false;
    }

    const resend = new Resend(process.env.RESEND_API_KEY);

    const result = await resend.emails.send({
      from: params.from || `${DEFAULT_EMAIL_CONFIG.mosqueShortName} <${DEFAULT_EMAIL_CONFIG.fromEmail}>`,
      to: normalizedTo,
      subject: params.subject,
      html: params.html,
    });

    if (result.error) {
      logger.error("❌ Email sending failed", {
        to: normalizedTo,
        subject: params.subject,
        error: result.error.message,
      });
      return false;
    }

    logger.info("✅ Email sent successfully", {
      to: normalizedTo,
      subject: params.subject,
      emailId: result.data?.id,
    });

    return true;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error("❌ Email sending failed", {
      to: normalizedTo,
      subject: params.subject,
      error: errorMessage,
    });
    return false;
  }
}

// ============================================================================
// BACKWARDS COMPATIBLE TEMPLATE FUNCTIONS
// These render React Email components to HTML strings for compatibility
// ============================================================================

/**
 * One-time donation receipt email
 */
export async function oneTimeDonationReceipt(data: OneTimeDonationData): Promise<{
  subject: string;
  html: string;
}> {
  const email = getOneTimeDonationReceiptEmail(data);
  const html = await render(email.component);
  return {
    subject: email.subject,
    html,
  };
}

/**
 * Recurring donation welcome email
 */
export async function recurringDonationWelcome(data: RecurringWelcomeData): Promise<{
  subject: string;
  html: string;
}> {
  const email = getRecurringWelcomeEmail(data);
  const html = await render(email.component);
  return {
    subject: email.subject,
    html,
  };
}

/**
 * Monthly recurring receipt email
 */
export async function monthlyRecurringReceipt(data: MonthlyReceiptData): Promise<{
  subject: string;
  html: string;
}> {
  const email = getRecurringReceiptEmail({
    donorName: data.donorName,
    amount: data.amount,
    currency: data.currency,
    receiptNumber: data.receiptNumber,
    date: data.date,
    frequency: data.frequency,
    donationType: data.donationType,
    campaignName: data.campaignName,
    nextPaymentDate: data.nextPaymentDate,
  });
  const html = await render(email.component);
  return {
    subject: email.subject,
    html,
  };
}

/**
 * Payment failed email
 */
export async function paymentFailedEmail(data: PaymentFailedData): Promise<{
  subject: string;
  html: string;
}> {
  const email = getPaymentFailedEmail(data);
  const html = await render(email.component);
  return {
    subject: email.subject,
    html,
  };
}

/**
 * Subscription cancelled email
 */
export async function subscriptionCancelledEmail(data: SubscriptionCancelledData): Promise<{
  subject: string;
  html: string;
}> {
  const email = getSubscriptionCancelledEmail(data);
  const html = await render(email.component);
  return {
    subject: email.subject,
    html,
  };
}

/**
 * Refund confirmation email
 */
export async function refundConfirmationEmail(data: RefundData): Promise<{
  subject: string;
  html: string;
}> {
  const email = getRefundConfirmationEmail({
    donorName: data.donorName,
    amount: data.amount,
    currency: data.currency,
    receiptNumber: data.receiptNumber,
    refundReason: data.refundReason,
    originalDate: data.originalDate,
  });
  const html = await render(email.component);
  return {
    subject: email.subject,
    html,
  };
}

/**
 * Dispute alert email (for admins)
 */
export async function disputeAlertEmail(params: DisputeAlertEmailParams): Promise<string> {
  const email = getDisputeAlertEmail({
    disputeAmount: params.disputeAmount,
    disputeDueDate: params.disputeDueDate,
    disputeReason: params.disputeReason,
    donorEmail: params.donorEmail,
    donorName: params.donorName,
    receiptNumber: params.receiptNumber,
    disputeId: params.disputeId,
  });
  return await render(email.component);
}
