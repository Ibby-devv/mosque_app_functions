// ============================================================================
// MANAGEMENT LINK EMAIL
// Sent when a user requests a link to manage their subscription
// NOTE: Does NOT include Stripe portal URL - directs to app instead
// ============================================================================

import * as React from "react";
import { Text } from "@react-email/components";
import {
  EmailLayout,
  COLORS,
  EmailConfig,
  DEFAULT_EMAIL_CONFIG,
} from "../components/EmailLayout.js";
import {
  AlertBox,
  EmailButton,
  Greeting,
  Paragraph,
  SectionTitle,
} from "../components/SharedComponents.js";

// ============================================================================
// TEMPLATE DATA INTERFACE
// ============================================================================

export interface ManagementLinkData {
  donorName?: string;
  subscriptionCount: number;
}

// ============================================================================
// EMAIL COMPONENT
// ============================================================================

interface ManagementLinkEmailProps {
  data: ManagementLinkData;
  config?: Partial<EmailConfig>;
}

export function ManagementLinkEmail({
  data,
  config = {},
}: ManagementLinkEmailProps) {
  const emailConfig = { ...DEFAULT_EMAIL_CONFIG, ...config };
  const name = data.donorName || "Donor";

  return (
    <EmailLayout
      preview={`Manage your recurring donation${data.subscriptionCount > 1 ? "s" : ""}`}
      headerTitle="Manage Your Donations"
      headerColor={COLORS.primary}
      headerEmoji="💚"
      config={config}
    >
      <SectionTitle>Manage Your Recurring Donation{data.subscriptionCount > 1 ? "s" : ""}</SectionTitle>

      <Greeting name={name} />

      <Paragraph>
        You requested access to manage your recurring donation
        {data.subscriptionCount > 1 ? "s" : ""}. You can update your payment
        method, change donation amount, or cancel your subscription directly
        through the {emailConfig.mosqueShortName} app.
      </Paragraph>

      <EmailButton href={emailConfig.appDeepLink}>
        Open App to Manage Donations
      </EmailButton>

      <AlertBox type="info" title="How to Manage Your Donations:">
        1. Open the {emailConfig.mosqueShortName} app on your device
        <br />
        2. Go to the Donations section
        <br />
        3. Tap "Manage Recurring Donations"
        <br />
        4. Select the donation you want to update
      </AlertBox>

      <Paragraph style={{ fontSize: "14px" }}>
        If you did not request this email, you can safely ignore it. Your
        donation settings remain unchanged.
      </Paragraph>

      <Text
        style={{
          color: COLORS.textLight,
          fontSize: "16px",
          lineHeight: "1.6",
          margin: "25px 0 0 0",
        }}
      >
        JazakAllah Khair for your continued support!
      </Text>
    </EmailLayout>
  );
}

// ============================================================================
// HELPER FUNCTION
// ============================================================================

export function getManagementLinkEmail(
  data: ManagementLinkData,
  config?: Partial<EmailConfig>
): { subject: string; component: React.ReactElement } {
  return {
    subject: "Manage Your Recurring Donation",
    component: <ManagementLinkEmail data={data} config={config} />,
  };
}
