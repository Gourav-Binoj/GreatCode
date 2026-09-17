import os
import smtplib
import logging
from email.message import EmailMessage
from typing import Optional


logger = logging.getLogger("notifications")


# ============================================================
# SMTP CONFIGURATION
# ============================================================
#
# Read at call time rather than import time so the app still starts
# when email is not configured. Feedback notification is a nice to
# have; it must never stop the server from booting.
#
# For Gmail, SMTP_PASSWORD must be an App Password, not the account
# password - Google blocks plain password SMTP. Generate one at
# myaccount.google.com/apppasswords (requires 2FA enabled).


def _smtp_settings() -> dict:

    user = os.getenv("SMTP_USER", "").strip()

    return {
        "host": os.getenv("SMTP_HOST", "smtp.gmail.com").strip(),
        "port": int(os.getenv("SMTP_PORT", "587")),
        "user": user,
        "password": os.getenv("SMTP_PASSWORD", "").strip(),
        # Defaults to sending to yourself, which is the common case.
        "to": os.getenv("FEEDBACK_EMAIL", "").strip() or user,
    }


def email_is_configured() -> bool:

    settings = _smtp_settings()

    return bool(
        settings["user"]
        and settings["password"]
        and settings["to"]
    )


# ============================================================
# SEND FEEDBACK EMAIL
# ============================================================

def send_feedback_email(feedback: dict) -> None:
    """
    Send one feedback submission by email.

    Blocking (smtplib is synchronous), so callers on an async path
    must run this in a threadpool. Raises on failure; the caller
    decides whether that matters.
    """

    settings = _smtp_settings()

    if not email_is_configured():
        raise RuntimeError(
            "SMTP is not configured (need SMTP_USER, SMTP_PASSWORD "
            "and a destination address)"
        )

    category = feedback.get("category") or "General"
    rating = feedback.get("rating")
    sender_email = feedback.get("email") or "(not provided)"
    message_text = feedback.get("message") or ""
    user_id = feedback.get("user_id") or "(signed out)"
    created_at = feedback.get("created_at") or ""

    stars = (
        f"{'*' * int(rating)} ({rating}/5)"
        if rating
        else "(not rated)"
    )

    subject = f"[GreatCode] {category}"

    if rating:
        subject += f" - {rating}/5"

    body = f"""New feedback on GreatCode.

Category : {category}
Rating   : {stars}
From     : {sender_email}
User ID  : {user_id}
Received : {created_at}

----------------------------------------------------------------

{message_text}

----------------------------------------------------------------

Feedback ID: {feedback.get("id")}
"""

    email_message = EmailMessage()

    email_message["Subject"] = subject
    email_message["From"] = settings["user"]
    email_message["To"] = settings["to"]

    # Replying to the notification then goes straight to the person
    # who wrote the feedback, when they left an address.
    if feedback.get("email"):
        email_message["Reply-To"] = feedback["email"]

    email_message.set_content(body)

    logger.info(
        "Sending feedback email to %s via %s:%s",
        settings["to"],
        settings["host"],
        settings["port"],
    )

    with smtplib.SMTP(
        settings["host"],
        settings["port"],
        timeout=20,
    ) as server:

        server.starttls()

        server.login(
            settings["user"],
            settings["password"],
        )

        server.send_message(email_message)

    logger.info("Feedback email sent")
