import React from "react";
import { Settings } from "lucide-react";
import type { ProviderId, SearchProviderId, SidebarSettings } from "../types";
import { providerPresets, getSearchProviderPlaceholder, getSearchProviderHint, getSearchProviderUrlPlaceholder } from "../utils";
import { useStore, vscode } from "../store";

export function SettingsDropdown({
  isOpen,
  onToggle,
  activeSession,
  settings,
  modelsForActiveProvider,
  localApiKey,
  setLocalApiKey,
  localSearchApiKey,
  setLocalSearchApiKey,
}: {
  isOpen: boolean;
  onToggle: () => void;
  activeSession: { provider: ProviderId; model: string };
  settings: SidebarSettings;
  modelsForActiveProvider: string[];
  localApiKey: string;
  setLocalApiKey: (v: string) => void;
  localSearchApiKey: string;
  setLocalSearchApiKey: (v: string) => void;
}) {
  return (
    <div className="nk-settings-dropdown-wrap">
      <button
        className="nk-icon-btn"
        title="Settings"
        onClick={onToggle}
      >
        <Settings size={14} />
      </button>
      {isOpen && (
        <div className="nk-settings-dropdown">
          {/* Provider Selection */}
          <div className="nk-settings-section">
            <div className="nk-settings-label">Provider</div>
            <select
              className="nk-settings-select"
              value={activeSession.provider}
              onChange={(e) => {
                const provider = e.target.value as ProviderId;
                useStore.getState().updateActiveSession({ provider, model: "" });
                vscode.postMessage({ type: "refreshProviderStatus", provider });
                vscode.postMessage({ type: "requestModelSuggestions", provider });
              }}
            >
              <option value="ollama">Ollama (Local)</option>
              <option value="openai-compatible">OpenAI Compatible</option>
              <option value="huggingface">Hugging Face</option>
              <option value="openrouter">OpenRouter</option>
              <option value="together">Together AI</option>
              <option value="fireworks">Fireworks AI</option>
              <option value="groq">GroqCloud</option>
              <option value="nvidia">NVIDIA NIM</option>
              <option value="baseten">Baseten</option>
            </select>
          </div>

          {/* Model Selection */}
          <div className="nk-settings-section">
            <div className="nk-settings-label">Model</div>
            <select
              className="nk-settings-select"
              value={activeSession.model}
              onChange={(e) => {
                useStore.getState().updateActiveSession({ model: e.target.value });
              }}
            >
              {modelsForActiveProvider.length === 0 ? (
                <option value={activeSession.model}>
                  {activeSession.model}
                </option>
              ) : (
                modelsForActiveProvider.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))
              )}
            </select>
          </div>

          {/* Ollama Settings - only show when provider is ollama */}
          {activeSession.provider === 'ollama' && (
            <div className="nk-settings-section">
              <div className="nk-settings-label">Ollama Base URL</div>
              <input
                className="nk-settings-input"
                type="text"
                placeholder="http://localhost:11434"
                value={settings.ollamaBaseUrl ?? 'http://localhost:11434'}
                onChange={(e) => {
                  useStore.getState().updateSetting('ollamaBaseUrl', e.target.value);
                }}
              />
            </div>
          )}

          {/* Cloud Provider Settings - show for all cloud providers */}
          {activeSession.provider !== 'ollama' && (() => {
            const preset = providerPresets[activeSession.provider] ?? providerPresets['openai-compatible'];
            return (
              <>
                <div className="nk-settings-section">
                  <div className="nk-settings-label">API Base URL</div>
                  <input
                    className="nk-settings-input"
                    type="text"
                    placeholder={preset.baseUrl || "https://api.example.com/v1"}
                    value={settings.openAIBaseUrl ?? ''}
                    onChange={(e) => {
                      useStore.getState().updateSetting('openAIBaseUrl', e.target.value);
                    }}
                  />
                </div>
                <div className="nk-settings-section">
                  <div className="nk-settings-label">
                    API Key
                    {settings.openAIApiKeyConfigured && (
                      <span style={{ marginLeft: 8, fontSize: '0.85em', opacity: 0.7 }}>(configured)</span>
                    )}
                  </div>
                  <input
                    className="nk-settings-input"
                    type="password"
                    placeholder={settings.openAIApiKeyConfigured ? "Key stored securely — type to replace" : preset.apiKeyPlaceholder}
                    value={localApiKey}
                    onChange={(e) => {
                      setLocalApiKey(e.target.value);
                    }}
                    onBlur={() => {
                      // NC-003: Send the secret to the extension host on blur.
                      // Never store it in the Zustand store or webview state.
                      if (localApiKey.trim()) {
                        useStore.getState().sendSecret('openAIApiKey', localApiKey);
                        setLocalApiKey('');
                      }
                    }}
                  />
                  <div className="nk-settings-hint">
                    {preset.hint}
                  </div>
                </div>
              </>
            );
          })()}

          {/* Web Search Settings - show when web search is enabled */}
          {settings.enableWebSearch && (
            <>
              <div className="nk-settings-section">
                <div className="nk-settings-label">Search Provider</div>
                <select
                  className="nk-settings-select"
                  value={settings.searchProvider ?? 'tavily'}
                  onChange={(e) => {
                    const provider = e.target.value as SearchProviderId;
                    useStore.getState().updateSetting('searchProvider', provider);
                  }}
                >
                  <option value="tavily">Tavily</option>
                  <option value="serpapi">SerpAPI</option>
                  <option value="serper">Serper</option>
                  <option value="bing">Bing Search</option>
                  <option value="duckduckgo">DuckDuckGo (Free)</option>
                  <option value="custom">Custom API</option>
                </select>
              </div>
              {settings.searchProvider !== 'duckduckgo' && (
                <div className="nk-settings-section">
                  <div className="nk-settings-label">
                    Search API Key
                    {settings.searchApiKeyConfigured && (
                      <span style={{ marginLeft: 8, fontSize: '0.85em', opacity: 0.7 }}>(configured)</span>
                    )}
                  </div>
                  <input
                    className="nk-settings-input"
                    type="password"
                    placeholder={settings.searchApiKeyConfigured ? "Key stored securely — type to replace" : getSearchProviderPlaceholder(settings.searchProvider ?? 'tavily')}
                    value={localSearchApiKey}
                    onChange={(e) => {
                      setLocalSearchApiKey(e.target.value);
                    }}
                    onBlur={() => {
                      // NC-003: Send the secret to the extension host on blur.
                      // Never store it in the Zustand store or webview state.
                      if (localSearchApiKey.trim()) {
                        useStore.getState().sendSecret('searchApiKey', localSearchApiKey);
                        setLocalSearchApiKey('');
                      }
                    }}
                  />
                  <div className="nk-settings-hint">
                    {getSearchProviderHint(settings.searchProvider ?? 'tavily')}
                  </div>
                </div>
              )}
              {settings.searchProvider === 'duckduckgo' && (
                <div className="nk-settings-section">
                  <div className="nk-settings-hint">
                    {getSearchProviderHint(settings.searchProvider ?? 'tavily')}
                  </div>
                </div>
              )}
              {(settings.searchProvider === 'custom' || settings.searchProvider === 'serpapi' || settings.searchProvider === 'serper' || settings.searchProvider === 'bing') && (
                <div className="nk-settings-section">
                  <div className="nk-settings-label">Search API Base URL</div>
                  <input
                    className="nk-settings-input"
                    type="text"
                    placeholder={getSearchProviderUrlPlaceholder(settings.searchProvider ?? 'tavily')}
                    value={settings.searchBaseUrl ?? ''}
                    onChange={(e) => {
                      useStore.getState().updateSetting('searchBaseUrl', e.target.value);
                    }}
                  />
                </div>
              )}
            </>
          )}

          {/* Permission Mode */}
          <div className="nk-settings-section">
            <div className="nk-settings-label">Permission Mode</div>
            <select
              className="nk-settings-select"
              value={settings.requireTerminalApproval ? "ask" : "auto"}
              onChange={(e) => {
                const mode = e.target.value;
                if (mode === "auto") {
                  useStore.getState().updateSetting("autoApprove", false);
                  useStore.getState().updateSetting("requireTerminalApproval", false);
                  vscode.postMessage({ type: "updateSetting", key: "toolApproval", value: "auto" });
                } else {
                  useStore.getState().updateSetting("autoApprove", false);
                  useStore.getState().updateSetting("requireTerminalApproval", true);
                  vscode.postMessage({ type: "updateSetting", key: "toolApproval", value: "ask" });
                }
              }}
            >
              <option value="ask">Ask — require approval for destructive tools</option>
              <option value="auto">Auto — approve safe tools automatically</option>
            </select>
          </div>

          {/* Links */}
          <div className="nk-settings-section nk-settings-links">
            <div
              className="nk-settings-link"
              onClick={() => {
                vscode.postMessage({ type: "openSettings" });
                onToggle();
              }}
            >
              All Settings
            </div>
            <div
              className="nk-settings-link"
              onClick={() => {
                vscode.postMessage({ type: "openShortcuts" });
                onToggle();
              }}
            >
              Keyboard Shortcuts
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
