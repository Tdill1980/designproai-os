#!/usr/bin/env python3
"""Create the content-hash manifest required by the DesignPro release archive."""

from __future__ import annotations

import fnmatch
import hashlib
import json
import re
import sys
from pathlib import Path, PurePosixPath

SCHEMA = "designproai.release.v1"
SHA_RE = re.compile(r"[0-9a-f]{40}")
POLICY = Path(__file__).with_name("release-files.txt")


def load_policy() -> tuple[set[str], tuple[str, ...]]:
    lines = []
    for raw in POLICY.read_text(encoding="utf-8").splitlines():
        value = raw.strip()
        if value and not value.startswith("#"):
            if not re.fullmatch(r"[A-Za-z0-9._/*-]+", value) or ".." in PurePosixPath(value).parts or value.startswith("/"):
                raise ValueError(f"unsafe release policy entry: {value}")
            lines.append(value)
    if len(lines) != len(set(lines)):
        raise ValueError("release policy contains duplicate entries")
    return {value for value in lines if "*" not in value}, tuple(value for value in lines if "*" in value)


FIXED_FILES, FILE_PATTERNS = load_policy()


def allowed(path: str) -> bool:
    return path in FIXED_FILES or any(fnmatch.fnmatchcase(path, pattern) for pattern in FILE_PATTERNS)


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: build-release-manifest.py RELEASE_DIR 40_CHAR_GIT_SHA", file=sys.stderr)
        return 2
    root = Path(sys.argv[1]).resolve()
    sha = sys.argv[2]
    if not root.is_dir() or not SHA_RE.fullmatch(sha):
        print("release directory and exact lowercase Git SHA are required", file=sys.stderr)
        return 2
    manifest_path = root / ".designpro-release.json"
    if manifest_path.exists() and (manifest_path.is_symlink() or not manifest_path.is_file()):
        print("unsafe existing release manifest", file=sys.stderr)
        return 1

    files: dict[str, str] = {}
    for candidate in sorted(root.rglob("*")):
        if candidate == manifest_path:
            continue
        relative = candidate.relative_to(root).as_posix()
        if candidate.is_symlink():
            print(f"unapproved release member: {relative}", file=sys.stderr)
            return 1
        if candidate.is_dir():
            continue
        if not candidate.is_file() or not allowed(relative):
            print(f"unapproved release member: {relative}", file=sys.stderr)
            return 1
        files[relative] = digest(candidate)
    missing = FIXED_FILES - files.keys()
    if missing:
        print(f"release files missing: {','.join(sorted(missing))}", file=sys.stderr)
        return 1
    manifest_path.write_text(json.dumps({"schema": SCHEMA, "gitSha": sha, "files": files}, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")
    print(manifest_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
