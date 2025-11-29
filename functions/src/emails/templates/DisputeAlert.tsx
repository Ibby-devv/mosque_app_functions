// ============================================================================
// DISPUTE ADMIN ALERT EMAIL
// Sent to admin when a donation is disputed (chargeback)
// ============================================================================

import * as React from "react";
import { Section, Text, Row, Column } from "@react-email/components";
import {
  EmailLayout,
  COLORS,
  EmailConfig,
  DEFAULT_EMAIL_CONFIG,
} from "../components/EmailLayout.js";
import { EmailButton, AlertBox } from "../components/SharedComponents.js";

// ============================================================================
// TEMPLATE DATA INTERFACE
// ============================================================================

export interface DisputeAlertData {
  disputeAmount: string;
  disputeDueDate: string;
  disputeReason: string;
  donorEmail: string;
  donorName: string;
  receiptNumber: string;
  disputeId: string;
}

// ============================================================================
// EMAIL COMPONENT
// ============================================================================

interface DisputeAlertEmailProps {
  data: DisputeAlertData;
  config?: Partial<EmailConfig>;
}

export function DisputeAlertEmail({
  data,
  config = {},
}: DisputeAlertEmailProps) {
  const emailConfig = { ...DEFAULT_EMAIL_CONFIG, ...config };
  const stripeDisputeUrl = `https://dashboard.stripe.com/disputes/${data.disputeId}`;

  return (
    <EmailLayout
      preview={`URGENT: Dispute for $${data.disputeAmount} AUD - Respond by ${data.disputeDueDate}`}
      headerTitle="URGENT: Dispute Created"
      headerColor={COLORS.danger}
      headerEmoji="🚨"
      config={config}
    >
      <Section
        style={{
          backgroundColor: "#fef2f2",
          padding: "20px",
          borderRadius: "8px",
          marginBottom: "20px",
        }}
      >
        <Text
          style={{
            color: "#991b1b",
            fontSize: "18px",
            fontWeight: "bold",
            margin: "0 0 15px 0",
          }}
        >
          Immediate Action Required
        </Text>
        <Text
          style={{
            color: "#991b1b",
            fontSize: "16px",
            fontWeight: "bold",
            margin: "0 0 10px 0",
          }}
        >
          A chargeback dispute has been filed for a donation.
        </Text>
        <Text style={{ color: COLORS.textLight, fontSize: "14px", margin: "0" }}>
          You must respond before <strong>{data.disputeDueDate}</strong> or the
          dispute will automatically be lost.
        </Text>
      </Section>

      {/* Dispute Details Table */}
      <Section
        style={{
          backgroundColor: COLORS.footerBackground,
          borderRadius: "8px",
          padding: "20px",
          marginBottom: "20px",
        }}
      >
        <Text
          style={{
            color: COLORS.text,
            fontSize: "16px",
            fontWeight: "bold",
            margin: "0 0 15px 0",
          }}
        >
          Dispute Details
        </Text>

        <Row style={{ borderBottom: "1px solid #e5e7eb", padding: "8px 0" }}>
          <Column style={{ width: "40%" }}>
            <Text style={{ color: COLORS.textMuted, fontSize: "14px", margin: 0 }}>
              <strong>Amount:</strong>
            </Text>
          </Column>
          <Column style={{ width: "60%" }}>
            <Text style={{ color: COLORS.text, fontSize: "14px", margin: 0 }}>
              ${data.disputeAmount} AUD
            </Text>
          </Column>
        </Row>

        <Row style={{ borderBottom: "1px solid #e5e7eb", padding: "8px 0" }}>
          <Column style={{ width: "40%" }}>
            <Text style={{ color: COLORS.textMuted, fontSize: "14px", margin: 0 }}>
              <strong>Reason:</strong>
            </Text>
          </Column>
          <Column style={{ width: "60%" }}>
            <Text style={{ color: COLORS.text, fontSize: "14px", margin: 0 }}>
              {data.disputeReason}
            </Text>
          </Column>
        </Row>

        <Row style={{ borderBottom: "1px solid #e5e7eb", padding: "8px 0" }}>
          <Column style={{ width: "40%" }}>
            <Text style={{ color: COLORS.textMuted, fontSize: "14px", margin: 0 }}>
              <strong>Donor Email:</strong>
            </Text>
          </Column>
          <Column style={{ width: "60%" }}>
            <Text style={{ color: COLORS.text, fontSize: "14px", margin: 0 }}>
              {data.donorEmail}
            </Text>
          </Column>
        </Row>

        <Row style={{ borderBottom: "1px solid #e5e7eb", padding: "8px 0" }}>
          <Column style={{ width: "40%" }}>
            <Text style={{ color: COLORS.textMuted, fontSize: "14px", margin: 0 }}>
              <strong>Donor Name:</strong>
            </Text>
          </Column>
          <Column style={{ width: "60%" }}>
            <Text style={{ color: COLORS.text, fontSize: "14px", margin: 0 }}>
              {data.donorName}
            </Text>
          </Column>
        </Row>

        <Row style={{ borderBottom: "1px solid #e5e7eb", padding: "8px 0" }}>
          <Column style={{ width: "40%" }}>
            <Text style={{ color: COLORS.textMuted, fontSize: "14px", margin: 0 }}>
              <strong>Receipt #:</strong>
            </Text>
          </Column>
          <Column style={{ width: "60%" }}>
            <Text style={{ color: COLORS.text, fontSize: "14px", margin: 0 }}>
              {data.receiptNumber}
            </Text>
          </Column>
        </Row>

        <Row style={{ borderBottom: "1px solid #e5e7eb", padding: "8px 0" }}>
          <Column style={{ width: "40%" }}>
            <Text style={{ color: COLORS.textMuted, fontSize: "14px", margin: 0 }}>
              <strong>Dispute ID:</strong>
            </Text>
          </Column>
          <Column style={{ width: "60%" }}>
            <Text style={{ color: COLORS.text, fontSize: "14px", margin: 0 }}>
              {data.disputeId}
            </Text>
          </Column>
        </Row>

        <Row style={{ padding: "8px 0" }}>
          <Column style={{ width: "40%" }}>
            <Text style={{ color: COLORS.textMuted, fontSize: "14px", margin: 0 }}>
              <strong>Response Due:</strong>
            </Text>
          </Column>
          <Column style={{ width: "60%" }}>
            <Text
              style={{
                color: COLORS.danger,
                fontSize: "14px",
                fontWeight: "bold",
                margin: 0,
              }}
            >
              {data.disputeDueDate}
            </Text>
          </Column>
        </Row>
      </Section>

      <EmailButton href={stripeDisputeUrl} backgroundColor={COLORS.danger}>
        Respond to Dispute in Stripe
      </EmailButton>

      <AlertBox type="warning" title="⚠️ Important Notes:">
        • Gather all evidence: receipts, communication logs, delivery proof
        <br />
        • Respond promptly - late responses are automatically lost
        <br />
        • Stripe charges a $25 AUD dispute fee regardless of outcome
        <br />• Check if this is part of a recurring subscription
      </AlertBox>

      <Text
        style={{
          color: COLORS.textMuted,
          fontSize: "12px",
          textAlign: "center",
          marginTop: "20px",
        }}
      >
        {emailConfig.mosqueName} - Stripe Dispute Alert
      </Text>
    </EmailLayout>
  );
}

// ============================================================================
// HELPER FUNCTION
// ============================================================================

export function getDisputeAlertEmail(
  data: DisputeAlertData,
  config?: Partial<EmailConfig>
): { subject: string; component: React.ReactElement } {
  return {
    subject: `🚨 URGENT: Dispute Created - $${data.disputeAmount} AUD`,
    component: <DisputeAlertEmail data={data} config={config} />,
  };
}
