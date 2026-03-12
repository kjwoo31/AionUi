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
      { text: '📂 Join', actionId: 'session:list' },
      { text: '🔄 Agent', actionId: 'agent:select' },
      { text: '📊 Status', actionId: 'session:status' },
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

// ==================== Pairing Blocks ====================

/**
 * Pairing code display blocks with refresh option.
 * Equivalent to Telegram's createPairingCodeKeyboard.
 */
export function createPairingCodeBlocks(): any[] {
  return [
    actionsBlock('pairing_code', [
      { text: '🔄 Refresh Code', actionId: 'pairing:refresh' },
      { text: '❓ Pairing Help', actionId: 'pairing:help' },
    ]),
  ];
}

/**
 * Pairing status check blocks.
 * Equivalent to Telegram's createPairingStatusKeyboard.
 */
export function createPairingStatusBlocks(): any[] {
  return [
    actionsBlock('pairing_status', [
      { text: '🔄 Check Status', actionId: 'pairing:check' },
      { text: '🔄 Get New Code', actionId: 'pairing:refresh' },
    ]),
  ];
}

// ==================== Session Control ====================

/**
 * Session control blocks.
 * Equivalent to Telegram's createSessionControlKeyboard.
 */
export function createSessionControlBlocks(): any[] {
  return [
    actionsBlock('session_control', [
      { text: '🆕 New Session', actionId: 'session:new' },
      { text: '📊 Session Status', actionId: 'session:status' },
    ]),
  ];
}

// ==================== Help Blocks ====================

/**
 * Help menu blocks.
 * Equivalent to Telegram's createHelpKeyboard.
 */
export function createHelpBlocks(): any[] {
  return [
    actionsBlock('help_menu', [
      { text: '🤖 Features', actionId: 'help:features' },
      { text: '🔗 Pairing Guide', actionId: 'help:pairing' },
      { text: '💬 Tips', actionId: 'help:tips' },
    ]),
  ];
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

// ==================== App Home View ====================

/**
 * Build the App Home view blocks.
 * Shows a "+ New Chat" button and conversation history list.
 */
export function buildAppHomeBlocks(conversations: ConversationDisplayInfo[]): any[] {
  const blocks: any[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'AionUi Assistant', emoji: true },
    },
    {
      type: 'actions',
      block_id: 'home_actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '+ New Chat', emoji: true },
          action_id: 'home:new_chat',
          style: 'primary',
        },
      ],
    },
    { type: 'divider' },
  ];

  if (conversations.length === 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '_No conversations yet. Click "+ New Chat" to start._' },
    });
    return blocks;
  }

  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: '*History*' },
  });

  for (const conv of conversations) {
    const prefix = conv.isCurrent ? '✓ ' : '';
    const title = `${prefix}${conv.emoji} *${conv.name}*`;
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: title },
      accessory: {
        type: 'button',
        text: { type: 'plain_text', text: 'Continue', emoji: true },
        action_id: `conversation:${conv.id}`,
      },
    });
  }

  return blocks;
}

// ==================== Conversation List ====================

/**
 * Conversation display info for list blocks
 */
export interface ConversationDisplayInfo {
  id: string;
  name: string;
  emoji: string;
  date: string;
  isCurrent: boolean;
}

/**
 * Conversation list blocks for "Join existing conversation".
 * Shows recent conversations as buttons (2 per row).
 * Action ID: `conversation:{conversationId}` (parsed via extractAction).
 */
export function createConversationListBlocks(conversations: ConversationDisplayInfo[]): any[] {
  if (conversations.length === 0) {
    return [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: 'No conversations found.' },
      },
    ];
  }

  const blocks: any[] = [];

  for (let i = 0; i < conversations.length; i += 2) {
    const rowButtons: Array<{ text: string; actionId: string }> = [];

    for (let j = i; j < Math.min(i + 2, conversations.length); j++) {
      const conv = conversations[j];
      const prefix = conv.isCurrent ? '✓ ' : '';
      // Slack button text limit is 75 chars
      const label = `${prefix}${conv.emoji} ${conv.name}`.slice(0, 70);
      rowButtons.push({ text: label, actionId: `conversation:${conv.id}` });
    }

    blocks.push(actionsBlock(`conv_list_${i}`, rowButtons));
  }

  return blocks;
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
