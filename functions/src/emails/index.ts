// ============================================================================
// EMAIL MODULE INDEX - Re-exports all email components and utilities
// ============================================================================

// Configuration and Layout
export {
  COLORS,
  EmailLayout,
  DEFAULT_EMAIL_CONFIG,
  type EmailConfig,
} from "./components/EmailLayout.js";

// Shared Components
export {
  EmailButton,
  DetailRow,
  DetailsBox,
  AlertBox,
  Greeting,
  Paragraph,
  SectionTitle,
  Signature,
} from "./components/SharedComponents.js";

// Email Templates
export {
  OneTimeDonationReceiptEmail,
  getOneTimeDonationReceiptEmail,
  type OneTimeDonationReceiptData,
} from "./templates/OneTimeDonationReceipt.js";

export {
  RecurringWelcomeEmail,
  getRecurringWelcomeEmail,
  type RecurringWelcomeData,
} from "./templates/RecurringWelcome.js";

export {
  RecurringReceiptEmail,
  getRecurringReceiptEmail,
  type RecurringReceiptData,
} from "./templates/RecurringReceipt.js";

export {
  PaymentFailedEmail,
  getPaymentFailedEmail,
  type PaymentFailedData,
} from "./templates/PaymentFailed.js";

export {
  SubscriptionCancelledEmail,
  getSubscriptionCancelledEmail,
  type SubscriptionCancelledData,
} from "./templates/SubscriptionCancelled.js";

export {
  SubscriptionUpdatedEmail,
  getSubscriptionUpdatedEmail,
  type SubscriptionUpdatedData,
} from "./templates/SubscriptionUpdated.js";

export {
  RefundConfirmationEmail,
  getRefundConfirmationEmail,
  type RefundConfirmationData,
} from "./templates/RefundConfirmation.js";

export {
  DisputeAlertEmail,
  getDisputeAlertEmail,
  type DisputeAlertData,
} from "./templates/DisputeAlert.js";

export {
  ManagementLinkEmail,
  getManagementLinkEmail,
  type ManagementLinkData,
} from "./templates/ManagementLink.js";

// Email Service
export {
  sendEmail,
  sendRawEmail,
  isValidEmail,
  normalizeEmail,
  type SendEmailParams,
  type SendRawEmailParams,
  type EmailResult,
} from "./emailService.js";
