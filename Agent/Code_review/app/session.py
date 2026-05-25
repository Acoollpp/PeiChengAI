from __future__ import annotations

import re

from itsdangerous import BadSignature, URLSafeSerializer

SESSION_COOKIE_NAME = "code_review_session"
SESSION_SALT = "code-review-session-v1"


def normalize_phone(phone: str) -> str:
    value = re.sub(r"[\s\-()]", "", phone or "")
    if value.startswith("+86"):
        value = value[3:]
    if not re.fullmatch(r"\d{7,20}", value):
        raise ValueError("phone must contain 7 to 20 digits")
    return value


class SessionManager:
    def __init__(self, secret_key: str):
        self.serializer = URLSafeSerializer(secret_key, salt=SESSION_SALT)

    def create_cookie_value(self, user_id: str) -> str:
        return self.serializer.dumps({"user_id": user_id})

    def read_user_id(self, cookie_value: str | None) -> str | None:
        if not cookie_value:
            return None
        try:
            payload = self.serializer.loads(cookie_value)
        except BadSignature:
            return None
        user_id = payload.get("user_id") if isinstance(payload, dict) else None
        return str(user_id) if user_id else None
