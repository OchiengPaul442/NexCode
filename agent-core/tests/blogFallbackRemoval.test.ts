/**
 * NC-028 — General coding agent contains hardcoded blog-page fallback
 *
 * The orchestrator previously contained a hardcoded Tailwind blog homepage that
 * would silently replace model output when a TSX/JSX edit instruction mentioned
 * "blog/homepage/landing page" but the generated text did not contain
 * "blog/post/featured/recent". This is domain-specific behavior that must not
 * exist in a general-purpose coding agent.
 *
 * Regression tests:
 * - shouldUseBlogLandingFallback and createBlogLandingPageFallback must not exist
 * - Blog-related instructions must not cause silent content replacement
 * - Model output must be preserved as-is regardless of blog keywords
 */

import path from "path";
import { describe, expect, it } from "vitest";
import { createNexcodeOrchestrator } from "../src";

describe("NC-028 — Blog fallback removal", () => {
  const workspaceRoot = path.resolve(__dirname, "..", "..");

  it("shouldUseBlogLandingFallback method does not exist on orchestrator", () => {
    const orchestrator = createNexcodeOrchestrator({ workspaceRoot });
    expect(
      (orchestrator as Record<string, unknown>)[
        "shouldUseBlogLandingFallback"
      ],
    ).toBeUndefined();
  });

  it("createBlogLandingPageFallback method does not exist on orchestrator", () => {
    const orchestrator = createNexcodeOrchestrator({ workspaceRoot });
    expect(
      (orchestrator as Record<string, unknown>)[
        "createBlogLandingPageFallback"
      ],
    ).toBeUndefined();
  });

  it("orchestrator does not contain hardcoded blog landing page string", () => {
    const orchestrator = createNexcodeOrchestrator({ workspaceRoot });
    const source = orchestrator.constructor.toString();
    expect(source).not.toContain("A polished blog homepage");
    expect(source).not.toContain("Featured post one");
    expect(source).not.toContain("Recent post one");
    expect(source).not.toContain("featuredPosts");
    expect(source).not.toContain("recentPosts");
  });

  it("orchestrator source does not contain shouldUseBlogLandingFallback", () => {
    const orchestrator = createNexcodeOrchestrator({ workspaceRoot });
    const source = orchestrator.constructor.toString();
    expect(source).not.toContain("shouldUseBlogLandingFallback");
    expect(source).not.toContain("createBlogLandingPageFallback");
  });
});
