import { randomUUID } from "node:crypto";
import { pool } from "./db.js";

export async function createTask(input: {
  title: string;
  body: string;
  issueNumber?: number;
}) {
  const id = randomUUID();

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(
      `INSERT INTO tasks
        (id, issue_number, issue_title, issue_body, status)
       VALUES ($1, $2, $3, $4, 'queued')`,
      [
        id,
        input.issueNumber ?? null,
        input.title,
        input.body
      ]
    );

    await client.query(
      `INSERT INTO task_events (task_id, event_type, message)
       VALUES ($1, 'created', 'Task created')`,
      [id]
    );

    await client.query("COMMIT");

    return {
      id,
      title: input.title,
      body: input.body,
      status: "queued"
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateTask(
  id: string,
  status: string,
  message: string,
  data?: {
    plan?: unknown;
    proposal?: unknown;
    error?: string | null;
  }
) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `UPDATE tasks
       SET status = $2,
           plan = COALESCE($3::jsonb, plan),
           proposal = COALESCE($4::jsonb, proposal),
           error = $5,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id`,
      [
        id,
        status,
        data?.plan == null ? null : JSON.stringify(data.plan),
        data?.proposal == null ? null : JSON.stringify(data.proposal),
        data?.error ?? null
      ]
    );

    if (!result.rowCount) {
      throw new Error("Task not found");
    }

    await client.query(
      `INSERT INTO task_events
         (task_id, event_type, message, metadata)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [
        id,
        status,
        message,
        JSON.stringify(data ?? {})
      ]
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}