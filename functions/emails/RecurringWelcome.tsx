// Preview wrapper for RecurringWelcome
import { RecurringWelcomeEmail } from "../src/emails/templates/RecurringWelcome";

const sampleData = {
  donorName: "Fatima Ali",
  amount: 2500, // $25.00
  currency: "aud",
  frequency: "monthly",
  donationType: "Zakat",
  campaignName: "Monthly Zakat Program",
  nextPaymentDate: "29 December 2024",
};

export default function RecurringWelcomePreview() {
  return <RecurringWelcomeEmail data={sampleData} />;
}
