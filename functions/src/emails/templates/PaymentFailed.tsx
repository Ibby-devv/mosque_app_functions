// ============================================================================
// PAYMENT FAILED EMAIL
// Sent when a recurring payment fails
// ============================================================================

import * as React from "react";
import {
  EmailLayout,
  COLORS,
  EmailConfig,
  DEFAULT_EMAIL_CONFIG,
} from "../components/EmailLayout.js";
import {
  AlertBox,
  Greeting,
  Paragraph,
  SectionTitle,
} from "../components/SharedComponents.js";
import { Text } from "@react-email/components";

// ============================================================================
// TEMPLATE DATA INTERFACE
// ============================================================================

export interface PaymentFailedData {
  donorName: string;
  amount: number;
  currency: string;
  frequency: string;
  attemptCount: number;
  nextRetryDate?: string;
  /**
   * @deprecated Portal URLs should not be embedded in emails as they expire.
   * Instead, instruct users to update payment through the app.
   */
  updatePaymentUrl?: string;
}

// ============================================================================
// EMAIL COMPONENT
// ============================================================================

interface PaymentFailedEmailProps {
  data: PaymentFailedData;
  config?: Partial<EmailConfig>;
}

export function PaymentFailedEmail({
  data,
  config = {},
}: PaymentFailedEmailProps) {
  const emailConfig = { ...DEFAULT_EMAIL_CONFIG, ...config };
  const formattedAmount = `$${(data.amount / 100).toFixed(2)}`;
  const isUrgent = data.attemptCount >= 3;

  return (
    <EmailLayout
      preview={
        isUrgent
          ? `URGENT: Update payment method for your ${data.frequency} donation`
          : `Payment failed - Please update payment method`
      }
      headerTitle={isUrgent ? "URGENT: Final Attempt" : "Action Required"}
      headerColor={isUrgent ? COLORS.danger : COLORS.warning}
      headerEmoji={isUrgent ? "🚨" : "⚠️"}
      config={config}
    >
      <SectionTitle>Payment Failed - Please Update</SectionTitle>

      <Greeting name={data.donorName} />

      <Paragraph>
        We were unable to process your {data.frequency} donation of{" "}
        <strong>{formattedAmount}</strong>.
      </Paragraph>

      {isUrgent ? (
        <AlertBox type="danger" title={`⚠️ This is attempt #${data.attemptCount}`}>
          Your subscription will be cancelled if payment fails again. Please
          update your payment method immediately through the{" "}
          {emailConfig.mosqueShortName} app.
        </AlertBox>
      ) : (
        <Paragraph>
          This usually happens when a card expires or has insufficient funds.
          {data.nextRetryDate && ` We will automatically retry on ${data.nextRetryDate}.`}
        </Paragraph>
      )}

      <Paragraph>
        Please update your payment method through the {emailConfig.mosqueShortName}{" "}
        app to continue your recurring donation.
      </Paragraph>

      <Paragraph style={{ fontSize: "14px" }}>
        If you have any questions or need assistance, please contact us at{" "}
        {emailConfig.supportEmail}.
      </Paragraph>

      <Text
        style={{
          color: COLORS.textLight,
          fontSize: "16px",
          lineHeight: "1.6",
          margin: "15px 0 0 0",
        }}
      >
        JazakAllah Khair for your support!
      </Text>
    </EmailLayout>
  );
}

// ============================================================================
// HELPER FUNCTION
// ============================================================================

export function getPaymentFailedEmail(
  data: PaymentFailedData,
  config?: Partial<EmailConfig>
): { subject: string; component: React.ReactElement } {
  const isUrgent = data.attemptCount >= 3;
  return {
    subject: isUrgent
      ? `URGENT: Update payment method for ${data.frequency} donation`
      : `Payment failed - Please update payment method`,
    component: <PaymentFailedEmail data={data} config={config} />,
  };
}
