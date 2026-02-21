# 🛤️ routype

[![npm version](https://img.shields.io/npm/v/routype)](https://www.npmjs.com/package/routype)
[![npm bundle size](https://img.shields.io/bundlephobia/minzip/routype)](https://bundlephobia.com/package/routype)
[![license](https://img.shields.io/github/license/jbingen/routype)](https://github.com/jbingen/routype/blob/main/LICENSE)

Type-safe REST without codegen or framework lock-in.

For teams that already have REST endpoints and want a typed client without introducing RPC, OpenAPI, or a build step.

```
npm install routype
```

```typescript
// before
const user = await fetch(`/users/${id}`).then(r => r.json()) // any

// after
const user = await api.getUser({ params: { id } }) // User
```

You write a typed description of your routes and reuse it on both sides. That's the whole idea.

```typescript
import { t, defineRoute, createContract, createClient } from 'routype';

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

## Why

Tools like tRPC and OpenAPI solve typed API communication by introducing new layers - RPC abstractions, schema files, codegen pipelines. Both work well, but both require buying into more architecture than the problem demands.

routype keeps your existing REST endpoints and adds types on top. You describe your routes with a lightweight helper. TypeScript infers the rest.

Bring your own server, bring your own validator. We only connect the types.

| | routype | tRPC | OpenAPI |
|---|---|---|---|
| Typed client | ✅ | ✅ | ✅ |
| Requires new architecture | ❌ | ✅ | ❌ |
| Code generation | ❌ | ❌ | ✅ |
| Runtime dependency | ❌ | ✅ | ❌ |
| Works with existing REST | ✅ | ⚠️ | ✅ |

## No magic

routype does not:

- generate files or clients
- inspect your server at runtime
- require shared runtime code between client and server
- change how your requests are handled

It's a thin typed wrapper over `fetch`. The core is ~200 lines.

## Quickstart

### 1. Define routes

```typescript
// contract.ts
import { t, defineRoute, createContract } from 'routype';

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
import { createClient } from 'routype';
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

// routes with no input take no arguments
const health = await api.healthCheck();
```

## API

### `t<T>()`

Type helper. Tells TypeScript what shape to expect. Returns `undefined` at runtime - zero cost.

```typescript
params: t<{ id: string }>()
output: t<User>()
```

### `defineRoute(config)`

```typescript
defineRoute({
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS',
  path: '/users/:id',
  params?: t<Params>(),     // path params - stringified and URL-encoded
  query?: t<Query>(),       // query string - primitives and arrays of primitives
  body?: t<Body>(),         // request body - forbidden on GET/HEAD at the type level
  output: t<Output>(),      // response type
})
```

Only `method`, `path`, and `output` are required. Omit params/query/body and the client won't ask for them.

### `createContract(routes)`

Identity function that preserves literal types. Exists for ergonomics and grouping.

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

**`mapResponse`** - transform successful responses. Default parses JSON when content-type includes `application/json` or `+json`, returns text for other content types, `undefined` for 204 or missing content-type.

```typescript
// unwrap an envelope API
createClient(contract, {
  baseUrl: '/api',
  mapResponse: async <T>(res: Response) => (await res.json() as { data: T }).data,
});
```

**`parseError`** - parse error response bodies before attaching to `HttpError`. Default tries JSON, falls back to text.

**`headers`** - static object or async function. Merged into every request. Won't overwrite a Content-Type you set explicitly.

**Serialization:**

- **params** - replaces `:token` segments, stringifies and URL-encodes values
- **query** - `URLSearchParams`, repeats keys for arrays, omits `null`/`undefined`
- **body** - `JSON.stringify` by default, passes through `FormData`/`Blob`/`ReadableStream` as-is

### `HttpError`

Thrown on non-2xx responses. Carries the status code and parsed body.

```typescript
import { HttpError } from 'routype';

try {
  await api.getUser({ params: { id: '999' } });
} catch (e) {
  if (e instanceof HttpError) {
    e.status // 404
    e.body   // parsed JSON or raw text
  }
}
```

## Zod integration

Optional. Import from `routype/zod` to derive types from Zod schemas. One source of truth for both runtime validation and TypeScript types.

```typescript
import { zRoute } from 'routype/zod';
import { z } from 'zod';
import { createContract, createClient } from 'routype';

const getUser = zRoute({
  method: 'GET',
  path: '/users/:id',
  params: z.object({ id: z.string() }),
  output: z.object({ id: z.string(), name: z.string() }),
});

const contract = createContract({ getUser });

// server - validate at runtime
app.get('/users/:id', async (req, res) => {
  const { id } = getUser.schemas.params.parse(req.params);
  const user = await db.users.findById(id);
  res.json(user);
});

// client - fully typed
const api = createClient(contract, { baseUrl: '/api' });
const user = await api.getUser({ params: { id: '1' } });
//    ^? { id: string; name: string }
```

## Framework examples

routype doesn't touch your server. Use the contract types however fits your stack.

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

### Next.js route handlers

```typescript
import { contract } from './contract';

export async function GET(req: Request, { params }: { params: typeof contract.getUser._params }) {
  const user = await db.users.findById(params.id);
  return Response.json(user satisfies typeof contract.getUser._output);
}
```

## Status

Early, but stable. The API surface is intentionally small and expected to remain mostly additive.

## Design decisions

- Zero dependencies. Zod integration is a separate entrypoint.
- No codegen, no schemas required, no build step, no decorators.
- Works with any framework that speaks HTTP.
- Types are compile-time only. Runtime is just fetch with path interpolation and query serialization.
- `body` is forbidden on GET/HEAD at the type level.
- Query values are constrained to primitives and arrays of primitives - matching what `URLSearchParams` can actually serialize.
