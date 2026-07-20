import React from "react";
import type { SubAgentTask } from "../types";

export function ParallelIndicator({ count }: { count: number }) {
  if (count <= 1) return null;

  return (
    <div className="nk-parallel-indicator">
      <span className="nk-parallel-icon">⚡</span>
      <span>Running {count} tasks in parallel</span>
    </div>
  );
}

export function SubagentIndicator({
  description,
  status,
}: {
  description: string;
  status: string;
}) {
  return (
    <div className="nk-subagent-indicator">
      <span className="nk-subagent-dot" />
      <span className="nk-subagent-text">{description}</span>
      <span className="nk-subagent-status">{status}</span>
    </div>
  );
}

export function BackgroundAgents({ agents, waveInfo }: { agents: SubAgentTask[]; waveInfo?: { current: number; total: number } | null }) {
  if (agents.length === 0) return null;

  const running = agents.filter((a) => a.status === "running");
  const completed = agents.filter((a) => a.status === "completed");
  const failed = agents.filter((a) => a.status === "failed");

  return (
    <div className="nk-bg-agents nk-bg-agents--enhanced">
      {/* Wave deployment text */}
      {waveInfo && waveInfo.current > 1 && completed.length > 0 && (
        <div className="nk-bg-agents-wave-text">
          Excellent! First {completed.length} agent{completed.length !== 1 ? "s" : ""} have reported. Now deploying Wave {waveInfo.current}: {running.length} more agent{running.length !== 1 ? "s" : ""} for remaining areas:
        </div>
      )}

      <div className="nk-bg-agents-header">
        <div className="nk-bg-agents-title-row">
          <span className="nk-bg-agents-title">Agents</span>
          <span className="nk-bg-agents-count-badge">
            {agents.length} total
          </span>
        </div>
        {waveInfo && (
          <div className="nk-bg-agents-wave-info">
            <span className="nk-bg-agents-wave-label">Wave {waveInfo.current}/{waveInfo.total}</span>
            <div className="nk-bg-agents-wave-progress">
              <div 
                className="nk-bg-agents-wave-progress-fill"
                style={{ width: `${(completed.length / agents.length) * 100}%` }}
              />
            </div>
          </div>
        )}
      </div>
      
      <div className="nk-bg-agents-stats">
        {running.length > 0 && (
          <span className="nk-bg-agents-stat nk-bg-agents-stat--running">
            <span className="nk-bg-agents-stat-dot nk-bg-agents-stat-dot--running" />
            {running.length} running
          </span>
        )}
        {completed.length > 0 && (
          <span className="nk-bg-agents-stat nk-bg-agents-stat--completed">
            <span className="nk-bg-agents-stat-dot nk-bg-agents-stat-dot--completed" />
            {completed.length} completed
          </span>
        )}
        {failed.length > 0 && (
          <span className="nk-bg-agents-stat nk-bg-agents-stat--failed">
            <span className="nk-bg-agents-stat-dot nk-bg-agents-stat-dot--failed" />
            {failed.length} failed
          </span>
        )}
      </div>

      <div className="nk-bg-agents-list">
        {agents.map((agent) => (
          <div
            key={agent.id}
            className={`nk-bg-agent-card nk-bg-agent-card--${agent.status}`}
          >
            <div className="nk-bg-agent-card-header">
              <div className="nk-bg-agent-card-icon">
                {agent.status === "running" && (
                  <span className="nk-bg-agent-card-spinner" />
                )}
                {agent.status === "completed" && (
                  <span className="nk-bg-agent-card-check">✓</span>
                )}
                {agent.status === "failed" && (
                  <span className="nk-bg-agent-card-x">✗</span>
                )}
                {agent.status !== "running" && agent.status !== "completed" && agent.status !== "failed" && (
                  <span className="nk-bg-agent-card-pending">☐</span>
                )}
              </div>
              <div className="nk-bg-agent-card-info">
                <span className="nk-bg-agent-card-type">General</span>
                <span className="nk-bg-agent-card-desc">{agent.description}</span>
              </div>
            </div>
            {agent.status === "running" && (
              <div className="nk-bg-agent-card-progress">
                <div className="nk-bg-agent-card-progress-bar">
                  <div className="nk-bg-agent-card-progress-fill" />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
