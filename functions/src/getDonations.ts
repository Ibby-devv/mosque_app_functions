import { onCall } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";

const db = admin.firestore();

export const getUserDonations = onCall(
  {
    region: "australia-southeast1",
  },
  async (request) => {
    const { email } = request.data;

    if (!email) {
      throw new Error("Email is required");
    }

    const normalizedEmail = email.toLowerCase().trim();

    try {
      // Get one-time donations (exclude recurring donation payments)
      const donationsSnapshot = await db
        .collection("donations")
        .where("donor_email", "==", normalizedEmail)
        .where("is_recurring", "==", false)
        .orderBy("created_at", "desc")
        .get();

      const donations = donationsSnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      // Get recurring donations
      const subscriptionsSnapshot = await db
        .collection("recurringDonations")
        .where("donor_email", "==", normalizedEmail)
        .get();

      const subscriptions = subscriptionsSnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      logger.info("Donations retrieved", {
        email: normalizedEmail,
        donationsCount: donations.length,
        subscriptionsCount: subscriptions.length,
      });

      return {
        donations,
        subscriptions,
      };
    } catch (error: any) {
      logger.error("Error getting donations", error);
      throw new Error("Failed to retrieve donations");
    }
  }
);
