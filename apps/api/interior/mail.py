"""SMTP delivery shared by account recovery, verification and support handoff."""

import smtplib
from email.message import EmailMessage

from .config import settings
from .security import DomainError


def send_email(to, subject, body):
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = settings.smtp_from
    msg["To"] = to
    msg.set_content(body)
    try:
        with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
            if settings.smtp_user:
                smtp.login(settings.smtp_user, settings.smtp_password)
            smtp.send_message(msg)
    except Exception:
        raise DomainError("EMAIL_UNAVAILABLE", "邮件暂时无法发送，请稍后再试。", 503)
