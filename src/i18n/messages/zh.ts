import type { Messages } from "../index";

/** 简体中文消息目录。 */
export const zh: Messages = {
  common: {
    close: "关闭",
    cancel: "取消",
    save: "保存",
    saving: "保存中…",
    create: "创建",
    delete: "删除",
    edit: "编辑",
    // {scopes} 是用「・」连接好的作用域名称。
    overrides: "覆盖 {scopes}",
    // 表示由于来自 {scope}，因此为只读。
    readOnlyFrom: "来自 {scope}，只读。",
  },

  nav: {
    office: "小镇",
    settings: "设置",
  },

  app: {
    configError: "读取设置出错: {error}",
  },

  scope: {
    user: "用户 (~/.claude)",
    project: "项目 (.claude)",
    local: "本地 (.local)",
    plugin: "插件",
  },

  /** WorkKind → 小镇上的气泡标签（stateToVisual）。 */
  activityBubble: {
    Idle: "💤 空闲",
    Thinking: "🤔 思考中",
    Reading: "📖 阅读中",
    Editing: "✍️ 编辑中",
    Running: "▶️ 执行中",
    Searching: "🔍 搜索中",
    Reviewing: "👀 审查",
    Delegating: "📣 指派中",
    WebExploring: "🌐 Web调查",
    AwaitingUser: "✋ 等待确认",
  },

  /** WorkKind → 日志对话框的行标签（CharacterLogDialog）。 */
  activityLog: {
    Idle: "💤 空闲",
    Thinking: "💭 思考",
    Reading: "📖 读取",
    Editing: "✏️ 编辑",
    Running: "⚙️ 执行",
    Searching: "🔍 搜索",
    Reviewing: "🔎 审查",
    Delegating: "📨 委派",
    WebExploring: "🌐 Web",
    AwaitingUser: "⏳ 等待输入",
  },

  settings: {
    title: "设置",
    subtitle: "设置小镇画面的显示相关项以及角色的外观。",
    displaySection: "显示设置",
    showHookViz: "在小镇中显示 hook 可视化（轨道・触发光束）",
    showDelegationLines: "在小镇中显示子代理之间的委派连线",
    showToolNames: "在日志中显示工具名称",
    characterEditor: "角色编辑器",
    languageSection: "语言",
    languageLabel: "显示语言",
  },

  update: {
    available: "新版本 {version} 可用",
    updateNow: "立即更新",
    later: "稍后",
    downloading: "正在下载更新…",
    downloadingPct: "正在下载更新… {percent}%",
    restarting: "正在重启以应用更新…",
    section: "更新",
    currentVersion: "当前版本：{version}",
    checkNow: "检查更新",
    checking: "检查中…",
    upToDate: "已是最新版本",
    checkError: "检查更新失败：{error}",
  },

  hooks: {
    description:
      "settings.json 的 hooks。相当于 Agent 培训・业务规则。保存后立即生效（保留现有键）。",
    vizHint: "hook 触发的小镇显示开关位于「设置」标签页中。",
    addTitle: "＋ 添加 Hook",
    eventLabel: "事件",
    matcherLabel: "matcher（正则表达式，留空则全部匹配）",
    matcherPlaceholder: "例: Edit|Write",
    commandLabel: "command（Shell 命令）",
    commandPlaceholder: '例: npx prettier --write "$CLAUDE_FILE_PATH"',
    addAndSave: "添加并保存",
    unset: "未设置",
    count: "{count} 项",
    emptyTiming: "此时机尚无 hook。",
    confirmDeleteTitle: "要删除 hook 吗？",
    // 删除确认的默认标签。{event} 为目标事件名。
    fallbackLabel: "{event} 的 hook",
  },

  hookDetail: {
    empty: "此时机未注册任何 hook。",
  },

  metrics: {
    title: "Metrics 仪表盘",
    subtitle:
      "各 Agent 在整体工作中所占的比例（工作份额）。份额较低的 Agent 可作为「是否真的需要？」的判断依据。",
    refresh: "刷新",
    aggregating: "汇总中…",
    empty: "尚无汇总数据。",
    orchestratorMain: "Orchestrator（主）",
    rangeToday: "今天",
    range7d: "最近 7 天",
    range30d: "最近 30 天",
    colShare: "工作份额",
    colTime: "工作时长",
    colCalls: "调用",
    colTools: "工具执行",
    colFailRate: "失败率",
    colTokensOut: "令牌(out)",
    // 工作时长的单位（{n} 为数值）。
    unitSeconds: "{n}秒",
    unitMinutes: "{n}分钟",
    unitHours: "{n}小时",
  },

  agents: {
    description: "~/.claude/agents/ 中的角色定义。被调用时会到小镇上班工作。",
    hire: "＋ 雇用",
    empty: "还没有 Agent。点击「雇用」来创建第一个 Agent 吧。",
  },

  agentDetail: {
    // {name} 为 Agent 名。
    confirmFire: "要解雇（删除定义）Agent「{name}」吗？",
    origin: "来源",
    description: "说明",
    model: "模型",
    color: "颜色",
    file: "文件",
    shareToday: "今天的工作份额",
    callCount: "调用次数",
    failRate: "失败率",
    roleDef: "角色定义",
    noBody: "(无正文)",
    edit: "编辑",
    fire: "解雇",
  },

  agentEditor: {
    titleHire: "雇用 Agent",
    // {name} 为编辑对象 Agent 名。
    titleEdit: "编辑 {name}",
    nameLabel: "名称（小写字母・数字・连字符）",
    namePlaceholder: "例: react-reviewer",
    descLabel: "职责・角色（description）",
    descPlaceholder: "例: 负责 React 组件的审查",
    toolsLabel: "可用工具（逗号分隔，留空则全部允许）",
    modelLabel: "模型（留空则 inherit）",
    roleLabel: "角色定义（正文・系统提示）",
    hire: "雇用",
  },

  skills: {
    description: "~/.claude/skills/ 中的技能。用 `.disabled` 停用（内容保留）。",
    newSkill: "＋ 新建 Skill",
    empty: "没有 Skill。",
    enabled: "已启用",
    disabled: "已停用",
    enable: "启用",
    disable: "停用",
  },

  skillEditor: {
    title: "创建 Skill",
    nameLabel: "名称（小写字母・数字・连字符）",
    namePlaceholder: "例: ship",
    descLabel: "说明（包含触发条件）",
    toolsLabel: "allowed-tools（空格/逗号分隔）",
    bodyLabel: "正文（步骤・提示）",
  },

  characterEditor: {
    target: "对象:",
    model: "模型:",
    tools: "工具",
    // 「颜色」的标题。{note} 为 Agent 时的补充（有时为空）。
    colorHeading: "颜色 ",
    colorAutoNote: "（Agent 按角色自动设定）",
    bodyColor: "本体色",
    eyeColor: "眼睛色",
    resetDefault: "恢复默认",
    clearAll: "全部清除",
    toolErase: "橡皮擦",
    toolBody: "本体",
    toolEye: "眼睛",
    // 员工变体（未指定 model）的显示标签。
    variantCommon: "通用",
  },

  characterLog: {
    // {error} 为失败原因。
    fetchError: "获取日志失败: {error}",
    empty: "没有记录的工作日志。",
  },

  office: {
    unregistered: "未登记",
    orchestrator: "Orchestrator",
    delegatedBy: "调用者:{name}",
    delegatesTo: "调用对象:{name}",
    quietTitle: "现在小镇很安静 🌙",
    quietBody:
      "在终端运行 Claude Code，这里就会出现 Orchestrator 开始工作。",
  },

  replay: {
    title: "回放",
    subtitle: "在小镇中回放会话。正在运行的会话可以看到目前为止的动作,已结束的会话可以看到完整过程,慢慢回顾何时执行了什么。",
    browser: {
      empty: "没有可回放的会话(显示最近 31 天)。",
      fetchError: "获取会话列表失败:{error}",
      statusActive: "运行中",
      statusIdle: "空闲",
    },
    player: {
      back: "返回列表",
      play: "播放",
      pause: "暂停",
      follow: "▼ 跟随",
      railsNote: "hook 导轨显示的是当前配置(并非会话当时的记录)",
      loadError: "回放加载失败:{error}",
    },
    log: {
      title: "事件日志",
      sessionStart: "🏢 会话开始",
      userPrompt: "🧑‍💻 提示词",
      turnEnd: "🏁 回合结束",
      subagentSpawn: "📣 子代理启动",
      subagentStop: "👋 子代理结束",
    },
  },

  roomMenu: {
    backToMenu: "‹ 菜单",
  },

  terminal: {
    notFound: "未找到该会话对应的终端",
  },

  sprite: {
    // subagent_type 未知时的回退名牌。
    dispatchFallback: "派遣",
  },

  hookBeam: {
    noResponse: "无响应",
  },

  todoChip: {
    // {total} 为已完成/总数（同值）。
    allDone: "✓ {total}/{total} 完成",
  },
};
