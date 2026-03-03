/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Global agent progress store for cross-conversation monitoring.
 * Uses useSyncExternalStore per-conversation to avoid O(N) re-renders.
 * Each ConversationRow subscribes individually and only re-renders when its own progress changes.
 */
import { ipcBridge } from '@/common';
import type { IResponseMessage } from '@/common/ipcBridge';
import { useCallback, useSyncExternalStore } from 'react';

export type AgentProgressStatus = 'running' | 'connecting' | 'waiting_permission';

export type AgentProgress = {
  active: boolean;
  currentAction?: string;
  status?: AgentProgressStatus;
  lastUpdate: number;
};

// Singleton store shared across all consumers
let progressMap = new Map<string, AgentProgress>();
const listeners = new Set<() => void>();
const finishTimers = new Map<string, ReturnType<typeof setTimeout>>();

const STALE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const FINISH_GRACE_MS = 800;

let pendingEmit = false;

const emitChange = () => {
  progressMap = new Map(progressMap);
  if (!pendingEmit) {
    pendingEmit = true;
    requestAnimationFrame(() => {
      pendingEmit = false;
      listeners.forEach((listener) => listener());
    });
  }
};

const getKindLabel = (kind: string): string => {
  switch (kind) {
    case 'edit':
      return 'Edit';
    case 'read':
      return 'Read';
    case 'execute':
      return 'Bash';
    default:
      return kind;
  }
};

const handleMessage = (message: IResponseMessage) => {
  const { conversation_id, type } = message;
  if (!conversation_id) return;

  // Cancel pending finish timer on new activity
  const pendingTimer = finishTimers.get(conversation_id);
  if (pendingTimer && type !== 'finish') {
    clearTimeout(pendingTimer);
    finishTimers.delete(conversation_id);
  }

  switch (type) {
    case 'acp_tool_call': {
      const data = message.data as { update?: { kind?: string; title?: string; status?: string } };
      const update = data?.update;
      if (!update) break;
      const kindLabel = getKindLabel(update.kind || '');
      const title = update.title || '';
      const action = title ? `${kindLabel}: ${title}` : kindLabel;
      progressMap.set(conversation_id, {
        active: true,
        currentAction: action,
        status: 'running',
        lastUpdate: Date.now(),
      });
      emitChange();
      break;
    }
    case 'agent_status': {
      const data = message.data as { status?: string };
      const agentStatus = data?.status;
      if (agentStatus === 'connecting' || agentStatus === 'reconnecting') {
        progressMap.set(conversation_id, {
          active: true,
          currentAction: agentStatus === 'reconnecting' ? 'Reconnecting...' : 'Connecting...',
          status: 'connecting',
          lastUpdate: Date.now(),
        });
        emitChange();
      } else if (agentStatus === 'error' || agentStatus === 'disconnected') {
        progressMap.delete(conversation_id);
        emitChange();
      }
      break;
    }
    case 'content': {
      const existing = progressMap.get(conversation_id);
      if (!existing?.active || existing.status === 'connecting') {
        progressMap.set(conversation_id, {
          active: true,
          currentAction: 'Thinking...',
          status: 'running',
          lastUpdate: Date.now(),
        });
        emitChange();
      } else {
        // Silent timestamp bump (no re-render) -- prevents stale cleanup only
        existing.lastUpdate = Date.now();
      }
      break;
    }
    case 'acp_permission': {
      progressMap.set(conversation_id, {
        active: true,
        currentAction: 'Waiting for approval...',
        status: 'waiting_permission',
        lastUpdate: Date.now(),
      });
      emitChange();
      break;
    }
    case 'finish': {
      // Grace period before clearing (matches AcpSendBox pattern)
      const timer = setTimeout(() => {
        finishTimers.delete(conversation_id);
        progressMap.delete(conversation_id);
        emitChange();
      }, FINISH_GRACE_MS);
      finishTimers.set(conversation_id, timer);
      break;
    }
    case 'error': {
      progressMap.delete(conversation_id);
      emitChange();
      break;
    }
    default:
      break;
  }
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

// Stale entry cleanup
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

const startCleanup = () => {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    let changed = false;
    progressMap.forEach((progress, id) => {
      if (now - progress.lastUpdate > STALE_TIMEOUT_MS) {
        progressMap.delete(id);
        changed = true;
      }
    });
    if (changed) emitChange();
  }, 60_000);
};

const stopCleanup = () => {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
};

/**
 * Initialize IPC subscriptions for agent progress tracking.
 * Call once from the root layout component. Returns a cleanup function.
 */
export function initAgentProgressSubscription(): () => void {
  startCleanup();

  const unsub1 = ipcBridge.conversation.responseStream.on(handleMessage);
  const unsub2 = ipcBridge.openclawConversation.responseStream.on(handleMessage);

  return () => {
    unsub1();
    unsub2();
    stopCleanup();
    finishTimers.forEach((timer) => clearTimeout(timer));
    finishTimers.clear();
    progressMap = new Map();
    emitChange();
  };
}

/**
 * Per-conversation progress hook. Only re-renders when the specific
 * conversation's progress entry changes (Object.is comparison on the entry reference).
 */
export const useAgentProgress = (conversationId: string): AgentProgress | undefined => {
  const getSnapshot = useCallback(() => progressMap.get(conversationId), [conversationId]);
  return useSyncExternalStore(subscribe, getSnapshot);
};
