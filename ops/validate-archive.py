#!/usr/bin/env python3
"""Fail-closed validation for an immutable standalone DesignPro release tarball."""

from __future__ import annotations

import fnmatch
import hashlib
import json
import re
import sys
import tarfile
from pathlib import Path, PurePosixPath

SCHEMA = "designproai.release.v1"
MANIFEST = ".designpro-release.json"
SHA_RE = re.compile(r"[0-9a-f]{40}")
POLICY = Path(__file__).with_name("release-files.txt")
MAX_MEMBER_BYTES = 256 * 1024 * 1024
MAX_ARCHIVE_BYTES = 512 * 1024 * 1024
MAX_MEMBERS = 5000


class InvalidArchive(Exception):
    pass


def load_policy() -> tuple[set[str], tuple[str, ...]]:
    lines = []
    for raw in POLICY.read_text(encoding="utf-8").splitlines():
        value = raw.strip()
        if value and not value.startswith("#"):
            if not re.fullmatch(r"[A-Za-z0-9._/*-]+", value) or ".." in PurePosixPath(value).parts or value.startswith("/"):
                raise InvalidArchive(f"unsafe release policy entry: {value}")
            lines.append(value)
    if len(lines) != len(set(lines)):
        raise InvalidArchive("release policy contains duplicate entries")
    return {value for value in lines if "*" not in value}, tuple(value for value in lines if "*" in value)


FIXED_FILES, FILE_PATTERNS = load_policy()


def safe_name(name: str) -> bool:
    if not name or "\\" in name or name.startswith("/") or len(name) > 240 or not re.fullmatch(r"[A-Za-z0-9._/-]+", name):
        return False
    parts = PurePosixPath(name).parts
    return bool(parts) and all(part not in {"", ".", ".."} for part in parts)


def allowed_file(name: str) -> bool:
    return name == MANIFEST or name in FIXED_FILES or any(fnmatch.fnmatchcase(name, pattern) for pattern in FILE_PATTERNS)


def allowed_directory(name: str) -> bool:
    if name in {"runtime", "gateway", "gateway/src", "web", "web/dist", "ops"}:
        return True
    # The served application is the branded operator shell, which references
    # its images by absolute path, so its public tree lands beside the hashed
    # bundles instead of inside assets/. Directory names are already
    # constrained by safe_name(); what a directory may *contain* stays governed
    # by the extension allowlist in release-files.txt, which is the real
    # control. Depth is bounded so a deep tree cannot be smuggled in.
    if name.startswith("web/dist/"):
        return len(PurePosixPath(name).parts) <= 4
    # The edge functions the droplet routes. Which functions may appear is fixed
    # by the per-function patterns in release-files.txt, so this only bounds the
    # shape: a function is a directory of modules, occasionally with one level of
    # helpers beneath it, and never deeper.
    if name == "supabase" or name == "supabase/functions":
        return True
    if name.startswith("supabase/functions/"):
        return len(PurePosixPath(name).parts) <= 4
    return False


def member_digest(archive: tarfile.TarFile, member: tarfile.TarInfo) -> str:
    stream = archive.extractfile(member)
    if stream is None:
        raise InvalidArchive(f"cannot read {member.name}")
    value = hashlib.sha256()
    for block in iter(lambda: stream.read(1024 * 1024), b""):
        value.update(block)
    return value.hexdigest()


def validate(path: str, expected_sha: str) -> None:
    if not SHA_RE.fullmatch(expected_sha):
        raise InvalidArchive("exact lowercase 40-character Git SHA required")
    with tarfile.open(path, mode="r:gz") as archive:
        members = archive.getmembers()
        if not members or len(members) > MAX_MEMBERS:
            raise InvalidArchive("archive member count is invalid")
        seen: set[str] = set()
        regular: dict[str, tarfile.TarInfo] = {}
        total = 0
        for member in members:
            name = member.name.rstrip("/") if member.isdir() else member.name
            if not safe_name(name) or name in seen:
                raise InvalidArchive(f"unsafe or duplicate archive path: {member.name}")
            seen.add(name)
            if member.mode & 0o6000:
                raise InvalidArchive(f"setuid/setgid mode rejected: {name}")
            if member.isdir():
                if not allowed_directory(name):
                    raise InvalidArchive(f"unapproved directory: {name}")
                continue
            if not member.isfile():
                raise InvalidArchive(f"links and special files are rejected: {name}")
            if not allowed_file(name):
                raise InvalidArchive(f"unapproved release file: {name}")
            if member.size < 0 or member.size > MAX_MEMBER_BYTES:
                raise InvalidArchive(f"release file too large: {name}")
            if name == MANIFEST and member.size > 2 * 1024 * 1024:
                raise InvalidArchive("release manifest exceeds size limit")
            total += member.size
            if total > MAX_ARCHIVE_BYTES:
                raise InvalidArchive("expanded release exceeds size limit")
            regular[name] = member

        missing = FIXED_FILES - regular.keys()
        if missing:
            raise InvalidArchive(f"required release files missing: {','.join(sorted(missing))}")
        if MANIFEST not in regular:
            raise InvalidArchive("release manifest is missing")
        try:
            manifest_stream = archive.extractfile(regular[MANIFEST])
            manifest = json.load(manifest_stream) if manifest_stream else None
        except (UnicodeError, json.JSONDecodeError) as exc:
            raise InvalidArchive("release manifest is not valid JSON") from exc
        if not isinstance(manifest, dict) or set(manifest) != {"schema", "gitSha", "files"}:
            raise InvalidArchive("release manifest has an unexpected schema")
        if manifest["schema"] != SCHEMA or manifest["gitSha"] != expected_sha:
            raise InvalidArchive("release manifest is not bound to the requested Git SHA")
        expected_files = set(regular) - {MANIFEST}
        hashes = manifest["files"]
        if not isinstance(hashes, dict) or set(hashes) != expected_files:
            raise InvalidArchive("release manifest file inventory is not exact")
        for name in sorted(expected_files):
            expected = hashes.get(name)
            if not isinstance(expected, str) or not re.fullmatch(r"[0-9a-f]{64}", expected):
                raise InvalidArchive(f"invalid manifest digest for {name}")
            if member_digest(archive, regular[name]) != expected:
                raise InvalidArchive(f"release content digest mismatch: {name}")


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: validate-archive.py RELEASE.tgz 40_CHAR_GIT_SHA", file=sys.stderr)
        return 2
    try:
        validate(sys.argv[1], sys.argv[2])
    except (OSError, ValueError, tarfile.TarError, InvalidArchive) as exc:
        print(f"release archive validation failed: {exc}", file=sys.stderr)
        return 1
    print("Release archive layout, manifest, and content hashes are valid")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
