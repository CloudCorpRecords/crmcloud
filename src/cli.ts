#!/usr/bin/env node
/**
 * crmcloud CLI.
 *
 *   crmcloud query <soql>
 *   crmcloud search <sosl>
 *   crmcloud sobjects
 *   crmcloud describe <sobject>
 *   crmcloud get <sobject> <id>
 *   crmcloud create <sobject> <fields-json>
 *   crmcloud update <sobject> <id> <fields-json>
 *   crmcloud delete <sobject> <id>
 *   crmcloud limits
 *   crmcloud userinfo
 *   crmcloud mcp
 *
 * Reads the org instance URL from SALESFORCE_INSTANCE_URL and the
 * access token from SALESFORCE_ACCESS_TOKEN.
 * Exit codes: 0 success, 1 API error, 2 usage error.
 */
import {
  configFromEnv,
  createRecord,
  deleteRecord,
  describeSObject,
  formatPayload,
  getOrgLimits,
  getRecord,
  getUserInfo,
  listSobjects,
  runSoqlQuery,
  searchRecords,
  updateRecord,
  VERSION,
} from "./crmcloud.js";
import type { FetchFn } from "./types.js";

function usage(): never {
  console.error(`Usage:
  crmcloud query <soql>
  crmcloud search <sosl>
  crmcloud sobjects
  crmcloud describe <sobject>
  crmcloud get <sobject> <id>
  crmcloud create <sobject> <fields-json>
  crmcloud update <sobject> <id> <fields-json>
  crmcloud delete <sobject> <id>
  crmcloud limits
  crmcloud userinfo
  crmcloud mcp
  crmcloud --version`);
  process.exit(2);
}

function parseJson(raw: string | undefined): Record<string, unknown> {
  if (!raw) usage();
  try {
    const parsed: unknown = JSON.parse(raw as string);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      console.error("error: fields argument must be a JSON object");
      process.exit(2);
    }
    return parsed as Record<string, unknown>;
  } catch {
    console.error("error: argument is not valid JSON");
    process.exit(2);
  }
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "--version" || cmd === "-v") {
    console.log(VERSION);
    return;
  }
  if (cmd === "mcp") {
    await import("./mcp.js");
    return;
  }
  if (!cmd) usage();
  const fetchFn = globalThis.fetch as unknown as FetchFn;
  const config = configFromEnv();
  const known = [
    "query", "search", "sobjects", "describe", "get",
    "create", "update", "delete", "limits", "userinfo",
  ];
  if (!known.includes(cmd)) usage();
  try {
    let out: unknown;
    if (cmd === "query") {
      if (!rest[0]) usage();
      out = await runSoqlQuery(fetchFn, config, { query: rest[0] });
    } else if (cmd === "search") {
      if (!rest[0]) usage();
      out = await searchRecords(fetchFn, config, { search: rest[0] });
    } else if (cmd === "sobjects") {
      out = await listSobjects(fetchFn, config);
    } else if (cmd === "describe") {
      if (!rest[0]) usage();
      out = await describeSObject(fetchFn, config, { sobject: rest[0] });
    } else if (cmd === "get") {
      if (!rest[0] || !rest[1]) usage();
      out = await getRecord(fetchFn, config, { sobject: rest[0], id: rest[1] });
    } else if (cmd === "create") {
      if (!rest[0] || !rest[1]) usage();
      out = await createRecord(fetchFn, config, {
        sobject: rest[0],
        fields: parseJson(rest[1]),
      });
    } else if (cmd === "update") {
      if (!rest[0] || !rest[1] || !rest[2]) usage();
      out = await updateRecord(fetchFn, config, {
        sobject: rest[0],
        id: rest[1],
        fields: parseJson(rest[2]),
      });
    } else if (cmd === "delete") {
      if (!rest[0] || !rest[1]) usage();
      out = await deleteRecord(fetchFn, config, { sobject: rest[0], id: rest[1] });
    } else if (cmd === "limits") {
      out = await getOrgLimits(fetchFn, config);
    } else {
      out = await getUserInfo(fetchFn, config);
    }
    console.log(formatPayload(out));
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

void main();
