import type { Messages } from "../index";

/** 한국어 메시지 카탈로그. */
export const ko: Messages = {
  common: {
    close: "닫기",
    cancel: "취소",
    save: "저장",
    saving: "저장 중…",
    create: "생성",
    delete: "삭제",
    edit: "편집",
    // {scopes} 는 「・」로 연결된 스코프 이름.
    overrides: "{scopes} 재정의",
    // {scope} 출처이므로 읽기 전용, 의 의미.
    readOnlyFrom: "{scope} 출처이므로 읽기 전용입니다.",
  },

  nav: {
    office: "타운",
    settings: "설정",
  },

  app: {
    configError: "설정 로딩 오류: {error}",
  },

  scope: {
    user: "사용자 (~/.claude)",
    project: "프로젝트 (.claude)",
    local: "로컬 (.local)",
    plugin: "플러그인",
  },

  /** WorkKind → 타운 위 말풍선 라벨(stateToVisual). */
  activityBubble: {
    Idle: "💤 대기",
    Thinking: "🤔 생각 중",
    Reading: "📖 읽는 중",
    Editing: "✍️ 편집 중",
    Running: "▶️ 실행 중",
    Searching: "🔍 검색 중",
    Reviewing: "👀 리뷰",
    Delegating: "📣 지시 중",
    WebExploring: "🌐 Web 조사",
    AwaitingUser: "✋ 확인 대기",
  },

  /** WorkKind → 로그 다이얼로그 행 라벨(CharacterLogDialog). */
  activityLog: {
    Idle: "💤 대기",
    Thinking: "💭 생각",
    Reading: "📖 읽기",
    Editing: "✏️ 편집",
    Running: "⚙️ 실행",
    Searching: "🔍 검색",
    Reviewing: "🔎 리뷰",
    Delegating: "📨 위임",
    WebExploring: "🌐 Web",
    AwaitingUser: "⏳ 입력 대기",
  },

  settings: {
    title: "설정",
    subtitle: "타운 화면의 표시 관련 설정과 캐릭터 외형을 설정합니다.",
    displaySection: "표시 설정",
    showHookViz: "hook 시각화(레일・발화 빔)를 타운에 표시",
    showToolNames: "로그에 도구 이름 표시",
    showTrayIcon: "메뉴 막대에 아이콘 표시",
    characterEditor: "캐릭터 에디터",
    languageSection: "언어",
    languageLabel: "표시 언어",
  },

  update: {
    available: "새 버전 {version}을(를) 사용할 수 있습니다",
    updateNow: "지금 업데이트",
    later: "나중에",
    downloading: "업데이트 다운로드 중…",
    downloadingPct: "업데이트 다운로드 중… {percent}%",
    restarting: "업데이트 적용을 위해 다시 시작합니다…",
    section: "업데이트",
    currentVersion: "현재 버전: {version}",
    checkNow: "업데이트 확인",
    checking: "확인 중…",
    upToDate: "최신 버전입니다",
    checkError: "업데이트 확인에 실패했습니다: {error}",
  },

  hooks: {
    description:
      "settings.json 의 hooks. Agent 교육・업무 규칙에 해당. 저장하면 즉시 반영(기존 키는 보존).",
    vizHint: "hook 발화의 타운 표시 전환은 「설정」 탭에 있습니다.",
    addTitle: "＋ Hook 추가",
    eventLabel: "이벤트",
    matcherLabel: "matcher(정규식, 비우면 전체 매칭)",
    matcherPlaceholder: "예: Edit|Write",
    commandLabel: "command(셸 명령어)",
    commandPlaceholder: '예: npx prettier --write "$CLAUDE_FILE_PATH"',
    addAndSave: "추가하고 저장",
    unset: "미설정",
    count: "{count} 건",
    emptyTiming: "이 타이밍의 hook 은 아직 없습니다.",
    confirmDeleteTitle: "hook 을 삭제하시겠습니까?",
    // 삭제 확인의 기본 라벨. {event} 는 대상 이벤트 이름.
    fallbackLabel: "{event} 의 hook",
  },

  hookDetail: {
    empty: "이 타이밍에 등록된 hook 은 없습니다.",
  },

  metrics: {
    title: "Metrics 대시보드",
    subtitle:
      "전체 작업에서 각 Agent 가 차지하는 비율(가동 점유율). 점유율이 낮은 Agent 는 「정말 필요한가?」 판단 자료로.",
    refresh: "새로고침",
    aggregating: "집계 중…",
    empty: "아직 집계 데이터가 없습니다.",
    orchestratorMain: "Orchestrator(메인)",
    rangeToday: "오늘",
    range7d: "최근 7일",
    range30d: "최근 30일",
    colShare: "가동 점유율",
    colTime: "가동 시간",
    colCalls: "호출",
    colTools: "도구 실행",
    colFailRate: "실패율",
    colTokensOut: "토큰(out)",
    // 가동 시간의 단위({n} 은 숫자).
    unitSeconds: "{n}초",
    unitMinutes: "{n}분",
    unitHours: "{n}시간",
  },

  agents: {
    description: "~/.claude/agents/ 의 역할 정의. 호출되면 타운에 출근해 일합니다.",
    hire: "＋ 고용하기",
    empty: "아직 Agent 가 없습니다. 「고용하기」로 첫 Agent 를 만들어 보세요.",
  },

  agentDetail: {
    // {name} 은 Agent 이름.
    confirmFire: "Agent「{name}」를 해고(정의 삭제)하시겠습니까?",
    origin: "출처",
    description: "설명",
    model: "모델",
    color: "색상",
    file: "파일",
    shareToday: "오늘의 가동 점유율",
    callCount: "호출 횟수",
    failRate: "실패율",
    roleDef: "역할 정의",
    noBody: "(본문 없음)",
    edit: "편집",
    fire: "해고",
  },

  agentEditor: {
    titleHire: "Agent 고용",
    // {name} 은 편집 대상 Agent 이름.
    titleEdit: "{name} 편집",
    nameLabel: "이름(영소문자・숫자・하이픈)",
    namePlaceholder: "예: react-reviewer",
    descLabel: "담당・역할(description)",
    descPlaceholder: "예: React 컴포넌트 리뷰 담당",
    toolsLabel: "사용 가능한 도구(쉼표 구분, 비우면 전체 허용)",
    modelLabel: "모델(비우면 inherit)",
    roleLabel: "역할 정의(본문・시스템 프롬프트)",
    hire: "고용하기",
  },

  skills: {
    description: "~/.claude/skills/ 의 스킬. `.disabled` 로 비활성화(내용은 유지).",
    newSkill: "＋ 새 Skill",
    empty: "Skill 이 없습니다.",
    enabled: "활성",
    disabled: "비활성",
    enable: "활성화",
    disable: "비활성화",
  },

  skillEditor: {
    title: "Skill 생성",
    nameLabel: "이름(영소문자・숫자・하이픈)",
    namePlaceholder: "예: ship",
    descLabel: "설명(트리거 조건 포함)",
    toolsLabel: "allowed-tools(공백/쉼표 구분)",
    bodyLabel: "본문(절차・프롬프트)",
  },

  characterEditor: {
    target: "대상:",
    model: "모델:",
    tools: "도구",
    // 「색상」 의 제목. {note} 는 Agent 일 때의 보충(비어 있을 수도 있음).
    colorHeading: "색상 ",
    colorAutoNote: "(Agent 는 역할별로 자동)",
    bodyColor: "본체 색",
    eyeColor: "눈 색",
    resetDefault: "기본값으로 되돌리기",
    clearAll: "전체 지우기",
    toolErase: "지우개",
    toolBody: "본체",
    toolEye: "눈",
    // 사원 변형(model 미지정)의 표시 라벨.
    variantCommon: "공통",
  },

  characterLog: {
    // {error} 는 실패 이유.
    fetchError: "로그 가져오기에 실패했습니다: {error}",
    empty: "기록된 작업 로그가 없습니다.",
  },

  office: {
    unregistered: "등록 없음",
    quietTitle: "지금 타운은 조용합니다 🌙",
    quietBody:
      "터미널에서 Claude Code를 실행하면 여기에 Orchestrator가 나타나 일을 시작합니다.",
  },

  replay: {
    title: "리플레이",
    subtitle: "세션을 타운에서 재생합니다. 실행 중인 세션은 지금까지의 동작을, 종료된 세션은 전체 과정을 천천히 되짚어 볼 수 있습니다.",
    browser: {
      empty: "재생할 수 있는 세션이 없습니다(최근 31일 표시).",
      fetchError: "세션 목록을 가져오지 못했습니다: {error}",
      statusActive: "실행 중",
      statusIdle: "대기 중",
    },
    player: {
      back: "목록으로",
      play: "재생",
      pause: "일시정지",
      follow: "▼ 따라가기",
      railsNote: "hook 레일은 현재 설정을 표시합니다(세션 당시의 기록이 아닙니다)",
      loadError: "리플레이를 불러오지 못했습니다: {error}",
    },
    log: {
      title: "이벤트 로그",
      sessionStart: "🏢 세션 시작",
      userPrompt: "🧑‍💻 프롬프트",
      turnEnd: "🏁 턴 종료",
      subagentSpawn: "📣 서브에이전트 시작",
      subagentStop: "👋 서브에이전트 종료",
    },
  },

  roomMenu: {
    backToMenu: "‹ 메뉴",
  },

  terminal: {
    notFound: "이 세션의 터미널을 찾을 수 없습니다",
  },

  sprite: {
    // subagent_type 불명 시의 폴백 명찰.
    dispatchFallback: "파견",
  },

  hookBeam: {
    noResponse: "응답 없음",
  },

  todoChip: {
    // {total} 은 완료/총수(동일 값).
    allDone: "✓ {total}/{total} 완료",
  },
} as const;
