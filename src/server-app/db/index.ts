import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool } from "@neondatabase/serverless";
import * as schema from "./schema";

function databaseUrl(): string {
  const url = process.env["NEON_DATABASE_URL"] ?? process.env["DATABASE_URL"];
  if (!url) {
    throw new Error(
      "NEON_DATABASE_URL or DATABASE_URL must be set. " +
        "Copy .env.example to .env and add your Neon connection string.",
    );
  }
  return url;
}

function forward<T extends object>(getTarget: () => T): T {
  return new Proxy({} as T, {
    get: (_target, prop) => Reflect.get(getTarget(), prop as keyof T),
    set: (_target, prop, value) => {
      Reflect.set(getTarget(), prop as keyof T, value);
      return true;
    },
    has: (_target, prop) => Reflect.has(getTarget(), prop as keyof T),
  });
}

let poolInstance: Pool | undefined;
function getPool(): Pool {
  if (!poolInstance) {
    poolInstance = new Pool({ connectionString: databaseUrl() });
  }
  return poolInstance;
}

// Lazy: importing this module never throws, so health checks and pages that
// don't touch the DB keep working without credentials. The error surfaces
// only when the DB is actually used.
export const pool: Pool = forward(getPool);

let dbInstance: ReturnType<typeof drizzle> | undefined;
function getDb(): ReturnType<typeof drizzle> {
  if (!dbInstance) {
    dbInstance = drizzle(getPool(), { schema });
  }
  return dbInstance;
}

export const db: ReturnType<typeof drizzle> = forward(getDb);

export * from "./schema";
