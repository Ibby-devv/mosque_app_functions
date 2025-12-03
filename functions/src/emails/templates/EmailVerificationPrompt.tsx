// ============================================================================
// EMAIL VERIFICATION PROMPT
// Sent to remind admins to verify their email address
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

export interface EmailVerificationPromptData {
  adminName: string;
  verifyLink: string;
}

// ============================================================================
// EMAIL COMPONENT
// ============================================================================

interface EmailVerificationPromptEmailProps {
  data: EmailVerificationPromptData;
  config?: Partial<EmailConfig>;
}

export function EmailVerificationPromptEmail({
  data,
  config = {},
}: EmailVerificationPromptEmailProps) {
  const emailConfig = { ...DEFAULT_EMAIL_CONFIG, ...config };

  return (
    <EmailLayout
      preview={`Please verify your email for ${emailConfig.mosqueName} admin access`}
      headerTitle="Verify Your Email"
      headerColor={COLORS.primary}
      headerEmoji="✉️"
      config={config}
    >
      <SectionTitle>Email Verification Required</SectionTitle>

      <Greeting name={data.adminName} />

      <Paragraph>
        To ensure secure access to <strong>{emailConfig.mosqueName}</strong> admin features,
        please verify your email address by clicking the button below.
      </Paragraph>

      <EmailButton href={data.verifyLink} backgroundColor={COLORS.primary}>
        Verify Email Address
      </EmailButton>

      <AlertBox type="info">
        This verification link will expire for security purposes. If the link has expired,
        you can request a new verification email from your admin dashboard or contact support.
      </AlertBox>

      <Paragraph style={{ fontSize: "14px", color: COLORS.textMuted }}>
        If you didn't request this verification, you can safely ignore this email.
      </Paragraph>

      <Signature mosqueName={emailConfig.mosqueName} />
    </EmailLayout>
  );
}

// ============================================================================
// HELPER FUNCTION - Returns subject and component for rendering
// ============================================================================

export function getEmailVerificationPromptEmail(
  data: EmailVerificationPromptData,
  config?: Partial<EmailConfig>
): { subject: string; component: React.ReactElement } {
  return {
    subject: "Verify Your Email Address",
    component: <EmailVerificationPromptEmail data={data} config={config} />,
  };
}
