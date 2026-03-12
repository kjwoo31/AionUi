/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { acpDetector } from '@/agent/acp/AcpDetector';
import type { TProviderWithModel } from '@/common/storage';
import { getDatabase } from '@/process/database';
import { ProcessConfig } from '@/process/initStorage';
import { ConversationService } from '@/process/services/conversationService';
import WorkerManage from '@/process/WorkerManage';
import { getChannelMessageService } from '../agent/ChannelMessageService';
import { getChannelManager } from '../core/ChannelManager';
import { createAgentSelectionKeyboard, createHelpKeyboard, createMainMenuKeyboard, createSessionControlKeyboard, createConversationListKeyboard, type AgentDisplayInfo, type ConversationDisplayInfo as TgConversationDisplayInfo } from '../plugins/telegram/TelegramKeyboards';
import { createAgentSelectionBlocks, createHelpBlocks, createMainMenuBlocks, createSessionControlBlocks, type ConversationDisplayInfo as SlackConversationDisplayInfo, createConversationListBlocks } from '../plugins/slack/SlackKeyboards';
import { getChannelConversationName, resolveChannelConvType } from '../types';
import type { ChannelAgentType, PluginType } from '../types';
import type { ActionHandler, IRegisteredAction } from './types';
import { SystemActionNames, createErrorResponse, createSuccessResponse } from './types';
import { GOOGLE_AUTH_PROVIDER_ID } from '@/common/constants';
import type { AcpBackend } from '@/types/acpTypes';

/**
 * Get the default model for Channel assistant (Telegram)
 * Reads from saved config or falls back to default Anthropic Claude model
 */

export async function getChannelDefaultModel(_platform: PluginType): Promise<TProviderWithModel> {
  try {
    // Try to get saved model selection (platform-specific)
    const configKey = _platform === 'slack' ? 'assistant.slack.defaultModel' : 'assistant.telegram.defaultModel';
    const savedModel = await ProcessConfig.get(configKey as any);
    if (savedModel?.id && savedModel?.useModel) {
      // Google Auth provider is a frontend-only virtual provider — it has no
      // entry in model.config. For Google Auth, return a minimal config that
      // lets the Gemini CLI use the selected model via Google authentication.
      if (savedModel.id === GOOGLE_AUTH_PROVIDER_ID) {
        return {
          id: GOOGLE_AUTH_PROVIDER_ID,
          platform: 'gemini-with-google-auth',
          name: 'Gemini Google Auth',
          baseUrl: '',
          apiKey: '',
          useModel: savedModel.useModel,
        } as TProviderWithModel;
      }

      // For regular (API-key-based) providers, look up full config
      const providers = await ProcessConfig.get('model.config');
      if (providers && Array.isArray(providers)) {
        const provider = providers.find((p) => p.id === savedModel.id);
        if (provider && provider.model?.includes(savedModel.useModel)) {
          return {
            ...provider,
            useModel: savedModel.useModel,
          } as TProviderWithModel;
        }
      }
    }

    // Fallback: try to get any configured provider (prefer anthropic with best model)
    const providers = await ProcessConfig.get('model.config');
    if (providers && Array.isArray(providers)) {
      const anthropicProvider = providers.find((p) => p.platform === 'anthropic');
      const fallbackProvider = anthropicProvider || providers.find((p) => p.model?.length > 0);
      if (fallbackProvider && fallbackProvider.model?.length > 0) {
        // Prefer the best available model (opus > sonnet > haiku)
        const preferredModels = ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'];
        const bestModel = preferredModels.find((m) => fallbackProvider.model.includes(m)) || fallbackProvider.model[0];
        return {
          ...fallbackProvider,
          useModel: bestModel,
        } as TProviderWithModel;
      }
    }
  } catch (error) {
    console.warn('[SystemActions] Failed to get saved model, using default:', error);
  }

  // Default fallback - minimal config for Anthropic Claude
  return {
    id: 'anthropic_default',
    platform: 'anthropic',
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    apiKey: '',
    useModel: 'claude-opus-4-6',
  };
}

// ==================== Platform-specific Markup Helpers ====================

function getMainMenuMarkup(platform: string) {
  if (platform === 'slack') return createMainMenuBlocks();
  return createMainMenuKeyboard();
}

function getSessionControlMarkup(platform: string) {
  if (platform === 'slack') return createSessionControlBlocks();
  return createSessionControlKeyboard();
}

function getHelpMarkup(platform: string) {
  if (platform === 'slack') return createHelpBlocks();
  return createHelpKeyboard();
}

function getAgentSelectionMarkup(platform: string, availableAgents: AgentDisplayInfo[], currentAgent?: ChannelAgentType) {
  if (platform === 'slack') return createAgentSelectionBlocks(availableAgents, currentAgent);
  return createAgentSelectionKeyboard(availableAgents, currentAgent);
}

function getConversationListMarkup(platform: string, conversations: Array<{ id: string; name: string; emoji: string; date: string; isCurrent: boolean }>) {
  if (platform === 'slack') return createConversationListBlocks(conversations as SlackConversationDisplayInfo[]);
  return createConversationListKeyboard(conversations as TgConversationDisplayInfo[]);
}

/**
 * SystemActions - Handlers for system-level actions
 *
 * These actions handle session management, help, and settings.
 * They don't require AI processing - just system operations.
 */

/**
 * Handle session.new - Create a new conversation session
 */
export const handleSessionNew: ActionHandler = async (context) => {
  const manager = getChannelManager();
  const sessionManager = manager.getSessionManager();

  if (!sessionManager) {
    return createErrorResponse('Session manager not available');
  }

  if (!context.channelUser) {
    return createErrorResponse('User not authorized');
  }

  // Clear existing session and agent for this user+chat
  const existingSession = sessionManager.getSession(context.channelUser.id, context.chatId);
  if (existingSession) {
    // Clear agent cache in ChannelMessageService
    const messageService = getChannelMessageService();
    await messageService.clearContext(existingSession.id);

    // Kill the worker for the old conversation
    if (existingSession.conversationId) {
      try {
        WorkerManage.kill(existingSession.conversationId);
      } catch (err) {
        console.warn(`[SystemActions] Failed to kill old conversation:`, err);
      }
    }
  }
  sessionManager.clearSession(context.channelUser.id, context.chatId);

  const platform = context.platform;
  const source = platform as import('@/common/storage').ConversationSource;

  // Selected agent (defaults to Gemini)
  let savedAgent: unknown = undefined;
  try {
    savedAgent = await ProcessConfig.get(`assistant.${platform}.agent` as any);
  } catch {
    // ignore
  }
  const backend = (savedAgent && typeof savedAgent === 'object' && typeof (savedAgent as any).backend === 'string' ? (savedAgent as any).backend : 'gemini') as string;
  const customAgentId = savedAgent && typeof savedAgent === 'object' ? ((savedAgent as any).customAgentId as string | undefined) : undefined;
  const agentName = savedAgent && typeof savedAgent === 'object' ? ((savedAgent as any).name as string | undefined) : undefined;

  // Provider model is required by typing; ACP/Codex will ignore it.
  const model = await getChannelDefaultModel(platform);

  // Always create a NEW conversation for "session.new" (scoped by chatId)
  const channelChatId = context.chatId;
  const { convType, convBackend } = resolveChannelConvType(backend);
  const name = getChannelConversationName(platform, convType, convBackend, channelChatId);
  const result =
    backend === 'codex'
      ? await ConversationService.createConversation({
          type: 'codex',
          model,
          source,
          name,
          channelChatId,
          extra: {},
        })
      : backend === 'gemini'
        ? await ConversationService.createGeminiConversation({
            model,
            source,
            name,
            channelChatId,
          })
        : backend === 'openclaw-gateway'
          ? await ConversationService.createConversation({
              type: 'openclaw-gateway',
              model,
              source,
              name,
              channelChatId,
              extra: {},
            })
          : await ConversationService.createConversation({
              type: 'acp',
              model,
              source,
              name,
              channelChatId,
              extra: {
                backend: backend as AcpBackend,
                customAgentId,
                agentName,
              },
            });

  if (!result.success || !result.conversation) {
    return createErrorResponse(`Failed to create session: ${result.error || 'Unknown error'}`);
  }

  // Create session with the new conversation ID (scoped by chatId)
  const agentType = convType as ChannelAgentType;
  const session = sessionManager.createSessionWithConversation(context.channelUser, result.conversation.id, agentType, undefined, channelChatId);

  return createSuccessResponse({
    type: 'text',
    text: `🆕 <b>New Session Created</b>\n\nSession ID: <code>${session.id.slice(-8)}</code>\n\nYou can start a new conversation now!`,
    parseMode: 'HTML',
    replyMarkup: getMainMenuMarkup(platform),
  });
};

/**
 * Handle session.status - Show current session status
 */
export const handleSessionStatus: ActionHandler = async (context) => {
  const manager = getChannelManager();
  const sessionManager = manager.getSessionManager();

  if (!sessionManager) {
    return createErrorResponse('Session manager not available');
  }

  const userId = context.channelUser?.id;
  const session = userId ? sessionManager.getSession(userId, context.chatId) : null;

  if (!session) {
    return createSuccessResponse({
      type: 'text',
      text: '📊 <b>Session Status</b>\n\nNo active session.\n\nSend a message to start a new conversation, or tap the "New Chat" button.',
      parseMode: 'HTML',
      replyMarkup: getSessionControlMarkup(context.platform),
    });
  }

  const duration = Math.floor((Date.now() - session.createdAt) / 1000 / 60);
  const lastActivity = Math.floor((Date.now() - session.lastActivity) / 1000);

  return createSuccessResponse({
    type: 'text',
    text: ['📊 <b>Session Status</b>', '', `🤖 Agent: <code>${session.agentType}</code>`, `⏱ Duration: ${duration} min`, `📝 Last activity: ${lastActivity} sec ago`, `🔖 Session ID: <code>${session.id.slice(-8)}</code>`].join('\n'),
    parseMode: 'HTML',
    replyMarkup: getSessionControlMarkup(context.platform),
  });
};

/**
 * Handle session.list - Show list of existing conversations to join
 */
export const handleSessionList: ActionHandler = async (context) => {
  const db = getDatabase();
  const platform = context.platform;

  // Get recent conversations (all sources)
  const result = db.getUserConversations(undefined, 0, 10);
  const conversations = result.data || [];

  if (conversations.length === 0) {
    return createSuccessResponse({
      type: 'text',
      text: '📂 <b>No conversations found.</b>\n\nSend a message to start a new conversation.',
      parseMode: 'HTML',
      replyMarkup: getMainMenuMarkup(platform),
    });
  }

  // Get current session to mark current conversation
  const manager = getChannelManager();
  const sessionManager = manager.getSessionManager();
  const userId = context.channelUser?.id;
  const currentSession = userId && sessionManager ? sessionManager.getSession(userId, context.chatId) : null;
  const currentConvId = currentSession?.conversationId;

  // Map to display format
  const agentEmojis: Record<string, string> = {
    gemini: '🤖',
    acp: '🧠',
    codex: '⚡',
    'openclaw-gateway': '🦞',
    nanobot: '🔬',
  };

  const displayList = conversations.map((conv) => {
    const updated = new Date(conv.modifyTime);
    const dateStr = `${updated.getMonth() + 1}/${updated.getDate()}`;
    const emoji = agentEmojis[conv.type] || '💬';
    // Truncate name for button display
    const name = (conv.name || 'Untitled').slice(0, 30);

    return {
      id: conv.id,
      name: `${name} (${dateStr})`,
      emoji,
      date: dateStr,
      isCurrent: conv.id === currentConvId,
    };
  });

  return createSuccessResponse({
    type: 'text',
    text: ['📂 <b>Join Conversation</b>', '', 'Select a conversation to continue:'].join('\n'),
    parseMode: 'HTML',
    replyMarkup: getConversationListMarkup(platform, displayList),
  });
};

/**
 * Handle session.join - Join an existing conversation
 */
export const handleSessionJoin: ActionHandler = async (context, params) => {
  const manager = getChannelManager();
  const sessionManager = manager.getSessionManager();
  const platform = context.platform;

  if (!sessionManager) {
    return createErrorResponse('Session manager not available');
  }

  if (!context.channelUser) {
    return createErrorResponse('User not authorized');
  }

  const conversationId = params?.conversationId;
  if (!conversationId) {
    return createErrorResponse('No conversation selected');
  }

  // Verify conversation exists
  const db = getDatabase();
  const convResult = db.getConversation(conversationId);
  if (!convResult.success || !convResult.data) {
    return createErrorResponse('Conversation not found');
  }

  const conv = convResult.data;

  // Clear existing session and agent for this user+chat
  const existingSession = sessionManager.getSession(context.channelUser.id, context.chatId);
  if (existingSession) {
    const messageService = getChannelMessageService();
    await messageService.clearContext(existingSession.id);

    if (existingSession.conversationId) {
      try {
        WorkerManage.kill(existingSession.conversationId);
      } catch (err) {
        console.warn(`[SystemActions] Failed to kill old conversation:`, err);
      }
    }
  }
  sessionManager.clearSession(context.channelUser.id, context.chatId);

  // Create session pointing to the selected conversation
  const { convType } = resolveChannelConvType(conv.type);
  const agentType = convType as ChannelAgentType;
  sessionManager.createSessionWithConversation(context.channelUser, conversationId, agentType, undefined, context.chatId);

  const agentNames: Record<string, string> = {
    gemini: '🤖 Gemini',
    acp: '🧠 Claude',
    codex: '⚡ Codex',
    'openclaw-gateway': '🦞 OpenClaw',
  };
  const agentName = agentNames[conv.type] || conv.type;
  const convName = conv.name || 'Untitled';

  return createSuccessResponse({
    type: 'text',
    text: [`📂 <b>Joined Conversation</b>`, '', `<b>${convName}</b>`, `Agent: ${agentName}`, '', 'Send a message to continue the conversation.'].join('\n'),
    parseMode: 'HTML',
    replyMarkup: getMainMenuMarkup(platform),
  });
};

/**
 * Handle help.show - Show help menu
 */
export const handleHelpShow: ActionHandler = async (context) => {
  return createSuccessResponse({
    type: 'text',
    text: ['❓ <b>AionUi Assistant</b>', '', 'A remote assistant to interact with AionUi via Telegram.', '', '<b>Common Actions:</b>', '• 🆕 New Chat - Start a new session', '• 📊 Status - View current session status', '• ❓ Help - Show this help message', '', 'Send a message to chat with the AI assistant.'].join('\n'),
    parseMode: 'HTML',
    replyMarkup: getHelpMarkup(context.platform),
  });
};

/**
 * Handle help.features - Show feature introduction
 */
export const handleHelpFeatures: ActionHandler = async (context) => {
  return createSuccessResponse({
    type: 'text',
    text: ['🤖 <b>Features</b>', '', '<b>AI Chat</b>', '• Natural language conversation', '• Streaming output, real-time display', '• Context memory support', '', '<b>Session Management</b>', '• Single session mode', '• Clear context anytime', '• View session status', '', '<b>Message Actions</b>', '• Copy reply content', '• Regenerate reply', '• Continue conversation'].join('\n'),
    parseMode: 'HTML',
    replyMarkup: getHelpMarkup(context.platform),
  });
};

/**
 * Handle help.pairing - Show pairing guide
 */
export const handleHelpPairing: ActionHandler = async (context) => {
  return createSuccessResponse({
    type: 'text',
    text: ['🔗 <b>Pairing Guide</b>', '', '<b>First-time Setup:</b>', '1. Send any message to the bot', '2. Bot displays pairing code', '3. Approve pairing in AionUi settings', '4. Ready to use after pairing', '', '<b>Notes:</b>', '• Pairing code valid for 10 minutes', '• AionUi app must be running', '• One Telegram account can only pair once'].join('\n'),
    parseMode: 'HTML',
    replyMarkup: getHelpMarkup(context.platform),
  });
};

/**
 * Handle help.tips - Show usage tips
 */
export const handleHelpTips: ActionHandler = async (context) => {
  return createSuccessResponse({
    type: 'text',
    text: ['💬 <b>Tips</b>', '', '<b>Effective Conversations:</b>', '• Be clear and specific', '• Feel free to ask follow-ups', '• Regenerate if not satisfied', '', '<b>Quick Actions:</b>', '• Use bottom buttons for quick access', '• Tap message buttons for actions', '• New chat clears history context'].join('\n'),
    parseMode: 'HTML',
    replyMarkup: getHelpMarkup(context.platform),
  });
};

/**
 * Handle settings.show - Show settings info
 */
export const handleSettingsShow: ActionHandler = async (context) => {
  return createSuccessResponse({
    type: 'text',
    text: ['⚙️ <b>Settings</b>', '', 'Channel settings need to be configured in the AionUi app.', '', 'Open AionUi → WebUI → Channels'].join('\n'),
    parseMode: 'HTML',
    replyMarkup: getMainMenuMarkup(context.platform),
  });
};

/**
 * Handle agent.show - Show agent selection keyboard/card
 */
export const handleAgentShow: ActionHandler = async (context) => {
  const manager = getChannelManager();
  const sessionManager = manager.getSessionManager();

  if (!sessionManager) {
    return createErrorResponse('Session manager not available');
  }

  // Get current agent type from session (scoped by chatId)
  const userId = context.channelUser?.id;
  const session = userId ? sessionManager.getSession(userId, context.chatId) : null;
  const currentAgent = session?.agentType || 'gemini';

  // Get available agents dynamically
  const availableAgents = getAvailableChannelAgents();

  if (availableAgents.length === 0) {
    return createErrorResponse('No agents available');
  }

  return createSuccessResponse({
    type: 'text',
    text: ['🔄 <b>Switch Agent</b>', '', 'Select an AI agent for your conversations:', '', `Current: <b>${getAgentDisplayName(currentAgent)}</b>`].join('\n'),
    parseMode: 'HTML',
    replyMarkup: getAgentSelectionMarkup(context.platform, availableAgents, currentAgent),
  });
};

/**
 * Handle agent.select - Switch to a different agent
 */
export const handleAgentSelect: ActionHandler = async (context, params) => {
  const manager = getChannelManager();
  const sessionManager = manager.getSessionManager();

  if (!sessionManager) {
    return createErrorResponse('Session manager not available');
  }

  if (!context.channelUser) {
    return createErrorResponse('User not authorized');
  }

  const newAgentType = params?.agentType as ChannelAgentType;

  // Validate agent type is available
  const availableAgents = getAvailableChannelAgents();
  const isValidAgent = availableAgents.some((agent) => agent.type === newAgentType);
  if (!newAgentType || !isValidAgent) {
    return createErrorResponse('Invalid or unavailable agent type');
  }

  // Get current session (scoped by chatId)
  const existingSession = sessionManager.getSession(context.channelUser.id, context.chatId);

  // If same agent, no need to switch
  if (existingSession?.agentType === newAgentType) {
    return createSuccessResponse({
      type: 'text',
      text: `✓ Already using <b>${getAgentDisplayName(newAgentType)}</b>`,
      parseMode: 'HTML',
      replyMarkup: getMainMenuMarkup(context.platform),
    });
  }

  // Clear existing session and agent (scoped by chatId)
  if (existingSession) {
    const messageService = getChannelMessageService();
    await messageService.clearContext(existingSession.id);

    if (existingSession.conversationId) {
      try {
        WorkerManage.kill(existingSession.conversationId);
      } catch (err) {
        console.warn(`[SystemActions] Failed to kill old conversation:`, err);
      }
    }
  }
  sessionManager.clearSession(context.channelUser.id, context.chatId);

  // Create new session with the selected agent type (scoped by chatId)
  const session = sessionManager.createSession(context.channelUser, newAgentType, undefined, context.chatId);

  return createSuccessResponse({
    type: 'text',
    text: [`✓ <b>Switched to ${getAgentDisplayName(newAgentType)}</b>`, '', 'A new conversation has been started.', '', 'Send a message to begin!'].join('\n'),
    parseMode: 'HTML',
    replyMarkup: getMainMenuMarkup(context.platform),
  });
};

/**
 * Get display name for agent type
 */
function getAgentDisplayName(agentType: ChannelAgentType): string {
  const names: Record<ChannelAgentType, string> = {
    gemini: '🤖 Gemini',
    acp: '🧠 Claude',
    codex: '⚡ Codex',
    'openclaw-gateway': '🦞 OpenClaw',
  };
  return names[agentType] || agentType;
}

/**
 * Map backend type to ChannelAgentType
 * Only returns types that are supported by channels
 */
function backendToChannelAgentType(backend: string): ChannelAgentType | null {
  const mapping: Record<string, ChannelAgentType> = {
    gemini: 'gemini',
    claude: 'acp',
    codex: 'codex',
    'openclaw-gateway': 'openclaw-gateway',
  };
  return mapping[backend] || null;
}

/**
 * Get emoji for agent backend
 */
function getAgentEmoji(backend: string): string {
  const emojis: Record<string, string> = {
    gemini: '🤖',
    claude: '🧠',
    codex: '⚡',
    'openclaw-gateway': '🦞',
  };
  return emojis[backend] || '🤖';
}

/**
 * Get available agents for channel selection
 * Filters detected agents to only those supported by channels
 */
function getAvailableChannelAgents(): AgentDisplayInfo[] {
  const detectedAgents = acpDetector.getDetectedAgents();
  const availableAgents: AgentDisplayInfo[] = [];
  const seenTypes = new Set<ChannelAgentType>();

  // Always include Gemini as it's built-in
  availableAgents.push({ type: 'gemini', emoji: '🤖', name: 'Gemini' });
  seenTypes.add('gemini');

  // Add detected ACP agents (claude, codex, etc.)
  for (const agent of detectedAgents) {
    const channelType = backendToChannelAgentType(agent.backend);
    if (channelType && !seenTypes.has(channelType)) {
      availableAgents.push({
        type: channelType,
        emoji: getAgentEmoji(agent.backend),
        name: agent.name,
      });
      seenTypes.add(channelType);
    }
  }

  return availableAgents;
}

/**
 * All system actions
 */
export const systemActions: IRegisteredAction[] = [
  {
    name: SystemActionNames.SESSION_NEW,
    category: 'system',
    description: 'Create a new conversation session',
    handler: handleSessionNew,
  },
  {
    name: SystemActionNames.SESSION_STATUS,
    category: 'system',
    description: 'Show current session status',
    handler: handleSessionStatus,
  },
  {
    name: SystemActionNames.SESSION_LIST,
    category: 'system',
    description: 'List conversations to join',
    handler: handleSessionList,
  },
  {
    name: SystemActionNames.SESSION_JOIN,
    category: 'system',
    description: 'Join an existing conversation',
    handler: handleSessionJoin,
  },
  {
    name: SystemActionNames.HELP_SHOW,
    category: 'system',
    description: 'Show help menu',
    handler: handleHelpShow,
  },
  {
    name: SystemActionNames.HELP_FEATURES,
    category: 'system',
    description: 'Show feature introduction',
    handler: handleHelpFeatures,
  },
  {
    name: SystemActionNames.HELP_PAIRING,
    category: 'system',
    description: 'Show pairing guide',
    handler: handleHelpPairing,
  },
  {
    name: SystemActionNames.HELP_TIPS,
    category: 'system',
    description: 'Show usage tips',
    handler: handleHelpTips,
  },
  {
    name: SystemActionNames.SETTINGS_SHOW,
    category: 'system',
    description: 'Show settings info',
    handler: handleSettingsShow,
  },
  {
    name: SystemActionNames.AGENT_SHOW,
    category: 'system',
    description: 'Show agent selection',
    handler: handleAgentShow,
  },
  {
    name: SystemActionNames.AGENT_SELECT,
    category: 'system',
    description: 'Switch to a different agent',
    handler: handleAgentSelect,
  },
];
