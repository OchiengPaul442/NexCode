import React, { useState, useMemo } from "react";
import { FileText, ChevronRight } from "lucide-react";
import type { ProposedEdit } from "../types";
import { computeGitDiff, collapseDiffContext, type DiffLine } from "../utils/diffUtils";

export function ChangedFilesSummary({ 
  files, 
  totalAdditions, 
  totalDeletions,
  proposedEdits,
}: { 
  files: Array<{ path: string; additions?: number; deletions?: number }>;
  totalAdditions?: number;
  totalDeletions?: number;
  proposedEdits?: ProposedEdit[];
}) {
  const [listExpanded, setListExpanded] = useState(false);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  if (files.length === 0) return null;

  const additions = totalAdditions ?? files.reduce((sum, f) => sum + (f.additions ?? 0), 0);
  const deletions = totalDeletions ?? files.reduce((sum, f) => sum + (f.deletions ?? 0), 0);
  const VISIBLE_COUNT = 8;
  const hasOverflow = files.length > VISIBLE_COUNT;
  const displayFiles = listExpanded ? files : files.slice(0, VISIBLE_COUNT);
  const hiddenCount = files.length - VISIBLE_COUNT;

  const toggleFile = (path: string) => {
    setExpandedFiles(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  // Build a map from file path to proposed edit (for inline diff)
  // Use flexible matching: check if paths end with each other (handles absolute vs relative)
  const editMap = useMemo(() => {
    const map = new Map<string, ProposedEdit>();
    if (proposedEdits) {
      for (const edit of proposedEdits) {
        map.set(edit.filePath, edit);
      }
    }
    return map;
  }, [proposedEdits]);

  // Helper to find an edit for a given file path (flexible matching)
  const findEditForFile = (filePath: string): ProposedEdit | undefined => {
    // Exact match first
    if (editMap.has(filePath)) return editMap.get(filePath);
    // Check if any edit path ends with this file path or vice versa
    for (const [editPath, edit] of editMap) {
      if (filePath.endsWith(editPath) || editPath.endsWith(filePath)) return edit;
      // Also check just the filename
      const editBase = editPath.split(/[/\\]/).pop() ?? "";
      const fileBase = filePath.split(/[/\\]/).pop() ?? "";
      if (editBase && fileBase && editBase === fileBase) return edit;
    }
    return undefined;
  };

  return (
    <div className="nk-changeset">
      {/* Header */}
      <div className="nk-changeset-header">
        <span className="nk-changeset-title">
          <span className="nk-changeset-count">
            {files.length} Changed file{files.length !== 1 ? "s" : ""}
          </span>
          {additions > 0 && <span className="nk-changeset-add">+{additions}</span>}
          {deletions > 0 && <span className="nk-changeset-del">-{deletions}</span>}
        </span>
        {hasOverflow && (
          <button
            className="nk-changeset-toggle"
            onClick={() => setListExpanded(!listExpanded)}
          >
            {listExpanded ? "Show less" : `+${hiddenCount} more`}
          </button>
        )}
      </div>

      {/* File list */}
      <div className="nk-changeset-files">
        {displayFiles.map((file) => (
          <ChangedFileRow
            key={file.path}
            file={file}
            edit={findEditForFile(file.path)}
            isExpanded={expandedFiles.has(file.path)}
            onToggle={toggleFile}
          />
        ))}
      </div>

      {/* Overflow footer */}
      {!listExpanded && hasOverflow && (
        <button
          className="nk-changeset-overflow"
          onClick={() => setListExpanded(true)}
        >
          +{hiddenCount} more file{hiddenCount !== 1 ? "s" : ""}
        </button>
      )}
    </div>
  );
}

export const ChangedFileRow = React.memo(function ChangedFileRow({
  file,
  edit,
  isExpanded,
  onToggle,
}: {
  file: { path: string; additions?: number; deletions?: number };
  edit?: ProposedEdit;
  isExpanded: boolean;
  onToggle: (path: string) => void;
}) {
  const hasDiff = !!(edit?.oldText && edit?.newText);

  const diffLines = useMemo(() => {
    if (!hasDiff || !edit) return null;
    const hunks = computeGitDiff(edit.oldText, edit.newText);
    // Flatten hunks to lines for the existing renderer
    const allLines: DiffLine[] = [];
    for (const hunk of hunks) {
      allLines.push(...hunk.lines);
    }
    return collapseDiffContext(allLines, 2);
  }, [hasDiff, edit?.oldText, edit?.newText]);

  return (
    <div className="nk-changeset-file">
      {/* File row */}
      <div
        className="nk-changeset-file-row"
        role={hasDiff ? "button" : undefined}
        tabIndex={hasDiff ? 0 : undefined}
        aria-expanded={hasDiff ? isExpanded : undefined}
        onKeyDown={hasDiff ? (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle(file.path);
          }
        } : undefined}
        onClick={() => hasDiff && onToggle(file.path)}
      >
        <span className="nk-changeset-file-icon">
          <FileText size={12} />
        </span>
        <span className="nk-changeset-file-path">{file.path}</span>
        <span className="nk-changeset-file-stats">
          {file.additions != null && file.additions > 0 && (
            <span className="nk-changeset-file-add">+{file.additions}</span>
          )}
          {file.deletions != null && file.deletions > 0 && (
            <span className="nk-changeset-file-del">-{file.deletions}</span>
          )}
        </span>
        {hasDiff && (
          <ChevronRight
            size={11}
            className="nk-changeset-file-chevron"
            style={{ transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)" }}
          />
        )}
      </div>

      {/* Inline diff */}
      {isExpanded && diffLines && (
        <div className="nk-changeset-diff">
          {diffLines.map((line, i) => (
            <div
              key={i}
              className={`nk-changeset-diff-line nk-changeset-diff-line--${line.type}`}
            >
              <span className="nk-changeset-diff-gutter">
                <span className="nk-changeset-diff-oldnum">{line.oldNum ?? ""}</span>
                <span className="nk-changeset-diff-newnum">{line.newNum ?? ""}</span>
              </span>
              <span className="nk-changeset-diff-prefix">
                {line.type === "add" ? "+" : line.type === "del" ? "-" : " "}
              </span>
              <span className="nk-changeset-diff-text">{line.content}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
