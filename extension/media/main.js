const vscode = acquireVsCodeApi();

const ui = {
  chat: document.getElementById("chat"),
  sendBtn: document.getElementById("sendBtn"),
  clearBtn: document.getElementById("clearBtn"),
  attachBtn: document.getElementById("attachBtn"),
  promptInput: document.getElementById("promptInput"),
  providerSelect: document.getElementById("providerSelect"),
  modelInput: document.getElementById("modelInput"),
  modeSelect: document.getElementById("modeSelect"),
  historyList: document.getElementById("historyList"),
  attachmentList: document.getElementById("attachmentList"),
};

const state = {
  streamNode: null,
  history: [],
  busy: false,
  attachments: [],
  currentStatuses: [],
  requireTerminalApproval: true,
};

bindEvents();

function bindEvents() {
  ui.sendBtn.addEventListener("click", () => {
    sendPrompt();
  });

  ui.clearBtn.addEventListener("click", () => {
    vscode.postMessage({ type: "clearConversation" });
  });

  ui.attachBtn.addEventListener("click", () => {
    vscode.postMessage({ type: "pickAttachments" });
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

  if (state.requireTerminalApproval && /^\/tool\s+terminal\s+/i.test(prompt)) {
    const terminalCommand = prompt.replace(/^\/tool\s+terminal\s+/i, "");
    const approved = window.confirm(
      [
        "Approval required to run terminal command:",
        "",
        terminalCommand,
        "",
        "Continue?",
      ].join("\n"),
    );
    if (!approved) {
      appendMessage("status", "Terminal command canceled by user.");
      return;
    }
  }

  appendMessage("user", prompt);
  addToHistory(prompt);

  const attachmentIds = state.attachments.map((item) => item.id);
  if (state.attachments.length > 0) {
    const summary = state.attachments
      .map((item) => `${item.fileName} (${item.kind})`)
      .join(", ");
    appendMessage("status", `Attached: ${summary}`);
  }

  vscode.postMessage({
    type: "sendPrompt",
    prompt,
    provider: ui.providerSelect.value,
    model: ui.modelInput.value.trim(),
    mode: ui.modeSelect.value,
    attachmentIds,
  });

  ui.promptInput.value = "";
  state.attachments = [];
  renderAttachments();
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
      state.currentStatuses = [];
      break;
    case "end":
      state.busy = false;
      ui.sendBtn.disabled = false;
      state.currentStatuses = [];
      break;
    case "status":
      state.currentStatuses.push({
        text: message.message,
        at: new Date().toLocaleTimeString(),
      });
      appendMessage("status", message.message);
      break;
    case "token":
      appendStreamToken(message.token);
      break;
    case "final":
      finalizeAssistantMessage(message.response, state.currentStatuses.slice());
      break;
    case "error":
      appendMessage("error", message.message);
      break;
    case "editApplied":
      markEditApplied(message.editId, message.filePath);
      break;
    case "editPreviewOpened":
      appendMessage(
        "status",
        `Opened diff preview for ${message.filePath || message.editId}.`,
      );
      break;
    case "editRejected":
      markEditRejected(message.editId);
      break;
    case "cleared":
      clearUi();
      break;
    case "attachmentsSelected":
      state.attachments = Array.isArray(message.attachments)
        ? message.attachments
        : [];
      renderAttachments();
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
  state.requireTerminalApproval = config.requireTerminalApproval !== false;
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

function finalizeAssistantMessage(response, statuses) {
  const message = ensureStreamingMessage();
  const body = message.querySelector(".message-body");

  const existingTrace = message.querySelector(".reasoning-trace");
  if (existingTrace) {
    existingTrace.remove();
  }

  if (Array.isArray(statuses) && statuses.length > 0) {
    const trace = document.createElement("details");
    trace.className = "reasoning-trace";

    const summary = document.createElement("summary");
    summary.textContent = `Reasoning Trace (${statuses.length} step${
      statuses.length === 1 ? "" : "s"
    })`;

    const list = document.createElement("ol");
    list.className = "trace-list";
    for (const item of statuses) {
      const li = document.createElement("li");
      li.textContent = `[${item.at}] ${item.text}`;
      list.appendChild(li);
    }

    trace.appendChild(summary);
    trace.appendChild(list);
    message.insertBefore(trace, body);
  }

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

      const badge = document.createElement("div");
      badge.className = "edit-badge";
      badge.textContent = "Approval required";

      const patch = document.createElement("pre");
      patch.className = "patch";
      patch.textContent = edit.patch || edit.newText || "";

      const actions = document.createElement("div");
      actions.className = "edit-actions";

      const previewButton = document.createElement("button");
      previewButton.className = "secondary";
      previewButton.textContent = "Preview Diff";
      previewButton.addEventListener("click", () => {
        vscode.postMessage({ type: "previewEdit", editId: edit.id });
      });

      const applyButton = document.createElement("button");
      applyButton.className = "apply";
      applyButton.textContent = "Apply Edit";
      applyButton.addEventListener("click", () => {
        vscode.postMessage({ type: "applyEdit", editId: edit.id });
      });

      const rejectButton = document.createElement("button");
      rejectButton.className = "secondary";
      rejectButton.textContent = "Reject";
      rejectButton.addEventListener("click", () => {
        vscode.postMessage({ type: "rejectEdit", editId: edit.id });
      });

      actions.appendChild(previewButton);
      actions.appendChild(applyButton);
      actions.appendChild(rejectButton);

      const statusLine = document.createElement("div");
      statusLine.className = "edit-status";
      statusLine.textContent = "Pending review";

      card.appendChild(summary);
      card.appendChild(badge);
      card.appendChild(patch);
      card.appendChild(actions);
      card.appendChild(statusLine);
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
    const buttons = card.querySelectorAll("button");
    for (const button of buttons) {
      button.disabled = true;
    }

    const statusLine = card.querySelector(".edit-status");
    if (statusLine) {
      statusLine.textContent = `Applied to ${filePath}`;
    }

    card.classList.add("approved");
  }
}

function markEditRejected(editId) {
  const card = ui.chat.querySelector(`[data-edit-id="${cssEscape(editId)}"]`);
  if (!card) {
    return;
  }

  const buttons = card.querySelectorAll("button");
  for (const button of buttons) {
    button.disabled = true;
  }

  const statusLine = card.querySelector(".edit-status");
  if (statusLine) {
    statusLine.textContent = "Rejected";
  }

  card.classList.add("rejected");
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
  state.attachments = [];
  state.currentStatuses = [];
  ui.chat.textContent = "";
  ui.historyList.textContent = "";
  renderAttachments();
}

function renderAttachments() {
  ui.attachmentList.textContent = "";

  if (state.attachments.length === 0) {
    const li = document.createElement("li");
    li.className = "attachment-empty";
    li.textContent = "No attachments selected";
    ui.attachmentList.appendChild(li);
    return;
  }

  for (const attachment of state.attachments) {
    const li = document.createElement("li");
    li.className = "attachment-item";

    const label = document.createElement("span");
    label.textContent = `${attachment.fileName} (${attachment.kind})`;

    const removeButton = document.createElement("button");
    removeButton.className = "attachment-remove";
    removeButton.textContent = "Remove";
    removeButton.addEventListener("click", () => {
      vscode.postMessage({
        type: "removeAttachment",
        attachmentId: attachment.id,
      });
    });

    li.appendChild(label);
    li.appendChild(removeButton);
    ui.attachmentList.appendChild(li);
  }
}

function cssEscape(value) {
  if (window.CSS && typeof window.CSS.escape === "function") {
    return window.CSS.escape(value);
  }

  return String(value).replace(/[^a-zA-Z0-9_-]/g, "_");
}
