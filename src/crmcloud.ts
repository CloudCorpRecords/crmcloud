/**
 * crmcloud core: ten tools against the Salesforce REST API.
 *
 * All data calls go to <instance>/services/data/v59.0, where
 * <instance> is SALESFORCE_INSTANCE_URL with any trailing slash
 * stripped, and the access token from SALESFORCE_ACCESS_TOKEN is
 * sent as `Authorization: Bearer`:
 *
 *   run_soql_query   GET    /query?q=<soql>
 *   search_records   GET    /search?q=<sosl>
 *   list_sobjects    GET    /sobjects
 *   describe_sobject GET    /sobjects/{type}/describe
 *   get_record       GET    /sobjects/{type}/{id}
 *   create_record    POST   /sobjects/{type}          body = fields
 *   update_record    PATCH  /sobjects/{type}/{id}     body = fields
 *   delete_record    DELETE /sobjects/{type}/{id}
 *   get_org_limits   GET    /limits
 *   get_user_info    GET    <instance>/services/oauth2/userinfo
 *
 * Note get_user_info: the userinfo endpoint lives on the instance
 * root under /services/oauth2, NOT under the /services/data path.
 *
 * Salesforce answers update and delete with 204 and an empty body;
 * those calls return a local { success: true, id, sobject } shape
 * instead of trying to parse nothing. Create returns the upstream
 * JSON (201: { id, success, errors }) unchanged.
 *
 * Configuration is checked before any request: a missing access
 * token throws an error naming SALESFORCE_ACCESS_TOKEN, then a
 * missing instance URL throws one naming SALESFORCE_INSTANCE_URL.
 * HTTP failures surface the status plus Salesforce's own error
 * array message and errorCode when present. All HTTP goes through
 * an injected FetchFn so everything is testable offline.
 */
import type {
  CreateRecordOptions,
  DeleteRecordOptions,
  DescribeSObjectOptions,
  FetchFn,
  GetRecordOptions,
  RunSoqlQueryOptions,
  SearchRecordsOptions,
  UpdateRecordOptions,
} from "./types.js";

export const VERSION = "0.1.0";

export const DATA_PATH = "/services/data/v59.0";

export const INSTANCE_URL_ENV = "SALESFORCE_INSTANCE_URL";

export const ACCESS_TOKEN_ENV = "SALESFORCE_ACCESS_TOKEN";

/** Raw configuration as read from the environment (either may be absent). */
export interface SalesforceConfigInput {
  instanceUrl?: string;
  accessToken?: string;
}

/** Validated configuration: trimmed token, slash-stripped instance URL. */
export interface SalesforceConfig {
  instanceUrl: string;
  accessToken: string;
}

/**
 * Validate configuration before any request is made. The token is
 * checked first, so with both variables missing the error names
 * SALESFORCE_ACCESS_TOKEN; with a token present but no instance
 * URL it names SALESFORCE_INSTANCE_URL.
 */
export function requireConfig(input: SalesforceConfigInput): SalesforceConfig {
  const token = typeof input.accessToken === "string" ? input.accessToken.trim() : "";
  if (!token) {
    throw new Error(
      "SALESFORCE_ACCESS_TOKEN environment variable is required: set SALESFORCE_ACCESS_TOKEN to a Salesforce access token and retry",
    );
  }
  const raw = typeof input.instanceUrl === "string" ? input.instanceUrl.trim() : "";
  if (!raw) {
    throw new Error(
      "SALESFORCE_INSTANCE_URL environment variable is required: set SALESFORCE_INSTANCE_URL to your org instance URL (for example https://your-org.my.salesforce.com) and retry",
    );
  }
  return { instanceUrl: raw.replace(/\/+$/, ""), accessToken: token };
}

/** Read the raw (unvalidated) configuration from the environment. */
export function configFromEnv(): SalesforceConfigInput {
  return {
    instanceUrl: process.env[INSTANCE_URL_ENV],
    accessToken: process.env[ACCESS_TOKEN_ENV],
  };
}

function requireId(value: unknown, field: string): string {
  const v = typeof value === "string" ? value.trim() : "";
  if (!v) throw new Error(`${field} must be a non-empty string`);
  return v;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function seg(value: string): string {
  return encodeURIComponent(value);
}

interface CallInit {
  method?: string;
  query?: Record<string, string>;
  body?: unknown;
  /** Resolve the path against the instance root instead of the data path. */
  root?: boolean;
  /** Returned verbatim when the upstream body is empty (204 update/delete). */
  emptyResult?: unknown;
}

async function callSalesforce(
  fetchFn: FetchFn,
  input: SalesforceConfigInput,
  path: string,
  init: CallInit = {},
): Promise<unknown> {
  const config = requireConfig(input);
  const base = init.root ? config.instanceUrl : `${config.instanceUrl}${DATA_PATH}`;
  let url = `${base}${path}`;
  if (init.query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(init.query)) params.set(k, v);
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }
  let response;
  try {
    response = await fetchFn(url, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        Accept: "application/json",
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch (err) {
    throw new Error(
      `Salesforce API request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!response.ok) {
    let detail = "";
    try {
      const payload: unknown = await response.json();
      if (Array.isArray(payload) && payload.length > 0 && isRecord(payload[0])) {
        const message = typeof payload[0].message === "string" ? payload[0].message : "";
        const code = typeof payload[0].errorCode === "string" ? payload[0].errorCode : "";
        const parts = [message, code ? `[${code}]` : ""].filter(Boolean).join(" ");
        if (parts) detail = `: ${parts}`;
      } else if (isRecord(payload) && typeof payload.message === "string") {
        detail = `: ${payload.message}`;
      }
    } catch {
      // A non-JSON error body still reports its HTTP status below.
    }
    throw new Error(
      `Salesforce API request failed: HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}${detail}`,
    );
  }
  const text = await response.text();
  if (text.trim() === "") {
    return init.emptyResult !== undefined ? init.emptyResult : null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Salesforce API returned a response that was not valid JSON");
  }
}

/** Run a SOQL query and return the matching records. */
export async function runSoqlQuery(
  fetchFn: FetchFn,
  config: SalesforceConfigInput,
  options: RunSoqlQueryOptions,
): Promise<unknown> {
  const query = requireId(options.query, "query");
  return callSalesforce(fetchFn, config, "/query", { query: { q: query } });
}

/** Run a SOSL search across objects and return the search records. */
export async function searchRecords(
  fetchFn: FetchFn,
  config: SalesforceConfigInput,
  options: SearchRecordsOptions,
): Promise<unknown> {
  const search = requireId(options.search, "search");
  return callSalesforce(fetchFn, config, "/search", { query: { q: search } });
}

/** List the SObjects available in the org. */
export async function listSobjects(
  fetchFn: FetchFn,
  config: SalesforceConfigInput,
): Promise<unknown> {
  return callSalesforce(fetchFn, config, "/sobjects");
}

/** Describe one SObject: fields, child relationships, record types. */
export async function describeSObject(
  fetchFn: FetchFn,
  config: SalesforceConfigInput,
  options: DescribeSObjectOptions,
): Promise<unknown> {
  const sobject = requireId(options.sobject, "sobject");
  return callSalesforce(fetchFn, config, `/sobjects/${seg(sobject)}/describe`);
}

/** Fetch one record by SObject type and record ID. */
export async function getRecord(
  fetchFn: FetchFn,
  config: SalesforceConfigInput,
  options: GetRecordOptions,
): Promise<unknown> {
  const sobject = requireId(options.sobject, "sobject");
  const id = requireId(options.id, "id");
  return callSalesforce(fetchFn, config, `/sobjects/${seg(sobject)}/${seg(id)}`);
}

/** Create a record; the upstream JSON ({ id, success, errors }) is returned as-is. */
export async function createRecord(
  fetchFn: FetchFn,
  config: SalesforceConfigInput,
  options: CreateRecordOptions,
): Promise<unknown> {
  const sobject = requireId(options.sobject, "sobject");
  if (!isRecord(options.fields)) throw new Error("fields must be an object of field values");
  return callSalesforce(fetchFn, config, `/sobjects/${seg(sobject)}`, {
    method: "POST",
    body: options.fields,
  });
}

/** Update fields on one record. Upstream 204 (empty) maps to a success shape. */
export async function updateRecord(
  fetchFn: FetchFn,
  config: SalesforceConfigInput,
  options: UpdateRecordOptions,
): Promise<unknown> {
  const sobject = requireId(options.sobject, "sobject");
  const id = requireId(options.id, "id");
  if (!isRecord(options.fields)) throw new Error("fields must be an object of field values");
  return callSalesforce(fetchFn, config, `/sobjects/${seg(sobject)}/${seg(id)}`, {
    method: "PATCH",
    body: options.fields,
    emptyResult: { success: true, id, sobject },
  });
}

/** Delete one record. Upstream 204 (empty) maps to a success shape. */
export async function deleteRecord(
  fetchFn: FetchFn,
  config: SalesforceConfigInput,
  options: DeleteRecordOptions,
): Promise<unknown> {
  const sobject = requireId(options.sobject, "sobject");
  const id = requireId(options.id, "id");
  return callSalesforce(fetchFn, config, `/sobjects/${seg(sobject)}/${seg(id)}`, {
    method: "DELETE",
    emptyResult: { success: true, id, sobject },
  });
}

/** Fetch the org's API usage limits. */
export async function getOrgLimits(
  fetchFn: FetchFn,
  config: SalesforceConfigInput,
): Promise<unknown> {
  return callSalesforce(fetchFn, config, "/limits");
}

/** Fetch the identity of the user the access token belongs to (instance root). */
export async function getUserInfo(
  fetchFn: FetchFn,
  config: SalesforceConfigInput,
): Promise<unknown> {
  return callSalesforce(fetchFn, config, "/services/oauth2/userinfo", { root: true });
}

/** Render an upstream payload as the JSON text block MCP clients show. */
export function formatPayload(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
}
