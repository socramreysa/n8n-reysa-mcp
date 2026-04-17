#!/usr/bin/env python3

import argparse
import re
import ssl
import sys
import urllib.request
from pathlib import Path


SKILL_ROOT = Path(__file__).resolve().parents[1]
SCAN_EXTENSIONS = {".md", ".yaml", ".yml"}
DOC_URL_RE = re.compile(r"https://docs\.n8n\.io/[^\s)>\]\"'`]+")
MD_LINK_RE = re.compile(r"\[[^\]]+\]\(([^)]+)\)")
EXPECTED_DOC_MARKERS = {
    "https://docs.n8n.io/code/": ["code"],
    "https://docs.n8n.io/data/expressions-for-transformation/": ["expressions", "transformation"],
    "https://docs.n8n.io/data/data-filtering/": ["filtering"],
    "https://docs.n8n.io/flow-logic/splitting/": ["if", "switch"],
    "https://docs.n8n.io/flow-logic/looping/": ["loop"],
    "https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.set/": ["edit fields"],
    "https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.if/": ["if"],
    "https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.switch/": ["switch"],
    "https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.filter/": ["filter"],
    "https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.sort/": ["sort"],
    "https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.aggregate/": ["aggregate"],
    "https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.summarize/": ["summarize"],
    "https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.splitout/": ["split out"],
    "https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.splitinbatches/": ["loop over items"],
    "https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.removeduplicates/": ["remove duplicates"],
    "https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.removeduplicates/templates-and-examples/": ["remove duplicates"],
    "https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/": ["http request"],
    "https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/": ["webhook"],
    "https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.respondtowebhook/": ["respond to webhook"],
    "https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.itemlists/": ["split out"],
    "https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.postgres/": ["postgres"],
    "https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.telegram/": ["telegram"],
    "https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.telegram/message-operations/": ["telegram", "message"],
    "https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.slack/": ["slack"],
    "https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.googlesheets/": ["google sheets"],
}


def iter_scan_files():
    for path in sorted(SKILL_ROOT.rglob("*")):
        if path.is_file() and path.suffix.lower() in SCAN_EXTENSIONS:
            yield path


def fetch_text(url: str) -> str:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "User-Agent": "codex-n8n-node-docs-drift-check/1.0",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return response.read().decode("utf-8", errors="replace")
    except urllib.error.URLError as error:
        reason = getattr(error, "reason", None)
        if not isinstance(reason, ssl.SSLCertVerificationError):
            raise

        insecure_context = ssl._create_unverified_context()
        with urllib.request.urlopen(request, timeout=20, context=insecure_context) as response:
            return response.read().decode("utf-8", errors="replace")


def collect_local_refs(path: Path):
    findings = []
    text = path.read_text(encoding="utf-8")
    for match in MD_LINK_RE.finditer(text):
        ref = match.group(1).strip()
        if not ref or ref.startswith(("http://", "https://", "#", "mailto:")):
            continue
        target = (path.parent / ref).resolve()
        if not target.exists():
            findings.append(
                f"missing_local_ref {path.relative_to(SKILL_ROOT)} :: {ref}"
            )
    return findings


def collect_doc_urls():
    urls = set()
    for path in iter_scan_files():
        text = path.read_text(encoding="utf-8")
        for match in DOC_URL_RE.finditer(text):
            urls.add(match.group(0).rstrip(".,`"))
    return sorted(urls)


def check_url(url: str):
    try:
        text = fetch_text(url)
    except Exception as error:  # pylint: disable=broad-except
        return [f"unreachable_doc {url} :: {error}"]

    lowered = text.lower()
    findings = []
    markers = EXPECTED_DOC_MARKERS.get(url, [])
    for marker in markers:
        if marker.lower() not in lowered:
            findings.append(f"missing_marker {url} :: expected '{marker}'")
    return findings


def run(quiet: bool):
    failures = []
    checked_files = 0
    for path in iter_scan_files():
        checked_files += 1
        failures.extend(collect_local_refs(path))

    urls = collect_doc_urls()
    for url in urls:
        failures.extend(check_url(url))

    if failures:
        print("FAIL")
        for entry in failures:
            print(f"- {entry}")
        return 1

    print("PASS")
    if not quiet:
        print(
            f"- Checked {checked_files} local skill docs for broken references and {len(urls)} docs.n8n.io links for drift"
        )
    return 0


def main():
    parser = argparse.ArgumentParser(
        description="Check bundled n8n authoring docs for broken local refs and upstream doc drift."
    )
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()
    return run(args.quiet)


if __name__ == "__main__":
    sys.exit(main())
