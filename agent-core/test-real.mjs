import { createNexcodeOrchestrator } from "./dist/index.js";

async function testAgent() {
  const orchestrator = createNexcodeOrchestrator({
    workspaceRoot: process.cwd(),
    promptsDir: "./prompts",
    memoryDir: "./memory",
  });

  const request = {
    prompt: "Write a simple hello world function in TypeScript",
    mode: "coder",
    provider: "ollama",
    model: "qwen2.5-coder:7b",
    temperature: 0.7,
    abortSignal: new AbortController().signal,
  };

  console.log("Starting test with prompt:", request.prompt);

  try {
    for await (const event of orchestrator.stream(request)) {
      if (event.type === "token") {
        process.stdout.write(event.token);
      } else if (event.type === "final") {
        console.log("\nFinal response:", event.response);
      } else {
        console.log("Event:", event.type, event);
      }
    }
  } catch (error) {
    console.error("Error:", error);
  }
}

testAgent();
