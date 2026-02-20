# route-contract

Type-safe REST without codegen or framework lock-in.

Define your HTTP routes once. Get a fully typed client for free. No code generation, no OpenAPI, no RPC abstraction — just TypeScript inference.

```
npm install route-contract
```

---

## How it works

You define routes with a lightweight helper that carries your types. You collect those routes into a contract. You pass the contract to `createClient` and get back a typed fetch wrapper with inferred signatures.

That's it. No magic, no decorators, no build step.

---

## Quickstart

### 1. Define routes (shared between server and client)

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
});
```

### 2. Create a typed client

```typescript
// api.ts (browser / Node / wherever)
import { createClient } from 'route-contract';
import { contract } from './contract';

export const api = createClient(contract, {
  baseUrl: 'https://api.example.com',
});
```

### 3. Call it — fully typed

```typescript
// Params are enforced. Output is inferred.
const user = await api.getUser({ params: { id: '123' } });
//    ^? User

const users = await api.listUsers({ query: { search: 'alice' } });
//    ^? User[]

const newUser = await api.createUser({ body: { name: 'Bob', email: 'b@b.com' } });
//    ^? User

// Routes with no params/query/body need no argument at all
const health = await api.healthCheck();
```

---

## API

### `t<T>()`

A phantom type carrier. Returns `undefined` at runtime, but tells TypeScript what type to use. Zero runtime cost.

```typescript
params: t<{ id: string }>()   // TypeScript sees { id: string }, runtime gets undefined
```

### `defineRoute(config)`

Defines a route. Only `method`, `path`, and `output` are required.

```typescript
defineRoute({
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS',
  path: '/users/:id',
  params?: t<Params>(),     // path params (/users/:id → { id: string })
  query?: t<Query>(),       // query string (?search=alice)
  body?: t<Body>(),         // request body (forbidden on GET/HEAD at type level)
  output: t<Output>(),      // response type
})
```

### `createContract(routes)`

Collects routes into a typed registry. An identity function — its value is the type.

```typescript
const contract = createContract({ getUser, listUsers, createUser });
```

### `createClient(contract, options)`

```typescript
const client = createClient(contract, {
  baseUrl: string,

  // Optional: override the fetch implementation (e.g. for tests, server-side)
  fetch?: typeof globalThis.fetch,

  // Optional: static or dynamic headers merged into every request
  headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>),

  // Optional: map a successful Response to the output type
  // Default: res.json()
  // Override for envelope APIs: async (res) => (await res.json()).data
  mapResponse?: (res: Response) => Promise<unknown>,

  // Optional: parse the body of a non-2xx response
  // Default: tries JSON, falls back to text
  parseError?: (res: Response) => Promise<unknown>,
})
```

**Serialization rules:**

- `params`: replaces `:token` segments, URL-encodes values
- `query`: built with `URLSearchParams`, repeats keys for arrays, omits `null`/`undefined`
- `body`: `JSON.stringify` by default; skips JSON for `FormData`, `Blob`, `ReadableStream`
- GET/HEAD routes reject `body` at the type level

### `HttpError`

Thrown on non-2xx responses.

```typescript
try {
  await api.getUser({ params: { id: 'missing' } });
} catch (e) {
  if (e instanceof HttpError) {
    console.log(e.status); // 404
    console.log(e.body);   // parsed JSON or raw text
  }
}
```

---

## Zod integration

Optional. Import from `route-contract/zod` to derive route types directly from Zod schemas. The `schemas` property gives you validators for server-side use.

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

// Server: validate at runtime
app.get('/users/:id', (req, res) => {
  const params = getUser.schemas.params.parse(req.params);
  // ...
});

// Client: fully typed, no duplication
const client = createClient(contract, { baseUrl: '/api' });
const user = await client.getUser({ params: { id: '1' } });
//    ^? { id: string; name: string }
```

---

## Server usage

`route-contract` doesn't touch your server. Use the contract to keep your handler types consistent:

```typescript
// Express
import type { RouteDefinition } from 'route-contract';
import { contract } from './contract';

app.get('/users/:id', async (req, res) => {
  type Params = typeof contract.getUser._params; // { id: string }
  const { id } = req.params as Params;
  const user = await db.users.findById(id);
  res.json(user satisfies typeof contract.getUser._output);
});
```

---

## Philosophy

- Core is dependency-free. Bring your own validator.
- No codegen, no schemas required, no build step.
- Works with any framework that speaks HTTP.
- Runtime cost is a thin fetch wrapper. Types are compile-time only.
- Add Zod or your own validator on top — it earns its complexity.
