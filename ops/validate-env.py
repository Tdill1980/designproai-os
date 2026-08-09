#!/usr/bin/env python3
"""Validate role-separated production env files without ever printing values."""

from __future__ import annotations

import os
import re
import stat
import sys
from pathlib import Path
from urllib.parse import urlparse

PROJECT_URL = "https://wozyamlnygaddievzuwn.supabase.co"
APP_ORIGIN = "https://os.designproai.com"
TUS_ENDPOINT = "https://wozyamlnygaddievzuwn.storage.supabase.co/storage/v1/upload/resumable"
SPOOL_DIR = "/var/lib/designproai/spool"
INTERNAL_RUNTIME_URL = "http://runtime-1:3001"
IMAGE_MODEL = "gemini-3-pro-image"

RUNTIME_KEYS = {
    "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "WORKER_SECRET",
    "GOOGLE_AI_API_KEY", "GOOGLE_IMAGE_MODEL", "DESIGNPRO_APP_ORIGIN",
    "DESIGNPRO_SPOOL_DIR", "SUPABASE_TUS_ENDPOINT", "RESEND_API_KEY",
    "RESEND_FROM", "RESEND_FROM_VERIFIED",
}
GATEWAY_KEYS = {
    "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "DESIGNPRO_APP_ORIGIN",
    "DESIGNPRO_RUNTIME_INTERNAL_URL", "WORKER_SECRET",
}
PLACEHOLDER = re.compile(r"replace|example|your[_-]|change[_-]?me|todo", re.I)
EMAIL_RE = re.compile(r"^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$")


class ValidationError(Exception):
    pass


def load(path: Path, role: str) -> dict[str, str]:
    try:
        info = path.lstat()
    except FileNotFoundError as exc:
        raise ValidationError(f"{role}.env is missing") from exc
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
        raise ValidationError(f"{role}.env must be a regular, non-symlink file")
    if stat.S_IMODE(info.st_mode) != 0o600:
        raise ValidationError(f"{role}.env must have mode 0600")
    if os.geteuid() == 0 and info.st_uid != 0:
        raise ValidationError(f"{role}.env must be owned by root")

    values: dict[str, str] = {}
    for number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        match = re.fullmatch(r"([A-Z][A-Z0-9_]*)=(.*)", line)
        if not match:
            raise ValidationError(f"{role}.env line {number} is not KEY=value")
        key, value = match.groups()
        if key in values:
            raise ValidationError(f"{role}.env contains duplicate key {key}")
        if not value or PLACEHOLDER.search(value):
            raise ValidationError(f"{role}.env key {key} is empty or still a placeholder")
        if "\x00" in value or "\r" in value:
            raise ValidationError(f"{role}.env key {key} contains invalid characters")
        values[key] = value
    return values


def exact_keys(role: str, values: dict[str, str], expected: set[str]) -> None:
    missing = expected - values.keys()
    extra = values.keys() - expected
    if missing:
        raise ValidationError(f"{role}.env missing keys: {','.join(sorted(missing))}")
    if extra:
        raise ValidationError(f"{role}.env has unapproved keys: {','.join(sorted(extra))}")


def sender_email(value: str) -> str:
    match = re.fullmatch(r"(?:[^<>\r\n]+<)?([^<>\s@]+@[^<>\s@]+)(?:>)?", value.strip())
    return match.group(1) if match else ""


def validate(runtime_path: Path, gateway_path: Path) -> None:
    runtime = load(runtime_path, "runtime")
    gateway = load(gateway_path, "gateway")
    exact_keys("runtime", runtime, RUNTIME_KEYS)
    exact_keys("gateway", gateway, GATEWAY_KEYS)

    if runtime["SUPABASE_URL"] != PROJECT_URL or gateway["SUPABASE_URL"] != PROJECT_URL:
        raise ValidationError("both roles must use the isolated DesignProAI Supabase project")
    if runtime["DESIGNPRO_APP_ORIGIN"] != APP_ORIGIN or gateway["DESIGNPRO_APP_ORIGIN"] != APP_ORIGIN:
        raise ValidationError("both roles must use the HTTPS DesignProAI OS origin")
    if runtime["DESIGNPRO_SPOOL_DIR"] != SPOOL_DIR:
        raise ValidationError("runtime spool must use the persistent container path")
    if runtime["SUPABASE_TUS_ENDPOINT"] != TUS_ENDPOINT:
        raise ValidationError("runtime TUS endpoint must use the direct isolated Storage host")
    if runtime["GOOGLE_IMAGE_MODEL"] != IMAGE_MODEL:
        raise ValidationError("runtime image model must be the approved 4K model")
    if gateway["DESIGNPRO_RUNTIME_INTERNAL_URL"] != INTERNAL_RUNTIME_URL:
        raise ValidationError("gateway may call only the Docker-internal runtime endpoint")
    if runtime["WORKER_SECRET"] != gateway["WORKER_SECRET"]:
        raise ValidationError("gateway and runtime must share the same internal WORKER_SECRET")
    if runtime["RESEND_FROM_VERIFIED"] != "true":
        raise ValidationError("Resend verified-domain attestation must be true")
    if not EMAIL_RE.fullmatch(sender_email(runtime["RESEND_FROM"])):
        raise ValidationError("RESEND_FROM must contain one valid sender email")

    parsed = urlparse(runtime["SUPABASE_URL"])
    if parsed.scheme != "https" or parsed.username or parsed.password:
        raise ValidationError("Supabase URL must be credential-free HTTPS")
    if len(runtime["SUPABASE_SERVICE_ROLE_KEY"]) < 32:
        raise ValidationError("runtime Supabase secret key is too short")
    if len(runtime["WORKER_SECRET"]) < 32:
        raise ValidationError("WORKER_SECRET must contain at least 32 characters")
    if runtime["WORKER_SECRET"] in {runtime["SUPABASE_SERVICE_ROLE_KEY"], runtime["RESEND_API_KEY"], runtime["GOOGLE_AI_API_KEY"]}:
        raise ValidationError("WORKER_SECRET must not reuse a provider secret")
    if len(runtime["GOOGLE_AI_API_KEY"]) < 20 or len(runtime["RESEND_API_KEY"]) < 20:
        raise ValidationError("provider API key is too short")
    publishable = gateway["SUPABASE_PUBLISHABLE_KEY"]
    if not (publishable.startswith("sb_publishable_") or len(publishable) >= 80):
        raise ValidationError("gateway publishable key has an unexpected format")


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: validate-env.py RUNTIME_ENV GATEWAY_ENV", file=sys.stderr)
        return 2
    try:
        validate(Path(sys.argv[1]), Path(sys.argv[2]))
    except (OSError, UnicodeError, ValidationError) as exc:
        print(f"environment validation failed: {exc}", file=sys.stderr)
        return 1
    print("Environment files are role-separated and valid")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
