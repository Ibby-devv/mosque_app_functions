// ============================================================================
// CLOUD FUNCTION: Send Notification on Campaign Created
// Location: functions/src/notifications/onCampaignCreated.ts
// ============================================================================

import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";

export const onCampaignCreated = onDocumentCreated(
  {
    document: "campaigns/{campaignId}",
    region: "australia-southeast1",
  },
  async (event) => {
    try {
      const campaignData = event.data?.data();
      
      if (!campaignData) {
        logger.error("No campaign data found");
        return;
      }

      logger.info("💚 New campaign created, sending notifications...", {
        campaignId: event.params.campaignId,
        title: campaignData.title,
      });

      // Get all devices with notifications enabled
      const tokensSnapshot = await admin.firestore()
        .collection("fcmTokens")
        .where("notificationsEnabled", "==", true)
        .get();

      if (tokensSnapshot.empty) {
        logger.info("No devices with notifications enabled");
        return;
      }

      // Collect FCM tokens
      const tokens: string[] = [];
      tokensSnapshot.forEach((doc) => {
        const tokenData = doc.data();
        if (tokenData.fcmToken) {
          tokens.push(tokenData.fcmToken);
        }
      });

      if (tokens.length === 0) {
        logger.info("No FCM tokens found");
        return;
      }

      // Format goal amount if available
      const goalAmount = campaignData.goal_amount;
      const goalStr = goalAmount 
        ? ` - Goal: $${(goalAmount / 100).toFixed(0)}`
        : "";

      // Send notification to all tokens
      // NOTE: Sending data-only message (no notification field) so the app
      // can handle display with custom styling based on type
      const message = {
        data: {
          type: "campaign",
          campaignId: event.params.campaignId,
          title: "💚 New Donation Campaign",
          body: `${campaignData.title}${goalStr}`,
          campaignTitle: campaignData.title || "",
          goalAmount: goalAmount?.toString() || "0",
          imageUrl: campaignData.image_url || "",
        },
        tokens: tokens,
      };

      const response = await admin.messaging().sendEachForMulticast(message);

      logger.info("✅ Campaign notifications sent", {
        successCount: response.successCount,
        failureCount: response.failureCount,
        totalTokens: tokens.length,
      });

      // Log failures
      if (response.failureCount > 0) {
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            logger.warn("Failed to send to token", {
              token: tokens[idx].substring(0, 20) + "...",
              error: resp.error?.message,
            });
          }
        });
      }

    } catch (error: any) {
      logger.error("❌ Error sending campaign notifications:", error);
    }
  }
);
