import { describe, it, expect, mock } from 'bun:test';
import { z } from 'zod';
import { zRoute } from '../src/zod.js';
import { createContract, createClient } from '../src/index.js';

const getUser = zRoute({
  method: 'GET',
  path: '/users/:id',
  params: z.object({ id: z.string() }),
  output: z.object({ id: z.string(), name: z.string() }),
});

const createUser = zRoute({
  method: 'POST',
  path: '/users',
  body: z.object({ name: z.string(), email: z.string().email() }),
  output: z.object({ id: z.string(), name: z.string(), email: z.string() }),
});

const contract = createContract({ getUser, createUser });

describe('zRoute', () => {
  it('exposes schemas for runtime validation', () => {
    expect(getUser.schemas.params).toBeInstanceOf(z.ZodObject);
    expect(getUser.schemas.output).toBeInstanceOf(z.ZodObject);
  });

  it('still carries method and path for createClient', () => {
    expect(getUser.method).toBe('GET');
    expect(getUser.path).toBe('/users/:id');
  });

  it('params schema validates correctly', () => {
    const result = getUser.schemas.params!.safeParse({ id: '123' });
    expect(result.success).toBe(true);

    const bad = getUser.schemas.params!.safeParse({ id: 123 });
    expect(bad.success).toBe(false);
  });

  it('body schema validates correctly', () => {
    const result = createUser.schemas.body!.safeParse({
      name: 'Alice',
      email: 'alice@example.com',
    });
    expect(result.success).toBe(true);

    const bad = createUser.schemas.body!.safeParse({
      name: 'Alice',
      email: 'not-an-email',
    });
    expect(bad.success).toBe(false);
  });

  it('works as a normal route in createClient', async () => {
    const fetchFn = mock(async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ id: '1', name: 'Alice' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const client = createClient(contract, {
      baseUrl: 'https://api.example.com',
      fetch: fetchFn,
    });
    const result = await client.getUser({ params: { id: '1' } });
    expect(result).toEqual({ id: '1', name: 'Alice' });
  });
});
