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

// ============================================================================
// HELPER: Check if Donation is Anonymous
// ============================================================================

/**
 * Determines if a donation should be treated as anonymous based on donor information.
 * A donation is anonymous if:
 * - No email provided (empty/null/undefined)
 * - Email is the placeholder "anonymous@donation.com"
 * - Name is exactly "Anonymous" (case-insensitive)
 * 
 * @param donorEmail - The donor's email address
 * @param donorName - The donor's name
 * @returns true if donation should be treated as anonymous
 */
function isAnonymousDonation(donorEmail: string | null | undefined, donorName: string): boolean {
  // No email provided
  if (!donorEmail || donorEmail.trim() === "") {
    return true;
  }
  
  // Placeholder anonymous email
  if (donorEmail.toLowerCase() === "anonymous@donation.com") {
    return true;
  }
  
  // Name is "Anonymous"
  if (donorName.trim().toLowerCase() === "anonymous") {
    return true;
  }
  
  return false;
}

// ============================================================================
// HELPER: Get or Create Shared Anonymous Customer
// ============================================================================

/**
 * Gets or creates a shared anonymous customer to avoid duplicate anonymous customers in Stripe.
 * Stores the customer ID in Firestore for reuse across all anonymous donations.
 */
async function getOrCreateAnonymousCustomer(
  stripe: Stripe
): Promise<string> {
  const anonymousCustomerRef = db.collection("settings").doc("stripe");

  try {
    const doc = await anonymousCustomerRef.get();

    // Check if anonymous customer already exists
    if (doc.exists && doc.data()?.anonymousCustomerId) {
      const customerId = doc.data()!.anonymousCustomerId;

      // Verify customer still exists in Stripe
      try {
        await stripe.customers.retrieve(customerId);
        logger.info("Reusing existing anonymous customer", { customerId });
        return customerId;
      } catch (error) {
        logger.warn(
          "Anonymous customer not found in Stripe, creating new one",
          { customerId }
        );
      }
    }

    // Create new anonymous customer
    const customer = await stripe.customers.create({
      description: "Anonymous Donor (Shared)",
      metadata: {
        type: "anonymous",
        created_by: "system",
      },
    });

    // Store for future use
    await anonymousCustomerRef.set(
      {
        anonymousCustomerId: customer.id,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    logger.info("Created new shared anonymous customer", {
      customerId: customer.id,
    });

    return customer.id;
  } catch (error) {
    logger.error("Error managing anonymous customer", error);
    throw new HttpsError(
      "internal",
      "Failed to create anonymous customer"
    );
  }
}

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
      const minAmount = (settingsData?.minimum_amount ?? 1) * 100; // Convert to cents, default 1 if not set

      if (data.amount < minAmount) {
        throw new HttpsError(
          "invalid-argument",
          `Minimum donation is $${(minAmount / 100).toFixed(2)}`
        );
      }

      // Determine if donation is anonymous using robust helper
      const isAnonymous = isAnonymousDonation(data.donor_email, data.donor_name);

      let customerId: string;

      if (isAnonymous) {
        // Reuse shared anonymous customer
        customerId = await getOrCreateAnonymousCustomer(stripe);
        logger.info("Using shared anonymous customer for one-time donation");
      } else {
        // Create or find customer for non-anonymous donations
        const existingCustomers = await stripe.customers.list({
          email: data.donor_email,
          limit: 1,
        });

        if (existingCustomers.data.length > 0) {
          customerId = existingCustomers.data[0].id;
          logger.info("Using existing customer", { customerId });
        } else {
          const customer = await stripe.customers.create({
            name: data.donor_name,
            email: data.donor_email,
            phone: data.donor_phone,
            metadata: {
              donation_type: data.donation_type_label,
              campaign_id: data.campaign_id || "none",
            },
          });
          customerId = customer.id;
          logger.info("Created new customer", { customerId });
        }
      }

      // Create payment intent
      const paymentIntent = await stripe.paymentIntents.create({
        amount: data.amount,
        currency: "aud",
        customer: customerId,
        metadata: {
          donor_name: data.donor_name,
          donor_email: data.donor_email || "anonymous",
          donor_phone: data.donor_phone || "",
          donation_type_id: data.donation_type_id,
          donation_type_label: data.donation_type_label,
          campaign_id: data.campaign_id || "",
          donor_message: data.donor_message || "",
          is_recurring: "false",
          is_anonymous: isAnonymous.toString(),
        },
        description: `Donation to ${data.donation_type_label}`,
        receipt_email: isAnonymous ? undefined : data.donor_email,
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
      const minAmount = (settingsData?.minimum_amount ?? 1) * 100; // Convert to cents, default 1 if not set

      if (data.amount < minAmount) {
        throw new HttpsError(
          "invalid-argument",
          `Minimum donation is $${(minAmount / 100).toFixed(2)}`
        );
      }

      // Determine if donation is anonymous using robust helper
      const isAnonymous = isAnonymousDonation(data.donor_email, data.donor_name);

      // Note: For recurring donations, we strongly encourage non-anonymous
      // to allow donors to manage subscriptions, but we still support it
      let customerId: string;

      if (isAnonymous) {
        // Reuse shared anonymous customer
        customerId = await getOrCreateAnonymousCustomer(stripe);
        logger.warn(
          "Creating anonymous recurring donation - donor cannot manage subscription"
        );
      } else {
        // Create or find customer for non-anonymous donations
        const existingCustomers = await stripe.customers.list({
          email: data.donor_email,
          limit: 1,
        });

        if (existingCustomers.data.length > 0) {
          customerId = existingCustomers.data[0].id;
          logger.info("Using existing customer for subscription", {
            customerId,
          });
        } else {
          const customer = await stripe.customers.create({
            name: data.donor_name,
            email: data.donor_email,
            phone: data.donor_phone,
            metadata: {
              donation_type: data.donation_type_label,
              campaign_id: data.campaign_id || "none",
            },
          });
          customerId = customer.id;
          logger.info("Created new customer for subscription", {
            customerId,
          });
        }
      }

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
        customer: customerId,
        items: [{ price: price.id }],
        payment_behavior: "default_incomplete",
        payment_settings: { save_default_payment_method: "on_subscription" },
        expand: ["latest_invoice.payment_intent"],
        metadata: {
          donor_name: data.donor_name,
          donor_email: data.donor_email || "anonymous",
          donor_phone: data.donor_phone || "",
          donation_type_id: data.donation_type_id,
          donation_type_label: data.donation_type_label,
          campaign_id: data.campaign_id || "",
          frequency: data.frequency,
          is_recurring: "true",
          is_anonymous: isAnonymous.toString(),
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
        customerId: customerId,
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
  const now = new Date();
  const sydneyDate = now
    .toLocaleDateString("en-AU", {
      timeZone: "Australia/Sydney",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
    .split("/")
    .reverse()
    .join("-"); // Convert DD/MM/YYYY to YYYY-MM-DD for year extraction
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
        last_updated: admin.firestore.FieldValue.serverTimestamp(),
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
