
import { Octokit } from "@octokit/rest";
import { config } from "./config.js";
import { isAllowedProposalPath } from "./proposal-path-validation.js";


function getClient() {
  if (!config.GITHUB_TOKEN) {
    throw new Error("GITHUB_TOKEN is not configured");
  }

  return new Octokit({ auth: config.GITHUB_TOKEN });
}

function getRepository() {
  if (!config.GITHUB_OWNER || !config.GITHUB_REPO) {
    throw new Error("GitHub owner/repository is not configured");
  }

  return {
    owner: config.GITHUB_OWNER,
    repo: config.GITHUB_REPO
  };
}

export async function getIssue(issueNumber: number) {
  const octokit = getClient();
  const repository = getRepository();

  const { data } = await octokit.issues.get({
    ...repository,
    issue_number: issueNumber
  });

  if ("pull_request" in data) {
    throw new Error("The selected item is a pull request, not an issue");
  }

  return {
    number: data.number,
    title: data.title,
    body: data.body ?? "",
    htmlUrl: data.html_url
  };
}

const MAX_FILES = 100;
const MAX_FILE_BYTES = 100_000;
const MAX_TOTAL_BYTES = 500_000;

const IGNORED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  "vendor"
]);

const IGNORED_FILES = new Set([
  ".env",
  ".env.local",
  ".env.production",
  "id_rsa",
  "id_ed25519"
]);

export async function getRepositoryFiles() {
  const octokit = getClient();
  const repository = getRepository();

  const collected: Array<{
    name: string;
    path: string;
    type: "file";
    content: string;
  }> = [];

  let totalBytes = 0;

  async function walk(path: string): Promise<void> {
    if (
      collected.length >= MAX_FILES ||
      totalBytes >= MAX_TOTAL_BYTES
    ) {
      return;
    }

    const { data } = await octokit.repos.getContent({
      ...repository,
      path
    });

    if (!Array.isArray(data)) {
      return;
    }

    for (const entry of data) {
      if (
        collected.length >= MAX_FILES ||
        totalBytes >= MAX_TOTAL_BYTES
      ) {
        break;
      }

      if (entry.type === "dir") {
        if (!IGNORED_DIRECTORIES.has(entry.name)) {
          await walk(entry.path);
        }
        continue;
      }

      if (entry.type !== "file") {
        continue;
      }

      if (
        IGNORED_FILES.has(entry.name) ||
        entry.name.startsWith(".env.")
      ) {
        continue;
      }

      if (entry.size > MAX_FILE_BYTES) {
        continue;
      }

      const response = await octokit.repos.getContent({
        ...repository,
        path: entry.path
      });

      const file = response.data;

      if (
        Array.isArray(file) ||
        file.type !== "file" ||
        file.encoding !== "base64" ||
        !("content" in file)
      ) {
        continue;
      }

      const content = Buffer.from(file.content, "base64")
        .toString("utf8");

      const bytes = Buffer.byteLength(content, "utf8");

      if (totalBytes + bytes > MAX_TOTAL_BYTES) {
        continue;
      }

      collected.push({
        name: entry.name,
        path: entry.path,
        type: "file",
        content
      });

      totalBytes += bytes;
    }
  }

  await walk("");

  return collected;
}

export async function createTaskBranch(
  taskId: string
): Promise<{ branch: string; baseBranch: string }> {
  const octokit = getClient();
  const repository = getRepository();

  const { data: repoData } = await octokit.repos.get(repository);
  const baseBranch = repoData.default_branch;

  const { data: baseRef } = await octokit.git.getRef({
    ...repository,
    ref: `heads/${baseBranch}`
  });

  const shortTaskId = taskId.replace(/-/g, "").slice(0, 12);
  const branch = `ai-agent/task-${shortTaskId}`;

  await octokit.git.createRef({
    ...repository,
    ref: `refs/heads/${branch}`,
    sha: baseRef.object.sha
  });

  return { branch, baseBranch };
}

export async function createTaskPullRequest(input: {
  branch: string;
  baseBranch: string;
  title: string;
  body: string;
}): Promise<{ number: number; url: string }> {
  const octokit = getClient();
  const repository = getRepository();

  const { data } = await octokit.pulls.create({
    ...repository,
    title: input.title.slice(0, 250),
    head: input.branch,
    base: input.baseBranch,
    body: input.body.slice(0, 60000),
    draft: true
  });

  return {
    number: data.number,
    url: data.html_url
  };
}

export async function applyApprovedFileChanges(input: {
  branch: string;
  files: Array<{
    path: string;
    content: string;
  }>;
}): Promise<void> {
  const octokit = getClient();
  const repository = getRepository();

  if (input.files.length === 0 || input.files.length > 10) {
    throw new Error("Proposal must contain between 1 and 10 files");
  }

  const seenPaths = new Set<string>();
  let totalBytes = 0;

  // Validate all paths and contents before making any GitHub changes.
  for (const file of input.files) {
    const { path, content } = file;

    if (!isAllowedProposalPath(path)) {
      throw new Error(
        `Proposal contains a disallowed file path: ${path}`
      );
    }

    if (seenPaths.has(path)) {
      throw new Error(`Duplicate file path: ${path}`);
    }

    seenPaths.add(path);

    const bytes = Buffer.byteLength(content, "utf8");

    if (bytes > MAX_FILE_BYTES) {
      throw new Error(`File is too large: ${path}`);
    }

    totalBytes += bytes;

    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new Error("Proposal exceeds the total size limit");
    }

    // Basic secret screening; this is not a complete secret detector.
    if (
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content) ||
      /gh[pousr]_[A-Za-z0-9]{20,}/.test(content) ||
      /AIza[0-9A-Za-z_-]{30,}/.test(content)
    ) {
      throw new Error(`Possible secret detected in ${path}`);
    }
  }

  // Apply the validated files to the task branch.
  for (const file of input.files) {
    const { path, content } = file;
    let existingSha: string | undefined;

    try {
      const { data } = await octokit.repos.getContent({
        ...repository,
        path,
        ref: input.branch
      });

      if (Array.isArray(data) || data.type !== "file") {
        throw new Error(`Path is not a regular file: ${path}`);
      }

      existingSha = data.sha;
    } catch (error: unknown) {
      const status = (error as { status?: number })?.status;

      if (status !== 404) {
        throw error;
      }
    }

    await octokit.repos.createOrUpdateFileContents({
      ...repository,
      path,
      message: `AI agent: update ${path}`,
      content: Buffer.from(content, "utf8").toString("base64"),
      branch: input.branch,
      ...(existingSha ? { sha: existingSha } : {})
    });
  }
}
