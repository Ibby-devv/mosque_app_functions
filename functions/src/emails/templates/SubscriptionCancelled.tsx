// ============================================================================
// SUBSCRIPTION CANCELLED EMAIL
// Sent when a recurring donation subscription is cancelled
// ============================================================================

import * as React from "react";
import { Section, Text } from "@react-email/components";
import {
  EmailLayout,
  COLORS,
  EmailConfig,
  DEFAULT_EMAIL_CONFIG,
} from "../components/EmailLayout.js";
import { Greeting, Paragraph, SectionTitle } from "../components/SharedComponents.js";

// ============================================================================
// TEMPLATE DATA INTERFACE
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

// ============================================================================
// EMAIL COMPONENT
// ============================================================================

interface SubscriptionCancelledEmailProps {
  data: SubscriptionCancelledData;
  config?: Partial<EmailConfig>;
}

export function SubscriptionCancelledEmail({
  data,
  config = {},
}: SubscriptionCancelledEmailProps) {
  const emailConfig = { ...DEFAULT_EMAIL_CONFIG, ...config };
  const formattedAmount = `$${(data.amount / 100).toFixed(2)}`;
  const totalDonated = data.totalDonated
    ? `$${(data.totalDonated / 100).toFixed(2)}`
    : null;

  return (
    <EmailLayout
      preview={`Your ${data.frequency} donation of ${formattedAmount} has been cancelled`}
      headerTitle="Subscription Cancelled"
      headerColor={COLORS.textMuted}
      headerEmoji="📋"
      config={config}
    >
      <SectionTitle>Your Recurring Donation Has Been Cancelled</SectionTitle>

      <Greeting name={data.donorName} />

      <Paragraph>
        Your {data.frequency} donation of <strong>{formattedAmount}</strong> has
        been cancelled as requested. No further payments will be processed.
      </Paragraph>

      {totalDonated && (
        <Section
          style={{
            backgroundColor: COLORS.footerBackground,
            borderRadius: "8px",
            padding: "25px",
            margin: "20px 0",
            textAlign: "center",
          }}
        >
          <Text
            style={{
              color: COLORS.textMuted,
              fontSize: "14px",
              margin: "0 0 10px 0",
            }}
          >
            Total Donated Since {data.startDate || "Start"}
          </Text>
          <Text
            style={{
              color: COLORS.success,
              fontSize: "32px",
              fontWeight: "bold",
              margin: "0",
            }}
          >
            {totalDonated}
          </Text>
          <Text
            style={{
              color: COLORS.textLight,
              fontSize: "14px",
              margin: "10px 0 0 0",
            }}
          >
            JazakAllah Khair for your generous support!
          </Text>
        </Section>
      )}

      <Paragraph>
        Thank you for your support of {emailConfig.mosqueName}. Your
        contributions have made a meaningful difference in our community.
      </Paragraph>

      <Paragraph>
        You are always welcome to donate again at any time through our app.
      </Paragraph>

      <Text
        style={{
          color: COLORS.textLight,
          fontSize: "16px",
          lineHeight: "1.6",
          margin: "25px 0 0 0",
        }}
      >
        <strong>May Allah (SWT) reward you for your generosity!</strong>
        <br />
        The {emailConfig.mosqueName} Team
      </Text>
    </EmailLayout>
  );
}

// ============================================================================
// HELPER FUNCTION
// ============================================================================

export function getSubscriptionCancelledEmail(
  data: SubscriptionCancelledData,
  config?: Partial<EmailConfig>
): { subject: string; component: React.ReactElement } {
  return {
    subject: "Your recurring donation has been cancelled",
    component: <SubscriptionCancelledEmail data={data} config={config} />,
  };
}
