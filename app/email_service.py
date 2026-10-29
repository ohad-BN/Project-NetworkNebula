#!/usr/bin/env python3
"""
Project NetworkNebula — Transactional Email Service
===================================================
Dispatches email verification codes, password resets, and invite notifications.
Supports Resend API (primary), SMTP fallback, and console simulation for local/offline dev.
Dynamically reloads .env configuration on each dispatch.
"""

import json
import logging
import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

import dotenv
import requests

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass


def get_resend_api_key() -> Optional[str]:
    """Retrieve Resend API key dynamically from environment or .env file."""
    dotenv.load_dotenv(dotenv.find_dotenv(), override=True)
    return os.environ.get("RESEND_API_KEY")


def has_configured_mailer() -> bool:
    """Check if either Resend or SMTP credentials are configured."""
    dotenv.load_dotenv(dotenv.find_dotenv(), override=True)
    resend_key = os.environ.get("RESEND_API_KEY")
    smtp_user = os.environ.get("SMTP_USER")
    return bool((resend_key and resend_key.strip()) or (smtp_user and smtp_user.strip()))


# Backward compatibility aliases
RESEND_API_KEY = os.environ.get("RESEND_API_KEY")
SMTP_USER = os.environ.get("SMTP_USER")


def send_verification_email(email: str, code: str, initial_credits: float = 100.0) -> bool:
    """
    Send a 6-digit email verification OTP code to the newly registered user.
    Uses Resend API if configured, SMTP if configured, or logs to console for local testing.
    """
    dotenv.load_dotenv(dotenv.find_dotenv(), override=True)

    resend_api_key = os.environ.get("RESEND_API_KEY")
    resend_from_email = os.environ.get("RESEND_FROM_EMAIL", "NetworkNebula <onboarding@resend.dev>")

    smtp_host = os.environ.get("SMTP_HOST")
    smtp_port = int(os.environ.get("SMTP_PORT", 587))
    smtp_user = os.environ.get("SMTP_USER")
    smtp_password = os.environ.get("SMTP_PASSWORD")
    smtp_from = os.environ.get("SMTP_FROM", "noreply@networknebula.org")

    subject = f"Your NetworkNebula Verification Code: {code}"

    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Verify your NetworkNebula Account</title>
      <style>
        body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0b0c10; color: #ffffff; padding: 20px; }}
        .card {{ background-color: #1f2028; border: 1px solid #2e303a; border-radius: 12px; max-width: 500px; margin: 0 auto; padding: 32px; box-shadow: 0 4px 20px rgba(0,0,0,0.5); }}
        .logo {{ font-size: 20px; font-weight: 800; color: #aa3bff; margin-bottom: 24px; display: flex; align-items: center; gap: 8px; }}
        .code-box {{ background-color: #16171d; border: 1px dashed #aa3bff; border-radius: 8px; padding: 18px; text-align: center; margin: 24px 0; }}
        .code {{ font-size: 32px; font-weight: 900; letter-spacing: 6px; color: #aa3bff; font-family: monospace; }}
        .badge {{ display: inline-block; background-color: rgba(34, 197, 94, 0.15); color: #22c55e; border: 1px solid rgba(34, 197, 94, 0.3); padding: 4px 10px; border-radius: 9999px; font-size: 12px; font-weight: 600; margin-top: 8px; }}
        .footer {{ font-size: 11px; color: #9ca3af; margin-top: 32px; border-top: 1px solid #2e303a; padding-top: 16px; text-align: center; }}
      </style>
    </head>
    <body>
      <div class="card">
        <div class="logo">⚡ NetworkNebula — Private Alpha</div>
        <h2 style="margin-top:0; color:#ffffff;">Verify Your Email Address</h2>
        <p style="color:#9ca3af; font-size:14px; line-height:1.5;">
          Welcome to the NetworkNebula Decentralized AI Compute Network. Enter the 6-digit verification code below to activate your account:
        </p>
        <div class="code-box">
          <div class="code">{code}</div>
          <div class="badge">🎁 Grants ${initial_credits:.2f} Alpha Compute Credits</div>
        </div>
        <p style="color:#9ca3af; font-size:13px;">
          This code will expire in <strong>15 minutes</strong>. If you did not request this registration, please disregard this message.
        </p>
        <div class="footer">
          Project NetworkNebula · Ariel University Computer Science · Automated Alpha Dispatcher
        </div>
      </div>
    </body>
    </html>
    """

    # 1. Try Resend API if API key is present
    if resend_api_key and resend_api_key.strip():
        try:
            resp = requests.post(
                "https://api.resend.com/emails",
                headers={
                    "Authorization": f"Bearer {resend_api_key.strip()}",
                    "Content-Type": "application/json",
                },
                json={
                    "from": resend_from_email,
                    "to": [email],
                    "subject": subject,
                    "html": html_content,
                },
                timeout=10,
            )
            if resp.status_code in [200, 201]:
                logger.info(f"[RESEND] Verification email sent to {email} (ID: {resp.json().get('id')})")
                try:
                    print(f"  ✅ [RESEND API] Live email delivered to {email}!")
                except Exception:
                    print(f"  [RESEND API] Live email delivered to {email}!")
                return True
            else:
                logger.warning(f"[RESEND] Failed status {resp.status_code}: {resp.text}")
                try:
                    print(f"  ⚠️ [RESEND API Warning] Status {resp.status_code}: {resp.text}")
                except Exception:
                    print(f"  [RESEND API Warning] Status {resp.status_code}")
        except Exception as e:
            logger.error(f"[RESEND] Error sending verification email: {e}")
            try:
                print(f"  ❌ [RESEND API Error] {e}")
            except Exception:
                print(f"  [RESEND API Error] {e}")

    # 2. Try SMTP if configured
    if smtp_host and smtp_user and smtp_password:
        try:
            msg = MIMEMultipart("alternative")
            msg["Subject"] = subject
            msg["From"] = smtp_from
            msg["To"] = email
            msg.attach(MIMEText(f"Your NetworkNebula verification code is: {code}", "plain"))
            msg.attach(MIMEText(html_content, "html"))

            with smtplib.SMTP(smtp_host, smtp_port, timeout=10) as server:
                server.starttls()
                server.login(smtp_user, smtp_password)
                server.sendmail(smtp_from, [email], msg.as_string())
            logger.info(f"[SMTP] Verification email sent to {email}")
            try:
                print(f"  ✅ [SMTP] Live email delivered to {email}!")
            except Exception:
                print(f"  [SMTP] Live email delivered to {email}!")
            return True
        except Exception as e:
            logger.error(f"[SMTP] Error sending email: {e}")
            try:
                print(f"  ❌ [SMTP Error] {e}")
            except Exception:
                print(f"  [SMTP Error] {e}")

    # 3. Development / Local Fallback Mode (Console Output)
    print("\n" + "=" * 76)
    print(f"  [NEBULA AUTH DISPATCH] VERIFICATION EMAIL (DEV SIMULATION)")
    print("=" * 76)
    print(f"  Recipient          : {email}")
    print(f"  Verification Code  : {code}")
    print(f"  Validity           : 15 Minutes")
    print(f"  Alpha Grant        : +${initial_credits:.2f} Free Compute Credits")
    print("=" * 76 + "\n")
    return False
