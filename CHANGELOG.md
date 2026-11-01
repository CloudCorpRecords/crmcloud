# Changelog

## 0.1.0 (2026-10-26)

- Initial release.
- CLI: `crmcloud query|search|sobjects|describe|get|create|update|delete|limits|userinfo`
  and `crmcloud mcp`; the org is configured with `SALESFORCE_INSTANCE_URL`
  and `SALESFORCE_ACCESS_TOKEN`.
- MCP server (`crmcloud mcp`, stdio) with ten tools: `run_soql_query`,
  `search_records`, `list_sobjects`, `describe_sobject`, `get_record`,
  `create_record`, `update_record`, `delete_record`, `get_org_limits`,
  and `get_user_info`.
- Data calls go to the Salesforce REST API under
  `<instance>/services/data/v59.0` with the access token sent as an
  `Authorization: Bearer` header; `get_user_info` uses the userinfo
  endpoint on the instance root (`/services/oauth2/userinfo`).
- Updates and deletes return a `{ success, id, sobject }` confirmation,
  because Salesforce answers those calls with an empty `204`.
- HTTP failures surface the status plus Salesforce's error-array
  message and error code when present.
- A missing `SALESFORCE_ACCESS_TOKEN` or `SALESFORCE_INSTANCE_URL`
  fails honestly with an error naming the variable, before any
  request is made.
- Core subset, deliberately: `sf` CLI tooling (org and scratch-org
  management, Apex, LWC/Aura, metadata deploy/retrieve, data
  import/export) is not included.
- All HTTP goes through an injectable fetch function, so the test
  suite runs entirely on hand-written fixtures with no network access.
