// ============================================================================
// REFUND CONFIRMATION EMAIL
// Sent when a donation is refunded
// ============================================================================

import * as React from "react";
import {
  EmailLayout,
  COLORS,
  EmailConfig,
  DEFAULT_EMAIL_CONFIG,
} from "../components/EmailLayout.js";
import {
  DetailRow,
  DetailsBox,
  Greeting,
  Paragraph,
  SectionTitle,
} from "../components/SharedComponents.js";

// ============================================================================
// TEMPLATE DATA INTERFACE
// ============================================================================

export interface RefundConfirmationData {
  donorName: string;
  amount: number;
  currency: string;
  receiptNumber: string;
  refundReason?: string;
  originalDate: string;
}

// ============================================================================
// EMAIL COMPONENT
// ============================================================================

interface RefundConfirmationEmailProps {
  data: RefundConfirmationData;
  config?: Partial<EmailConfig>;
}

export function RefundConfirmationEmail({
  data,
  config = {},
}: RefundConfirmationEmailProps) {
  const emailConfig = { ...DEFAULT_EMAIL_CONFIG, ...config };
  const formattedAmount = `$${(data.amount / 100).toFixed(2)}`;

  return (
    <EmailLayout
      preview={`Refund of ${formattedAmount} processed for receipt ${data.receiptNumber}`}
      headerTitle="Refund Processed"
      headerColor={COLORS.primary}
      headerEmoji="💰"
      config={config}
    >
      <SectionTitle>Your Refund Has Been Processed</SectionTitle>

      <Greeting name={data.donorName} />

      <Paragraph>
        A refund of <strong>{formattedAmount}</strong> has been processed for
        your donation (Receipt: {data.receiptNumber}).
      </Paragraph>

      <DetailsBox>
        <DetailRow label="Refund Amount" value={formattedAmount} />
        <DetailRow label="Original Receipt" value={data.receiptNumber} />
        <DetailRow label="Original Date" value={data.originalDate} />
        {data.refundReason && (
          <DetailRow label="Reason" value={data.refundReason} />
        )}
      </DetailsBox>

      <Paragraph style={{ fontSize: "14px" }}>
        The refund will appear on your original payment method within 5-10
        business days, depending on your bank or card issuer.
      </Paragraph>

      <Paragraph style={{ fontSize: "14px" }}>
        If you have any questions about this refund, please contact us at{" "}
        {emailConfig.supportEmail}.
      </Paragraph>
    </EmailLayout>
  );
}

// ============================================================================
// HELPER FUNCTION
// ============================================================================

export function getRefundConfirmationEmail(
  data: RefundConfirmationData,
  config?: Partial<EmailConfig>
): { subject: string; component: React.ReactElement } {
  return {
    subject: `Refund processed - ${data.receiptNumber}`,
    component: <RefundConfirmationEmail data={data} config={config} />,
  };
}
