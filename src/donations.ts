// ============================================================================
// CLOUD FUNCTIONS: DONATION PROCESSING
// Location: mosque_app_functions/src/donations.ts
// ============================================================================

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import Stripe from "stripe";

// NOTE: Stripe is initialized lazily in each function to ensure secrets are available
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
    .join("-"); // Convert to YYYY-MM-DD
};

// ============================================================================
// FUNCTION 1: Create Payment Intent (One-Time Donation)
// ============================================================================

interface CreatePaymentIntentRequest {
  amount: number; // In cents
  donor_name: string;
  donor_email: string;
  donor_phone?: string;
  donation_type_id: string;
  donation_type_label: string;
  campaign_id?: string;
  donor_message?: string;
}

export const createPaymentIntent = onCall(
  {
    region: "australia-southeast1",
    cors: true,
    secrets: ["STRIPE_SECRET_KEY"], // Secret Manager
  },
  async (request) => {
    try {
      // Initialize Stripe with secret from Secret Manager
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
        apiVersion: "2023-10-16",
      });

      const data = request.data as CreatePaymentIntentRequest;

      // Validate minimum amount
      const settings = await db
        .collection("donationSettings")
        .doc("config")
        .get();
      const settingsData = settings.data();
      const minAmount = (settingsData?.minimum_amount || 5) * 100; // Convert to cents

      if (data.amount < minAmount) {
        throw new HttpsError(
          "invalid-argument",
          `Minimum donation is $${minAmount / 100}`
        );
      }

      // Create Stripe customer (for better tracking)
      const customer = await stripe.customers.create({
        name: data.donor_name,
        email: data.donor_email,
        phone: data.donor_phone,
        metadata: {
          donation_type: data.donation_type_label,
          campaign_id: data.campaign_id || "none",
        },
      });

      // Create payment intent
      const paymentIntent = await stripe.paymentIntents.create({
        amount: data.amount,
        currency: "aud",
        customer: customer.id,
        metadata: {
          donor_name: data.donor_name,
          donor_email: data.donor_email,
          donor_phone: data.donor_phone || "",
          donation_type_id: data.donation_type_id,
          donation_type_label: data.donation_type_label,
          campaign_id: data.campaign_id || "",
          donor_message: data.donor_message || "",
          is_recurring: "false",
        },
        description: `Donation to ${data.donation_type_label}`,
      });

      logger.info("Payment intent created", {
        paymentIntentId: paymentIntent.id,
        amount: data.amount,
        donor: data.donor_email,
      });

      return {
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
      };
    } catch (error: any) {
      logger.error("Error creating payment intent", error);
      throw new HttpsError("internal", error.message);
    }
  }
);

// ============================================================================
// FUNCTION 2: Create Subscription (Recurring Donation)
// ============================================================================

interface CreateSubscriptionRequest {
  amount: number; // In cents
  frequency: "weekly" | "fortnightly" | "monthly" | "yearly";
  donor_name: string;
  donor_email: string;
  donor_phone?: string;
  donation_type_id: string;
  donation_type_label: string;
  campaign_id?: string;
}

export const createSubscription = onCall(
  {
    region: "australia-southeast1",
    cors: true,
    secrets: ["STRIPE_SECRET_KEY"], // Secret Manager
  },
  async (request) => {
    try {
      // Initialize Stripe with secret from Secret Manager
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
        apiVersion: "2023-10-16",
      });

      const data = request.data as CreateSubscriptionRequest;

      // Validate minimum amount
      const settings = await db
        .collection("donationSettings")
        .doc("config")
        .get();
      const settingsData = settings.data();
      const minAmount = (settingsData?.minimum_amount || 5) * 100;

      if (data.amount < minAmount) {
        throw new HttpsError(
          "invalid-argument",
          `Minimum donation is $${minAmount / 100}`
        );
      }

      // Create Stripe customer
      const customer = await stripe.customers.create({
        name: data.donor_name,
        email: data.donor_email,
        phone: data.donor_phone,
        metadata: {
          donation_type: data.donation_type_label,
          campaign_id: data.campaign_id || "none",
        },
      });

      // Map frequency to Stripe interval
      const intervalMap: Record<
        string,
        { interval: Stripe.Price.Recurring.Interval; interval_count: number }
      > = {
        weekly: { interval: "week", interval_count: 1 },
        fortnightly: { interval: "week", interval_count: 2 },
        monthly: { interval: "month", interval_count: 1 },
        yearly: { interval: "year", interval_count: 1 },
      };

      const { interval, interval_count } = intervalMap[data.frequency];

      // Create price
      const price = await stripe.prices.create({
        currency: "aud",
        unit_amount: data.amount,
        recurring: {
          interval,
          interval_count,
        },
        product_data: {
          name: `Recurring Donation - ${data.donation_type_label}`,
        },
      });

      // Create subscription
      const subscription = await stripe.subscriptions.create({
        customer: customer.id,
        items: [{ price: price.id }],
        payment_behavior: "default_incomplete",
        payment_settings: { save_default_payment_method: "on_subscription" },
        expand: ["latest_invoice.payment_intent"],
        metadata: {
          donor_name: data.donor_name,
          donor_email: data.donor_email,
          donor_phone: data.donor_phone || "",
          donation_type_id: data.donation_type_id,
          donation_type_label: data.donation_type_label,
          campaign_id: data.campaign_id || "",
          frequency: data.frequency,
          is_recurring: "true",
        },
      });

      // Get client secret from payment intent
      const invoice = subscription.latest_invoice as Stripe.Invoice;
      const paymentIntent = invoice.payment_intent as Stripe.PaymentIntent;

      logger.info("Subscription created", {
        subscriptionId: subscription.id,
        amount: data.amount,
        frequency: data.frequency,
        donor: data.donor_email,
      });

      return {
        clientSecret: paymentIntent.client_secret,
        subscriptionId: subscription.id,
        customerId: customer.id,
      };
    } catch (error: any) {
      logger.error("Error creating subscription", error);
      throw new HttpsError("internal", error.message);
    }
  }
);

// ============================================================================
// FUNCTION 3: Cancel Subscription
// ============================================================================

export const cancelSubscription = onCall(
  {
    region: "australia-southeast1",
    secrets: ["STRIPE_SECRET_KEY"], // Secret Manager
  },
  async (request) => {
    // Verify authenticated user (admin or donor)
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }

    try {
      // Initialize Stripe with secret from Secret Manager
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
        apiVersion: "2023-10-16",
      });

      const { subscriptionId } = request.data;

      if (!subscriptionId) {
        throw new HttpsError("invalid-argument", "Subscription ID is required");
      }

      // Cancel subscription in Stripe
      const subscription = await stripe.subscriptions.cancel(subscriptionId);

      // Update Firestore record
      const recurringRef = db
        .collection("recurringDonations")
        .doc(subscriptionId);
      await recurringRef.update({
        status: "cancelled",
        cancelled_at: admin.firestore.FieldValue.serverTimestamp(),
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      });

      logger.info("Subscription cancelled", { subscriptionId });

      return {
        success: true,
        subscriptionId: subscription.id,
      };
    } catch (error: any) {
      logger.error("Error cancelling subscription", error);
      throw new HttpsError("internal", error.message);
    }
  }
);

// ============================================================================
// FUNCTION 4: Generate Receipt Number
// ============================================================================

export const generateReceiptNumber = async (): Promise<string> => {
  const counterRef = db.collection("receiptCounter").doc("current");
  const sydneyDate = getSydneyDate();
  const currentYear = parseInt(sydneyDate.split("-")[0]);

  try {
    return await db.runTransaction(async (transaction) => {
      const counterDoc = await transaction.get(counterRef);

      let lastNumber = 0;
      let lastYear = currentYear;

      if (counterDoc.exists) {
        const data = counterDoc.data();
        lastNumber = data?.last_number || 0;
        lastYear = data?.year || currentYear;
      }

      // Reset counter if new year
      if (lastYear !== currentYear) {
        lastNumber = 0;
      }

      const newNumber = lastNumber + 1;
      const receiptNumber = `RCP-${currentYear}-${newNumber
        .toString()
        .padStart(5, "0")}`;

      // Update counter
      transaction.set(counterRef, {
        year: currentYear,
        last_number: newNumber,
        last_updated: sydneyDate,
      });

      return receiptNumber;
    });
  } catch (error) {
    logger.error("Error generating receipt number", error);
    throw new Error("Failed to generate receipt number");
  }
};

// ============================================================================
// FUNCTION 5: Get Donation Settings (for mobile app)
// ============================================================================

export const getDonationSettings = onCall(
  {
    region: "australia-southeast1",
  },
  async () => {
    try {
      const settingsDoc = await db
        .collection("donationSettings")
        .doc("config")
        .get();

      if (!settingsDoc.exists) {
        throw new HttpsError("not-found", "Donation settings not found");
      }

      return settingsDoc.data();
    } catch (error: any) {
      logger.error("Error getting donation settings", error);
      throw new HttpsError("internal", error.message);
    }
  }
);
