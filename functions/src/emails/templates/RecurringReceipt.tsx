// ============================================================================
// RECURRING DONATION RECEIPT EMAIL
// Sent after each successful recurring payment (not the first one)
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

export interface RecurringReceiptData {
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
   * @deprecated Portal URLs should not be embedded in emails as they expire.
   * Instead, instruct users to manage donations through the app.
   */
  manageUrl?: string;
}

// ============================================================================
// EMAIL COMPONENT
// ============================================================================

interface RecurringReceiptEmailProps {
  data: RecurringReceiptData;
  config?: Partial<EmailConfig>;
}

export function RecurringReceiptEmail({
  data,
  config = {},
}: RecurringReceiptEmailProps) {
  const emailConfig = { ...DEFAULT_EMAIL_CONFIG, ...config };
  const formattedAmount = `$${(data.amount / 100).toFixed(2)}`;
  const capitalizedFrequency =
    data.frequency.charAt(0).toUpperCase() + data.frequency.slice(1);

  return (
    <EmailLayout
      preview={`Receipt for your ${data.frequency} donation of ${formattedAmount}`}
      headerTitle="Payment Successful"
      headerColor={COLORS.success}
      headerEmoji="✅"
      config={config}
    >
      <SectionTitle>Your Recurring Donation Receipt</SectionTitle>

      <Greeting name={data.donorName} />

      <Paragraph>
        Your {data.frequency} donation of <strong>{formattedAmount}</strong> has
        been successfully processed. JazakAllah Khair for your continued
        support!
      </Paragraph>

      <DetailsBox>
        <DetailRow label="Amount" value={formattedAmount} />
        <DetailRow label="Receipt Number" value={data.receiptNumber} />
        <DetailRow label="Date" value={data.date} />
        <DetailRow label="Frequency" value={capitalizedFrequency} />
        <DetailRow label="Donation Type" value={data.donationType} />
        {data.campaignName && (
          <DetailRow label="Campaign" value={data.campaignName} />
        )}
        <DetailRow label="Next Payment" value={data.nextPaymentDate} />
      </DetailsBox>

      <Paragraph style={{ fontSize: "14px" }}>
        You can manage your donation settings anytime through the{" "}
        {emailConfig.mosqueShortName} app.
      </Paragraph>

      <Signature mosqueName={emailConfig.mosqueName} />
    </EmailLayout>
  );
}

// ============================================================================
// HELPER FUNCTION
// ============================================================================

export function getRecurringReceiptEmail(
  data: RecurringReceiptData,
  config?: Partial<EmailConfig>
): { subject: string; component: React.ReactElement } {
  return {
    subject: `Receipt for your ${data.frequency} donation - ${data.receiptNumber}`,
    component: <RecurringReceiptEmail data={data} config={config} />,
  };
}
