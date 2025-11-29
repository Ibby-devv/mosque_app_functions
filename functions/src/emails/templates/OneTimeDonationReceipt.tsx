// ============================================================================
// ONE-TIME DONATION RECEIPT EMAIL
// Sent after successful one-time donation payment
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
  Signature,
} from "../components/SharedComponents.js";

// ============================================================================
// TEMPLATE DATA INTERFACE
// ============================================================================

export interface OneTimeDonationReceiptData {
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

// ============================================================================
// EMAIL COMPONENT
// ============================================================================

interface OneTimeDonationReceiptEmailProps {
  data: OneTimeDonationReceiptData;
  config?: Partial<EmailConfig>;
}

export function OneTimeDonationReceiptEmail({
  data,
  config = {},
}: OneTimeDonationReceiptEmailProps) {
  const emailConfig = { ...DEFAULT_EMAIL_CONFIG, ...config };
  const formattedAmount = `$${(data.amount / 100).toFixed(2)}`;
  const paymentMethod = data.cardLast4
    ? `${data.cardBrand || "Card"} ending in ${data.cardLast4}`
    : "Card";

  return (
    <EmailLayout
      preview={`Thank you for your ${formattedAmount} donation to ${emailConfig.mosqueName}`}
      headerTitle="JazakAllah Khair!"
      headerColor={COLORS.success}
      headerEmoji="✅"
      config={config}
    >
      <SectionTitle>Your Donation Receipt</SectionTitle>

      <Greeting name={data.donorName} />

      <Paragraph>
        Thank you for your generous donation of <strong>{formattedAmount}</strong>.
        May Allah (SWT) accept your donation and bless you abundantly.
      </Paragraph>

      <DetailsBox>
        <DetailRow label="Amount" value={formattedAmount} />
        <DetailRow label="Receipt Number" value={data.receiptNumber} />
        <DetailRow label="Date" value={data.date} />
        <DetailRow label="Donation Type" value={data.donationType} />
        {data.campaignName && (
          <DetailRow label="Campaign" value={data.campaignName} />
        )}
        <DetailRow label="Payment Method" value={paymentMethod} />
      </DetailsBox>

      <Paragraph style={{ fontSize: "14px" }}>
        Please keep this receipt for your records. If you have any questions,
        feel free to contact us.
      </Paragraph>

      <Signature mosqueName={emailConfig.mosqueName} />
    </EmailLayout>
  );
}

// ============================================================================
// HELPER FUNCTION - Returns subject and component for rendering
// ============================================================================

export function getOneTimeDonationReceiptEmail(
  data: OneTimeDonationReceiptData,
  config?: Partial<EmailConfig>
): { subject: string; component: React.ReactElement } {
  return {
    subject: `Donation Receipt - ${data.receiptNumber}`,
    component: <OneTimeDonationReceiptEmail data={data} config={config} />,
  };
}
