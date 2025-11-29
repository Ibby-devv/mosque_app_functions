// ============================================================================
// EMAIL LAYOUT COMPONENT - Base wrapper for all emails
// Uses React Email components for production-ready HTML emails
// ============================================================================

import {
  Html,
  Head,
  Preview,
  Body,
  Container,
  Section,
  Text,
} from "@react-email/components";
import * as React from "react";

// ============================================================================
// EMAIL STYLING CONSTANTS
// ============================================================================

export const COLORS = {
  primary: "#1e3a8a", // Blue
  success: "#16a34a", // Green
  warning: "#f59e0b", // Orange
  danger: "#dc2626", // Red
  text: "#1f2937",
  textLight: "#4b5563",
  textMuted: "#6b7280",
  background: "#f5f5f5",
  cardBackground: "#ffffff",
  footerBackground: "#f9fafb",
};

// ============================================================================
// EMAIL CONFIGURATION - Customizable for different mosques
// ============================================================================

export interface EmailConfig {
  mosqueName: string;
  mosqueShortName: string;
  fromEmail: string;
  supportEmail: string;
  appDeepLink: string;
  /** Web URL that handles Stripe portal redirects and deep links */
  webRedirectUrl: string;
}

export const DEFAULT_EMAIL_CONFIG: EmailConfig = {
  mosqueName: "Al Ansar Masjid",
  mosqueShortName: "Al Ansar",
  fromEmail: "donations@alansar.app",
  supportEmail: "donations@alansar.app",
  appDeepLink: "alansar://donations",
  // Web URL that redirects to app - should be set up as a Firebase Hosting redirect
  webRedirectUrl: "https://alansar.app/redirect",
};

// ============================================================================
// STYLES
// ============================================================================

const styles = {
  body: {
    margin: "0",
    padding: "0",
    fontFamily: "Arial, sans-serif",
    backgroundColor: COLORS.background,
  },
  container: {
    backgroundColor: COLORS.cardBackground,
    borderRadius: "8px",
    overflow: "hidden" as const,
    maxWidth: "600px",
    margin: "20px auto",
  },
  headerSection: (bgColor: string) => ({
    backgroundColor: bgColor,
    padding: "30px",
    textAlign: "center" as const,
  }),
  headerTitle: {
    color: "#ffffff",
    margin: "0",
    fontSize: "28px",
    fontWeight: "bold" as const,
  },
  contentSection: {
    padding: "40px 30px",
  },
  footerSection: {
    backgroundColor: COLORS.footerBackground,
    padding: "20px",
    textAlign: "center" as const,
  },
  footerText: {
    color: COLORS.textMuted,
    fontSize: "12px",
    margin: "0 0 5px 0",
  },
};

// ============================================================================
// EMAIL LAYOUT COMPONENT
// ============================================================================

interface EmailLayoutProps {
  preview: string;
  headerTitle: string;
  headerColor: string;
  headerEmoji?: string;
  children: React.ReactNode;
  config?: Partial<EmailConfig>;
}

export function EmailLayout({
  preview,
  headerTitle,
  headerColor,
  headerEmoji = "",
  children,
  config = {},
}: EmailLayoutProps) {
  const emailConfig = { ...DEFAULT_EMAIL_CONFIG, ...config };

  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          {/* Header */}
          <Section style={styles.headerSection(headerColor)}>
            <Text style={styles.headerTitle}>
              {headerEmoji && `${headerEmoji} `}{headerTitle}
            </Text>
          </Section>

          {/* Content */}
          <Section style={styles.contentSection}>
            {children}
          </Section>

          {/* Footer */}
          <Section style={styles.footerSection}>
            <Text style={styles.footerText}>
              {emailConfig.mosqueName}
            </Text>
            <Text style={styles.footerText}>
              Secure donations powered by Stripe
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
