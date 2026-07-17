import * as vscode from "vscode";
import {
  TaskQueueManager,
  Task,
  TaskEvent,
  ProposedEdit,
  RequestAttachment,
  ProviderId,
  AgentMode,
} from "@nexcode/agent-core";

interface AttachmentChip {
  id: string;
  fileName: string;
  kind: RequestAttachment["kind"];
  mimeType: string;
  byteSize?: number;
}

export class TaskController {
  private readonly pendingEdits = new Map<string, ProposedEdit>();
  private readonly pendingAttachments = new Map<string, RequestAttachment>();
  private readonly taskManager: TaskQueueManager;
  private postMessage: (message: unknown) => void;

  constructor(
    postMessage: (message: unknown) => void,
    maxConcurrent: number = 3,
  ) {
    this.postMessage = postMessage;
    this.taskManager = new TaskQueueManager({ maxConcurrent });
    this.taskManager.onEvent((event: TaskEvent) => this.handleTaskEvent(event));
  }

  public getTaskManager(): TaskQueueManager {
    return this.taskManager;
  }

  public getPendingEdits(): Map<string, ProposedEdit> {
    return this.pendingEdits;
  }

  public getPendingAttachments(): Map<string, RequestAttachment> {
    return this.pendingAttachments;
  }

  public clear(): void {
    this.pendingEdits.clear();
    this.pendingAttachments.clear();
    this.taskManager.clear();
    this.postMessage({ type: "cleared" });
  }

  public addEdit(edit: ProposedEdit): void {
    this.pendingEdits.set(edit.id, edit);
  }

  public removeEdit(editId: string): ProposedEdit | undefined {
    const edit = this.pendingEdits.get(editId);
    if (edit) {
      this.pendingEdits.delete(editId);
    }
    return edit;
  }

  public getEdit(editId: string): ProposedEdit | undefined {
    return this.pendingEdits.get(editId);
  }

  public addAttachment(attachment: RequestAttachment): void {
    this.pendingAttachments.set(attachment.id, attachment);
  }

  public removeAttachment(attachmentId: string): void {
    this.pendingAttachments.delete(attachmentId);
  }

  public resolveAttachmentsForPrompt(
    selectedAttachmentIds: string[],
  ): RequestAttachment[] {
    const attachments: RequestAttachment[] = [];
    for (const attachmentId of selectedAttachmentIds) {
      const attachment = this.pendingAttachments.get(attachmentId);
      if (attachment) {
        attachments.push(attachment);
      }
    }
    return attachments;
  }

  public clearResolvedAttachments(attachmentIds: string[]): void {
    for (const attachmentId of attachmentIds) {
      this.pendingAttachments.delete(attachmentId);
    }
  }

  public getAttachmentChips(): AttachmentChip[] {
    return [...this.pendingAttachments.values()].map((attachment) => ({
      id: attachment.id,
      fileName: attachment.fileName,
      kind: attachment.kind,
      mimeType: attachment.mimeType,
      byteSize: attachment.byteSize,
    }));
  }

  public handleSteerTask(taskId: string, message: string): boolean {
    const success = this.taskManager.steerTask(taskId, message);
    if (success) {
      this.postMessage({
        type: "taskSteered",
        taskId,
        message: "Steering message injected",
      });
    } else {
      this.postMessage({
        type: "error",
        message: `Task ${taskId} is not running and cannot be steered.`,
      });
    }
    this.postTaskList();
    return success;
  }

  public handleCancelTask(taskId: string): boolean {
    const success = this.taskManager.cancelTask(taskId);
    if (success) {
      this.postMessage({
        type: "taskCancelled",
        taskId,
      });
    } else {
      this.postMessage({
        type: "error",
        message: `Task ${taskId} could not be cancelled.`,
      });
    }
    this.postTaskList();
    return success;
  }

  public postTaskList(): void {
    const allTasks = this.taskManager.getAllTasks();
    this.postMessage({
      type: "taskList",
      tasks: allTasks.map((t: Task) => ({
        id: t.id,
        sessionId: t.sessionId,
        prompt: t.prompt,
        status: t.status,
        mode: t.mode,
        provider: t.provider,
        model: t.model,
        createdAt: t.createdAt,
        startedAt: t.startedAt,
        completedAt: t.completedAt,
        result: t.result,
        error: t.error,
        activityNote: t.activityNote,
      })),
      pendingCount: this.taskManager.getPendingCount(),
      activeCount: this.taskManager.getActiveCount(),
    });
  }

  public postAttachments(): void {
    const attachments = this.getAttachmentChips();
    this.postMessage({
      type: "attachmentsSelected",
      attachments,
    });
  }

  private handleTaskEvent(event: TaskEvent): void {
    this.postMessage({ type: "taskEvent", event });
  }
}
