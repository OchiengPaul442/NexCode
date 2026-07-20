import React, { useState, useEffect } from "react";
import { Shield, X, Check } from "lucide-react";

export interface ToolApprovalRequest {
  requestId: string;
  toolName: string;
  command: string;
}

export function ToolApprovalDialog({
  request,
  onApprove,
  onDeny,
}: {
  request: ToolApprovalRequest;
  onApprove: () => void;
  onDeny: () => void;
}) {
  const [countdown, setCountdown] = useState(30);

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          onDeny();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [onDeny]);

  const riskLevel = (() => {
    const lowerTool = request.toolName.toLowerCase();
    if (lowerTool === "terminal" || lowerTool === "batch_edit") return "high";
    if (lowerTool === "write" || lowerTool === "append" || lowerTool === "delete" || lowerTool === "move") return "medium";
    return "low";
  })();

  const riskColor = riskLevel === "high" ? "#f87171" : riskLevel === "medium" ? "#fbbf24" : "#34d399";
  const truncatedCmd = request.command.length > 120 ? request.command.slice(0, 120) + "..." : request.command;

  return (
    <div className="nk-approval-dialog">
      <div className="nk-approval-header">
        <Shield size={16} style={{ color: riskColor }} />
        <span className="nk-approval-title">Tool Approval Required</span>
        <span className="nk-approval-countdown" style={{ color: countdown <= 10 ? "#f87171" : undefined }}>
          {countdown}s
        </span>
      </div>
      <div className="nk-approval-body">
        <div className="nk-approval-row">
          <span className="nk-approval-label">Tool</span>
          <span className="nk-approval-value">{request.toolName}</span>
        </div>
        <div className="nk-approval-row">
          <span className="nk-approval-label">Risk</span>
          <span className="nk-approval-value" style={{ color: riskColor }}>
            {riskLevel.toUpperCase()}
          </span>
        </div>
        <div className="nk-approval-row nk-approval-row--full">
          <span className="nk-approval-label">Command</span>
          <pre className="nk-approval-command">{truncatedCmd}</pre>
        </div>
      </div>
      <div className="nk-approval-actions">
        <button className="nk-btn-ghost nk-approval-deny" onClick={onDeny}>
          <X size={12} /> Deny
        </button>
        <button className="nk-btn-accent nk-approval-approve" onClick={onApprove}>
          <Check size={12} /> Approve
        </button>
      </div>
    </div>
  );
}
