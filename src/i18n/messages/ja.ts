/**
 * 日本語メッセージカタログ（ソース・オブ・トゥルース）。
 * この構造から Messages 型を導出し、他言語ファイルは同型を満たすことを TS で強制する
 * （= 翻訳漏れ・キー不一致がコンパイルエラーになる）。
 *
 * 値中の {name} 形式は t() の第2引数で補間される。絵文字は言語非依存なので各言語で共有。
 */
export const ja = {
  common: {
    close: "閉じる",
    cancel: "キャンセル",
    save: "保存",
    saving: "保存中…",
    create: "作成",
    delete: "削除",
    edit: "編集",
    // {scopes} は「・」連結済みのスコープ名。
    overrides: "{scopes}を上書き",
    // {scope} 由来のため読み取り専用、の意。
    readOnlyFrom: "{scope} 由来のため読み取り専用です。",
  },

  nav: {
    office: "タウン",
    settings: "設定",
  },

  app: {
    configError: "設定の読み込みエラー: {error}",
  },

  scope: {
    user: "ユーザー (~/.claude)",
    project: "プロジェクト (.claude)",
    local: "ローカル (.local)",
    plugin: "プラグイン",
  },

  /** WorkKind → タウン上の吹き出しラベル（stateToVisual）。 */
  activityBubble: {
    Idle: "💤 待機",
    Thinking: "🤔 思考中",
    Reading: "📖 読解中",
    Editing: "✍️ 編集中",
    Running: "▶️ 実行中",
    Searching: "🔍 検索中",
    Reviewing: "👀 レビュー",
    Delegating: "📣 指示中",
    WebExploring: "🌐 Web調査",
    AwaitingUser: "✋ 確認待ち",
  },

  /** WorkKind → ログダイアログの行ラベル（CharacterLogDialog）。 */
  activityLog: {
    Idle: "💤 待機",
    Thinking: "💭 思考",
    Reading: "📖 読み込み",
    Editing: "✏️ 編集",
    Running: "⚙️ 実行",
    Searching: "🔍 検索",
    Reviewing: "🔎 レビュー",
    Delegating: "📨 委譲",
    WebExploring: "🌐 Web",
    AwaitingUser: "⏳ 入力待ち",
  },

  settings: {
    title: "設定",
    subtitle: "タウン画面の表示まわりと、キャラクターの見た目を設定します。",
    displaySection: "表示設定",
    showHookViz: "hook 可視化（レール・発火ビーム）をタウンに表示する",
    showToolNames: "ログにツール名を表示する",
    characterEditor: "キャラクターエディタ",
    languageSection: "言語",
    languageLabel: "表示言語",
  },

  hooks: {
    description:
      "settings.json の hooks。Agent教育・業務ルールに相当。保存すると即反映（既存キーは保全）。",
    vizHint: "hook 発火のタウン表示の切り替えは「設定」タブにあります。",
    addTitle: "＋ Hook を追加",
    eventLabel: "イベント",
    matcherLabel: "matcher（正規表現、空欄で全マッチ）",
    matcherPlaceholder: "例: Edit|Write",
    commandLabel: "command（シェルコマンド）",
    commandPlaceholder: '例: npx prettier --write "$CLAUDE_FILE_PATH"',
    addAndSave: "追加して保存",
    unset: "未設定",
    count: "{count} 件",
    emptyTiming: "このタイミングの hook はまだありません。",
    confirmDeleteTitle: "hook を削除しますか？",
    // 削除確認の既定ラベル。{event} は対象イベント名。
    fallbackLabel: "{event} の hook",
  },

  hookDetail: {
    empty: "このタイミングに登録された hook はありません。",
  },

  metrics: {
    title: "Metricsダッシュボード",
    subtitle:
      "全体の仕事に占める各Agentの割合（稼働シェア）。シェアが低いAgentは「本当に必要？」の判断材料に。",
    refresh: "更新",
    aggregating: "集計中…",
    empty: "まだ集計データがありません。",
    orchestratorMain: "Orchestrator（メイン）",
    rangeToday: "今日",
    range7d: "直近7日",
    range30d: "直近30日",
    colShare: "稼働シェア",
    colTime: "稼働時間",
    colCalls: "呼び出し",
    colTools: "ツール実行",
    colFailRate: "失敗率",
    colTokensOut: "トークン(out)",
    // 稼働時間の単位（{n} は数値）。
    unitSeconds: "{n}秒",
    unitMinutes: "{n}分",
    unitHours: "{n}時間",
  },

  agents: {
    description: "~/.claude/agents/ の役割定義。呼ばれるとタウンに出社して働く。",
    hire: "＋ 雇用する",
    empty: "まだAgentがいません。「雇用する」で最初のAgentを作りましょう。",
  },

  agentDetail: {
    // {name} は Agent 名。
    confirmFire: "Agent「{name}」を解雇（定義削除）しますか？",
    origin: "由来",
    description: "説明",
    model: "モデル",
    color: "色",
    file: "ファイル",
    shareToday: "今日の稼働シェア",
    callCount: "呼び出し回数",
    failRate: "失敗率",
    roleDef: "役割定義",
    noBody: "(本文なし)",
    edit: "編集",
    fire: "解雇",
  },

  agentEditor: {
    titleHire: "Agentを雇用",
    // {name} は編集対象 Agent 名。
    titleEdit: "{name} を編集",
    nameLabel: "名前（英小文字・数字・ハイフン）",
    namePlaceholder: "例: react-reviewer",
    descLabel: "担当・役割（description）",
    descPlaceholder: "例: React コンポーネントのレビュー担当",
    toolsLabel: "使えるツール（カンマ区切り、空欄で全許可）",
    modelLabel: "モデル（空欄で inherit）",
    roleLabel: "役割定義（本文・システムプロンプト）",
    hire: "雇用する",
  },

  skills: {
    description: "~/.claude/skills/ のスキル。`.disabled` で無効化（内容は保持）。",
    newSkill: "＋ 新規 Skill",
    empty: "Skill はありません。",
    enabled: "有効",
    disabled: "無効",
    enable: "有効化",
    disable: "無効化",
  },

  skillEditor: {
    title: "Skill を作成",
    nameLabel: "名前（英小文字・数字・ハイフン）",
    namePlaceholder: "例: ship",
    descLabel: "説明（トリガー条件を含める）",
    toolsLabel: "allowed-tools（空白/カンマ区切り）",
    bodyLabel: "本文（手順・プロンプト）",
  },

  characterEditor: {
    target: "対象:",
    model: "モデル:",
    tools: "ツール",
    // 「色」の見出し。{note} は Agent 時の補足（空のこともある）。
    colorHeading: "色 ",
    colorAutoNote: "（Agentは役割ごとに自動）",
    bodyColor: "本体色",
    eyeColor: "目色",
    resetDefault: "デフォルトに戻す",
    clearAll: "全消去",
    toolErase: "消しゴム",
    toolBody: "本体",
    toolEye: "目",
    // 社員バリアント（model 未指定）の表示ラベル。
    variantCommon: "共通",
  },

  characterLog: {
    // {error} は失敗理由。
    fetchError: "ログの取得に失敗しました: {error}",
    empty: "記録された作業ログはありません。",
  },

  office: {
    unregistered: "登録なし",
    quietTitle: "いまタウンは静かです 🌙",
    quietBody:
      "ターミナルで Claude Code を動かすと、ここに Orchestrator が現れて働き始めます。",
  },

  roomMenu: {
    backToMenu: "‹ メニュー",
  },

  terminal: {
    notFound: "対象のターミナルが見つかりませんでした",
  },

  sprite: {
    // subagent_type 不明時のフォールバック名札。
    dispatchFallback: "派遣",
  },

  hookBeam: {
    noResponse: "応答なし",
  },

  todoChip: {
    // {total} は完了/総数（同値）。
    allDone: "✓ {total}/{total} 完了",
  },
} as const;
