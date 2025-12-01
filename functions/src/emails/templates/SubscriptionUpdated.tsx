// ============================================================================
// SUBSCRIPTION UPDATED EMAIL
// Sent when a recurring donation subscription is updated (amount/frequency)
// ============================================================================

import * as React from "react";
import { Section, Text } from "@react-email/components";
import {
  EmailLayout,
  COLORS,
  EmailConfig,
  DEFAULT_EMAIL_CONFIG,
} from "../components/EmailLayout.js";
import {
  DetailsBox,
  DetailRow,
  Greeting,
  Paragraph,
  SectionTitle,
  Signature,
} from "../components/SharedComponents.js";

// ============================================================================
// TEMPLATE DATA INTERFACE
// ============================================================================

export interface SubscriptionUpdatedData {
  donorName: string;
  changes: string[];
  nextPaymentDate: string;
  newAmount?: number;
  newFrequency?: string;
}

// ============================================================================
// EMAIL COMPONENT
// ============================================================================

interface SubscriptionUpdatedEmailProps {
  data: SubscriptionUpdatedData;
  config?: Partial<EmailConfig>;
}

export function SubscriptionUpdatedEmail({
  data,
  config = {},
}: SubscriptionUpdatedEmailProps) {
  const emailConfig = { ...DEFAULT_EMAIL_CONFIG, ...config };

  return (
    <EmailLayout
      preview="Your recurring donation has been updated"
      headerTitle="Subscription Updated"
      headerColor={COLORS.primary}
      headerEmoji="🔄"
      config={config}
    >
      <SectionTitle>Your Recurring Donation Has Been Updated</SectionTitle>

      <Greeting name={data.donorName} />

      <Paragraph>
        Your recurring donation has been successfully updated:
      </Paragraph>

      <Section
        style={{
          backgroundColor: COLORS.footerBackground,
          borderRadius: "8px",
          padding: "20px",
          margin: "20px 0",
        }}
      >
        {data.changes.map((change, index) => (
          <Text
            key={index}
            style={{
              color: COLORS.text,
              fontSize: "14px",
              margin: "8px 0",
              paddingLeft: "10px",
              borderLeft: `3px solid ${COLORS.primary}`,
            }}
          >
            {change}
          </Text>
        ))}
      </Section>

      <DetailsBox>
        <DetailRow label="Next Payment" value={data.nextPaymentDate} />
        {data.newAmount && (
          <DetailRow
            label="New Amount"
            value={`$${(data.newAmount / 100).toFixed(2)}`}
          />
        )}
        {data.newFrequency && (
          <DetailRow
            label="New Frequency"
            value={
              data.newFrequency.charAt(0).toUpperCase() +
              data.newFrequency.slice(1)
            }
          />
        )}
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

export function getSubscriptionUpdatedEmail(
  data: SubscriptionUpdatedData,
  config?: Partial<EmailConfig>
): { subject: string; component: React.ReactElement } {
  return {
    subject: "Your recurring donation has been updated",
    component: <SubscriptionUpdatedEmail data={data} config={config} />,
  };
}
