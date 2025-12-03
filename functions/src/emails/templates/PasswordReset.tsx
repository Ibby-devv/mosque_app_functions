// ============================================================================
// PASSWORD RESET EMAIL
// Sent when an admin requests a password reset
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

// ============================================================================
// TEMPLATE DATA INTERFACE
// ============================================================================

export interface PasswordResetData {
  adminName: string;
  resetLink: string;
}

// ============================================================================
// EMAIL COMPONENT
// ============================================================================

interface PasswordResetEmailProps {
  data: PasswordResetData;
  config?: Partial<EmailConfig>;
}

export function PasswordResetEmail({
  data,
  config = {},
}: PasswordResetEmailProps) {
  const emailConfig = { ...DEFAULT_EMAIL_CONFIG, ...config };

  return (
    <EmailLayout
      preview={`Reset your password for ${emailConfig.mosqueName} admin access`}
      headerTitle="Password Reset"
      headerColor={COLORS.warning}
      headerEmoji="🔑"
      config={config}
    >
      <SectionTitle>Reset Your Password</SectionTitle>

      <Greeting name={data.adminName} />

      <Paragraph>
        A password reset has been requested for your <strong>{emailConfig.mosqueName}</strong>{" "}
        administrator account. Click the button below to create a new password.
      </Paragraph>

      <EmailButton href={data.resetLink} backgroundColor={COLORS.warning}>
        Reset Password
      </EmailButton>

      <AlertBox type="warning" title="Security Notice">
        This password reset link will expire for security purposes. If you didn't request
        this reset, please ignore this email and your password will remain unchanged.
      </AlertBox>

      <Paragraph style={{ fontSize: "14px", color: COLORS.textMuted }}>
        If you're having trouble accessing your account, please contact your system administrator.
      </Paragraph>

      <Signature mosqueName={emailConfig.mosqueName} />
    </EmailLayout>
  );
}

// ============================================================================
// HELPER FUNCTION - Returns subject and component for rendering
// ============================================================================

export function getPasswordResetEmail(
  data: PasswordResetData,
  config?: Partial<EmailConfig>
): { subject: string; component: React.ReactElement } {
  return {
    subject: "Reset Your Password",
    component: <PasswordResetEmail data={data} config={config} />,
  };
}
