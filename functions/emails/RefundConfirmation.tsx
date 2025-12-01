// Preview wrapper for RefundConfirmation
import { RefundConfirmationEmail } from "../src/emails/templates/RefundConfirmation";

const sampleData = {
  donorName: "Maryam Siddiqui",
  amount: 7500, // $75.00
  currency: "aud",
  receiptNumber: "REC-2024-003456",
  originalDate: "15 November 2024",
  refundReason: "Duplicate payment",
};

export default function RefundConfirmationPreview() {
  return <RefundConfirmationEmail data={sampleData} />;
}
