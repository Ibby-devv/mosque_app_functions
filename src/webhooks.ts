// ============================================================================
// CLOUD FUNCTIONS: STRIPE WEBHOOK HANDLER
// Location: mosque_app_functions/src/webhooks.ts
// ============================================================================

import { onRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import Stripe from "stripe";
import { generateReceiptNumber } from "./donations";

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
    secrets: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"], // Secret Manager
  },
  async (req, res) => {
    // Initialize Stripe with secrets from Secret Manager
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

    logger.info("Webhook received", { type: event.type });

    try {
      switch (event.type) {
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

      res.json({ received: true });
    } catch (error: any) {
      logger.error("Error processing webhook", error);
      res.status(500).send("Webhook processing failed");
    }
  }
);

// ============================================================================
// HANDLER: Payment Intent Succeeded (One-Time Donation)
// ============================================================================

async function handlePaymentIntentSucceeded(
  paymentIntent: Stripe.PaymentIntent,
  stripe: Stripe
) {
  try {
    const metadata = paymentIntent.metadata;

    // ========== DEBUG LOGGING ==========
    logger.info("=== PAYMENT INTENT RECEIVED ===", {
      paymentIntentId: paymentIntent.id,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
    });

    logger.info("Payment Intent Invoice Field", {
      invoice: paymentIntent.invoice,
      invoiceType: typeof paymentIntent.invoice,
      invoiceIsNull: paymentIntent.invoice === null,
      invoiceIsUndefined: paymentIntent.invoice === undefined,
      invoiceIsFalsy: !paymentIntent.invoice,
    });

    logger.info("Payment Intent Metadata", {
      metadata: metadata,
      has_is_recurring: "is_recurring" in metadata,
      is_recurring_value: metadata.is_recurring,
      is_recurring_type: typeof metadata.is_recurring,
    });

    logger.info("Payment Intent Full Object Keys", {
      keys: Object.keys(paymentIntent).sort(),
    });
    // ========== END DEBUG LOGGING ==========

    // Check if this is part of a subscription (skip if yes)
    // Invoice can be null, undefined, or empty string for one-time payments
    // is_recurring is a string "true" or "false" from metadata
    const hasInvoice = paymentIntent.invoice && paymentIntent.invoice !== "";
    const isRecurring = metadata.is_recurring === "true";

    if (hasInvoice && isRecurring) {
      logger.info("❌ SKIPPING: Payment intent is part of subscription", {
        paymentIntentId: paymentIntent.id,
        invoice: paymentIntent.invoice,
        is_recurring: metadata.is_recurring,
      });
      return;
    }

    logger.info("✅ PROCESSING: One-time donation", {
      paymentIntentId: paymentIntent.id,
      hasInvoice,
      isRecurring,
    });

    // Generate receipt number
    const receiptNumber = await generateReceiptNumber();

    // Get payment method details
    const paymentMethod =
      paymentIntent.payment_method &&
      typeof paymentIntent.payment_method === "string"
        ? await stripe.paymentMethods.retrieve(paymentIntent.payment_method)
        : null;

    // Create donation record
    const donationRef = db.collection("donations").doc();
    await donationRef.set({
      id: donationRef.id,
      receipt_number: receiptNumber,

      // Donor info
      donor_name: metadata.donor_name || "Anonymous",
      donor_email: metadata.donor_email,
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
      donation_type_id: metadata.donation_type_id,
      donation_type_label: metadata.donation_type_label,
      campaign_id: metadata.campaign_id || null,
      is_recurring: false,

      // Metadata
      donor_message: metadata.donor_message || null,

      // Timestamps
      date: getSydneyDate(),
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      completed_at: admin.firestore.FieldValue.serverTimestamp(),
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Update campaign total if applicable
    if (metadata.campaign_id) {
      await updateCampaignTotal(metadata.campaign_id, paymentIntent.amount);
    }

    logger.info("One-time donation recorded", {
      donationId: donationRef.id,
      receiptNumber,
      amount: paymentIntent.amount,
    });
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
    const metadata = subscription.metadata;

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
        donor_name: metadata.donor_name,
        donor_email: metadata.donor_email,

        // Subscription details
        amount: subscription.items.data[0].price.unit_amount || 0,
        currency: subscription.currency.toUpperCase(),
        frequency: metadata.frequency,

        // Status
        status: "active",
        next_payment_date: calculateNextPaymentDate(metadata.frequency),

        // Donation details
        donation_type_id: metadata.donation_type_id,
        donation_type_label: metadata.donation_type_label,
        campaign_id: metadata.campaign_id || null,

        // Timestamps
        created_at: admin.firestore.FieldValue.serverTimestamp(),
        started_at: admin.firestore.FieldValue.serverTimestamp(),
      });

    logger.info("Recurring donation created", {
      subscriptionId: subscription.id,
      frequency: metadata.frequency,
      amount: subscription.items.data[0].price.unit_amount,
    });
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
    // Only process if this is a subscription invoice
    if (!invoice.subscription || typeof invoice.subscription !== "string") {
      return;
    }

    const subscription = await stripe.subscriptions.retrieve(
      invoice.subscription
    );
    const metadata = subscription.metadata;

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
      donor_name: metadata.donor_name,
      donor_email: metadata.donor_email,
      donor_phone: metadata.donor_phone || null,

      // Payment info
      amount: invoice.amount_paid,
      currency: invoice.currency.toUpperCase(),

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
      donation_type_id: metadata.donation_type_id,
      donation_type_label: metadata.donation_type_label,
      campaign_id: metadata.campaign_id || null,
      is_recurring: true,
      recurring_frequency: metadata.frequency,

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
        next_payment_date: calculateNextPaymentDate(metadata.frequency),
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
  } catch (error) {
    logger.error("Error handling invoice payment succeeded", error);
    throw error;
  }
}

// ============================================================================
// HANDLER: Invoice Payment Failed
// ============================================================================

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  logger.warn("Invoice payment failed", {
    invoiceId: invoice.id,
    subscriptionId: invoice.subscription,
    amount: invoice.amount_due,
  });

  // Stripe will automatically retry failed payments
  // Optionally: Send notification to admin or donor
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
