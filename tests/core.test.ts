import { describe, it, expect, mock } from 'bun:test';
import {
  t,
  defineRoute,
  createContract,
  createClient,
  HttpError,
} from '../src/index.js';

type User = { id: string; name: string; email: string };

const getUser = defineRoute({
  method: 'GET',
  path: '/users/:id',
  params: t<{ id: string }>(),
  output: t<User>(),
});

const listUsers = defineRoute({
  method: 'GET',
  path: '/users',
  query: t<{ search?: string; limit?: number }>(),
  output: t<User[]>(),
});

const createUser = defineRoute({
  method: 'POST',
  path: '/users',
  body: t<{ name: string; email: string }>(),
  output: t<User>(),
});

const updateUser = defineRoute({
  method: 'PATCH',
  path: '/users/:id',
  params: t<{ id: string }>(),
  body: t<Partial<Pick<User, 'name' | 'email'>>>(),
  output: t<User>(),
});

const deleteUser = defineRoute({
  method: 'DELETE',
  path: '/users/:id',
  params: t<{ id: string }>(),
  output: t<void>(),
});

const noArgRoute = defineRoute({
  method: 'GET',
  path: '/health',
  output: t<{ ok: boolean }>(),
});

const contract = createContract({
  getUser,
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  noArgRoute,
});

type MockFetch = ReturnType<typeof mock<(url: string, init?: RequestInit) => Promise<Response>>>;

function mockFetch(
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): MockFetch {
  return mock(async (_url: string, _init?: RequestInit) =>
    new Response(
      body === undefined ? null : JSON.stringify(body),
      {
        status,
        headers: { 'content-type': 'application/json', ...extraHeaders },
      },
    ),
  );
}

function makeClient(fetchFn: MockFetch) {
  return createClient(contract, {
    baseUrl: 'https://api.example.com',
    fetch: fetchFn,
  });
}

describe('defineRoute', () => {
  it('captures method and path at runtime', () => {
    expect(getUser.method).toBe('GET');
    expect(getUser.path).toBe('/users/:id');
  });

  it('phantom fields are undefined at runtime', () => {
    expect(getUser._params).toBeUndefined();
    expect(getUser._output).toBeUndefined();
  });
});

describe('createClient - path interpolation', () => {
  it('interpolates a single param', async () => {
    const fetchFn = mockFetch(200, { id: '1', name: 'Alice', email: 'a@example.com' });
    const client = makeClient(fetchFn);
    await client.getUser({ params: { id: '42' } });
    const [url] = fetchFn.mock.calls[0]!;
    expect(url).toBe('https://api.example.com/users/42');
  });

  it('URL-encodes param values', async () => {
    const fetchFn = mockFetch(200, { id: 'a b', name: 'A', email: 'a@example.com' });
    const client = makeClient(fetchFn);
    await client.getUser({ params: { id: 'hello world' } });
    const [url] = fetchFn.mock.calls[0]!;
    expect(url).toBe('https://api.example.com/users/hello%20world');
  });

  it('throws if a required param is missing', async () => {
    const fetchFn = mockFetch(200, {});
    const client = makeClient(fetchFn);
    // @ts-expect-error - deliberately passing wrong params to test runtime guard
    await expect(client.getUser({ params: {} })).rejects.toThrow('Missing path param: id');
  });
});

describe('createClient - query serialization', () => {
  it('appends query string', async () => {
    const fetchFn = mockFetch(200, []);
    const client = makeClient(fetchFn);
    await client.listUsers({ query: { search: 'alice', limit: 10 } });
    const [url] = fetchFn.mock.calls[0]!;
    expect(url).toContain('search=alice');
    expect(url).toContain('limit=10');
  });

  it('omits null/undefined query values', async () => {
    const fetchFn = mockFetch(200, []);
    const client = makeClient(fetchFn);
    await client.listUsers({ query: { search: undefined, limit: 5 } });
    const [url] = fetchFn.mock.calls[0]!;
    expect(url).not.toContain('search');
    expect(url).toContain('limit=5');
  });

  it('works with no query provided', async () => {
    const fetchFn = mockFetch(200, []);
    const client = makeClient(fetchFn);
    await client.listUsers();
    const [url] = fetchFn.mock.calls[0]!;
    expect(url).toBe('https://api.example.com/users');
  });
});

describe('createClient - request body', () => {
  it('sends JSON body with content-type', async () => {
    const fetchFn = mockFetch(200, { id: '1', name: 'Bob', email: 'b@example.com' });
    const client = makeClient(fetchFn);
    await client.createUser({ body: { name: 'Bob', email: 'b@example.com' } });
    const [, init] = fetchFn.mock.calls[0]!;
    expect(init?.body).toBe('{"name":"Bob","email":"b@example.com"}');
    expect((init?.headers as Headers).get('Content-Type')).toBe('application/json');
  });

  it('sets method correctly', async () => {
    const fetchFn = mockFetch(200, { id: '1', name: 'Bob', email: 'b@example.com' });
    const client = makeClient(fetchFn);
    await client.createUser({ body: { name: 'Bob', email: 'b@example.com' } });
    const [, init] = fetchFn.mock.calls[0]!;
    expect(init?.method).toBe('POST');
  });
});

describe('createClient - no-arg routes', () => {
  it('calls without arguments', async () => {
    const fetchFn = mockFetch(200, { ok: true });
    const client = makeClient(fetchFn);
    const result = await client.noArgRoute();
    expect(result).toEqual({ ok: true });
  });
});

describe('createClient - response handling', () => {
  it('returns parsed JSON on success', async () => {
    const user: User = { id: '1', name: 'Alice', email: 'a@example.com' };
    const fetchFn = mockFetch(200, user);
    const client = makeClient(fetchFn);
    const result = await client.getUser({ params: { id: '1' } });
    expect(result).toEqual(user);
  });

  it('returns undefined on 204', async () => {
    const fetchFn = mock(async (_url: string, _init?: RequestInit) => new Response(null, { status: 204 }));
    const client = makeClient(fetchFn);
    const result = await client.deleteUser({ params: { id: '1' } });
    expect(result).toBeUndefined();
  });

  it('throws HttpError on non-2xx', async () => {
    const fetchFn = mockFetch(404, { message: 'not found' });
    const client = makeClient(fetchFn);
    await expect(client.getUser({ params: { id: '999' } })).rejects.toThrow(HttpError);
  });

  it('HttpError has status and body', async () => {
    const fetchFn = mockFetch(422, { message: 'invalid' });
    const client = makeClient(fetchFn);
    try {
      await client.getUser({ params: { id: '999' } });
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      expect((e as HttpError).status).toBe(422);
      expect((e as HttpError).body).toEqual({ message: 'invalid' });
    }
  });
});

describe('createClient - options', () => {
  it('mapResponse can unwrap an envelope', async () => {
    const fetchFn = mock(async (_url: string, _init?: RequestInit) =>
      new Response(
        JSON.stringify({ data: { id: '1', name: 'Alice', email: 'a@example.com' } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const client = createClient(contract, {
      baseUrl: 'https://api.example.com',
      fetch: fetchFn,
      mapResponse: async (res) => (await res.json() as { data: unknown }).data,
    });
    const result = await client.getUser({ params: { id: '1' } });
    expect(result).toEqual({ id: '1', name: 'Alice', email: 'a@example.com' });
  });

  it('parseError is called on non-2xx', async () => {
    const parseError = mock(async (res: Response) => ({ parsed: true, status: res.status }));
    const fetchFn = mockFetch(500, { raw: true });
    const client = createClient(contract, {
      baseUrl: 'https://api.example.com',
      fetch: fetchFn,
      parseError,
    });
    try {
      await client.getUser({ params: { id: '1' } });
    } catch (e) {
      expect((e as HttpError).body).toEqual({ parsed: true, status: 500 });
    }
    expect(parseError).toHaveBeenCalledTimes(1);
  });

  it('merges static headers', async () => {
    const fetchFn = mockFetch(200, { ok: true });
    const client = createClient(contract, {
      baseUrl: 'https://api.example.com',
      fetch: fetchFn,
      headers: { Authorization: 'Bearer token123' },
    });
    await client.noArgRoute();
    const [, init] = fetchFn.mock.calls[0]!;
    expect((init?.headers as Headers).get('Authorization')).toBe('Bearer token123');
  });

  it('merges dynamic headers', async () => {
    const fetchFn = mockFetch(200, { ok: true });
    const client = createClient(contract, {
      baseUrl: 'https://api.example.com',
      fetch: fetchFn,
      headers: async () => ({ 'X-Request-ID': 'abc' }),
    });
    await client.noArgRoute();
    const [, init] = fetchFn.mock.calls[0]!;
    expect((init?.headers as Headers).get('X-Request-ID')).toBe('abc');
  });
});

describe('createClient - baseUrl', () => {
  it('strips trailing slash', async () => {
    const fetchFn = mockFetch(200, { ok: true });
    const client = createClient(contract, {
      baseUrl: 'https://api.example.com/',
      fetch: fetchFn,
    });
    await client.noArgRoute();
    const [url] = fetchFn.mock.calls[0]!;
    expect(url).toBe('https://api.example.com/health');
  });
});
