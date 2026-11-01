# crmcloud

crmcloud is a thin, honest window into one Salesforce org. Everything
in an org hangs off the same few shapes — SObjects with fields,
records addressed by type and ID, SOQL for asking questions, SOSL for
searching across objects — and crmcloud maps those shapes directly:
run a query, run a search, list and describe the objects, then create,
read, update, and delete records, with org limits and the current
user's identity alongside. One binary serves a command-line interface
and a stdio MCP server.

Two environment variables configure every call:

- `SALESFORCE_INSTANCE_URL` — your org's instance URL, for example
  `https://your-org.my.salesforce.com` (a trailing slash is fine).
- `SALESFORCE_ACCESS_TOKEN` — an access token for that org, sent as
  an `Authorization: Bearer` header and never printed.

When either variable is missing, every call fails before any request
is made, with an error that names the missing variable. Data calls go
to `<instance>/services/data/v59.0`; the user-info call goes to
`<instance>/services/oauth2/userinfo`, where Salesforce puts it.

This is a core subset on purpose: org and scratch-org management,
Apex and Lightning tooling, metadata deploy/retrieve, and bulk data
import/export — the parts of the wider Salesforce tooling world that
drive the `sf` CLI — are not included. crmcloud covers the REST data
surface only.

## Install

```bash
npx @reneturcios/crmcloud sobjects
```

Or run the container image:

```bash
docker run -i -e SALESFORCE_INSTANCE_URL -e SALESFORCE_ACCESS_TOKEN ghcr.io/cloudcorprecords/crmcloud
```

The container defaults to the MCP server (see below). Pass CLI
arguments to use it as a CLI instead.

## CLI

```bash
export SALESFORCE_INSTANCE_URL=https://your-org.my.salesforce.com
export SALESFORCE_ACCESS_TOKEN=<redacted>

crmcloud query "SELECT Id, Name FROM Account LIMIT 5"
crmcloud search "FIND {Acme} IN NAME FIELDS RETURNING Account(Id, Name)"
crmcloud sobjects
crmcloud describe Account
crmcloud get Account 001xx000003DGb2AAG
crmcloud create Account '{"Name":"Acme","Industry":"Technology"}'
crmcloud update Account 001xx000003DGb2AAG '{"Name":"Acme II"}'
crmcloud delete Account 001xx000003DGb2AAG
crmcloud limits
crmcloud userinfo

crmcloud --version
```

Each command prints the upstream JSON payload. Salesforce answers
updates and deletes with an empty `204`, so those two commands print
a small `{"success": true, "id": ..., "sobject": ...}` confirmation
instead. Exit codes: `0` on success, `1` when a call fails (including
a missing environment variable or an API error), `2` for usage
errors.

## MCP server

One bin serves both faces. The `mcp` subcommand starts a stdio MCP
server:

```bash
npx -y @reneturcios/crmcloud mcp
```

MCP client configuration:

```json
{
  "mcpServers": {
    "crmcloud": {
      "command": "npx",
      "args": ["-y", "@reneturcios/crmcloud", "mcp"],
      "env": {
        "SALESFORCE_INSTANCE_URL": "https://your-org.my.salesforce.com",
        "SALESFORCE_ACCESS_TOKEN": "..."
      }
    }
  }
}
```

### Tools

| Tool | Input | What it returns |
| --- | --- | --- |
| `run_soql_query` | `query` (required) | The SOQL result set: total size, done flag, and records. |
| `search_records` | `search` (required) | The SOSL search records. |
| `list_sobjects` | (none) | The org's SObjects, with describe-global metadata. |
| `describe_sobject` | `sobject` (required) | The object's fields, child relationships, and record types. |
| `get_record` | `sobject`, `id` (required) | The record's field values. |
| `create_record` | `sobject`, `fields` (required) | The upstream create result: new record `id`, `success`, `errors`. |
| `update_record` | `sobject`, `id`, `fields` (required) | A success confirmation (upstream replies `204` with no body). |
| `delete_record` | `sobject`, `id` (required) | A success confirmation (upstream replies `204` with no body). |
| `get_org_limits` | (none) | The org's API usage limits and remaining amounts. |
| `get_user_info` | (none) | The identity of the user the access token belongs to. |

API errors surface the HTTP status plus Salesforce's own error
message and error code when the org returns them.

## Development

```bash
npm install
npm run build   # tsc -> dist/
npm test        # node test runner over test/*.test.ts, no network (fake fetch fixtures)
npm run dev     # run the CLI from source via tsx
```

## License

MIT — see `LICENSE`.
