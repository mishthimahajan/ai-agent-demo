import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { pool } from "./db.js";

async function migrate() {
  const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
  const schemaPath = path.join(currentDirectory, "schema.sql");

  const schema = await readFile(schemaPath, "utf8");
  await pool.query(schema);

  console.log("Database schema initialized successfully.");
  await pool.end();
}

migrate().catch(async (error) => {
  console.error("Database migration failed:", error);
  await pool.end();
  process.exitCode = 1;
});