import type { AgentMode } from "../types";

export type AutoRoutingStrategy =
  | {
      kind: "single";
      mode: Exclude<AgentMode, "auto">;
      statusLabel?: string;
      todoTitle: string;
    }
  | {
      kind: "pipeline";
      pipeline: Exclude<AgentMode, "auto">[];
    };

export function resolveAutoStrategy(prompt: string): AutoRoutingStrategy {
  const normalized = prompt.toLowerCase().trim();
  const words = normalized.split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  const isGreeting =
    /^(hi|hello|hey|yo|sup|good\s+(morning|afternoon|evening))(?:[\s!.,?]*)$/.test(
      normalized,
    ) || /^(thanks|thank you)(?:[\s!.,?]*)$/.test(normalized);
  const isSimpleQuestion =
    (/\?/.test(normalized) || /\b(can you|are you|do you|what is|what are|how do|how does|why|explain|tell me|describe)\b/.test(normalized)) &&
    wordCount < 25 &&
    !/\b(create|build|implement|fix|debug|test|review|security|plan)\b/.test(
      normalized,
    );
  const wantsPlan =
    /\b(plan|architecture|roadmap|steps|break down|acceptance criteria)\b/.test(
      normalized,
    ) && !/\b(build|create|implement|write|code|edit|fix)\b/.test(normalized);
  const wantsSecurity =
    /\b(security|cve|vulnerability|threat|hardening|owasp|secret)\b/.test(
      normalized,
    );
  const wantsQa =
    /\b(test strategy|test case|qa|validate|verification)\b/.test(normalized);
  const wantsReview =
    /\b(review|code review|regression|smell|refactor recommendation)\b/.test(
      normalized,
    );
  const wantsDeepWorkflow =
    /\b(multi[- ]agent|end[- ]to[- ]end|comprehensive|full workflow|iterate|production[- ]grade|real world test|run all suites|thorough)\b/.test(
      normalized,
    );
  const isLarge = prompt.length > 1400 || wordCount > 220;

  if (isGreeting || isSimpleQuestion) {
    return {
      kind: "single",
      mode: "coder",
      statusLabel: "Preparing a quick direct answer",
      todoTitle: "Draft quick answer",
    };
  }

  if (wantsPlan) {
    return {
      kind: "single",
      mode: "planner",
      statusLabel: "Planning approach and milestones",
      todoTitle: "Build implementation plan",
    };
  }

  if (wantsSecurity && !wantsDeepWorkflow) {
    return {
      kind: "single",
      mode: "security",
      statusLabel: "Checking security posture",
      todoTitle: "Run focused security review",
    };
  }

  if (wantsQa && !wantsDeepWorkflow) {
    return {
      kind: "single",
      mode: "qa",
      statusLabel: "Validating behavior and tests",
      todoTitle: "Assess QA and validation coverage",
    };
  }

  if (wantsReview && !wantsDeepWorkflow) {
    return {
      kind: "single",
      mode: "reviewer",
      statusLabel: "Reviewing correctness and regressions",
      todoTitle: "Produce review findings",
    };
  }

  if (wantsDeepWorkflow || isLarge) {
    return {
      kind: "pipeline",
      pipeline: resolveAutoPipeline(prompt),
    };
  }

  return {
    kind: "single",
    mode: "coder",
    statusLabel: "Drafting implementation-ready response",
    todoTitle: "Generate implementation guidance",
  };
}

export function resolveAutoPipeline(prompt: string): Exclude<AgentMode, "auto">[] {
  const normalized = prompt.toLowerCase();
  const isPlanningHeavy =
    /\b(plan|architecture|roadmap|acceptance criteria|break down)\b/.test(
      normalized,
    );
  const isSecuritySensitive =
    /\b(security|audit|cve|vulnerability|secret|threat|compliance|hardening)\b/.test(
      normalized,
    );
  const isValidationHeavy =
    /\b(test|qa|verify|validation|debug|bug|broken|error|failing)\b/.test(
      normalized,
    );
  const isBuildOrCreate =
    /\b(create|build|design|scaffold|implement|nextjs|react|frontend|website|app|blog|ui)\b/.test(
      normalized,
    );
  const isLarge = prompt.length > 900 || normalized.split(/\s+/).length > 180;

  const stages: Exclude<AgentMode, "auto">[] = ["coder", "reviewer"];

  if (isPlanningHeavy && !isBuildOrCreate && !stages.includes("planner")) {
    stages.unshift("planner");
  }
  if (isSecuritySensitive && !stages.includes("security")) {
    stages.push("security");
  }
  if (
    (isLarge || isValidationHeavy || isBuildOrCreate) &&
    !stages.includes("qa")
  ) {
    stages.push("qa");
  }

  return stages;
}

export function describePipelineStage(stage: Exclude<AgentMode, "auto">): string {
  switch (stage) {
    case "planner":
      return "Planner: outlining strategy and milestones";
    case "coder":
      return "Coder: producing implementation-ready output";
    case "reviewer":
      return "Reviewer: checking correctness and regressions";
    case "qa":
      return "QA: validating behavior and test coverage";
    case "security":
      return "Security: scanning for exploitable risks";
    default:
      return "Running agent stage";
  }
}

export function formatPipelineStage(stage: Exclude<AgentMode, "auto">): string {
  switch (stage) {
    case "planner":
      return "Planner";
    case "coder":
      return "Coder";
    case "reviewer":
      return "Reviewer";
    case "qa":
      return "QA";
    case "security":
      return "Security";
    default:
      return "Agent";
  }
}
