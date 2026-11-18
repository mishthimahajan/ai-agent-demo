
import express from "express";
import cors from "cors";
import { z } from "zod";
import { randomUUID } from "node:crypto";

import { config } from "./config.js";
import { pool, checkDatabase } from "./db.js";

import {
  getIssue,
  getRepositoryFiles,
  createTaskBranch,
  applyApprovedFileChanges,
  createTaskPullRequest,
} from "./github.js";

import { runAgent } from "./agent.js";
import { validateTypeScriptSyntax } from "./proposal-validation.js";
import { createTask, updateTask } from "./tasks.js";
import { enqueueIssueTask } from "./queue.js";

import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
} from "node:fs/promises";

import { tmpdir } from "node:os";

import {
  dirname,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import { isAllowedProposalPath } from "./proposal-path-validation.js";
import { runDockerTests } from "./test-runner.js";

const app = express();

app.use(cors({ origin: config.FRONTEND_ORIGIN }));
app.use(express.json({ limit: "1mb" }));

const ApprovalProposalSchema = z
  .object({
    explanation: z.string().min(1).max(10000),
    files: z
      .array(
        z
          .object({
            path: z.string().min(1).max(200),
            content: z.string().max(100000),
          })
          .strict()
      )
      .min(1)
      .max(10),
    tests: z.array(z.string().min(1)).min(1).max(10),
    limitations: z.array(z.string()).max(10),
  })
  .strict();

async function createTestWorkspace(
  repositoryFiles: Awaited<ReturnType<typeof getRepositoryFiles>>,
  proposalFiles: Array<{ path: string; content: string }>
): Promise<string> {
  const workspacePath = await mkdtemp(
    join(tmpdir(), "ai-agent-test-workspace-")
  );

  try {
    const files = new Map<string, string>();

    for (const file of repositoryFiles) {
      if (isAllowedProposalPath(file.path)) {
        files.set(file.path, file.content);
      }
    }

    for (const file of proposalFiles) {
      if (!isAllowedProposalPath(file.path)) {
        throw new Error(
          `Disallowed test workspace path: ${file.path}`
        );
      }

      files.set(file.path, file.content);
    }

    for (const [filePath, content] of files) {
      const destination = resolve(workspacePath, filePath);
      const relativePath = relative(workspacePath, destination);

      if (
        relativePath === "" ||
        relativePath === ".." ||
        relativePath.startsWith(`..${sep}`) ||
        resolve(destination) === resolve(workspacePath)
      ) {
        throw new Error(`Invalid workspace path: ${filePath}`);
      }

      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, content, "utf8");
    }

    return workspacePath;
  } catch (error) {
    await rm(workspacePath, {
      recursive: true,
      force: true,
    });

    throw error;
  }
}

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "ai-software-engineer-api",
  });
});

const CreateTaskSchema = z
  .object({
    issueNumber: z.number().int().positive(),
  })
  .strict();

app.post("/api/tasks", async (req, res, next) => {
  try {
    // 1. Validate the request body.
    const parsed = CreateTaskSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid request. Provide a positive integer issueNumber.",
      });
    }

    // 2. Fetch the real issue from the configured GitHub repository.
    const issue = await getIssue(parsed.data.issueNumber);

    // 3. Create a database task.
    const task = await createTask({
      issueNumber: issue.number,
      title: issue.title,
      body: issue.body,
    });

    // 4. Enqueue the task for the background worker.
    try {
      await enqueueIssueTask(task.id, issue.number);
    } catch (queueError) {
      const message =
        queueError instanceof Error
          ? queueError.message
          : "Unknown queue error";

      // Do not leave a task marked as queued if enqueueing failed.
      await updateTask(
        task.id,
        "failed",
        "Failed to enqueue GitHub issue for processing",
        { error: message }
      );

      return res.status(503).json({
        error: "Task created but could not be queued",
        taskId: task.id,
        status: "failed",
      });
    }

    // 5. Return the new task details.
    return res.status(202).json({
      taskId: task.id,
      issueNumber: issue.number,
      title: issue.title,
      status: "queued",
    });
  } catch (error) {
    next(error);
  }
});


app.post("/api/tasks/:id/approve", async (req, res, next) => {
  let workspacePath: string | undefined;
  let taskReserved = false;

  try {
    const idResult = z.string().uuid().safeParse(req.params.id);

    if (!idResult.success) {
      return res.status(400).json({ error: "Invalid task ID" });
    }

    const expectedToken = process.env.APPROVAL_TOKEN;
    const suppliedToken = req.get("x-approval-token");

    if (
      !expectedToken ||
      !suppliedToken ||
      suppliedToken !== expectedToken
    ) {
      return res.status(401).json({
        error: "Approval authentication failed",
      });
    }

    const result = await pool.query(
      `SELECT id, issue_number, issue_title, issue_body,
              status, proposal
       FROM tasks
       WHERE id = $1`,
      [idResult.data]
    );

    if (!result.rowCount) {
      return res.status(404).json({ error: "Task not found" });
    }

    const task = result.rows[0];

    if (task.status !== "awaiting_approval") {
      return res.status(409).json({
        error: "Task is not awaiting approval",
        status: task.status,
      });
    }

    const parsed = ApprovalProposalSchema.safeParse(task.proposal);

    if (!parsed.success) {
      return res.status(422).json({
        error: "Saved proposal failed validation",
        details: parsed.error.flatten(),
      });
    }

    const proposal = parsed.data;

    const syntaxErrors = validateTypeScriptSyntax(proposal.files);

    if (syntaxErrors.length > 0) {
      return res.status(422).json({
        error: "Proposal contains TypeScript syntax errors",
        details: syntaxErrors,
      });
    }

    // Require a test/spec file containing recognizable test code.
    const hasTestFile = proposal.files.some((file) => {
      const normalizedPath = file.path.replace(/\\/g, "/");

      const isTestFile =
        /(^|\/)[^/]+\.(test|spec)\.(ts|tsx|js|jsx|mts|cts)$/.test(
          normalizedPath
        );

      const containsTestCode =
        /\b(describe|it|test|expect)\s*\(/.test(file.content);

      return isTestFile && containsTestCode;
    });

    if (!hasTestFile) {
      return res.status(422).json({
        error:
          "Proposal must include a test/spec file with actual test code.",
      });
    }

    // Atomically reserve the task to prevent duplicate approvals.
    const reservation = await pool.query(
      `UPDATE tasks
       SET status = 'approval_in_progress',
           updated_at = NOW()
       WHERE id = $1
         AND status = 'awaiting_approval'
       RETURNING id`,
      [task.id]
    );

    if (!reservation.rowCount) {
      return res.status(409).json({
        error: "Task approval is already in progress or completed",
      });
    }

    taskReserved = true;

    try {
      // 1. Fetch repository files and build an isolated workspace.
      const repositoryFiles = await getRepositoryFiles();

      workspacePath = await createTestWorkspace(
        repositoryFiles,
        proposal.files
      );

      // 2. Run sandbox tests BEFORE any GitHub changes.
      const testResult = await runDockerTests({
        workspacePath,
        timeoutMs: 60_000,
      });

      if (testResult.status !== "passed") {
        const testOutput = testResult.output.slice(-4000);

        await updateTask(
          task.id,
          "approval_failed",
          "Sandbox tests did not pass; no branch or pull request was created",
          {
            error: `Sandbox tests ${testResult.status}. ${testOutput}`,
          }
        );

        taskReserved = false;

        return res.status(422).json({
          status: "approval_failed",
          error: "Proposed changes did not pass sandbox tests",
          testStatus: testResult.status,
          testOutput,
        });
      }

      // 3. Create a branch ONLY after the tests pass.
      const { branch, baseBranch } = await createTaskBranch(task.id);

      await applyApprovedFileChanges({
        branch,
        files: proposal.files,
      });

      // 4. Create a draft pull request after successful testing.
      const pullRequest = await createTaskPullRequest({
        branch,
        baseBranch,
        title: `AI proposal: ${task.issue_title}`,
        body: [
          "## AI-generated changes",
          "",
          proposal.explanation,
          "",
          "## Sandbox test result",
          "",
          "Docker test suite passed before branch creation.",
          "",
          "## Tests",
          ...proposal.tests.map((test) => `- ${test}`),
          "",
          "## Limitations",
          ...proposal.limitations.map((item) => `- ${item}`),
          "",
          "Created as a draft for human review.",
        ].join("\n"),
      });

      await updateTask(
        task.id,
        "pr_created",
        "Sandbox tests passed; changes pushed to a task branch and draft PR created",
        {
          plan: {
            branch,
            baseBranch,
            pullRequestNumber: pullRequest.number,
            pullRequestUrl: pullRequest.url,
            testStatus: testResult.status,
          },
        }
      );

      taskReserved = false;

      return res.status(201).json({
        status: "pr_created",
        branch,
        pullRequest,
        testStatus: testResult.status,
      });
    } catch (error) {
      if (taskReserved) {
        try {
          await updateTask(
            task.id,
            "approval_failed",
            "Approval workflow failed; inspect GitHub for partial changes",
            {
              error:
                error instanceof Error
                  ? error.message
                  : "Unknown approval workflow error",
            }
          );
        } catch (statusUpdateError) {
          console.error(
            "Failed to record approval failure for task:",
            task.id,
            statusUpdateError
          );
        } finally {
          taskReserved = false;
        }
      }

      throw error;
    } finally {
      if (workspacePath) {
        try {
          await rm(workspacePath, {
            recursive: true,
            force: true,
          });
        } catch (cleanupError) {
          console.error(
            "Failed to clean up temporary test workspace:",
            cleanupError
          );
        }
      }
    }
  } catch (error) {
    next(error);
  }
});

app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    if (res.headersSent) {
      return next(error);
    }

    console.error("Unhandled request error:", error);

    return res.status(500).json({
      error: "Internal server error",
    });
  }
);

export { app };

if (process.env.NODE_ENV !== "test") {
  void (async () => {
    try {
      await checkDatabase();

      app.listen(config.PORT, () => {
        console.log(
          `AI Software Engineer API running on port ${config.PORT}`
        );
      });
    } catch (error) {
      console.error("Failed to start API server:", error);
      await pool.end();
      process.exitCode = 1;
    }
  })();
}
