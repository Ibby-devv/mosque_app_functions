/* eslint-disable require-jsdoc */
/* eslint-disable operator-linebreak */
// ============================================================================
// CLOUD FUNCTIONS: STRIPE WEBHOOK HANDLER
// Location: mosque_app_functions/src/webhooks.ts
// ============================================================================

import { onRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import Stripe from "stripe";
import { generateReceiptNumber } from "./donations";
import {
  checkEventProcessed,
  markEventStarted,
  markEventCompleted,
  markEventFailed,
} from "./utils/webhookIdempotency";
import {
  oneTimeDonationReceipt,
  recurringDonationWelcome,
  monthlyRecurringReceipt,
  paymentFailedEmail,
  subscriptionCancelledEmail,
  refundConfirmationEmail,
  disputeAlertEmail,
  sendEmail,
} from "./utils/emailTemplates";

const db = admin.firestore();

// Get mosque timezone from settings (with cache)
let cachedMosqueTimezone: string | null = null;
const getMosqueTimezone = async (): Promise<string> => {
  if (cachedMosqueTimezone) return cachedMosqueTimezone;
  
  try {
    const settingsDoc = await db.collection('mosqueSettings').doc('info').get();
    const timezone = settingsDoc.data()?.timezone;
    if (timezone && typeof timezone === 'string') {
      cachedMosqueTimezone = timezone;
      return timezone;
    }
  } catch (error) {
    logger.warn('Could not fetch mosque timezone, using default', error);
  }
  
  // Default fallback
  cachedMosqueTimezone = 'Australia/Sydney';
  return cachedMosqueTimezone;
};

// Get current date string in mosque timezone (YYYY-MM-DD format)
const getMosqueDateString = async (): Promise<string> => {
  const timezone = await getMosqueTimezone();
  const now = new Date();
  
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  
  const year = parts.find(p => p.type === 'year')?.value;
  const month = parts.find(p => p.type === 'month')?.value;
  const day = parts.find(p => p.type === 'day')?.value;
  
  return `${year}-${month}-${day}`;
};

// Calculate next payment date based on frequency
const calculateNextPaymentDate = async (frequency: string): Promise<string> => {
  const timezone = await getMosqueTimezone();
  const now = new Date();
  
  // Get current date parts in mosque timezone
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(now);
  
  const year = parseInt(parts.find(p => p.type === 'year')?.value || '0');
  const month = parseInt(parts.find(p => p.type === 'month')?.value || '1') - 1;
  const day = parseInt(parts.find(p => p.type === 'day')?.value || '1');
  
  const mosqueDate = new Date(year, month, day);

  switch (frequency) {
    case "weekly":
      mosqueDate.setDate(mosqueDate.getDate() + 7);
      break;
    case "fortnightly":
      mosqueDate.setDate(mosqueDate.getDate() + 14);
      break;
    case "monthly":
      mosqueDate.setMonth(mosqueDate.getMonth() + 1);
      break;
    case "yearly":
      mosqueDate.setFullYear(mosqueDate.getFullYear() + 1);
      break;
  }

  const y = mosqueDate.getFullYear();
  const m = String(mosqueDate.getMonth() + 1).padStart(2, '0');
  const d = String(mosqueDate.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

// ============================================================================
// WEBHOOK HANDLER
// ============================================================================

export const handleStripeWebhook = onRequest(
  {
    region: "australia-southeast1",
    cors: true,
    timeoutSeconds: 120,
    // eslint-disable-next-line max-len
    secrets: process.env.FUNCTIONS_EMULATOR === "true" 
      ? [] // No secrets in emulator - use env vars directly
      : ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "RESEND_API_KEY"], // Secret Manager for production
  },
  async (req, res) => {
    // Initialize Stripe - uses env vars in emulator, Secret Manager in production
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
      apiVersion: "2023-10-16",
    });

    const sig = req.headers["stripe-signature"];

    if (!sig) {
      logger.error("No Stripe signature found");
      res.status(400).send("No signature");
      return;
    }

    let event: Stripe.Event;

    try {
      // Verify webhook signature using secret from Secret Manager
      event = stripe.webhooks.constructEvent(
        req.rawBody,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET || ""
      );
    } catch (err: any) {
      logger.error("Webhook signature verification failed", err);
      res.status(400).send(`Webhook Error: ${err.message}`);
      return;
    }

    logger.info("Webhook received", { type: event.type, id: event.id });

    // Quickly ignore noisy/unhandled event types to avoid unnecessary work in emulator
    const handledEventTypes = new Set([
      "checkout.session.completed",
      "payment_intent.succeeded",
      "payment_intent.payment_failed",
      "customer.subscription.created",
      "customer.subscription.updated",
      "invoice.payment_succeeded",
      "invoice.payment_failed",
      "customer.subscription.deleted",
      "charge.refunded",
      "charge.dispute.created",
    ]);

    if (!handledEventTypes.has(event.type)) {
      logger.info("Ignoring unhandled event type (no-op)", { type: event.type });
      res.json({ received: true, ignored: true });
      return;
    }

    // ============================================================================
    // IDEMPOTENCY CHECK - Prevent duplicate processing
    // ============================================================================
    const { isProcessed } = await checkEventProcessed(event.id);

    if (isProcessed) {
      logger.info("✅ Event already processed - skipping", {
        eventId: event.id,
        eventType: event.type,
      });
      res.json({ received: true, skipped: "already_processed" });
      return;
    }

    // Mark event as started (creates tracking record)
    await markEventStarted(event.id, event.type);

    try {
      switch (event.type) {
        // Checkout session completed (PRIMARY event for one-time & subscription setup)
        case "checkout.session.completed":
          await handleCheckoutSessionCompleted(
            event.data.object as Stripe.Checkout.Session,
            stripe
          );
          break;

        // One-time payment succeeded
        case "payment_intent.succeeded":
          await handlePaymentIntentSucceeded(
            event.data.object as Stripe.PaymentIntent,
            stripe
          );
          break;

        // One-time payment failed
        case "payment_intent.payment_failed":
          await handlePaymentIntentFailed(
            event.data.object as Stripe.PaymentIntent
          );
          break;

        // Subscription created (recurring donation started)
        case "customer.subscription.created":
          await handleSubscriptionCreated(
            event.data.object as Stripe.Subscription
          );
          break;

        // Subscription updated (amount/frequency/payment method changed)
        case "customer.subscription.updated":
          await handleSubscriptionUpdated(
            event.data.object as Stripe.Subscription,
            stripe
          );
          break;

        // Subscription payment succeeded (recurring payment)
        case "invoice.payment_succeeded":
          await handleInvoicePaymentSucceeded(
            event.data.object as Stripe.Invoice,
            stripe
          );
          break;

        // Subscription payment failed
        case "invoice.payment_failed":
          await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
          break;

        // Subscription cancelled
        case "customer.subscription.deleted":
          await handleSubscriptionDeleted(
            event.data.object as Stripe.Subscription
          );
          break;

        // Charge refunded
        case "charge.refunded":
          await handleChargeRefunded(
            event.data.object as Stripe.Charge,
            stripe
          );
          break;

        // Dispute created
        case "charge.dispute.created":
          await handleDisputeCreated(
            event.data.object as Stripe.Dispute,
            stripe
          );
          break;

        default:
          logger.info("Unhandled webhook event type", { type: event.type });
      }

      // Mark event as successfully completed
      await markEventCompleted(event.id);

      res.json({ received: true });
    } catch (error: any) {
      logger.error("Error processing webhook", {
        eventId: event.id,
        eventType: event.type,
        error: error.message,
      });

      // Mark event as failed for retry tracking
      await markEventFailed(event.id, error.message);

      // Return 500 to tell Stripe to retry
      // Stripe will retry failed webhooks automatically
      res.status(500).send("Webhook processing failed");
    }
  }
);

// ============================================================================
// HANDLER: Checkout Session Completed (PRIMARY event for donations)
// ============================================================================
// This is the most reliable event for processing both one-time and recurring donations
// It fires immediately after successful checkout and contains all customer details

async function handleCheckoutSessionCompleted(
  session: Stripe.Checkout.Session,
  stripe: Stripe
) {
  try {
    logger.info("🎯 Processing checkout.session.completed", {
      sessionId: session.id,
      mode: session.mode,
      amount: session.amount_total,
    });

    // Handle based on checkout mode
    if (session.mode === "payment") {
      // ONE-TIME DONATION
      await handleCheckoutOneTime(session, stripe);
    } else if (session.mode === "subscription") {
      // RECURRING DONATION SETUP
      await handleCheckoutSubscription(session, stripe);
    } else {
      logger.warn("Unknown checkout mode", { mode: session.mode });
    }
  } catch (error) {
    logger.error("Error handling checkout session completed", error);
    throw error;
  }
}

// ============================================================================
// HANDLER: Checkout One-Time Donation
// ============================================================================

async function handleCheckoutOneTime(
  session: Stripe.Checkout.Session,
  stripe: Stripe
) {
  try {
    const metadata = session.metadata || {};

    logger.info("💰 Processing one-time donation from checkout", {
      sessionId: session.id,
      amount: session.amount_total,
      donorEmail: session.customer_details?.email,
    });

    // Generate receipt number
    const receiptNumber = await generateReceiptNumber();

    // Get payment intent for more details
    const paymentIntentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : null;

    let paymentMethod = null;
    if (paymentIntentId) {
      const paymentIntent = await stripe.paymentIntents.retrieve(
        paymentIntentId
      );
      const paymentMethodId =
        typeof paymentIntent.payment_method === "string"
          ? paymentIntent.payment_method
          : null;

      if (paymentMethodId) {
        paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);
      }
    }

    // Extract customer details from session
  const customerEmail = session.customer_details?.email || metadata.donor_email || null;
  const customerName = session.customer_details?.name || metadata.donor_name || "Anonymous";

    // Create donation record
    const donationRef = db.collection("donations").doc();
    await donationRef.set({
      id: donationRef.id,
      receipt_number: receiptNumber,

      // Donor info
      donor_name: customerName,
      donor_email: customerEmail,
      donor_phone: metadata.donor_phone || null,

      // Payment info
  amount: session.amount_total || 0,
  currency: (session.currency || "aud").toUpperCase(),

      // Stripe details
      stripe_payment_intent_id: paymentIntentId,
      stripe_checkout_session_id: session.id,
      stripe_customer_id:
        typeof session.customer === "string" ? session.customer : null,
      payment_method_type: paymentMethod?.type || "card",
      card_last4: paymentMethod?.card?.last4 || null,
      card_brand: paymentMethod?.card?.brand || null,

      // Status
      payment_status: "succeeded",

      // Donation details
  donation_type_id: metadata.donation_type_id || null,
  donation_type_label: metadata.donation_type_label || "General Donation",
      campaign_id: metadata.campaign_id || null,
      is_recurring: false,

      // Metadata
      donor_message: metadata.donor_message || null,

      // Email tracking
      receipt_email_sent: false,
      receipt_sent_at: null,

      // Timestamps
      date: await getMosqueDateString(),
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      completed_at: admin.firestore.FieldValue.serverTimestamp(),
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    logger.info("✅ One-time donation recorded", {
      donationId: donationRef.id,
      receiptNumber,
      amount: session.amount_total,
    });

    // Update campaign total if applicable
    if (metadata.campaign_id && session.amount_total) {
      await updateCampaignTotal(metadata.campaign_id, session.amount_total);
    }

    // Send receipt email if email provided
    if (customerEmail) {
      logger.info("📧 Sending one-time donation receipt", {
        email: customerEmail,
        receiptNumber,
      });

      const emailData = await oneTimeDonationReceipt({
        donorName: customerName,
        amount: session.amount_total || 0,
        currency: session.currency || "aud",
        receiptNumber,
        date: await getMosqueDateString(),
        donationType: metadata.donation_type_label || "General Donation",
        campaignName: metadata.campaign_name,
        cardLast4: paymentMethod?.card?.last4,
        cardBrand: paymentMethod?.card?.brand,
      });

      const emailSent = await sendEmail({
        to: customerEmail,
        subject: emailData.subject,
        html: emailData.html,
      });

      // Update donation record with email status
      await donationRef.update({
        receipt_email_sent: emailSent,
        receipt_sent_at: emailSent
          ? admin.firestore.FieldValue.serverTimestamp()
          : null,
      });
    } else {
      logger.info("ℹ️ No email - anonymous donation", {
        donationId: donationRef.id,
      });
    }
  } catch (error) {
    logger.error("Error handling checkout one-time donation", error);
    throw error;
  }
}

// ============================================================================
// HANDLER: Checkout Subscription Setup
// ============================================================================

async function handleCheckoutSubscription(
  session: Stripe.Checkout.Session,
  stripe: Stripe
) {
  try {
    const metadata = session.metadata || {};

    logger.info("🔄 Processing subscription setup from checkout", {
      sessionId: session.id,
      subscriptionId: session.subscription,
    });

    // Get full subscription details
    const subscriptionId =
      typeof session.subscription === "string" ? session.subscription : null;

    if (!subscriptionId) {
      logger.error("No subscription ID in checkout session", {
        sessionId: session.id,
      });
      return;
    }

    const subscription = await stripe.subscriptions.retrieve(subscriptionId);

    // Extract customer details
    const customerEmail = session.customer_details?.email || metadata.donor_email || "";
    const customerName = session.customer_details?.name || metadata.donor_name || "Anonymous";

    // Calculate next payment date
    const nextPaymentDate = await calculateNextPaymentDate(metadata.frequency);

    // Subscription record is created by customer.subscription.created event
    // Here we just send the welcome email

    logger.info("📧 Sending recurring donation welcome email", {
      email: customerEmail,
      subscriptionId,
    });

    if (customerEmail) {
      // NOTE: Portal sessions are no longer created here as URLs expire too quickly
      // Users should manage subscriptions through the app

      const emailData = await recurringDonationWelcome({
        donorName: customerName,
        amount: subscription.items.data[0].price.unit_amount || 0,
        currency: subscription.currency || "aud",
        frequency: metadata.frequency || "monthly",
        donationType: metadata.donation_type_label || "General Donation",
        campaignName: metadata.campaign_name,
        nextPaymentDate,
        // NOTE: Portal URL removed - expires too quickly for email
      });

      await sendEmail({
        to: customerEmail,
        subject: emailData.subject,
        html: emailData.html,
      });

      logger.info("✅ Welcome email sent for subscription", {
        subscriptionId,
        email: customerEmail,
      });
    }
  } catch (error) {
    logger.error("Error handling checkout subscription", error);
    throw error;
  }
}

// ============================================================================
// HANDLER: Payment Intent Succeeded (One-Time Donation)
// ============================================================================

async function handlePaymentIntentSucceeded(
  paymentIntent: Stripe.PaymentIntent,
  stripe: Stripe
) {
  try {
    const metadata = paymentIntent.metadata;

    logger.info("💳 Payment intent succeeded", {
      paymentIntentId: paymentIntent.id,
      amount: paymentIntent.amount,
      hasInvoice: !!paymentIntent.invoice,
    });

    // ============================================================================
    // SKIP LOGIC: Avoid duplicate processing
    // ============================================================================

    // 1. Skip if this is part of a subscription (will be handled by invoice.payment_succeeded)
    const hasInvoice = paymentIntent.invoice && paymentIntent.invoice !== "";
    const isRecurring = metadata.is_recurring === "true";

    if (hasInvoice || isRecurring) {
      logger.info("⏭️ SKIP: Payment intent is part of subscription", {
        paymentIntentId: paymentIntent.id,
        invoice: paymentIntent.invoice,
        is_recurring: metadata.is_recurring,
      });
      return;
    }

    // 1b. Additional check: Skip if latest_charge is attached to an invoice (subscription payment)
    if (paymentIntent.latest_charge) {
      try {
        const chargeId = typeof paymentIntent.latest_charge === 'string' 
          ? paymentIntent.latest_charge 
          : paymentIntent.latest_charge.id;
        
        const charge = await stripe.charges.retrieve(chargeId);
        
        if (charge.invoice) {
          logger.info("⏭️ SKIP: Payment intent charge is linked to invoice (subscription)", {
            paymentIntentId: paymentIntent.id,
            invoiceId: charge.invoice,
          });
          return;
        }
      } catch (e: any) {
        logger.warn("Could not verify charge for subscription check", { 
          error: e.message,
          paymentIntentId: paymentIntent.id,
        });
      }
    }

    // 2. Check if this payment was already processed via checkout.session.completed
    const existingDonation = await db
      .collection("donations")
      .where("stripe_payment_intent_id", "==", paymentIntent.id)
      .limit(1)
      .get();

    if (!existingDonation.empty) {
      logger.info("⏭️ SKIP: Donation already processed by checkout.session.completed", {
        paymentIntentId: paymentIntent.id,
        donationId: existingDonation.docs[0].id,
      });
      return;
    }

    // ============================================================================
    // PROCESS: This is a one-time payment not yet processed
    // ============================================================================

    logger.info("✅ PROCESSING: One-time donation (fallback)", {
      paymentIntentId: paymentIntent.id,
    });

    // Generate receipt number
    const receiptNumber = await generateReceiptNumber();

    // Get payment method details
    const paymentMethod =
      paymentIntent.payment_method &&
      typeof paymentIntent.payment_method === "string"
        ? await stripe.paymentMethods.retrieve(paymentIntent.payment_method)
        : null;

    // Get charge details for receipt URL
    let receiptUrl: string | null = null;
    if (paymentIntent.latest_charge) {
      try {
        const chargeId = typeof paymentIntent.latest_charge === 'string'
          ? paymentIntent.latest_charge
          : paymentIntent.latest_charge.id;
        const charge = await stripe.charges.retrieve(chargeId);
        receiptUrl = charge.receipt_url || null;
      } catch (e: any) {
        logger.warn("Could not retrieve charge for receipt URL", {
          error: e.message,
        });
      }
    }

    // Extract donor info
  const donorEmail = metadata.donor_email || null;
  const donorName = metadata.donor_name || "Anonymous";

    // Create donation record
    const donationRef = db.collection("donations").doc();
    await donationRef.set({
      id: donationRef.id,
      receipt_number: receiptNumber,

      // Donor info
      donor_name: donorName,
      donor_email: donorEmail,
      donor_phone: metadata.donor_phone || null,

      // Payment info
      amount: paymentIntent.amount,
      currency: paymentIntent.currency.toUpperCase(),

      // Stripe details
      stripe_payment_intent_id: paymentIntent.id,
      stripe_customer_id:
        (typeof paymentIntent.customer === "string"
          ? paymentIntent.customer
          : null) || null,
      payment_method_type: paymentMethod?.type || "card",
      card_last4: paymentMethod?.card?.last4 || null,
      card_brand: paymentMethod?.card?.brand || null,
      stripe_receipt_url: receiptUrl,

      // Status
      payment_status: "succeeded",

      // Donation details
  donation_type_id: metadata.donation_type_id || null,
  donation_type_label: metadata.donation_type_label || "General Donation",
      campaign_id: metadata.campaign_id || null,
      is_recurring: false,

      // Metadata
      donor_message: metadata.donor_message || null,

      // Email tracking
      receipt_email_sent: false,
      receipt_sent_at: null,

      // Timestamps
      date: admin.firestore.FieldValue.serverTimestamp(),
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      completed_at: admin.firestore.FieldValue.serverTimestamp(),
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    logger.info("✅ One-time donation recorded (fallback)", {
      donationId: donationRef.id,
      receiptNumber,
      amount: paymentIntent.amount,
    });

    // Update campaign total if applicable
    if (metadata.campaign_id) {
      await updateCampaignTotal(metadata.campaign_id, paymentIntent.amount);
    }

    // Send receipt email if email provided
    if (donorEmail) {
      logger.info("📧 Sending one-time donation receipt (fallback)", {
        email: donorEmail,
        receiptNumber,
      });

      const emailData = await oneTimeDonationReceipt({
        donorName,
        amount: paymentIntent.amount,
        currency: paymentIntent.currency,
        receiptNumber,
        date: await getMosqueDateString(),
        donationType: metadata.donation_type_label || "General Donation",
        campaignName: metadata.campaign_name,
        cardLast4: paymentMethod?.card?.last4,
        cardBrand: paymentMethod?.card?.brand,
      });

      const emailSent = await sendEmail({
        to: donorEmail,
        subject: emailData.subject,
        html: emailData.html,
      });

      // Update donation record with email status
      await donationRef.update({
        receipt_email_sent: emailSent,
        receipt_sent_at: emailSent
          ? admin.firestore.FieldValue.serverTimestamp()
          : null,
      });
    } else {
      logger.info("ℹ️ No email - anonymous donation", {
        donationId: donationRef.id,
      });
    }
  } catch (error) {
    logger.error("Error handling payment intent succeeded", error);
    throw error;
  }
}

// ============================================================================
// HANDLER: Payment Intent Failed
// ============================================================================

async function handlePaymentIntentFailed(paymentIntent: Stripe.PaymentIntent) {
  logger.warn("Payment intent failed", {
    paymentIntentId: paymentIntent.id,
    amount: paymentIntent.amount,
    donor: paymentIntent.metadata.donor_email,
  });

  // Optionally: Create a failed donation record for tracking
  // For now, we'll just log it
}

// ============================================================================
// HANDLER: Subscription Created (Recurring Donation)
// ============================================================================

async function handleSubscriptionCreated(subscription: Stripe.Subscription) {
  try {
    const metadata = subscription.metadata || ({} as Record<string, string>);

    // Create recurring donation record
    await db
      .collection("recurringDonations")
      .doc(subscription.id)
      .set({
        id: subscription.id,
        stripe_subscription_id: subscription.id,
        stripe_customer_id:
          typeof subscription.customer === "string"
            ? subscription.customer
            : subscription.customer.id,

        // Donor info
        donor_name: metadata.donor_name || "Anonymous",
        donor_email: metadata.donor_email || null,

        // Subscription details
        amount: subscription.items.data[0].price.unit_amount || 0,
        currency: (subscription.currency || "aud").toUpperCase(),
        frequency: metadata.frequency || "monthly",

        // Status
      status: "active",
      next_payment_date: await calculateNextPaymentDate(
        metadata.frequency || "monthly"
      ),        // Donation details
        donation_type_id: metadata.donation_type_id || null,
        donation_type_label: metadata.donation_type_label || "General Donation",
        campaign_id: metadata.campaign_id || null,

        // Timestamps
        created_at: admin.firestore.FieldValue.serverTimestamp(),
        started_at: admin.firestore.FieldValue.serverTimestamp(),
      });

    logger.info("Recurring donation created", {
      subscriptionId: subscription.id,
      frequency: metadata.frequency || "monthly",
      amount: subscription.items.data[0].price.unit_amount,
    });

    // Also send welcome email (for non-Checkout flows)
    try {
      // NOTE: Portal sessions are no longer created here as URLs expire too quickly
      // Users should manage subscriptions through the app

      // Compute next payment date based on frequency
      const nextPaymentDate = await calculateNextPaymentDate(
        metadata.frequency || "monthly"
      );

      if (metadata.donor_email) {
        const emailData = await recurringDonationWelcome({
          donorName: metadata.donor_name || "Anonymous",
          amount: subscription.items.data[0].price.unit_amount || 0,
          currency: subscription.currency || "aud",
          frequency: metadata.frequency || "monthly",
          donationType: metadata.donation_type_label || "General Donation",
          campaignName: undefined,
          nextPaymentDate,
          // NOTE: Portal URL removed - expires too quickly for email
        });

        await sendEmail({
          to: metadata.donor_email,
          subject: emailData.subject,
          html: emailData.html,
        });

        logger.info("✅ Welcome email sent (subscription.created)", {
          subscriptionId: subscription.id,
          email: metadata.donor_email,
        });
      }
    } catch (e) {
      logger.error("Failed to send welcome email on subscription.created", e);
    }
  } catch (error) {
    logger.error("Error handling subscription created", error);
    throw error;
  }
}

// ============================================================================
// HANDLER: Invoice Payment Succeeded (Recurring Payment)
// ============================================================================

async function handleInvoicePaymentSucceeded(
  invoice: Stripe.Invoice,
  stripe: Stripe
) {
  try {
    logger.info("📋 Processing invoice.payment_succeeded", {
      invoiceId: invoice.id,
    });

    // Extract subscription ID - can be at top level or nested in parent.subscription_details
    let subscriptionId: string | null = null;
    
    if (invoice.subscription) {
      subscriptionId = typeof invoice.subscription === "string"
        ? invoice.subscription
        : invoice.subscription.id;
    } else if ((invoice as any).parent?.subscription_details?.subscription) {
      // Handle nested subscription ID in parent object
      subscriptionId = (invoice as any).parent.subscription_details.subscription;
    }

    if (!subscriptionId) {
      logger.info("⏭️ SKIP: Not a subscription invoice", {
        invoiceId: invoice.id,
        hasParent: !!(invoice as any).parent,
      });
      return;
    }

    logger.info("📋 Retrieved subscription ID", {
      invoiceId: invoice.id,
      subscriptionId,
    });

    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const metadata = subscription.metadata || ({} as Record<string, string>);

    // Generate receipt number
    const receiptNumber = await generateReceiptNumber();

    // Get payment intent and payment method details
    const paymentIntentId =
      typeof invoice.payment_intent === "string"
        ? invoice.payment_intent
        : null;
    const paymentIntent = paymentIntentId
      ? await stripe.paymentIntents.retrieve(paymentIntentId)
      : null;

    const paymentMethodId =
      paymentIntent?.payment_method &&
      typeof paymentIntent.payment_method === "string"
        ? paymentIntent.payment_method
        : null;

    const pm = paymentMethodId
      ? await stripe.paymentMethods.retrieve(paymentMethodId)
      : null;

    // Get receipt URL from invoice charge
    let receiptUrl: string | null = null;
    if (invoice.charge) {
      try {
        const chargeId = typeof invoice.charge === 'string'
          ? invoice.charge
          : invoice.charge.id;
        const charge = await stripe.charges.retrieve(chargeId);
        receiptUrl = charge.receipt_url || null;
      } catch (e: any) {
        logger.warn("Could not retrieve charge for invoice receipt URL", {
          error: e.message,
        });
      }
    }

    // Create donation record for this recurring payment
    const donationRef = db.collection("donations").doc();
    await donationRef.set({
      id: donationRef.id,
      receipt_number: receiptNumber,

      // Donor info
  donor_name: metadata.donor_name || "Anonymous",
  donor_email: metadata.donor_email || null,
  donor_phone: metadata.donor_phone || null,

      // Payment info
  amount: invoice.amount_paid,
  currency: (invoice.currency || "aud").toUpperCase(),

      // Stripe details
      stripe_payment_intent_id: paymentIntentId,
      stripe_subscription_id: subscription.id,
      stripe_customer_id:
        typeof subscription.customer === "string"
          ? subscription.customer
          : subscription.customer.id,
      payment_method_type: pm?.type || "card",
      card_last4: pm?.card?.last4 || null,
      card_brand: pm?.card?.brand || null,
      stripe_receipt_url: receiptUrl,

      // Status
      payment_status: "succeeded",

      // Donation details
  donation_type_id: metadata.donation_type_id || null,
  donation_type_label: metadata.donation_type_label || "General Donation",
  campaign_id: metadata.campaign_id || null,
  is_recurring: true,
  recurring_frequency: metadata.frequency || "monthly",

      // Timestamps
      date: admin.firestore.FieldValue.serverTimestamp(),
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      completed_at: admin.firestore.FieldValue.serverTimestamp(),
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Update recurring donation record
    await db
      .collection("recurringDonations")
      .doc(subscription.id)
      .update({
        last_payment_at: admin.firestore.FieldValue.serverTimestamp(),
        last_payment_donation_id: donationRef.id,
        next_payment_date: await calculateNextPaymentDate(
          metadata.frequency || "monthly"
        ),
      });

    // Update campaign total if applicable
    if (metadata.campaign_id) {
      await updateCampaignTotal(metadata.campaign_id, invoice.amount_paid);
    }

    logger.info("Recurring donation payment recorded", {
      donationId: donationRef.id,
      subscriptionId: subscription.id,
      receiptNumber,
      amount: invoice.amount_paid,
      billingReason: invoice.billing_reason,
    });

    // Send recurring receipt email (skip for first invoice - welcome email already sent)
    const isFirstInvoice = invoice.billing_reason === "subscription_create";
    
    if (isFirstInvoice) {
      logger.info("⏭️ SKIP: First invoice receipt (welcome email already sent)", {
        invoiceId: invoice.id,
        subscriptionId: subscription.id,
      });
    } else {
      try {
        // NOTE: Portal sessions are no longer created here as URLs expire too quickly
        // Users should manage subscriptions through the app

        const nextPaymentDate = await calculateNextPaymentDate(
          metadata.frequency || "monthly"
        );

        if (metadata.donor_email) {
          const emailData = await monthlyRecurringReceipt({
            donorName: metadata.donor_name || "Anonymous",
            amount: invoice.amount_paid,
            currency: invoice.currency || "aud",
            receiptNumber,
            date: await getMosqueDateString(),
            frequency: metadata.frequency || "monthly",
            donationType: metadata.donation_type_label || "General Donation",
            campaignName: undefined,
            nextPaymentDate,
            // NOTE: Portal URL removed - expires too quickly for email
          });

          const emailSent = await sendEmail({
            to: metadata.donor_email,
            subject: emailData.subject,
            html: emailData.html,
          });

          await donationRef.update({
            receipt_email_sent: emailSent,
            receipt_sent_at: emailSent
              ? admin.firestore.FieldValue.serverTimestamp()
              : null,
          });

          logger.info("✅ Recurring receipt email sent", {
            donationId: donationRef.id,
            email: metadata.donor_email,
          });
        }
      } catch (e) {
        logger.error("Failed to send recurring receipt email", e);
      }
    }
  } catch (error) {
    logger.error("Error handling invoice payment succeeded", error);
    throw error;
  }
}

// ============================================================================
// HANDLER: Invoice Payment Failed
// ============================================================================

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  const attemptCount = invoice.attempt_count || 0;
  const isUrgent = attemptCount >= 3;

  logger.warn("⚠️ Payment failed", {
    invoiceId: invoice.id,
    customerId: invoice.customer,
    amount: invoice.amount_due,
    attemptCount,
    isUrgent,
  });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
    apiVersion: "2023-10-16",
  });

  try {
    // Get customer email
    const customer = await stripe.customers.retrieve(
      invoice.customer as string
    );
    const customerEmail = (customer as Stripe.Customer).email;

    if (!customerEmail) {
      logger.error("No email found for customer", {
        customerId: invoice.customer,
      });
      return;
    }

    // NOTE: Portal sessions are no longer created here as URLs expire too quickly
    // Users should update payment through the app

    // Get next retry date if available
    const nextRetry = invoice.next_payment_attempt
      ? new Date(invoice.next_payment_attempt * 1000).toLocaleDateString("en-AU")
      : undefined;

    // Send payment failure notification email using template
    const emailData = await paymentFailedEmail({
      donorName: (customer as Stripe.Customer).name || "Donor",
      amount: invoice.amount_due,
      currency: invoice.currency || "aud",
      frequency: "recurring",
      attemptCount,
      nextRetryDate: nextRetry,
    });

    await sendEmail({
      to: customerEmail,
      subject: emailData.subject,
      html: emailData.html,
    });

    logger.info("✅ Payment failure email sent", {
      email: customerEmail,
      invoiceId: invoice.id,
      attemptCount,
      urgency: isUrgent ? "URGENT" : "standard",
    });

    // Update Firestore subscription status with failure details
    const subscriptionQuery = await admin
      .firestore()
      .collection("recurringDonations")
      .where("stripe_subscription_id", "==", invoice.subscription)
      .limit(1)
      .get();

    if (!subscriptionQuery.empty) {
      await subscriptionQuery.docs[0].ref.update({
        status: "past_due",
        last_payment_error: admin.firestore.FieldValue.serverTimestamp(),
        payment_attempt_count: attemptCount,
        payment_error_message: invoice.last_finalization_error?.message || "Payment failed",
      });
      logger.info("Updated subscription with failure details", {
        subscriptionId: invoice.subscription,
        attemptCount,
      });
    }
  } catch (error: any) {
    logger.error("❌ Error handling payment failure", error);
  }
}

// ============================================================================
// HANDLER: Subscription Deleted/Cancelled
// ============================================================================

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  try {
    const metadata = subscription.metadata || ({} as Record<string, string>);

    // Get the recurring donation record for total calculation
    const recurringDoc = await db.collection("recurringDonations").doc(subscription.id).get();
    const recurringData = recurringDoc.data();

    // Update recurring donation status
    await db.collection("recurringDonations").doc(subscription.id).update({
      status: "cancelled",
      cancelled_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    logger.info("Recurring donation cancelled", {
      subscriptionId: subscription.id,
    });

    // Send cancellation email if we have donor email
    const donorEmail = metadata.donor_email || recurringData?.donor_email;
    if (donorEmail) {
      // Calculate total donated (sum of all donations for this subscription)
      const donationsSnapshot = await db
        .collection("donations")
        .where("stripe_subscription_id", "==", subscription.id)
        .where("payment_status", "==", "succeeded")
        .get();

      let totalDonated = 0;
      donationsSnapshot.forEach((doc) => {
        totalDonated += doc.data().amount || 0;
      });

      const emailData = await subscriptionCancelledEmail({
        donorName: metadata.donor_name || recurringData?.donor_name || "Donor",
        amount: subscription.items.data[0]?.price?.unit_amount || recurringData?.amount || 0,
        currency: subscription.currency || "aud",
        frequency: metadata.frequency || recurringData?.frequency || "monthly",
        donationType: metadata.donation_type_label || recurringData?.donation_type_label || "General Donation",
        totalDonated: totalDonated > 0 ? totalDonated : undefined,
        startDate: recurringData?.created_at?.toDate?.()?.toLocaleDateString("en-AU"),
      });

      await sendEmail({
        to: donorEmail,
        subject: emailData.subject,
        html: emailData.html,
      });

      logger.info("✅ Subscription cancelled email sent", {
        subscriptionId: subscription.id,
        email: donorEmail,
      });
    }
  } catch (error) {
    logger.error("Error handling subscription deleted", error);
    throw error;
  }
}

// ============================================================================
// HANDLER: Subscription Updated (Amount/Frequency/Payment Method Changed)
// ============================================================================

async function handleSubscriptionUpdated(
  subscription: Stripe.Subscription,
  stripe: Stripe
) {
  try {
    const metadata = subscription.metadata || ({} as Record<string, string>);

    logger.info("🔄 Processing subscription.updated", {
      subscriptionId: subscription.id,
    });

    // Get current recurring donation record
    const recurringRef = db.collection("recurringDonations").doc(subscription.id);
    const recurringDoc = await recurringRef.get();

    if (!recurringDoc.exists) {
      logger.warn("Subscription not found in recurringDonations", {
        subscriptionId: subscription.id,
      });
      return;
    }

    const currentData = recurringDoc.data();
    const newAmount = subscription.items.data[0].price.unit_amount || 0;
    const newFrequency = metadata.frequency || "monthly";

    // Detect what changed
    const amountChanged = currentData?.amount !== newAmount;
    const frequencyChanged = currentData?.frequency !== newFrequency;
    const statusChanged = currentData?.status !== subscription.status;

    if (!amountChanged && !frequencyChanged && !statusChanged) {
      logger.info("⏭️ SKIP: No meaningful subscription changes", {
        subscriptionId: subscription.id,
      });
      return;
    }

    // Update Firestore
    await recurringRef.update({
      amount: newAmount,
      currency: (subscription.currency || "aud").toUpperCase(),
      frequency: newFrequency,
      status: subscription.status,
      next_payment_date: await calculateNextPaymentDate(newFrequency),
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    logger.info("✅ Subscription updated in Firestore", {
      subscriptionId: subscription.id,
      amountChanged,
      frequencyChanged,
    });

    // Send confirmation email if meaningful change
    if ((amountChanged || frequencyChanged) && metadata.donor_email) {
      // NOTE: Portal sessions are no longer created here as URLs expire too quickly
      // Users should manage subscriptions through the app

      const changesList = [];
      if (amountChanged) {
        changesList.push(
          `Amount: $${(currentData?.amount / 100).toFixed(2)} → $${(newAmount / 100).toFixed(2)}`
        );
      }
      if (frequencyChanged) {
        changesList.push(
          `Frequency: ${currentData?.frequency} → ${newFrequency}`
        );
      }

      const nextPaymentDate = await calculateNextPaymentDate(newFrequency);

      // Use subscriptionUpdatedEmail template  
      const { getSubscriptionUpdatedEmail } = await import("./emails/index.js");
      const { render } = await import("@react-email/render");
      
      const emailTemplate = getSubscriptionUpdatedEmail({
        donorName: metadata.donor_name || "Donor",
        changes: changesList,
        nextPaymentDate,
        newAmount: amountChanged ? newAmount : undefined,
        newFrequency: frequencyChanged ? newFrequency : undefined,
      });

      const html = await render(emailTemplate.component);

      await sendEmail({
        to: metadata.donor_email,
        subject: emailTemplate.subject,
        html,
      });

      logger.info("✅ Subscription update email sent", {
        subscriptionId: subscription.id,
        email: metadata.donor_email,
      });
    }
  } catch (error) {
    logger.error("Error handling subscription updated", error);
    throw error;
  }
}

// ============================================================================
// HANDLER: Charge Refunded
// ============================================================================

async function handleChargeRefunded(charge: Stripe.Charge, stripe: Stripe) {
  try {
    logger.info("💰 Processing charge.refunded", {
      chargeId: charge.id,
      amount: charge.amount_refunded,
    });

    // Find the donation by payment intent or charge ID
    let donationQuery = await db
      .collection("donations")
      .where("stripe_payment_intent_id", "==", charge.payment_intent)
      .limit(1)
      .get();

    if (donationQuery.empty) {
      logger.warn("Donation not found for refunded charge", {
        chargeId: charge.id,
        paymentIntentId: charge.payment_intent,
      });
      return;
    }

    const donationDoc = donationQuery.docs[0];
    const donationData = donationDoc.data();

    // Update donation status
    await donationDoc.ref.update({
      payment_status: "refunded",
      refund_amount: charge.amount_refunded,
      refunded_at: admin.firestore.FieldValue.serverTimestamp(),
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    logger.info("✅ Donation marked as refunded", {
      donationId: donationDoc.id,
      amount: charge.amount_refunded,
    });

    // Reverse campaign total if applicable
    if (donationData.campaign_id && charge.amount_refunded) {
      await updateCampaignTotal(
        donationData.campaign_id,
        -charge.amount_refunded
      );
    }

    // Send refund confirmation email
    if (donationData.donor_email) {
      const emailData = await refundConfirmationEmail({
        donorName: donationData.donor_name || "Donor",
        amount: charge.amount_refunded,
        currency: charge.currency || "aud",
        receiptNumber: donationData.receipt_number,
        originalDate: donationData.date?.toString() || "N/A",
      });

      await sendEmail({
        to: donationData.donor_email,
        subject: emailData.subject,
        html: emailData.html,
      });

      logger.info("✅ Refund confirmation email sent", {
        donationId: donationDoc.id,
        email: donationData.donor_email,
      });
    }
  } catch (error) {
    logger.error("Error handling charge refunded", error);
    throw error;
  }
}

// ============================================================================
// HANDLER: Dispute Created
// ============================================================================

async function handleDisputeCreated(
  dispute: Stripe.Dispute,
  stripe: Stripe
) {
  try {
    logger.warn("⚠️ Dispute created", {
      disputeId: dispute.id,
      chargeId: dispute.charge,
      amount: dispute.amount,
      reason: dispute.reason,
    });

    // Find the donation by payment intent
    const chargeId =
      typeof dispute.charge === "string" ? dispute.charge : dispute.charge.id;
    const charge = await stripe.charges.retrieve(chargeId);

    const paymentIntentId = typeof charge.payment_intent === "string" 
      ? charge.payment_intent 
      : charge.payment_intent?.id || null;

    if (!paymentIntentId) {
      logger.error("No payment intent ID found on charge", { chargeId });
      return;
    }

    // Retry logic - donation might not be created yet (race condition with payment webhooks)
    let donationQuery: FirebaseFirestore.QuerySnapshot<FirebaseFirestore.DocumentData> | null = null;
    let attempts = 0;
    const maxAttempts = 3;
    
    while (attempts < maxAttempts) {
      donationQuery = await db
        .collection("donations")
        .where("stripe_payment_intent_id", "==", paymentIntentId)
        .limit(1)
        .get();

      if (!donationQuery.empty) {
        break;
      }

      attempts++;
      if (attempts < maxAttempts) {
        logger.info(`Donation not found, retrying... (attempt ${attempts}/${maxAttempts})`);
        await new Promise(resolve => setTimeout(resolve, 1000 * attempts)); // 1s, 2s backoff
      }
    }

    if (!donationQuery || donationQuery.empty) {
      logger.warn("Donation not found for disputed charge after retries", {
        chargeId,
        paymentIntentId,
        attempts: maxAttempts,
      });
      return;
    }

    const donationDoc = donationQuery.docs[0];
    const donationData = donationDoc.data();

    // Mark donation as disputed
    await donationDoc.ref.update({
      payment_status: "disputed",
      dispute_id: dispute.id,
      dispute_reason: dispute.reason,
      dispute_amount: dispute.amount,
      disputed_at: admin.firestore.FieldValue.serverTimestamp(),
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    logger.info("✅ Donation marked as disputed", {
      donationId: donationDoc.id,
      disputeId: dispute.id,
    });

    // Send urgent admin email notification
    const adminEmail = "donations@alansar.app"; // TODO: Use a dedicated admin email
    const disputeAmount = (dispute.amount / 100).toFixed(2);
    const disputeDueDate = dispute.evidence_details.due_by 
      ? new Date(dispute.evidence_details.due_by * 1000).toLocaleDateString("en-AU")
      : "Unknown";

    const disputeHtml = await disputeAlertEmail({
      disputeAmount,
      disputeDueDate,
      disputeReason: dispute.reason,
      donorEmail: donationData.donor_email || "N/A",
      donorName: donationData.donor_name,
      receiptNumber: donationData.receipt_number,
      disputeId: dispute.id,
    });

    await sendEmail({
      from: "Al Ansar Alerts <donations@alansar.app>",
      to: adminEmail,
      subject: `🚨 URGENT: Dispute Created - $${disputeAmount} AUD`,
      html: disputeHtml,
    });

    logger.info("✅ Admin dispute alert email sent", {
      disputeId: dispute.id,
      adminEmail,
    });

    // Log for monitoring
    logger.error("🚨 ADMIN ALERT: Dispute created", {
      disputeId: dispute.id,
      donationId: donationDoc.id,
      donor: donationData.donor_email,
      amount: dispute.amount,
      reason: dispute.reason,
      receiptNumber: donationData.receipt_number,
    });

    // Optional: Pause subscription if this was a recurring donation
    if (donationData.stripe_subscription_id) {
      logger.warn("⚠️ Subscription related to dispute - consider manual review", {
        subscriptionId: donationData.stripe_subscription_id,
        disputeId: dispute.id,
      });
      // Uncomment to auto-pause:
      // await stripe.subscriptions.update(donationData.stripe_subscription_id, {
      //   pause_collection: { behavior: 'mark_uncollectible' }
      // });
    }
  } catch (error) {
    logger.error("Error handling dispute created", error);
    throw error;
  }
}

// ============================================================================
// HELPER: Update Campaign Total
// ============================================================================

async function updateCampaignTotal(campaignId: string, amount: number) {
  try {
    const campaignRef = db.collection("campaigns").doc(campaignId);

    await db.runTransaction(async (transaction) => {
      const campaignDoc = await transaction.get(campaignRef);

      if (!campaignDoc.exists) {
        logger.warn("Campaign not found", { campaignId });
        return;
      }

      const currentAmount = campaignDoc.data()?.current_amount || 0;
      const newAmount = currentAmount + amount;

      transaction.update(campaignRef, {
        current_amount: newAmount,
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    logger.info("Campaign total updated", {
      campaignId,
      addedAmount: amount,
    });
  } catch (error) {
    logger.error("Error updating campaign total", error);
    // Don't throw - campaign update failure shouldn't fail the donation
  }
}
