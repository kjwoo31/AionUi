/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { KnownEventFromType } from '@slack/bolt';
import type { IUnifiedIncomingMessage, IUnifiedMessageContent, IUnifiedOutgoingMessage, IUnifiedUser } from '../../types';

/**
 * SlackAdapter - Converts between Slack and Unified message formats
 *
 * Handles:
 * - Slack Message Event → UnifiedIncomingMessage
 * - UnifiedOutgoingMessage → Slack chat.postMessage parameters
 * - User info extraction
 * - File attachment handling
 * - Slack mrkdwn formatting
 */

type SlackMessageEvent = KnownEventFromType<'message'>;

// ==================== Constants ====================

/**
 * Slack message length limit (text field max)
 */
export const SLACK_MESSAGE_LIMIT = 40000;

// ==================== Incoming Message Conversion ====================

/**
 * Convert a Slack message event to unified incoming message.
 * Returns null for bot messages, subtyped messages, or invalid events.
 */
export function toUnifiedIncomingMessage(event: SlackMessageEvent): IUnifiedIncomingMessage | null {
  // Skip bot messages
  if ('bot_id' in event && event.bot_id) return null;

  // Skip subtyped messages (channel_join, message_changed, etc.)
  // Only process plain user messages (subtype === undefined)
  if ('subtype' in event && event.subtype !== undefined) return null;

  // Must have a user field for a valid user message
  if (!('user' in event) || !event.user) return null;

  const user = toUnifiedUser(event);
  if (!user) return null;

  const content = extractMessageContent(event);

  return {
    id: event.ts,
    platform: 'slack',
    chatId: 'thread_ts' in event && event.thread_ts ? `${event.channel}:${event.thread_ts}` : event.channel,
    user,
    content,
    timestamp: parseFloat(event.ts) * 1000, // Slack ts is Unix seconds with decimal
    replyToMessageId: 'thread_ts' in event ? event.thread_ts : undefined,
    raw: event,
  };
}

// ==================== User Conversion ====================

/**
 * Extract user info from a Slack message event to unified user format.
 * Sets displayName to userId — will be resolved later by PairingService.
 */
export function toUnifiedUser(event: SlackMessageEvent): IUnifiedUser | null {
  if (!('user' in event) || !event.user) return null;

  const userId = event.user;

  return {
    id: userId,
    displayName: userId,
    avatarUrl: undefined,
  };
}

// ==================== Content Extraction (Private) ====================

/**
 * Extract message content from a Slack message event.
 * Handles text messages and file attachments.
 */
function extractMessageContent(event: SlackMessageEvent): IUnifiedMessageContent {
  // Handle file attachments
  if ('files' in event && event.files && event.files.length > 0) {
    const files = event.files;
    return {
      type: 'document',
      text: ('text' in event && event.text) || '',
      attachments: files.map((file) => ({
        type: 'document' as const,
        fileId: file.id,
        fileName: file.name ?? undefined,
        mimeType: file.mimetype,
        size: file.size,
      })),
    };
  }

  // Default: text message
  return {
    type: 'text',
    text: ('text' in event && event.text) || '',
  };
}

// ==================== Outgoing Message Conversion ====================

/**
 * Slack chat.postMessage parameters shape
 */
export interface SlackSendParams {
  text: string;
  blocks?: unknown[];
  mrkdwn?: boolean;
}

/**
 * Convert unified outgoing message to Slack chat.postMessage parameters.
 * If replyMarkup is set, wraps text in a section block and appends replyMarkup as action blocks.
 */
export function toSlackSendParams(message: IUnifiedOutgoingMessage): SlackSendParams {
  const text = message.text || '';

  // When replyMarkup is present, use Block Kit layout
  if (message.replyMarkup) {
    const blocks: unknown[] = [];

    // Wrap text in a section block
    if (text) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text,
        },
      });
    }

    // Append replyMarkup as action blocks
    // replyMarkup is expected to be an array of Slack block elements
    if (Array.isArray(message.replyMarkup)) {
      blocks.push(...(message.replyMarkup as unknown[]));
    } else {
      blocks.push(message.replyMarkup);
    }

    return { text, blocks, mrkdwn: true };
  }

  return { text, mrkdwn: true };
}

// ==================== Text Formatting ====================

/**
 * Escape special characters for Slack mrkdwn format.
 * Slack requires &, <, > to be escaped.
 */
export function escapeSlackMrkdwn(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Convert HTML tags to Slack mrkdwn format.
 *
 * Supported conversions:
 * - <b>/<strong> → *bold*
 * - <i>/<em>     → _italic_
 * - <code>       → `code`
 * - <pre><code>  → ```code```
 * - <a href>     → <url|text>
 * - HTML entities are unescaped at the end
 */
export function htmlToSlackMrkdwn(html: string): string {
  let result = html;

  // Pre/code blocks first (before inline code) — <pre><code>...</code></pre>
  result = result.replace(/<pre><code(?:\s[^>]*)?>([^]*?)<\/code><\/pre>/gi, '```$1```');

  // Inline code — <code>...</code>
  result = result.replace(/<code>([^]*?)<\/code>/gi, '`$1`');

  // Bold — <b> or <strong>
  result = result.replace(/<(?:b|strong)>([^]*?)<\/(?:b|strong)>/gi, '*$1*');

  // Italic — <i> or <em>
  result = result.replace(/<(?:i|em)>([^]*?)<\/(?:i|em)>/gi, '_$1_');

  // Links — <a href="url">text</a> → <url|text>
  result = result.replace(/<a\s+href="([^"]*)"[^>]*>([^]*?)<\/a>/gi, '<$1|$2>');

  // Strip any remaining HTML tags
  result = result.replace(/<[^>]+>/g, '');

  // Unescape HTML entities
  result = unescapeHtmlEntities(result);

  return result;
}

/**
 * Unescape common HTML entities
 */
function unescapeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

// ==================== Chat ID Utilities ====================

/**
 * Parse a Slack composite chatId into channel and optional thread_ts.
 * Format: "C12345678" (main) or "C12345678:1234567890.123456" (thread)
 */
export function parseSlackChatId(chatId: string): { channel: string; threadTs?: string } {
  const idx = chatId.indexOf(':');
  if (idx === -1) return { channel: chatId };
  return { channel: chatId.slice(0, idx), threadTs: chatId.slice(idx + 1) };
}

// ==================== Message Length Utilities ====================

/**
 * Split long text into chunks that fit within the given limit.
 * Prefers splitting at newlines, then spaces, within the last 20% of each chunk.
 * Same algorithm as TelegramAdapter's splitMessage.
 */
export function splitMessage(text: string, maxLength: number = SLACK_MESSAGE_LIMIT): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Find a good split point (prefer newline, then space)
    let splitIndex = maxLength;

    // Look for newline within the last 20% of the chunk
    const newlineSearchStart = Math.floor(maxLength * 0.8);
    const lastNewline = remaining.lastIndexOf('\n', maxLength);
    if (lastNewline > newlineSearchStart) {
      splitIndex = lastNewline + 1;
    } else {
      // Look for space
      const lastSpace = remaining.lastIndexOf(' ', maxLength);
      if (lastSpace > newlineSearchStart) {
        splitIndex = lastSpace + 1;
      }
    }

    chunks.push(remaining.slice(0, splitIndex).trim());
    remaining = remaining.slice(splitIndex).trim();
  }

  return chunks;
}
