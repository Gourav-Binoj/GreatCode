import { useNavigate } from "react-router-dom";


// =====================================
// PAGE SHELL
// =====================================
//
// Shared frame for the standalone pages (Feedback, Support), so they
// carry the same header and background as the rest of the app
// without each one rebuilding it.

export default function PageShell({
  title,
  subtitle,
  accent = "#4f46e5",
  children,
}) {

  const navigate = useNavigate();


  return (

    <div
      style={{
        minHeight: "100vh",
        background:
          "linear-gradient(160deg, #eef2ff 0%, #f8fafc 45%, #f8fafc 100%)",
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >

      {/* ---------- HEADER ---------- */}

      <header
        style={{
          height: "70px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 clamp(16px, 4vw, 40px)",
          background: "#151821",
          borderBottom: "1px solid #252936",
        }}
      >

        <button
          onClick={() => navigate("/")}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: "#ffffff",
            fontSize: "18px",
            fontWeight: 600,
            padding: 0,
          }}
        >
          <span style={{ color: accent }}>⌘</span>
          GreatCode
        </button>

        <button
          onClick={() => navigate("/")}
          style={{
            background: "transparent",
            border: "1px solid #313747",
            borderRadius: "6px",
            color: "#cbd5e1",
            cursor: "pointer",
            fontSize: "13px",
            padding: "8px 14px",
          }}
        >
          ← Back to problems
        </button>

      </header>


      {/* ---------- BODY ---------- */}

      <main
        style={{
          maxWidth: "720px",
          margin: "0 auto",
          padding: "clamp(24px, 5vw, 44px) clamp(16px, 4vw, 24px)",
        }}
      >

        <h1
          style={{
            margin: "0 0 8px",
            fontSize: "clamp(24px, 5vw, 30px)",
            color: "#1e293b",
          }}
        >
          {title}
        </h1>

        {subtitle && (
          <p
            style={{
              margin: "0 0 28px",
              color: "#64748b",
              lineHeight: 1.6,
            }}
          >
            {subtitle}
          </p>
        )}

        <div
          style={{
            background: "#ffffff",
            borderRadius: "12px",
            borderTop: `4px solid ${accent}`,
            boxShadow: "0 4px 20px rgba(0,0,0,0.08)",
            padding: "clamp(20px, 4vw, 30px)",
          }}
        >
          {children}
        </div>

      </main>

    </div>

  );

}
