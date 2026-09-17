import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";

import PageShell from "../components/PageShell";

import {
  UPI_ID,
  UPI_NAME,
  UPI_CONFIGURED,
  SUPPORT_URL,
  COFFEE_TIERS,
  buildUpiUrl,
} from "../lib/support";


export default function SupportMe() {

  const [amount, setAmount] = useState(99);
  const [customAmount, setCustomAmount] = useState("");
  const [copied, setCopied] = useState(false);
  const [qrError, setQrError] = useState("");

  const canvasRef = useRef(null);


  // The custom box wins when it holds a valid number, so typing in it
  // does not silently keep charging the last preset.
  const parsedCustom = Number.parseFloat(customAmount);

  const effectiveAmount =
    customAmount.trim() !== "" &&
    Number.isFinite(parsedCustom) &&
    parsedCustom > 0
      ? parsedCustom
      : amount;

  const upiUrl = buildUpiUrl({
    amount: effectiveAmount,
    note: "GreatCode",
  });


  // =====================================
  // QR CODE
  // =====================================
  //
  // Desktop browsers cannot open a upi:// link - nothing is
  // registered to handle the scheme - so the same URL is drawn as a
  // QR code for the user to scan with the phone they would pay from.

  useEffect(() => {

    if (!canvasRef.current || !upiUrl) {
      return;
    }

    let cancelled = false;

    QRCode.toCanvas(
      canvasRef.current,
      upiUrl,
      {
        width: 210,
        margin: 1,
        color: {
          dark: "#1e293b",
          light: "#ffffff",
        },
      },
      (err) => {
        if (err && !cancelled) {
          console.error("QR render failed:", err);
          setQrError("Could not draw the QR code.");
        }
      }
    );

    return () => {
      cancelled = true;
    };

  }, [upiUrl]);


  // =====================================
  // COPY UPI ID
  // =====================================

  async function copyUpiId() {

    try {

      await navigator.clipboard.writeText(UPI_ID);

      setCopied(true);

      setTimeout(() => setCopied(false), 2000);

    } catch {

      // Clipboard needs a secure context and permission. The ID is
      // shown on screen regardless, so this is recoverable.
      setCopied(false);

    }

  }


  // =====================================
  // NOT CONFIGURED
  // =====================================

  if (!UPI_CONFIGURED) {

    return (
      <PageShell
        title="Buy me a coffee"
        subtitle="This page is not set up yet."
        accent="#f59e0b"
      >
        <p style={{ color: "#475569", lineHeight: 1.7, margin: 0 }}>
          Set <code style={codeStyle}>VITE_UPI_ID</code> (and
          optionally <code style={codeStyle}>VITE_UPI_NAME</code>) in
          your environment, then rebuild. Vite inlines these at build
          time, so a redeploy is needed for the change to take effect.
        </p>
      </PageShell>
    );

  }


  // =====================================
  // PAGE
  // =====================================

  return (

    <PageShell
      title="Buy me a coffee"
      subtitle="GreatCode is free and always will be. If it saved you some time, a coffee is very welcome — but never expected."
      accent="#f59e0b"
    >

      {/* ---------- AMOUNT ---------- */}

      <label style={labelStyle}>Pick an amount</label>

      <div
        style={{
          display: "flex",
          gap: "10px",
          flexWrap: "wrap",
          marginBottom: "14px",
        }}
      >

        {COFFEE_TIERS.map((tier) => {

          const selected =
            customAmount.trim() === "" && amount === tier.amount;

          return (
            <button
              key={tier.amount}
              type="button"
              onClick={() => {
                setAmount(tier.amount);
                setCustomAmount("");
              }}
              style={{
                flex: "1 1 120px",
                padding: "14px 10px",
                borderRadius: "10px",
                cursor: "pointer",
                background: selected ? "#fffbeb" : "#ffffff",
                border: `2px solid ${
                  selected ? "#f59e0b" : "#e2e8f0"
                }`,
                transition: "all 0.15s ease",
              }}
            >
              <div style={{ fontSize: "22px" }}>{tier.emoji}</div>
              <div
                style={{
                  fontWeight: 700,
                  color: "#1e293b",
                  marginTop: "4px",
                }}
              >
                ₹{tier.amount}
              </div>
              <div
                style={{ fontSize: "12px", color: "#64748b" }}
              >
                {tier.label}
              </div>
            </button>
          );

        })}

      </div>


      <input
        type="number"
        min="1"
        step="1"
        inputMode="decimal"
        value={customAmount}
        onChange={(e) => setCustomAmount(e.target.value)}
        placeholder="Or enter your own amount (₹)"
        style={{ ...inputStyle, marginBottom: "26px" }}
      />


      {/* ---------- PAY ---------- */}

      <div
        style={{
          display: "grid",
          gap: "22px",
          gridTemplateColumns:
            "repeat(auto-fit, minmax(230px, 1fr))",
          alignItems: "start",
        }}
      >

        {/* QR - for desktop */}

        <div style={{ textAlign: "center" }}>

          <div style={panelLabel}>Scan with any UPI app</div>

          <div
            style={{
              display: "inline-block",
              padding: "10px",
              background: "#ffffff",
              border: "1px solid #e2e8f0",
              borderRadius: "10px",
            }}
          >
            <canvas
              ref={canvasRef}
              style={{ display: "block", maxWidth: "100%" }}
            />
          </div>

          {qrError && (
            <p
              style={{
                color: "#b91c1c",
                fontSize: "13px",
                marginTop: "8px",
              }}
            >
              {qrError}
            </p>
          )}

        </div>


        {/* Deep link - for phones */}

        <div>

          <div style={panelLabel}>On your phone</div>

          <a
            href={upiUrl}
            style={{
              display: "block",
              padding: "14px",
              background: "#f59e0b",
              color: "#ffffff",
              borderRadius: "10px",
              textAlign: "center",
              fontWeight: 700,
              fontSize: "15px",
              textDecoration: "none",
              marginBottom: "12px",
            }}
          >
            Pay ₹{effectiveAmount} via UPI
          </a>

          <p
            style={{
              fontSize: "12px",
              color: "#94a3b8",
              margin: "0 0 18px",
              lineHeight: 1.5,
            }}
          >
            Opens GPay, PhonePe, Paytm or whichever UPI app you have
            installed. On a computer, scan the QR instead.
          </p>


          <div style={panelLabel}>Or pay this UPI ID</div>

          <div
            style={{
              display: "flex",
              gap: "8px",
              alignItems: "center",
            }}
          >

            <code
              style={{
                ...codeStyle,
                flex: 1,
                padding: "10px",
                overflowWrap: "anywhere",
              }}
            >
              {UPI_ID}
            </code>

            <button
              type="button"
              onClick={copyUpiId}
              style={{
                padding: "10px 14px",
                background: copied ? "#16a34a" : "#1e293b",
                border: "none",
                borderRadius: "8px",
                color: "#ffffff",
                fontSize: "13px",
                fontWeight: 600,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>

          </div>

          <p
            style={{
              fontSize: "12px",
              color: "#94a3b8",
              margin: "8px 0 0",
            }}
          >
            Payments go to {UPI_NAME}.
          </p>

        </div>

      </div>


      {/* ---------- EXTERNAL LINK ---------- */}

      {SUPPORT_URL && (
        <p
          style={{
            marginTop: "26px",
            paddingTop: "18px",
            borderTop: "1px solid #e2e8f0",
            fontSize: "14px",
            color: "#475569",
          }}
        >
          Outside India or prefer a card?{" "}
          <a
            href={SUPPORT_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "#4f46e5", fontWeight: 600 }}
          >
            Use this page instead →
          </a>
        </p>
      )}


      <p
        style={{
          marginTop: "22px",
          fontSize: "12px",
          color: "#94a3b8",
          lineHeight: 1.6,
        }}
      >
        Payment happens entirely inside your own UPI app. GreatCode
        never sees or stores your payment details.
      </p>

    </PageShell>

  );

}


// =====================================
// STYLES
// =====================================

const labelStyle = {
  display: "block",
  fontSize: "14px",
  fontWeight: 600,
  color: "#1e293b",
  marginBottom: "10px",
};

const panelLabel = {
  fontSize: "11px",
  textTransform: "uppercase",
  letterSpacing: "0.5px",
  color: "#64748b",
  marginBottom: "10px",
  fontWeight: 600,
};

const inputStyle = {
  width: "100%",
  padding: "11px 12px",
  border: "1px solid #d8dee9",
  borderRadius: "8px",
  fontSize: "14px",
  fontFamily: "inherit",
  color: "#1e293b",
  boxSizing: "border-box",
};

const codeStyle = {
  background: "#f1f5f9",
  border: "1px solid #e2e8f0",
  borderRadius: "6px",
  padding: "2px 6px",
  fontSize: "13px",
  fontFamily:
    "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  color: "#1e293b",
};
