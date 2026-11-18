
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { config } from "./config.js";

const connection = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: null
});

export const taskQueue = new Queue("agent-tasks", {
  connection
});

export async function enqueueIssueTask(
  taskId: string,
  issueNumber: number
) {
  return taskQueue.add(
    "analyze-issue",
    { taskId, issueNumber },
    {
      attempts: 2,
      backoff: {
        type: "exponential",
        delay: 2000
      },
      removeOnComplete: 100,
      removeOnFail: 500
    }
  );
}
