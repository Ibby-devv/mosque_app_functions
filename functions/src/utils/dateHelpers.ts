/**
 * Date utility functions for consistent date formatting across the application
 */

/**
 * Get the current date in YYYY-MM-DD format for a specific timezone
 * Uses Intl.DateTimeFormat for robust, locale-independent date formatting
 * 
 * @param timeZone - IANA timezone identifier (e.g., "Australia/Sydney")
 * @returns Date string in YYYY-MM-DD format
 */
export function getDateInTimezone(timeZone: string): string {
  const now = new Date();
  
  // Use Intl.DateTimeFormat with formatToParts for reliable component extraction
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  
  const parts = formatter.formatToParts(now);
  
  // Extract year, month, and day from the parts
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  
  // Construct YYYY-MM-DD format
  return `${year}-${month}-${day}`;
}

/**
 * Get the current date in Sydney timezone (YYYY-MM-DD format)
 * Convenience wrapper for getDateInTimezone with Sydney timezone
 * 
 * @returns Date string in YYYY-MM-DD format for Sydney timezone
 */
export function getSydneyDate(): string {
  return getDateInTimezone("Australia/Sydney");
}
