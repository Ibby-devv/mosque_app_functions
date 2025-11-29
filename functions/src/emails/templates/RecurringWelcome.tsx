// ============================================================================
// RECURRING DONATION WELCOME EMAIL
// Sent when a new subscription is created
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

export interface RecurringWelcomeData {
  donorName: string;
  amount: number;
  currency: string;
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

interface RecurringWelcomeEmailProps {
  data: RecurringWelcomeData;
  config?: Partial<EmailConfig>;
}

export function RecurringWelcomeEmail({
  data,
  config = {},
}: RecurringWelcomeEmailProps) {
  const emailConfig = { ...DEFAULT_EMAIL_CONFIG, ...config };
  const formattedAmount = `$${(data.amount / 100).toFixed(2)}`;
  const capitalizedFrequency =
    data.frequency.charAt(0).toUpperCase() + data.frequency.slice(1);

  return (
    <EmailLayout
      preview={`Your ${data.frequency} donation of ${formattedAmount} is now active`}
      headerTitle="Recurring Donation Activated"
      headerColor={COLORS.primary}
      headerEmoji="🔄"
      config={config}
    >
      <SectionTitle>Thank You for Your Ongoing Support!</SectionTitle>

      <Greeting name={data.donorName} />

      <Paragraph>
        Your {data.frequency} recurring donation of{" "}
        <strong>{formattedAmount}</strong> has been successfully set up. May
        Allah (SWT) reward you for your continuous support.
      </Paragraph>

      <DetailsBox>
        <DetailRow label="Amount" value={formattedAmount} />
        <DetailRow label="Frequency" value={capitalizedFrequency} />
        <DetailRow label="Donation Type" value={data.donationType} />
        {data.campaignName && (
          <DetailRow label="Campaign" value={data.campaignName} />
        )}
        <DetailRow label="Next Payment" value={data.nextPaymentDate} />
      </DetailsBox>

      <Paragraph>
        You will receive a receipt via email after each successful payment. You
        can manage your donation (update amount, change frequency, or cancel) at
        any time through the {emailConfig.mosqueShortName} app.
      </Paragraph>

      <Signature mosqueName={emailConfig.mosqueName} />
    </EmailLayout>
  );
}

// ============================================================================
// HELPER FUNCTION
// ============================================================================

export function getRecurringWelcomeEmail(
  data: RecurringWelcomeData,
  config?: Partial<EmailConfig>
): { subject: string; component: React.ReactElement } {
  return {
    subject: `Your ${data.frequency} donation is now active`,
    component: <RecurringWelcomeEmail data={data} config={config} />,
  };
}
