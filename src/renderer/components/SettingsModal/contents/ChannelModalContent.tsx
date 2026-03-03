/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IChannelPluginStatus } from '@/channels/types';
import type { IProvider, TProviderWithModel } from '@/common/storage';
import { channel } from '@/common/ipcBridge';
import { ConfigStorage } from '@/common/storage';
import AionScrollArea from '@/renderer/components/base/AionScrollArea';
import { useModelProviderList } from '@/renderer/hooks/useModelProviderList';
import type { GeminiModelSelection } from '@/renderer/pages/conversation/gemini/useGeminiModelSelection';
import { useGeminiModelSelection } from '@/renderer/pages/conversation/gemini/useGeminiModelSelection';
import { Message } from '@arco-design/web-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsViewMode } from '../settingsViewContext';
import ChannelItem from './channels/ChannelItem';
import type { ChannelConfig } from './channels/types';
import SlackConfigForm from './SlackConfigForm';
import TelegramConfigForm from './TelegramConfigForm';

type ChannelModelConfigKey = 'assistant.telegram.defaultModel' | 'assistant.slack.defaultModel';

/**
 * Internal hook: wraps useGeminiModelSelection with ConfigStorage persistence
 * for a specific channel config key (e.g. 'assistant.telegram.defaultModel').
 *
 * Restoration is done by resolving the saved model reference into a full
 * TProviderWithModel and passing it as `initialModel` — this avoids triggering
 * the onSelectModel callback (and its toast) on mount.
 */
const useChannelModelSelection = (configKey: ChannelModelConfigKey): GeminiModelSelection => {
  const { t } = useTranslation();

  // Resolve persisted model into a full TProviderWithModel for initialModel.
  // useModelProviderList is SWR-backed so the duplicate call inside
  // useGeminiModelSelection is deduplicated automatically.
  const { providers } = useModelProviderList();
  const [resolvedInitialModel, setResolvedInitialModel] = useState<TProviderWithModel | undefined>(undefined);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    if (restored || providers.length === 0) return;

    const restore = async () => {
      try {
        const saved = (await ConfigStorage.get(configKey)) as { id: string; useModel: string } | undefined;
        if (saved?.id && saved?.useModel) {
          const provider = providers.find((p) => p.id === saved.id);
          if (provider) {
            // Google Auth provider's model array only contains top-level modes
            // ('auto', 'auto-gemini-2.5', 'manual'), but sub-model values like
            // 'gemini-2.5-flash' are also valid — skip strict membership check.
            const isGoogleAuth = provider.platform?.toLowerCase().includes('gemini-with-google-auth');
            if (isGoogleAuth || provider.model?.includes(saved.useModel)) {
              setResolvedInitialModel({
                ...provider,
                useModel: saved.useModel,
              } as TProviderWithModel);
            }
          }
        }
      } catch (error) {
        console.error(`[ChannelSettings] Failed to restore model for ${configKey}:`, error);
      } finally {
        setRestored(true);
      }
    };

    void restore();
  }, [configKey, providers, restored]);

  // Only called on explicit user selection — not during restoration
  const onSelectModel = useCallback(
    async (provider: IProvider, modelName: string) => {
      try {
        const modelRef = { id: provider.id, useModel: modelName };
        await ConfigStorage.set(configKey, modelRef);

        // Derive platform from configKey and sync to channel system
        const platform = configKey.replace('assistant.', '').replace('.defaultModel', '') as 'telegram' | 'slack';
        const agentKey = `assistant.${platform}.agent` as const;
        const currentAgent = await ConfigStorage.get(agentKey);
        await channel.syncChannelSettings
          .invoke({
            platform,
            agent: (currentAgent as { backend: string; customAgentId?: string; name?: string }) || { backend: 'gemini' },
            model: modelRef,
          })
          .catch(() => {});

        Message.success(t('settings.assistant.modelSwitched', 'Model switched successfully'));
        return true;
      } catch (error) {
        console.error(`[ChannelSettings] Failed to save model for ${configKey}:`, error);
        Message.error(t('settings.assistant.modelSaveFailed', 'Failed to save model'));
        return false;
      }
    },
    [configKey, t]
  );

  return useGeminiModelSelection({ initialModel: resolvedInitialModel, onSelectModel });
};

/**
 * Assistant Settings Content Component
 */
const ChannelModalContent: React.FC = () => {
  const { t } = useTranslation();
  const viewMode = useSettingsViewMode();
  const isPageMode = viewMode === 'page';

  // Plugin state - Telegram
  const [pluginStatus, setPluginStatus] = useState<IChannelPluginStatus | null>(null);
  const [enableLoading, setEnableLoading] = useState(false);

  // Plugin state - Slack
  const [slackPluginStatus, setSlackPluginStatus] = useState<IChannelPluginStatus | null>(null);
  const [slackEnableLoading, setSlackEnableLoading] = useState(false);

  // Collapse state - true means collapsed (closed), false means expanded (open)
  const [collapseKeys, setCollapseKeys] = useState<Record<string, boolean>>({
    telegram: true, // Default to collapsed
    slack: true,
    discord: true,
  });

  // Model selection state — uses unified hook with ConfigStorage persistence
  const telegramModelSelection = useChannelModelSelection('assistant.telegram.defaultModel');
  const slackModelSelection = useChannelModelSelection('assistant.slack.defaultModel');

  // Load plugin status
  const loadPluginStatus = useCallback(async () => {
    try {
      const result = await channel.getPluginStatus.invoke();
      if (result.success && result.data) {
        const telegramPlugin = result.data.find((p) => p.type === 'telegram');
        setPluginStatus(telegramPlugin || null);
        const slackPlugin = result.data.find((p) => p.type === 'slack');
        setSlackPluginStatus(slackPlugin || null);
      }
    } catch (error) {
      console.error('[ChannelSettings] Failed to load plugin status:', error);
    }
  }, []);

  // Initial load
  useEffect(() => {
    void loadPluginStatus();
  }, [loadPluginStatus]);

  // Listen for plugin status changes
  useEffect(() => {
    const unsubscribe = channel.pluginStatusChanged.on(({ status }) => {
      if (status.type === 'telegram') {
        setPluginStatus(status);
      } else if (status.type === 'slack') {
        setSlackPluginStatus(status);
      }
    });
    return () => unsubscribe();
  }, []);

  // Toggle collapse
  const handleToggleCollapse = (channelId: string) => {
    setCollapseKeys((prev) => ({
      ...prev,
      [channelId]: !prev[channelId],
    }));
  };

  // Enable/Disable plugin
  const handleTogglePlugin = async (enabled: boolean) => {
    setEnableLoading(true);
    try {
      if (enabled) {
        // Check if we have a token - already saved in database
        if (!pluginStatus?.hasToken) {
          Message.warning(t('settings.assistant.tokenRequired', 'Please enter a bot token first'));
          setEnableLoading(false);
          return;
        }

        const result = await channel.enablePlugin.invoke({
          pluginId: 'telegram_default',
          config: {},
        });

        if (result.success) {
          Message.success(t('settings.assistant.pluginEnabled', 'Telegram bot enabled'));
          await loadPluginStatus();
        } else {
          Message.error(result.msg || t('settings.assistant.enableFailed', 'Failed to enable plugin'));
        }
      } else {
        const result = await channel.disablePlugin.invoke({ pluginId: 'telegram_default' });

        if (result.success) {
          Message.success(t('settings.assistant.pluginDisabled', 'Telegram bot disabled'));
          await loadPluginStatus();
        } else {
          Message.error(result.msg || t('settings.assistant.disableFailed', 'Failed to disable plugin'));
        }
      }
    } catch (error: any) {
      Message.error(error.message);
    } finally {
      setEnableLoading(false);
    }
  };

  // Enable/Disable Slack plugin
  const handleToggleSlackPlugin = async (enabled: boolean) => {
    setSlackEnableLoading(true);
    try {
      if (enabled) {
        if (!slackPluginStatus?.hasToken) {
          Message.warning(t('settings.assistant.tokenRequired', 'Please enter a bot token first'));
          setSlackEnableLoading(false);
          return;
        }
        const result = await channel.enablePlugin.invoke({ pluginId: 'slack_default', config: {} });
        if (result.success) {
          Message.success(t('settings.slack.pluginEnabled', 'Slack bot enabled'));
          await loadPluginStatus();
        } else {
          Message.error(result.msg || t('settings.assistant.enableFailed', 'Failed to enable plugin'));
        }
      } else {
        const result = await channel.disablePlugin.invoke({ pluginId: 'slack_default' });
        if (result.success) {
          Message.success(t('settings.slack.pluginDisabled', 'Slack bot disabled'));
          await loadPluginStatus();
        } else {
          Message.error(result.msg || t('settings.assistant.disableFailed', 'Failed to disable plugin'));
        }
      }
    } catch (error: any) {
      Message.error(error.message);
    } finally {
      setSlackEnableLoading(false);
    }
  };

  // Build channel configurations
  const channels: ChannelConfig[] = useMemo(() => {
    const telegramChannel: ChannelConfig = {
      id: 'telegram',
      title: t('channels.telegramTitle', 'Telegram'),
      description: t('channels.telegramDesc', 'Chat with AionUi assistant via Telegram'),
      status: 'active',
      enabled: pluginStatus?.enabled || false,
      disabled: enableLoading,
      isConnected: pluginStatus?.connected || false,
      botUsername: pluginStatus?.botUsername,
      defaultModel: telegramModelSelection.currentModel?.useModel,
      content: <TelegramConfigForm pluginStatus={pluginStatus} modelSelection={telegramModelSelection} onStatusChange={setPluginStatus} />,
    };

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

    const comingSoonChannels: ChannelConfig[] = [
      {
        id: 'discord',
        title: t('channels.discordTitle', 'Discord'),
        description: t('channels.discordDesc', 'Chat with AionUi assistant via Discord'),
        status: 'coming_soon',
        enabled: false,
        disabled: true,
        content: <div className='text-14px text-t-secondary py-12px'>{t('channels.comingSoonDesc', 'Support for {{channel}} is coming soon', { channel: t('channels.discordTitle', 'Discord') })}</div>,
      },
    ];

    return [telegramChannel, slackChannel, ...comingSoonChannels];
  }, [pluginStatus, slackPluginStatus, telegramModelSelection, slackModelSelection, enableLoading, slackEnableLoading, t]);

  // Get toggle handler for each channel
  const getToggleHandler = (channelId: string) => {
    if (channelId === 'telegram') return handleTogglePlugin;
    if (channelId === 'slack') return handleToggleSlackPlugin;
    return undefined;
  };

  return (
    <AionScrollArea className={isPageMode ? 'h-full' : ''}>
      <div className='flex flex-col gap-12px'>
        {channels.map((channelConfig) => (
          <ChannelItem key={channelConfig.id} channel={channelConfig} isCollapsed={collapseKeys[channelConfig.id] || false} onToggleCollapse={() => handleToggleCollapse(channelConfig.id)} onToggleEnabled={getToggleHandler(channelConfig.id)} />
        ))}
      </div>
    </AionScrollArea>
  );
};

export default ChannelModalContent;
