export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS';

// T only exists at the type level; the runtime value is always undefined
export function t<T>(): T {
  return undefined as unknown as T;
}

export type QueryValue = string | number | boolean | null | undefined | Array<string | number | boolean>;

export type RouteDefinition<
  TMethod extends HttpMethod = HttpMethod,
  TPath extends string = string,
  TParams extends Record<string, any> | never = never,
  TQuery extends Record<string, QueryValue> | never = never,
  TBody = never,
  TOutput = unknown,
> = {
  readonly method: TMethod;
  readonly path: TPath;
  readonly _params: TParams;
  readonly _query: TQuery;
  readonly _body: TBody;
  readonly _output: TOutput;
};

type DefineRouteConfig<
  TMethod extends HttpMethod,
  TPath extends string,
  TParams extends Record<string, any> | never,
  TQuery extends Record<string, QueryValue> | never,
  TBody,
  TOutput,
> = {
  method: TMethod;
  path: TPath;
  params?: TParams;
  query?: TQuery;
  output: TOutput;
} & (TMethod extends 'GET' | 'HEAD' ? { body?: never } : { body?: TBody });

export function defineRoute<
  TMethod extends HttpMethod,
  TPath extends string,
  TParams extends Record<string, any> | never = never,
  TQuery extends Record<string, QueryValue> | never = never,
  TBody = never,
  TOutput = unknown,
>(
  config: DefineRouteConfig<TMethod, TPath, TParams, TQuery, TBody, TOutput>,
): RouteDefinition<TMethod, TPath, TParams, TQuery, TBody, TOutput> {
  return {
    method: config.method,
    path: config.path,
    // phantom fields - accepted for inference, never stored
    _params: undefined as unknown as TParams,
    _query: undefined as unknown as TQuery,
    _body: undefined as unknown as TBody,
    _output: undefined as unknown as TOutput,
  };
}

type AnyRoute = RouteDefinition<HttpMethod, string, any, any, any, any>;
export type Contract = Record<string, AnyRoute>;

export function createContract<T extends Contract>(routes: T): T {
  return routes;
}

type IsNever<T> = [T] extends [never] ? true : false;
type IsEmptyObject<T> = T extends object ? (keyof T extends never ? true : false) : false;

// never and {} both mean "nothing here" for call-site ergonomics
type IsAbsent<T> = IsNever<T> extends true ? true : IsEmptyObject<T>;

type RouteArgsInput<TRoute extends AnyRoute> =
  (IsAbsent<TRoute['_params']> extends true ? {} : { params: TRoute['_params'] }) &
  (IsAbsent<TRoute['_query']> extends true ? {} : { query?: TRoute['_query'] }) &
  (IsAbsent<TRoute['_body']> extends true ? {} : { body: TRoute['_body'] });

// {} extends T when T is {} (all-absent route), making the arg optional at call sites
type ClientMethod<TRoute extends AnyRoute> =
  {} extends RouteArgsInput<TRoute>
    ? (args?: RouteArgsInput<TRoute>) => Promise<TRoute['_output']>
    : (args: RouteArgsInput<TRoute>) => Promise<TRoute['_output']>;

type ClientMethodMap<TContract extends Contract> = {
  [K in keyof TContract]: TContract[K] extends AnyRoute
    ? ClientMethod<TContract[K]>
    : never;
};

export type ClientOptions = {
  baseUrl: string;
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
  /** Default: res.json(). Override for envelope APIs: async (res) => (await res.json()).data */
  mapResponse?: (res: Response) => Promise<unknown>;
  /** Default: tries JSON, falls back to text. */
  parseError?: (res: Response) => Promise<unknown>;
};

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(`HTTP ${status}`);
    this.name = 'HttpError';
  }
}

export function createClient<TContract extends Contract>(
  contract: TContract,
  options: ClientOptions,
): ClientMethodMap<TContract> {
  const client = {} as ClientMethodMap<TContract>;
  const fetchFn = options.fetch ?? globalThis.fetch;
  if (!fetchFn) throw new Error('No fetch implementation available. Pass options.fetch or use a runtime with global fetch.');
  const baseUrl = options.baseUrl.replace(/\/$/, '');

  for (const [key, route] of Object.entries(contract)) {
    (client as Record<string, unknown>)[key] = buildMethod(route, baseUrl, fetchFn, options);
  }

  return client;
}

function buildMethod<TRoute extends AnyRoute>(
  route: TRoute,
  baseUrl: string,
  fetchFn: (url: string, init?: RequestInit) => Promise<Response>,
  options: ClientOptions,
): ClientMethod<TRoute> {
  return (async (args: RouteArgsInput<TRoute> = {} as RouteArgsInput<TRoute>) => {
    const { params, query, body } = args as {
      params?: Record<string, string>;
      query?: Record<string, QueryValue>;
      body?: unknown;
    };

    let path = params ? interpolatePath(route.path, params) : route.path;
    if (query) {
      const qs = buildQuery(query);
      if (qs) path += '?' + qs;
    }

    const staticHeaders = typeof options.headers === 'function'
      ? await options.headers()
      : options.headers;
    const headers = new Headers(staticHeaders);

    const isRawBody = body instanceof FormData || body instanceof Blob || body instanceof ReadableStream;
    if (body !== undefined && !isRawBody) {
      headers.set('Content-Type', 'application/json');
    }

    const res = await fetchFn(baseUrl + path, {
      method: route.method,
      headers,
      body:
        body === undefined
          ? undefined
          : isRawBody
            ? (body as BodyInit)
            : JSON.stringify(body),
    });

    if (!res.ok) {
      const errBody = options.parseError
        ? await options.parseError(res)
        : await parseResponseBody(res);
      throw new HttpError(res.status, errBody);
    }

    if (options.mapResponse) return options.mapResponse(res);

    if (res.status === 204) return undefined;
    const ct = res.headers.get('content-type');
    if (!ct) return undefined;
    return res.json();
  }) as ClientMethod<TRoute>;
}

function interpolatePath(path: string, params: Record<string, string>): string {
  return path.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, key) => {
    const val = params[key];
    if (val === undefined) throw new Error(`Missing path param: ${key}`);
    return encodeURIComponent(val);
  });
}

function buildQuery(query: Record<string, QueryValue>): string {
  const p = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) p.append(key, String(v));
    } else {
      p.set(key, String(value));
    }
  }
  return p.toString();
}

async function parseResponseBody(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => '');
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
