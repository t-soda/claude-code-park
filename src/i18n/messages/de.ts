import type { Messages } from "../index";

/** Deutscher Nachrichtenkatalog. */
export const de: Messages = {
  common: {
    close: "Schließen",
    cancel: "Abbrechen",
    save: "Speichern",
    saving: "Wird gespeichert…",
    create: "Erstellen",
    delete: "Löschen",
    edit: "Bearbeiten",
    // {scopes} ist die mit „·“ verknüpfte Liste der Scope-Namen.
    overrides: "Überschreibt {scopes}",
    // Schreibgeschützt, da von {scope} stammend.
    readOnlyFrom: "Schreibgeschützt (aus {scope}).",
  },

  nav: {
    office: "Stadt",
    settings: "Einstellungen",
  },

  app: {
    configError: "Fehler beim Laden der Einstellungen: {error}",
  },

  scope: {
    user: "Benutzer (~/.claude)",
    project: "Projekt (.claude)",
    local: "Lokal (.local)",
    plugin: "Plugin",
  },

  /** WorkKind → Sprechblasen-Label in der Stadt (stateToVisual). */
  activityBubble: {
    Idle: "💤 Leerlauf",
    Thinking: "🤔 Denkt nach",
    Reading: "📖 Liest",
    Editing: "✍️ Bearbeitet",
    Running: "▶️ Führt aus",
    Searching: "🔍 Sucht",
    Reviewing: "👀 Prüft",
    Delegating: "📣 Weist an",
    WebExploring: "🌐 Web-Recherche",
    AwaitingUser: "✋ Wartet auf Bestätigung",
  },

  /** WorkKind → Zeilen-Label im Log-Dialog (CharacterLogDialog). */
  activityLog: {
    Idle: "💤 Leerlauf",
    Thinking: "💭 Denken",
    Reading: "📖 Lesen",
    Editing: "✏️ Bearbeiten",
    Running: "⚙️ Ausführen",
    Searching: "🔍 Suchen",
    Reviewing: "🔎 Prüfen",
    Delegating: "📨 Delegieren",
    WebExploring: "🌐 Web",
    AwaitingUser: "⏳ Wartet auf Eingabe",
  },

  settings: {
    title: "Einstellungen",
    subtitle: "Konfiguriere die Anzeige der Stadt-Ansicht und das Aussehen der Charaktere.",
    displaySection: "Anzeigeeinstellungen",
    showHookViz: "hook-Visualisierung (Schienen, Auslöse-Strahlen) in der Stadt anzeigen",
    showToolNames: "Werkzeugnamen im Log anzeigen",
    showTrayIcon: "Symbol in der Menüleiste anzeigen",
    characterEditor: "Charakter-Editor",
    languageSection: "Sprache",
    languageLabel: "Anzeigesprache",
  },

  update: {
    available: "Eine neue Version {version} ist verfügbar",
    updateNow: "Jetzt aktualisieren",
    later: "Später",
    downloading: "Update wird heruntergeladen…",
    downloadingPct: "Update wird heruntergeladen… {percent}%",
    restarting: "Neustart, um das Update anzuwenden…",
    section: "Updates",
    currentVersion: "Aktuelle Version: {version}",
    checkNow: "Nach Updates suchen",
    checking: "Wird geprüft…",
    upToDate: "Du bist auf dem neuesten Stand",
    checkError: "Update-Prüfung fehlgeschlagen: {error}",
  },

  hooks: {
    description:
      "hooks in settings.json. Entspricht Agent-Schulung und Geschäftsregeln. Wird beim Speichern sofort übernommen (vorhandene Schlüssel bleiben erhalten).",
    vizHint: "Die Stadt-Anzeige für hook-Auslösungen kannst du im Tab „Einstellungen“ umschalten.",
    addTitle: "＋ Hook hinzufügen",
    eventLabel: "Ereignis",
    matcherLabel: "matcher (regulärer Ausdruck, leer = alles)",
    matcherPlaceholder: "z. B. Edit|Write",
    commandLabel: "command (Shell-Befehl)",
    commandPlaceholder: 'z. B. npx prettier --write "$CLAUDE_FILE_PATH"',
    addAndSave: "Hinzufügen und speichern",
    unset: "Nicht gesetzt",
    count: "{count} Stück",
    emptyTiming: "Für diesen Zeitpunkt gibt es noch keine hooks.",
    confirmDeleteTitle: "hook löschen?",
    // Standard-Label der Löschbestätigung. {event} ist der Ereignisname.
    fallbackLabel: "hook für {event}",
  },

  hookDetail: {
    empty: "Für diesen Zeitpunkt sind keine hooks registriert.",
  },

  metrics: {
    title: "Metrics-Dashboard",
    subtitle:
      "Anteil jedes Agents an der Gesamtarbeit (Arbeitsanteil). Ein geringer Anteil hilft bei der Entscheidung, ob ein Agent „wirklich nötig“ ist.",
    refresh: "Aktualisieren",
    aggregating: "Wird ausgewertet…",
    empty: "Noch keine ausgewerteten Daten vorhanden.",
    orchestratorMain: "Orchestrator (Haupt)",
    rangeToday: "Heute",
    range7d: "Letzte 7 Tage",
    range30d: "Letzte 30 Tage",
    colShare: "Arbeitsanteil",
    colTime: "Arbeitszeit",
    colCalls: "Aufrufe",
    colTools: "Werkzeugausführungen",
    colFailRate: "Fehlerrate",
    colTokensOut: "Tokens (out)",
    // Einheit der Arbeitszeit ({n} ist der Zahlenwert).
    unitSeconds: "{n} Sek.",
    unitMinutes: "{n} Min.",
    unitHours: "{n} Std.",
  },

  agents: {
    description: "Rollendefinitionen in ~/.claude/agents/. Bei Aufruf erscheinen sie in der Stadt und arbeiten.",
    hire: "＋ Einstellen",
    empty: "Noch keine Agents. Erstelle deinen ersten Agent über „Einstellen“.",
  },

  agentDetail: {
    // {name} ist der Agent-Name.
    confirmFire: "Agent „{name}“ entlassen (Definition löschen)?",
    origin: "Herkunft",
    description: "Beschreibung",
    model: "Modell",
    color: "Farbe",
    file: "Datei",
    shareToday: "Heutiger Arbeitsanteil",
    callCount: "Anzahl Aufrufe",
    failRate: "Fehlerrate",
    roleDef: "Rollendefinition",
    noBody: "(kein Inhalt)",
    edit: "Bearbeiten",
    fire: "Entlassen",
  },

  agentEditor: {
    titleHire: "Agent einstellen",
    // {name} ist der zu bearbeitende Agent-Name.
    titleEdit: "{name} bearbeiten",
    nameLabel: "Name (Kleinbuchstaben, Ziffern, Bindestrich)",
    namePlaceholder: "z. B. react-reviewer",
    descLabel: "Zuständigkeit/Rolle (description)",
    descPlaceholder: "z. B. Zuständig für die Prüfung von React-Komponenten",
    toolsLabel: "Verfügbare Werkzeuge (durch Komma getrennt, leer = alle erlaubt)",
    modelLabel: "Modell (leer = inherit)",
    roleLabel: "Rollendefinition (Inhalt, System-Prompt)",
    hire: "Einstellen",
  },

  skills: {
    description: "Skills in ~/.claude/skills/. Mit `.disabled` deaktivieren (Inhalt bleibt erhalten).",
    newSkill: "＋ Neuer Skill",
    empty: "Keine Skills vorhanden.",
    enabled: "Aktiv",
    disabled: "Inaktiv",
    enable: "Aktivieren",
    disable: "Deaktivieren",
  },

  skillEditor: {
    title: "Skill erstellen",
    nameLabel: "Name (Kleinbuchstaben, Ziffern, Bindestrich)",
    namePlaceholder: "z. B. ship",
    descLabel: "Beschreibung (Auslösebedingungen einschließen)",
    toolsLabel: "allowed-tools (durch Leerzeichen/Komma getrennt)",
    bodyLabel: "Inhalt (Schritte, Prompt)",
  },

  characterEditor: {
    target: "Ziel:",
    model: "Modell:",
    tools: "Werkzeuge",
    // Überschrift „Farbe“. {note} ist eine Ergänzung bei Agents (kann leer sein).
    colorHeading: "Farbe ",
    colorAutoNote: "(bei Agents automatisch je Rolle)",
    bodyColor: "Körperfarbe",
    eyeColor: "Augenfarbe",
    resetDefault: "Auf Standard zurücksetzen",
    clearAll: "Alles löschen",
    toolErase: "Radiergummi",
    toolBody: "Körper",
    toolEye: "Augen",
    // Anzeige-Label der Mitarbeiter-Variante (model nicht angegeben).
    variantCommon: "Gemeinsam",
  },

  characterLog: {
    // {error} ist der Fehlergrund.
    fetchError: "Log konnte nicht abgerufen werden: {error}",
    empty: "Keine Arbeitslogs aufgezeichnet.",
  },

  office: {
    unregistered: "Nicht registriert",
    quietTitle: "In der Stadt ist es gerade ruhig 🌙",
    quietBody:
      "Führe Claude Code im Terminal aus, dann erscheint hier der Orchestrator und beginnt zu arbeiten.",
  },

  replay: {
    title: "Wiedergabe",
    subtitle:
      "Sitzungen in der Stadt wiedergeben. Bei einer laufenden Sitzung siehst du, was bisher geschah; bei einer beendeten die ganze Geschichte — in deinem Tempo.",
    browser: {
      empty: "Keine Sitzungen zum Abspielen (Anzeige der letzten 31 Tage).",
      fetchError: "Sitzungsliste konnte nicht geladen werden: {error}",
      statusActive: "Aktiv",
      statusIdle: "Inaktiv",
    },
    player: {
      back: "Zur Liste",
      play: "Abspielen",
      pause: "Pause",
      follow: "▼ Folgen",
      railsNote: "Hook-Schienen zeigen die aktuelle Konfiguration (keine Aufzeichnung der Sitzung)",
      loadError: "Wiedergabe konnte nicht geladen werden: {error}",
    },
    log: {
      title: "Ereignisprotokoll",
      sessionStart: "🏢 Sitzungsstart",
      userPrompt: "🧑‍💻 Prompt",
      turnEnd: "🏁 Zugende",
      subagentSpawn: "📣 Subagent gestartet",
      subagentStop: "👋 Subagent beendet",
    },
  },

  roomMenu: {
    backToMenu: "‹ Menü",
  },

  terminal: {
    notFound: "Terminal für diese Sitzung nicht gefunden",
  },

  sprite: {
    // Fallback-Namensschild, wenn subagent_type unbekannt ist.
    dispatchFallback: "Entsandt",
  },

  hookBeam: {
    noResponse: "Keine Antwort",
  },

  todoChip: {
    // {total} ist erledigt/gesamt (gleicher Wert).
    allDone: "✓ {total}/{total} erledigt",
  },
} as const;
