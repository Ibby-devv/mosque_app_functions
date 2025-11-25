// ============================================================================
// WEBHOOK IDEMPOTENCY PROTECTION
// Location: mosque_app_functions/src/utils/webhookIdempotency.ts
// ============================================================================
// Prevents duplicate webhook processing by tracking processed events in Firestore
// Stripe can send the same event multiple times due to network issues or retries

import * as admin from "firebase-admin";
import { logger } from "firebase-functions";

const db = admin.firestore();

export interface WebhookEventRecord {
  stripe_event_id: string;
  event_type: string;
  processed: boolean;
  processing_started_at: admin.firestore.Timestamp | null;
  processed_at: admin.firestore.Timestamp | null;
  error_message: string | null;
  attempt_count: number;
  created_at: admin.firestore.Timestamp;
  updated_at: admin.firestore.Timestamp;
}

/**
 * Check if a webhook event has already been processed
 * Returns: { isProcessed: boolean, eventDoc: DocumentSnapshot | null }
 */
export async function checkEventProcessed(
  stripeEventId: string
): Promise<{ isProcessed: boolean; eventDoc: any }> {
  try {
    const eventRef = db
      .collection("stripe_webhook_events")
      .doc(stripeEventId);
    const eventDoc = await eventRef.get();

    if (!eventDoc.exists) {
      logger.info("New webhook event - not processed yet", {
        eventId: stripeEventId,
      });
      return { isProcessed: false, eventDoc: null };
    }

    const data = eventDoc.data() as WebhookEventRecord;

    if (data.processed) {
      logger.warn("⚠️ DUPLICATE: Event already processed", {
        eventId: stripeEventId,
        processedAt: data.processed_at,
        eventType: data.event_type,
      });
      return { isProcessed: true, eventDoc };
    }

    // Event exists but not marked as processed (likely failed previous attempt)
    logger.info("Event exists but incomplete - will retry", {
      eventId: stripeEventId,
      attemptCount: data.attempt_count,
    });
    return { isProcessed: false, eventDoc };
  } catch (error) {
    logger.error("Error checking event processed status", {
      eventId: stripeEventId,
      error,
    });
    // On error checking, assume not processed to be safe
    return { isProcessed: false, eventDoc: null };
  }
}

/**
 * Mark webhook event as started (processing)
 * Creates record if new, updates if retrying
 */
export async function markEventStarted(
  stripeEventId: string,
  eventType: string
): Promise<void> {
  try {
    const eventRef = db
      .collection("stripe_webhook_events")
      .doc(stripeEventId);
    const eventDoc = await eventRef.get();

    if (eventDoc.exists) {
      // Retry - increment attempt count
      const currentAttempts = (eventDoc.data() as WebhookEventRecord)
        .attempt_count;
      await eventRef.update({
        processing_started_at: admin.firestore.FieldValue.serverTimestamp(),
        attempt_count: currentAttempts + 1,
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      });

      logger.info("Webhook event retry started", {
        eventId: stripeEventId,
        attemptCount: currentAttempts + 1,
      });
    } else {
      // First attempt - create record
      await eventRef.set({
        stripe_event_id: stripeEventId,
        event_type: eventType,
        processed: false,
        processing_started_at: admin.firestore.FieldValue.serverTimestamp(),
        processed_at: null,
        error_message: null,
        attempt_count: 1,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      });

      logger.info("✅ Webhook event started", {
        eventId: stripeEventId,
        eventType,
      });
    }
  } catch (error) {
    logger.error("Error marking event as started", {
      eventId: stripeEventId,
      error,
    });
    throw error;
  }
}

/**
 * Mark webhook event as successfully processed
 */
export async function markEventCompleted(
  stripeEventId: string
): Promise<void> {
  try {
    const eventRef = db
      .collection("stripe_webhook_events")
      .doc(stripeEventId);

    await eventRef.update({
      processed: true,
      processed_at: admin.firestore.FieldValue.serverTimestamp(),
      error_message: null,
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    logger.info("✅ Webhook event completed", { eventId: stripeEventId });
  } catch (error) {
    logger.error("Error marking event as completed", {
      eventId: stripeEventId,
      error,
    });
    // Don't throw - this is just tracking, not critical
  }
}

/**
 * Mark webhook event as failed with error message
 */
export async function markEventFailed(
  stripeEventId: string,
  errorMessage: string
): Promise<void> {
  try {
    const eventRef = db
      .collection("stripe_webhook_events")
      .doc(stripeEventId);

    await eventRef.update({
      processed: false,
      error_message: errorMessage,
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    logger.error("❌ Webhook event failed", {
      eventId: stripeEventId,
      error: errorMessage,
    });
  } catch (error) {
    logger.error("Error marking event as failed", {
      eventId: stripeEventId,
      error,
    });
    // Don't throw - this is just tracking
  }
}

/**
 * Get event processing stats (for monitoring/debugging)
 */
export async function getEventStats(
  stripeEventId: string
): Promise<WebhookEventRecord | null> {
  try {
    const eventRef = db
      .collection("stripe_webhook_events")
      .doc(stripeEventId);
    const eventDoc = await eventRef.get();

    if (!eventDoc.exists) {
      return null;
    }

    return eventDoc.data() as WebhookEventRecord;
  } catch (error) {
    logger.error("Error getting event stats", { eventId: stripeEventId });
    return null;
  }
}
