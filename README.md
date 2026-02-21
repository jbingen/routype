# route-contract

Type-safe REST without codegen or framework lock-in.

```
npm install route-contract
```

Define your routes once, get a fully typed client. No code generation, no OpenAPI, no RPC abstraction. Just TypeScript inference.

```typescript
import { t, defineRoute, createContract, createClient } from 'route-contract';

type User = { id: string; name: string; email: string };

const contract = createContract({
  getUser: defineRoute({
    method: 'GET',
    path: '/users/:id',
    params: t<{ id: string }>(),
    output: t<User>(),
  }),

  createUser: defineRoute({
    method: 'POST',
    path: '/users',
    body: t<{ name: string; email: string }>(),
    output: t<User>(),
  }),
});

const api = createClient(contract, { baseUrl: 'https://api.example.com' });

const user = await api.getUser({ params: { id: '123' } });
//    ^? User

const created = await api.createUser({ body: { name: 'Alice', email: 'a@a.com' } });
//    ^? User
```

Params, query, body, and output are all inferred. Wrong shapes are compile errors.

---

## Why this exists

tRPC gives you end-to-end type safety, but replaces your REST routes with an RPC abstraction. OpenAPI gives you contracts, but requires schemas and codegen. Both are powerful but heavy.

Sometimes you just want: "here are my REST routes, give me a typed client."

That's all this does. Bring your own server, bring your own validator. We only connect the types.

---

## Quickstart

### 1. Define routes

```typescript
// contract.ts
import { t, defineRoute, createContract } from 'route-contract';

type User = { id: string; name: string; email: string };

export const contract = createContract({
  getUser: defineRoute({
    method: 'GET',
    path: '/users/:id',
    params: t<{ id: string }>(),
    output: t<User>(),
  }),

  listUsers: defineRoute({
    method: 'GET',
    path: '/users',
    query: t<{ search?: string; limit?: number }>(),
    output: t<User[]>(),
  }),

  createUser: defineRoute({
    method: 'POST',
    path: '/users',
    body: t<{ name: string; email: string }>(),
    output: t<User>(),
  }),

  deleteUser: defineRoute({
    method: 'DELETE',
    path: '/users/:id',
    params: t<{ id: string }>(),
    output: t<void>(),
  }),
});
```

### 2. Create a client

```typescript
// api.ts
import { createClient } from 'route-contract';
import { contract } from './contract';

export const api = createClient(contract, {
  baseUrl: 'https://api.example.com',
  headers: () => ({ Authorization: `Bearer ${getToken()}` }),
});
```

### 3. Call it

```typescript
const user = await api.getUser({ params: { id: '123' } });
//    ^? User

const users = await api.listUsers({ query: { search: 'alice', limit: 10 } });
//    ^? User[]

const created = await api.createUser({ body: { name: 'Bob', email: 'b@b.com' } });
//    ^? User

// No-arg routes just work
const health = await api.healthCheck();
```

---

## API

### `t<T>()`

Phantom type carrier. Returns `undefined` at runtime, tells TypeScript the type at compile time.

```typescript
params: t<{ id: string }>()
output: t<User>()
```

### `defineRoute(config)`

```typescript
defineRoute({
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS',
  path: '/users/:id',
  params?: t<Params>(),     // path params — values are stringified and URL-encoded
  query?: t<Query>(),       // query string — primitives and arrays of primitives
  body?: t<Body>(),         // request body — forbidden on GET/HEAD at the type level
  output: t<Output>(),      // response type
})
```

### `createContract(routes)`

Identity function that preserves literal types. Its value is the type.

```typescript
const contract = createContract({ getUser, listUsers, createUser });
```

### `createClient(contract, options)`

```typescript
const client = createClient(contract, {
  baseUrl: string,
  fetch?: (url: string, init?: RequestInit) => Promise<Response>,
  headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>),
  mapResponse?: <T>(res: Response) => Promise<T>,
  parseError?: (res: Response) => Promise<unknown>,
});
```

**`mapResponse`** — transform successful responses. Default parses JSON when content-type is `application/json` or `+json`, returns text for other content types, `undefined` for no content.

```typescript
// Envelope API
createClient(contract, {
  baseUrl: '/api',
  mapResponse: async <T>(res: Response) => (await res.json() as { data: T }).data,
});
```

**`parseError`** — parse error response bodies for `HttpError`. Default tries JSON, falls back to text.

**`headers`** — static object or async function, merged into every request. Won't clobber a Content-Type you set explicitly.

**Serialization:**

- **params**: replaces `:token` segments, stringifies and URL-encodes values
- **query**: `URLSearchParams`, repeats keys for arrays, omits `null`/`undefined`
- **body**: `JSON.stringify` by default; passes through `FormData`, `Blob`, `ReadableStream` as-is

### `HttpError`

Thrown on non-2xx responses.

```typescript
import { HttpError } from 'route-contract';

try {
  await api.getUser({ params: { id: '999' } });
} catch (e) {
  if (e instanceof HttpError) {
    console.log(e.status); // 404
    console.log(e.body);   // parsed JSON or raw text
  }
}
```

---

## Zod integration

Optional. Import from `route-contract/zod` to derive types from Zod schemas. You get runtime validation and type inference from a single source of truth.

```typescript
import { zRoute } from 'route-contract/zod';
import { z } from 'zod';
import { createContract, createClient } from 'route-contract';

const getUser = zRoute({
  method: 'GET',
  path: '/users/:id',
  params: z.object({ id: z.string() }),
  output: z.object({ id: z.string(), name: z.string() }),
});

const contract = createContract({ getUser });

// Server — validate at runtime
app.get('/users/:id', (req, res) => {
  const { id } = getUser.schemas.params.parse(req.params);
  const user = await db.users.findById(id);
  res.json(user);
});

// Client — fully typed
const api = createClient(contract, { baseUrl: '/api' });
const user = await api.getUser({ params: { id: '1' } });
//    ^? { id: string; name: string }
```

---

## Framework examples

route-contract doesn't touch your server. Use the contract however fits your framework.

### Express

```typescript
import { contract } from './contract';

app.get('/users/:id', async (req, res) => {
  const { id } = req.params as typeof contract.getUser._params;
  const user = await db.users.findById(id);
  res.json(user satisfies typeof contract.getUser._output);
});
```

### Hono

```typescript
import { contract } from './contract';

app.get('/users/:id', async (c) => {
  const { id } = c.req.param() as typeof contract.getUser._params;
  const user = await db.users.findById(id);
  return c.json(user satisfies typeof contract.getUser._output);
});
```

### Next.js Route Handlers

```typescript
import { contract } from './contract';

export async function GET(req: Request, { params }: { params: typeof contract.getUser._params }) {
  const user = await db.users.findById(params.id);
  return Response.json(user satisfies typeof contract.getUser._output);
}
```

---

## Design

- Zero dependencies. Bring your own validator if you want one.
- No codegen, no schemas required, no build step, no decorators.
- Works with any framework that speaks HTTP.
- Runtime is a thin fetch wrapper. Types are compile-time only.
- ~200 lines of TypeScript.
