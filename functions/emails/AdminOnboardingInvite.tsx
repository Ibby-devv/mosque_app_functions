// Preview wrapper for AdminOnboardingInvite
import { AdminOnboardingInviteEmail } from "../src/emails/templates/AdminOnboardingInvite";

const sampleData = {
  adminName: "Ahmed Khan",
  resetLink: "https://alansar.app/__/auth/action?mode=resetPassword&oobCode=ABC123",
  verifyLink: "https://alansar.app/__/auth/action?mode=verifyEmail&oobCode=DEF456",
  dashboardUrl: "https://alansar.app",
  roles: ["Admin", "Events Manager", "Prayer Times Manager"],
};

export default function AdminOnboardingInvitePreview() {
  return <AdminOnboardingInviteEmail data={sampleData} />;
}
