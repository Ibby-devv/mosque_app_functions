// ============================================================================
// EMAIL SERVICE - Central email sending with React Email + Resend
// ============================================================================

import { render } from "@react-email/render";
import { Resend } from "resend";
import { logger } from "firebase-functions";
import * as React from "react";
import { DEFAULT_EMAIL_CONFIG, EmailConfig } from "./components/EmailLayout.js";

// ============================================================================
// EMAIL VALIDATION
// ============================================================================

/**
 * Validates an email address format
 * Returns true if the email appears valid, false otherwise
 */
export function isValidEmail(email: string | null | undefined): email is string {
  if (!email || typeof email !== "string") {
    return false;
  }

  // Basic email validation regex
  // Matches: local@domain.tld format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  
  // Check length constraints
  if (email.length > 254 || email.length < 5) {
    return false;
  }

  return emailRegex.test(email.trim());
}

/**
 * Normalizes an email address (lowercase, trimmed)
 */
export function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

// ============================================================================
// SEND EMAIL PARAMS
// ============================================================================

export interface SendEmailParams {
  to: string;
  subject: string;
  /** React Email component to render */
  react: React.ReactElement;
  from?: string;
  replyTo?: string;
}

export interface SendRawEmailParams {
  to: string;
  subject: string;
  html: string;
  from?: string;
  replyTo?: string;
}

// ============================================================================
// EMAIL SENDING RESULT
// ============================================================================

export interface EmailResult {
  success: boolean;
  emailId?: string;
  error?: string;
}

// ============================================================================
// SEND EMAIL WITH REACT COMPONENT
// ============================================================================

/**
 * Sends an email using a React Email component
 * @param params Email parameters including recipient, subject, and React component
 * @param config Optional email configuration overrides
 * @returns Result object with success status and optional email ID or error
 */
export async function sendEmail(
  params: SendEmailParams,
  config?: Partial<EmailConfig>
): Promise<EmailResult> {
  const emailConfig = { ...DEFAULT_EMAIL_CONFIG, ...config };

  // Validate email address
  if (!isValidEmail(params.to)) {
    logger.warn("Invalid email address provided", { to: params.to });
    return {
      success: false,
      error: "Invalid email address",
    };
  }

  const normalizedTo = normalizeEmail(params.to);

  try {
    // Short-circuit during local emulator runs to avoid network latency/timeouts
    if (
      process.env.FUNCTIONS_EMULATOR === "true" ||
      process.env.FIREBASE_EMULATOR_HUB
    ) {
      logger.info("(EMULATOR) Skipping real email send, simulating success", {
        to: normalizedTo,
        subject: params.subject,
      });
      return { success: true, emailId: "emulator-mock-id" };
    }

    // Check for API key
    if (!process.env.RESEND_API_KEY) {
      logger.error("RESEND_API_KEY not configured");
      return {
        success: false,
        error: "Email service not configured",
      };
    }

    const resend = new Resend(process.env.RESEND_API_KEY);

    // Render React component to HTML
    const html = await render(params.react);

    const result = await resend.emails.send({
      from: params.from || `${emailConfig.mosqueShortName} <${emailConfig.fromEmail}>`,
      to: normalizedTo,
      subject: params.subject,
      html,
      replyTo: params.replyTo || emailConfig.supportEmail,
    });

    if (result.error) {
      logger.error("❌ Email sending failed", {
        to: normalizedTo,
        subject: params.subject,
        error: result.error.message,
      });
      return {
        success: false,
        error: result.error.message,
      };
    }

    logger.info("✅ Email sent successfully", {
      to: normalizedTo,
      subject: params.subject,
      emailId: result.data?.id,
    });

    return {
      success: true,
      emailId: result.data?.id,
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error("❌ Email sending failed", {
      to: normalizedTo,
      subject: params.subject,
      error: errorMessage,
    });
    return {
      success: false,
      error: errorMessage,
    };
  }
}

// ============================================================================
// SEND RAW HTML EMAIL (for backwards compatibility)
// ============================================================================

/**
 * Sends an email with raw HTML content
 * @deprecated Use sendEmail with React components instead
 */
export async function sendRawEmail(
  params: SendRawEmailParams,
  config?: Partial<EmailConfig>
): Promise<EmailResult> {
  const emailConfig = { ...DEFAULT_EMAIL_CONFIG, ...config };

  // Validate email address
  if (!isValidEmail(params.to)) {
    logger.warn("Invalid email address provided", { to: params.to });
    return {
      success: false,
      error: "Invalid email address",
    };
  }

  const normalizedTo = normalizeEmail(params.to);

  try {
    // Short-circuit during local emulator runs
    if (
      process.env.FUNCTIONS_EMULATOR === "true" ||
      process.env.FIREBASE_EMULATOR_HUB
    ) {
      logger.info("(EMULATOR) Skipping real email send, simulating success", {
        to: normalizedTo,
        subject: params.subject,
      });
      return { success: true, emailId: "emulator-mock-id" };
    }

    if (!process.env.RESEND_API_KEY) {
      logger.error("RESEND_API_KEY not configured");
      return {
        success: false,
        error: "Email service not configured",
      };
    }

    const resend = new Resend(process.env.RESEND_API_KEY);

    const result = await resend.emails.send({
      from: params.from || `${emailConfig.mosqueShortName} <${emailConfig.fromEmail}>`,
      to: normalizedTo,
      subject: params.subject,
      html: params.html,
      replyTo: params.replyTo || emailConfig.supportEmail,
    });

    if (result.error) {
      logger.error("❌ Email sending failed", {
        to: normalizedTo,
        subject: params.subject,
        error: result.error.message,
      });
      return {
        success: false,
        error: result.error.message,
      };
    }

    logger.info("✅ Email sent successfully", {
      to: normalizedTo,
      subject: params.subject,
      emailId: result.data?.id,
    });

    return {
      success: true,
      emailId: result.data?.id,
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error("❌ Email sending failed", {
      to: normalizedTo,
      subject: params.subject,
      error: errorMessage,
    });
    return {
      success: false,
      error: errorMessage,
    };
  }
}
