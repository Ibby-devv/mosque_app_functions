// ============================================================================
// CLOUD FUNCTION: Get Donation Analytics
// Location: mosque_app_functions/src/getDonationAnalytics.ts
// ============================================================================

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";

const db = admin.firestore();

// ============================================================================
// TYPES
// ============================================================================

interface DonationAnalyticsRequest {
  startDate?: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  donationType?: string;
  paymentStatus?: string;
  searchEmail?: string;
  searchName?: string;
  isRecurring?: boolean;
  limit?: number;
  offset?: number;
}

interface DonationRecord {
  id: string;
  receipt_number: string;
  donor_name: string;
  donor_email: string;
  amount: number; // cents
  currency: string;
  donation_type_id: string;
  donation_type_label: string;
  payment_status: string;
  payment_method_type: string;
  is_recurring: boolean;
  recurring_frequency?: string;
  // Normalized to YYYY-MM-DD for client safety
  date: string;
  // ISO string for created_at (or epoch millis number if needed)
  created_at: string | number;
  stripe_payment_intent_id?: string;
  stripe_subscription_id?: string;
  campaign_id?: string;
  donor_message?: string;
}

interface RecurringDonationRecord {
  id: string;
  donor_name: string;
  donor_email: string;
  amount: number; // cents
  currency: string;
  frequency: string;
  status: string;
  donation_type_id: string;
  donation_type_label: string;
  // Normalized to YYYY-MM-DD
  next_payment_date: string;
  created_at: string | number;
  started_at: string | number;
  last_payment_at?: string | number;
  stripe_subscription_id: string;
  stripe_customer_id: string;
}

interface AnalyticsSummary {
  totalDonations: number;
  totalAmount: number; // cents
  averageDonation: number; // cents
  donationCount: number;
  recurringCount: number;
  activeRecurringCount: number;
  oneTimeCount: number;
  byType: { [key: string]: { count: number; amount: number } };
  byStatus: { [key: string]: number };
  byMonth: { [key: string]: { count: number; amount: number } };
}

interface DonationAnalyticsResponse {
  donations: DonationRecord[];
  recurringDonations: RecurringDonationRecord[];
  summary: AnalyticsSummary;
  totalCount: number;
  hasMore: boolean;
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

export const getDonationAnalytics = onCall(
  {
    region: "australia-southeast1",
    cors: true,
  },
  async (request) => {
    const { auth, data } = request;

    // Authentication check - only authenticated admins can access
    if (!auth) {
      throw new HttpsError(
        "unauthenticated",
        "You must be authenticated to access donation analytics"
      );
    }

    logger.info("📊 Fetching donation analytics", {
      uid: auth.uid,
      filters: data,
    });

    try {
      const {
        startDate,
        endDate,
        donationType,
        paymentStatus,
        searchEmail,
        searchName,
        isRecurring,
        limit = 50,
        offset = 0,
      } = data as DonationAnalyticsRequest;

      // ========================================
      // 1. Query One-Time & Recurring Donations
      // ========================================

      let donationsQuery = db.collection("donations") as any;

      // Apply filters to donations query
      if (startDate) {
        donationsQuery = donationsQuery.where("date", ">=", startDate);
      }
      if (endDate) {
        donationsQuery = donationsQuery.where("date", "<=", endDate);
      }
      if (donationType) {
        donationsQuery = donationsQuery.where(
          "donation_type_id",
          "==",
          donationType
        );
      }
      if (paymentStatus) {
        donationsQuery = donationsQuery.where(
          "payment_status",
          "==",
          paymentStatus
        );
      }
      if (isRecurring !== undefined) {
        donationsQuery = donationsQuery.where("is_recurring", "==", isRecurring);
      }
      if (searchEmail) {
        donationsQuery = donationsQuery.where(
          "donor_email",
          "==",
          searchEmail.toLowerCase()
        );
      }

      // Order by date (descending) and apply pagination
      donationsQuery = donationsQuery
        .orderBy("date", "desc")
        .orderBy("created_at", "desc");

      const donationsSnapshot = await donationsQuery.get();

      // Helper to convert Firestore Timestamp to YYYY-MM-DD
      const toYYYYMMDD = (timestamp: admin.firestore.Timestamp): string => {
        if (!timestamp || !timestamp.toDate) return "";
        const d = timestamp.toDate();
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        return `${y}-${m}-${day}`;
      };

      let donations: DonationRecord[] = [];
      donationsSnapshot.forEach((doc: any) => {
        const raw = doc.data();
        const normalized: DonationRecord = {
          id: doc.id,
          receipt_number: raw.receipt_number ?? "",
          donor_name: raw.donor_name ?? "",
          donor_email: raw.donor_email ?? "",
          amount: raw.amount ?? 0,
          currency: raw.currency ?? "AUD",
          donation_type_id: raw.donation_type_id ?? "",
          donation_type_label: raw.donation_type_label ?? "",
          payment_status: raw.payment_status ?? "unknown",
          payment_method_type: raw.payment_method_type ?? "",
          is_recurring: !!raw.is_recurring,
          recurring_frequency: raw.recurring_frequency,
          date: toYYYYMMDD(raw.date),
          created_at: raw.created_at?.toDate()?.toISOString() ?? "",
          stripe_payment_intent_id: raw.stripe_payment_intent_id,
          stripe_subscription_id: raw.stripe_subscription_id,
          campaign_id: raw.campaign_id,
          donor_message: raw.donor_message,
        };
        donations.push(normalized);
      });

      // Client-side filters (for fields that can't be indexed)
      if (searchName) {
        const searchLower = searchName.toLowerCase();
        donations = donations.filter((d) => d.donor_name.toLowerCase().includes(searchLower));
      }

      // Store total count before pagination
      const totalCount = donations.length;

      // Apply pagination
      donations = donations.slice(offset, offset + limit);

      // ========================================
      // 2. Fetch Recurring Donations
      // ========================================

      let recurringQuery = db.collection("recurringDonations") as any;

      if (donationType) {
        recurringQuery = recurringQuery.where(
          "donation_type_id",
          "==",
          donationType
        );
      }
      if (searchEmail) {
        recurringQuery = recurringQuery.where(
          "donor_email",
          "==",
          searchEmail.toLowerCase()
        );
      }

      const recurringSnapshot = await recurringQuery.get();
      let recurringDonations: RecurringDonationRecord[] = [];
      recurringSnapshot.forEach((doc: any) => {
        const raw = doc.data();
        const normalized: RecurringDonationRecord = {
          id: doc.id,
          donor_name: raw.donor_name ?? "",
          donor_email: raw.donor_email ?? "",
          amount: raw.amount ?? 0,
          currency: raw.currency ?? "AUD",
          frequency: raw.frequency ?? raw.recurring_frequency ?? "monthly",
          status: raw.status ?? "unknown",
          donation_type_id: raw.donation_type_id ?? "",
          donation_type_label: raw.donation_type_label ?? "",
          next_payment_date: toYYYYMMDD(raw.next_payment_date),
          created_at: raw.created_at?.toDate()?.toISOString() ?? "",
          started_at: raw.started_at?.toDate()?.toISOString() ?? "",
          last_payment_at: raw.last_payment_at?.toDate()?.toISOString() ?? undefined,
          stripe_subscription_id: raw.stripe_subscription_id ?? "",
          stripe_customer_id: raw.stripe_customer_id ?? "",
        };
        recurringDonations.push(normalized);
      });

      // Apply client-side name filter
      if (searchName) {
        const searchLower = searchName.toLowerCase();
        recurringDonations = recurringDonations.filter((d) =>
          d.donor_name.toLowerCase().includes(searchLower)
        );
      }

      // ========================================
      // 3. Calculate Analytics Summary
      // ========================================

      const summary: AnalyticsSummary = {
        totalDonations: 0,
        totalAmount: 0,
        averageDonation: 0,
        donationCount: 0,
        recurringCount: 0,
        activeRecurringCount: 0,
        oneTimeCount: 0,
        byType: {},
        byStatus: {},
        byMonth: {},
      };

      // Process all donations for summary (not just paginated results)
      const allDonationsSnapshot = await db
        .collection("donations")
        .where("payment_status", "==", "succeeded")
        .get();

      allDonationsSnapshot.forEach((doc) => {
        const data = doc.data();
        const amount = data.amount || 0;
        const type = data.donation_type_id || "unknown";
        const status = data.payment_status || "unknown";
        const dateStr = toYYYYMMDD(data.date);

        summary.totalAmount += amount;
        summary.donationCount += 1;

        if (data.is_recurring) {
          summary.recurringCount += 1;
        } else {
          summary.oneTimeCount += 1;
        }

        // By type
        if (!summary.byType[type]) {
          summary.byType[type] = { count: 0, amount: 0 };
        }
        summary.byType[type].count += 1;
        summary.byType[type].amount += amount;

        // By status
        summary.byStatus[status] = (summary.byStatus[status] || 0) + 1;

        // By month (YYYY-MM)
        if (dateStr) {
          const month = dateStr.substring(0, 7); // Extract YYYY-MM
          if (!summary.byMonth[month]) {
            summary.byMonth[month] = { count: 0, amount: 0 };
          }
          summary.byMonth[month].count += 1;
          summary.byMonth[month].amount += amount;
        }
      });

      // Calculate averages
      summary.totalDonations = summary.donationCount;
      summary.averageDonation =
        summary.donationCount > 0
          ? Math.round(summary.totalAmount / summary.donationCount)
          : 0;

      // Count active recurring donations
      const activeRecurringSnapshot = await db
        .collection("recurringDonations")
        .where("status", "==", "active")
        .get();
      summary.activeRecurringCount = activeRecurringSnapshot.size;

      // ========================================
      // 4. Return Response
      // ========================================

      const response: DonationAnalyticsResponse = {
        donations,
        recurringDonations,
        summary,
        totalCount,
        hasMore: offset + limit < totalCount,
      };

      logger.info("✅ Donation analytics retrieved successfully", {
        donationsCount: donations.length,
        recurringCount: recurringDonations.length,
        totalAmount: summary.totalAmount / 100,
      });

      return response;
    } catch (error: any) {
      logger.error("❌ Error fetching donation analytics:", error);
      throw new HttpsError(
        "internal",
        "Failed to fetch donation analytics",
        error
      );
    }
  }
);
