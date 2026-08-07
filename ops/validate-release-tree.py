#!/usr/bin/env python3
"""Verify every manifest-bound byte after extraction and before rollback."""

from __future__ import annotations

import hashlib
import json
import re
import stat
import sys
from pathlib import Path

SCHEMA = "designproai.release.v1"
SHA_RE = re.compile(r"[0-9a-f]{40}")
TRACKED_ROOTS = ("runtime", "gateway", "web", "ops")


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def validate(root: Path, sha: str) -> None:
    if not SHA_RE.fullmatch(sha) or not root.is_dir() or root.is_symlink():
        raise ValueError("exact SHA and regular release directory required")
    manifest_path = root / ".designpro-release.json"
    if manifest_path.is_symlink() or not manifest_path.is_file():
        raise ValueError("release manifest missing or unsafe")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(manifest, dict) or set(manifest) != {"schema", "gitSha", "files"}:
        raise ValueError("unexpected release manifest schema")
    if manifest["schema"] != SCHEMA or manifest["gitSha"] != sha:
        raise ValueError("release manifest SHA mismatch")
    hashes = manifest["files"]
    if not isinstance(hashes, dict) or not hashes:
        raise ValueError("release manifest has no file inventory")

    observed: set[str] = set()
    for top in TRACKED_ROOTS:
        directory = root / top
        if directory.is_symlink() or not directory.is_dir():
            raise ValueError(f"tracked release directory missing or unsafe: {top}")
        for item in directory.rglob("*"):
            relative = item.relative_to(root).as_posix()
            mode = item.lstat().st_mode
            if stat.S_ISLNK(mode) or not (stat.S_ISDIR(mode) or stat.S_ISREG(mode)):
                raise ValueError(f"release tree contains link or special file: {relative}")
            if stat.S_ISREG(mode):
                observed.add(relative)
    if observed != set(hashes):
        missing = sorted(set(hashes) - observed)
        extra = sorted(observed - set(hashes))
        raise ValueError(f"release tree inventory mismatch; missing={missing}; extra={extra}")
    for name, expected in sorted(hashes.items()):
        if not isinstance(expected, str) or not re.fullmatch(r"[0-9a-f]{64}", expected):
            raise ValueError(f"invalid digest in release manifest: {name}")
        if digest(root / name) != expected:
            raise ValueError(f"release tree digest mismatch: {name}")


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: validate-release-tree.py RELEASE_DIR 40_CHAR_GIT_SHA", file=sys.stderr)
        return 2
    try:
        validate(Path(sys.argv[1]), sys.argv[2])
    except (OSError, UnicodeError, json.JSONDecodeError, ValueError) as exc:
        print(f"release tree validation failed: {exc}", file=sys.stderr)
        return 1
    print("Extracted release tree exactly matches its manifest")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
