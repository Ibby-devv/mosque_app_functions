// ============================================================================
// UTILITY: Image Management Helpers
// Location: functions/src/utils/imageHelpers.ts
// ============================================================================

import { logger } from "firebase-functions";
import * as admin from "firebase-admin";

/**
 * Parse storage reference from various URL formats
 */
export function parseStorageRef(imageUrl: string): { bucket?: string; path: string } | null {
  try {
    // Handle gs:// URLs
    if (imageUrl.startsWith("gs://")) {
      const noScheme = imageUrl.slice("gs://".length);
      const [bucket, ...rest] = noScheme.split("/");
      return { bucket, path: rest.join("/") };
    }

    const url = new URL(imageUrl);

    // Handle firebasestorage.googleapis.com URLs
    // Format: https://firebasestorage.googleapis.com/v0/b/<bucket>/o/<path>?...
    if (url.hostname.includes("firebasestorage.googleapis.com")) {
      const parts = url.pathname.split("/");
      const bIndex = parts.indexOf("b");
      const oIndex = parts.indexOf("o");

      if (bIndex > -1 && oIndex > -1 && parts[bIndex + 1] && parts[oIndex + 1]) {
        const bucket = parts[bIndex + 1];
        const pathParts = parts.slice(oIndex + 1);
        const path = decodeURIComponent(pathParts.join("/"));
        return { bucket, path };
      }
    }

    // Handle storage.googleapis.com URLs
    // Format: https://storage.googleapis.com/<bucket>/<path>
    if (url.hostname === "storage.googleapis.com") {
      const [, bucket, ...rest] = url.pathname.split("/");
      if (bucket && rest.length) {
        return { bucket, path: rest.join("/") };
      }
    }
  } catch (error) {
    logger.error("Error parsing storage URL", { imageUrl, error });
  }

  return null;
}

/**
 * Check if URL points to a tmp upload
 */
export function isTmpUrl(imageUrl: string): boolean {
  const ref = parseStorageRef(imageUrl);
  return ref?.path.includes("/tmp/") ?? false;
}

/**
 * Check if URL points to a live asset
 */
export function isLiveUrl(imageUrl: string, entityId: string): boolean {
  const ref = parseStorageRef(imageUrl);
  return ref?.path.includes(`/live/${entityId}/`) ?? false;
}

/**
 * Generate live path from tmp path
 */
export function generateLivePath(tmpPath: string, entityType: "notifications" | "events" | "campaigns", entityId: string): string {
  // Extract filename from tmp path
  // e.g., "notifications/tmp/12345-abc.jpg" -> "12345-abc.jpg"
  const filename = tmpPath.split("/").pop() || "image.jpg";
  
  return `${entityType}/live/${entityId}/${filename}`;
}

/**
 * Move file from tmp to live folder
 * Returns the new live URL
 */
export async function moveToLive(
  tmpUrl: string,
  entityType: "notifications" | "events" | "campaigns",
  entityId: string
): Promise<string | null> {
  const ref = parseStorageRef(tmpUrl);
  if (!ref) {
    logger.error("Could not parse storage URL", { tmpUrl });
    return null;
  }

  try {
    const bucket = ref.bucket ? admin.storage().bucket(ref.bucket) : admin.storage().bucket();
    const sourceFile = bucket.file(ref.path);

    // Check if source exists
    const [exists] = await sourceFile.exists();
    if (!exists) {
      logger.warn("Source file does not exist (may have been cleaned up)", { path: ref.path });
      return tmpUrl; // Return original URL if file doesn't exist
    }

    // Generate live path
    const livePath = generateLivePath(ref.path, entityType, entityId);
    const destinationFile = bucket.file(livePath);

    // Copy to live location
    await sourceFile.copy(destinationFile);
    logger.info("File copied to live", { from: ref.path, to: livePath });

    // Delete tmp file
    await sourceFile.delete().catch((err) => {
      logger.warn("Could not delete tmp file after copy", { path: ref.path, error: err });
    });

    // Get download URL for the live file
    const [metadata] = await destinationFile.getMetadata();
    const downloadToken = metadata.metadata?.firebaseStorageDownloadTokens;
    
    if (downloadToken) {
      const bucketName = bucket.name;
      const encodedPath = encodeURIComponent(livePath);
      return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodedPath}?alt=media&token=${downloadToken}`;
    } else {
      // Generate a signed URL as fallback
      const [url] = await destinationFile.getSignedUrl({
        action: "read",
        expires: "03-01-2500", // Far future
      });
      return url;
    }
  } catch (error) {
    logger.error("Error moving file to live", { tmpUrl, entityType, entityId, error });
    return null;
  }
}

/**
 * Delete file by URL
 */
export async function deleteFile(imageUrl: string): Promise<boolean> {
  const ref = parseStorageRef(imageUrl);
  if (!ref) {
    logger.warn("Could not parse storage URL for deletion", { imageUrl });
    return false;
  }

  try {
    const bucket = ref.bucket ? admin.storage().bucket(ref.bucket) : admin.storage().bucket();
    await bucket.file(ref.path).delete();
    logger.info("File deleted", { path: ref.path });
    return true;
  } catch (error: any) {
    if (error.code === 404) {
      logger.info("File already deleted or does not exist", { path: ref.path });
      return true; // Consider success if already gone
    }
    logger.error("Error deleting file", { imageUrl, error });
    return false;
  }
}

/**
 * Delete all files in a folder (e.g., live/{entityId}/)
 */
export async function deleteFolderContents(
  folderPath: string,
  bucketName?: string
): Promise<number> {
  try {
    const bucket = bucketName ? admin.storage().bucket(bucketName) : admin.storage().bucket();
    
    // List all files in the folder
    const [files] = await bucket.getFiles({ prefix: folderPath });
    
    if (files.length === 0) {
      logger.info("No files found in folder", { folderPath });
      return 0;
    }

    // Delete all files
    await Promise.all(files.map((file) => file.delete().catch((err) => {
      logger.warn("Could not delete file", { path: file.name, error: err });
    })));

    logger.info("Folder contents deleted", { folderPath, count: files.length });
    return files.length;
  } catch (error) {
    logger.error("Error deleting folder contents", { folderPath, error });
    return 0;
  }
}
