// Interface texts in Italian and English. Each phone picks its own language (stored locally).
// Values are strings or functions of the parameters.

import { withDefaults } from "./game.js";

export const LANGS = ["it", "en"];

const ROLE_NAMES = {
  it: {
    wolf: ["Lupo", "Lupi"], seer: ["Veggente", "Veggenti"], magician: ["Mago", "Maghi"],
    medium: ["Medium", "Medium"], mason: ["Massone", "Massoni"], prole: ["Prole", "Prole"], citizen: ["Cittadino", "Cittadini"],
  },
  en: {
    wolf: ["Wolf", "Wolves"], seer: ["Seer", "Seers"], magician: ["Magician", "Magicians"],
    medium: ["Medium", "Mediums"], mason: ["Mason", "Masons"], prole: ["Cursed", "Cursed"], citizen: ["Citizen", "Citizens"],
  },
};

/** Role description for the player's card, following the room's rules. */
const ROLE_DESC = {
  it: {
    wolf: (r) => `Ogni notte i lupi scelgono insieme un giocatore da uccidere${r.firstNightKill ? "" : " (la prima notte vi riconoscete soltanto)"}. `
      + `Vincete quando i lupi sono ${r.wolvesWin === "majority" ? "più" : "tanti quanti"} degli altri.`,
    seer: (r) => `${r.seerUses === "once" ? "Una sola volta per partita, nella notte che scegli tu," : "Ogni notte"} indichi un giocatore e scopri ${r.seerSees === "role" ? "il suo ruolo esatto" : "se è un lupo oppure no"}.`,
    magician: (r) => `Ogni notte proteggi la casa di un giocatore${r.magicianSelf ? " (anche la tua)" : " (non la tua)"}: nessuno al suo interno può essere ucciso quella notte.`
      + (r.magicianRepeat ? "" : " Non puoi proteggere la stessa casa due notti di fila."),
    medium: (r) => "Ogni notte vai a casa di un altro giocatore. Se i lupi attaccano quella casa, muori tu al suo posto. "
      + (r.mediumAwayDies ? "Se attaccano casa tua mentre sei fuori, muori comunque." : "Se attaccano casa tua mentre sei fuori, ti salvi."),
    mason: () => "Sei un massone: conosci gli altri massoni e loro conoscono te. Siete abitanti del villaggio: aiutatevi a scoprire i lupi.",
    prole: (r) => "Sembri un semplice abitante del villaggio, ma se i lupi ti attaccano non muori: diventi uno di loro e da quel momento giochi con il branco."
      + (r.proleKnows ? "" : " In questa partita la Prole non sa di esserlo: il suo telefono mostra Cittadino finché non viene morsa.")
      + (r.seerSeesProle === "wolf" ? " Il veggente ti vede già come un lupo." : ""),
    citizen: () => "Sei un semplice abitante del villaggio. Di giorno discuti e vota per scoprire ed eliminare i lupi.",
  },
  en: {
    wolf: (r) => `Each night the wolves agree on a player to kill${r.firstNightKill ? "" : " (on the first night you only recognise each other)"}. `
      + `You win when the wolves are ${r.wolvesWin === "majority" ? "more than" : "as many as"} the others.`,
    seer: (r) => `${r.seerUses === "once" ? "Once per game, on the night you choose," : "Each night"} you point at a player and learn ${r.seerSees === "role" ? "their exact role" : "whether they are a wolf"}.`,
    magician: (r) => `Each night you protect a player's house${r.magicianSelf ? " (yours too)" : " (not your own)"}: nobody in it can be killed that night.`
      + (r.magicianRepeat ? "" : " You can't protect the same house two nights in a row."),
    medium: (r) => "Each night you visit another player's house. If the wolves attack it, you die in their place. "
      + (r.mediumAwayDies ? "If they attack your own house while you are away, you die anyway." : "If they attack your own house while you are away, you survive."),
    mason: () => "You are a mason: you know the other masons and they know you. You're on the village's side: help each other find the wolves.",
    prole: (r) => "You look like an ordinary villager, but if the wolves attack you, you don't die: you become one of them and from then on you play with the pack."
      + (r.proleKnows ? "" : " In this game the Cursed doesn't know it: their phone shows Citizen until they are bitten.")
      + (r.seerSeesProle === "wolf" ? " The seer already sees you as a wolf." : ""),
    citizen: () => "You are an ordinary villager. During the day, discuss and vote to find and eliminate the wolves.",
  },
};

/** Longer notes for the rules guide. */
const ROLE_INFO = {
  it: {
    wolf: "Di notte i lupi si riconoscono e si accordano su una vittima: devono essere tutti d'accordo. Di giorno fingono di essere innocenti.",
    seer: "Una volta scelto il giocatore, la visione non si può cambiare. Usa ciò che scopri per guidare il villaggio, ma se i lupi capiscono chi sei, sarai il loro prossimo bersaglio.",
    magician: "La protezione vale per tutta la casa: se il medium è in visita lì, è salvo anche lui.",
    medium: "Non puoi visitare te stesso. Se il mago protegge la casa che visiti, vi salvate entrambi.",
    mason: "Di giorno potete garantire l'uno per l'altro, ma attenzione: se vi esponete troppo, i lupi sapranno chi colpire.",
    prole: "Finché non vieni morso giochi per il villaggio. Se vieni morso, il tuo telefono te lo dice e il branco ti accoglie: da lì in poi vinci con i lupi. Al villaggio si annuncia che quella notte nessuno è morto.",
    citizen: "Non hai poteri notturni, ma il tuo voto conta: osserva, ascolta e smaschera i lupi.",
  },
  en: {
    wolf: "At night the wolves recognise each other and agree on a victim: they must all agree. During the day they pretend to be innocent.",
    seer: "Once you pick a player, the vision can't be changed. Use what you learn to guide the village, but if the wolves figure out who you are, you'll be next.",
    magician: "The protection covers the whole house: if the medium is visiting, they are safe too.",
    medium: "You can't visit yourself. If the magician protects the house you visit, you are both safe.",
    mason: "During the day you can vouch for each other, but careful: if you expose yourselves too much, the wolves will know who to strike.",
    prole: "Until you're bitten you play for the village. If you're bitten, your phone tells you and the pack welcomes you: from then on you win with the wolves. The village is told that nobody died that night.",
    citizen: "You have no night powers, but your vote counts: watch, listen and unmask the wolves.",
  },
};

const STRINGS = {
  it: {
    // static page
    info: "Regole", settings: "Impostazioni", subtitle: "Il compagno di gioco", connecting: "Connessione…",
    setupTitle: "Configurazione necessaria", setupText: "Compila firebase-config.js con la configurazione del tuo progetto Firebase. Vedi il README.",
    create: "Crea una nuova stanza", orJoin: "oppure entra in una", roomCode: "Codice della stanza", join: "Entra",
    room: "Stanza", yourName: "Il tuo nome", namePlaceholder: "es. Marta", iAmMaster: "Sono il master",
    shareCode: "Condividi questo codice con gli altri giocatori", copyCode: "Copia il codice", shareLink: "Condividi il link di invito",
    start: "Inizia la partita", prepare: "Prepara la partita", assign: "Distribuisci i ruoli", useSuggested: "Usa i suggeriti",
    cancel: "Annulla", tapToSee: "Tocca per vedere il tuo ruolo", nobodyLooking: "Assicurati che nessuno stia guardando",
    tapToHide: "Tocca di nuovo per nasconderlo", rolesTitle: "Ruoli", endGame: "Termina la partita", history: "Cronologia",
    playersTitle: "Giocatori", editProfile: "Modifica nome / ruolo", leave: "Esci dalla stanza", reconnecting: "Riconnessione…",
    modeTitle: "Modalità di gioco", modeLive: "Dal vivo", modeRemote: "A distanza",
    modeLiveDesc: "Tutti allo stesso tavolo. I telefoni mostrano solo i ruoli; il master registra la notte e la votazione.",
    modeRemoteDesc: "Ognuno gioca dal proprio telefono: azioni notturne e voti avvengono nell'app.",
    modeHybrid: "Ibrido",
    modeHybridDesc: "Tutti allo stesso tavolo con un master che guida la notte, ma chi viene chiamato apre gli occhi e sceglie dal proprio telefono. Il voto si fa per alzata di mano o sul telefono, come scegli nelle impostazioni.",
    liveNeedsMaster: "Le partite dal vivo hanno bisogno di un master.",
    settingsTitle: "Impostazioni", language: "Lingua", roomRules: "Regole della stanza", close: "Chiudi",
    rulesEditable: "Valgono per tutti nella stanza. Puoi cambiarle finché la partita non inizia.",
    rulesReadOnly: (who) => `Le sceglie ${who}. Qui puoi vedere quelle in uso.`,
    rulesLocked: "Partita in corso: le regole non si possono cambiare fino alla fine.",
    noRoom: "Entra in una stanza per vedere le sue regole.",
    // lobby
    masterHint: "Il master racconta la partita e non ha un ruolo. Facoltativo nelle partite a distanza.",
    masterTaken: (n) => `${n} è già il master.`,
    save: "Salva", enterRoom: "Entra nella stanza", back: "Indietro",
    gameInProgress: "In questa stanza c'è già una partita in corso.",
    playersCount: (n) => (n === 1 ? "1 giocatore" : `${n} giocatori`), plusMaster: " + master",
    noMasterHost: (h) => `Nessun master: potete comunque giocare a distanza, con ${h} come host.`,
    noMasterYet: "Ancora nessun master.",
    you: "tu", out: "fuori gioco", host: "Host", master: "Master", left: "(uscito)", online: "Online", offline: "Offline",
    waitingPlayers: (n, min) => `In attesa di giocatori: ${n} su almeno ${min}.`, playersReady: (n) => `${n} giocatori pronti.`,
    noMasterRemote: " Senza master si gioca a distanza, e giochi anche tu.",
    waitStart: (who) => `In attesa che ${who} inizi la partita…`, theMaster: "il master", hostOf: (n) => `${n} (host)`,
    waitMaster: "In attesa di un master…", chosenMode: (m) => `Modalità scelta: ${m}`,
    masterChoosing: "Il master sta scegliendo i ruoli…", hostChoosing: (n) => `${n} sta scegliendo i ruoli…`,
    loadingRole: "Caricamento del tuo ruolo…", notInGame: "C'è una partita in corso senza di te. Aspetta la prossima!",
    // setup
    nPlayers: (n) => `${n} giocatori`, suggested: (n, c) => `Suggeriti per ${n} giocatori: ${c}.`,
    fillRest: "Riempiono i posti rimasti", max: (n) => `Max ${n}`, fewer: (r) => `Meno ${r}`, more: (r) => `Più ${r}`,
    err_noWolf: "Serve almeno un lupo.", err_tooManyWolves: (m, n) => `I lupi devono partire in minoranza: al massimo ${m} con ${n} giocatori.`,
    err_tooManyRoles: "Ci sono più ruoli che giocatori.", notEnough: "Non ci sono abbastanza giocatori.",
    // roles card
    yourPack: (n) => `Il tuo branco: ${n}`, onlyWolf: "Sei l'unico lupo.",
    yourVisions: (v) => `Le tue visioni: ${v}`, nightN: (r) => `notte ${r}`, inThisGame: (c) => `In questa partita: ${c}`,
    isWolf: (n) => `${n} è un lupo!`, notWolf: (n) => `${n} non è un lupo.`, isRole: (n, r) => `${n} è: ${r}`,
    // assigned
    rolesDealt: "Ruoli distribuiti",
    masterAssignedLive: "Chiedi a tutti di guardare il proprio ruolo di nascosto e poi di mettere via il telefono. La notte la guidi tu da qui.",
    masterAssignedRemote: "Chiedi a tutti di guardare il proprio ruolo di nascosto. Quando tutti l'hanno visto, inizia la prima notte.",
    playerAssignedLive: "Guarda il tuo ruolo qui sotto senza farlo vedere a nessuno, poi metti via il telefono: il master guida la partita a voce.",
    playerAssignedRemote: "Guarda il tuo ruolo qui sotto senza farlo vedere a nessuno. La prima notte sta per iniziare.",
    playerAssignedHybrid: "Guarda il tuo ruolo qui sotto senza farlo vedere a nessuno. Tieni il telefono a portata di mano: quando il master chiama il tuo ruolo, scegli da qui.",
    hybridNight: "Chiudi gli occhi e segui la voce del master. Quando chiama il tuo ruolo, apri gli occhi e scegli da qui.",
    sayWolvesHybrid: "Lupi, aprite gli occhi… e scegliete la vittima sul telefono.",
    sayHybrid_seer: "Veggente, apri gli occhi… e scegli sul telefono chi vuoi scoprire.",
    sayHybrid_magician: "Mago, apri gli occhi… e scegli sul telefono la casa da proteggere.",
    sayHybrid_medium: "Medium, apri gli occhi… e scegli sul telefono la casa da visitare.",
    waitPhone: "In attesa della scelta sul telefono…", skipStep: "Non risponde? Vai avanti senza scelta",
    confirmSkipStep: "Andare avanti senza la sua scelta? Vale come nessuna azione.",
    pickConfirmed: (n) => `Hai confermato: ${n}.`, pickDone: "Hai confermato la tua scelta.", changePick: "Cambia scelta",
    confirmPick: (n) => `Conferma: ${n}`, confirmVote: (n) => `Conferma il voto: ${n}`,
    decoyPrompt: "Stanotte non hai azioni, ma scegli comunque un giocatore e conferma: chi sospetti? La scelta non cambia nulla, serve solo a non far capire a nessuno chi ha un ruolo.",
    nightDoneCount: (k, n) => `Hanno confermato ${k} giocatori su ${n}.`,
    suspectsTitle: "Chi ha indovinato i sospetti?",
    suspectsNote: "Le notti senza azioni: quante volte il sospettato era davvero un lupo. Non ha cambiato nulla nella partita.",
    suspectsScore: (k, n) => `${k} su ${n}`,
    seenCount: (k, n) => `${k} su ${n} hanno visto il proprio ruolo.`, seenAll: "Tutti hanno visto il proprio ruolo.",
    seenLegendYes: "ha visto il ruolo", seenLegendNo: "non ancora", seenYes: "Ha visto il ruolo", seenNo: "Non ha ancora visto il ruolo",
    startNight: (r) => `Inizia la notte ${r}`, waitSeen: "Aspetta che tutti abbiano visto il proprio ruolo",
    youAreHost: "Sei l'host di questa partita.",
    // night
    night: (r) => `Notte ${r}`, step_sleep: "Sonno", step_wolves: "Lupi", step_seer: "Veggente",
    step_magician: "Mago", step_medium: "Medium", step_dawn: "Alba",
    saySleep: "Scende la notte sul villaggio. Tutti chiudono gli occhi.", callWolves: "Avanti: chiama i lupi",
    sayWolves: "Lupi, aprite gli occhi… e scegliete la vostra vittima.", sayWolvesFirst: "Lupi, aprite gli occhi e riconoscetevi.",
    wolvesAre: (n, names) => `${n === 1 ? "Il lupo è" : "I lupi sono"} ${names}. Tocca il giocatore che indicano:`,
    wolvesAreHybrid: (n, names) => `${n === 1 ? "Il lupo è" : "I lupi sono"} ${names}: ${n === 1 ? "sceglie" : "scelgono"} sul telefono.`,
    wolvesFirstNight: (names) => `I lupi (${names}) si guardano e si riconoscono. La prima notte non uccidono.`,
    confirmAttack: (n) => `Conferma: i lupi attaccano ${n}`, chooseVictim: "Scegli la vittima", continue: "Continua",
    thenWolves: "Poi: “Lupi, chiudete gli occhi.”",
    say_seer: "Veggente, apri gli occhi… chi vuoi scoprire stanotte?",
    say_magician: "Mago, apri gli occhi… quale casa proteggi stanotte?",
    say_medium: "Medium, apri gli occhi… a casa di chi vai stanotte?",
    roleIsOut: (r) => `Il ${r} è fuori gioco. Chiamalo comunque, così nessuno se ne accorge, aspetta qualche secondo e continua.`,
    holderIs: (n, r) => `${n} è il ${r}. Tocca il giocatore che indica:`,
    seerYes: "Sì, è un lupo", seerNo: "No, non è un lupo", seerRole: (r) => `Ruolo: ${r}`,
    seerSignal: "Fai un cenno al veggente: pollice in su se è un lupo, in giù se non lo è.",
    seerSignalRole: "Mostra al veggente il ruolo in silenzio (ad esempio indicandolo sul telefono).",
    verb_seer: "guarda", verb_magician: "protegge", verb_medium: "va da",
    confirmAction: (verb, n) => `Conferma: ${verb} ${n}`, choosePlayer: "Scegli un giocatore", thenClose: (r) => `Poi: “${r}, chiudi gli occhi.”`,
    sayDawn: "Sorge il sole. Tutti aprono gli occhi.", victimBig: (n) => `Vittima della notte: ${n}`, nobodyBig: "Stanotte nessuno è morto",
    onlyForYou: (t) => `Solo per te: ${t}`, announceDay: "Annuncialo e inizia il giorno", back2: "← Indietro",
    liveNight: "Metti via il telefono, chiudi gli occhi e segui la voce del master.", liveNightDead: "Sei fuori gioco: tieni gli occhi chiusi e resta in silenzio.",
    remoteNightIntro: "Tutti chiudono gli occhi. Chi ha un ruolo notturno sceglie dal proprio telefono.",
    wolvesChose: (n) => `I lupi hanno scelto ${n}`, wolvesDeciding: (p) => `I lupi stanno decidendo: ${p}`,
    wolvesFirst: "Prima notte: i lupi si riconoscono soltanto", roleOut: (r) => `Il ${r} è fuori gioco`, waitingFor: (n, r) => `In attesa di ${n} (${r})`,
    seerLooked: (n, t, v) => `${n} guarda ${t}: ${v}`, actionLine: (n, verb, t) => `${n} ${verb} ${t}`,
    ifResolveNow: (t) => `Se risolvi ora: ${t}`, dawnButton: "Alba: risolvi la notte",
    confirmIncomplete: "Non tutti hanno ancora scelto. Le scelte mancanti valgono come nessuna azione. Risolvere comunque?",
    res_protected: (a) => `i lupi attaccano ${a}, ma il mago protegge la casa. Nessuno muore.`,
    res_medium: (a) => `i lupi attaccano ${a}; il medium è lì e muore al suo posto.`,
    "res_medium-away": (a) => `i lupi attaccano la casa di ${a}, ma il medium è fuori in visita e si salva.`,
    res_killed: (v) => `i lupi uccidono ${v}.`, "res_first-night": "prima notte: i lupi si riconoscono soltanto. Nessuno muore.",
    "res_no-attack": "i lupi non si sono messi d'accordo su una vittima. Nessuno muore.",
    forceDawn: "Qualcuno non risponde? Risolvi la notte adesso", confirmForceDawn: "Risolvere la notte adesso? Le scelte mancanti valgono come nessuna azione.",
    deadNight: "Sei fuori gioco. Resta in silenzio e goditi il resto della partita.", loadingPack: "Caricamento del branco…",
    packAgrees: (n) => `Il branco è d'accordo: stanotte tocca a ${n}.`, chooseVictimRemote: "Scegli la vittima di stanotte. Tutti i lupi vivi devono scegliere lo stesso giocatore.",
    firstNightWolf: "Prima notte: guarda chi sono gli altri lupi del tuo branco. Stanotte non si uccide.",
    seerPrompt: "Scegli un giocatore: scoprirai se è un lupo. Una sola visione per notte, e non si può cambiare.",
    seerPromptRole: "Scegli un giocatore: scoprirai il suo ruolo. Una sola visione per notte, e non si può cambiare.",
    seerConfirm: (n) => `Vuoi scoprire ${n}? Non potrai cambiare.`, spiritsAnswering: "Gli spiriti stanno rispondendo…",
    keepVision: "Tieni per te la tua visione. Ora chiudi gli occhi fino al mattino.",
    magicianPrompt: "Scegli la casa da proteggere stanotte. Nessuno al suo interno può essere ucciso.",
    mediumPrompt: "Scegli la casa da visitare stanotte. Se i lupi la attaccano, muori tu al posto del padrone di casa.",
    villageSleeps: "Chiudi gli occhi… Il villaggio dorme fino al mattino.",
    // day
    day: (r) => `Giorno ${r}`, newsVictim: (n) => `Vittima della notte: ${n}.`, newsNobody: "Stanotte nessuno è morto.",
    wasRole: (r) => ` Era: ${r}.`, eliminatedBy: (n) => `Il villaggio ha eliminato ${n}.`, drawnBy: (n) => `Ancora pareggio: la sorte ha scelto ${n}.`,
    nobodyEliminated: "Oggi nessuno viene eliminato.", waitNight: (who) => `In attesa che ${who} inizi la notte…`,
    tiedSelect: "Seleziona i giocatori a pari voti:", runoffBetween: (n) => `Ballottaggio tra ${n}`, selectTwo: "Seleziona almeno 2 giocatori",
    sayRunoff: (n) => `Ballottaggio tra ${n}: si vota di nuovo!`, sayVote: "Discutete… poi ognuno indichi chi pensa sia un lupo.",
    tapMostVotes: "Tocca il giocatore con più voti:", eliminate: (n) => `Elimina ${n}`,
    tieAgainNone: "Ancora pareggio: nessuno viene eliminato", tieAgainRandom: "Ancora pareggio: estrai a sorte", tie: "C'è un pareggio",
    liveRunoff: (n) => `Ballottaggio tra ${n}: votate di nuovo a voce.`, liveVote: "Discutete e votate a voce. Il master registra il risultato.",
    remoteRunoff: (n) => `Ballottaggio tra ${n}: votate di nuovo, solo tra loro.`,
    remoteVote: "Discutete, poi vota chi pensi sia un lupo. Puoi cambiare il voto finché la votazione non si chiude.",
    watchVote: "Il villaggio sta votando. I voti sono pubblici.", allVoted: "Hanno votato tutti: la votazione si chiude tra pochi secondi…",
    votedCount: (k, n) => `Hanno votato ${k} giocatori vivi su ${n}.`, closeVote: "Chiudi la votazione",
    confirmCloseVote: "Non hanno ancora votato tutti. Chiudere comunque la votazione?", deadNoVote: "Sei fuori gioco, quindi non puoi votare.",
    forceClose: "Qualcuno non vota? Chiudi la votazione adesso", confirmForceClose: "Chiudere adesso la votazione con i voti dati finora?",
    // over
    gameOver: "Partita finita", wolvesWin: "Vincono i lupi!", villageWins: "Vince il villaggio!",
    backToRoom: "Torna alla stanza", waitNewGame: "In attesa di una nuova partita…",
    // history
    logNight: (r) => `Notte ${r}: `, logKilled: "i lupi uccidono ", logNoDeath: "nessun morto",
    logSeer: (n, v) => `il veggente guarda ${n}: ${v}.`, logRunoff: (r, n) => `Giorno ${r}: pareggio tra ${n}, ballottaggio`,
    logDay: (r) => `Giorno ${r}: `, logEliminated: "il villaggio elimina ", logDrawn: " (sorteggio)", logNoElim: "nessuna eliminazione",
    votes: (n) => (n === 1 ? "1 voto" : `${n} voti`), aWolf: "è un lupo", notAWolf: "non è un lupo",
    // errors & misc
    noFreeCode: "Impossibile trovare un codice libero, riprova.", codeLetters: "Il codice è di 4 lettere.",
    noRoomCode: (c) => `Nessuna stanza con il codice ${c}.`, cantOpen: (m) => `Impossibile aprire la stanza: ${m}`,
    roomFull: "Questa stanza è piena.", nameTaken: "Questo nome è già usato in questa stanza.", enterName: "Inserisci un nome.",
    someone: "Qualcuno", confirmLeave: "Vuoi uscire dalla stanza?",
    confirmEnd: "Terminare la partita e tornare alla stanza? I ruoli verranno cancellati.",
    copied: "Codice copiato!", codeIs: (c) => `Codice: ${c}`, linkCopied: "Link di invito copiato!", inviteText: (c) => `Gioca con me! Codice ${c}`,
    cantConnect: (m) => `Impossibile connettersi: ${m}`, teamWolves: "Lupi", teamVillage: "Villaggio",
    // house rules
    group_vote: "Votazione",
    rule_firstNightKill: "I lupi uccidono già la prima notte", rule_firstNightKill_desc: "Se disattivato, la prima notte i lupi si riconoscono soltanto.",
    rule_wolvesWin: "I lupi vincono quando sono…", opt_wolvesWin_parity: "tanti quanti gli altri", opt_wolvesWin_majority: "più degli altri",
    rule_seerSees: "Il veggente scopre…", opt_seerSees_team: "se è un lupo o no", opt_seerSees_role: "il ruolo esatto",
    rule_magicianSelf: "Il mago può proteggere se stesso", rule_magicianSelf_desc: "",
    rule_magicianRepeat: "Il mago può proteggere la stessa casa due notti di fila", rule_magicianRepeat_desc: "",
    rule_mediumAwayDies: "Il medium muore se i lupi attaccano casa sua mentre è fuori",
    rule_mediumAwayDies_desc: "Se disattivato, il medium in visita altrove si salva.",
    rule_secondTie: "Se anche il ballottaggio finisce pari…", opt_secondTie_none: "nessuno viene eliminato", opt_secondTie_random: "si estrae a sorte",
    rule_selfVote: "Si può votare se stessi", rule_selfVote_desc: "",
    rule_reveal: "Quando qualcuno esce di scena, il suo ruolo…", opt_reveal_none: "resta segreto fino alla fine",
    opt_reveal_voted: "si rivela solo se eliminato al voto", opt_reveal_all: "si rivela sempre",
    rule_seerUses: "Il veggente usa il suo potere…", opt_seerUses_every: "ogni notte", opt_seerUses_once: "una sola volta per partita",
    seerSkip: "Non stanotte", seerSkipped: "Stanotte non usi il tuo potere. Chiudi gli occhi fino al mattino.",
    seerSpent: "Hai già usato il tuo potere in questa partita. Chiudi gli occhi fino al mattino.",
    seerPromptOnce: "Puoi usare il tuo potere una sola volta per partita. Scegli un giocatore adesso, oppure tienilo per un'altra notte.",
    seerSkipsLine: (n) => `${n} non usa il potere stanotte`, seerSpentLine: (n) => `${n} ha già usato il suo potere`,
    seerSpentLive: (n) => `${n} ha già usato il suo potere. Chiamalo comunque, così nessuno se ne accorge, poi continua.`,
    seerSkipLive: "Non lo usa stanotte",
    err_oneMason: "I massoni devono essere almeno 2.", zeroOrTwo: "0 oppure almeno 2",
    yourMasons: (n) => `I tuoi confratelli massoni: ${n}`,
    bitten: "Stanotte i lupi ti hanno morso: ora sei un lupo! Da adesso giochi con il branco.",
    bittenHidden: "Eri la Prole senza saperlo: stanotte i lupi ti hanno morso e ora sei un lupo! Da adesso giochi con il branco.",
    step_prole: "Prole", step_check: "Ruoli", sayProle: "Prole, apri gli occhi.",
    proleBitten: (n) => `${n} è stato morso: fagli il pollice in su. Ora è un lupo (lo vede anche sul telefono) e dalla prossima notte si sveglia con il branco.`,
    proleSafe: (n) => `${n} non è stato morso: fagli il pollice in giù.`,
    proleGone: "La Prole è fuori gioco o è già un lupo. Chiamala comunque, aspetta qualche secondo e continua.",
    sayCheck: "Tutti, senza farvi vedere, guardate di nuovo il vostro ruolo sul telefono: qualcuno potrebbe essere diventato un lupo.",
    checkBitten: (n) => `${n} era la Prole ed è stato morso: ora sul suo telefono è un lupo e dalla prossima notte si sveglia con il branco.`,
    checkNobody: "Stanotte nessuno è diventato un lupo.",
    thenCheck: "Quando tutti hanno guardato e rimesso giù il telefono, continua.",
    rule_hybridVote: "In modalità ibrida, il voto del giorno si fa…", opt_hybridVote_hands: "per alzata di mano", opt_hybridVote_phones: "sul telefono",
    rule_proleKnows: "La Prole sa di essere la Prole", rule_proleKnows_desc: "Se disattivato, il suo telefono mostra Cittadino finché non viene morsa.",
    step_masons: "Massoni", sayMasons: "Massoni, aprite gli occhi e riconoscetevi.",
    masonsAre: (n) => `I massoni sono ${n}. Lasciali guardarsi, poi continua.`,
    masonsOut: "I massoni sono tutti fuori gioco. Chiamali comunque, aspetta qualche secondo e continua.",
    thenMasons: "Poi: “Massoni, chiudete gli occhi.”",
    res_converted: (a) => `i lupi attaccano ${a}, che è la Prole: non muore, ma diventa un lupo!`,
    exProle: " (ex Prole)",
    rule_masonsWake: "Dal vivo, i massoni vengono chiamati…", opt_masonsWake_first: "solo la prima notte", opt_masonsWake_every: "ogni notte",
    rule_seerSeesProle: "Prima del morso, il veggente vede la Prole come…", opt_seerSeesProle_village: "non lupo", opt_seerSeesProle_wolf: "lupo",
    guideRoom: "Queste sono le regole scelte per questa stanza.",
    guideDefault: "Queste sono le regole predefinite: chi guida la partita può cambiarle nelle impostazioni.",
  },
  en: {
    info: "Rules", settings: "Settings", subtitle: "Game companion", connecting: "Connecting…",
    setupTitle: "Setup needed", setupText: "Fill in firebase-config.js with your Firebase project's config. See the README.",
    create: "Create a new room", orJoin: "or join one", roomCode: "Room code", join: "Join",
    room: "Room", yourName: "Your name", namePlaceholder: "e.g. Marta", iAmMaster: "I am the game master",
    shareCode: "Share this code with the other players", copyCode: "Copy the code", shareLink: "Share invite link",
    start: "Start the game", prepare: "Set up the game", assign: "Deal the roles", useSuggested: "Use suggested",
    cancel: "Cancel", tapToSee: "Tap to see your role", nobodyLooking: "Make sure nobody is looking",
    tapToHide: "Tap again to hide", rolesTitle: "Roles", endGame: "End the game", history: "History",
    playersTitle: "Players", editProfile: "Edit name / role", leave: "Leave the room", reconnecting: "Reconnecting…",
    modeTitle: "Way of playing", modeLive: "Live", modeRemote: "Remote",
    modeLiveDesc: "Everyone at the same table. Phones only show the roles; the master records the night and the vote.",
    modeRemoteDesc: "Everyone plays on their own phone: night actions and votes happen in the app.",
    modeHybrid: "Hybrid",
    modeHybridDesc: "Everyone at the same table with a master running the night, but whoever is called opens their eyes and chooses on their own phone. The vote is by show of hands or on the phones, as chosen in the settings.",
    liveNeedsMaster: "Live games need a game master.",
    settingsTitle: "Settings", language: "Language", roomRules: "Room rules", close: "Close",
    rulesEditable: "They apply to everyone in the room. You can change them until the game starts.",
    rulesReadOnly: (who) => `Chosen by ${who}. Here you can see the ones in use.`,
    rulesLocked: "Game in progress: the rules can't change until it ends.",
    noRoom: "Join a room to see its rules.",
    masterHint: "The master narrates the game and doesn't play a role. Optional in remote games.",
    masterTaken: (n) => `${n} is already the game master.`,
    save: "Save", enterRoom: "Enter the room", back: "Back",
    gameInProgress: "A game is already in progress in this room.",
    playersCount: (n) => (n === 1 ? "1 player" : `${n} players`), plusMaster: " + master",
    noMasterHost: (h) => `No game master: you can still play a remote game, with ${h} as host.`,
    noMasterYet: "No game master yet.",
    you: "you", out: "out", host: "Host", master: "Master", left: "(left)", online: "Online", offline: "Offline",
    waitingPlayers: (n, min) => `Waiting for players: ${n} of at least ${min}.`, playersReady: (n) => `${n} players ready.`,
    noMasterRemote: " Without a master you play a remote game, and you play too.",
    waitStart: (who) => `Waiting for ${who} to start the game…`, theMaster: "the master", hostOf: (n) => `${n} (host)`,
    waitMaster: "Waiting for a game master…", chosenMode: (m) => `Way of playing: ${m}`,
    masterChoosing: "The master is choosing the roles…", hostChoosing: (n) => `${n} is choosing the roles…`,
    loadingRole: "Loading your role…", notInGame: "A game is in progress without you. Wait for the next one!",
    nPlayers: (n) => `${n} players`, suggested: (n, c) => `Suggested for ${n} players: ${c}.`,
    fillRest: "Fill the remaining places", max: (n) => `Max ${n}`, fewer: (r) => `Fewer ${r}`, more: (r) => `More ${r}`,
    err_noWolf: "There must be at least one wolf.", err_tooManyWolves: (m, n) => `Wolves must start as a minority: at most ${m} with ${n} players.`,
    err_tooManyRoles: "More roles than players.", notEnough: "Not enough players.",
    yourPack: (n) => `Your pack: ${n}`, onlyWolf: "You are the only wolf.",
    yourVisions: (v) => `Your visions: ${v}`, nightN: (r) => `night ${r}`, inThisGame: (c) => `In this game: ${c}`,
    isWolf: (n) => `${n} is a wolf!`, notWolf: (n) => `${n} is not a wolf.`, isRole: (n, r) => `${n} is: ${r}`,
    rolesDealt: "Roles dealt",
    masterAssignedLive: "Ask everyone to check their role in secret, then put the phones away. You will run the night from here.",
    masterAssignedRemote: "Ask everyone to check their role in secret. Once everyone has seen it, start the first night.",
    playerAssignedLive: "Check your role below without letting anyone see it, then put your phone away: the master runs the game out loud.",
    playerAssignedRemote: "Check your role below without letting anyone see it. The first night starts soon.",
    playerAssignedHybrid: "Check your role below without letting anyone see it. Keep your phone at hand: when the master calls your role, choose here.",
    hybridNight: "Close your eyes and follow the master's voice. When your role is called, open your eyes and choose here.",
    sayWolvesHybrid: "Wolves, open your eyes… and choose your victim on your phone.",
    sayHybrid_seer: "Seer, open your eyes… and choose on your phone who to find out about.",
    sayHybrid_magician: "Magician, open your eyes… and choose on your phone whose house to protect.",
    sayHybrid_medium: "Medium, open your eyes… and choose on your phone whose house to visit.",
    waitPhone: "Waiting for the choice on the phone…", skipStep: "No answer? Continue without a choice",
    confirmSkipStep: "Continue without their choice? It counts as no action.",
    pickConfirmed: (n) => `You confirmed: ${n}.`, pickDone: "You confirmed your choice.", changePick: "Change choice",
    confirmPick: (n) => `Confirm: ${n}`, confirmVote: (n) => `Confirm vote: ${n}`,
    decoyPrompt: "You have no action tonight, but pick a player anyway and confirm: who do you suspect? It changes nothing, it only keeps anyone from telling who has a role.",
    nightDoneCount: (k, n) => `${k} of ${n} players have confirmed.`,
    suspectsTitle: "Who got the suspects right?",
    suspectsNote: "On nights without an action: how often the suspect really was a wolf. It changed nothing in the game.",
    suspectsScore: (k, n) => `${k} of ${n}`,
    seenCount: (k, n) => `${k} of ${n} have seen their role.`, seenAll: "Everyone has seen their role.",
    seenLegendYes: "has seen their role", seenLegendNo: "not yet", seenYes: "Has seen their role", seenNo: "Hasn't seen their role yet",
    startNight: (r) => `Start night ${r}`, waitSeen: "Wait until everyone has seen their role",
    youAreHost: "You are the host of this game.",
    night: (r) => `Night ${r}`, step_sleep: "Sleep", step_wolves: "Wolves", step_seer: "Seer",
    step_magician: "Magician", step_medium: "Medium", step_dawn: "Dawn",
    saySleep: "Night falls on the village. Everyone, close your eyes.", callWolves: "Next: call the wolves",
    sayWolves: "Wolves, open your eyes… and choose your victim.", sayWolvesFirst: "Wolves, open your eyes and recognise each other.",
    wolvesAre: (n, names) => `${n === 1 ? "The wolf is" : "The wolves are"} ${names}. Tap the player they point at:`,
    wolvesAreHybrid: (n, names) => `${n === 1 ? "The wolf is" : "The wolves are"} ${names}: they choose on their phone.`,
    wolvesFirstNight: (names) => `The wolves (${names}) look at each other. On the first night they don't kill.`,
    confirmAttack: (n) => `Confirm: the wolves attack ${n}`, chooseVictim: "Select the victim", continue: "Continue",
    thenWolves: "Then: “Wolves, close your eyes.”",
    say_seer: "Seer, open your eyes… who do you want to find out about tonight?",
    say_magician: "Magician, open your eyes… whose house do you protect tonight?",
    say_medium: "Medium, open your eyes… whose house do you visit tonight?",
    roleIsOut: (r) => `The ${r} is out of the game. Call them anyway, so nobody notices, wait a few seconds, then continue.`,
    holderIs: (n, r) => `${n} is the ${r}. Tap the player they point at:`,
    seerYes: "Yes, a wolf", seerNo: "No, not a wolf", seerRole: (r) => `Role: ${r}`,
    seerSignal: "Signal the seer: thumbs up if it's a wolf, thumbs down if not.",
    seerSignalRole: "Show the seer the role in silence (for example by pointing at it on the phone).",
    verb_seer: "looks at", verb_magician: "protects", verb_medium: "visits",
    confirmAction: (verb, n) => `Confirm: ${verb} ${n}`, choosePlayer: "Select a player", thenClose: (r) => `Then: “${r}, close your eyes.”`,
    sayDawn: "The sun rises. Everyone, open your eyes.", victimBig: (n) => `Tonight's victim: ${n}`, nobodyBig: "Nobody died tonight",
    onlyForYou: (t) => `Only for you: ${t}`, announceDay: "Announce it and start the day", back2: "← Back",
    liveNight: "Put your phone away, close your eyes and follow the master's voice.", liveNightDead: "You are out: keep your eyes closed and stay silent.",
    remoteNightIntro: "Everyone closes their eyes. Players with a night role choose on their phone.",
    wolvesChose: (n) => `The wolves chose ${n}`, wolvesDeciding: (p) => `The wolves are deciding: ${p}`,
    wolvesFirst: "First night: the wolves only recognise each other", roleOut: (r) => `The ${r} is out`, waitingFor: (n, r) => `Waiting for ${n} (${r})`,
    seerLooked: (n, t, v) => `${n} looks at ${t}: ${v}`, actionLine: (n, verb, t) => `${n} ${verb} ${t}`,
    ifResolveNow: (t) => `If you resolve now: ${t}`, dawnButton: "Dawn: resolve the night",
    confirmIncomplete: "Not everyone has chosen yet. Missing choices count as no action. Resolve anyway?",
    res_protected: (a) => `the wolves attack ${a}, but the magician protects the house. Nobody dies.`,
    res_medium: (a) => `the wolves attack ${a}; the medium is there and dies in their place.`,
    "res_medium-away": (a) => `the wolves attack ${a}'s house, but the medium is out visiting and survives.`,
    res_killed: (v) => `the wolves kill ${v}.`, "res_first-night": "first night: the wolves only recognise each other. Nobody dies.",
    "res_no-attack": "the wolves didn't agree on a victim. Nobody dies.",
    forceDawn: "Someone isn't responding? Resolve the night now", confirmForceDawn: "Resolve the night now? Missing choices count as no action.",
    deadNight: "You are out. Stay silent and enjoy the rest of the game.", loadingPack: "Loading your pack…",
    packAgrees: (n) => `The pack agrees: ${n} is tonight's victim.`, chooseVictimRemote: "Choose tonight's victim. All living wolves must choose the same player.",
    firstNightWolf: "First night: see who else is in your pack. Nobody is killed tonight.",
    seerPrompt: "Choose a player: you'll find out whether they are a wolf. One vision per night, and it can't be changed.",
    seerPromptRole: "Choose a player: you'll find out their role. One vision per night, and it can't be changed.",
    seerConfirm: (n) => `Find out about ${n}? You can't change it.`, spiritsAnswering: "The spirits are answering…",
    keepVision: "Keep your vision to yourself. Now close your eyes until morning.",
    magicianPrompt: "Choose whose house to protect tonight. Nobody in it can be killed.",
    mediumPrompt: "Choose whose house to visit tonight. If the wolves attack it, you die in their place.",
    villageSleeps: "Close your eyes… The village sleeps until morning.",
    day: (r) => `Day ${r}`, newsVictim: (n) => `Tonight's victim: ${n}.`, newsNobody: "Nobody died during the night.",
    wasRole: (r) => ` They were: ${r}.`, eliminatedBy: (n) => `The village eliminated ${n}.`, drawnBy: (n) => `Tied again: chance picked ${n}.`,
    nobodyEliminated: "Nobody is eliminated today.", waitNight: (who) => `Waiting for ${who} to start the night…`,
    tiedSelect: "Select the players who tied with the most votes:", runoffBetween: (n) => `Run-off between ${n}`, selectTwo: "Select at least 2 players",
    sayRunoff: (n) => `Run-off between ${n}: vote again!`, sayVote: "Discuss… then everyone points at who they think is a wolf.",
    tapMostVotes: "Tap the player with the most votes:", eliminate: (n) => `Eliminate ${n}`,
    tieAgainNone: "Tied again: nobody is eliminated", tieAgainRandom: "Tied again: draw at random", tie: "It's a tie",
    liveRunoff: (n) => `Run-off between ${n}: vote again out loud.`, liveVote: "Discuss and vote out loud. The master records the result.",
    remoteRunoff: (n) => `Run-off between ${n}: vote again, only among them.`,
    remoteVote: "Discuss, then vote who you think is a wolf. You can change your vote until the vote closes.",
    watchVote: "The village is voting. Votes are public.", allVoted: "Everyone has voted: the vote closes in a few seconds…",
    votedCount: (k, n) => `${k} of ${n} living players have voted.`, closeVote: "Close the vote",
    confirmCloseVote: "Not everyone has voted yet. Close the vote anyway?", deadNoVote: "You are out, so you can't vote.",
    forceClose: "Someone isn't voting? Close the vote now", confirmForceClose: "Close the vote now with the votes cast so far?",
    gameOver: "Game over", wolvesWin: "The wolves win!", villageWins: "The village wins!",
    backToRoom: "Back to the room", waitNewGame: "Waiting for a new game…",
    logNight: (r) => `Night ${r}: `, logKilled: "the wolves kill ", logNoDeath: "nobody died",
    logSeer: (n, v) => `the seer looks at ${n}: ${v}.`, logRunoff: (r, n) => `Day ${r}: tie between ${n}, run-off`,
    logDay: (r) => `Day ${r}: `, logEliminated: "the village eliminates ", logDrawn: " (drawn)", logNoElim: "nobody eliminated",
    votes: (n) => (n === 1 ? "1 vote" : `${n} votes`), aWolf: "a wolf", notAWolf: "not a wolf",
    noFreeCode: "Could not find a free room code, please retry.", codeLetters: "The code is 4 letters.",
    noRoomCode: (c) => `No room with code ${c}.`, cantOpen: (m) => `Could not open the room: ${m}`,
    roomFull: "This room is full.", nameTaken: "That name is already taken in this room.", enterName: "Please enter a name.",
    someone: "Someone", confirmLeave: "Leave this room?",
    confirmEnd: "End this game and go back to the room? Roles will be cleared.",
    copied: "Code copied!", codeIs: (c) => `Code: ${c}`, linkCopied: "Invite link copied!", inviteText: (c) => `Join my game! Code ${c}`,
    cantConnect: (m) => `Could not connect: ${m}`, teamWolves: "Wolves", teamVillage: "Village",
    group_vote: "Voting",
    rule_firstNightKill: "The wolves kill on the first night", rule_firstNightKill_desc: "If off, on the first night the wolves only recognise each other.",
    rule_wolvesWin: "The wolves win when they are…", opt_wolvesWin_parity: "as many as the others", opt_wolvesWin_majority: "more than the others",
    rule_seerSees: "The seer learns…", opt_seerSees_team: "whether it's a wolf", opt_seerSees_role: "the exact role",
    rule_magicianSelf: "The magician can protect themselves", rule_magicianSelf_desc: "",
    rule_magicianRepeat: "The magician can protect the same house two nights in a row", rule_magicianRepeat_desc: "",
    rule_mediumAwayDies: "The medium dies if the wolves attack their house while they're away",
    rule_mediumAwayDies_desc: "If off, the medium visiting elsewhere survives.",
    rule_secondTie: "If the run-off is tied too…", opt_secondTie_none: "nobody is eliminated", opt_secondTie_random: "draw at random",
    rule_selfVote: "Players can vote for themselves", rule_selfVote_desc: "",
    rule_reveal: "When someone leaves the game, their role…", opt_reveal_none: "stays secret until the end",
    opt_reveal_voted: "is revealed only if voted out", opt_reveal_all: "is always revealed",
    rule_seerUses: "The seer uses their power…", opt_seerUses_every: "every night", opt_seerUses_once: "once per game",
    seerSkip: "Not tonight", seerSkipped: "You don't use your power tonight. Close your eyes until morning.",
    seerSpent: "You have already used your power in this game. Close your eyes until morning.",
    seerPromptOnce: "You can use your power only once per game. Choose a player now, or keep it for another night.",
    seerSkipsLine: (n) => `${n} doesn't use the power tonight`, seerSpentLine: (n) => `${n} has already used their power`,
    seerSpentLive: (n) => `${n} has already used their power. Call them anyway, so nobody notices, then continue.`,
    seerSkipLive: "Not using it tonight",
    err_oneMason: "There must be at least 2 masons.", zeroOrTwo: "0 or at least 2",
    yourMasons: (n) => `Your fellow masons: ${n}`,
    bitten: "Tonight the wolves bit you: you are now a wolf! From now on you play with the pack.",
    bittenHidden: "You were the Cursed without knowing it: tonight the wolves bit you and now you are a wolf! From now on you play with the pack.",
    step_prole: "Cursed", step_check: "Roles", sayProle: "Cursed, open your eyes.",
    proleBitten: (n) => `${n} was bitten: give them a thumbs up. They are now a wolf (their phone shows it too) and from the next night they wake up with the pack.`,
    proleSafe: (n) => `${n} was not bitten: give them a thumbs down.`,
    proleGone: "The Cursed is out of the game or already a wolf. Call them anyway, wait a few seconds, then continue.",
    sayCheck: "Everyone, without being seen, look at your role on your phone again: someone may have become a wolf.",
    checkBitten: (n) => `${n} was the Cursed and was bitten: their phone now shows a wolf, and from the next night they wake up with the pack.`,
    checkNobody: "Nobody became a wolf tonight.",
    thenCheck: "When everyone has looked and put their phone down, continue.",
    rule_hybridVote: "In hybrid games, the day vote is held…", opt_hybridVote_hands: "by show of hands", opt_hybridVote_phones: "on the phones",
    rule_proleKnows: "The Cursed knows they are the Cursed", rule_proleKnows_desc: "If off, their phone shows Citizen until they are bitten.",
    step_masons: "Masons", sayMasons: "Masons, open your eyes and recognise each other.",
    masonsAre: (n) => `The masons are ${n}. Let them look at each other, then continue.`,
    masonsOut: "The masons are all out. Call them anyway, wait a few seconds, then continue.",
    thenMasons: "Then: “Masons, close your eyes.”",
    res_converted: (a) => `the wolves attack ${a}, who is the Cursed: they don't die, they become a wolf!`,
    exProle: " (formerly Cursed)",
    rule_masonsWake: "In live games, the masons are called…", opt_masonsWake_first: "only on the first night", opt_masonsWake_every: "every night",
    rule_seerSeesProle: "Before the bite, the seer sees the Cursed as…", opt_seerSeesProle_village: "not a wolf", opt_seerSeesProle_wolf: "a wolf",
    guideRoom: "These are the rules chosen for this room.",
    guideDefault: "These are the default rules: whoever runs the game can change them in the settings.",
  },
};

let lang = "it";

export const getLang = () => lang;
export function setLang(l) {
  lang = LANGS.includes(l) ? l : "it";
  document.documentElement.lang = lang;
}

/** Translate `key`, calling it with `args` when it's a function. Falls back to Italian, then to the key. */
export function t(key, ...args) {
  const v = STRINGS[lang][key] ?? STRINGS.it[key] ?? key;
  return typeof v === "function" ? v(...args) : v;
}

/** The rules guide, written out for the rules in force. Static text only (no player input), so it's safe as HTML. */
const GUIDE = {
  it: (r) => `
    <section>
      <h3>Lo scopo</h3>
      <p>Nel villaggio si nascondono dei <strong>lupi</strong>. Ogni notte uccidono qualcuno; ogni giorno il villaggio
        discute e vota per eliminare chi sospetta essere un lupo. Nessuno conosce il ruolo degli altri: bisogna osservare,
        ragionare e convincere.</p>
      <ul>
        <li><strong><img class="ri" src="icons/citizen.svg" alt=""> Il villaggio</strong> (Cittadini, Veggente, Mago, Medium, Massoni, Prole) vince quando <strong>tutti i lupi sono stati eliminati</strong>.</li>
        <li><strong><img class="ri" src="icons/wolf.svg" alt=""> I lupi</strong> vincono quando ${r.wolvesWin === "majority"
          ? "<strong>sono più degli altri giocatori</strong> (ad esempio 2 lupi contro 1 abitante)"
          : "<strong>sono tanti quanti gli altri giocatori</strong> (ad esempio 2 lupi contro 2 abitanti)"}.</li>
      </ul>
    </section>
    <section><h3>I ruoli</h3><ul class="info-roles"></ul></section>
    <section>
      <h3><img class="ri" src="icons/ui/moon.svg" alt=""> La notte</h3>
      <p>Tutti chiudono gli occhi. Il master chiama i ruoli uno alla volta, in quest'ordine:</p>
      <ol>
        <li><strong>I lupi</strong> aprono gli occhi, si riconoscono e indicano insieme la vittima: devono essere tutti d'accordo.${r.firstNightKill ? ""
          : " <strong>La prima notte si riconoscono soltanto</strong>, senza uccidere."}</li>
        <li><strong>I massoni</strong> (se in gioco) aprono gli occhi e si riconoscono ${r.masonsWake === "every" ? "<strong>ogni notte</strong>" : "<strong>solo la prima notte</strong>"}.</li>
        <li><strong>Il veggente</strong> indica un giocatore e scopre ${r.seerSees === "role" ? "<strong>il suo ruolo esatto</strong>" : "<strong>se è un lupo</strong> oppure no"}.${r.seerUses === "once"
          ? " Può farlo <strong>una sola volta per partita</strong>, nella notte che preferisce; le altre notti viene chiamato lo stesso." : ""}</li>
        <li><strong>Il mago</strong> indica la casa da proteggere (${r.magicianSelf ? "anche la propria" : "non la propria"}).${r.magicianRepeat
          ? " Può proteggere la stessa casa più notti di fila." : " <strong>Non può proteggere la stessa casa due notti di fila.</strong>"}</li>
        <li><strong>Il medium</strong> indica la casa di un altro giocatore in cui andare.</li>
      </ol>
      <p>Il master chiama ogni ruolo anche se chi lo aveva è fuori gioco, così nessuno capisce chi è rimasto.</p>
    </section>
    <section>
      <h3><img class="ri" src="icons/ui/dawn.svg" alt=""> L'alba</h3>
      <ul>
        <li>Se il mago protegge la casa attaccata, <strong>nessuno muore</strong> (nemmeno il medium, se è lì).</li>
        <li>Altrimenti, se il medium è in visita nella casa attaccata, <strong>muore il medium</strong> al posto del padrone di casa.</li>
        <li>${r.mediumAwayDies
          ? "Se i lupi attaccano la casa del medium mentre è fuori in visita, <strong>il medium muore comunque</strong>."
          : "Se i lupi attaccano la casa del medium mentre è fuori in visita, <strong>il medium si salva</strong>: non è in casa."}</li>
        <li>Se i lupi attaccano <strong>la Prole</strong>, non muore: <strong>diventa un lupo</strong> e da quel momento gioca con il branco.${r.proleKnows
          ? " Dal vivo, prima dell'alba il master chiama la Prole e le fa il pollice in su se è stata morsa."
          : " La Prole non sa di esserlo: dal vivo, prima dell'alba tutti riguardano il proprio ruolo sul telefono."}</li>
        <li>Altrimenti muore la vittima dei lupi.</li>
      </ul>
      <p>Il master annuncia solo chi è morto, non il perché.${r.reveal === "all" ? " Il ruolo della vittima viene rivelato a tutti." : ""}</p>
    </section>
    <section>
      <h3><img class="ri" src="icons/ui/sun.svg" alt=""> Il giorno</h3>
      <p>Il villaggio discute liberamente, poi ognuno vota chi vuole eliminare (${r.selfVote ? "si può votare anche se stessi" : "non si può votare se stessi"}).</p>
      <ul>
        <li>Chi riceve <strong>più voti</strong> viene eliminato.</li>
        <li>In caso di <strong>pareggio</strong> si fa un <strong>ballottaggio</strong> solo tra i giocatori a pari voti.</li>
        <li>Se anche il ballottaggio finisce in pareggio, ${r.secondTie === "random"
          ? "<strong>si estrae a sorte</strong> uno dei giocatori a pari voti." : "quel giorno <strong>nessuno viene eliminato</strong>."}</li>
      </ul>
      <p>Chi è fuori gioco non parla e non vota. ${{
        none: "I ruoli si scoprono solo a fine partita.",
        voted: "Il ruolo di chi viene eliminato al voto viene rivelato; quello delle vittime della notte resta segreto fino alla fine.",
        all: "Il ruolo di chi esce di scena viene sempre rivelato.",
      }[r.reveal]}</p>
    </section>
    <section>
      <h3><img class="ri" src="icons/ui/remote.svg" alt=""> Le tre modalità</h3>
      <ul>
        <li><strong><img class="ri" src="icons/ui/live.svg" alt=""> Dal vivo</strong>: tutti allo stesso tavolo, serve un master. Ognuno guarda il proprio ruolo sul telefono
          e lo mette via; il master guida la notte dal suo telefono, registra le scelte indicate col dito, vede chi muore
          all'alba e registra il risultato della votazione.</li>
        <li><strong><img class="ri" src="icons/ui/hybrid.svg" alt=""> Ibrido</strong>: come dal vivo, ma quando il master chiama un ruolo, quel giocatore apre gli occhi
          e sceglie dal proprio telefono; il master vede la scelta e va avanti. ${r.hybridVote === "phones" ? "Il voto si fa sul telefono, come a distanza." : "Il voto resta per alzata di mano."}</li>
        <li><strong><img class="ri" src="icons/ui/remote.svg" alt=""> A distanza</strong>: ognuno sceglie e vota dal proprio telefono. Il master è facoltativo: senza master,
          chi ha creato la stanza (l'host) gioca come gli altri e la partita va avanti da sola. Di notte tutti scelgono un giocatore,
          anche chi non ha azioni, così nessuno capisce chi ha un ruolo. Ogni scelta e ogni voto vanno confermati.</li>
      </ul>
    </section>
    <section>
      <h3><img class="ri" src="icons/ui/bulb.svg" alt=""> Consigli</h3>
      <ul>
        <li>Non mostrare mai il tuo telefono agli altri.</li>
        <li>Di notte, a occhi chiusi, nessun rumore e nessun movimento.</li>
        <li>Servono almeno 5 giocatori, master escluso.</li>
      </ul>
    </section>`,
  en: (r) => `
    <section>
      <h3>The goal</h3>
      <p>Some <strong>wolves</strong> are hiding in the village. Each night they kill someone; each day the village discusses
        and votes to eliminate whoever they suspect is a wolf. Nobody knows the others' roles: you have to watch, reason
        and persuade.</p>
      <ul>
        <li><strong><img class="ri" src="icons/citizen.svg" alt=""> The village</strong> (Citizens, Seer, Magician, Medium, Masons, Cursed) wins when <strong>all the wolves have been eliminated</strong>.</li>
        <li><strong><img class="ri" src="icons/wolf.svg" alt=""> The wolves</strong> win when ${r.wolvesWin === "majority"
          ? "<strong>they outnumber the other players</strong> (for example 2 wolves against 1 villager)"
          : "<strong>they are as many as the other players</strong> (for example 2 wolves against 2 villagers)"}.</li>
      </ul>
    </section>
    <section><h3>The roles</h3><ul class="info-roles"></ul></section>
    <section>
      <h3><img class="ri" src="icons/ui/moon.svg" alt=""> The night</h3>
      <p>Everyone closes their eyes. The master calls the roles one at a time, in this order:</p>
      <ol>
        <li><strong>The wolves</strong> open their eyes, recognise each other and point at their victim together: they must all agree.${r.firstNightKill ? ""
          : " <strong>On the first night they only recognise each other</strong>, without killing."}</li>
        <li><strong>The masons</strong> (if in the game) open their eyes and recognise each other ${r.masonsWake === "every" ? "<strong>every night</strong>" : "<strong>on the first night only</strong>"}.</li>
        <li><strong>The seer</strong> points at a player and learns ${r.seerSees === "role" ? "<strong>their exact role</strong>" : "<strong>whether they are a wolf</strong>"}.${r.seerUses === "once"
          ? " They can do it <strong>only once per game</strong>, on the night they prefer; on the other nights they are called anyway." : ""}</li>
        <li><strong>The magician</strong> points at the house to protect (${r.magicianSelf ? "their own too" : "not their own"}).${r.magicianRepeat
          ? " They can protect the same house several nights in a row." : " <strong>They can't protect the same house two nights in a row.</strong>"}</li>
        <li><strong>The medium</strong> points at another player's house to visit.</li>
      </ol>
      <p>The master calls every role even if its player is out, so nobody can tell who is left.</p>
    </section>
    <section>
      <h3><img class="ri" src="icons/ui/dawn.svg" alt=""> Dawn</h3>
      <ul>
        <li>If the magician protects the attacked house, <strong>nobody dies</strong> (not even the medium, if visiting).</li>
        <li>Otherwise, if the medium is visiting the attacked house, <strong>the medium dies</strong> in place of its owner.</li>
        <li>${r.mediumAwayDies
          ? "If the wolves attack the medium's house while they are out visiting, <strong>the medium dies anyway</strong>."
          : "If the wolves attack the medium's house while they are out visiting, <strong>the medium survives</strong>: they aren't home."}</li>
        <li>If the wolves attack <strong>the Cursed</strong>, they don't die: <strong>they become a wolf</strong> and from then on play with the pack.${r.proleKnows
          ? " In live games, before dawn the master calls the Cursed and gives them a thumbs up if they were bitten."
          : " The Cursed doesn't know it: in live games, before dawn everyone looks at their role on their phone again."}</li>
        <li>Otherwise the wolves' victim dies.</li>
      </ul>
      <p>The master only announces who died, not why.${r.reveal === "all" ? " The victim's role is revealed to everyone." : ""}</p>
    </section>
    <section>
      <h3><img class="ri" src="icons/ui/sun.svg" alt=""> The day</h3>
      <p>The village discusses freely, then everyone votes who to eliminate (${r.selfVote ? "voting for yourself is allowed" : "you can't vote for yourself"}).</p>
      <ul>
        <li>Whoever gets <strong>the most votes</strong> is eliminated.</li>
        <li>On a <strong>tie</strong> there is a <strong>run-off</strong> only between the tied players.</li>
        <li>If the run-off is tied too, ${r.secondTie === "random"
          ? "<strong>one of the tied players is drawn at random</strong>." : "<strong>nobody is eliminated</strong> that day."}</li>
      </ul>
      <p>Players who are out don't talk and don't vote. ${{
        none: "Roles are only revealed at the end of the game.",
        voted: "The role of whoever is voted out is revealed; the night's victims stay secret until the end.",
        all: "The role of whoever leaves the game is always revealed.",
      }[r.reveal]}</p>
    </section>
    <section>
      <h3><img class="ri" src="icons/ui/remote.svg" alt=""> Three ways of playing</h3>
      <ul>
        <li><strong><img class="ri" src="icons/ui/live.svg" alt=""> Live</strong>: everyone at the same table, a master is needed. Everyone checks their role on their phone
          and puts it away; the master runs the night from their phone, records the choices people point at, sees who dies
          at dawn and records the result of the vote.</li>
        <li><strong><img class="ri" src="icons/ui/hybrid.svg" alt=""> Hybrid</strong>: like live, but when the master calls a role, that player opens their eyes
          and chooses on their own phone; the master sees the choice and moves on. ${r.hybridVote === "phones" ? "The vote happens on the phones, as in remote games." : "The vote is still by show of hands."}</li>
        <li><strong><img class="ri" src="icons/ui/remote.svg" alt=""> Remote</strong>: everyone chooses and votes on their own phone. The master is optional: without one,
          the room's creator (the host) plays like everyone else and the game moves on by itself. At night everyone picks a player,
          even those with no action, so nobody can tell who has a role. Every choice and vote must be confirmed.</li>
      </ul>
    </section>
    <section>
      <h3><img class="ri" src="icons/ui/bulb.svg" alt=""> Tips</h3>
      <ul>
        <li>Never show your phone to the others.</li>
        <li>At night, eyes closed: no noise and no movement.</li>
        <li>You need at least 5 players, not counting the master.</li>
      </ul>
    </section>`,
};

export const guideHtml = (rules) => GUIDE[lang](withDefaults(rules));

export const roleName = (role, count = 1) => ROLE_NAMES[lang][role][count === 1 ? 0 : 1];
export const roleDesc = (role, rules) => ROLE_DESC[lang][role](withDefaults(rules));
export const roleInfo = (role) => ROLE_INFO[lang][role];

/** Fill every element marked with data-i18n (text), data-i18n-ph (placeholder), data-i18n-title / -aria (attributes). */
export function translatePage() {
  for (const e of document.querySelectorAll("[data-i18n]")) e.textContent = t(e.dataset.i18n);
  for (const e of document.querySelectorAll("[data-i18n-ph]")) e.placeholder = t(e.dataset.i18nPh);
  for (const e of document.querySelectorAll("[data-i18n-title]")) e.title = t(e.dataset.i18nTitle);
  for (const e of document.querySelectorAll("[data-i18n-aria]")) e.setAttribute("aria-label", t(e.dataset.i18nAria));
}
