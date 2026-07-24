import React from "react";
import { Settings } from "lucide-react";
import type { SidebarSettings } from "../types";
import { useStore, vscode } from "../store";

export function SettingsDropdown({
  isOpen,
  onToggle,
  settings,
}: {
  isOpen: boolean;
  onToggle: () => void;
  settings: SidebarSettings;
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
