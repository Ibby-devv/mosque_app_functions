// Preview wrapper for EmailVerificationPrompt
import { EmailVerificationPromptEmail } from "../src/emails/templates/EmailVerificationPrompt";

const sampleData = {
  adminName: "Fatima Ali",
  verifyLink: "https://alansar.app/__/auth/action?mode=verifyEmail&oobCode=XYZ789",
};

export default function EmailVerificationPromptPreview() {
  return <EmailVerificationPromptEmail data={sampleData} />;
}
