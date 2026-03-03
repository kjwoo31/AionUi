# Slack Channel Plugin Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Slack as a second messaging channel so users can command AI agents through Slack DMs, mirroring the existing Telegram integration.

**Architecture:** Extend the existing Channel plugin system. Create `SlackPlugin` extending `BasePlugin` using `@slack/bolt` in Socket Mode (WebSocket, no public URL needed). Refactor `ActionExecutor` to dispatch platform-specific formatting/keyboards instead of hardcoded Telegram imports.

**Tech Stack:** `@slack/bolt` (Socket Mode), `@slack/web-api` (implicit via bolt), Block Kit for buttons/actions.

---

### Task 1: Install @slack/bolt dependency

**Files:**
- Modify: `package.json`

**Step 1: Install the dependency**

Run: `npm install @slack/bolt`

**Step 2: Verify installation**

Run: `npm ls @slack/bolt`
Expected: `@slack/bolt@<version>` appears in tree

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @slack/bolt dependency for Slack channel plugin"
```

---

### Task 2: Extend type system for Slack

**Files:**
- Modify: `src/channels/types.ts`

**Step 1: Add `appToken` to `IPluginCredentials`**

At `src/channels/types.ts:24`, add `appToken` field:

```typescript
export interface IPluginCredentials {
  // Telegram
  token?: string;
  // Slack - App-Level Token (for Socket Mode)
  appToken?: string;
}
```

**Step 2: Update `hasPluginCredentials` for Slack**

Replace the function body:

```typescript
export function hasPluginCredentials(type: PluginType, credentials?: IPluginCredentials): boolean {
  if (!credentials) return false;
  if (type === 'slack') return !!credentials.token && !!credentials.appToken;
  return !!credentials.token;
}
```

**Step 3: Add `'slack'` to `ChannelPlatform` type and helpers**

At line 450:
```typescript
export type ChannelPlatform = 'telegram' | 'slack';
```

Update `isChannelPlatform`:
```typescript
export function isChannelPlatform(value: string): value is ChannelPlatform {
  return value === 'telegram' || value === 'slack';
}
```

Update `getChannelConversationName` shortPlatform map:
```typescript
const shortPlatform: Record<string, string> = { telegram: 'tg', slack: 'sl' };
```

**Step 4: Commit**

```bash
git add src/channels/types.ts
git commit -m "feat(channels): extend type system with Slack credentials and platform support"
```

---

### Task 3: Create SlackAdapter (message conversion)

**Files:**
- Create: `src/channels/plugins/slack/SlackAdapter.ts`

**Step 1: Create the adapter**

```typescript
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { KnownEventFromType } from '@slack/bolt';
import type { IUnifiedIncomingMessage, IUnifiedMessageContent, IUnifiedOutgoingMessage, IUnifiedUser } from '../../types';

// ==================== Constants ====================

/** Slack message length limit */
export const SLACK_MESSAGE_LIMIT = 40000;

// ==================== Incoming Message Conversion ====================

/**
 * Convert Slack message event to unified incoming message
 */
export function toUnifiedIncomingMessage(event: KnownEventFromType<'message'>): IUnifiedIncomingMessage | null {
  // Skip bot messages and message_changed subtypes
  if ('bot_id' in event || ('subtype' in event && event.subtype)) return null;

  const user = toUnifiedUser(event);
  if (!user) return null;

  const content = extractMessageContent(event);

  return {
    id: ('client_msg_id' in event ? event.client_msg_id : event.ts) as string,
    platform: 'slack',
    chatId: event.channel,
    user,
    content,
    timestamp: parseFloat(event.ts) * 1000,
    raw: event,
  };
}

/**
 * Convert Slack event user info to unified user format
 */
export function toUnifiedUser(event: KnownEventFromType<'message'>): IUnifiedUser | null {
  const userId = 'user' in event ? (event.user as string) : undefined;
  if (!userId) return null;

  return {
    id: userId,
    displayName: userId, // Will be resolved by PairingService from Slack user info
  };
}

/**
 * Extract message content from Slack message event
 */
function extractMessageContent(event: KnownEventFromType<'message'>): IUnifiedMessageContent {
  const text = 'text' in event ? (event.text ?? '') : '';

  // Check for file attachments
  if ('files' in event && event.files && (event.files as any[]).length > 0) {
    return {
      type: 'document',
      text,
      attachments: (event.files as any[]).map((f: any) => ({
        type: 'document' as const,
        fileId: f.id,
        fileName: f.name,
        mimeType: f.mimetype,
        size: f.size,
      })),
    };
  }

  return { type: 'text', text };
}

// ==================== Outgoing Message Conversion ====================

/**
 * Convert unified outgoing message to Slack chat.postMessage params
 */
export function toSlackSendParams(message: IUnifiedOutgoingMessage): {
  text: string;
  blocks?: any[];
  mrkdwn?: boolean;
} {
  const text = message.text || '';

  // If replyMarkup is provided (Block Kit actions), include it
  if (message.replyMarkup) {
    return {
      text,
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text } },
        ...(Array.isArray(message.replyMarkup) ? message.replyMarkup : [message.replyMarkup]),
      ],
      mrkdwn: true,
    };
  }

  return { text, mrkdwn: true };
}

// ==================== Text Formatting ====================

/**
 * Escape special characters for Slack mrkdwn
 * Slack mrkdwn is simpler than Telegram HTML - mostly just escape &, <, >
 */
export function escapeSlackMrkdwn(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Convert HTML-style formatting to Slack mrkdwn
 * Used when ActionExecutor generates HTML-formatted text
 */
export function htmlToSlackMrkdwn(html: string): string {
  let result = html;
  // Bold: <b>text</b> → *text*
  result = result.replace(/<b>(.*?)<\/b>/g, '*$1*');
  // Italic: <i>text</i> → _text_
  result = result.replace(/<i>(.*?)<\/i>/g, '_$1_');
  // Code: <code>text</code> → `text`
  result = result.replace(/<code>(.*?)<\/code>/g, '`$1`');
  // Pre: <pre><code>text</code></pre> → ```text```
  result = result.replace(/<pre><code>([\s\S]*?)<\/code><\/pre>/g, '```$1```');
  // Links: <a href="url">text</a> → <url|text>
  result = result.replace(/<a href="([^"]+)">([^<]+)<\/a>/g, '<$1|$2>');
  // Unescape HTML entities last
  result = result.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  return result;
}

// ==================== Message Length Utilities ====================

/**
 * Split long text into chunks for Slack
 */
export function splitMessage(text: string, maxLength: number = SLACK_MESSAGE_LIMIT): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    let splitIndex = maxLength;
    const searchStart = Math.floor(maxLength * 0.8);
    const lastNewline = remaining.lastIndexOf('\n', maxLength);
    if (lastNewline > searchStart) {
      splitIndex = lastNewline + 1;
    } else {
      const lastSpace = remaining.lastIndexOf(' ', maxLength);
      if (lastSpace > searchStart) splitIndex = lastSpace + 1;
    }

    chunks.push(remaining.slice(0, splitIndex).trim());
    remaining = remaining.slice(splitIndex).trim();
  }

  return chunks;
}
```

**Step 2: Commit**

```bash
git add src/channels/plugins/slack/SlackAdapter.ts
git commit -m "feat(channels): add SlackAdapter for message conversion"
```

---

### Task 4: Create SlackKeyboards (Block Kit actions)

**Files:**
- Create: `src/channels/plugins/slack/SlackKeyboards.ts`

**Step 1: Create the keyboards file**

```typescript
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ChannelAgentType } from '../../types';

/**
 * Slack Block Kit keyboard equivalents
 *
 * Slack uses "blocks" with "actions" instead of Telegram's InlineKeyboard.
 * Reply keyboards don't exist in Slack — we use app_home or persistent buttons in messages instead.
 */

// ==================== Block Kit Action Builders ====================

/**
 * Create an actions block with buttons
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

// ==================== Menu / Navigation ====================

/**
 * Main menu actions (equivalent to Telegram's reply keyboard)
 * Sent as a message with action buttons
 */
export function createMainMenuBlocks(): any[] {
  return [
    actionsBlock('main_menu', [
      { text: 'New Chat', actionId: 'session:new', style: 'primary' },
      { text: 'Agent', actionId: 'agent:show' },
      { text: 'Status', actionId: 'session:status' },
      { text: 'Help', actionId: 'help:show' },
    ]),
  ];
}

/**
 * Pairing-phase actions
 */
export function createPairingBlocks(): any[] {
  return [
    actionsBlock('pairing_actions', [
      { text: 'Refresh Status', actionId: 'pairing:check' },
      { text: 'Help', actionId: 'help:show' },
    ]),
  ];
}

// ==================== Agent Selection ====================

export interface AgentDisplayInfo {
  type: ChannelAgentType;
  emoji: string;
  name: string;
}

/**
 * Agent selection actions
 */
export function createAgentSelectionBlocks(availableAgents: AgentDisplayInfo[], currentAgent?: ChannelAgentType): any[] {
  return [
    actionsBlock(
      'agent_selection',
      availableAgents.map((agent) => ({
        text: currentAgent === agent.type ? `${agent.emoji} ${agent.name} (current)` : `${agent.emoji} ${agent.name}`,
        actionId: `agent:${agent.type}`,
      }))
    ),
  ];
}

// ==================== Response Actions ====================

/**
 * Actions for completed AI responses
 */
export function createResponseActionsBlocks(): any[] {
  return [
    actionsBlock('response_actions', [
      { text: 'Copy', actionId: 'action:copy' },
      { text: 'Regenerate', actionId: 'action:regenerate' },
      { text: 'Continue', actionId: 'action:continue' },
    ]),
  ];
}

// ==================== Tool Confirmation ====================

/**
 * Tool confirmation buttons
 */
export function createToolConfirmationBlocks(callId: string, options: Array<{ label: string; value: string }>): any[] {
  return [
    actionsBlock(
      `tool_confirm_${callId}`,
      options.map((opt) => ({
        text: opt.label,
        actionId: `confirm:${callId}:${opt.value}`,
        ...(opt.value.startsWith('proceed') ? { style: 'primary' as const } : opt.value === 'cancel' ? { style: 'danger' as const } : {}),
      }))
    ),
  ];
}

// ==================== Error Recovery ====================

export function createErrorRecoveryBlocks(): any[] {
  return [
    actionsBlock('error_recovery', [
      { text: 'Retry', actionId: 'error:retry', style: 'primary' },
      { text: 'New Session', actionId: 'session:new' },
    ]),
  ];
}

// ==================== Utilities ====================

/**
 * Extract action category from action_id (same logic as Telegram)
 * e.g. "action:copy" → "action"
 */
export function extractCategory(actionId: string): string {
  return actionId.split(':')[0];
}

/**
 * Extract action name from action_id
 * e.g. "action:copy" → "copy"
 */
export function extractAction(actionId: string): string {
  const parts = actionId.split(':');
  return parts.length > 1 ? parts[1] : actionId;
}
```

**Step 2: Commit**

```bash
git add src/channels/plugins/slack/SlackKeyboards.ts
git commit -m "feat(channels): add SlackKeyboards with Block Kit action builders"
```

---

### Task 5: Create SlackPlugin (main plugin implementation)

**Files:**
- Create: `src/channels/plugins/slack/SlackPlugin.ts`

**Step 1: Create the plugin**

```typescript
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { App, type BlockAction, type SlackEventMiddlewareArgs } from '@slack/bolt';
import type { BotInfo, IChannelPluginConfig, IUnifiedOutgoingMessage, PluginType } from '../../types';
import { BasePlugin } from '../BasePlugin';
import { SLACK_MESSAGE_LIMIT, splitMessage, toSlackSendParams, toUnifiedIncomingMessage } from './SlackAdapter';
import { extractAction, extractCategory } from './SlackKeyboards';

/**
 * SlackPlugin - Slack Bot integration for AionUi Channel
 *
 * Uses @slack/bolt in Socket Mode (WebSocket, no public URL needed)
 * Mirrors TelegramPlugin's architecture
 */
export class SlackPlugin extends BasePlugin {
  readonly type: PluginType = 'slack';

  private app: App | null = null;
  private botUserId: string | null = null;
  private botUsername: string | null = null;
  private reconnectAttempts: number = 0;
  private readonly maxReconnectAttempts: number = 10;
  private activeUsers: Set<string> = new Set();

  /**
   * Initialize the Slack bot instance
   */
  protected async onInitialize(config: IChannelPluginConfig): Promise<void> {
    const token = config.credentials?.token;
    const appToken = config.credentials?.appToken;

    if (!token) throw new Error('Slack Bot Token is required');
    if (!appToken) throw new Error('Slack App-Level Token is required for Socket Mode');

    this.app = new App({
      token,
      appToken,
      socketMode: true,
    });

    this.setupHandlers();
  }

  /**
   * Start Socket Mode connection
   */
  protected async onStart(): Promise<void> {
    if (!this.app) throw new Error('App not initialized');

    try {
      // Validate token and get bot info
      const authResult = await this.app.client.auth.test();
      this.botUserId = authResult.user_id as string;
      this.botUsername = authResult.user as string;

      await this.app.start();
      this.reconnectAttempts = 0;
      console.log(`[SlackPlugin] Started for @${this.botUsername}`);
    } catch (error) {
      console.error('[SlackPlugin] Failed to start:', error);
      throw error;
    }
  }

  /**
   * Stop and cleanup
   */
  protected async onStop(): Promise<void> {
    if (this.app) {
      await this.app.stop();
    }
    this.app = null;
    this.botUserId = null;
    this.botUsername = null;
    this.activeUsers.clear();
    this.reconnectAttempts = 0;
    console.log('[SlackPlugin] Stopped and cleaned up');
  }

  getActiveUserCount(): number {
    return this.activeUsers.size;
  }

  getBotInfo(): BotInfo | null {
    if (!this.botUserId) return null;
    return {
      id: this.botUserId,
      username: this.botUsername || undefined,
      displayName: this.botUsername || 'Slack Bot',
    };
  }

  /**
   * Send a message to a Slack channel/DM
   */
  async sendMessage(chatId: string, message: IUnifiedOutgoingMessage): Promise<string> {
    if (!this.app) throw new Error('App not initialized');

    const { text, blocks, mrkdwn } = toSlackSendParams(message);

    // Handle long messages by splitting
    const chunks = splitMessage(text, SLACK_MESSAGE_LIMIT);
    let lastTs = '';

    for (let i = 0; i < chunks.length; i++) {
      const isLastChunk = i === chunks.length - 1;
      try {
        const result = await this.app.client.chat.postMessage({
          channel: chatId,
          text: chunks[i],
          blocks: isLastChunk ? blocks : undefined,
          mrkdwn: mrkdwn ?? true,
        });
        lastTs = result.ts as string;
      } catch (error) {
        console.error(`[SlackPlugin] Failed to send message chunk ${i + 1}/${chunks.length}:`, error);
        throw error;
      }
    }

    return lastTs;
  }

  /**
   * Edit an existing message (for streaming updates)
   */
  async editMessage(chatId: string, messageId: string, message: IUnifiedOutgoingMessage): Promise<void> {
    if (!this.app) throw new Error('App not initialized');

    const { text, blocks, mrkdwn } = toSlackSendParams(message);
    const truncatedText = text.length > SLACK_MESSAGE_LIMIT ? text.slice(0, SLACK_MESSAGE_LIMIT - 3) + '...' : text;

    if (!truncatedText.trim()) return;

    try {
      await this.app.client.chat.update({
        channel: chatId,
        ts: messageId,
        text: truncatedText,
        blocks,
        mrkdwn: mrkdwn ?? true,
      });
    } catch (error: any) {
      // Ignore "message not modified" errors
      if (error?.data?.error === 'message_not_modified') return;
      console.error('[SlackPlugin] Failed to edit message:', error);
      throw error;
    }
  }

  /**
   * Setup message and action handlers
   */
  private setupHandlers(): void {
    if (!this.app) return;

    // Handle all messages (DMs and mentions)
    this.app.message(async ({ event, say }) => {
      await this.handleMessage(event);
    });

    // Handle block action button clicks (equivalent to Telegram callback queries)
    this.app.action(/.*/, async ({ action, body, ack }) => {
      await ack();
      await this.handleBlockAction(action as BlockAction, body);
    });

    // Global error handler
    this.app.error(async (error) => {
      console.error('[SlackPlugin] App error:', error);
      this.setError(error.message || String(error));
    });
  }

  /**
   * Handle incoming messages
   */
  private async handleMessage(event: SlackEventMiddlewareArgs<'message'>['event']): Promise<void> {
    // Skip bot messages
    if ('bot_id' in event) return;

    const userId = 'user' in event ? (event.user as string) : undefined;
    if (!userId) return;
    if (userId === this.botUserId) return; // Skip own messages

    this.activeUsers.add(userId);

    const unifiedMessage = toUnifiedIncomingMessage(event as any);
    if (unifiedMessage && this.messageHandler) {
      void this.messageHandler(unifiedMessage).catch((error) => {
        console.error('[SlackPlugin] Message handler failed:', error);
      });
    }
  }

  /**
   * Handle block action button clicks
   */
  private async handleBlockAction(action: BlockAction, body: any): Promise<void> {
    if (action.type !== 'button') return;

    const actionId = action.action_id;
    const userId = body?.user?.id;
    if (!userId || !actionId) return;

    this.activeUsers.add(userId);

    const category = extractCategory(actionId);

    // Handle tool confirmation
    if (category === 'confirm') {
      const parts = actionId.split(':');
      if (parts.length >= 3 && this.confirmHandler) {
        const callId = parts[1];
        const value = parts.slice(2).join(':');
        void this.confirmHandler(userId, 'slack', callId, value).catch((error) => {
          console.error('[SlackPlugin] Confirm handler failed:', error);
        });
      }
      return;
    }

    // Handle agent selection
    if (category === 'agent') {
      const agentType = extractAction(actionId);
      const chatId = body?.channel?.id || body?.container?.channel_id;
      if (!chatId) return;

      const unifiedMessage = {
        id: `action_${Date.now()}`,
        platform: 'slack' as const,
        chatId,
        user: { id: userId, displayName: userId },
        content: { type: 'action' as const, text: 'agent.select' },
        timestamp: Date.now(),
        action: {
          type: 'system' as const,
          name: 'agent.select',
          params: { agentType },
        },
      };

      if (this.messageHandler) {
        void this.messageHandler(unifiedMessage).catch((error) => {
          console.error('[SlackPlugin] Agent selection handler failed:', error);
        });
      }
      return;
    }

    // Other actions → route through messageHandler
    const chatId = body?.channel?.id || body?.container?.channel_id;
    if (!chatId) return;

    const actionName = extractAction(actionId);
    const unifiedMessage = {
      id: `action_${Date.now()}`,
      platform: 'slack' as const,
      chatId,
      user: { id: userId, displayName: userId },
      content: { type: 'action' as const, text: actionId },
      timestamp: Date.now(),
      action: {
        type: (category === 'pairing' ? 'platform' : category === 'action' || category === 'session' ? 'system' : 'chat') as any,
        name: `${category}.${actionName}`,
      },
    };

    if (this.messageHandler) {
      void this.messageHandler(unifiedMessage).catch((error) => {
        console.error('[SlackPlugin] Action handler failed:', error);
      });
    }
  }

  /**
   * Test connection with tokens
   */
  static async testConnection(token: string, appToken?: string): Promise<{ success: boolean; botInfo?: BotInfo; error?: string }> {
    try {
      // Only need Bot Token to test auth
      const { WebClient } = await import('@slack/web-api');
      const client = new WebClient(token);
      const result = await client.auth.test();

      return {
        success: true,
        botInfo: {
          id: result.user_id as string,
          username: result.user as string,
          displayName: (result.user as string) || 'Slack Bot',
        },
      };
    } catch (error: any) {
      let errorMessage = 'Connection failed';
      if (error?.data?.error === 'invalid_auth') {
        errorMessage = 'Invalid bot token';
      } else if (error?.data?.error === 'not_authed') {
        errorMessage = 'Token not provided or empty';
      } else if (error.message) {
        errorMessage = error.message;
      }
      return { success: false, error: errorMessage };
    }
  }
}
```

**Step 2: Create index.ts export**

Create `src/channels/plugins/slack/index.ts`:

```typescript
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export { SlackPlugin } from './SlackPlugin';
export * from './SlackAdapter';
export * from './SlackKeyboards';
```

**Step 3: Commit**

```bash
git add src/channels/plugins/slack/
git commit -m "feat(channels): add SlackPlugin with Socket Mode support"
```

---

### Task 6: Refactor ActionExecutor to be platform-agnostic

**Files:**
- Modify: `src/channels/gateway/ActionExecutor.ts`
- Modify: `src/channels/plugins/index.ts`

**Critical Issue:** `ActionExecutor` currently hardcodes Telegram imports (`escapeHtml`, `createMainMenuKeyboard`, `createToolConfirmationKeyboard`) and has `const source = 'telegram'` hardcoded. This must be made platform-aware.

**Step 1: Update plugins/index.ts exports**

Add Slack plugin exports:

```typescript
// Slack plugin
export { SlackPlugin } from './slack/SlackPlugin';
export * from './slack/SlackAdapter';
export * from './slack/SlackKeyboards';
```

**Step 2: Refactor ActionExecutor platform helpers**

Replace imports at top of `ActionExecutor.ts`:

```typescript
// Platform-specific imports
import { createMainMenuKeyboard, createToolConfirmationKeyboard } from '../plugins/telegram/TelegramKeyboards';
import { escapeHtml } from '../plugins/telegram/TelegramAdapter';
import { createMainMenuBlocks, createToolConfirmationBlocks, createErrorRecoveryBlocks } from '../plugins/slack/SlackKeyboards';
import { escapeSlackMrkdwn, htmlToSlackMrkdwn } from '../plugins/slack/SlackAdapter';
```

Update `getMainMenuMarkup`:
```typescript
function getMainMenuMarkup(platform: PluginType) {
  if (platform === 'slack') return createMainMenuBlocks();
  return createMainMenuKeyboard();
}
```

Update `getToolConfirmationMarkup`:
```typescript
function getToolConfirmationMarkup(platform: PluginType, callId: string, options: Array<{ label: string; value: string }>, title?: string, description?: string) {
  if (platform === 'slack') return createToolConfirmationBlocks(callId, options);
  return createToolConfirmationKeyboard(callId, options);
}
```

Update `getErrorRecoveryMarkup`:
```typescript
function getErrorRecoveryMarkup(platform: PluginType, errorMessage?: string) {
  if (platform === 'slack') return createErrorRecoveryBlocks();
  return createMainMenuKeyboard();
}
```

Update `formatTextForPlatform`:
```typescript
function formatTextForPlatform(text: string, platform: PluginType): string {
  if (platform === 'slack') return escapeSlackMrkdwn(text);
  return escapeHtml(text);
}
```

**Step 3: Fix hardcoded `'telegram'` source and config keys**

In `handleIncomingMessage` (around line 315), replace:

```typescript
const source = 'telegram';
```

with:

```typescript
const source = platform;
```

Replace (around line 319-320):

```typescript
let savedAgent: unknown = undefined;
try {
  savedAgent = await ProcessConfig.get('assistant.telegram.agent');
} catch {
  // ignore
}
```

with:

```typescript
let savedAgent: unknown = undefined;
try {
  savedAgent = await ProcessConfig.get(`assistant.${platform}.agent` as any);
} catch {
  // ignore
}
```

**Step 4: Fix `convertTMessageToOutgoing` to use mrkdwn for Slack**

In the `convertTMessageToOutgoing` function, the `parseMode` should vary by platform:

For the 'text' case, change:
```typescript
parseMode: 'HTML',
```
to use a helper:
```typescript
parseMode: platform === 'slack' ? undefined : 'HTML',
```

Actually, since `IUnifiedOutgoingMessage.parseMode` is Telegram-specific and Slack ignores it (uses `mrkdwn: true` in `toSlackSendParams`), the existing `'HTML'` value is harmless for Slack. But we should convert HTML to mrkdwn in the text:

After `formatTextForPlatform` is called (which now uses `escapeSlackMrkdwn` for Slack), the text returned for tool_group confirmation prompts uses HTML tags (`<b>`, `<code>`). Add a post-processing step:

In `convertTMessageToOutgoing`, when `platform === 'slack'`, run `htmlToSlackMrkdwn()` on confirmation prompt text that contains HTML tags. Update the `tool_group` case's confirmation branch:

```typescript
if (confirmingTool && confirmingTool.confirmationDetails) {
  const options = getConfirmationOptions(confirmingTool.confirmationDetails.type);
  let confirmText = toolLines.join('\n') + '\n\n' + getConfirmationPrompt(confirmingTool.confirmationDetails);
  // Convert HTML to Slack mrkdwn if needed
  if (platform === 'slack') {
    confirmText = htmlToSlackMrkdwn(confirmText);
  }
  // ... rest stays the same
}
```

**Step 5: Commit**

```bash
git add src/channels/gateway/ActionExecutor.ts src/channels/plugins/index.ts
git commit -m "refactor(channels): make ActionExecutor platform-agnostic for Slack support"
```

---

### Task 7: Register SlackPlugin in ChannelManager

**Files:**
- Modify: `src/channels/core/ChannelManager.ts`

**Step 1: Import and register SlackPlugin**

Add import:
```typescript
import { SlackPlugin } from '../plugins/slack/SlackPlugin';
```

In constructor, add registration:
```typescript
private constructor() {
  registerPlugin('telegram', TelegramPlugin);
  registerPlugin('slack', SlackPlugin);
}
```

**Step 2: Update `enablePlugin` to handle Slack credentials**

In `enablePlugin`, after the telegram credential extraction block, add:

```typescript
if (pluginType === 'slack') {
  const token = config.token as string | undefined;
  const appToken = config.appToken as string | undefined;
  if (token || appToken) {
    credentials = {
      ...(credentials || {}),
      ...(token ? { token } : {}),
      ...(appToken ? { appToken } : {}),
    };
  }
}
```

**Step 3: Update `testPlugin` for Slack**

Add Slack branch:
```typescript
if (pluginType === 'slack') {
  const result = await SlackPlugin.testConnection(token);
  return {
    success: result.success,
    botUsername: result.botInfo?.username,
    error: result.error,
  };
}
```

**Step 4: Update `syncChannelSettings` signature**

Change the `platform` parameter type from `'telegram'` to `ChannelPlatform`:
```typescript
async syncChannelSettings(platform: ChannelPlatform, agent: { ... }, model?: { ... }): Promise<{ ... }> {
```

Import `ChannelPlatform` from `../types`.

**Step 5: Commit**

```bash
git add src/channels/core/ChannelManager.ts
git commit -m "feat(channels): register SlackPlugin in ChannelManager"
```

---

### Task 8: Create SlackConfigForm UI component

**Files:**
- Create: `src/renderer/components/SettingsModal/contents/SlackConfigForm.tsx`

**Step 1: Create the form component**

Model after `TelegramConfigForm.tsx` but with two token fields (Bot Token + App-Level Token):

```typescript
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IChannelPairingRequest, IChannelPluginStatus, IChannelUser } from '@/channels/types';
import { acpConversation, channel } from '@/common/ipcBridge';
import { ConfigStorage } from '@/common/storage';
import GeminiModelSelector from '@/renderer/pages/conversation/gemini/GeminiModelSelector';
import type { GeminiModelSelection } from '@/renderer/pages/conversation/gemini/useGeminiModelSelection';
import type { AcpBackendAll } from '@/types/acpTypes';
import { Button, Dropdown, Empty, Input, Menu, Message, Spin, Tooltip } from '@arco-design/web-react';
import { CheckOne, CloseOne, Copy, Delete, Down, Refresh } from '@icon-park/react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

const PreferenceRow: React.FC<{
  label: string;
  description?: React.ReactNode;
  extra?: React.ReactNode;
  children: React.ReactNode;
}> = ({ label, description, extra, children }) => (
  <div className='flex items-center justify-between gap-24px py-12px'>
    <div className='flex-1'>
      <div className='flex items-center gap-8px'>
        <span className='text-14px text-t-primary'>{label}</span>
        {extra}
      </div>
      {description && <div className='text-12px text-t-tertiary mt-2px'>{description}</div>}
    </div>
    <div className='flex items-center'>{children}</div>
  </div>
);

const SectionHeader: React.FC<{ title: string; action?: React.ReactNode }> = ({ title, action }) => (
  <div className='flex items-center justify-between mb-12px'>
    <h3 className='text-14px font-500 text-t-primary m-0'>{title}</h3>
    {action}
  </div>
);

interface SlackConfigFormProps {
  pluginStatus: IChannelPluginStatus | null;
  modelSelection: GeminiModelSelection;
  onStatusChange: (status: IChannelPluginStatus | null) => void;
}

const SlackConfigForm: React.FC<SlackConfigFormProps> = ({ pluginStatus, modelSelection, onStatusChange }) => {
  const { t } = useTranslation();

  const [botToken, setBotToken] = useState('');
  const [appToken, setAppToken] = useState('');
  const [testLoading, setTestLoading] = useState(false);
  const [tokenTested, setTokenTested] = useState(false);
  const [testedBotUsername, setTestedBotUsername] = useState<string | null>(null);
  const [pairingLoading, setPairingLoading] = useState(false);
  const [usersLoading, setUsersLoading] = useState(false);
  const [pendingPairings, setPendingPairings] = useState<IChannelPairingRequest[]>([]);
  const [authorizedUsers, setAuthorizedUsers] = useState<IChannelUser[]>([]);
  const [availableAgents, setAvailableAgents] = useState<Array<{ backend: AcpBackendAll; name: string; customAgentId?: string; isPreset?: boolean }>>([]);
  const [selectedAgent, setSelectedAgent] = useState<{ backend: AcpBackendAll; name?: string; customAgentId?: string }>({ backend: 'gemini' });

  const loadPendingPairings = useCallback(async () => {
    setPairingLoading(true);
    try {
      const result = await channel.getPendingPairings.invoke();
      if (result.success && result.data) {
        setPendingPairings(result.data);
      }
    } catch (error) {
      console.error('[SlackConfig] Failed to load pending pairings:', error);
    } finally {
      setPairingLoading(false);
    }
  }, []);

  const loadAuthorizedUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const result = await channel.getAuthorizedUsers.invoke();
      if (result.success && result.data) {
        setAuthorizedUsers(result.data.filter((u) => u.platformType === 'slack'));
      }
    } catch (error) {
      console.error('[SlackConfig] Failed to load authorized users:', error);
    } finally {
      setUsersLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPendingPairings();
    void loadAuthorizedUsers();
  }, [loadPendingPairings, loadAuthorizedUsers]);

  useEffect(() => {
    const loadAgentsAndSelection = async () => {
      try {
        const [agentsResp, saved] = await Promise.all([acpConversation.getAvailableAgents.invoke(), ConfigStorage.get('assistant.slack.agent')]);
        if (agentsResp.success && agentsResp.data) {
          const list = agentsResp.data.filter((a) => !a.isPreset).map((a) => ({ backend: a.backend, name: a.name, customAgentId: a.customAgentId, isPreset: a.isPreset }));
          setAvailableAgents(list);
        }
        if (saved && typeof saved === 'object' && 'backend' in saved && typeof (saved as any).backend === 'string') {
          setSelectedAgent({ backend: (saved as any).backend as AcpBackendAll, customAgentId: (saved as any).customAgentId, name: (saved as any).name });
        } else if (typeof saved === 'string') {
          setSelectedAgent({ backend: saved as AcpBackendAll });
        }
      } catch (error) {
        console.error('[SlackConfig] Failed to load agents:', error);
      }
    };
    void loadAgentsAndSelection();
  }, []);

  const persistSelectedAgent = async (agent: { backend: AcpBackendAll; customAgentId?: string; name?: string }) => {
    try {
      await ConfigStorage.set('assistant.slack.agent', agent);
      await channel.syncChannelSettings.invoke({ platform: 'slack' as any, agent }).catch(() => {});
      Message.success(t('settings.assistant.agentSwitched', 'Agent switched successfully'));
    } catch (error) {
      console.error('[SlackConfig] Failed to save agent:', error);
      Message.error(t('common.saveFailed', 'Failed to save'));
    }
  };

  useEffect(() => {
    const unsubscribe = channel.pairingRequested.on((request) => {
      setPendingPairings((prev) => {
        const exists = prev.some((p) => p.code === request.code);
        if (exists) return prev;
        return [request, ...prev];
      });
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = channel.userAuthorized.on((user) => {
      setAuthorizedUsers((prev) => {
        const exists = prev.some((u) => u.id === user.id);
        if (exists) return prev;
        return [user, ...prev];
      });
      setPendingPairings((prev) => prev.filter((p) => p.platformUserId !== user.platformUserId));
    });
    return () => unsubscribe();
  }, []);

  const handleTestConnection = async () => {
    if (!botToken.trim()) {
      Message.warning(t('settings.assistant.tokenRequired', 'Please enter a bot token'));
      return;
    }
    if (!appToken.trim()) {
      Message.warning(t('settings.slack.appTokenRequired', 'Please enter an app-level token'));
      return;
    }

    setTestLoading(true);
    setTokenTested(false);
    setTestedBotUsername(null);
    try {
      const result = await channel.testPlugin.invoke({ pluginId: 'slack_default', token: botToken.trim() });
      if (result.success && result.data?.success) {
        setTokenTested(true);
        setTestedBotUsername(result.data.botUsername || null);
        Message.success(t('settings.assistant.connectionSuccess', `Connected! Bot: @${result.data.botUsername || 'unknown'}`));
        await handleAutoEnable();
      } else {
        setTokenTested(false);
        Message.error(result.data?.error || t('settings.assistant.connectionFailed', 'Connection failed'));
      }
    } catch (error: any) {
      setTokenTested(false);
      Message.error(error.message || t('settings.assistant.connectionFailed', 'Connection failed'));
    } finally {
      setTestLoading(false);
    }
  };

  const handleAutoEnable = async () => {
    try {
      const result = await channel.enablePlugin.invoke({
        pluginId: 'slack_default',
        config: { token: botToken.trim(), appToken: appToken.trim() },
      });
      if (result.success) {
        Message.success(t('settings.slack.pluginEnabled', 'Slack bot enabled'));
        const statusResult = await channel.getPluginStatus.invoke();
        if (statusResult.success && statusResult.data) {
          const slackPlugin = statusResult.data.find((p) => p.type === 'slack');
          onStatusChange(slackPlugin || null);
        }
      }
    } catch (error: any) {
      console.error('[SlackConfig] Auto-enable failed:', error);
    }
  };

  const handleTokenChange = (field: 'bot' | 'app', value: string) => {
    if (field === 'bot') setBotToken(value);
    else setAppToken(value);
    setTokenTested(false);
    setTestedBotUsername(null);
  };

  const handleApprovePairing = async (code: string) => {
    try {
      const result = await channel.approvePairing.invoke({ code });
      if (result.success) {
        Message.success(t('settings.assistant.pairingApproved', 'Pairing approved'));
        await loadPendingPairings();
        await loadAuthorizedUsers();
      } else {
        Message.error(result.msg || t('settings.assistant.approveFailed', 'Failed to approve pairing'));
      }
    } catch (error: any) {
      Message.error(error.message);
    }
  };

  const handleRejectPairing = async (code: string) => {
    try {
      const result = await channel.rejectPairing.invoke({ code });
      if (result.success) {
        Message.info(t('settings.assistant.pairingRejected', 'Pairing rejected'));
        await loadPendingPairings();
      } else {
        Message.error(result.msg || t('settings.assistant.rejectFailed', 'Failed to reject pairing'));
      }
    } catch (error: any) {
      Message.error(error.message);
    }
  };

  const handleRevokeUser = async (userId: string) => {
    try {
      const result = await channel.revokeUser.invoke({ userId });
      if (result.success) {
        Message.success(t('settings.assistant.userRevoked', 'User access revoked'));
        await loadAuthorizedUsers();
      } else {
        Message.error(result.msg || t('settings.assistant.revokeFailed', 'Failed to revoke user'));
      }
    } catch (error: any) {
      Message.error(error.message);
    }
  };

  const copyToClipboard = (text: string) => {
    void navigator.clipboard.writeText(text);
    Message.success(t('common.copied', 'Copied to clipboard'));
  };

  const formatTime = (timestamp: number) => new Date(timestamp).toLocaleString();
  const getRemainingTime = (expiresAt: number) => {
    const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000 / 60));
    return `${remaining} min`;
  };

  const hasUsers = authorizedUsers.length > 0;
  const isGeminiAgent = selectedAgent.backend === 'gemini';
  const agentOptions = availableAgents.length > 0 ? availableAgents : [{ backend: 'gemini' as AcpBackendAll, name: 'Gemini CLI' }];

  return (
    <div className='flex flex-col gap-24px'>
      {/* Bot Token */}
      <PreferenceRow label={t('settings.slack.botToken', 'Bot Token (xoxb-...)')} description={t('settings.slack.botTokenDesc', 'Go to api.slack.com/apps, create an app, then copy the Bot User OAuth Token from OAuth & Permissions.')}>
        <div className='flex items-center gap-8px'>
          <Input.Password value={botToken} onChange={(v) => handleTokenChange('bot', v)} placeholder={hasUsers || pluginStatus?.hasToken ? '••••••••••••••••' : 'xoxb-...'} style={{ width: 240 }} visibilityToggle disabled={hasUsers} />
        </div>
      </PreferenceRow>

      {/* App-Level Token */}
      <PreferenceRow label={t('settings.slack.appToken', 'App-Level Token (xapp-...)')} description={t('settings.slack.appTokenDesc', 'Required for Socket Mode. Generate from Basic Information > App-Level Tokens with connections:write scope.')}>
        <div className='flex items-center gap-8px'>
          <Input.Password value={appToken} onChange={(v) => handleTokenChange('app', v)} placeholder={hasUsers || pluginStatus?.hasToken ? '••••••••••••••••' : 'xapp-...'} style={{ width: 240 }} visibilityToggle disabled={hasUsers} />
          <Button type='outline' loading={testLoading} onClick={handleTestConnection} disabled={hasUsers}>
            {t('settings.assistant.testConnection', 'Test')}
          </Button>
        </div>
      </PreferenceRow>

      {/* Agent Selection */}
      <div className='flex flex-col gap-8px'>
        <PreferenceRow label={t('settings.agent', 'Agent')} description={t('settings.slack.agentDesc', 'Used for Slack conversations')}>
          <Dropdown
            trigger='click'
            position='br'
            droplist={
              <Menu selectedKeys={[selectedAgent.customAgentId ? `${selectedAgent.backend}|${selectedAgent.customAgentId}` : selectedAgent.backend]}>
                {agentOptions.map((a) => {
                  const key = a.customAgentId ? `${a.backend}|${a.customAgentId}` : a.backend;
                  return (
                    <Menu.Item
                      key={key}
                      onClick={() => {
                        const currentKey = selectedAgent.customAgentId ? `${selectedAgent.backend}|${selectedAgent.customAgentId}` : selectedAgent.backend;
                        if (key === currentKey) return;
                        const next = { backend: a.backend, customAgentId: a.customAgentId, name: a.name };
                        setSelectedAgent(next);
                        void persistSelectedAgent(next);
                      }}
                    >
                      {a.name}
                    </Menu.Item>
                  );
                })}
              </Menu>
            }
          >
            <Button type='secondary' className='min-w-160px flex items-center justify-between gap-8px'>
              <span className='truncate'>{selectedAgent.name || availableAgents.find((a) => (a.customAgentId ? `${a.backend}|${a.customAgentId}` : a.backend) === (selectedAgent.customAgentId ? `${selectedAgent.backend}|${selectedAgent.customAgentId}` : selectedAgent.backend))?.name || selectedAgent.backend}</span>
              <Down theme='outline' size={14} />
            </Button>
          </Dropdown>
        </PreferenceRow>
      </div>

      {/* Default Model */}
      <PreferenceRow label={t('settings.assistant.defaultModel', 'Model')} description={t('settings.assistant.defaultModelDesc', 'Model used for agent conversations')}>
        <GeminiModelSelector selection={isGeminiAgent ? modelSelection : undefined} disabled={!isGeminiAgent} label={!isGeminiAgent ? t('settings.assistant.autoFollowCliModel', 'Auto-follow CLI model') : undefined} variant='settings' />
      </PreferenceRow>

      {/* Next Steps Guide */}
      {pluginStatus?.enabled && pluginStatus?.connected && authorizedUsers.length === 0 && (
        <div className='bg-blue-50 dark:bg-blue-900/20 rd-12px p-16px border border-blue-200 dark:border-blue-800'>
          <SectionHeader title={t('settings.assistant.nextSteps', 'Next Steps')} />
          <div className='text-14px text-t-secondary space-y-8px'>
            <p className='m-0'><strong>1.</strong> {t('settings.slack.step1', 'Open Slack and find your bot in the Apps section')}</p>
            <p className='m-0'><strong>2.</strong> {t('settings.slack.step2', 'Send a direct message to the bot to initiate pairing')}</p>
            <p className='m-0'><strong>3.</strong> {t('settings.slack.step3', 'A pairing request will appear below. Click "Approve" to authorize.')}</p>
            <p className='m-0'><strong>4.</strong> {t('settings.slack.step4', 'Once approved, start chatting with the AI through Slack!')}</p>
          </div>
        </div>
      )}

      {/* Pending Pairings */}
      {pluginStatus?.enabled && authorizedUsers.length === 0 && (
        <div className='bg-fill-1 rd-12px pt-16px pr-16px pb-16px pl-0'>
          <SectionHeader title={t('settings.assistant.pendingPairings', 'Pending Pairing Requests')} action={<Button size='mini' type='text' icon={<Refresh size={14} />} loading={pairingLoading} onClick={loadPendingPairings}>{t('common.refresh', 'Refresh')}</Button>} />
          {pairingLoading ? (
            <div className='flex justify-center py-24px'><Spin /></div>
          ) : pendingPairings.length === 0 ? (
            <Empty description={t('settings.assistant.noPendingPairings', 'No pending pairing requests')} />
          ) : (
            <div className='flex flex-col gap-12px'>
              {pendingPairings.map((pairing) => (
                <div key={pairing.code} className='flex items-center justify-between bg-fill-2 rd-8px p-12px'>
                  <div className='flex-1'>
                    <div className='flex items-center gap-8px'>
                      <span className='text-14px font-500 text-t-primary'>{pairing.displayName || 'Unknown User'}</span>
                      <Tooltip content={t('settings.assistant.copyCode', 'Copy pairing code')}>
                        <button className='p-4px bg-transparent border-none text-t-tertiary hover:text-t-primary cursor-pointer' onClick={() => copyToClipboard(pairing.code)}><Copy size={14} /></button>
                      </Tooltip>
                    </div>
                    <div className='text-12px text-t-tertiary mt-4px'>
                      {t('settings.assistant.pairingCode', 'Code')}: <code className='bg-fill-3 px-4px rd-2px'>{pairing.code}</code>
                      <span className='mx-8px'>|</span>
                      {t('settings.assistant.expiresIn', 'Expires in')}: {getRemainingTime(pairing.expiresAt)}
                    </div>
                  </div>
                  <div className='flex items-center gap-8px'>
                    <Button type='primary' size='small' icon={<CheckOne size={14} />} onClick={() => handleApprovePairing(pairing.code)}>{t('settings.assistant.approve', 'Approve')}</Button>
                    <Button type='secondary' size='small' status='danger' icon={<CloseOne size={14} />} onClick={() => handleRejectPairing(pairing.code)}>{t('settings.assistant.reject', 'Reject')}</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Authorized Users */}
      {authorizedUsers.length > 0 && (
        <div className='bg-fill-1 rd-12px pt-16px pr-16px pb-16px pl-0'>
          <SectionHeader title={t('settings.assistant.authorizedUsers', 'Authorized Users')} action={<Button size='mini' type='text' icon={<Refresh size={14} />} loading={usersLoading} onClick={loadAuthorizedUsers}>{t('common.refresh', 'Refresh')}</Button>} />
          {usersLoading ? (
            <div className='flex justify-center py-24px'><Spin /></div>
          ) : (
            <div className='flex flex-col gap-12px'>
              {authorizedUsers.map((user) => (
                <div key={user.id} className='flex items-center justify-between bg-fill-2 rd-8px p-12px'>
                  <div className='flex-1'>
                    <div className='text-14px font-500 text-t-primary'>{user.displayName || 'Unknown User'}</div>
                    <div className='text-12px text-t-tertiary mt-4px'>
                      {t('settings.assistant.platform', 'Platform')}: {user.platformType}
                      <span className='mx-8px'>|</span>
                      {t('settings.assistant.authorizedAt', 'Authorized')}: {formatTime(user.authorizedAt)}
                    </div>
                  </div>
                  <Tooltip content={t('settings.assistant.revokeAccess', 'Revoke access')}>
                    <Button type='text' status='danger' size='small' icon={<Delete size={16} />} onClick={() => handleRevokeUser(user.id)} />
                  </Tooltip>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SlackConfigForm;
```

**Step 2: Commit**

```bash
git add src/renderer/components/SettingsModal/contents/SlackConfigForm.tsx
git commit -m "feat(channels): add SlackConfigForm settings UI component"
```

---

### Task 9: Wire up Slack in ChannelModalContent

**Files:**
- Modify: `src/renderer/components/SettingsModal/contents/ChannelModalContent.tsx`

**Step 1: Import SlackConfigForm and add model selection hook**

Add imports:
```typescript
import SlackConfigForm from './SlackConfigForm';
```

Add state for Slack plugin status:
```typescript
const [slackPluginStatus, setSlackPluginStatus] = useState<IChannelPluginStatus | null>(null);
```

Add model selection for Slack:
```typescript
const slackModelSelection = useChannelModelSelection('assistant.slack.defaultModel' as any);
```

**Step 2: Update `loadPluginStatus` to load Slack**

```typescript
const slackPlugin = result.data.find((p) => p.type === 'slack');
setSlackPluginStatus(slackPlugin || null);
```

**Step 3: Update status change listener for Slack**

```typescript
if (status.type === 'slack') {
  setSlackPluginStatus(status);
}
```

**Step 4: Replace Slack "coming_soon" entry with active config**

Replace the slack entry in `comingSoonChannels` with a proper active channel:

```typescript
const slackChannel: ChannelConfig = {
  id: 'slack',
  title: t('channels.slackTitle', 'Slack'),
  description: t('channels.slackDesc', 'Chat with AionUi assistant via Slack'),
  status: 'active',
  enabled: slackPluginStatus?.enabled || false,
  disabled: slackEnableLoading,
  isConnected: slackPluginStatus?.connected || false,
  botUsername: slackPluginStatus?.botUsername,
  defaultModel: slackModelSelection.currentModel?.useModel,
  content: <SlackConfigForm pluginStatus={slackPluginStatus} modelSelection={slackModelSelection} onStatusChange={setSlackPluginStatus} />,
};
```

Add a `handleToggleSlackPlugin` function similar to `handleTogglePlugin` but for Slack (pluginId: `'slack_default'`).

Update `getToggleHandler`:
```typescript
if (channelId === 'slack') return handleToggleSlackPlugin;
```

**Step 5: Commit**

```bash
git add src/renderer/components/SettingsModal/contents/ChannelModalContent.tsx
git commit -m "feat(channels): wire Slack into channel settings UI"
```

---

### Task 10: Add i18n translations for Slack

**Files:**
- Modify: `src/renderer/i18n/locales/en-US.json`
- Modify: `src/renderer/i18n/locales/ko-KR.json`
- Modify: `src/renderer/i18n/locales/zh-CN.json`
- Modify: `src/renderer/i18n/locales/zh-TW.json`
- Modify: `src/renderer/i18n/locales/ja-JP.json`
- Modify: `src/renderer/i18n/locales/tr-TR.json`

**Step 1: Add Slack keys to en-US.json**

Add after existing Slack title/desc keys:
```json
"settings.slack.botToken": "Bot Token (xoxb-...)",
"settings.slack.botTokenDesc": "Go to api.slack.com/apps, create an app, then copy the Bot User OAuth Token from OAuth & Permissions.",
"settings.slack.appToken": "App-Level Token (xapp-...)",
"settings.slack.appTokenDesc": "Required for Socket Mode. Generate from Basic Information > App-Level Tokens with connections:write scope.",
"settings.slack.appTokenRequired": "Please enter an app-level token",
"settings.slack.pluginEnabled": "Slack bot enabled",
"settings.slack.pluginDisabled": "Slack bot disabled",
"settings.slack.agentDesc": "Used for Slack conversations",
"settings.slack.step1": "Open Slack and find your bot in the Apps section",
"settings.slack.step2": "Send a direct message to the bot to initiate pairing",
"settings.slack.step3": "A pairing request will appear below. Click \"Approve\" to authorize.",
"settings.slack.step4": "Once approved, start chatting with the AI through Slack!"
```

**Step 2: Add translations to other locale files**

- ko-KR.json: Korean translations
- zh-CN.json: Simplified Chinese translations
- zh-TW.json: Traditional Chinese translations
- ja-JP.json: Japanese translations
- tr-TR.json: Turkish translations

**Step 3: Commit**

```bash
git add src/renderer/i18n/locales/*.json
git commit -m "feat(i18n): add Slack channel translations for all locales"
```

---

### Task 11: Update IPC bridge types for Slack support

**Files:**
- Modify: `src/common/ipcBridge.ts` (if syncChannelSettings type needs expanding)
- Modify: `src/process/bridge/channelBridge.ts`

**Step 1: Update `syncChannelSettings` platform type**

In `ipcBridge.ts`, find the `syncChannelSettings` type and change `platform: 'telegram'` to `platform: 'telegram' | 'slack'`.

**Step 2: Update `channelBridge.ts` getPluginStatus to use PluginManager for live status**

The bridge already fetches from database. If PluginManager is available (after init), use it for live status:

In `getPluginStatus` provider, after fetching from DB, enrich with live plugin info:
```typescript
const manager = getChannelManager();
const pm = manager.getPluginManager();
if (pm) {
  // Use PluginManager's built statuses which include live bot info
  return { success: true, data: pm.getPluginStatuses() };
}
```

**Step 3: Commit**

```bash
git add src/common/ipcBridge.ts src/process/bridge/channelBridge.ts
git commit -m "feat(channels): update IPC types for Slack platform support"
```

---

### Task 12: Verify build and lint

**Step 1: Run lint**

Run: `npm run lint`
Expected: No new errors

**Step 2: Run build**

Run: `npm start`
Expected: Application starts without errors. Slack appears in Channel settings as an active (non-coming-soon) channel.

**Step 3: Final commit**

If any fixes are needed, commit them:
```bash
git add -A
git commit -m "fix(channels): address build and lint issues for Slack plugin"
```
