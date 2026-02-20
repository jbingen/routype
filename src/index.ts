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

export type RouteDefinition<
  TMethod extends HttpMethod = HttpMethod,
  TPath extends string = string,
  TParams = never,
  TQuery = never,
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
  TParams,
  TQuery,
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
  TParams = never,
  TQuery = never,
  TBody = never,
  TOutput = unknown,
>(
  config: DefineRouteConfig<TMethod, TPath, TParams, TQuery, TBody, TOutput>,
): RouteDefinition<TMethod, TPath, TParams, TQuery, TBody, TOutput> {
  return {
    method: config.method,
    path: config.path,
    _params: config.params as TParams,
    _query: config.query as TQuery,
    _body: (config as { body?: TBody }).body as TBody,
    _output: config.output as TOutput,
  };
}

type AnyRoute = RouteDefinition<HttpMethod, string, any, any, any, any>;
export type Contract = Record<string, AnyRoute>;

export function createContract<T extends Contract>(routes: T): T {
  return routes;
}

type IsNever<T> = [T] extends [never] ? true : false;

type RouteArgsInput<TRoute extends AnyRoute> =
  (IsNever<TRoute['_params']> extends true ? {} : { params: TRoute['_params'] }) &
  (IsNever<TRoute['_query']> extends true ? {} : { query?: TRoute['_query'] }) &
  (IsNever<TRoute['_body']> extends true ? {} : { body: TRoute['_body'] });

// {} extends T when T is {} (all-never route), making the arg optional at call sites
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
  const baseUrl = options.baseUrl.replace(/\/$/, '');

  for (const [key, route] of Object.entries(contract)) {
    (client as Record<string, unknown>)[key] = async (args: {
      params?: Record<string, string>;
      query?: Record<string, unknown>;
      body?: unknown;
    } = {}) => {
      const { params, query, body } = args;

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
    };
  }

  return client;
}

function interpolatePath(path: string, params: Record<string, string>): string {
  return path.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, key) => {
    const val = params[key];
    if (val === undefined) throw new Error(`Missing path param: ${key}`);
    return encodeURIComponent(val);
  });
}

function buildQuery(query: Record<string, unknown>): string {
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
