// ============================================================================
// CLOUD FUNCTIONS: SUBSCRIPTION MANAGEMENT
// Location: mosque_app_functions/src/functions/subscriptionManagement.ts
// ============================================================================

import { onCall } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import Stripe from "stripe";
import { Resend } from "resend";

const db = admin.firestore();

// ============================================================================
// REQUEST MANAGEMENT LINK (Send Magic Link)
// ============================================================================

export const requestManagementLink = onCall(
  {
    region: "australia-southeast1",
    secrets: ["STRIPE_SECRET_KEY", "RESEND_API_KEY"],
  },
  async (request) => {
    const { email } = request.data;

    if (!email) {
      throw new Error("Email is required");
    }

    const normalizedEmail = email.toLowerCase().trim();

    try {
      // Find active subscriptions by email
      const subscriptionsSnapshot = await db
        .collection("recurringDonations")
        .where("donor_email", "==", normalizedEmail)
        .where("status", "==", "active")
        .get();

      if (subscriptionsSnapshot.empty) {
        logger.info("No subscriptions found", { email: normalizedEmail });
        return {
          success: true,
          message: "If this email has active subscriptions, a management link has been sent.",
        };
      }

      // Get customer ID
      const subscriptionData = subscriptionsSnapshot.docs[0].data();
      const customerId = subscriptionData.stripe_customer_id;

      if (!customerId) {
        throw new Error("Customer ID not found");
      }

      // Create Stripe Portal session immediately
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
        apiVersion: "2023-10-16",
      });

      const portalSession = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: "alansar://donations",
      });

      const portalUrl = portalSession.url;

      logger.info("🔗 Portal session created", {
        email: normalizedEmail,
        portalUrl,
      });

      // Send email with Stripe Portal link
      try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        
        await resend.emails.send({
          from: 'Al Ansar <no-reply@alansar.app>',
          to: normalizedEmail,
          subject: 'Manage Your Recurring Donation',
          html: `
            <!DOCTYPE html>
            <html>
              <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
              </head>
              <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f5f5f5;">
                <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 20px;">
                  <tr>
                    <td align="center">
                      <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden;">
                        <tr>
                          <td style="background-color: #1e3a8a; padding: 30px; text-align: center;">
                            <h1 style="color: #ffffff; margin: 0; font-size: 28px;">💚 Al Ansar</h1>
                          </td>
                        </tr>
                        
                        <tr>
                          <td style="padding: 40px 30px;">
                            <h2 style="color: #1f2937; margin: 0 0 20px 0;">Manage Your Recurring Donation</h2>
                            <p style="color: #4b5563; font-size: 16px; line-height: 1.6; margin: 0 0 15px 0;">Assalamu Alaikum,</p>
                            <p style="color: #4b5563; font-size: 16px; line-height: 1.6; margin: 0 0 25px 0;">Click the button below to manage your recurring donations:</p>
                            
                            <table width="100%" cellpadding="0" cellspacing="0">
                              <tr>
                                <td align="center" style="padding: 20px 0;">
                                  <a href="${portalUrl}" 
                                     style="display: inline-block; 
                                            background-color: #1e3a8a; 
                                            color: #ffffff; 
                                            text-decoration: none; 
                                            padding: 16px 40px; 
                                            border-radius: 8px; 
                                            font-size: 18px; 
                                            font-weight: bold;">
                                    Manage My Donations
                                  </a>
                                </td>
                              </tr>
                            </table>
                            
                            <p style="color: #4b5563; font-size: 14px; line-height: 1.6; margin: 25px 0 15px 0;">If you didn't request this link, you can safely ignore this email.</p>
                            <p style="color: #4b5563; font-size: 16px; line-height: 1.6; margin: 0;">JazakAllah Khair for your continued support!</p>
                          </td>
                        </tr>
                        
                        <tr>
                          <td style="background-color: #f9fafb; padding: 20px; text-align: center;">
                            <p style="color: #6b7280; font-size: 12px; margin: 0 0 5px 0;">Al Ansar</p>
                            <p style="color: #6b7280; font-size: 12px; margin: 0;">Secure portal powered by Stripe</p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </body>
            </html>
          `,
        });

        logger.info("✅ Email sent successfully", { email: normalizedEmail });
      } catch (emailError: any) {
        logger.error("❌ Failed to send email", emailError);
      }

      return {
        success: true,
        message: "A management link has been sent to your email.",
      };
    } catch (error: any) {
      logger.error("Error generating link", error);
      throw new Error("Failed to generate link. Please try again.");
    }
  }
);
