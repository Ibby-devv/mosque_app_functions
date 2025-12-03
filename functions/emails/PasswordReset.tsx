// Preview wrapper for PasswordReset
import { PasswordResetEmail } from "../src/emails/templates/PasswordReset";

const sampleData = {
  adminName: "Omar Hassan",
  resetLink: "https://alansar.app/__/auth/action?mode=resetPassword&oobCode=RST999",
};

export default function PasswordResetPreview() {
  return <PasswordResetEmail data={sampleData} />;
}
