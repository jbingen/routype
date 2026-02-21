import { describe, it, expect } from 'bun:test';
import { t, defineRoute, createContract, createClient } from '../src/index.js';
import { zRoute } from '../src/zod.js';
import { z } from 'zod';

// compile-time assertion helper
type AssertEqual<T, U> = [T] extends [U] ? ([U] extends [T] ? true : never) : never;
const typeEqual = <T, U>(_check: AssertEqual<T, U>) => {};

describe('type-level behavior', () => {
  it('GET route forbids body at the type level', () => {
    // this compiles
    defineRoute({
      method: 'GET',
      path: '/ok',
      output: t<string>(),
    });

    defineRoute({
      method: 'GET',
      path: '/bad',
      // @ts-expect-error - body on GET should be a compile error
      body: t<{ x: number }>(),
      output: t<string>(),
    });

    expect(true).toBe(true);
  });

  it('POST route allows body', () => {
    const r = defineRoute({
      method: 'POST',
      path: '/ok',
      body: t<{ name: string }>(),
      output: t<{ id: string }>(),
    });
    expect(r.method).toBe('POST');
  });

  it('empty params from Zod do not force args at call site', async () => {
    const healthCheck = zRoute({
      method: 'GET',
      path: '/health',
      params: z.object({}),
      output: z.object({ ok: z.boolean() }),
    });

    const contract = createContract({ healthCheck });

    type HealthMethod = (typeof contract)['healthCheck'];
    // _params inferred as {} from z.object({}) - should be treated as absent
    typeEqual<HealthMethod['_params'], {}>(true);

    expect(true).toBe(true);
  });

  it('client method infers output type correctly', () => {
    type User = { id: string; name: string };

    const getUser = defineRoute({
      method: 'GET',
      path: '/users/:id',
      params: t<{ id: string }>(),
      output: t<User>(),
    });

    const contract = createContract({ getUser });

    type GetUserMethod = ReturnType<typeof createClient<typeof contract>>['getUser'];
    type Result = Awaited<ReturnType<GetUserMethod>>;

    typeEqual<Result, User>(true);
    expect(true).toBe(true);
  });

  it('client method requires params when defined', () => {
    const getUser = defineRoute({
      method: 'GET',
      path: '/users/:id',
      params: t<{ id: string }>(),
      output: t<unknown>(),
    });

    const contract = createContract({ getUser });
    type GetUserMethod = ReturnType<typeof createClient<typeof contract>>['getUser'];

    // should require an argument (not optional)
    type Params = Parameters<GetUserMethod>;
    typeEqual<Params, [args: { params: { id: string } }]>(true);

    expect(true).toBe(true);
  });

  it('client method has optional args for no-input routes', () => {
    const health = defineRoute({
      method: 'GET',
      path: '/health',
      output: t<{ ok: boolean }>(),
    });

    const contract = createContract({ health });
    type HealthMethod = ReturnType<typeof createClient<typeof contract>>['health'];

    // should accept zero args
    type Params = Parameters<HealthMethod>;
    typeEqual<Params, [args?: {}]>(true);

    expect(true).toBe(true);
  });
});
