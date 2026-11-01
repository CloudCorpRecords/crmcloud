/**
 * crmcloud types.
 *
 * Shapes follow the public Salesforce REST API (services/data
 * v59.0): records live under an SObject type and a record ID, SOQL
 * queries and SOSL searches are plain strings sent as the `q`
 * parameter, and org limits / user identity are simple GETs. HTTP
 * access is described by a minimal response surface so tests can
 * inject a fake fetch and never touch the network. Empty 204
 * responses (update / delete) are read through `text()` because
 * they carry no JSON body.
 */

export interface RunSoqlQueryOptions {
  query: string;
}

export interface SearchRecordsOptions {
  search: string;
}

export interface DescribeSObjectOptions {
  sobject: string;
}

export interface GetRecordOptions {
  sobject: string;
  id: string;
}

export interface CreateRecordOptions {
  sobject: string;
  fields: Record<string, unknown>;
}

export interface UpdateRecordOptions {
  sobject: string;
  id: string;
  fields: Record<string, unknown>;
}

export interface DeleteRecordOptions {
  sobject: string;
  id: string;
}

/** Minimal HTTP response surface so tests can inject fixtures. */
export interface HttpResponse {
  ok: boolean;
  status: number;
  statusText?: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  json(): Promise<unknown>;
}

export type FetchFn = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    redirect?: string;
  },
) => Promise<HttpResponse>;
