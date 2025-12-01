// Preview wrapper for OneTimeDonationReceipt
import { OneTimeDonationReceiptEmail } from "../src/emails/templates/OneTimeDonationReceipt";

const sampleData = {
  donorName: "Ahmed Khan",
  amount: 5000, // $50.00
  currency: "aud",
  receiptNumber: "REC-2024-001234",
  date: "29 November 2024",
  donationType: "General Donation",
  campaignName: "Masjid Expansion Fund",
  cardLast4: "4242",
  cardBrand: "Visa",
};

export default function OneTimeDonationReceiptPreview() {
  return <OneTimeDonationReceiptEmail data={sampleData} />;
}
