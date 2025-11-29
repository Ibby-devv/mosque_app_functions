// Preview wrapper for DisputeAlert
import { DisputeAlertEmail } from "../src/emails/templates/DisputeAlert";

const sampleData = {
  disputeAmount: "150.00",
  disputeDueDate: "15 December 2024",
  disputeReason: "fraudulent",
  donorEmail: "donor@example.com",
  donorName: "John Doe",
  receiptNumber: "REC-2024-007890",
  disputeId: "dp_1ABC123DEF456",
};

export default function DisputeAlertPreview() {
  return <DisputeAlertEmail data={sampleData} />;
}
