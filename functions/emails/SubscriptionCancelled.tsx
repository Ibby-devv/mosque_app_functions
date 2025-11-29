// Preview wrapper for SubscriptionCancelled
import { SubscriptionCancelledEmail } from "../src/emails/templates/SubscriptionCancelled";

const sampleData = {
  donorName: "Yusuf Ibrahim",
  amount: 2500, // $25.00
  currency: "aud",
  frequency: "monthly",
  donationType: "General Donation",
  totalDonated: 30000, // $300.00 total
  startDate: "March 2024",
};

export default function SubscriptionCancelledPreview() {
  return <SubscriptionCancelledEmail data={sampleData} />;
}
