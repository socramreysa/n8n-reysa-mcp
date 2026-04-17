#!/usr/bin/env python3

import argparse
import os
import re
import sys
from pathlib import Path


ROOT = Path.home() / ".codex"
TARGETS = [
    ROOT / "config.toml",
    ROOT / "skills" / "n8n-ops",
    ROOT / "local-tools" / "n8n-rest-mcp",
]
TEXT_EXTENSIONS = {
    ".js",
    ".json",
    ".md",
    ".mjs",
    ".py",
    ".toml",
    ".ts",
    ".yaml",
    ".yml",
}
SKIP_FILES = {
    ROOT / "skills" / "n8n-ops" / "scripts" / "audit_rest_only.py",
    ROOT / "local-tools" / "n8n-rest-mcp" / "src" / "index.ts",
    ROOT / "local-tools" / "n8n-rest-mcp" / "dist" / "index.js",
    ROOT / "local-tools" / "n8n-rest-mcp" / "test" / "index.test.mjs",
}
PATTERNS = [
    ("forbidden_endpoint", re.compile(r"mcp-server/http")),
    ("forbidden_name", re.compile(r"\bn8nr2\b")),
    ("forbidden_name", re.compile(r"\bn8n_direct\b")),
    ("forbidden_env", re.compile(r"\bN8NR2_BEARER_TOKEN\b")),
    ("forbidden_env", re.compile(r"\bN8N_MCP_BEARER_TOKEN\b")),
    ("forbidden_phrase", re.compile(r"native MCP", re.IGNORECASE)),
    ("forbidden_phrase", re.compile(r"legacy MCP", re.IGNORECASE)),
    ("forbidden_phrase", re.compile(r"kept only as a fallback", re.IGNORECASE)),
]


def iter_files(target: Path):
    if target.is_file():
        yield target
        return

    for path in sorted(target.rglob("*")):
        if not path.is_file():
            continue
        if path in SKIP_FILES:
            continue
        if path.suffix.lower() not in TEXT_EXTENSIONS:
            continue
        yield path


def scan_file(path: Path):
    relative_path = path.relative_to(ROOT)
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return []

    findings = []
    for line_number, line in enumerate(text.splitlines(), start=1):
        for category, pattern in PATTERNS:
            match = pattern.search(line)
            if not match:
                continue
            findings.append(
                {
                    "category": category,
                    "path": str(relative_path),
                    "line": line_number,
                    "snippet": line.strip(),
                }
            )
    return findings


def run():
    findings = []
    for target in TARGETS:
        if not target.exists():
            findings.append(
                {
                    "category": "missing_target",
                    "path": str(target),
                    "line": 0,
                    "snippet": "Expected audit target does not exist",
                }
            )
            continue

        for path in iter_files(target):
            findings.extend(scan_file(path))

    if findings:
        print("FAIL")
        for finding in findings:
            print(
                f"- {finding['category']} {finding['path']}:{finding['line']} :: {finding['snippet']}"
            )
        return 1

    print("PASS")
    print("- Checked config.toml, skill files, and wrapper files for forbidden MCP-native patterns")
    return 0


def main():
    parser = argparse.ArgumentParser(
        description="Audit the global n8n Codex integration for REST-only compliance."
    )
    parser.parse_args()
    return run()


if __name__ == "__main__":
    sys.exit(main())
