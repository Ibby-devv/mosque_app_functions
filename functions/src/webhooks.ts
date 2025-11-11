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
  sendEmail,
} from "./utils/emailTemplates";

const db = admin.firestore();

// Sydney timezone helper
const getSydneyDate = (): string => {
  return new Date()
    .toLocaleDateString("en-AU", {
      timeZone: "Australia/Sydney",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
    .split("/")
    .reverse()
    .join("-");
};

// Calculate next payment date based on frequency
const calculateNextPaymentDate = (frequency: string): string => {
  const now = new Date();
  const sydneyTime = new Date(
    now.toLocaleString("en-US", { timeZone: "Australia/Sydney" })
  );

  switch (frequency) {
    case "weekly":
      sydneyTime.setDate(sydneyTime.getDate() + 7);
      break;
    case "fortnightly":
      sydneyTime.setDate(sydneyTime.getDate() + 14);
      break;
    case "monthly":
      sydneyTime.setMonth(sydneyTime.getMonth() + 1);
      break;
    case "yearly":
      sydneyTime.setFullYear(sydneyTime.getFullYear() + 1);
      break;
  }

  return sydneyTime.toISOString().split("T")[0]; // YYYY-MM-DD
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
      "invoice.payment_succeeded",
      "invoice.payment_failed",
      "customer.subscription.deleted",
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
      date: getSydneyDate(),
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

      const emailData = oneTimeDonationReceipt({
        donorName: customerName,
        amount: session.amount_total || 0,
        currency: session.currency || "aud",
        receiptNumber,
        date: getSydneyDate(),
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
    const nextPaymentDate = calculateNextPaymentDate(metadata.frequency);

    // Subscription record is created by customer.subscription.created event
    // Here we just send the welcome email

    logger.info("📧 Sending recurring donation welcome email", {
      email: customerEmail,
      subscriptionId,
    });

    if (customerEmail) {
      // Create portal session for management
      const portalSession = await stripe.billingPortal.sessions.create({
        customer:
          typeof subscription.customer === "string"
            ? subscription.customer
            : subscription.customer.id,
        return_url: "alansar://donations",
      });

      const emailData = recurringDonationWelcome({
        donorName: customerName,
        amount: subscription.items.data[0].price.unit_amount || 0,
        currency: subscription.currency || "aud",
        frequency: metadata.frequency || "monthly",
        donationType: metadata.donation_type_label || "General Donation",
        campaignName: metadata.campaign_name,
        nextPaymentDate,
        manageUrl: portalSession.url,
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
      date: getSydneyDate(),
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

      const emailData = oneTimeDonationReceipt({
        donorName,
        amount: paymentIntent.amount,
        currency: paymentIntent.currency,
        receiptNumber,
        date: getSydneyDate(),
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
        next_payment_date: calculateNextPaymentDate(
          metadata.frequency || "monthly"
        ),

        // Donation details
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
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
        apiVersion: "2023-10-16",
      });

      const customerId =
        typeof subscription.customer === "string"
          ? subscription.customer
          : subscription.customer.id;

      // Create portal session for management
      const portalSession = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: "alansar://donations",
      });

      // Compute next payment date based on frequency
      const nextPaymentDate = calculateNextPaymentDate(
        metadata.frequency || "monthly"
      );

      if (metadata.donor_email) {
        const emailData = recurringDonationWelcome({
          donorName: metadata.donor_name || "Anonymous",
          amount: subscription.items.data[0].price.unit_amount || 0,
          currency: subscription.currency || "aud",
          frequency: metadata.frequency || "monthly",
          donationType: metadata.donation_type_label || "General Donation",
          campaignName: undefined,
          nextPaymentDate,
          manageUrl: portalSession.url,
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

      // Status
      payment_status: "succeeded",

      // Donation details
  donation_type_id: metadata.donation_type_id || null,
  donation_type_label: metadata.donation_type_label || "General Donation",
  campaign_id: metadata.campaign_id || null,
  is_recurring: true,
  recurring_frequency: metadata.frequency || "monthly",

      // Timestamps
      date: getSydneyDate(),
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
        next_payment_date: calculateNextPaymentDate(
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
    });

    // Send recurring receipt email
    try {
      const customerId =
        typeof subscription.customer === "string"
          ? subscription.customer
          : subscription.customer.id;

      const portalSession = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: "alansar://donations",
      });

      const nextPaymentDate = calculateNextPaymentDate(
        metadata.frequency || "monthly"
      );

      if (metadata.donor_email) {
        const emailData = monthlyRecurringReceipt({
          donorName: metadata.donor_name || "Anonymous",
          amount: invoice.amount_paid,
          currency: invoice.currency || "aud",
          receiptNumber,
          date: getSydneyDate(),
          frequency: metadata.frequency || "monthly",
          donationType: metadata.donation_type_label || "General Donation",
          campaignName: undefined,
          nextPaymentDate,
          manageUrl: portalSession.url,
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
  } catch (error) {
    logger.error("Error handling invoice payment succeeded", error);
    throw error;
  }
}

// ============================================================================
// HANDLER: Invoice Payment Failed
// ============================================================================

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  logger.warn("⚠️ Payment failed", {
    invoiceId: invoice.id,
    customerId: invoice.customer,
    amount: invoice.amount_due,
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

    // Create portal session for payment update
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: invoice.customer as string,
      return_url: "alansar://donations",
    });

    // Send failure notification email
    const { Resend } = await import("resend");
    const resend = new Resend(process.env.RESEND_API_KEY);

    await resend.emails.send({
      from: "Al Ansar <onboarding@resend.dev>",
      to: customerEmail,
      subject: "Payment Failed - Action Required",
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
                      <td style="background-color: #dc2626; padding: 30px; text-align: center;">
                        <h1 style="color: #ffffff; margin: 0; font-size: 28px;">⚠️ Payment Failed</h1>
                      </td>
                    </tr>
                    
                    <tr>
                      <td style="padding: 40px 30px;">
                        <h2 style="color: #1f2937; margin: 0 0 20px 0;">Action Required</h2>
                        <p style="color: #4b5563; font-size: 16px; line-height: 1.6; margin: 0 0 15px 0;">Assalamu Alaikum,</p>
                        <p style="color: #4b5563; font-size: 16px; line-height: 1.6; margin: 0 0 25px 0;">
                          We were unable to process your recurring donation payment of <strong>$${(
                            invoice.amount_due / 100
                          ).toFixed(2)}</strong>.
                        </p>
                        <p style="color: #4b5563; font-size: 16px; line-height: 1.6; margin: 0 0 25px 0;">
                          This usually happens when a card expires or has insufficient funds. Please update your payment method to continue your recurring donation.
                        </p>
                        
                        <table width="100%" cellpadding="0" cellspacing="0">
                          <tr>
                            <td align="center" style="padding: 20px 0;">
                              <a href="${portalSession.url}" 
                                 style="display: inline-block; 
                                        background-color: #1e3a8a; 
                                        color: #ffffff; 
                                        text-decoration: none; 
                                        padding: 16px 40px; 
                                        border-radius: 8px; 
                                        font-size: 18px; 
                                        font-weight: bold;">
                                Update Payment Method
                              </a>
                            </td>
                          </tr>
                        </table>
                        
                        <p style="color: #4b5563; font-size: 14px; line-height: 1.6; margin: 25px 0 0 0;">
                          If you have any questions or need assistance, please don't hesitate to contact us.
                        </p>
                        <p style="color: #4b5563; font-size: 16px; line-height: 1.6; margin: 15px 0 0 0;">JazakAllah Khair for your continued support!</p>
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

    logger.info("✅ Payment failure email sent", {
      email: customerEmail,
      invoiceId: invoice.id,
    });

    // Update Firestore subscription status
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
      });
      logger.info("📝 Updated subscription status to past_due");
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
    // Update recurring donation status
    await db.collection("recurringDonations").doc(subscription.id).update({
      status: "cancelled",
      cancelled_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    logger.info("Recurring donation cancelled", {
      subscriptionId: subscription.id,
    });
  } catch (error) {
    logger.error("Error handling subscription deleted", error);
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
