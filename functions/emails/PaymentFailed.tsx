// Preview wrapper for PaymentFailed
import { PaymentFailedEmail } from "../src/emails/templates/PaymentFailed";

const sampleData = {
  donorName: "Aisha Mohammed",
  amount: 5000, // $50.00
  currency: "aud",
  frequency: "monthly",
  attemptCount: 2,
  nextRetryDate: "3 December 2024",
};

export default function PaymentFailedPreview() {
  return <PaymentFailedEmail data={sampleData} />;
}
