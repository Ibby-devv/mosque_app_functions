// ============================================================================
// EMAIL TEMPLATES FOR DONATION RECEIPTS & NOTIFICATIONS
// Location: mosque_app_functions/src/utils/emailTemplates.ts
// ============================================================================
// Centralized email templates using Resend
// All templates maintain consistent branding and structure

import { logger } from "firebase-functions";
import { Resend } from "resend";

// ============================================================================
// EMAIL STYLING CONSTANTS
// ============================================================================

const COLORS = {
  primary: "#1e3a8a", // Blue
  success: "#16a34a", // Green
  warning: "#f59e0b", // Orange
  danger: "#dc2626", // Red
  text: "#1f2937",
  textLight: "#4b5563",
  textMuted: "#6b7280",
  background: "#f5f5f5",
  cardBackground: "#ffffff",
  footerBackground: "#f9fafb",
};

// ============================================================================
// REUSABLE COMPONENTS
// ============================================================================

const emailHeader = (title: string, bgColor: string, emoji: string = "") => `
  <tr>
    <td style="background-color: ${bgColor}; padding: 30px; text-align: center;">
      <h1 style="color: #ffffff; margin: 0; font-size: 28px;">
        ${emoji} ${title}
      </h1>
    </td>
  </tr>
`;

const emailFooter = () => `
  <tr>
    <td style="background-color: ${COLORS.footerBackground}; padding: 20px; text-align: center;">
      <p style="color: ${COLORS.textMuted}; font-size: 12px; margin: 0 0 5px 0;">
        Al Ansar Masjid
      </p>
      <p style="color: ${COLORS.textMuted}; font-size: 12px; margin: 0;">
        Secure donations powered by Stripe
      </p>
    </td>
  </tr>
`;

const button = (text: string, url: string, bgColor: string = COLORS.primary) => `
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td align="center" style="padding: 20px 0;">
        <a href="${url}" 
           style="display: inline-block; 
                  background-color: ${bgColor}; 
                  color: #ffffff; 
                  text-decoration: none; 
                  padding: 16px 40px; 
                  border-radius: 8px; 
                  font-size: 18px; 
                  font-weight: bold;">
          ${text}
        </a>
      </td>
    </tr>
  </table>
`;

const detailRow = (label: string, value: string) => `
  <tr>
    <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="color: ${COLORS.textMuted}; font-size: 14px; width: 40%;">
            ${label}
          </td>
          <td style="color: ${COLORS.text}; font-size: 16px; font-weight: bold; text-align: right;">
            ${value}
          </td>
        </tr>
      </table>
    </td>
  </tr>
`;

const emailWrapper = (content: string) => `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
  </head>
  <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: ${COLORS.background};">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: ${COLORS.background}; padding: 20px;">
      <tr>
        <td align="center">
          <table width="600" cellpadding="0" cellspacing="0" style="background-color: ${COLORS.cardBackground}; border-radius: 8px; overflow: hidden;">
            ${content}
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`;

// ============================================================================
// EMAIL TEMPLATE: ONE-TIME DONATION RECEIPT
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

export function oneTimeDonationReceipt(data: OneTimeDonationData): {
  subject: string;
  html: string;
} {
  const formattedAmount = `$${(data.amount / 100).toFixed(2)}`;
  const paymentMethod = data.cardLast4
    ? `${data.cardBrand || "Card"} ending in ${data.cardLast4}`
    : "Card";

  const content = `
    ${emailHeader("JazakAllah Khair!", COLORS.success, "✅")}
    
    <tr>
      <td style="padding: 40px 30px;">
        <h2 style="color: ${COLORS.text}; margin: 0 0 20px 0;">
          Your Donation Receipt
        </h2>
        
        <p style="color: ${COLORS.textLight}; font-size: 16px; line-height: 1.6; margin: 0 0 15px 0;">
          Assalamu Alaikum ${data.donorName},
        </p>
        
        <p style="color: ${COLORS.textLight}; font-size: 16px; line-height: 1.6; margin: 0 0 30px 0;">
          Thank you for your generous donation of <strong>${formattedAmount}</strong>. 
          May Allah (SWT) accept your donation and bless you abundantly.
        </p>
        
        <!-- Donation Details -->
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: ${COLORS.footerBackground}; border-radius: 8px; padding: 20px; margin: 20px 0;">
          ${detailRow("Amount", formattedAmount)}
          ${detailRow("Receipt Number", data.receiptNumber)}
          ${detailRow("Date", data.date)}
          ${detailRow("Donation Type", data.donationType)}
          ${data.campaignName ? detailRow("Campaign", data.campaignName) : ""}
          ${detailRow("Payment Method", paymentMethod)}
        </table>
        
        <p style="color: ${COLORS.textLight}; font-size: 14px; line-height: 1.6; margin: 25px 0 0 0;">
          Please keep this receipt for your records. If you have any questions, 
          feel free to contact us.
        </p>
        
        <p style="color: ${COLORS.textLight}; font-size: 16px; line-height: 1.6; margin: 15px 0 0 0;">
          <strong>JazakAllah Khair!</strong><br>
          The Al Ansar Masjid Team
        </p>
      </td>
    </tr>
    
    ${emailFooter()}
  `;

  return {
    subject: `Donation Receipt - ${data.receiptNumber}`,
    html: emailWrapper(content),
  };
}

// ============================================================================
// EMAIL TEMPLATE: RECURRING DONATION WELCOME
// ============================================================================

export interface RecurringWelcomeData {
  donorName: string;
  amount: number;
  currency: string;
  frequency: string;
  donationType: string;
  campaignName?: string;
  nextPaymentDate: string;
  manageUrl: string;
}

export function recurringDonationWelcome(data: RecurringWelcomeData): {
  subject: string;
  html: string;
} {
  const formattedAmount = `$${(data.amount / 100).toFixed(2)}`;

  const content = `
    ${emailHeader("Recurring Donation Activated", COLORS.primary, "🔄")}
    
    <tr>
      <td style="padding: 40px 30px;">
        <h2 style="color: ${COLORS.text}; margin: 0 0 20px 0;">
          Thank You for Your Ongoing Support!
        </h2>
        
        <p style="color: ${COLORS.textLight}; font-size: 16px; line-height: 1.6; margin: 0 0 15px 0;">
          Assalamu Alaikum ${data.donorName},
        </p>
        
        <p style="color: ${COLORS.textLight}; font-size: 16px; line-height: 1.6; margin: 0 0 30px 0;">
          Your ${data.frequency} recurring donation of <strong>${formattedAmount}</strong> 
          has been successfully set up. May Allah (SWT) reward you for your continuous support.
        </p>
        
        <!-- Subscription Details -->
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: ${COLORS.footerBackground}; border-radius: 8px; padding: 20px; margin: 20px 0;">
          ${detailRow("Amount", formattedAmount)}
          ${detailRow("Frequency", data.frequency.charAt(0).toUpperCase() + data.frequency.slice(1))}
          ${detailRow("Donation Type", data.donationType)}
          ${data.campaignName ? detailRow("Campaign", data.campaignName) : ""}
          ${detailRow("Next Payment", data.nextPaymentDate)}
        </table>
        
        <p style="color: ${COLORS.textLight}; font-size: 16px; line-height: 1.6; margin: 25px 0;">
          You will receive a receipt via email after each successful payment. 
          You can manage your donation (update amount, change frequency, or cancel) 
          at any time using the link below.
        </p>
        
        ${button("Manage Your Donation", data.manageUrl)}
        
        <p style="color: ${COLORS.textLight}; font-size: 16px; line-height: 1.6; margin: 25px 0 0 0;">
          <strong>JazakAllah Khair for your ongoing support!</strong><br>
          The Al Ansar Masjid Team
        </p>
      </td>
    </tr>
    
    ${emailFooter()}
  `;

  return {
    subject: `Your ${data.frequency} donation is now active`,
    html: emailWrapper(content),
  };
}

// ============================================================================
// EMAIL TEMPLATE: MONTHLY RECURRING RECEIPT
// ============================================================================

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
  manageUrl: string;
}

export function monthlyRecurringReceipt(data: MonthlyReceiptData): {
  subject: string;
  html: string;
} {
  const formattedAmount = `$${(data.amount / 100).toFixed(2)}`;

  const content = `
    ${emailHeader("Payment Successful", COLORS.success, "✅")}
    
    <tr>
      <td style="padding: 40px 30px;">
        <h2 style="color: ${COLORS.text}; margin: 0 0 20px 0;">
          Your Recurring Donation Receipt
        </h2>
        
        <p style="color: ${COLORS.textLight}; font-size: 16px; line-height: 1.6; margin: 0 0 15px 0;">
          Assalamu Alaikum ${data.donorName},
        </p>
        
        <p style="color: ${COLORS.textLight}; font-size: 16px; line-height: 1.6; margin: 0 0 30px 0;">
          Your ${data.frequency} donation of <strong>${formattedAmount}</strong> 
          has been successfully processed. JazakAllah Khair for your continued support!
        </p>
        
        <!-- Payment Details -->
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: ${COLORS.footerBackground}; border-radius: 8px; padding: 20px; margin: 20px 0;">
          ${detailRow("Amount", formattedAmount)}
          ${detailRow("Receipt Number", data.receiptNumber)}
          ${detailRow("Date", data.date)}
          ${detailRow("Frequency", data.frequency.charAt(0).toUpperCase() + data.frequency.slice(1))}
          ${detailRow("Donation Type", data.donationType)}
          ${data.campaignName ? detailRow("Campaign", data.campaignName) : ""}
          ${detailRow("Next Payment", data.nextPaymentDate)}
        </table>
        
        <p style="color: ${COLORS.textLight}; font-size: 14px; line-height: 1.6; margin: 25px 0;">
          You can manage your donation settings anytime using the link below.
        </p>
        
        ${button("Manage Donation", data.manageUrl)}
        
        <p style="color: ${COLORS.textLight}; font-size: 16px; line-height: 1.6; margin: 25px 0 0 0;">
          <strong>JazakAllah Khair!</strong><br>
          The Al Ansar Masjid Team
        </p>
      </td>
    </tr>
    
    ${emailFooter()}
  `;

  return {
    subject: `Receipt for your ${data.frequency} donation - ${data.receiptNumber}`,
    html: emailWrapper(content),
  };
}

// ============================================================================
// EMAIL TEMPLATE: PAYMENT FAILED
// ============================================================================

export interface PaymentFailedData {
  donorName: string;
  amount: number;
  currency: string;
  frequency: string;
  attemptCount: number;
  nextRetryDate?: string;
  updatePaymentUrl: string;
}

export function paymentFailedEmail(data: PaymentFailedData): {
  subject: string;
  html: string;
} {
  const formattedAmount = `$${(data.amount / 100).toFixed(2)}`;
  const isUrgent = data.attemptCount >= 3;
  const urgencyColor = isUrgent ? COLORS.danger : COLORS.warning;
  const urgencyEmoji = isUrgent ? "🚨" : "⚠️";
  const urgencyText = isUrgent
    ? "URGENT: Final Attempt"
    : "Action Required";

  const content = `
    ${emailHeader(urgencyText, urgencyColor, urgencyEmoji)}
    
    <tr>
      <td style="padding: 40px 30px;">
        <h2 style="color: ${COLORS.text}; margin: 0 0 20px 0;">
          Payment Failed - Please Update
        </h2>
        
        <p style="color: ${COLORS.textLight}; font-size: 16px; line-height: 1.6; margin: 0 0 15px 0;">
          Assalamu Alaikum ${data.donorName},
        </p>
        
        <p style="color: ${COLORS.textLight}; font-size: 16px; line-height: 1.6; margin: 0 0 25px 0;">
          We were unable to process your ${data.frequency} donation of 
          <strong>${formattedAmount}</strong>.
        </p>
        
        ${
          isUrgent
            ? `
        <div style="background-color: #fee2e2; border-left: 4px solid ${COLORS.danger}; padding: 15px; margin: 20px 0; border-radius: 4px;">
          <p style="color: ${COLORS.danger}; font-size: 16px; font-weight: bold; margin: 0 0 10px 0;">
            ⚠️ This is the ${data.attemptCount}rd attempt
          </p>
          <p style="color: ${COLORS.text}; font-size: 14px; margin: 0;">
            Your subscription will be cancelled if payment fails again. 
            Please update your payment method immediately.
          </p>
        </div>
        `
            : `
        <p style="color: ${COLORS.textLight}; font-size: 16px; line-height: 1.6; margin: 0 0 25px 0;">
          This usually happens when a card expires or has insufficient funds. 
          ${
            data.nextRetryDate
              ? `We will automatically retry on ${data.nextRetryDate}.`
              : ""
          }
        </p>
        `
        }
        
        <p style="color: ${COLORS.textLight}; font-size: 16px; line-height: 1.6; margin: 25px 0;">
          Please update your payment method to continue your recurring donation.
        </p>
        
        ${button("Update Payment Method", data.updatePaymentUrl, urgencyColor)}
        
        <p style="color: ${COLORS.textLight}; font-size: 14px; line-height: 1.6; margin: 25px 0 0 0;">
          If you have any questions or need assistance, please contact us.
        </p>
        
        <p style="color: ${COLORS.textLight}; font-size: 16px; line-height: 1.6; margin: 15px 0 0 0;">
          JazakAllah Khair for your support!
        </p>
      </td>
    </tr>
    
    ${emailFooter()}
  `;

  return {
    subject: isUrgent
      ? `URGENT: Update payment method for ${data.frequency} donation`
      : `Payment failed - Please update payment method`,
    html: emailWrapper(content),
  };
}

// ============================================================================
// EMAIL TEMPLATE: SUBSCRIPTION CANCELLED
// ============================================================================

export interface SubscriptionCancelledData {
  donorName: string;
  amount: number;
  currency: string;
  frequency: string;
  donationType: string;
  totalDonated?: number;
  startDate?: string;
}

export function subscriptionCancelledEmail(data: SubscriptionCancelledData): {
  subject: string;
  html: string;
} {
  const formattedAmount = `$${(data.amount / 100).toFixed(2)}`;
  const totalDonated = data.totalDonated
    ? `$${(data.totalDonated / 100).toFixed(2)}`
    : null;

  const content = `
    ${emailHeader("Subscription Cancelled", COLORS.textMuted, "📋")}
    
    <tr>
      <td style="padding: 40px 30px;">
        <h2 style="color: ${COLORS.text}; margin: 0 0 20px 0;">
          Your Recurring Donation Has Been Cancelled
        </h2>
        
        <p style="color: ${COLORS.textLight}; font-size: 16px; line-height: 1.6; margin: 0 0 15px 0;">
          Assalamu Alaikum ${data.donorName},
        </p>
        
        <p style="color: ${COLORS.textLight}; font-size: 16px; line-height: 1.6; margin: 0 0 30px 0;">
          Your ${data.frequency} donation of <strong>${formattedAmount}</strong> 
          has been cancelled as requested. No further payments will be processed.
        </p>
        
        ${
          totalDonated
            ? `
        <div style="background-color: ${COLORS.footerBackground}; border-radius: 8px; padding: 25px; margin: 20px 0; text-align: center;">
          <p style="color: ${COLORS.textMuted}; font-size: 14px; margin: 0 0 10px 0;">
            Total Donated Since ${data.startDate || "Start"}
          </p>
          <p style="color: ${COLORS.success}; font-size: 32px; font-weight: bold; margin: 0;">
            ${totalDonated}
          </p>
          <p style="color: ${COLORS.textLight}; font-size: 14px; margin: 10px 0 0 0;">
            JazakAllah Khair for your generous support!
          </p>
        </div>
        `
            : ""
        }
        
        <p style="color: ${COLORS.textLight}; font-size: 16px; line-height: 1.6; margin: 25px 0;">
          Thank you for your support of Al Ansar Masjid. Your contributions have 
          made a meaningful difference in our community.
        </p>
        
        <p style="color: ${COLORS.textLight}; font-size: 16px; line-height: 1.6; margin: 25px 0;">
          You're always welcome to donate again at any time through our app.
        </p>
        
        <p style="color: ${COLORS.textLight}; font-size: 16px; line-height: 1.6; margin: 25px 0 0 0;">
          <strong>May Allah (SWT) reward you for your generosity!</strong><br>
          The Al Ansar Masjid Team
        </p>
      </td>
    </tr>
    
    ${emailFooter()}
  `;

  return {
    subject: "Your recurring donation has been cancelled",
    html: emailWrapper(content),
  };
}

// ============================================================================
// EMAIL TEMPLATE: REFUND CONFIRMATION
// ============================================================================

export interface RefundData {
  donorName: string;
  amount: number;
  currency: string;
  receiptNumber: string;
  refundReason?: string;
  originalDate: string;
}

export function refundConfirmationEmail(data: RefundData): {
  subject: string;
  html: string;
} {
  const formattedAmount = `$${(data.amount / 100).toFixed(2)}`;

  const content = `
    ${emailHeader("Refund Processed", COLORS.primary, "💰")}
    
    <tr>
      <td style="padding: 40px 30px;">
        <h2 style="color: ${COLORS.text}; margin: 0 0 20px 0;">
          Your Refund Has Been Processed
        </h2>
        
        <p style="color: ${COLORS.textLight}; font-size: 16px; line-height: 1.6; margin: 0 0 15px 0;">
          Assalamu Alaikum ${data.donorName},
        </p>
        
        <p style="color: ${COLORS.textLight}; font-size: 16px; line-height: 1.6; margin: 0 0 30px 0;">
          A refund of <strong>${formattedAmount}</strong> has been processed 
          for your donation (Receipt: ${data.receiptNumber}).
        </p>
        
        <!-- Refund Details -->
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: ${COLORS.footerBackground}; border-radius: 8px; padding: 20px; margin: 20px 0;">
          ${detailRow("Refund Amount", formattedAmount)}
          ${detailRow("Original Receipt", data.receiptNumber)}
          ${detailRow("Original Date", data.originalDate)}
          ${data.refundReason ? detailRow("Reason", data.refundReason) : ""}
        </table>
        
        <p style="color: ${COLORS.textLight}; font-size: 14px; line-height: 1.6; margin: 25px 0;">
          The refund will appear on your original payment method within 5-10 business days, 
          depending on your bank or card issuer.
        </p>
        
        <p style="color: ${COLORS.textLight}; font-size: 14px; line-height: 1.6; margin: 25px 0 0 0;">
          If you have any questions about this refund, please contact us.
        </p>
      </td>
    </tr>
    
    ${emailFooter()}
  `;

  return {
    subject: `Refund processed - ${data.receiptNumber}`,
    html: emailWrapper(content),
  };
}

// ============================================================================
// TEMPLATE: DISPUTE ADMIN ALERT EMAIL
// ============================================================================

export interface DisputeAlertEmailParams {
  disputeAmount: string;
  disputeDueDate: string;
  disputeReason: string;
  donorEmail: string;
  donorName: string;
  receiptNumber: string;
  disputeId: string;
}

export function disputeAlertEmail(params: DisputeAlertEmailParams): string {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: ${COLORS.background};">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: ${COLORS.background}; padding: 20px;">
          <tr>
            <td align="center">
              <table width="600" cellpadding="0" cellspacing="0" style="background-color: ${COLORS.cardBackground}; border-radius: 8px; overflow: hidden; border: 3px solid ${COLORS.danger};">
                ${emailHeader("URGENT: Dispute Created", COLORS.danger, "🚨")}
                
                <tr>
                  <td style="padding: 40px 30px; background-color: #fef2f2;">
                    <h2 style="color: #991b1b; margin: 0 0 20px 0;">Immediate Action Required</h2>
                    <p style="color: #991b1b; font-size: 18px; font-weight: bold; margin: 0 0 15px 0;">
                      A chargeback dispute has been filed for a donation.
                    </p>
                    <p style="color: ${COLORS.textLight}; font-size: 14px; margin: 0 0 25px 0;">
                      You must respond before <strong>${params.disputeDueDate}</strong> or the dispute will automatically be lost.
                    </p>
                  </td>
                </tr>
                
                <tr>
                  <td style="padding: 0 30px 30px 30px;">
                    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: ${COLORS.footerBackground}; border-radius: 8px; padding: 20px;">
                      <tr>
                        <td>
                          <h3 style="color: ${COLORS.text}; margin: 0 0 15px 0;">Dispute Details</h3>
                          <table width="100%" cellpadding="8" cellspacing="0">
                            <tr>
                              <td style="color: ${COLORS.textMuted}; font-size: 14px; border-bottom: 1px solid #e5e7eb;"><strong>Amount:</strong></td>
                              <td style="color: ${COLORS.text}; font-size: 14px; border-bottom: 1px solid #e5e7eb;">$${params.disputeAmount} AUD</td>
                            </tr>
                            <tr>
                              <td style="color: ${COLORS.textMuted}; font-size: 14px; border-bottom: 1px solid #e5e7eb;"><strong>Reason:</strong></td>
                              <td style="color: ${COLORS.text}; font-size: 14px; border-bottom: 1px solid #e5e7eb;">${params.disputeReason}</td>
                            </tr>
                            <tr>
                              <td style="color: ${COLORS.textMuted}; font-size: 14px; border-bottom: 1px solid #e5e7eb;"><strong>Donor Email:</strong></td>
                              <td style="color: ${COLORS.text}; font-size: 14px; border-bottom: 1px solid #e5e7eb;">${params.donorEmail}</td>
                            </tr>
                            <tr>
                              <td style="color: ${COLORS.textMuted}; font-size: 14px; border-bottom: 1px solid #e5e7eb;"><strong>Donor Name:</strong></td>
                              <td style="color: ${COLORS.text}; font-size: 14px; border-bottom: 1px solid #e5e7eb;">${params.donorName}</td>
                            </tr>
                            <tr>
                              <td style="color: ${COLORS.textMuted}; font-size: 14px; border-bottom: 1px solid #e5e7eb;"><strong>Receipt #:</strong></td>
                              <td style="color: ${COLORS.text}; font-size: 14px; border-bottom: 1px solid #e5e7eb;">${params.receiptNumber}</td>
                            </tr>
                            <tr>
                              <td style="color: ${COLORS.textMuted}; font-size: 14px; border-bottom: 1px solid #e5e7eb;"><strong>Dispute ID:</strong></td>
                              <td style="color: ${COLORS.text}; font-size: 14px; border-bottom: 1px solid #e5e7eb;">${params.disputeId}</td>
                            </tr>
                            <tr>
                              <td style="color: ${COLORS.textMuted}; font-size: 14px;"><strong>Response Due:</strong></td>
                              <td style="color: ${COLORS.danger}; font-size: 14px; font-weight: bold;">${params.disputeDueDate}</td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                    
                    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top: 25px;">
                      <tr>
                        <td align="center">
                          <a href="https://dashboard.stripe.com/disputes/${params.disputeId}" 
                             style="display: inline-block; 
                                    background-color: ${COLORS.danger}; 
                                    color: #ffffff; 
                                    text-decoration: none; 
                                    padding: 16px 40px; 
                                    border-radius: 8px; 
                                    font-size: 18px; 
                                    font-weight: bold;">
                            Respond to Dispute in Stripe
                          </a>
                        </td>
                      </tr>
                    </table>
                    
                    <div style="background-color: #fef3c7; border-left: 4px solid ${COLORS.warning}; padding: 15px; margin: 25px 0; border-radius: 4px;">
                      <p style="color: #92400e; font-size: 14px; margin: 0; font-weight: bold;">⚠️ Important Notes:</p>
                      <ul style="color: #92400e; font-size: 14px; margin: 10px 0 0 0; padding-left: 20px;">
                        <li>Gather all evidence: receipts, communication logs, delivery proof</li>
                        <li>Respond promptly - late responses are automatically lost</li>
                        <li>Stripe charges a $25 AUD dispute fee regardless of outcome</li>
                        <li>Check if this is part of a recurring subscription</li>
                      </ul>
                    </div>
                  </td>
                </tr>
                
                <tr>
                  <td style="background-color: ${COLORS.footerBackground}; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb;">
                    <p style="color: ${COLORS.textMuted}; font-size: 12px; margin: 0;">Al Ansar Masjid - Stripe Dispute Alert</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
}

// ============================================================================
// EMAIL SENDING HELPER
// ============================================================================

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  from?: string;
}

export async function sendEmail(params: SendEmailParams): Promise<boolean> {
  try {
    // Short-circuit during local emulator runs to avoid network latency/timeouts
    if (process.env.FUNCTIONS_EMULATOR === "true" || process.env.FIREBASE_EMULATOR_HUB) {
      logger.info("(EMULATOR) Skipping real email send, simulating success", {
        to: params.to,
        subject: params.subject,
      });
      return true; // Simulate success so downstream logic proceeds
    }

    const resend = new Resend(process.env.RESEND_API_KEY);

    const result = await resend.emails.send({
      from: params.from || "Al Ansar <donations@alansar.app>",
      to: params.to,
      subject: params.subject,
      html: params.html,
    });

    logger.info("✅ Email sent successfully", {
      to: params.to,
      subject: params.subject,
      emailId: result.data?.id,
    });

    return true;
  } catch (error: any) {
    logger.error("❌ Email sending failed", {
      to: params.to,
      subject: params.subject,
      error: error.message,
    });
    return false;
  }
}
