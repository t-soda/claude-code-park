import type { Messages } from "../index";

/** English message catalog. */
export const en: Messages = {
  common: {
    close: "Close",
    cancel: "Cancel",
    save: "Save",
    saving: "Saving…",
    create: "Create",
    delete: "Delete",
    edit: "Edit",
    // {scopes} is the "・"-joined scope names.
    overrides: "Overrides {scopes}",
    // Means: read-only because it originates from {scope}.
    readOnlyFrom: "Read-only (from {scope}).",
  },

  nav: {
    office: "Town",
    settings: "Settings",
  },

  app: {
    configError: "Failed to load settings: {error}",
  },

  scope: {
    user: "User (~/.claude)",
    project: "Project (.claude)",
    local: "Local (.local)",
    plugin: "Plugin",
  },

  /** WorkKind → speech bubble label in the Town (stateToVisual). */
  activityBubble: {
    Idle: "💤 Idle",
    Thinking: "🤔 Thinking",
    Reading: "📖 Reading",
    Editing: "✍️ Editing",
    Running: "▶️ Running",
    Searching: "🔍 Searching",
    Reviewing: "👀 Reviewing",
    Delegating: "📣 Delegating",
    WebExploring: "🌐 Web research",
    AwaitingUser: "✋ Awaiting input",
  },

  /** WorkKind → row label in the log dialog (CharacterLogDialog). */
  activityLog: {
    Idle: "💤 Idle",
    Thinking: "💭 Thinking",
    Reading: "📖 Reading",
    Editing: "✏️ Editing",
    Running: "⚙️ Running",
    Searching: "🔍 Searching",
    Reviewing: "🔎 Reviewing",
    Delegating: "📨 Delegating",
    WebExploring: "🌐 Web",
    AwaitingUser: "⏳ Awaiting input",
  },

  settings: {
    title: "Settings",
    subtitle: "Configure how the Town screen looks and how characters appear.",
    displaySection: "Display settings",
    showHookViz: "Show hook visualization (rails, firing beams) in the Town",
    showDelegationLines: "Show subagent delegation lines in the Town",
    showToolNames: "Show tool names in the log",
    showTrayIcon: "Show the menu-bar icon",
    characterEditor: "Character editor",
    languageSection: "Language",
    languageLabel: "Display language",
  },

  update: {
    available: "A new version {version} is available",
    updateNow: "Update now",
    later: "Later",
    downloading: "Downloading update…",
    downloadingPct: "Downloading update… {percent}%",
    restarting: "Restarting to apply the update…",
    section: "Updates",
    currentVersion: "Current version: {version}",
    checkNow: "Check for updates",
    checking: "Checking…",
    upToDate: "You're up to date",
    checkError: "Failed to check for updates: {error}",
  },

  hooks: {
    description:
      "hooks in settings.json. Equivalent to Agent training / business rules. Applied immediately on save (existing keys preserved).",
    vizHint: "The toggle for showing hook firing in the Town is on the \"Settings\" tab.",
    addTitle: "＋ Add Hook",
    eventLabel: "Event",
    matcherLabel: "matcher (regex, empty matches all)",
    matcherPlaceholder: "e.g. Edit|Write",
    commandLabel: "command (shell command)",
    commandPlaceholder: 'e.g. npx prettier --write "$CLAUDE_FILE_PATH"',
    addAndSave: "Add and save",
    unset: "Not set",
    count: "{count}",
    emptyTiming: "No hooks for this timing yet.",
    confirmDeleteTitle: "Delete this hook?",
    // Default label for the delete confirmation. {event} is the target event name.
    fallbackLabel: "{event} hook",
  },

  hookDetail: {
    empty: "No hooks registered for this timing.",
  },

  metrics: {
    title: "Metrics dashboard",
    subtitle:
      "Each Agent's share of overall work (activity share). A low share is a signal to ask \"is this Agent really needed?\"",
    refresh: "Refresh",
    aggregating: "Aggregating…",
    empty: "No aggregated data yet.",
    orchestratorMain: "Orchestrator (main)",
    rangeToday: "Today",
    range7d: "Last 7 days",
    range30d: "Last 30 days",
    colShare: "Activity share",
    colTime: "Active time",
    colCalls: "Calls",
    colTools: "Tool runs",
    colFailRate: "Failure rate",
    colTokensOut: "Tokens (out)",
    // Units for active time ({n} is the number).
    unitSeconds: "{n}s",
    unitMinutes: "{n}m",
    unitHours: "{n}h",
  },

  agents: {
    description: "Role definitions in ~/.claude/agents/. When called, they come into the Town and work.",
    hire: "＋ Hire",
    empty: "No Agents yet. Create your first Agent with \"Hire\".",
  },

  agentDetail: {
    // {name} is the Agent name.
    confirmFire: "Fire Agent \"{name}\" (delete its definition)?",
    origin: "Source",
    description: "Description",
    model: "Model",
    color: "Color",
    file: "File",
    shareToday: "Today's activity share",
    callCount: "Call count",
    failRate: "Failure rate",
    roleDef: "Role definition",
    noBody: "(no body)",
    edit: "Edit",
    fire: "Fire",
  },

  agentEditor: {
    titleHire: "Hire an Agent",
    // {name} is the Agent being edited.
    titleEdit: "Edit {name}",
    nameLabel: "Name (lowercase letters, digits, hyphens)",
    namePlaceholder: "e.g. react-reviewer",
    descLabel: "Responsibility / role (description)",
    descPlaceholder: "e.g. Reviews React components",
    toolsLabel: "Allowed tools (comma-separated, empty allows all)",
    modelLabel: "Model (empty for inherit)",
    roleLabel: "Role definition (body / system prompt)",
    hire: "Hire",
  },

  skills: {
    description: "Skills in ~/.claude/skills/. Disable with `.disabled` (contents preserved).",
    newSkill: "＋ New Skill",
    empty: "No Skills.",
    enabled: "Enabled",
    disabled: "Disabled",
    enable: "Enable",
    disable: "Disable",
  },

  skillEditor: {
    title: "Create a Skill",
    nameLabel: "Name (lowercase letters, digits, hyphens)",
    namePlaceholder: "e.g. ship",
    descLabel: "Description (include trigger conditions)",
    toolsLabel: "allowed-tools (space/comma-separated)",
    bodyLabel: "Body (steps / prompt)",
  },

  characterEditor: {
    target: "Target:",
    model: "Model:",
    tools: "Tools",
    // Heading for "Color". {note} is the Agent supplement (sometimes empty).
    colorHeading: "Color ",
    colorAutoNote: "(Agents are automatic per role)",
    bodyColor: "Body color",
    eyeColor: "Eye color",
    resetDefault: "Reset to default",
    clearAll: "Clear all",
    toolErase: "Eraser",
    toolBody: "Body",
    toolEye: "Eyes",
    // Display label for the employee variant (model unspecified).
    variantCommon: "Common",
  },

  characterLog: {
    // {error} is the failure reason.
    fetchError: "Failed to fetch the log: {error}",
    empty: "No work logs recorded.",
    // Label for a row where the Stop/SubagentStop lifecycle itself was blocked, not a specific tool.
    blockedStop: "Stop hook blocked",
  },

  office: {
    unregistered: "None registered",
    orchestrator: "Orchestrator",
    delegatedBy: "Called by: {name}",
    delegatesTo: "Calls: {name}",
    quietTitle: "The Town is quiet right now 🌙",
    quietBody:
      "Run Claude Code in your terminal and the Orchestrator will appear here and start working.",
  },

  replay: {
    title: "Replay",
    subtitle:
      "Play back sessions in the Town. For a running session, see what it's done so far; for a finished one, the whole story — at your own pace.",
    browser: {
      empty: "No sessions to replay (showing the last 31 days).",
      fetchError: "Failed to fetch the session list: {error}",
      statusActive: "Active",
      statusIdle: "Idle",
    },
    player: {
      back: "Back to list",
      play: "Play",
      pause: "Pause",
      follow: "▼ Follow",
      railsNote: "Hook rails show the current config (not a recording from the session)",
      loadError: "Failed to load the replay: {error}",
    },
    log: {
      title: "Event log",
      sessionStart: "🏢 Session start",
      userPrompt: "🧑‍💻 Prompt",
      turnEnd: "🏁 Turn end",
      subagentSpawn: "📣 Subagent spawned",
      subagentStop: "👋 Subagent finished",
    },
  },

  roomMenu: {
    backToMenu: "‹ Menu",
  },

  terminal: {
    notFound: "Couldn't find the terminal for this session",
  },

  sprite: {
    // Fallback name tag when subagent_type is unknown.
    dispatchFallback: "Dispatch",
  },

  hookBeam: {
    noResponse: "No response",
    blocked: "Blocked by hook",
  },

  todoChip: {
    // {total} is completed/total (same value).
    allDone: "✓ {total}/{total} done",
  },
} as const;
