import { createFileRoute } from "@tanstack/react-router";
import apiRouter from "@/server-app/routes";
import { handleWithRouter } from "@/server-app/express-shim";

const handle = ({ request }: { request: Request }) => handleWithRouter(apiRouter, request);

export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      GET: handle,
      POST: handle,
      PATCH: handle,
      PUT: handle,
      DELETE: handle,
    },
  },
});
