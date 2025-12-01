// Preview wrapper for ManagementLink
import { ManagementLinkEmail } from "../src/emails/templates/ManagementLink";

const sampleData = {
  donorName: "Sarah Ali",
  subscriptionCount: 2,
};

export default function ManagementLinkPreview() {
  return <ManagementLinkEmail data={sampleData} />;
}
