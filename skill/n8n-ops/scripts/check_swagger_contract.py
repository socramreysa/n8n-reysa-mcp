#!/usr/bin/env python3

import argparse
import json
import os
import ssl
import sys
import urllib.request
from urllib.parse import urlparse

REQUIRED_PATHS = {
    "/workflows": {"get", "post"},
    "/workflows/{id}": {"get", "put"},
    "/workflows/{id}/{versionId}": {"get"},
    "/workflows/{id}/activate": {"post"},
    "/workflows/{id}/deactivate": {"post"},
    "/workflows/{id}/tags": {"get", "put"},
    "/tags": {"get", "post"},
    "/executions": {"get"},
    "/executions/{id}": {"get"},
    "/executions/{id}/retry": {"post"},
}
REQUIRED_EXECUTION_STATUSES = {"canceled", "error", "running", "success", "waiting"}


def derive_default_swagger_url() -> str:
    raw_base = os.environ.get("N8N_BASE_URL", "").strip()
    if not raw_base:
        return ""

    parsed = urlparse(raw_base)
    if not parsed.scheme or not parsed.netloc:
        return ""

    path = parsed.path.rstrip("/")
    if path.endswith("/api/v1"):
        path = path[: -len("/api/v1")]
    rebuilt = parsed._replace(path=path + "/api/v1/docs/swagger-ui-init.js", query="", fragment="")
    return rebuilt.geturl()


def fetch_text(url: str) -> str:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/javascript, text/javascript, application/json, text/plain",
            "User-Agent": "codex-n8n-swagger-check/1.0",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return response.read().decode("utf-8")
    except urllib.error.URLError as error:
        reason = getattr(error, "reason", None)
        if not isinstance(reason, ssl.SSLCertVerificationError):
            raise

        insecure_context = ssl._create_unverified_context()
        with urllib.request.urlopen(request, timeout=20, context=insecure_context) as response:
            return response.read().decode("utf-8")


def extract_swagger_doc(script_text: str) -> dict:
    anchor = '"swaggerDoc"'
    anchor_index = script_text.find(anchor)
    if anchor_index == -1:
        raise ValueError('Could not find "swaggerDoc" in swagger-ui-init.js')

    brace_index = script_text.find("{", anchor_index)
    if brace_index == -1:
        raise ValueError('Could not find opening "{" for swaggerDoc')

    depth = 0
    in_string = False
    escaped = False
    for index in range(brace_index, len(script_text)):
        char = script_text[index]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue

        if char == '"':
            in_string = True
            continue

        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return json.loads(script_text[brace_index:index + 1])

    raise ValueError("Could not extract swaggerDoc JSON object")


def resolve_ref(document: dict, ref: str):
    if not ref.startswith("#/"):
        raise KeyError(f"Unsupported ref: {ref}")

    current = document
    for part in ref[2:].split("/"):
        current = current[part]
    return current


def collect_parameters(document: dict, operation: dict):
    parameters = []
    for entry in operation.get("parameters", []):
        if "$ref" in entry:
            parameters.append(resolve_ref(document, entry["$ref"]))
        else:
            parameters.append(entry)
    return parameters


def find_parameter(document: dict, operation: dict, name: str):
    for parameter in collect_parameters(document, operation):
        if parameter.get("name") == name:
            return parameter
    return None


def require_path_methods(document: dict, failures: list, checks: list):
    paths = document.get("paths", {})
    for path_name, required_methods in REQUIRED_PATHS.items():
        path_item = paths.get(path_name)
        if not isinstance(path_item, dict):
            failures.append(f"Missing path: {path_name}")
            continue

        missing_methods = sorted(
            method.upper() for method in required_methods if method not in path_item
        )
        if missing_methods:
            failures.append(f"Path {path_name} is missing methods: {', '.join(missing_methods)}")
            continue

        checks.append(f"{path_name} exposes {', '.join(sorted(method.upper() for method in required_methods))}")


def require_execution_contract(document: dict, failures: list, checks: list):
    executions_get = document["paths"]["/executions"]["get"]
    execution_get = document["paths"]["/executions/{id}"]["get"]
    retry_post = document["paths"]["/executions/{id}/retry"]["post"]

    include_on_list = find_parameter(document, executions_get, "includeData")
    include_on_detail = find_parameter(document, execution_get, "includeData")
    if not include_on_list or not include_on_detail:
        failures.append("includeData is not documented on both execution list and execution detail endpoints")
    else:
        checks.append("includeData is documented on execution list and execution detail")

    status_param = find_parameter(document, executions_get, "status")
    enum_values = set(status_param.get("schema", {}).get("enum", [])) if status_param else set()
    missing_statuses = sorted(REQUIRED_EXECUTION_STATUSES - enum_values)
    if missing_statuses:
        failures.append(
            "Execution status enum is missing: " + ", ".join(missing_statuses)
        )
    else:
        checks.append("Execution status enum matches the wrapper contract")

    retry_body = (
        retry_post.get("requestBody", {})
        .get("content", {})
        .get("application/json", {})
        .get("schema", {})
        .get("properties", {})
    )
    if "loadWorkflow" not in retry_body:
        failures.append("Retry execution request body no longer documents loadWorkflow")
    else:
        checks.append("Retry execution still documents loadWorkflow")


def require_workflow_contract(document: dict, failures: list, checks: list):
    list_workflows = document["paths"]["/workflows"]["get"]
    activate_workflow = document["paths"]["/workflows/{id}/activate"]["post"]
    version_get = document["paths"]["/workflows/{id}/{versionId}"]["get"]

    missing_query_params = []
    for param_name in ("active", "tags", "name", "limit", "cursor"):
        if not find_parameter(document, list_workflows, param_name):
            missing_query_params.append(param_name)
    if missing_query_params:
        failures.append(
            "/workflows GET is missing query parameters: " + ", ".join(missing_query_params)
        )
    else:
        checks.append("/workflows GET still exposes active, tags, name, limit, and cursor")

    activate_props = (
        activate_workflow.get("requestBody", {})
        .get("content", {})
        .get("application/json", {})
        .get("schema", {})
        .get("properties", {})
    )
    missing_activate_props = [name for name in ("versionId", "name", "description") if name not in activate_props]
    if missing_activate_props:
        failures.append(
            "Activate workflow request body is missing: " + ", ".join(missing_activate_props)
        )
    else:
        checks.append("Activate workflow still supports versionId, name, and description")

    version_response_ref = (
        version_get.get("responses", {})
        .get("200", {})
        .get("content", {})
        .get("application/json", {})
        .get("schema", {})
        .get("$ref")
    )
    if version_response_ref != "#/components/schemas/workflowVersion":
        failures.append("Workflow version endpoint no longer returns the documented workflowVersion schema")
    else:
        checks.append("Workflow version endpoint still returns workflowVersion")


def require_available_in_mcp_note(document: dict, failures: list, checks: list):
    haystack = json.dumps(document.get("components", {}))

    if (
        '"availableInMCP"' not in haystack
        or "The workflow must be active" not in haystack
        or "active Webhook node" not in haystack
    ):
        failures.append("availableInMCP description no longer mentions active workflows and Webhook requirements")
    else:
        checks.append("availableInMCP description still documents active + Webhook requirements")


def run(url: str, quiet: bool) -> int:
    if not str(url).strip():
        print(
            "FAIL: set N8N_BASE_URL or pass --url with the instance swagger-ui-init.js endpoint",
            file=sys.stderr,
        )
        return 2

    try:
        script_text = fetch_text(url)
        document = extract_swagger_doc(script_text)
    except Exception as error:  # pylint: disable=broad-except
        print(f"FAIL: could not load swagger contract from {url}", file=sys.stderr)
        print(f"  {error}", file=sys.stderr)
        return 2

    failures = []
    checks = []
    require_path_methods(document, failures, checks)
    require_workflow_contract(document, failures, checks)
    require_execution_contract(document, failures, checks)
    require_available_in_mcp_note(document, failures, checks)

    if not quiet:
        print(f"Swagger URL: {url}")
        print(f"OpenAPI: {document.get('openapi')}")
        print(f"API version: {document.get('info', {}).get('version')}")
        print("")

    if failures:
        print("FAIL")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("PASS")
    if not quiet:
        for check in checks:
            print(f"- {check}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate the local n8n skill contract against the live Swagger."
    )
    parser.add_argument(
        "--url",
        default=derive_default_swagger_url(),
        help="Swagger UI init URL to validate. Defaults to $N8N_BASE_URL/api/v1/docs/swagger-ui-init.js.",
    )
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="Only print PASS or FAIL and the failing checks.",
    )
    args = parser.parse_args()
    return run(args.url, args.quiet)


if __name__ == "__main__":
    sys.exit(main())
