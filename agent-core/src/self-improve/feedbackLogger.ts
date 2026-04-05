import fs from "fs/promises";
import path from "path";
import { InteractionFeedback } from "../types";

export class FeedbackLogger {
  private readonly logPath: string;

  public constructor(memoryDir: string) {
    this.logPath = path.join(memoryDir, "feedback-log.jsonl");
  }

  public async log(feedback: InteractionFeedback): Promise<void> {
    await fs.mkdir(path.dirname(this.logPath), { recursive: true });
    await fs.appendFile(this.logPath, `${JSON.stringify(feedback)}\n`, "utf8");
  }
}
