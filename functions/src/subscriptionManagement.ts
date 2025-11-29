// ============================================================================
// CLOUD FUNCTIONS: SUBSCRIPTION MANAGEMENT
// Location: mosque_app_functions/src/functions/subscriptionManagement.ts
// ============================================================================

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import Stripe from "stripe";
import { render } from "@react-email/render";
import { getManagementLinkEmail, isValidEmail, normalizeEmail, DEFAULT_EMAIL_CONFIG } from "./emails/index.js";
import { sendEmail } from "./utils/emailTemplates.js";

const db = admin.firestore();

// ============================================================================
// REQUEST MANAGEMENT LINK (Send instructions to manage through app)
// ============================================================================
// NOTE: We no longer send portal URLs via email because they expire within minutes.
// Instead, we send an email instructing users to manage through the app.
// The app can then create a fresh portal session when the user actually needs it.

export const requestManagementLink = onCall(
  {
    region: "australia-southeast1",
    secrets: ["STRIPE_SECRET_KEY", "RESEND_API_KEY"],
  },
  async (request) => {
    const { email } = request.data;

    if (!email) {
      throw new HttpsError("invalid-argument", "Email is required");
    }

    // Validate email format
    if (!isValidEmail(email)) {
      throw new HttpsError("invalid-argument", "Invalid email format");
    }

    const normalizedEmailAddr = normalizeEmail(email);

    try {
      // Find active subscriptions by email
      const subscriptionsSnapshot = await db
        .collection("recurringDonations")
        .where("donor_email", "==", normalizedEmailAddr)
        .where("status", "==", "active")
        .get();

      if (subscriptionsSnapshot.empty) {
        logger.info("No subscriptions found", { email: normalizedEmailAddr });
        // Return generic message to prevent email enumeration
        return {
          success: true,
          message: "If this email has active subscriptions, instructions have been sent.",
        };
      }

      // Get donor name from first subscription
      const subscriptionData = subscriptionsSnapshot.docs[0].data();
      const donorName = subscriptionData.donor_name;

      logger.info("📧 Sending management instructions email", {
        email: normalizedEmailAddr,
        subscriptionCount: subscriptionsSnapshot.size,
      });

      // Send email with instructions to manage through the app
      const emailTemplate = getManagementLinkEmail({
        donorName,
        subscriptionCount: subscriptionsSnapshot.size,
      });

      const html = await render(emailTemplate.component);

      const result = await sendEmail({
        to: normalizedEmailAddr,
        subject: emailTemplate.subject,
        html,
      });

      if (result) {
        logger.info("✅ Management instructions email sent", { email: normalizedEmailAddr });
      } else {
        logger.error("❌ Failed to send management email", { email: normalizedEmailAddr });
      }

      return {
        success: true,
        message: "Instructions have been sent to your email.",
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.error("Error in requestManagementLink", { error: errorMessage });
      throw new HttpsError("internal", "Failed to process request. Please try again.");
    }
  }
);

// ============================================================================
// GET PORTAL URL (Called from app when user wants to manage subscription)
// ============================================================================
// This creates a fresh portal session with a proper web return URL.

export const getSubscriptionPortalUrl = onCall(
  {
    region: "australia-southeast1",
    secrets: ["STRIPE_SECRET_KEY"],
  },
  async (request) => {
    // Require authentication
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required");
    }

    const { customerId } = request.data;

    if (!customerId) {
      throw new HttpsError("invalid-argument", "Customer ID is required");
    }

    try {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
        apiVersion: "2023-10-16",
      });

      // Create portal session with proper return URL
      // Using a web URL that can redirect back to the app
      const portalSession = await stripe.billingPortal.sessions.create({
        customer: customerId,
        // Use web redirect URL from config (or env override)
        return_url: process.env.STRIPE_PORTAL_RETURN_URL || DEFAULT_EMAIL_CONFIG.webRedirectUrl,
      });

      logger.info("🔗 Portal session created for authenticated user", {
        customerId,
        userId: request.auth.uid,
      });

      return {
        success: true,
        portalUrl: portalSession.url,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.error("Error creating portal session", { error: errorMessage, customerId });
      throw new HttpsError("internal", "Failed to create portal session");
    }
  }
);
