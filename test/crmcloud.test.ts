import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createRecord,
  deleteRecord,
  describeSObject,
  getOrgLimits,
  getRecord,
  getUserInfo,
  listSobjects,
  requireConfig,
  runSoqlQuery,
  searchRecords,
  updateRecord,
} from "../src/crmcloud.js";
import type { FetchFn, HttpResponse } from "../src/types.js";

const CFG = { instanceUrl: "https://acme.my.salesforce.com/", accessToken: "tok123" };

function jsonResponse(body: unknown, status = 200, statusText = "OK"): HttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: { get: () => "application/json" },
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

function emptyResponse(status = 204, statusText = "No Content"): HttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: { get: () => null },
    text: async () => "",
    json: async () => {
      throw new Error("no body");
    },
  };
}

interface Captured {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

function fakeFetch(captured: Captured, response: HttpResponse): FetchFn {
  return async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    captured.url = url;
    captured.method = init?.method;
    captured.headers = init?.headers;
    captured.body = init?.body;
    return response;
  };
}

describe("requireConfig", () => {
  it("rejects a missing access token naming SALESFORCE_ACCESS_TOKEN, before any request", async () => {
    assert.throws(
      () => requireConfig({ instanceUrl: "https://acme.my.salesforce.com" }),
      /SALESFORCE_ACCESS_TOKEN/,
    );
    let called = false;
    const spy: FetchFn = async () => {
      called = true;
      return jsonResponse({});
    };
    await assert.rejects(
      () => runSoqlQuery(spy, { instanceUrl: "https://acme.my.salesforce.com" }, { query: "SELECT Id FROM Account" }),
      /SALESFORCE_ACCESS_TOKEN/,
    );
    assert.equal(called, false);
  });

  it("rejects a missing instance URL naming SALESFORCE_INSTANCE_URL, before any request", async () => {
    assert.throws(() => requireConfig({ accessToken: "tok" }), /SALESFORCE_INSTANCE_URL/);
    let called = false;
    const spy: FetchFn = async () => {
      called = true;
      return jsonResponse({});
    };
    await assert.rejects(() => listSobjects(spy, { accessToken: "tok" }), /SALESFORCE_INSTANCE_URL/);
    assert.equal(called, false);
  });

  it("strips trailing slashes from the instance URL", () => {
    const cfg = requireConfig({ instanceUrl: "https://acme.my.salesforce.com//", accessToken: " t " });
    assert.equal(cfg.instanceUrl, "https://acme.my.salesforce.com");
    assert.equal(cfg.accessToken, "t");
  });
});

describe("query and search", () => {
  it("runs a SOQL query with URL encoding and the Bearer header", async () => {
    const captured: Captured = {};
    const soql = "SELECT Id, Name FROM Account WHERE Name = 'Acme & Co'";
    const out = (await runSoqlQuery(
      fakeFetch(captured, jsonResponse({ totalSize: 1, records: [{ Id: "001", Name: "Acme & Co" }] })),
      CFG,
      { query: soql },
    )) as { totalSize: number };
    assert.equal(out.totalSize, 1);
    const url = new URL(captured.url ?? "");
    assert.equal(url.origin, "https://acme.my.salesforce.com");
    assert.equal(url.pathname, "/services/data/v59.0/query");
    assert.equal(url.searchParams.get("q"), soql);
    assert.equal(captured.headers?.Authorization, "Bearer tok123");
    assert.equal(captured.method, "GET");
  });

  it("runs a SOSL search on the /search path", async () => {
    const captured: Captured = {};
    const sosl = "FIND {Acme} IN NAME FIELDS RETURNING Account(Id, Name)";
    await searchRecords(fakeFetch(captured, jsonResponse({ searchRecords: [] })), CFG, { search: sosl });
    const url = new URL(captured.url ?? "");
    assert.equal(url.pathname, "/services/data/v59.0/search");
    assert.equal(url.searchParams.get("q"), sosl);
    assert.equal(captured.headers?.Authorization, "Bearer tok123");
  });
});

describe("sobjects", () => {
  it("lists SObjects on the /sobjects path", async () => {
    const captured: Captured = {};
    await listSobjects(fakeFetch(captured, jsonResponse({ sobjects: [{ name: "Account" }] })), CFG);
    assert.equal(new URL(captured.url ?? "").pathname, "/services/data/v59.0/sobjects");
    assert.equal(captured.method, "GET");
  });

  it("describes one SObject on the describe path", async () => {
    const captured: Captured = {};
    const out = (await describeSObject(
      fakeFetch(captured, jsonResponse({ name: "Account", fields: [] })),
      CFG,
      { sobject: "Account" },
    )) as { name: string };
    assert.equal(out.name, "Account");
    assert.equal(new URL(captured.url ?? "").pathname, "/services/data/v59.0/sobjects/Account/describe");
  });

  it("gets one record by type and ID", async () => {
    const captured: Captured = {};
    await getRecord(fakeFetch(captured, jsonResponse({ Id: "001xx", Name: "Acme" })), CFG, {
      sobject: "Account",
      id: "001xx",
    });
    assert.equal(new URL(captured.url ?? "").pathname, "/services/data/v59.0/sobjects/Account/001xx");
    assert.equal(captured.method, "GET");
  });
});

describe("record writes", () => {
  it("creates a record with the exact POST body and returns the upstream JSON", async () => {
    const captured: Captured = {};
    const out = (await createRecord(
      fakeFetch(captured, jsonResponse({ id: "001new", success: true, errors: [] }, 201, "Created")),
      CFG,
      { sobject: "Account", fields: { Name: "Acme", Industry: "Tech" } },
    )) as { id: string; success: boolean };
    assert.equal(out.id, "001new");
    assert.equal(out.success, true);
    assert.equal(new URL(captured.url ?? "").pathname, "/services/data/v59.0/sobjects/Account");
    assert.equal(captured.method, "POST");
    assert.deepEqual(JSON.parse(captured.body ?? "{}"), { Name: "Acme", Industry: "Tech" });
    assert.equal(captured.headers?.["Content-Type"], "application/json");
  });

  it("updates a record with PATCH and maps the empty 204 to a success shape", async () => {
    const captured: Captured = {};
    const out = await updateRecord(fakeFetch(captured, emptyResponse()), CFG, {
      sobject: "Account",
      id: "001xx",
      fields: { Name: "Acme II" },
    });
    assert.deepEqual(out, { success: true, id: "001xx", sobject: "Account" });
    assert.equal(new URL(captured.url ?? "").pathname, "/services/data/v59.0/sobjects/Account/001xx");
    assert.equal(captured.method, "PATCH");
    assert.deepEqual(JSON.parse(captured.body ?? "{}"), { Name: "Acme II" });
  });

  it("deletes a record with DELETE and maps the empty 204 to a success shape", async () => {
    const captured: Captured = {};
    const out = await deleteRecord(fakeFetch(captured, emptyResponse()), CFG, {
      sobject: "Contact",
      id: "003yy",
    });
    assert.deepEqual(out, { success: true, id: "003yy", sobject: "Contact" });
    assert.equal(new URL(captured.url ?? "").pathname, "/services/data/v59.0/sobjects/Contact/003yy");
    assert.equal(captured.method, "DELETE");
    assert.equal(captured.body, undefined);
  });
});

describe("limits, user info, and errors", () => {
  it("fetches org limits on the /limits path", async () => {
    const captured: Captured = {};
    const out = (await getOrgLimits(
      fakeFetch(captured, jsonResponse({ DailyApiRequests: { Max: 15000, Remaining: 14900 } })),
      CFG,
    )) as { DailyApiRequests: { Max: number } };
    assert.equal(out.DailyApiRequests.Max, 15000);
    assert.equal(new URL(captured.url ?? "").pathname, "/services/data/v59.0/limits");
  });

  it("fetches user info on the instance root, not the data path", async () => {
    const captured: Captured = {};
    const out = (await getUserInfo(
      fakeFetch(captured, jsonResponse({ user_id: "005xx", display_name: "Ada" })),
      CFG,
    )) as { display_name: string };
    assert.equal(out.display_name, "Ada");
    assert.equal(captured.url, "https://acme.my.salesforce.com/services/oauth2/userinfo");
    assert.ok(!(captured.url ?? "").includes("/services/data"));
  });

  it("surfaces HTTP 400 with the Salesforce error array message and errorCode", async () => {
    const failing: FetchFn = async () =>
      jsonResponse(
        [{ message: "The requested resource does not exist", errorCode: "NOT_FOUND", fields: [] }],
        400,
        "Bad Request",
      );
    await assert.rejects(
      () => getRecord(failing, CFG, { sobject: "Account", id: "nope" }),
      /HTTP 400.*The requested resource does not exist.*NOT_FOUND/,
    );
  });
});
