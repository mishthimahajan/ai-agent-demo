import { describe, expect, it } from "vitest";
import { z } from "zod";

const TaskInput = z.object({
  title: z.string().trim().min(3).max(200),
  body: z.string().max(10000).default("")
});

describe("Task input validation", () => {
  it("accepts a valid task", () => {
    const result = TaskInput.safeParse({
      title: "Add signup validation",
      body: "Reject invalid email addresses"
    });

    expect(result.success).toBe(true);
  });

  it("rejects a short title", () => {
    const result = TaskInput.safeParse({
      title: "ab"
    });

    expect(result.success).toBe(false);
  });

  it("defaults an absent body to an empty string", () => {
    const result = TaskInput.parse({
      title: "Fix login"
    });

    expect(result.body).toBe("");
  });
});