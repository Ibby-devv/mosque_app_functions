// ============================================================================
// ADMIN ONBOARDING INVITE EMAIL
// Sent when a new admin account is created - includes password reset and email verification
// ============================================================================

import * as React from "react";
import {
  EmailLayout,
  COLORS,
  EmailConfig,
  DEFAULT_EMAIL_CONFIG,
} from "../components/EmailLayout.js";
import {
  EmailButton,
  Greeting,
  Paragraph,
  SectionTitle,
  Signature,
  AlertBox,
} from "../components/SharedComponents.js";
import { Section, Text } from "@react-email/components";

// ============================================================================
// TEMPLATE DATA INTERFACE
// ============================================================================

export interface AdminOnboardingInviteData {
  adminName: string;
  resetLink: string;
  verifyLink: string;
  dashboardUrl: string;
  roles?: string[]; // Optional: list of assigned roles
}

// ============================================================================
// EMAIL COMPONENT
// ============================================================================

interface AdminOnboardingInviteEmailProps {
  data: AdminOnboardingInviteData;
  config?: Partial<EmailConfig>;
}

export function AdminOnboardingInviteEmail({
  data,
  config = {},
}: AdminOnboardingInviteEmailProps) {
  const emailConfig = { ...DEFAULT_EMAIL_CONFIG, ...config };

  return (
    <EmailLayout
      preview={`Welcome to ${emailConfig.mosqueName} Admin Dashboard - Complete your account setup`}
      headerTitle="Welcome to the Admin Dashboard"
      headerColor={COLORS.primary}
      headerEmoji="🔐"
      config={config}
    >
      <SectionTitle>Your Admin Account is Ready</SectionTitle>

      <Greeting name={data.adminName} />

      <Paragraph>
        Your administrator account for <strong>{emailConfig.mosqueName}</strong> has been created.
        For security, please complete these two important steps to activate your account:
      </Paragraph>

      {/* Step 1: Set Password */}
      <Section style={{ marginBottom: "20px" }}>
        <Text
          style={{
            color: COLORS.text,
            fontSize: "18px",
            fontWeight: "bold",
            margin: "20px 0 10px 0",
          }}
        >
          Step 1: Set Your Password
        </Text>
        <Paragraph>
          Click the button below to create a secure password for your account.
        </Paragraph>
        <EmailButton href={data.resetLink} backgroundColor={COLORS.primary}>
          Set Your Password
        </EmailButton>
      </Section>

      {/* Step 2: Verify Email */}
      <Section style={{ marginBottom: "20px" }}>
        <Text
          style={{
            color: COLORS.text,
            fontSize: "18px",
            fontWeight: "bold",
            margin: "20px 0 10px 0",
          }}
        >
          Step 2: Verify Your Email
        </Text>
        <Paragraph>
          Verify your email address to ensure secure access to all admin features.
        </Paragraph>
        <EmailButton href={data.verifyLink} backgroundColor={COLORS.success}>
          Verify Email Address
        </EmailButton>
      </Section>

      {/* Roles Info (if provided) */}
      {data.roles && data.roles.length > 0 && (
        <AlertBox type="info" title="Your Assigned Roles">
          You have been granted the following permissions: <strong>{data.roles.join(", ")}</strong>
        </AlertBox>
      )}

      {/* Important Notes */}
      <AlertBox type="warning" title="Important">
        These links will expire for security. If they expire, contact your administrator to resend
        the invite or use the password reset option on the login page.
      </AlertBox>

      <Paragraph>
        After completing both steps, you can access the admin dashboard at:{" "}
        <a href={data.dashboardUrl} style={{ color: COLORS.primary }}>
          {data.dashboardUrl}
        </a>
      </Paragraph>

      <Paragraph style={{ fontSize: "14px", color: COLORS.textMuted }}>
        If you didn't expect this invitation, please contact us immediately.
      </Paragraph>

      <Signature mosqueName={emailConfig.mosqueName} />
    </EmailLayout>
  );
}

// ============================================================================
// HELPER FUNCTION - Returns subject and component for rendering
// ============================================================================

export function getAdminOnboardingInviteEmail(
  data: AdminOnboardingInviteData,
  config?: Partial<EmailConfig>
): { subject: string; component: React.ReactElement } {
  return {
    subject: `Welcome to ${(config?.mosqueName || DEFAULT_EMAIL_CONFIG.mosqueName)} Admin Dashboard`,
    component: <AdminOnboardingInviteEmail data={data} config={config} />,
  };
}
