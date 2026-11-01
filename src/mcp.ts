/**
 * crmcloud MCP server. Tools: run_soql_query, search_records,
 * list_sobjects, describe_sobject, get_record, create_record,
 * update_record, delete_record, get_org_limits, get_user_info.
 *
 * Why the low-level Server instead of McpServer: the high-level
 * helper converts zod schemas to JSON Schema and injects keys that
 * are not in this tool's public spec ("$schema" and
 * "additionalProperties"), which breaks exact tool-list/schema
 * parity with the spec. This file serves tools/list with the spec's
 * exact input schemas as explicit literals, while zod still
 * validates every tools/call argument set.
 *
 * SALESFORCE_INSTANCE_URL and SALESFORCE_ACCESS_TOKEN are read at
 * call time; a missing variable returns an honest isError result
 * naming the variable instead of failing the handshake.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
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

const NoArgs = z.object({});
const QueryArgs = z.object({ query: z.string() });
const SearchArgs = z.object({ search: z.string() });
const SObjectArgs = z.object({ sobject: z.string() });
const RecordArgs = z.object({ sobject: z.string(), id: z.string() });
const CreateArgs = z.object({
  sobject: z.string(),
  fields: z.record(z.string(), z.unknown()),
});
const UpdateArgs = z.object({
  sobject: z.string(),
  id: z.string(),
  fields: z.record(z.string(), z.unknown()),
});

const TOOLS = [
  {
    name: "run_soql_query",
    description: "Run a SOQL query against the Salesforce org and return the matching records.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "The SOQL query to run against the Salesforce org.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "search_records",
    description: "Run a SOSL search across Salesforce objects and return the search records.",
    inputSchema: {
      type: "object" as const,
      properties: {
        search: {
          type: "string",
          description: "The SOSL search string to run across Salesforce objects.",
        },
      },
      required: ["search"],
    },
  },
  {
    name: "list_sobjects",
    description: "List the SObjects available in the Salesforce org.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "describe_sobject",
    description: "Describe one SObject: its fields, child relationships, and record types.",
    inputSchema: {
      type: "object" as const,
      properties: {
        sobject: {
          type: "string",
          description: "The API name of the SObject type to describe.",
        },
      },
      required: ["sobject"],
    },
  },
  {
    name: "get_record",
    description: "Fetch one record by SObject type and record ID.",
    inputSchema: {
      type: "object" as const,
      properties: {
        sobject: {
          type: "string",
          description: "The API name of the SObject type of the record to fetch.",
        },
        id: {
          type: "string",
          description: "The Salesforce record ID of the record to fetch.",
        },
      },
      required: ["sobject", "id"],
    },
  },
  {
    name: "create_record",
    description: "Create a record of the given SObject type with the given field values.",
    inputSchema: {
      type: "object" as const,
      properties: {
        sobject: {
          type: "string",
          description: "The API name of the SObject type of the record to create.",
        },
        fields: {
          type: "object",
          description: "An object of field names to field values to set on the new record.",
        },
      },
      required: ["sobject", "fields"],
    },
  },
  {
    name: "update_record",
    description: "Update fields on one record by SObject type and record ID.",
    inputSchema: {
      type: "object" as const,
      properties: {
        sobject: {
          type: "string",
          description: "The API name of the SObject type of the record to update.",
        },
        id: {
          type: "string",
          description: "The Salesforce record ID of the record to update.",
        },
        fields: {
          type: "object",
          description: "An object of field names to new field values to set on the record.",
        },
      },
      required: ["sobject", "id", "fields"],
    },
  },
  {
    name: "delete_record",
    description: "Delete one record by SObject type and record ID.",
    inputSchema: {
      type: "object" as const,
      properties: {
        sobject: {
          type: "string",
          description: "The API name of the SObject type of the record to delete.",
        },
        id: {
          type: "string",
          description: "The Salesforce record ID of the record to delete.",
        },
      },
      required: ["sobject", "id"],
    },
  },
  {
    name: "get_org_limits",
    description: "Fetch the org's API usage limits.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "get_user_info",
    description: "Fetch the identity of the user the access token belongs to.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
];

function textResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function errorResult(err: unknown) {
  return {
    content: [
      { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
    ],
    isError: true,
  };
}

const server = new Server(
  { name: "crmcloud", version: VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const fetchFn = globalThis.fetch as unknown as FetchFn;
  const config = configFromEnv();
  try {
    let out: unknown;
    if (name === "run_soql_query") {
      out = await runSoqlQuery(fetchFn, config, QueryArgs.parse(args ?? {}));
    } else if (name === "search_records") {
      out = await searchRecords(fetchFn, config, SearchArgs.parse(args ?? {}));
    } else if (name === "list_sobjects") {
      NoArgs.parse(args ?? {});
      out = await listSobjects(fetchFn, config);
    } else if (name === "describe_sobject") {
      out = await describeSObject(fetchFn, config, SObjectArgs.parse(args ?? {}));
    } else if (name === "get_record") {
      out = await getRecord(fetchFn, config, RecordArgs.parse(args ?? {}));
    } else if (name === "create_record") {
      out = await createRecord(fetchFn, config, CreateArgs.parse(args ?? {}));
    } else if (name === "update_record") {
      out = await updateRecord(fetchFn, config, UpdateArgs.parse(args ?? {}));
    } else if (name === "delete_record") {
      out = await deleteRecord(fetchFn, config, RecordArgs.parse(args ?? {}));
    } else if (name === "get_org_limits") {
      NoArgs.parse(args ?? {});
      out = await getOrgLimits(fetchFn, config);
    } else if (name === "get_user_info") {
      NoArgs.parse(args ?? {});
      out = await getUserInfo(fetchFn, config);
    } else {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
    return textResult(formatPayload(out));
  } catch (err) {
    if (err instanceof McpError) throw err;
    return errorResult(err);
  }
});

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

void main();
