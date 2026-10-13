/**
 * Minimal Express-compatible router used to run the original API server
 * handlers inside the edge runtime (no Node http server available).
 * Only the small surface the app relies on is implemented.
 */

export type ShimRequest = {
  method: string;
  path: string;
  params: Record<string, string>;
  query: Record<string, string | undefined>;
  body: unknown;
  headers: Record<string, string>;
};

export type ShimResponse = {
  statusCode: number;
  headersSent: boolean;
  status(code: number): ShimResponse;
  json(data: unknown): ShimResponse;
  send(data: unknown): ShimResponse;
  setHeader(name: string, value: string): ShimResponse;
  end(): ShimResponse;
};

type Handler = (req: ShimRequest, res: ShimResponse) => unknown | Promise<unknown>;

type Layer =
  | { kind: "route"; method: string; segments: string[]; handler: Handler }
  | { kind: "router"; router: IRouter };

export interface IRouter {
  layers: Layer[];
  get(path: string, handler: Handler): IRouter;
  post(path: string, handler: Handler): IRouter;
  patch(path: string, handler: Handler): IRouter;
  put(path: string, handler: Handler): IRouter;
  delete(path: string, handler: Handler): IRouter;
  use(router: IRouter): IRouter;
}

function splitPath(path: string): string[] {
  return path.split("/").filter(Boolean);
}

export function Router(): IRouter {
  const layers: Layer[] = [];

  const add = (method: string) => (path: string, handler: Handler) => {
    layers.push({ kind: "route", method, segments: splitPath(path), handler });
    return router;
  };

  const router: IRouter = {
    layers,
    get: add("GET"),
    post: add("POST"),
    patch: add("PATCH"),
    put: add("PUT"),
    delete: add("DELETE"),
    use(sub: IRouter) {
      layers.push({ kind: "router", router: sub });
      return router;
    },
  };

  return router;
}

type Matched = { handler: Handler; params: Record<string, string> };

function matchRouter(
  router: IRouter,
  method: string,
  segments: string[],
): Matched | null {
  for (const layer of router.layers) {
    if (layer.kind === "router") {
      const found = matchRouter(layer.router, method, segments);
      if (found) return found;
      continue;
    }
    if (layer.method !== method) continue;
    if (layer.segments.length !== segments.length) continue;

    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < layer.segments.length; i += 1) {
      const pattern = layer.segments[i]!;
      const value = segments[i]!;
      if (pattern.startsWith(":")) {
        params[pattern.slice(1)] = decodeURIComponent(value);
      } else if (pattern !== value) {
        ok = false;
        break;
      }
    }
    if (ok) return { handler: layer.handler, params };
  }
  return null;
}

function createResponse(): {
  res: ShimResponse;
  finalize: () => Response;
} {
  let status = 200;
  let body: BodyInit | null = null;
  const headers = new Headers();

  const res: ShimResponse = {
    statusCode: 200,
    headersSent: false,
    status(code: number) {
      status = code;
      res.statusCode = code;
      return res;
    },
    json(data: unknown) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(data);
      res.headersSent = true;
      return res;
    },
    send(data: unknown) {
      if (typeof data === "string") {
        if (!headers.has("content-type")) headers.set("content-type", "text/plain; charset=utf-8");
        body = data;
      } else if (data !== undefined && data !== null) {
        headers.set("content-type", "application/json");
        body = JSON.stringify(data);
      }
      res.headersSent = true;
      return res;
    },
    setHeader(name: string, value: string) {
      headers.set(name, value);
      return res;
    },
    end() {
      res.headersSent = true;
      return res;
    },
  };

  return {
    res,
    finalize: () => new Response(body, { status, headers }),
  };
}

/** Dispatch a fetch Request against a shim router mounted at `/api`. */
export async function handleWithRouter(
  router: IRouter,
  request: Request,
): Promise<Response> {
  const url = new URL(request.url);
  const segments = splitPath(url.pathname.replace(/^\/api/, ""));
  const matched = matchRouter(router, request.method.toUpperCase(), segments);

  if (!matched) {
    return new Response(JSON.stringify({ message: "Not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  let body: unknown = undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    const text = await request.text();
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
  }

  const query: Record<string, string | undefined> = {};
  url.searchParams.forEach((value, key) => {
    query[key] = value;
  });

  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });

  const req: ShimRequest = {
    method: request.method.toUpperCase(),
    path: url.pathname,
    params: matched.params,
    query,
    body,
    headers,
  };

  const { res, finalize } = createResponse();

  try {
    await matched.handler(req, res);
  } catch (error) {
    console.error("[api] handler error", error);
    return new Response(
      JSON.stringify({ message: (error as Error)?.message ?? "Internal error" }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }

  return finalize();
}
