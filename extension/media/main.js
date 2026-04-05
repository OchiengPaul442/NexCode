const vscode = acquireVsCodeApi();

const ui = {
  chat: document.getElementById("chat"),
  sendBtn: document.getElementById("sendBtn"),
  clearBtn: document.getElementById("clearBtn"),
  promptInput: document.getElementById("promptInput"),
  providerSelect: document.getElementById("providerSelect"),
  modelInput: document.getElementById("modelInput"),
  modeSelect: document.getElementById("modeSelect"),
  historyList: document.getElementById("historyList"),
};

const state = {
  streamNode: null,
  history: [],
  busy: false,
};

bindEvents();

function bindEvents() {
  ui.sendBtn.addEventListener("click", () => {
    sendPrompt();
  });

  ui.clearBtn.addEventListener("click", () => {
    vscode.postMessage({ type: "clearConversation" });
  });

  ui.promptInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      sendPrompt();
    }
  });

  window.addEventListener("message", (event) => {
    handleIncoming(event.data);
  });
}

function sendPrompt() {
  if (state.busy) {
    return;
  }

  const prompt = ui.promptInput.value.trim();
  if (!prompt) {
    return;
  }

  appendMessage("user", prompt);
  addToHistory(prompt);

  vscode.postMessage({
    type: "sendPrompt",
    prompt,
    provider: ui.providerSelect.value,
    model: ui.modelInput.value.trim(),
    mode: ui.modeSelect.value,
  });

  ui.promptInput.value = "";
}

function handleIncoming(message) {
  switch (message.type) {
    case "config":
      applyConfig(message.value);
      break;
    case "start":
      state.busy = true;
      ui.sendBtn.disabled = true;
      state.streamNode = null;
      break;
    case "end":
      state.busy = false;
      ui.sendBtn.disabled = false;
      break;
    case "status":
      appendMessage("status", message.message);
      break;
    case "token":
      appendStreamToken(message.token);
      break;
    case "final":
      finalizeAssistantMessage(message.response);
      break;
    case "error":
      appendMessage("error", message.message);
      break;
    case "editApplied":
      markEditApplied(message.editId, message.filePath);
      break;
    case "cleared":
      clearUi();
      break;
  }
}

function applyConfig(config) {
  if (!config) {
    return;
  }

  ui.providerSelect.value = config.provider;
  ui.modelInput.value = config.model;
  ui.modeSelect.value = config.mode;
}

function appendMessage(kind, text) {
  const wrapper = document.createElement("article");
  wrapper.className = `message ${kind}`;

  const label = document.createElement("header");
  label.className = "message-label";
  label.textContent = kind.toUpperCase();

  const body = document.createElement("pre");
  body.className = "message-body";
  body.textContent = text;

  wrapper.appendChild(label);
  wrapper.appendChild(body);

  ui.chat.appendChild(wrapper);
  ui.chat.scrollTop = ui.chat.scrollHeight;
}

function appendStreamToken(token) {
  const message = ensureStreamingMessage();
  const body = message.querySelector(".message-body");
  body.textContent += token;
  ui.chat.scrollTop = ui.chat.scrollHeight;
}

function ensureStreamingMessage() {
  if (state.streamNode) {
    return state.streamNode;
  }

  const wrapper = document.createElement("article");
  wrapper.className = "message assistant";

  const label = document.createElement("header");
  label.className = "message-label";
  label.textContent = "ASSISTANT";

  const body = document.createElement("pre");
  body.className = "message-body";

  wrapper.appendChild(label);
  wrapper.appendChild(body);

  ui.chat.appendChild(wrapper);
  state.streamNode = wrapper;
  return wrapper;
}

function finalizeAssistantMessage(response) {
  const message = ensureStreamingMessage();
  const body = message.querySelector(".message-body");
  body.textContent = response.text || "";

  if (
    Array.isArray(response.proposedEdits) &&
    response.proposedEdits.length > 0
  ) {
    const editContainer = document.createElement("section");
    editContainer.className = "edits";

    for (const edit of response.proposedEdits) {
      const card = document.createElement("details");
      card.className = "edit-card";
      card.dataset.editId = edit.id;
      card.open = false;

      const summary = document.createElement("summary");
      summary.textContent = `${edit.filePath} - ${edit.summary}`;

      const patch = document.createElement("pre");
      patch.className = "patch";
      patch.textContent = edit.patch || edit.newText || "";

      const applyButton = document.createElement("button");
      applyButton.className = "apply";
      applyButton.textContent = "Apply Edit";
      applyButton.addEventListener("click", () => {
        vscode.postMessage({ type: "applyEdit", editId: edit.id });
      });

      card.appendChild(summary);
      card.appendChild(patch);
      card.appendChild(applyButton);
      editContainer.appendChild(card);
    }

    message.appendChild(editContainer);
  }

  state.streamNode = null;
  ui.chat.scrollTop = ui.chat.scrollHeight;
}

function markEditApplied(editId, filePath) {
  const card = ui.chat.querySelector(`[data-edit-id="${cssEscape(editId)}"]`);
  if (card) {
    const button = card.querySelector("button.apply");
    if (button) {
      button.disabled = true;
      button.textContent = `Applied to ${filePath}`;
    }
  }
}

function addToHistory(prompt) {
  state.history.unshift(prompt);
  if (state.history.length > 10) {
    state.history = state.history.slice(0, 10);
  }

  ui.historyList.textContent = "";
  for (const item of state.history) {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.className = "history-item";
    button.textContent = item;
    button.addEventListener("click", () => {
      ui.promptInput.value = item;
      ui.promptInput.focus();
    });
    li.appendChild(button);
    ui.historyList.appendChild(li);
  }
}

function clearUi() {
  state.streamNode = null;
  state.history = [];
  ui.chat.textContent = "";
  ui.historyList.textContent = "";
}

function cssEscape(value) {
  if (window.CSS && typeof window.CSS.escape === "function") {
    return window.CSS.escape(value);
  }

  return String(value).replace(/[^a-zA-Z0-9_-]/g, "_");
}
