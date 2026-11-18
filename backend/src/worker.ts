import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { config } from "./config.js";
import { pool } from "./db.js";
import { getIssue, getRepositoryFiles } from "./github.js";
import { runAgent } from "./agent.js";
import { updateTask } from "./tasks.js";

const connection = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: null
});

const worker = new Worker(
  "agent-tasks",
  async (job) => {
    const { taskId, issueNumber } = job.data as {
      taskId: string;
      issueNumber: number;
    };

    try {
      await updateTask(
        taskId,
        "planning",
        "Worker started analyzing the issue"
      );

      const issue = await getIssue(issueNumber);
      const files = await getRepositoryFiles();

      const result = await runAgent({
        issueTitle: issue.title,
        issueBody: issue.body,
        repositoryContext: JSON.stringify(files.slice(0, 100))
      });

      await updateTask(
        taskId,
        "awaiting_approval",
        "Proposal generated for review",
        {
          plan: result.plan,
          proposal: result.proposal
        }
      );

      return {
        taskId,
        status: "awaiting_approval"
      };
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "Unknown worker error";

      await updateTask(
        taskId,
        "failed",
        "Task failed",
        { error: message }
      );

      throw error;
    }
  },
  {
    connection,
    concurrency: 2
  }
);

worker.on("completed", (job) => {
  console.log(`Job ${job.id} completed`);
});

worker.on("failed", (job, error) => {
  console.error(`Job ${job?.id} failed:`, error.message);
});

async function shutdown() {
  await worker.close();
  await connection.quit();
  await pool.end();
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());