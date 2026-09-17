import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { supabase } from "../lib/supabase";
import PageShell from "../components/PageShell";
import { API_URL } from "../lib/api";


const CATEGORIES = [
  "General",
  "Bug",
  "Feature request",
  "Question",
];

const MAX_MESSAGE = 5000;


export default function Feedback() {

  const navigate = useNavigate();

  const [user, setUser] = useState(null);

  const [category, setCategory] = useState("General");
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");

  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");


  // =====================================
  // WHO IS SUBMITTING
  // =====================================
  //
  // Signing in is not required - refusing anonymous feedback mostly
  // means getting no feedback. A signed-in user's email is filled in
  // so they do not have to retype it.

  useEffect(() => {

    let cancelled = false;

    supabase.auth.getSession().then(({ data }) => {

      if (cancelled) {
        return;
      }

      const currentUser = data?.session?.user || null;

      setUser(currentUser);

      if (currentUser?.email) {
        setEmail(currentUser.email);
      }

    });

    return () => {
      cancelled = true;
    };

  }, []);


  // =====================================
  // SUBMIT
  // =====================================

  async function submitFeedback(event) {

    event.preventDefault();

    setError("");

    const trimmed = message.trim();

    if (!trimmed) {
      setError("Please write a little about what you think.");
      return;
    }

    if (trimmed.length > MAX_MESSAGE) {
      setError(
        `Please keep it under ${MAX_MESSAGE} characters.`
      );
      return;
    }

    setSending(true);

    try {

      // The id is generated here rather than by the database so the
      // backend can look this row up afterwards. The feedback table
      // has no SELECT policy, so an insert cannot return the row it
      // just created - without a known id there would be nothing to
      // hand to the notifier.
      const feedbackId = crypto.randomUUID();

      // Straight to Supabase rather than through FastAPI: the
      // backend cold-starts in ~45s on Render's free tier, which
      // would make this form feel broken. This write is what makes
      // the feedback durable; the email is only a notification.
      const { error: insertError } = await supabase
        .from("feedback")
        .insert({
          id: feedbackId,
          user_id: user?.id || null,
          email: email.trim() || null,
          category,
          rating: rating || null,
          message: trimmed,
        });

      if (insertError) {
        throw insertError;
      }

      // Saved. Show success immediately - the email notification
      // must never make the user wait on a cold backend.
      setSent(true);

      notifyByEmail(feedbackId);

    } catch (err) {

      console.error("Feedback submit failed:", err);

      setError(
        err.message ||
        "Could not send your feedback. Please try again."
      );

    } finally {

      setSending(false);

    }

  }


  // =====================================
  // EMAIL NOTIFICATION
  // =====================================
  //
  // Deliberately not awaited and deliberately silent on failure.
  // The feedback is already stored in Supabase by this point, so a
  // sleeping Render instance or an SMTP problem costs a notification
  // and nothing else. Telling the user their feedback failed when it
  // did not would be worse than saying nothing.
  //
  // Only the id is sent: the backend re-reads the row itself, so
  // this endpoint cannot be used to post arbitrary text into the
  // inbox.

  function notifyByEmail(feedbackId) {

    fetch(`${API_URL}/feedback/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: feedbackId }),
      keepalive: true,
    })
      .then((response) => {
        console.log(
          "Feedback notification:",
          response.ok ? "sent" : `failed (${response.status})`
        );
      })
      .catch((err) => {
        console.warn(
          "Feedback notification failed (feedback was saved):",
          err.message
        );
      });

  }


  // =====================================
  // THANK YOU
  // =====================================

  if (sent) {

    return (
      <PageShell
        title="Thank you"
        subtitle="Your feedback has been recorded."
      >

        <div style={{ textAlign: "center", padding: "20px 0" }}>

          <div style={{ fontSize: "44px", marginBottom: "14px" }}>
            🎉
          </div>

          <p
            style={{
              color: "#475569",
              lineHeight: 1.7,
              margin: "0 0 26px",
            }}
          >
            This genuinely helps decide what gets built next.
          </p>

          <div
            style={{
              display: "flex",
              gap: "10px",
              justifyContent: "center",
              flexWrap: "wrap",
            }}
          >

            <button
              onClick={() => navigate("/")}
              style={primaryButton("#4f46e5")}
            >
              Back to problems
            </button>

            <button
              onClick={() => {
                setSent(false);
                setMessage("");
                setRating(0);
              }}
              style={secondaryButton}
            >
              Send more feedback
            </button>

          </div>

        </div>

      </PageShell>
    );

  }


  // =====================================
  // FORM
  // =====================================

  return (

    <PageShell
      title="Send feedback"
      subtitle="Found a bug, want a feature, or just have a thought? Tell me. You do not need an account."
    >

      <form onSubmit={submitFeedback}>

        {/* ---------- CATEGORY ---------- */}

        <label style={labelStyle}>What is this about?</label>

        <div
          style={{
            display: "flex",
            gap: "8px",
            flexWrap: "wrap",
            marginBottom: "22px",
          }}
        >

          {CATEGORIES.map((option) => {

            const selected = category === option;

            return (
              <button
                key={option}
                type="button"
                onClick={() => setCategory(option)}
                style={{
                  padding: "8px 16px",
                  borderRadius: "999px",
                  cursor: "pointer",
                  fontSize: "13px",
                  fontWeight: 600,
                  transition: "all 0.15s ease",
                  color: selected ? "#ffffff" : "#4f46e5",
                  background: selected ? "#4f46e5" : "#eef2ff",
                  border: `1px solid ${
                    selected ? "#4f46e5" : "#c7d2fe"
                  }`,
                }}
              >
                {option}
              </button>
            );

          })}

        </div>


        {/* ---------- RATING ---------- */}

        <label style={labelStyle}>
          How is GreatCode working for you?{" "}
          <span style={{ fontWeight: 400, color: "#94a3b8" }}>
            (optional)
          </span>
        </label>

        <div
          style={{
            display: "flex",
            gap: "4px",
            marginBottom: "22px",
          }}
          onMouseLeave={() => setHoverRating(0)}
        >

          {[1, 2, 3, 4, 5].map((star) => {

            const active = star <= (hoverRating || rating);

            return (
              <button
                key={star}
                type="button"
                aria-label={`${star} out of 5`}
                onClick={() =>
                  setRating(star === rating ? 0 : star)
                }
                onMouseEnter={() => setHoverRating(star)}
                style={{
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "27px",
                  lineHeight: 1,
                  padding: "2px",
                  filter: active ? "none" : "grayscale(1)",
                  opacity: active ? 1 : 0.35,
                  transition: "transform 0.12s ease",
                  transform: active ? "scale(1.08)" : "scale(1)",
                }}
              >
                ⭐
              </button>
            );

          })}

        </div>


        {/* ---------- MESSAGE ---------- */}

        <label style={labelStyle}>Your feedback</label>

        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={7}
          maxLength={MAX_MESSAGE}
          placeholder="What worked, what did not, what you wish it did..."
          style={inputStyle}
        />

        <div
          style={{
            textAlign: "right",
            fontSize: "12px",
            color: "#94a3b8",
            margin: "4px 0 18px",
          }}
        >
          {message.length} / {MAX_MESSAGE}
        </div>


        {/* ---------- EMAIL ---------- */}

        <label style={labelStyle}>
          Email{" "}
          <span style={{ fontWeight: 400, color: "#94a3b8" }}>
            (optional, only if you want a reply)
          </span>
        </label>

        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          style={{ ...inputStyle, marginBottom: "22px" }}
        />


        {/* ---------- ERROR ---------- */}

        {error && (
          <div
            style={{
              background: "#fee2e2",
              color: "#b91c1c",
              border: "1px solid #fecaca",
              padding: "12px",
              borderRadius: "6px",
              marginBottom: "18px",
              fontSize: "14px",
            }}
          >
            {error}
          </div>
        )}


        {/* ---------- SUBMIT ---------- */}

        <button
          type="submit"
          disabled={sending}
          style={{
            ...primaryButton("#4f46e5"),
            width: "100%",
            opacity: sending ? 0.6 : 1,
            cursor: sending ? "not-allowed" : "pointer",
          }}
        >
          {sending ? "Sending..." : "Send feedback"}
        </button>

      </form>

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
  marginBottom: "8px",
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
  resize: "vertical",
};

function primaryButton(background) {
  return {
    padding: "12px 22px",
    background,
    border: "none",
    borderRadius: "8px",
    color: "#ffffff",
    fontSize: "15px",
    fontWeight: 600,
    cursor: "pointer",
  };
}

const secondaryButton = {
  padding: "12px 22px",
  background: "#ffffff",
  border: "1px solid #d8dee9",
  borderRadius: "8px",
  color: "#334155",
  fontSize: "15px",
  fontWeight: 500,
  cursor: "pointer",
};
