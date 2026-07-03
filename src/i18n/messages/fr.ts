import type { Messages } from "../index";

/** Catalogue de messages en français. */
export const fr: Messages = {
  common: {
    close: "Fermer",
    cancel: "Annuler",
    save: "Enregistrer",
    saving: "Enregistrement…",
    create: "Créer",
    delete: "Supprimer",
    edit: "Modifier",
    // {scopes} est la liste des portées jointes par « · ».
    overrides: "Remplace {scopes}",
    // En lecture seule car provenant de {scope}.
    readOnlyFrom: "Lecture seule (depuis {scope}).",
  },

  nav: {
    office: "Ville",
    settings: "Paramètres",
  },

  app: {
    configError: "Erreur de chargement de la configuration : {error}",
  },

  scope: {
    user: "Utilisateur (~/.claude)",
    project: "Projet (.claude)",
    local: "Local (.local)",
    plugin: "Plugin",
  },

  /** WorkKind → étiquette de bulle dans la Ville (stateToVisual). */
  activityBubble: {
    Idle: "💤 Inactif",
    Thinking: "🤔 Réflexion",
    Reading: "📖 Lecture",
    Editing: "✍️ Édition",
    Running: "▶️ Exécution",
    Searching: "🔍 Recherche",
    Reviewing: "👀 Revue",
    Delegating: "📣 Instructions",
    WebExploring: "🌐 Recherche Web",
    AwaitingUser: "✋ En attente",
  },

  /** WorkKind → étiquette de ligne du journal (CharacterLogDialog). */
  activityLog: {
    Idle: "💤 Inactif",
    Thinking: "💭 Réflexion",
    Reading: "📖 Lecture",
    Editing: "✏️ Édition",
    Running: "⚙️ Exécution",
    Searching: "🔍 Recherche",
    Reviewing: "🔎 Revue",
    Delegating: "📨 Délégation",
    WebExploring: "🌐 Web",
    AwaitingUser: "⏳ En attente de saisie",
  },

  settings: {
    title: "Paramètres",
    subtitle:
      "Configurez l'affichage de l'écran de la Ville et l'apparence des personnages.",
    displaySection: "Affichage",
    showHookViz: "Afficher la visualisation des hooks (rails, faisceaux) dans la Ville",
    showToolNames: "Afficher le nom des outils dans le journal",
    characterEditor: "Éditeur de personnage",
    languageSection: "Langue",
    languageLabel: "Langue d'affichage",
  },

  update: {
    available: "Une nouvelle version {version} est disponible",
    updateNow: "Mettre à jour maintenant",
    later: "Plus tard",
    downloading: "Téléchargement de la mise à jour…",
    downloadingPct: "Téléchargement de la mise à jour… {percent}%",
    restarting: "Redémarrage pour appliquer la mise à jour…",
    section: "Mises à jour",
    currentVersion: "Version actuelle : {version}",
    checkNow: "Rechercher des mises à jour",
    checking: "Vérification…",
    upToDate: "Vous êtes à jour",
    checkError: "Échec de la vérification des mises à jour : {error}",
  },

  hooks: {
    description:
      "hooks de settings.json. Équivalent à la formation des Agent et aux règles métier. Appliqué immédiatement à l'enregistrement (les clés existantes sont préservées).",
    vizHint:
      "L'option d'affichage du déclenchement des hooks dans la Ville se trouve dans l'onglet « Paramètres ».",
    addTitle: "＋ Ajouter un hook",
    eventLabel: "Événement",
    matcherLabel: "matcher (expression régulière, vide pour tout correspondre)",
    matcherPlaceholder: "ex. : Edit|Write",
    commandLabel: "command (commande shell)",
    commandPlaceholder: 'ex. : npx prettier --write "$CLAUDE_FILE_PATH"',
    addAndSave: "Ajouter et enregistrer",
    unset: "Non défini",
    count: "{count} élément(s)",
    emptyTiming: "Aucun hook pour ce moment pour l'instant.",
    confirmDeleteTitle: "Supprimer ce hook ?",
    // Étiquette par défaut de la confirmation de suppression. {event} est le nom de l'événement.
    fallbackLabel: "hook de {event}",
  },

  hookDetail: {
    empty: "Aucun hook enregistré pour ce moment.",
  },

  metrics: {
    title: "Tableau de bord Metrics",
    subtitle:
      "Part de chaque Agent dans le travail global (part d'activité). Une faible part aide à juger si un Agent est « vraiment nécessaire ? ».",
    refresh: "Actualiser",
    aggregating: "Agrégation…",
    empty: "Aucune donnée agrégée pour l'instant.",
    orchestratorMain: "Orchestrator (principal)",
    rangeToday: "Aujourd'hui",
    range7d: "7 derniers jours",
    range30d: "30 derniers jours",
    colShare: "Part d'activité",
    colTime: "Temps d'activité",
    colCalls: "Appels",
    colTools: "Exécutions d'outils",
    colFailRate: "Taux d'échec",
    colTokensOut: "Jetons (out)",
    // Unité du temps d'activité ({n} est la valeur).
    unitSeconds: "{n} s",
    unitMinutes: "{n} min",
    unitHours: "{n} h",
  },

  agents: {
    description:
      "Définitions de rôle dans ~/.claude/agents/. Une fois appelés, ils arrivent dans la Ville pour travailler.",
    hire: "＋ Recruter",
    empty: "Aucun Agent pour l'instant. Créez votre premier Agent avec « Recruter ».",
  },

  agentDetail: {
    // {name} est le nom de l'Agent.
    confirmFire: "Licencier l'Agent « {name} » (supprimer sa définition) ?",
    origin: "Origine",
    description: "Description",
    model: "Modèle",
    color: "Couleur",
    file: "Fichier",
    shareToday: "Part d'activité du jour",
    callCount: "Nombre d'appels",
    failRate: "Taux d'échec",
    roleDef: "Définition du rôle",
    noBody: "(aucun contenu)",
    edit: "Modifier",
    fire: "Licencier",
  },

  agentEditor: {
    titleHire: "Recruter un Agent",
    // {name} est le nom de l'Agent en cours d'édition.
    titleEdit: "Modifier {name}",
    nameLabel: "Nom (minuscules, chiffres, tirets)",
    namePlaceholder: "ex. : react-reviewer",
    descLabel: "Mission / rôle (description)",
    descPlaceholder: "ex. : Chargé de la revue des composants React",
    toolsLabel: "Outils autorisés (séparés par des virgules, vide pour tout autoriser)",
    modelLabel: "Modèle (vide pour inherit)",
    roleLabel: "Définition du rôle (contenu / prompt système)",
    hire: "Recruter",
  },

  skills: {
    description:
      "Skills dans ~/.claude/skills/. Désactivés via `.disabled` (le contenu est conservé).",
    newSkill: "＋ Nouveau Skill",
    empty: "Aucun Skill.",
    enabled: "Activé",
    disabled: "Désactivé",
    enable: "Activer",
    disable: "Désactiver",
  },

  skillEditor: {
    title: "Créer un Skill",
    nameLabel: "Nom (minuscules, chiffres, tirets)",
    namePlaceholder: "ex. : ship",
    descLabel: "Description (inclure les conditions de déclenchement)",
    toolsLabel: "allowed-tools (séparés par des espaces/virgules)",
    bodyLabel: "Contenu (procédure / prompt)",
  },

  characterEditor: {
    target: "Cible :",
    model: "Modèle :",
    tools: "Outils",
    // Titre « Couleur ». {note} est une note pour les Agent (parfois vide).
    colorHeading: "Couleur ",
    colorAutoNote: "(automatique pour les Agent selon le rôle)",
    bodyColor: "Couleur du corps",
    eyeColor: "Couleur des yeux",
    resetDefault: "Réinitialiser",
    clearAll: "Tout effacer",
    toolErase: "Gomme",
    toolBody: "Corps",
    toolEye: "Yeux",
    // Étiquette de la variante employé (modèle non spécifié).
    variantCommon: "Commun",
  },

  characterLog: {
    // {error} est la raison de l'échec.
    fetchError: "Échec de la récupération du journal : {error}",
    empty: "Aucun journal d'activité enregistré.",
  },

  office: {
    unregistered: "Non enregistré",
    quietTitle: "La Ville est calme pour l'instant 🌙",
    quietBody:
      "Lancez Claude Code dans votre terminal et l'Orchestrator apparaîtra ici pour se mettre au travail.",
  },

  roomMenu: {
    backToMenu: "‹ Menu",
  },

  terminal: {
    notFound: "Terminal introuvable pour cette session",
  },

  sprite: {
    // Étiquette de repli quand subagent_type est inconnu.
    dispatchFallback: "Envoi",
  },

  hookBeam: {
    noResponse: "Aucune réponse",
  },

  todoChip: {
    // {total} est terminés/total (valeur identique).
    allDone: "✓ {total}/{total} terminés",
  },
} as const;
