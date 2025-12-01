// Preview wrapper for RecurringReceipt
import { RecurringReceiptEmail } from "../src/emails/templates/RecurringReceipt";

const sampleData = {
  donorName: "Omar Hassan",
  amount: 10000, // $100.00
  currency: "aud",
  receiptNumber: "REC-2024-005678",
  date: "29 November 2024",
  frequency: "monthly",
  donationType: "Sadaqah Jariyah",
  nextPaymentDate: "29 December 2024",
};

export default function RecurringReceiptPreview() {
  return <RecurringReceiptEmail data={sampleData} />;
}
