# Fork Change Log

Fork: `kjwoo31/AionUi` (from `iOfficeAI/AionUi`)
Date: 2026-02-23
Base commit: `b83d671d`

---

## 1. Security Fixes

### 1.1 Credential Encryption (Base64 → safeStorage)

- **Commit**: `853aeea4`
- **Files**: `src/channels/utils/credentialCrypto.ts`
- **Change**: Replaced Base64-only encoding with Electron `safeStorage` API for OS-level encryption (DPAPI/Keychain/libsecret)
- **Revert**: `git revert 853aeea4` — restores Base64 encoding for credentials

### 1.2 XSS Fix (MessageTips)

- **Commit**: `853aeea4`
- **Files**: `src/renderer/messages/MessageTips.tsx`
- **Change**: Removed `dangerouslySetInnerHTML`, uses React safe text rendering
- **Revert**: Same commit as 1.1

### 1.3 XSS Fix (Diff2Html)

- **Commit**: `853aeea4`
- **Files**: `src/renderer/components/Diff2Html.tsx`, `package.json`
- **Change**: Added DOMPurify sanitization, changed `innerHTML` to `textContent`
- **Revert**: Same commit as 1.1, also `npm uninstall dompurify @types/dompurify`

### 1.4 Command Injection Fix (AcpDetector)

- **Commit**: `853aeea4`
- **Files**: `src/agent/acp/AcpDetector.ts`
- **Change**: Replaced `execSync` with `execFileSync` to prevent shell injection
- **Revert**: Same commit as 1.1

### 1.5 CSRF / CORS / Cookie Fixes

- **Commit**: `853aeea4`
- **Files**: `src/webserver/setup.ts`
- **Change**: Removed CORS `null` origin bypass, added `/login` to CSRF protection, used session-derived cookie-parser secret
- **Revert**: Same commit as 1.1

### 1.6 Moltbook Removal

- **Commit**: `5bd02493`
- **Files**: `assistant/moltbook/`, `skills/moltbook/`, `src/common/presets/assistantPresets.ts`, `src/process/initStorage.ts`
- **Change**: Removed moltbook integration (data exfiltration risk to moltbook.com)
- **Revert**: `git revert 5bd02493`

---

## 2. Chinese Platform Removal

### 2.1 DingTalk / Lark / Baidu Qianfan

- **Commit**: `7a8a564f`
- **Files**: `src/channels/plugins/dingtalk/`, `src/channels/plugins/lark/`, `src/renderer/components/SettingsModal/contents/DingTalkConfigForm.tsx`, `src/renderer/components/SettingsModal/contents/LarkConfigForm.tsx`, + 16 more files
- **Change**: Complete removal of DingTalk channel plugin, Lark/Feishu channel plugin, Baidu Qianfan model provider
- **Revert**: `git revert 7a8a564f` — WARNING: large revert, may require manual conflict resolution

### 2.2 Xiaohongshu / Social Job Publisher / OpenClaw

- **Commits**: `f7899f90`, `88ed65ea`
- **Files**: `skills/xiaohongshu-recruiter/`, `assistant/social-job-publisher/`, `skills/openclaw-setup/`, `skills/x-recruiter/`, `assistant/openclaw-setup/`
- **Change**: Removed Chinese social platform skills, openclaw preset, all zh-CN translation files
- **Revert**: `git revert 88ed65ea && git revert f7899f90`

### 2.3 Gemini Removed from Agent List

- **Commit**: `ee0596b3`
- **Files**: `src/agent/acp/AcpDetector.ts`
- **Change**: Removed built-in Gemini from agent detection list
- **Revert**: `git revert ee0596b3`

---

## 3. Claude Code Defaults

### 3.1 Default Agent: Claude Code

- **Commit**: `8285701e`
- **Files**: `src/agent/acp/AcpDetector.ts`, `src/renderer/pages/guid/index.tsx`
- **Change**: Claude Code prioritized in agent list, default selected agent changed from `gemini` to `claude`
- **Revert**: `git revert 8285701e`

### 3.2 Default Mode: YOLO (bypassPermissions)

- **Commits**: `b13d92f2`, `44329818`, `19d3e193`, `63d69a9a`, `0af9d685`, `909e289d`, `265a85b1`, `5f6ab5c6`, `7f7d7f8b`, `e163a132`
- **Files**: `src/renderer/pages/guid/index.tsx`, `src/renderer/constants/agentModes.ts`, `src/process/task/AcpAgentManager.ts`, `src/process/bridge/acpConversationBridge.ts`
- **Change**: YOLO mode as default everywhere — Guid page, conversation view, agent change, preset assistants, old conversations
- **Revert**: Reset all mode defaults to `'default'`:
  - `src/renderer/pages/guid/index.tsx`: Change `useState<string>('bypassPermissions')` → `useState<string>('default')`, change `setSelectedMode('bypassPermissions')` → `setSelectedMode('default')`
  - `src/renderer/constants/agentModes.ts`: Move `bypassPermissions` back to last position in claude/custom/gemini arrays
  - `src/process/task/AcpAgentManager.ts`: Change `data.sessionMode || 'bypassPermissions'` → `data.sessionMode || 'default'`
  - `src/process/bridge/acpConversationBridge.ts`: Change fallback `'bypassPermissions'` → `'default'`

### 3.3 Default Model: claude-opus-4-6

- **Commits**: `e4997ad6`, `7bd7c810`
- **Files**: `src/channels/actions/SystemActions.ts`
- **Change**: Channel (Telegram) default model changed from Gemini to `claude-opus-4-6`, prefers Anthropic provider
- **Revert**: `git revert 7bd7c810 && git revert e4997ad6`

---

## 4. .claude/settings.json Integration

### 4.1 Read Model & Mode from Settings

- **Commits**: `6fce7ee8`, `1dba237b`
- **Files**: `src/agent/acp/utils.ts`, `src/common/ipcBridge.ts`, `src/process/bridge/acpConversationBridge.ts`, `src/renderer/pages/guid/index.tsx`
- **Change**: Read `model` and `permissions.defaultMode` from `~/.claude/settings.json`, display in Guid page
- **Revert**: `git revert 1dba237b && git revert 6fce7ee8`

### 4.2 MCP Bidirectional Sync

- **Commit**: `05b863dd`
- **Files**: `src/process/initStorage.ts`
- **Change**: Auto-import MCP servers from Claude Code on startup (`claude mcp list`)
- **Revert**: `git revert 05b863dd`

### 4.3 Plugin → Assistant Sync

- **Commits**: `842f7219`, `8fc1f61b`, `5cb77067`, `d6e2e4d4`, `98914ee6`, `46584bf8`, `3d2814c1`, `85e17b4f`
- **Files**: `src/process/initStorage.ts`, `src/process/bridge/fsBridge.ts`
- **Change**: Auto-create AionUi assistants from Claude Code `enabledPlugins`, load SKILL.md content as rules, fallback to config context for plugin assistants
- **Revert**: Remove `syncAssistantsFromClaudePlugins()` and `loadPluginSkillsContent()` from `src/process/initStorage.ts`, remove config fallback from `src/process/bridge/fsBridge.ts`

---

## 5. UI Improvements

### 5.1 Workspace Path Display

- **Commits**: `83884730`, `dd803890`
- **Files**: `src/renderer/pages/guid/index.tsx`, `src/renderer/utils/workspace.ts`, `src/renderer/pages/conversation/WorkspaceGroupedHistory.tsx`
- **Change**: Show last folder name only (not full path), handle Windows `\` paths, tooltip with full path on hover
- **Revert**: `git revert dd803890 && git revert 83884730`

### 5.2 Sidebar Tooltip

- **Commits**: `f2282f72`, `0309b813`
- **Files**: `src/renderer/pages/conversation/WorkspaceGroupedHistory.tsx`
- **Change**: Always show tooltip on conversation items, workspace group headers show full path on hover
- **Revert**: `git revert 0309b813 && git revert f2282f72`

### 5.3 Remove x.com / GitHub Links

- **Commit**: `4d68c801`
- **Files**: `src/renderer/pages/guid/index.tsx`
- **Change**: Removed quick action buttons (x.com feedback, GitHub star) from welcome page
- **Revert**: `git revert 4d68c801`

### 5.4 Enable All Assistant Presets

- **Commit**: `83884730`, `b148a740`
- **Files**: `src/process/initStorage.ts`
- **Change**: All builtin assistant presets enabled by default, removed builtin assistants cleaned from DB on startup
- **Revert**: `git revert b148a740 && git revert 83884730`

---

## 6. Windows Support

### 6.1 Git Bash SHELL Injection

- **Commit**: `8285701e`
- **Files**: `src/process/utils/shellEnv.ts`
- **Change**: Inject `SHELL` env var pointing to Git Bash on Windows, enabling Claude Code bash hooks
- **Revert**: `git revert 8285701e`

---

## Git Remote Configuration

```
origin    https://github.com/kjwoo31/AionUi.git (push target)
upstream  https://github.com/iOfficeAI/AionUi.git (original repo)
```

### Sync with upstream

```bash
git fetch upstream
git merge upstream/main
# Resolve conflicts if any
```

### Full revert to upstream

```bash
git reset --hard upstream/main
git push origin main --force
```
