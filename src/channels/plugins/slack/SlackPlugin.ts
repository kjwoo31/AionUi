/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { App, type BlockAction, type SlackEventMiddlewareArgs } from '@slack/bolt';
import { WebClient } from '@slack/web-api';

import type { BotInfo, IChannelPluginConfig, IUnifiedIncomingMessage, IUnifiedOutgoingMessage, PluginType } from '../../types';
import { BasePlugin } from '../BasePlugin';
import { SLACK_MESSAGE_LIMIT, parseSlackChatId, splitMessage, toSlackSendParams, toUnifiedIncomingMessage } from './SlackAdapter';
import { extractAction, extractCategory } from './SlackKeyboards';

/**
 * SlackPlugin - Slack Bot integration via Socket Mode
 *
 * Uses @slack/bolt library for Slack API with Socket Mode.
 * Requires both a Bot Token (xoxb-) and an App-Level Token (xapp-) for Socket Mode.
 */
export class SlackPlugin extends BasePlugin {
  readonly type: PluginType = 'slack';

  private app: App | null = null;
  private botUserId: string | null = null;
  private botUsername: string | null = null;
  private reconnectAttempts: number = 0;
  private readonly maxReconnectAttempts: number = 10;

  // Track active users for status reporting
  private activeUsers: Set<string> = new Set();

  /**
   * Initialize the Slack app instance with Socket Mode
   */
  protected async onInitialize(config: IChannelPluginConfig): Promise<void> {
    const token = config.credentials?.token;
    const appToken = config.credentials?.appToken;

    if (!token) {
      throw new Error('Slack bot token (xoxb-) is required');
    }
    if (!appToken) {
      throw new Error('Slack app-level token (xapp-) is required for Socket Mode');
    }

    // Create Bolt app in Socket Mode
    this.app = new App({
      token,
      appToken,
      socketMode: true,
    });

    // Setup event handlers
    this.setupHandlers();
  }

  /**
   * Start Socket Mode connection
   */
  protected async onStart(): Promise<void> {
    if (!this.app) {
      throw new Error('App not initialized');
    }

    try {
      // Validate token and get bot identity
      const authResult = await this.app.client.auth.test();
      this.botUserId = (authResult.user_id as string) || null;
      this.botUsername = (authResult.user as string) || null;

      // Start Socket Mode connection
      await this.app.start();

      this.reconnectAttempts = 0;
      console.log(`[SlackPlugin] Connected as @${this.botUsername} (${this.botUserId})`);
    } catch (error) {
      console.error('[SlackPlugin] Failed to start:', error);
      throw error;
    }
  }

  /**
   * Stop Socket Mode and cleanup
   */
  protected async onStop(): Promise<void> {
    if (this.app) {
      try {
        await this.app.stop();
      } catch (error) {
        console.error('[SlackPlugin] Error stopping app:', error);
      }
    }

    // Clear all state
    this.app = null;
    this.botUserId = null;
    this.botUsername = null;
    this.activeUsers.clear();
    this.reconnectAttempts = 0;

    console.log('[SlackPlugin] Stopped and cleaned up');
  }

  /**
   * Get active user count
   */
  getActiveUserCount(): number {
    return this.activeUsers.size;
  }

  /**
   * Get bot information
   */
  getBotInfo(): BotInfo | null {
    if (!this.botUserId) return null;
    return {
      id: this.botUserId,
      username: this.botUsername ?? undefined,
      displayName: this.botUsername ?? `Bot ${this.botUserId}`,
    };
  }

  /**
   * Send a message to a Slack channel/DM
   */
  async sendMessage(chatId: string, message: IUnifiedOutgoingMessage): Promise<string> {
    if (!this.app) {
      throw new Error('App not initialized');
    }

    const { text, blocks, mrkdwn } = toSlackSendParams(message);
    const { channel, threadTs } = parseSlackChatId(chatId);

    // Handle long messages by splitting
    const chunks = splitMessage(text, SLACK_MESSAGE_LIMIT);
    let lastMessageId = '';

    for (let i = 0; i < chunks.length; i++) {
      const isLastChunk = i === chunks.length - 1;

      try {
        const result = await this.app.client.chat.postMessage({
          channel,
          text: chunks[i],
          // Only attach blocks to the last chunk
          ...(isLastChunk && blocks ? { blocks } : {}),
          ...(threadTs ? { thread_ts: threadTs } : {}),
          mrkdwn,
        });
        lastMessageId = (result.ts as string) || '';
      } catch (error) {
        console.error(`[SlackPlugin] Failed to send message chunk ${i + 1}/${chunks.length}:`, error);
        throw error;
      }
    }

    return lastMessageId;
  }

  /**
   * Edit an existing Slack message
   */
  async editMessage(chatId: string, messageId: string, message: IUnifiedOutgoingMessage): Promise<void> {
    if (!this.app) {
      throw new Error('App not initialized');
    }

    const { text, blocks, mrkdwn } = toSlackSendParams(message);
    const { channel } = parseSlackChatId(chatId);

    // Truncate if too long (can't split when editing)
    const truncatedText = text.length > SLACK_MESSAGE_LIMIT ? text.slice(0, SLACK_MESSAGE_LIMIT - 3) + '...' : text;

    // Skip edit if text is empty or whitespace-only
    if (!truncatedText.trim()) {
      return;
    }

    try {
      await this.app.client.chat.update({
        channel,
        ts: messageId,
        text: truncatedText,
        ...(blocks ? { blocks } : {}),
        ...(mrkdwn !== undefined ? { mrkdwn } : {}),
      });
    } catch (error: any) {
      // Ignore "message_not_modified" errors (content unchanged)
      if (error?.data?.error === 'message_not_modified') {
        return;
      }
      console.error('[SlackPlugin] Failed to edit message:', error);
      throw error;
    }
  }

  /**
   * Setup Slack event and action handlers
   */
  private setupHandlers(): void {
    if (!this.app) return;

    // Handle all incoming messages
    this.app.message(async (args: SlackEventMiddlewareArgs<'message'>) => {
      await this.handleMessage(args.event);
    });

    // Handle all block actions (button clicks, select menus, etc.)
    this.app.action(/.*/, async ({ action, body, ack }) => {
      // Acknowledge the action immediately to prevent timeout
      await ack();
      await this.handleBlockAction(action as any, body as BlockAction);
    });

    // Global error handler
    this.app.error(async (error) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[SlackPlugin] App error:', errorMessage, error);
      this.setError(errorMessage);
      // Don't re-throw - let the app continue running
    });
  }

  /**
   * Handle an incoming Slack message event
   */
  private async handleMessage(event: SlackEventMiddlewareArgs<'message'>['event']): Promise<void> {
    // Skip bot messages (handled by adapter, but double-check)
    if ('bot_id' in event && event.bot_id) return;

    // Skip own messages
    if ('user' in event && event.user === this.botUserId) return;

    // Track active user
    if ('user' in event && event.user) {
      this.activeUsers.add(event.user);
    }

    // Convert to unified message
    const unifiedMessage = toUnifiedIncomingMessage(event);
    if (unifiedMessage && this.messageHandler) {
      // Don't await - process in background to avoid blocking Socket Mode event loop
      void this.messageHandler(unifiedMessage).catch((error) => {
        const text = ('text' in event && event.text) || '';
        console.error(`[SlackPlugin] Message handler failed for: ${text.slice(0, 20)}...`, error);
      });
    }
  }

  /**
   * Handle a Slack block action (button click, etc.)
   */
  private async handleBlockAction(action: any, body: BlockAction): Promise<void> {
    // Only handle button actions
    if (action.type !== 'button') return;

    const actionId: string = action.action_id || '';
    const userId = body.user?.id;
    if (!userId) return;

    // Track active user
    this.activeUsers.add(userId);

    // Parse action ID using the same category:action convention
    const category = extractCategory(actionId);

    // Determine chatId from body — channel may be in body.channel or body.container
    const channelId = body.channel?.id || (body.container as any)?.channel_id;
    if (!channelId) {
      console.warn('[SlackPlugin] Cannot determine chatId from block action body');
      return;
    }
    // Include thread_ts in chatId for thread-based session isolation
    const threadTs = (body.message as any)?.thread_ts || (body.container as any)?.thread_ts;
    const chatId = threadTs ? `${channelId}:${threadTs}` : channelId;

    // Handle tool confirmation callback: confirm:{callId}:{value}
    if (category === 'confirm') {
      const parts = actionId.split(':');
      if (parts.length >= 3 && this.confirmHandler) {
        const callId = parts[1];
        const value = parts.slice(2).join(':'); // value may contain colons
        // Call confirmHandler directly, not through messageHandler
        void this.confirmHandler(userId, 'slack', callId, value)
          .then(async () => {
            // Remove buttons after confirmation success by clearing blocks
            try {
              const messageTs = body.message?.ts;
              if (messageTs && this.app) {
                await this.app.client.chat.update({
                  channel: channelId,
                  ts: messageTs,
                  text: body.message?.text || 'Confirmed',
                  blocks: [],
                });
              }
            } catch (editError) {
              // Ignore edit errors (message may have been deleted or modified)
              console.debug('[SlackPlugin] Failed to remove buttons (ignored):', editError);
            }
          })
          .catch((error) => console.error('[SlackPlugin] Error handling confirm callback:', error));
      } else {
        console.warn('[SlackPlugin] Invalid confirm callback data or no confirmHandler:', actionId);
      }
      return;
    }

    // Handle agent selection callback: agent:{agentType}
    if (category === 'agent') {
      const agentType = extractAction(actionId); // gemini, acp, codex, etc.
      const unifiedMessage = this.createActionMessage(userId, chatId, actionId);
      if (unifiedMessage && this.messageHandler) {
        unifiedMessage.content.type = 'action';
        unifiedMessage.content.text = 'agent.select';
        unifiedMessage.action = {
          type: 'system',
          name: 'agent.select',
          params: { agentType },
        };
        // Don't await - process in background
        void this.messageHandler(unifiedMessage)
          .then(async () => {
            // Remove inline buttons after selection
            try {
              const messageTs = body.message?.ts;
              if (messageTs && this.app) {
                await this.app.client.chat.update({
                  channel: channelId,
                  ts: messageTs,
                  text: body.message?.text || 'Agent selected',
                  blocks: [],
                });
              }
            } catch (editError) {
              console.debug('[SlackPlugin] Failed to remove agent selection buttons (ignored):', editError);
            }
          })
          .catch((error) => console.error('[SlackPlugin] Error handling agent selection:', error));
      }
      return;
    }

    // Other action types — forward through messageHandler
    const unifiedMessage = this.createActionMessage(userId, chatId, actionId);
    if (unifiedMessage && this.messageHandler) {
      unifiedMessage.content.type = 'action';
      unifiedMessage.content.text = actionId;

      const actionName = extractAction(actionId);
      unifiedMessage.action = {
        type: category === 'pairing' ? 'platform' : category === 'action' || category === 'session' ? 'system' : 'chat',
        name: `${category}.${actionName}`,
        params: { originalMessageId: body.message?.ts },
      };

      // Don't await - process in background
      void this.messageHandler(unifiedMessage).catch((error) => console.error('[SlackPlugin] Error handling block action:', error));
    }
  }

  /**
   * Create a unified action message from block action context
   */
  private createActionMessage(userId: string, chatId: string, actionId: string): IUnifiedIncomingMessage {
    return {
      id: `action_${Date.now()}`,
      platform: 'slack',
      chatId,
      user: {
        id: userId,
        displayName: userId,
      },
      content: {
        type: 'action',
        text: actionId,
      },
      timestamp: Date.now(),
    };
  }

  /**
   * Test connection with the given tokens.
   * Used by Settings UI to validate configuration before saving.
   */
  static async testConnection(token: string, appToken?: string): Promise<{ success: boolean; botInfo?: BotInfo; error?: string }> {
    try {
      const client = new WebClient(token);
      const result = await client.auth.test();

      return {
        success: true,
        botInfo: {
          id: (result.user_id as string) || '',
          username: result.user as string | undefined,
          displayName: (result.user as string) || `Bot ${result.user_id}`,
        },
      };
    } catch (error: any) {
      let errorMessage = 'Connection failed';

      if (error?.data?.error === 'invalid_auth' || error?.data?.error === 'not_authed') {
        errorMessage = 'Invalid bot token';
      } else if (error?.data?.error === 'account_inactive') {
        errorMessage = 'Bot account is inactive';
      } else if (error?.code === 'ENOTFOUND' || error?.code === 'ECONNREFUSED') {
        errorMessage = 'Network error - please check your internet connection';
      } else if (error?.message) {
        errorMessage = error.message;
      }

      return {
        success: false,
        error: errorMessage,
      };
    }
  }
}
