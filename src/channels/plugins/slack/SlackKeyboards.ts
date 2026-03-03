/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ChannelAgentType } from '../../types';

/**
 * Slack Block Kit Action Builders
 *
 * Slack equivalent of TelegramKeyboards. Instead of InlineKeyboard / Reply Keyboard,
 * Slack uses Block Kit "actions" blocks containing interactive elements.
 *
 * Action IDs follow the same `category:action` convention as Telegram callback data
 * (e.g. "session:new", "agent:gemini", "confirm:<callId>:<value>").
 */

// ==================== Internal Helpers ====================

/**
 * Build a Block Kit `actions` block.
 * @param blockId - Unique identifier for the block (used for interaction routing)
 * @param buttons - Array of button descriptors
 */
function actionsBlock(blockId: string, buttons: Array<{ text: string; actionId: string; style?: 'primary' | 'danger' }>): any {
  return {
    type: 'actions',
    block_id: blockId,
    elements: buttons.map((btn) => ({
      type: 'button',
      text: { type: 'plain_text', text: btn.text, emoji: true },
      action_id: btn.actionId,
      ...(btn.style ? { style: btn.style } : {}),
    })),
  };
}

// ==================== Menu Blocks ====================

/**
 * Main menu buttons shown to authorized users.
 * Equivalent to Telegram's persistent reply keyboard.
 */
export function createMainMenuBlocks(): any[] {
  return [
    actionsBlock('main_menu', [
      { text: '🆕 New Chat', actionId: 'session:new' },
      { text: '🔄 Agent', actionId: 'agent:select' },
      { text: '📊 Status', actionId: 'session:status' },
      { text: '❓ Help', actionId: 'help:main' },
    ]),
  ];
}

/**
 * Pairing-phase buttons shown before user is authorized.
 */
export function createPairingBlocks(): any[] {
  return [
    actionsBlock('pairing_menu', [
      { text: '🔄 Refresh Status', actionId: 'pairing:check' },
      { text: '❓ Help', actionId: 'pairing:help' },
    ]),
  ];
}

// ==================== Agent Selection ====================

/**
 * Agent info for block display
 */
export interface AgentDisplayInfo {
  type: ChannelAgentType;
  emoji: string;
  name: string;
}

/**
 * Agent selection blocks.
 * Shows available agents with the current selection marked with a checkmark.
 * Buttons are laid out in rows of 2 via separate actions blocks.
 * @param availableAgents - List of available agents to display
 * @param currentAgent - Currently selected agent type
 */
export function createAgentSelectionBlocks(availableAgents: AgentDisplayInfo[], currentAgent?: ChannelAgentType): any[] {
  const blocks: any[] = [];

  // Group buttons in rows of 2, each row is its own actions block
  for (let i = 0; i < availableAgents.length; i += 2) {
    const rowButtons: Array<{ text: string; actionId: string }> = [];

    for (let j = i; j < Math.min(i + 2, availableAgents.length); j++) {
      const agent = availableAgents[j];
      const label = currentAgent === agent.type ? `✓ ${agent.emoji} ${agent.name}` : `${agent.emoji} ${agent.name}`;
      rowButtons.push({ text: label, actionId: `agent:${agent.type}` });
    }

    blocks.push(actionsBlock(`agent_selection_${i}`, rowButtons));
  }

  return blocks;
}

// ==================== Response Actions ====================

/**
 * Action buttons attached to AI response messages.
 */
export function createResponseActionsBlocks(): any[] {
  return [
    actionsBlock('response_actions', [
      { text: '📋 Copy', actionId: 'action:copy' },
      { text: '🔄 Regenerate', actionId: 'action:regenerate' },
      { text: '💬 Continue', actionId: 'action:continue' },
    ]),
  ];
}

// ==================== Tool Confirmation ====================

/**
 * Tool confirmation blocks for agent tool calls.
 * Uses primary style for proceed and danger style for cancel/deny options.
 * @param callId - The tool call ID for tracking
 * @param options - Array of { label, value } options
 */
export function createToolConfirmationBlocks(callId: string, options: Array<{ label: string; value: string }>): any[] {
  const blocks: any[] = [];

  // Show at most 2 buttons per row
  for (let i = 0; i < options.length; i += 2) {
    const rowButtons: Array<{ text: string; actionId: string; style?: 'primary' | 'danger' }> = [];

    rowButtons.push({
      text: options[i].label,
      actionId: `confirm:${callId}:${options[i].value}`,
      style: options[i].value === 'proceed' || options[i].value === 'allow' ? 'primary' : 'danger',
    });

    if (i + 1 < options.length) {
      rowButtons.push({
        text: options[i + 1].label,
        actionId: `confirm:${callId}:${options[i + 1].value}`,
        style: options[i + 1].value === 'proceed' || options[i + 1].value === 'allow' ? 'primary' : 'danger',
      });
    }

    blocks.push(actionsBlock(`tool_confirm_${i}`, rowButtons));
  }

  return blocks;
}

// ==================== Error Recovery ====================

/**
 * Error recovery blocks with retry and new session options.
 */
export function createErrorRecoveryBlocks(): any[] {
  return [
    actionsBlock('error_recovery', [
      { text: '🔄 Retry', actionId: 'error:retry', style: 'primary' },
      { text: '🆕 New Session', actionId: 'session:new' },
    ]),
  ];
}

// ==================== Action ID Utilities ====================

/**
 * Extract action category from an action ID.
 * e.g. "action:copy" -> "action", "confirm:abc123:proceed" -> "confirm"
 */
export function extractCategory(actionId: string): string {
  const parts = actionId.split(':');
  return parts[0];
}

/**
 * Extract action name from an action ID.
 * e.g. "action:copy" -> "copy", "confirm:abc123:proceed" -> "abc123"
 */
export function extractAction(actionId: string): string {
  const parts = actionId.split(':');
  return parts.length > 1 ? parts[1] : actionId;
}
