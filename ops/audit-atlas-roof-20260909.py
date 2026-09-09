"""Read-only diagnostics for the 2026-09-09 roof provider interruption.

Only a fixed project and incident window are read. Never print arbitrary log
messages: return diagnostic terms, UUIDs, durations and byte counts only.
The existing protected production environment supplies the credential.
"""
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request

PROJECT = "wozyamlnygaddievzuwn"
START = "2026-09-09T22:30:00Z"
END = "2026-09-09T22:32:00Z"
MAX_BYTES = 2 * 1024 * 1024


def query(token, endpoint, sql):
    url = f"https://api.supabase.com/v1/projects/{PROJECT}/analytics/endpoints/{endpoint}?"
    url += urllib.parse.urlencode({"sql": sql, "iso_timestamp_start": START, "iso_timestamp_end": END})
    request = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"}, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=35) as response:
            data = response.read(MAX_BYTES + 1)
            if len(data) > MAX_BYTES:
                raise RuntimeError("audit_response_size_limit")
            return json.loads(data)
    except urllib.error.HTTPError as error:
        # No response body, header or credential goes to the log.
        print(json.dumps({"endpoint": endpoint, "httpStatus": error.code}))
        if error.code in (401, 403):
            raise RuntimeError("audit_analytics_access_refused") from None
        return {"error": "http_error"}


def summary(row):
    message = str(row.get("event_message", ""))
    terms = re.findall(
        r"provider_[a-z0-9_]+|atlas_panel_[a-z0-9_]+|atlas-panel|"
        r"(?:wall.clock|cpu|memory).{0,12}(?:limit|exceeded)|"
        r"(?:Memory|CPU|WallClock|EarlyDrop|TerminationRequested)|"
        r"(?:SyntaxError|TypeError|RangeError|TimeoutError|AbortError)|"
        r"(?:shutdown|booted|connection reset|unexpected end|invalid json)",
        message, re.IGNORECASE,
    )
    attributes = row.get("attributes", row.get("metadata", {}))
    if isinstance(attributes, list):
        attributes = attributes[0] if attributes else {}
    diagnostic_fields = {}
    if isinstance(attributes, dict):
        for key in ("function_id", "execution_id", "event_type", "reason", "cpu_time_used", "memory_used"):
            value = attributes.get(key)
            if isinstance(value, (int, float, bool)) or (isinstance(value, str) and re.fullmatch(r"[a-zA-Z0-9_-]{1,80}", value)):
                diagnostic_fields[key] = value
            elif key == "memory_used" and isinstance(value, (list, dict)):
                memory = value[0] if isinstance(value, list) and value else value
                if isinstance(memory, dict):
                    diagnostic_fields[key] = {k: v for k, v in memory.items() if k in ("total", "heap", "external") and isinstance(v, (int, float))}
    return {"timestamp": row.get("timestamp"), "diagnosticTerms": sorted(set(terms)),
            "ids": re.findall(r"\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b", message),
            "durationsMs": re.findall(r"\b(\d+)ms\b", message),
            "httpStatus": row.get("status"), "messageChars": len(message), **diagnostic_fields}


def main():
    token = os.environ.get("SUPABASE_ACCESS_TOKEN", "")
    if len(token) < 20:
        raise RuntimeError("audit_protected_environment_secret_withheld")
    queries = [
        ("console", "SELECT timestamp, event_message, log_attributes AS attributes FROM logs WHERE source = 'function_logs' ORDER BY timestamp LIMIT 150",
         "SELECT timestamp, event_message, metadata FROM function_logs ORDER BY timestamp LIMIT 150"),
        ("invocations", "SELECT timestamp, event_message, log_attributes['response.status_code'] AS status FROM logs WHERE source = 'function_edge_logs' ORDER BY timestamp LIMIT 80",
         "SELECT timestamp, event_message FROM function_edge_logs ORDER BY timestamp LIMIT 80"),
    ]
    for label, modern, legacy in queries:
        result = query(token, "logs", modern)
        if result.get("error"):
            # Older projects use the documented BigQuery endpoint. This is a
            # schema fallback only; access refusals above terminate the audit.
            result = query(token, "logs.all", legacy)
        if result.get("error") or not isinstance(result.get("result"), list):
            raise RuntimeError("audit_logs_query_failed")
        print(json.dumps({"source": label, "window": [START, END],
                          "rows": [summary(row) for row in result["result"] if isinstance(row, dict)]}))
    print(json.dumps({"writes": 0, "providerCalls": 0}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        message = str(error)
        raise SystemExit(message if re.fullmatch(r"audit_[a-z_]+", message) else "audit_failed") from None
