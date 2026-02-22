/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface ClaudeSettings {
  model?: string;
  permissions?: {
    defaultMode?: string;
  };
  env?: {
    ANTHROPIC_MODEL?: string;
    [key: string]: string | undefined;
  };
  enabledPlugins?: Record<string, boolean>;
  [key: string]: unknown;
}

/**
 * Get Claude settings file path (cross-platform)
 * - macOS/Linux: ~/.claude/settings.json
 * - Windows: %USERPROFILE%\.claude\settings.json
 */
export function getClaudeSettingsPath(): string {
  return path.join(os.homedir(), '.claude', 'settings.json');
}

/**
 * Read Claude settings from settings.json
 */
export function readClaudeSettings(): ClaudeSettings | null {
  try {
    const settingsPath = getClaudeSettingsPath();
    if (!fs.existsSync(settingsPath)) {
      return null;
    }
    const content = fs.readFileSync(settingsPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Get model from Claude settings.
 * Priority: settings.model > settings.env.ANTHROPIC_MODEL
 */
export function getClaudeModel(): string | null {
  const settings = readClaudeSettings();
  return settings?.model ?? settings?.env?.ANTHROPIC_MODEL ?? null;
}

/**
 * Get default mode from Claude settings (e.g., 'bypassPermissions')
 */
export function getClaudeDefaultMode(): string | null {
  const settings = readClaudeSettings();
  return settings?.permissions?.defaultMode ?? null;
}

// --- CodeBuddy settings support ---
// Note: CodeBuddy settings (~/.codebuddy/settings.json) contains sandbox/trust config,
// NOT model preferences. Model selection is handled by the CLI itself.
// MCP servers are configured in ~/.codebuddy/mcp.json
