/**
 * SubAgentManager was removed during audit cleanup (N4).
 * 
 * This class provided parallel agent execution capabilities but was never
 * imported or used anywhere in the codebase. The actual pipeline execution
 * in orchestrator.ts runs stages sequentially via resolveAutoPipeline().
 * 
 * If parallel agent execution is needed in the future, implement it here
 * with proper context isolation, worktree management, and conflict detection.
 */
