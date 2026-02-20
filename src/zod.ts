// Derives route definitions from Zod schemas so types and runtime validation
// share a single source of truth. Import from 'route-contract/zod'.

import type { z } from 'zod';
import { defineRoute, type HttpMethod, type RouteDefinition } from './index.js';

type ZodOrNever<T> = T extends z.ZodTypeAny ? z.infer<T> : never;

type ZRouteConfig<
  TMethod extends HttpMethod,
  TPath extends string,
  TParams extends z.ZodTypeAny | undefined,
  TQuery extends z.ZodTypeAny | undefined,
  TBody extends z.ZodTypeAny | undefined,
  TOutput extends z.ZodTypeAny,
> = {
  method: TMethod;
  path: TPath;
  params?: TParams;
  query?: TQuery;
  output: TOutput;
} & (TMethod extends 'GET' | 'HEAD' ? { body?: never } : { body?: TBody });

type ZRouteResult<
  TMethod extends HttpMethod,
  TPath extends string,
  TParams extends z.ZodTypeAny | undefined,
  TQuery extends z.ZodTypeAny | undefined,
  TBody extends z.ZodTypeAny | undefined,
  TOutput extends z.ZodTypeAny,
> = RouteDefinition<
  TMethod,
  TPath,
  ZodOrNever<TParams>,
  ZodOrNever<TQuery>,
  ZodOrNever<TBody>,
  z.infer<TOutput>
> & {
  schemas: {
    params: TParams;
    query: TQuery;
    body: TBody;
    output: TOutput;
  };
};

export function zRoute<
  TMethod extends HttpMethod,
  TPath extends string,
  TParams extends z.ZodTypeAny | undefined = undefined,
  TQuery extends z.ZodTypeAny | undefined = undefined,
  TBody extends z.ZodTypeAny | undefined = undefined,
  TOutput extends z.ZodTypeAny = z.ZodUnknown,
>(
  config: ZRouteConfig<TMethod, TPath, TParams, TQuery, TBody, TOutput>,
): ZRouteResult<TMethod, TPath, TParams, TQuery, TBody, TOutput> {
  const route = defineRoute({
    method: config.method,
    path: config.path,
    params: undefined as ZodOrNever<TParams>,
    query: undefined as ZodOrNever<TQuery>,
    body: undefined as ZodOrNever<TBody>,
    output: undefined as z.infer<TOutput>,
  });

  return Object.assign(route, {
    schemas: {
      params: config.params as TParams,
      query: config.query as TQuery,
      body: (config as { body?: TBody }).body as TBody,
      output: config.output as TOutput,
    },
  }) as ZRouteResult<TMethod, TPath, TParams, TQuery, TBody, TOutput>;
}
