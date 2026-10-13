import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@workspace/db": path.resolve(__dirname, "./src/server-app/db/index.ts"),
      "@workspace/db/schema": path.resolve(__dirname, "./src/server-app/db/index.ts"),
      "@workspace/api-zod": path.resolve(__dirname, "./src/lib/api-zod"),
      "@workspace/api-client-react": path.resolve(__dirname, "./src/lib/api-client"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
