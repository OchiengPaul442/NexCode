export interface BatchEdit {
  filePath: string;
  operation: 'create' | 'update' | 'delete';
  content?: string;
  patch?: string;
}

export class BatchEditor {
  private edits: BatchEdit[] = [];
  
  addEdit(edit: BatchEdit): void {
    this.edits.push(edit);
  }
  
  getEdits(): BatchEdit[] {
    return [...this.edits];
  }
  
  clear(): void {
    this.edits = [];
  }
  
  estimateTokenSavings(): number {
    const separateOverhead = this.edits.length * 200;
    const batchOverhead = 50;
    return Math.max(0, separateOverhead - batchOverhead);
  }
  
  groupByDirectory(): Map<string, BatchEdit[]> {
    const groups = new Map<string, BatchEdit[]>();
    for (const edit of this.edits) {
      const dir = edit.filePath.split('/').slice(0, -1).join('/') || '.';
      const existing = groups.get(dir) || [];
      existing.push(edit);
      groups.set(dir, existing);
    }
    return groups;
  }
}
