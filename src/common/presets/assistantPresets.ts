import type { PresetAgentType } from '@/types/acpTypes';

export type AssistantPreset = {
  id: string;
  avatar: string;
  presetAgentType?: PresetAgentType;
  /**
   * Directory containing all resources for this preset (relative to project root).
   * If set, both ruleFiles and skillFiles will be resolved from this directory.
   * Default: rules/ for rules, skills/ for skills
   */
  resourceDir?: string;
  ruleFiles: Record<string, string>;
  skillFiles?: Record<string, string>;
  /**
   * Default enabled skills for this assistant (skill names from skills/ directory).
   */
  defaultEnabledSkills?: string[];
  nameI18n: Record<string, string>;
  descriptionI18n: Record<string, string>;
  promptsI18n?: Record<string, string[]>;
};

export const ASSISTANT_PRESETS: AssistantPreset[] = [
  {
    id: 'cowork',
    avatar: 'cowork.svg',
    presetAgentType: 'gemini',
    resourceDir: 'assistant/cowork',
    ruleFiles: {
      'en-US': 'cowork.md',
    },
    skillFiles: {
      'en-US': 'cowork-skills.md',
    },
    defaultEnabledSkills: ['skill-creator', 'pptx', 'docx', 'pdf', 'xlsx'],
    nameI18n: {
      'en-US': 'Cowork',
    },
    descriptionI18n: {
      'en-US': 'Autonomous task execution with file operations, document processing, and multi-step workflow planning.',
    },
    promptsI18n: {
      'en-US': ['Analyze the current project structure and suggest improvements', 'Automate the build and deployment process', 'Extract and summarize key information from all PDF files'],
    },
  },
  {
    id: 'pptx-generator',
    avatar: '📊',
    presetAgentType: 'gemini',
    resourceDir: 'assistant/pptx-generator',
    ruleFiles: {
      'en-US': 'pptx-generator.md',
    },
    nameI18n: {
      'en-US': 'PPTX Generator',
    },
    descriptionI18n: {
      'en-US': 'Generate local PPTX assets and structure for pptxgenjs.',
    },
    promptsI18n: {
      'en-US': ['Create a professional slide deck about AI trends with 10 slides', 'Generate a quarterly business report presentation', 'Make a product launch presentation with visual elements'],
    },
  },
  {
    id: 'pdf-to-ppt',
    avatar: '📄',
    presetAgentType: 'gemini',
    resourceDir: 'assistant/pdf-to-ppt',
    ruleFiles: {
      'en-US': 'pdf-to-ppt.md',
    },
    nameI18n: {
      'en-US': 'PDF to PPT',
    },
    descriptionI18n: {
      'en-US': 'Convert PDF to PPT with watermark removal rules.',
    },
    promptsI18n: {
      'en-US': ['Convert report.pdf to a PowerPoint presentation', 'Extract all charts and diagrams from whitepaper.pdf', 'Transform this PDF document into slides with proper formatting'],
    },
  },
  {
    id: 'game-3d',
    avatar: '🎮',
    presetAgentType: 'gemini',
    resourceDir: 'assistant/game-3d',
    ruleFiles: {
      'en-US': 'game-3d.md',
    },
    nameI18n: {
      'en-US': '3D Game',
    },
    descriptionI18n: {
      'en-US': 'Generate a complete 3D platform collection game in one HTML file.',
    },
    promptsI18n: {
      'en-US': ['Create a 3D platformer game with jumping mechanics', 'Make a coin collection game with obstacles', 'Build a 3D maze exploration game'],
    },
  },
  {
    id: 'ui-ux-pro-max',
    avatar: '🎨',
    presetAgentType: 'gemini',
    resourceDir: 'assistant/ui-ux-pro-max',
    ruleFiles: {
      'en-US': 'ui-ux-pro-max.md',
    },
    nameI18n: {
      'en-US': 'UI/UX Pro Max',
    },
    descriptionI18n: {
      'en-US': 'Professional UI/UX design intelligence with 57 styles, 95 color palettes, 56 font pairings, and stack-specific best practices.',
    },
    promptsI18n: {
      'en-US': ['Design a modern login page for a fintech mobile app', 'Create a color palette for a nature-themed website', 'Design a dashboard interface for a SaaS product'],
    },
  },
  {
    id: 'planning-with-files',
    avatar: '📋',
    presetAgentType: 'gemini',
    resourceDir: 'assistant/planning-with-files',
    ruleFiles: {
      'en-US': 'planning-with-files.md',
    },
    nameI18n: {
      'en-US': 'Planning with Files',
    },
    descriptionI18n: {
      'en-US': 'Manus-style file-based planning for complex tasks. Uses task_plan.md, findings.md, and progress.md to maintain persistent context.',
    },
    promptsI18n: {
      'en-US': ['Plan a comprehensive refactoring task with milestones', 'Break down the feature implementation into actionable steps', 'Create a project plan for migrating to a new framework'],
    },
  },
  {
    id: 'human-3-coach',
    avatar: '🧭',
    presetAgentType: 'gemini',
    resourceDir: 'assistant/human-3-coach',
    ruleFiles: {
      'en-US': 'human-3-coach.md',
    },
    nameI18n: {
      'en-US': 'HUMAN 3.0 Coach',
    },
    descriptionI18n: {
      'en-US': 'Personal development coach based on HUMAN 3.0 framework: 4 Quadrants (Mind/Body/Spirit/Vocation), 3 Levels, 3 Growth Phases.',
    },
    promptsI18n: {
      'en-US': ['Help me set quarterly goals across all life quadrants', 'Reflect on my career progress and plan next steps', 'Create a personal development plan for the next 3 months'],
    },
  },
  {
    id: 'beautiful-mermaid',
    avatar: '📈',
    presetAgentType: 'gemini',
    resourceDir: 'assistant/beautiful-mermaid',
    ruleFiles: {
      'en-US': 'beautiful-mermaid.md',
    },
    defaultEnabledSkills: ['mermaid'],
    nameI18n: {
      'en-US': 'Beautiful Mermaid',
    },
    descriptionI18n: {
      'en-US': 'Create flowcharts, sequence diagrams, state diagrams, class diagrams, and ER diagrams with beautiful themes.',
    },
    promptsI18n: {
      'en-US': ['Draw a detailed user login authentication flowchart', 'Create an API sequence diagram for payment processing', 'Create a system architecture diagram'],
    },
  },
  {
    id: 'story-roleplay',
    avatar: '📖',
    presetAgentType: 'gemini',
    resourceDir: 'assistant/story-roleplay',
    ruleFiles: {
      'en-US': 'story-roleplay.md',
    },
    defaultEnabledSkills: ['story-roleplay'],
    nameI18n: {
      'en-US': 'Story Roleplay',
    },
    descriptionI18n: {
      'en-US': 'Immersive story roleplay. Start by: 1) Natural language to create characters, 2) Paste PNG images, or 3) Open folder with character cards (PNG/JSON) and world info.',
    },
    promptsI18n: {
      'en-US': ['Start an epic fantasy adventure with a brave warrior', 'Create a detailed character with backstory and personality', 'Begin an interactive story in a sci-fi setting'],
    },
  },
];
