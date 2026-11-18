import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  checkDatabase: vi.fn(),
  getRepositoryFiles: vi.fn(),
  createTaskBranch: vi.fn(),
  applyApprovedFileChanges: vi.fn(),
  createTaskPullRequest: vi.fn(),
  updateTask: vi.fn(),
  createTask: vi.fn(),
  getIssue: vi.fn(),
  runAgent: vi.fn(),
  enqueueIssueTask: vi.fn(),
  runDockerTests: vi.fn(),
}));

vi.mock("./db.js", () => ({
  pool: { query: mocks.query, end: vi.fn() },
  checkDatabase: mocks.checkDatabase,
}));

vi.mock("./github.js", () => ({
  getIssue: mocks.getIssue,
  getRepositoryFiles: mocks.getRepositoryFiles,
  createTaskBranch: mocks.createTaskBranch,
  applyApprovedFileChanges: mocks.applyApprovedFileChanges,
  createTaskPullRequest: mocks.createTaskPullRequest,
}));

vi.mock("./tasks.js", () => ({
  createTask: mocks.createTask,
  updateTask: mocks.updateTask,
}));

vi.mock("./agent.js", () => ({
  runAgent: mocks.runAgent,
}));

vi.mock("./queue.js", () => ({
  enqueueIssueTask: mocks.enqueueIssueTask,
}));

vi.mock("./test-runner.js", () => ({
  runDockerTests: mocks.runDockerTests,
}));

const taskId = "6ec79e38-f6a6-4de5-9737-4c5e0b6d6e0d";

const proposal = {
  explanation: "Add a regression test for input validation.",
  files: [
    {
      path: "src/validation.test.ts",
      content: 'import { describe, it, expect } from "vitest"; describe("validation", () => { it("rejects invalid input", () => { expect(1).toBe(2); }); });',
    },
  ],
  tests: ["Run the validation regression test"],
  limitations: [],
};

describe("approval sandbox safety gate", () => {
  let server: Server;
  let baseUrl: string;
  const previousNodeEnv = process.env.NODE_ENV;
  const previousApprovalToken = process.env.APPROVAL_TOKEN;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.APPROVAL_TOKEN = "integration-test-token";

    const { app } = await import("./server.js");

    server = createServer(app);

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });

    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Could not determine test server address");
    }

    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(() => {
    vi.clearAllMocks();

    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT id, issue_number")) {
        return {
          rowCount: 1,
          rows: [{
            id: taskId,
            issue_number: 1,
            issue_title: "Validate user input",
            issue_body: "Add input validation and tests",
            status: "awaiting_approval",
            proposal,
          }],
        };
      }

      if (sql.includes("UPDATE tasks")) {
        return { rowCount: 1, rows: [{ id: taskId }] };
      }

      throw new Error(`Unexpected database query: ${sql}`);
    });

    mocks.getRepositoryFiles.mockResolvedValue([]);
    mocks.runDockerTests.mockResolvedValue({
      status: "failed",
      exitCode: 1,
      output: "Regression test failed: expected 1 to be 2",
    });
    mocks.updateTask.mockResolvedValue(undefined);
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }

    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }

    if (previousApprovalToken === undefined) {
      delete process.env.APPROVAL_TOKEN;
    } else {
      process.env.APPROVAL_TOKEN = previousApprovalToken;
    }
  });

  it("blocks GitHub changes when sandbox tests fail", async () => {
    const response = await fetch(`${baseUrl}/api/tasks/${taskId}/approve`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-approval-token": "integration-test-token",
      },
      body: JSON.stringify({}),
    });

    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.status).toBe("approval_failed");
    expect(body.testStatus).toBe("failed");

    expect(mocks.updateTask).toHaveBeenCalledWith(
      taskId,
      "approval_failed",
      expect.stringContaining("Sandbox tests did not pass"),
      expect.objectContaining({
        error: expect.stringContaining("Regression test failed"),
      }),
    );

    expect(mocks.createTaskBranch).not.toHaveBeenCalled();
    expect(mocks.applyApprovedFileChanges).not.toHaveBeenCalled();
    expect(mocks.createTaskPullRequest).not.toHaveBeenCalled();
  });
  it("creates a draft PR only after sandbox tests pass", async () => {
    mocks.runDockerTests.mockResolvedValue({
      status: "passed",
      exitCode: 0,
      output: "All sandbox tests passed",
    });

    mocks.createTaskBranch.mockResolvedValue({
      branch: "ai/task-test-branch",
      baseBranch: "main",
    });

    mocks.applyApprovedFileChanges.mockResolvedValue(undefined);

    mocks.createTaskPullRequest.mockResolvedValue({
      number: 42,
      url: "https://github.com/mishthimahajan/ai-agent-demo/pull/42",
    });

    const response = await fetch(
      `${baseUrl}/api/tasks/${taskId}/approve`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-approval-token": "integration-test-token",
        },
        body: JSON.stringify({}),
      },
    );

    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.status).toBe("pr_created");
    expect(body.testStatus).toBe("passed");
    expect(body.branch).toBe("ai/task-test-branch");
    expect(body.pullRequest.number).toBe(42);

    expect(mocks.createTaskBranch).toHaveBeenCalledOnce();
    expect(mocks.applyApprovedFileChanges).toHaveBeenCalledOnce();
    expect(mocks.createTaskPullRequest).toHaveBeenCalledOnce();

    expect(mocks.runDockerTests.mock.invocationCallOrder[0])
      .toBeLessThan(
        mocks.createTaskBranch.mock.invocationCallOrder[0],
      );

    expect(mocks.updateTask).toHaveBeenCalledWith(
      taskId,
      "pr_created",
      expect.stringContaining("Sandbox tests passed"),
      expect.objectContaining({
        plan: expect.objectContaining({
          pullRequestNumber: 42,
          testStatus: "passed",
        }),
      }),
    );
  });
  it("records approval failure when GitHub branch creation fails", async () => {
    mocks.runDockerTests.mockResolvedValue({
      status: "passed",
      exitCode: 0,
      output: "All sandbox tests passed",
    });

    mocks.createTaskBranch.mockRejectedValue(
      new Error("GitHub API unavailable"),
    );

    const response = await fetch(
      `${baseUrl}/api/tasks/${taskId}/approve`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-approval-token": "integration-test-token",
        },
        body: JSON.stringify({}),
      },
    );

    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("Internal server error");

    expect(mocks.createTaskBranch).toHaveBeenCalledOnce();
    expect(mocks.applyApprovedFileChanges).not.toHaveBeenCalled();
    expect(mocks.createTaskPullRequest).not.toHaveBeenCalled();

    expect(mocks.updateTask).toHaveBeenCalledWith(
      taskId,
      "approval_failed",
      expect.stringContaining("inspect GitHub for partial changes"),
      expect.objectContaining({
        error: "GitHub API unavailable",
      }),
    );
  });
});
