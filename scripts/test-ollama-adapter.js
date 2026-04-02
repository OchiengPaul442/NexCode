#!/usr/bin/env node
const http = require("http");
const { OllamaAdapter } = require("../out/providers/ollamaAdapter");

// Simple mock server that returns SSE-style events for /api/chat
const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url && req.url.startsWith("/api/chat")) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const messages = [
      { choices: [{ delta: { content: "Hello" } }] },
      { choices: [{ delta: { content: ", world" } }] },
      { choices: [{ delta: { content: "!" } }] },
    ];

    let i = 0;
    const iv = setInterval(() => {
      if (i < messages.length) {
        res.write("data: " + JSON.stringify(messages[i]) + "\n\n");
        i++;
      } else {
        res.write("data: [DONE]\n\n");
        clearInterval(iv);
        // gracefully end after a short delay
        setTimeout(() => res.end(), 20);
      }
    }, 50);

    // keep connection open until ended
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(0, () => {
  const port = server.address().port;
  console.log("Mock Ollama server listening on port", port);

  const baseUrl = `http://localhost:${port}`;
  const adapter = new OllamaAdapter(baseUrl);

  const tokens = [];
  const controller = adapter.streamCompletion("Say hello", undefined, {
    onStart: () => console.log("stream start"),
    onConnected: () => console.log("connected to mock"),
    onToken: (t) => {
      tokens.push(t);
      process.stdout.write(`[TOKEN:${t}]`);
    },
    onEnd: () => {
      console.log("\nstream end");
      console.log("tokens:", tokens);
      server.close();
    },
    onError: (err) => {
      console.error("stream error", err);
      server.close();
    },
  });

  // safety cancel after 5s
  setTimeout(() => {
    try {
      controller.cancel();
    } catch (e) {}
  }, 5000);
});
