export interface ToolCommand {
  name: string;
  cmd: string;
  args?: string[];
}

export interface ToolDefinition {
  id: string;
  name: string;
  version?: string;
  description?: string;
  commands: ToolCommand[];
  capabilities?: string[];
  permissions?: {
    run?: boolean;
    dangerous?: boolean;
  };
}

export interface ToolRegistry {
  tools: ToolDefinition[];
}

export default ToolRegistry;
