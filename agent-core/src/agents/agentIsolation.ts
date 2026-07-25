import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";

const execFileAsync = promisify(execFile);

export interface IsolationConfig {
  /** Workspace root path */
  workspaceRoot: string;
  /** Whether to use git worktrees for isolation */
  useWorktrees: boolean;
  /** Base directory for worktrees */
  worktreeBaseDir?: string;
}

export interface IsolatedWorkspace {
  /** Unique ID for this workspace */
  id: string;
  /** Path to the isolated workspace */
  path: string;
  /** Whether this is a git worktree */
  isWorktree: boolean;
  /** Branch name (for worktrees) */
  branch?: string;
}

/**
 * Agent isolation system using git worktrees.
 * Creates isolated copies of the workspace for subagents to work in,
 * preventing conflicts between parallel agents.
 */
export class AgentIsolation {
  private readonly config: IsolationConfig;
  private readonly workspaces = new Map<string, IsolatedWorkspace>();

  constructor(config: IsolationConfig) {
    this.config = {
      worktreeBaseDir: path.join(os.tmpdir(), "nexcode-worktrees"),
      ...config,
    };
  }

  /**
   * Create an isolated workspace for an agent.
   */
  async createWorkspace(agentId: string): Promise<IsolatedWorkspace> {
    // Sanitize agent ID to prevent shell injection
    const safeId = agentId.replace(/[^a-zA-Z0-9._-]/g, "_");
    const id = `${safeId}-${Date.now()}`;

    if (this.config.useWorktrees && await this.isGitRepo()) {
      return this.createWorktree(id);
    }

    return this.createCopy(id);
  }

  /**
   * Release an isolated workspace.
   */
  async releaseWorkspace(id: string): Promise<void> {
    const workspace = this.workspaces.get(id);
    if (!workspace) return;

    if (workspace.isWorktree) {
      await this.removeWorktree(workspace);
    } else {
      await this.removeCopy(workspace);
    }

    this.workspaces.delete(id);
  }

  /**
   * Release all workspaces.
   */
  async releaseAll(): Promise<void> {
    for (const [id] of this.workspaces) {
      await this.releaseWorkspace(id);
    }
  }

  /**
   * Merge changes from an isolated workspace back to the main workspace.
   */
  async mergeChanges(workspaceId: string): Promise<{ success: boolean; output: string }> {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      return { success: false, output: "Workspace not found" };
    }

    if (!workspace.isWorktree || !workspace.branch) {
      return { success: false, output: "Merge only supported for worktree workspaces" };
    }

    let originalBranch: string | null = null;
    try {
      // Save current branch
      const { stdout } = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
        cwd: this.config.workspaceRoot,
      });
      originalBranch = stdout.trim();

      // Stage all changes in the worktree
      await execFileAsync("git", ["add", "-A"], { cwd: workspace.path });

      // Commit changes
      await execFileAsync("git", ["commit", "-m", `Agent ${workspaceId} changes`], {
        cwd: workspace.path,
      });

      // Checkout main branch and merge
      await execFileAsync("git", ["checkout", originalBranch], {
        cwd: this.config.workspaceRoot,
      });
      await execFileAsync("git", ["merge", workspace.branch, "--no-edit"], {
        cwd: this.config.workspaceRoot,
      });

      return { success: true, output: `Merged branch ${workspace.branch}` };
    } catch (error) {
      // Try to restore original branch on failure
      if (originalBranch) {
        try {
          await execFileAsync("git", ["checkout", originalBranch], {
            cwd: this.config.workspaceRoot,
          });
        } catch {
          // Best effort
        }
      }
      return { success: false, output: String(error) };
    }
  }

  private async isGitRepo(): Promise<boolean> {
    try {
      await execFileAsync("git", ["rev-parse", "--git-dir"], {
        cwd: this.config.workspaceRoot,
      });
      return true;
    } catch {
      return false;
    }
  }

  private async createWorktree(id: string): Promise<IsolatedWorkspace> {
    const branch = `agent/${id}`;
    const worktreePath = path.join(this.config.worktreeBaseDir!, id);

    try {
      await fs.mkdir(this.config.worktreeBaseDir!, { recursive: true });

      // Create worktree
      await execFileAsync("git", ["worktree", "add", "-b", branch, worktreePath], {
        cwd: this.config.workspaceRoot,
      });

      const workspace: IsolatedWorkspace = {
        id,
        path: worktreePath,
        isWorktree: true,
        branch,
      };

      this.workspaces.set(id, workspace);
      return workspace;
    } catch (error) {
      // Fallback to copy
      console.warn(`[isolation] Worktree creation failed, falling back to copy: ${error}`);
      return this.createCopy(id);
    }
  }

  private async createCopy(id: string): Promise<IsolatedWorkspace> {
    const copyPath = path.join(this.config.worktreeBaseDir!, id);

    try {
      await fs.mkdir(this.config.worktreeBaseDir!, { recursive: true });

      // Cross-platform copy using Node.js fs.cp (available since Node 16.7)
      await fs.cp(this.config.workspaceRoot, copyPath, {
        recursive: true,
        filter: (src) => {
          // Exclude .git and node_modules
          const relative = path.relative(this.config.workspaceRoot, src);
          return !relative.startsWith(".git") && !relative.startsWith("node_modules");
        },
      });

      const workspace: IsolatedWorkspace = {
        id,
        path: copyPath,
        isWorktree: false,
      };

      this.workspaces.set(id, workspace);
      return workspace;
    } catch (error) {
      throw new Error(`Failed to create isolated workspace: ${error}`);
    }
  }

  private async removeWorktree(workspace: IsolatedWorkspace): Promise<void> {
    try {
      await execFileAsync("git", ["worktree", "remove", workspace.path, "--force"], {
        cwd: this.config.workspaceRoot,
      });
      if (workspace.branch) {
        await execFileAsync("git", ["branch", "-D", workspace.branch], {
          cwd: this.config.workspaceRoot,
        });
      }
    } catch {
      // Best effort
    }
  }

  private async removeCopy(workspace: IsolatedWorkspace): Promise<void> {
    try {
      await fs.rm(workspace.path, { recursive: true, force: true });
    } catch {
      // Best effort
    }
  }
}
