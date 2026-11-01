# crmcloud — Build Report

MCP Rebuild 100, Tier B. Clean-room rebuild of the Salesforce MCP
server's REST core, built from the public Salesforce REST API
documentation captured in
`harness/fixtures/salesforce-tools-original.json` only. The fixture
was created for this build from the public Salesforce REST API docs
(services/data v59.0: query, search, sobjects, limits, userinfo;
from memory of public docs 2026-10-26), marked `"_source":
docs-derived CORE SUBSET ... labelled core-subset ... Not
hand-probed`. Local build only — nothing pushed or published, and
no live network call was made or claimed at any point.

Identity: repo `crmcloud`, npm `@reneturcios/crmcloud`,
MCP name `io.github.CloudCorpRecords/crmcloud`, version `0.1.0`.

## Files created (19/19 per TEMPLATE.md checklist)

- `package.json` — bin `crmcloud: dist/cli.js`, `mcpName` set,
  scripts build=`tsc` / dev=`tsx src/cli.ts` / test=`tsx --test test/*.test.ts`
- `server.json` — description "Salesforce org access: SOQL queries,
  SOSL search, SObject CRUD, limits, and user info." = **86 chars**
  (≤100 ✓); npm entry carries `version: 0.1.0`; OCI entry
  `ghcr.io/cloudcorprecords/crmcloud:0.1.0` carries **no**
  `version` field (verified programmatically)
- `Dockerfile` — node:20-alpine two-stage, ENTRYPOINT
  `node /app/dist/cli.js`, CMD `mcp`, label
  `io.modelcontextprotocol.server.name="io.github.CloudCorpRecords/crmcloud"`
- `tsconfig.json` (identical to the fleet template), `.gitignore`,
  `LICENSE` (MIT, Copyright (c) 2026 Rene Turcios), `README.md`
  (fresh text), `CHANGELOG.md` (single 0.1.0 entry, 2026-10-26)
- `src/index.ts`, `src/cli.ts` (`query`, `search`, `sobjects`,
  `describe`, `get`, `create`, `update`, `delete`, `limits`,
  `userinfo`, `mcp`, `--version`; exit 2 usage / 1 API error),
  `src/mcp.ts`, `src/types.ts`, `src/crmcloud.ts` (core logic,
  `VERSION = "0.1.0"`)
- `test/crmcloud.test.ts`
- `.github/workflows/{ci,publish,publish-container,registry-publish}.yml`
  (from the fleet template; image name and smoke-test server name
  changed to crmcloud)

## Tools implemented (10 — the labelled core subset)

`run_soql_query`, `search_records`, `list_sobjects`,
`describe_sobject`, `get_record`, `create_record`, `update_record`,
`delete_record`, `get_org_limits`, `get_user_info`.

**Subset — handled honestly:** the Salesforce DX MCP original also
has CLI-based tool groups that are NOT in this subset and NOT
rebuilt: DX org/scratch-org management, Apex generation/testing
via the `sf` CLI, LWC/Aura tools, metadata deploy/retrieve via CLI,
and data import/export via CLI. Parity below is against the
10-tool subset only, never the full original surface.

## Implementation notes

- `src/mcp.ts` uses the SDK's low-level `Server` with explicit
  inputSchema literals, per the standing fleet rule: `McpServer`'s
  zod-to-JSON-Schema conversion injects `$schema` /
  `additionalProperties` keys that are absent from the public spec
  and break exact schema parity. Zod still validates every
  `tools/call`.
- Base URL: `SALESFORCE_INSTANCE_URL` with trailing slashes
  stripped, plus `/services/data/v59.0`. Endpoints: `GET
  /query?q=<enc>`, `GET /search?q=<enc>`, `GET /sobjects`, `GET
  /sobjects/{type}/describe`, `GET /sobjects/{type}/{id}`, `POST
  /sobjects/{type}` (body = fields, upstream JSON returned as-is),
  `PATCH /sobjects/{type}/{id}`, `DELETE /sobjects/{type}/{id}`,
  `GET /limits`. One exception, per the API's own layout:
  `get_user_info` goes to `<instance>/services/oauth2/userinfo` on
  the instance root, NOT under the `/services/data` path (asserted
  by test).
- Salesforce answers update and delete with `204` and an empty
  body; those calls return `{ success: true, id, sobject }`
  locally instead of parsing nothing.
- `requireConfig` validates both environment variables before any
  request: the token is checked first (so with both unset the
  error names `SALESFORCE_ACCESS_TOKEN`), then the instance URL
  (error names `SALESFORCE_INSTANCE_URL`). Over MCP these surface
  as `isError` results (verified live over stdio).
- HTTP failures surface the status plus Salesforce's error-array
  `[{message, errorCode}]` message and code when present. All HTTP
  flows through an injectable `FetchFn` (types.ts). The test suite
  uses a fake fetch returning hand-written Salesforce-shaped JSON
  fixtures — **no live call was performed**.

## Verification (foreground, exact outputs)

### 1. Build
```
$ ./node_modules/.bin/tsc ; echo exit=$?
tsc exit=0
```
`dist/` produced, including `dist/cli.js`.

### 2. Tests
```
$ ./node_modules/.bin/tsx --test test/*.test.ts
ℹ tests 14
ℹ pass 14
ℹ fail 0
```
Covers: missing token error naming SALESFORCE_ACCESS_TOKEN (and no
request made without one), missing instance URL naming
SALESFORCE_INSTANCE_URL, trailing-slash stripping, SOQL URL
encoding + Bearer header, SOSL path, list/describe/get paths,
create POST body exact + upstream JSON returned, update PATCH +
204 → success shape, delete DELETE + 204 → success shape, limits
path, userinfo on the instance root (asserted URL has no
`/services/data`), and HTTP 400 with a Salesforce error array
surfacing message + errorCode.

### 3. CLI / MCP smoke
`--version` → `0.1.0`. MCP `initialize` over stdio →
`serverInfo: {"name":"crmcloud","version":"0.1.0"}`. A
`tools/call` for `run_soql_query` with both Salesforce env vars
unset returned `isError: true` with text "SALESFORCE_ACCESS_TOKEN
environment variable is required: set SALESFORCE_ACCESS_TOKEN to
a Salesforce access token and retry". Live API calls were **not**
run (no credentials, egress blocked).

### 4. Parity (harness, from ~/workspace/mcp-rebuild-100/harness/)
```
$ python3 parity.py --original fixtures/salesforce-tools-original.json \
    --rebuild "stdio:node .../builds/crmcloud/dist/cli.js mcp" \
    --out .../builds/crmcloud/parity-out
verdict=PASS parity_pct=100.0 original_tools=10 rebuild_tools=10 missing=[] extra=[] schema_diffs=[]
(exit 0)
```
(parity.json: identical_tools 10/10.) Original side is tools-file
mode, so `fixture_results` records `SKIPPED-TOOLS-FILE-MODE` —
expected harness semantics, not an error. Parity is against the
labelled 10-tool core subset only.

## Lockfile status

`package-lock.json` was copied from modelrun's and its identity
fields edited (top-level `name`, root package `name`, root package
`bin` key → crmcloud; dependency ranges are identical, so the tree
is unchanged). **Clean lockfile regen required before publish**
(regenerate with no `node_modules` present); do not publish from
this lockfile as-is. `node_modules` here is a copy of modelrun's;
`.bin/tsc` / `.bin/tsx` verified working.

## Gaps / honest notes

- Core subset only: DX org/scratch-org management, Apex
  generation/testing via `sf` CLI, LWC/Aura tools, metadata
  deploy/retrieve via CLI, and data import/export via CLI are all
  absent by design (see Tools section and the fixture `_source`).
- No live Salesforce call was made (VM egress is blocked and no
  credentials are available in this environment). Request
  construction is written against the documented API paths and
  payload shapes; live payload drift is unverified until the
  publish wave can smoke with a real org. Behaviour parity is
  tool/schema + docs contract, not live-proven.
- Query/search paging (`nextRecordsUrl`) is not followed
  automatically: the upstream payload, including its paging
  fields, is returned as-is, matching the documented response
  contract.
- Container build not exercised locally; the publish-container
  workflow smoke-tests the image at publish time.
