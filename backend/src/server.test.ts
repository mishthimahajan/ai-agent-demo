import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Express } from "express";

describe("approval API safety checks", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";

    const { app } = await import("./server.js");
    server = createServer(app as Express);

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });

  it("rejects a malformed task ID", async () => {
    const response = await fetch(
      `${baseUrl}/api/tasks/not-a-uuid/approve`,
      { method: "POST" }
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "Invalid task ID",
    });
  });

  it("rejects an incorrect approval token", async () => {
    const response = await fetch(
      `${baseUrl}/api/tasks/6ec79e38-f6a6-4de5-9737-4c5e0b6d6e0d/approve`,
      {
        method: "POST",
        headers: {
          "x-approval-token": "definitely-wrong-token",
        },
      }
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: "Approval authentication failed",
    });
  });
});
