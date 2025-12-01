// ============================================================================
// SHARED EMAIL UI COMPONENTS
// Reusable components for consistent email styling
// ============================================================================

import { Button, Section, Text, Row, Column } from "@react-email/components";
import * as React from "react";
import { COLORS } from "./EmailLayout.js";

// ============================================================================
// BUTTON COMPONENT
// ============================================================================

interface EmailButtonProps {
  href: string;
  children: React.ReactNode;
  backgroundColor?: string;
}

export function EmailButton({
  href,
  children,
  backgroundColor = COLORS.primary,
}: EmailButtonProps) {
  return (
    <Section style={{ textAlign: "center", padding: "20px 0" }}>
      <Button
        href={href}
        style={{
          display: "inline-block",
          backgroundColor,
          color: "#ffffff",
          textDecoration: "none",
          padding: "16px 40px",
          borderRadius: "8px",
          fontSize: "18px",
          fontWeight: "bold",
        }}
      >
        {children}
      </Button>
    </Section>
  );
}

// ============================================================================
// DETAIL ROW COMPONENT (for receipts)
// ============================================================================

interface DetailRowProps {
  label: string;
  value: string;
}

export function DetailRow({ label, value }: DetailRowProps) {
  return (
    <Row style={{ borderBottom: "1px solid #e5e7eb", padding: "8px 0" }}>
      <Column style={{ width: "40%" }}>
        <Text style={{ color: COLORS.textMuted, fontSize: "14px", margin: 0 }}>
          {label}
        </Text>
      </Column>
      <Column style={{ width: "60%", textAlign: "right" }}>
        <Text
          style={{
            color: COLORS.text,
            fontSize: "16px",
            fontWeight: "bold",
            margin: 0,
          }}
        >
          {value}
        </Text>
      </Column>
    </Row>
  );
}

// ============================================================================
// DETAILS BOX COMPONENT (wrapper for detail rows)
// ============================================================================

interface DetailsBoxProps {
  children: React.ReactNode;
}

export function DetailsBox({ children }: DetailsBoxProps) {
  return (
    <Section
      style={{
        backgroundColor: COLORS.footerBackground,
        borderRadius: "8px",
        padding: "20px",
        margin: "20px 0",
      }}
    >
      {children}
    </Section>
  );
}

// ============================================================================
// ALERT BOX COMPONENT
// ============================================================================

interface AlertBoxProps {
  type: "warning" | "danger" | "info";
  title?: string;
  children: React.ReactNode;
}

export function AlertBox({ type, title, children }: AlertBoxProps) {
  const colors = {
    warning: { bg: "#fef3c7", border: COLORS.warning, text: "#92400e" },
    danger: { bg: "#fee2e2", border: COLORS.danger, text: "#991b1b" },
    info: { bg: "#dbeafe", border: COLORS.primary, text: "#1e40af" },
  };

  const c = colors[type];

  return (
    <Section
      style={{
        backgroundColor: c.bg,
        borderLeft: `4px solid ${c.border}`,
        padding: "15px",
        margin: "20px 0",
        borderRadius: "4px",
      }}
    >
      {title && (
        <Text
          style={{
            color: c.text,
            fontSize: "16px",
            fontWeight: "bold",
            margin: "0 0 10px 0",
          }}
        >
          {title}
        </Text>
      )}
      <Text style={{ color: c.text, fontSize: "14px", margin: 0 }}>
        {children}
      </Text>
    </Section>
  );
}

// ============================================================================
// GREETING TEXT
// ============================================================================

interface GreetingProps {
  name: string;
}

export function Greeting({ name }: GreetingProps) {
  return (
    <Text
      style={{
        color: COLORS.textLight,
        fontSize: "16px",
        lineHeight: "1.6",
        margin: "0 0 15px 0",
      }}
    >
      Assalamu Alaikum {name},
    </Text>
  );
}

// ============================================================================
// PARAGRAPH TEXT
// ============================================================================

interface ParagraphProps {
  children: React.ReactNode;
  style?: React.CSSProperties;
}

export function Paragraph({ children, style = {} }: ParagraphProps) {
  return (
    <Text
      style={{
        color: COLORS.textLight,
        fontSize: "16px",
        lineHeight: "1.6",
        margin: "0 0 15px 0",
        ...style,
      }}
    >
      {children}
    </Text>
  );
}

// ============================================================================
// SECTION TITLE
// ============================================================================

interface SectionTitleProps {
  children: React.ReactNode;
}

export function SectionTitle({ children }: SectionTitleProps) {
  return (
    <Text
      style={{
        color: COLORS.text,
        fontSize: "20px",
        fontWeight: "bold",
        margin: "0 0 20px 0",
      }}
    >
      {children}
    </Text>
  );
}

// ============================================================================
// SIGNATURE
// ============================================================================

interface SignatureProps {
  mosqueName: string;
}

export function Signature({ mosqueName }: SignatureProps) {
  return (
    <Text
      style={{
        color: COLORS.textLight,
        fontSize: "16px",
        lineHeight: "1.6",
        margin: "25px 0 0 0",
      }}
    >
      <strong>JazakAllah Khair!</strong>
      <br />
      The {mosqueName} Team
    </Text>
  );
}
