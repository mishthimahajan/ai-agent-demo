
import { describe, expect, it } from "vitest";
import { isAllowedProposalPath } from "./proposal-path-validation.js";

describe("isAllowedProposalPath", () => {
  it("allows TypeScript source and test files inside src", () => {
    expect(isAllowedProposalPath("src/signup.ts")).toBe(true);
    expect(isAllowedProposalPath("src/signup.test.ts")).toBe(true);
    expect(isAllowedProposalPath("src/utils/validation.ts")).toBe(true);
    expect(isAllowedProposalPath("src/component.tsx")).toBe(true);
  });

  it("rejects paths outside src and non-TypeScript files", () => {
    expect(isAllowedProposalPath("package.json")).toBe(false);
    expect(isAllowedProposalPath("scripts/deploy.js")).toBe(false);
    expect(isAllowedProposalPath(".env")).toBe(false);
    expect(isAllowedProposalPath("src/config.json")).toBe(false);
  });

  it("rejects traversal and malformed paths", () => {
    expect(isAllowedProposalPath("src/../secret.ts")).toBe(false);
    expect(isAllowedProposalPath("src/../../secret.ts")).toBe(false);
    expect(isAllowedProposalPath("/src/secret.ts")).toBe(false);
    expect(isAllowedProposalPath("src\\secret.ts")).toBe(false);
    expect(isAllowedProposalPath("src//secret.ts")).toBe(false);
  });
});
