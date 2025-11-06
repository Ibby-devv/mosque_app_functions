// ============================================================================
// CLOUD FUNCTION: Cleanup Old Temporary Image Uploads
// Location: functions/src/cleanup/cleanupTmpImages.ts
// ============================================================================

import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";

/**
 * Runs daily to delete tmp images older than 48 hours
 * This catches abandoned uploads that were never finalized
 */
export const cleanupTmpImages = onSchedule(
  {
    schedule: "0 2 * * *", // 2 AM Sydney time daily
    timeZone: "Australia/Sydney",
    region: "australia-southeast1",
  },
  async () => {
    logger.info("🧹 Starting tmp images cleanup...");

    const cutoffTime = new Date();
    cutoffTime.setHours(cutoffTime.getHours() - 48); // 48 hours ago

    let totalDeleted = 0;

    try {
      // Cleanup notifications/tmp/
      const notificationsTmpDeleted = await cleanupTmpFolder(
        "notifications/tmp/",
        cutoffTime
      );
      totalDeleted += notificationsTmpDeleted;

      // Cleanup events/tmp/
      const eventsTmpDeleted = await cleanupTmpFolder(
        "events/tmp/",
        cutoffTime
      );
      totalDeleted += eventsTmpDeleted;

      logger.info("✅ Tmp images cleanup completed", {
        notificationsDeleted: notificationsTmpDeleted,
        eventsDeleted: eventsTmpDeleted,
        totalDeleted,
      });
    } catch (error) {
      logger.error("❌ Error during tmp images cleanup", { error });
    }
  }
);

/**
 * Helper function to clean up a specific tmp folder
 */
async function cleanupTmpFolder(
  prefix: string,
  cutoffTime: Date
): Promise<number> {
  let deletedCount = 0;

  try {
    const bucket = admin.storage().bucket();
    
    // List all files in the folder
    const [files] = await bucket.getFiles({ prefix });

    logger.info(`Found ${files.length} files in ${prefix}`);

    // Filter and delete old files
    for (const file of files) {
      try {
        const [metadata] = await file.getMetadata();
        const createdTime = metadata.timeCreated ? new Date(metadata.timeCreated) : new Date();

        if (createdTime < cutoffTime) {
          await file.delete();
          deletedCount++;
          logger.info(`Deleted old tmp file: ${file.name}`, {
            created: createdTime.toISOString(),
            ageHours: Math.floor((Date.now() - createdTime.getTime()) / (1000 * 60 * 60)),
          });
        }
      } catch (fileError) {
        logger.warn(`Could not process file: ${file.name}`, { error: fileError });
      }
    }
  } catch (error) {
    logger.error(`Error cleaning up folder: ${prefix}`, { error });
  }

  return deletedCount;
}
