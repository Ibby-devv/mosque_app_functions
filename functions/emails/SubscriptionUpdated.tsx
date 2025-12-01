// Preview wrapper for SubscriptionUpdated
import { SubscriptionUpdatedEmail } from "../src/emails/templates/SubscriptionUpdated";

const sampleData = {
  donorName: "Khadijah Ahmed",
  changes: [
    "Amount: $25.00 → $50.00",
    "Frequency: monthly → weekly",
  ],
  nextPaymentDate: "6 December 2024",
  newAmount: 5000, // $50.00
  newFrequency: "weekly",
};

export default function SubscriptionUpdatedPreview() {
  return <SubscriptionUpdatedEmail data={sampleData} />;
}
