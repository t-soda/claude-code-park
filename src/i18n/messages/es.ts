import type { Messages } from "../index";

/** Catálogo de mensajes en español. */
export const es: Messages = {
  common: {
    close: "Cerrar",
    cancel: "Cancelar",
    save: "Guardar",
    saving: "Guardando…",
    create: "Crear",
    delete: "Eliminar",
    edit: "Editar",
    // {scopes} es el nombre de los ámbitos concatenados con «・».
    overrides: "Anula {scopes}",
    // De solo lectura por provenir de {scope}.
    readOnlyFrom: "Solo lectura (de {scope}).",
  },

  nav: {
    office: "Pueblo",
    settings: "Configuración",
  },

  app: {
    configError: "Error al cargar la configuración: {error}",
  },

  scope: {
    user: "Usuario (~/.claude)",
    project: "Proyecto (.claude)",
    local: "Local (.local)",
    plugin: "Plugin",
  },

  /** WorkKind → etiqueta de globo en el Pueblo (stateToVisual). */
  activityBubble: {
    Idle: "💤 Inactivo",
    Thinking: "🤔 Pensando",
    Reading: "📖 Leyendo",
    Editing: "✍️ Editando",
    Running: "▶️ Ejecutando",
    Searching: "🔍 Buscando",
    Reviewing: "👀 Revisando",
    Delegating: "📣 Instruyendo",
    WebExploring: "🌐 Explorando web",
    AwaitingUser: "✋ Esperando confirmación",
  },

  /** WorkKind → etiqueta de fila del diálogo de registro (CharacterLogDialog). */
  activityLog: {
    Idle: "💤 Inactivo",
    Thinking: "💭 Pensando",
    Reading: "📖 Lectura",
    Editing: "✏️ Edición",
    Running: "⚙️ Ejecución",
    Searching: "🔍 Búsqueda",
    Reviewing: "🔎 Revisión",
    Delegating: "📨 Delegación",
    WebExploring: "🌐 Web",
    AwaitingUser: "⏳ Esperando entrada",
  },

  settings: {
    title: "Configuración",
    subtitle:
      "Configura la presentación de la pantalla del Pueblo y el aspecto de los personajes.",
    displaySection: "Ajustes de visualización",
    showHookViz:
      "Mostrar la visualización de hooks (raíles y haces de disparo) en el Pueblo",
    showDelegationLines: "Mostrar las líneas de delegación entre subagentes en el Pueblo",
    showToolNames: "Mostrar el nombre de las herramientas en el registro",
    showTrayIcon: "Mostrar el icono en la barra de menús",
    characterEditor: "Editor de personajes",
    languageSection: "Idioma",
    languageLabel: "Idioma de visualización",
  },

  update: {
    available: "Hay una nueva versión {version} disponible",
    updateNow: "Actualizar ahora",
    later: "Más tarde",
    downloading: "Descargando la actualización…",
    downloadingPct: "Descargando la actualización… {percent}%",
    restarting: "Reiniciando para aplicar la actualización…",
    section: "Actualizaciones",
    currentVersion: "Versión actual: {version}",
    checkNow: "Buscar actualizaciones",
    checking: "Comprobando…",
    upToDate: "Estás al día",
    checkError: "No se pudo comprobar si hay actualizaciones: {error}",
  },

  hooks: {
    description:
      "Hooks de settings.json. Equivalen a la formación del Agent y a las reglas de trabajo. Se aplican al guardar (las claves existentes se conservan).",
    vizHint:
      "El interruptor de la visualización de disparos de hook en el Pueblo está en la pestaña «Configuración».",
    addTitle: "＋ Añadir hook",
    eventLabel: "Evento",
    matcherLabel: "matcher (expresión regular, vacío para coincidir con todo)",
    matcherPlaceholder: "Ej.: Edit|Write",
    commandLabel: "command (comando de shell)",
    commandPlaceholder: 'Ej.: npx prettier --write "$CLAUDE_FILE_PATH"',
    addAndSave: "Añadir y guardar",
    unset: "Sin definir",
    count: "{count}",
    emptyTiming: "Aún no hay hooks para este momento.",
    confirmDeleteTitle: "¿Eliminar el hook?",
    // Etiqueta predeterminada de la confirmación de borrado. {event} es el nombre del evento.
    fallbackLabel: "hook de {event}",
  },

  hookDetail: {
    empty: "No hay ningún hook registrado para este momento.",
  },

  metrics: {
    title: "Panel de Metrics",
    subtitle:
      "Proporción de cada Agent en el trabajo total (cuota de actividad). Una cuota baja ayuda a decidir si un Agent es «¿realmente necesario?».",
    refresh: "Actualizar",
    aggregating: "Agregando…",
    empty: "Aún no hay datos agregados.",
    orchestratorMain: "Orchestrator (principal)",
    rangeToday: "Hoy",
    range7d: "Últimos 7 días",
    range30d: "Últimos 30 días",
    colShare: "Cuota de actividad",
    colTime: "Tiempo de actividad",
    colCalls: "Llamadas",
    colTools: "Ejecuciones de herramientas",
    colFailRate: "Tasa de fallos",
    colTokensOut: "Tokens (out)",
    // Unidad del tiempo de actividad ({n} es un número).
    unitSeconds: "{n} s",
    unitMinutes: "{n} min",
    unitHours: "{n} h",
  },

  agents: {
    description:
      "Definiciones de roles en ~/.claude/agents/. Cuando se les llama, acuden al Pueblo a trabajar.",
    hire: "＋ Contratar",
    empty:
      "Aún no hay ningún Agent. Crea el primero con «Contratar».",
  },

  agentDetail: {
    // {name} es el nombre del Agent.
    confirmFire: "¿Despedir al Agent «{name}» (eliminar su definición)?",
    origin: "Origen",
    description: "Descripción",
    model: "Modelo",
    color: "Color",
    file: "Archivo",
    shareToday: "Cuota de actividad de hoy",
    callCount: "Número de llamadas",
    failRate: "Tasa de fallos",
    roleDef: "Definición del rol",
    noBody: "(sin contenido)",
    edit: "Editar",
    fire: "Despedir",
  },

  agentEditor: {
    titleHire: "Contratar un Agent",
    // {name} es el nombre del Agent que se está editando.
    titleEdit: "Editar {name}",
    nameLabel: "Nombre (minúsculas, números y guiones)",
    namePlaceholder: "Ej.: react-reviewer",
    descLabel: "Responsabilidad y rol (description)",
    descPlaceholder: "Ej.: Encargado de revisar componentes de React",
    toolsLabel:
      "Herramientas disponibles (separadas por comas, vacío para permitir todas)",
    modelLabel: "Modelo (vacío para inherit)",
    roleLabel: "Definición del rol (contenido, prompt de sistema)",
    hire: "Contratar",
  },

  skills: {
    description:
      "Skills de ~/.claude/skills/. Se desactivan con `.disabled` (el contenido se conserva).",
    newSkill: "＋ Nuevo Skill",
    empty: "No hay ningún Skill.",
    enabled: "Activado",
    disabled: "Desactivado",
    enable: "Activar",
    disable: "Desactivar",
  },

  skillEditor: {
    title: "Crear un Skill",
    nameLabel: "Nombre (minúsculas, números y guiones)",
    namePlaceholder: "Ej.: ship",
    descLabel: "Descripción (incluye las condiciones de activación)",
    toolsLabel: "allowed-tools (separados por espacios o comas)",
    bodyLabel: "Contenido (pasos, prompt)",
  },

  characterEditor: {
    target: "Objetivo:",
    model: "Modelo:",
    tools: "Herramientas",
    // Encabezado «Color». {note} es la nota adicional para los Agent (a veces vacía).
    colorHeading: "Color ",
    colorAutoNote: "(automático para cada rol de Agent)",
    bodyColor: "Color del cuerpo",
    eyeColor: "Color de los ojos",
    resetDefault: "Restablecer valores predeterminados",
    clearAll: "Borrar todo",
    toolErase: "Goma de borrar",
    toolBody: "Cuerpo",
    toolEye: "Ojos",
    // Etiqueta de la variante de empleado (sin model especificado).
    variantCommon: "Común",
  },

  characterLog: {
    // {error} es el motivo del fallo.
    fetchError: "No se pudo obtener el registro: {error}",
    empty: "No hay ningún registro de trabajo.",
    // Etiqueta para una fila en la que se bloqueó el propio ciclo de vida Stop/SubagentStop, no una herramienta específica.
    blockedStop: "Hook de Stop bloqueado",
  },

  office: {
    unregistered: "Sin registrar",
    orchestrator: "Orchestrator",
    delegatedBy: "Llamado por: {name}",
    delegatesTo: "Llama a: {name}",
    quietTitle: "El Pueblo está tranquilo ahora 🌙",
    quietBody:
      "Ejecuta Claude Code en tu terminal y aquí aparecerá el Orchestrator que empezará a trabajar.",
  },

  replay: {
    title: "Repetición",
    subtitle:
      "Reproduce sesiones en el pueblo. De una en curso, ve lo que ha hecho hasta ahora; de una terminada, la historia completa, a tu ritmo.",
    browser: {
      empty: "No hay sesiones para reproducir (se muestran los últimos 31 días).",
      fetchError: "No se pudo obtener la lista de sesiones: {error}",
      statusActive: "En curso",
      statusIdle: "Inactiva",
    },
    player: {
      back: "Volver a la lista",
      play: "Reproducir",
      pause: "Pausa",
      follow: "▼ Seguir",
      railsNote: "Los raíles de hooks muestran la configuración actual (no una grabación de la sesión)",
      loadError: "No se pudo cargar la repetición: {error}",
    },
    log: {
      title: "Registro de eventos",
      sessionStart: "🏢 Inicio de sesión",
      userPrompt: "🧑‍💻 Prompt",
      turnEnd: "🏁 Fin del turno",
      subagentSpawn: "📣 Subagente iniciado",
      subagentStop: "👋 Subagente terminado",
    },
  },

  roomMenu: {
    backToMenu: "‹ Menú",
  },

  terminal: {
    notFound: "No se encontró la terminal de esta sesión",
  },

  sprite: {
    // Etiqueta alternativa cuando se desconoce el subagent_type.
    dispatchFallback: "Despacho",
  },

  hookBeam: {
    noResponse: "Sin respuesta",
    blocked: "Bloqueado por el hook",
  },

  todoChip: {
    // {total} es completados/total (mismo valor).
    allDone: "✓ {total}/{total} completados",
  },
} as const;
