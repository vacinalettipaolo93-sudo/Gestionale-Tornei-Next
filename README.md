<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1xYaDNoPY15MB6XhxCwZHB0SO18YdpU99

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Archivio eventi amministratore

Nella dashboard, scegli prima Tennis o Padel, poi consulta **In corso** o **Conclusi**. Il filtro tipo distingue i ranking (Summer Ranking per Tennis, Paitone Arena League per Padel) dai tornei standard. Nei conclusi, l'anno è ricavato dall'ultima partita completata con `completedAt`, oppure dalla sua `scheduledTime` nei record storici senza data di completamento. Gli eventi senza queste date restano visibili in **Anno non disponibile**. I filtri sono conservati nell'URL.

Gli eventi legacy senza `eventType` sono considerati tornei Tennis, come nel resto dell'app. Lo schema non contiene un anno o una data di fine dell'evento: l'anno delle partite è quindi un'indicazione per la ricerca, non una data ufficiale di conclusione. Il listener Firestore degli eventi è condiviso con la vista partecipante e carica l'intera collezione; i filtri della dashboard organizzatore si applicano ai risultati ricevuti, senza modificare o perdere i documenti legacy.

## Controllo utenti amministratore

La creazione da **Lista giocatori** salva insieme profilo globale, account partecipante e associazione all'evento. Il nuovo account usa **Nome Cognome** e password iniziale **1234** (non `123`) e compare in **Controllo Utenti**. Il giocatore resta nell'archivio condiviso, selezionabile dalla lista giocatori anche negli eventi creati successivamente: non viene iscritto automaticamente a tutti gli eventi. Rimuoverlo da una lista evento non elimina il profilo o l'account globale.

Aprire **Controllo Utenti** avvia la verifica dell'archivio `players` e crea gli account mancanti, inclusi quelli dei giocatori inseriti in precedenza da Lista giocatori. **Verifica accessi giocatori** ripete l'operazione in caso di errore o nuove aggiunte. Gli account recuperati usano la password iniziale `1234`; gli account esistenti conservano sempre username e password, senza modificare profili, punti, iscrizioni o risultati. I nomi duplicati, gli account incompatibili e le password mancanti vengono segnalati per una correzione manuale, senza collegare un giocatore all'account di un altro.

Il login accetta lo username esistente oppure il Nome Cognome attuale del giocatore collegato, ignorando maiuscole e spazi ripetuti. Gli username espliciti hanno precedenza e i nomi ambigui non permettono l'accesso. La password deve coincidere esattamente con quella salvata: `1234` non è una password alternativa per chi l'ha cambiata. I vecchi account non indicano se una password è stata cambiata autonomamente: anche un eventuale `123` già salvato viene quindi conservato, non convertito automaticamente. Per questi casi l'amministratore può reimpostare la password dopo verifica.

In **Controllo Utenti**, il pulsante **Nome e telefono** permette di modificare i dati del giocatore collegato all'account. Il nome è obbligatorio; il telefono può essere modificato o svuotato. Dopo la conferma, un'unica transazione Firestore aggiorna l'archivio globale `players` e le copie del giocatore negli eventi, inclusi tornei e ranking Tennis e Padel. I listener esistenti mostrano i dati aggiornati anche agli altri utenti. Username, password, identificativo, iscrizioni, risultati e punti del giocatore non cambiano. Gli account senza giocatore collegato mantengono le sole azioni su username e password.

## Cerca partita per i partecipanti

Nel tab **Partite** di tutte le modalità, **Cerca partita** propone avversari con disponibilità dichiarate in comune e permette di contattarli. **Modifica disponibilità** apre la scheda per inserirle o aggiornarle; l'assenza di dichiarazioni non viene interpretata come disponibilità.

Nei ranking Tennis e Padel individuale si confrontano giorno della settimana e fascia oraria, rispettando anche i formati storici delle disponibilità e le esclusioni salvate. Nel Tennis gli avversari devono essere ancora sfidabili secondo il limite di incontri del regolamento e il pulsante **Sfida** apre la creazione partita esistente. Nel Padel individuale i suggerimenti riguardano il singolo avversario: occorre concordare anche gli altri due giocatori per completare le coppie.

Nei tornei Tennis e Padel, **Disponibilità di gioco** mostra un calendario dei **prossimi 12 weekend**, dal venerdì alla domenica. Scelto un giorno, si indica per **Canottieri Salò**, **Paitone Arena** o entrambi i circoli una o più fasce: **Mattina 08:00–12:00**, **Pomeriggio 12:00–18:00**, **Sera 18:00–22:00**, nell'ora locale. La preferenza è una fascia indicativa da concordare, non una prenotazione o verifica della disponibilità del campo. Un partecipante vede solo le disponibilità dei membri del proprio girone; se non è assegnato a un girone, non vede i dati degli altri giocatori. Gli organizzatori vedono i partecipanti assegnati ai gironi del torneo corrente, non l'intero evento. Si può segnare separatamente una giornata intera come **Non disponibile** (per esempio venerdì e domenica del weekend), senza cancellare le fasce precedentemente salvate: la giornata esclusa non compare nei suggerimenti; rimuovere l'esclusione riattiva le fasce già indicate. Circoli e fasce si salvano indipendentemente per giocatore, torneo e data e si aggiornano in tempo reale. **Cerca partita** propone disponibilità nello stesso giorno/circolo/fascia, poi alternative con fasce diverse nello stesso circolo, infine circoli diversi; per il Padel devono aver dichiarato tutti e quattro i giocatori. Le vecchie preferenze degli slot amministrativi e i relativi slot rimangono conservati e possono ancora essere consultati dalla scheda espandibile **Preferenze sui vecchi slot**; non sono necessarie per il nuovo calendario o per prenotare un campo esterno.

**Cerca partita** propone solo avversari degli incontri non completati del torneo, inclusi playoff e consolazione già definiti. Ordina prima le coincidenze di **centro, data e ora** (anche su campi diversi dello stesso centro), poi la **stessa data e centro con orari diversi**, infine la **stessa data con centri diversi**. Ogni data usa il livello migliore disponibile per quell'avversario; lo stesso avversario può comparire in più livelli per date diverse. Le alternative indicano esplicitamente le disponibilità dichiarate di ciascuno e sono **da concordare**, non orari già compatibili. Nel Padel a coppie tutti e quattro devono aver dichiarato disponibilità per quella data; solo la prima categoria ha un centro e un orario comuni a tutti. Slot occupati, scaduti o passati e date escluse non producono suggerimenti. Non vengono effettuate prenotazioni automatiche; le alternative non modificano le disponibilità dei giocatori. I ranking mantengono il confronto settimanale descritto sopra.

## Prenotazioni autonome dei campi nei tornei Tennis e Padel

Nel tab amministratore **Controllo partite**, il filtro del numero di partite (incluso **Completato**) si combina con **Torneo** e **Girone**. Selezionare un torneo per vedere tutti i suoi gironi o sceglierne uno specifico; cambiando torneo il girone viene azzerato. **Tutti i tornei** ripristina la vista complessiva dell'evento.

Non occorre più inserire slot manualmente. Le schede amministratore **Prenota campo Canottieri Salò** e **Prenota campo Paitone Arena** mostrano le istruzioni e i collegamenti ai gestionali dei circoli, senza moduli di inserimento slot.

Nel tab **Partite**, **Prenota** apre due riquadri: **Canottieri Salò** apre [Playtomic](https://playtomic.com/it/clubs/tennis-salo-canottieri), **Paitone Arena** apre [Wansport](https://paitonearena.wansport.com/). Il collegamento si apre in una nuova scheda e seleziona il centro nell'app, mantenendo aperta la finestra della partita. L'utente completa autonomamente la prenotazione del campo sul sito del circolo, torna nella scheda dell'app, inserisce lo stesso **giorno** e **orario**, l'eventuale **campo** e conferma di aver già prenotato. Se il campo è già prenotato può selezionare direttamente il centro nel modulo, senza ripetere l'operazione sul sito esterno.

**Registra partita nell'app** salva centro, data/ora e campo sulla partita in una transazione Firestore, senza creare slot né richiedere un calendario amministratore. Il giorno e l'ora sono interpretati nel fuso locale del dispositivo, come il calendario esistente, e salvati in formato ISO. Sono obbligatori centro valido, data/ora futura e conferma esplicita. Il modulo resta aperto con i dati inseriti in caso di errore, consentendo di riprovare senza prenotare nuovamente il campo.

La registrazione è disponibile per gli incontri di girone, playoff e consolazione dei tornei Tennis e Padel, sia all'organizzatore sia ai giocatori coinvolti, inclusi entrambi i componenti delle coppie. La transazione ricontrolla stato della partita e autorizzazioni, preserva modifiche indipendenti e impedisce doppie registrazioni concorrenti della stessa partita. Se è indicato un campo, ricontrolla anche altre partite dello stesso evento per identico centro, campo e istante; senza campo non blocca un intero centro allo stesso orario. Questo controllo non conosce durata, campi liberi o prenotazioni di altri eventi/clienti: la disponibilità effettiva è gestita esclusivamente dal circolo.

Il tab amministratore **Prenotazioni partite** riepiloga gli incontri di tutti i tornei dell'evento: **Canottieri Salò** a sinistra e **Paitone Arena** a destra (su schermi piccoli, una sezione sotto l'altra). Mostra giocatori o coppie, torneo, giorno, ora e campo in ordine cronologico. Le prenotazioni precedenti, anche passate o completate, restano visibili; centri non riconosciuti o dati mancanti vengono evidenziati separatamente.

**Modifica prenotazione** usa lo stesso percorso con i dati attuali precompilati e richiede una nuova conferma. Spostare una vecchia prenotazione basata su slot rimuove solo il collegamento della partita al vecchio slot. **Annulla prenotazione** o **Cancella prenotazione**, dopo conferma, elimina solo la registrazione nell'app, lasciando la partita da giocare. Le partite completate restano di sola lettura per le prenotazioni.

**Non c'è integrazione con le API di Playtomic o Wansport:** aprire il collegamento non garantisce o conferma la prenotazione, e salvare/modificare/annullare nell'app non prenota, sposta o libera campi nei gestionali esterni. L'utente deve effettuare anche le modifiche o cancellazioni presso il circolo. I messaggi di prenotazione e annullamento lo indicano esplicitamente. Non viene promesso un ritorno automatico dai siti esterni: l'utente torna nella scheda dell'app.

Anche le nuove esclusioni di date della scheda disponibilità sono salvate con `eventId` e `tournamentId`: indicare una data come non disponibile in un torneo non modifica gli altri. Le vecchie esclusioni senza questi riferimenti restano archiviate, ma non vengono applicate automaticamente a tutti i calendari.

Gli slot già presenti in `tournament.timeSlots` e `event.globalTimeSlots`, le relative preferenze e le prenotazioni storiche vengono conservati, senza migrazioni distruttive. Le nuove disponibilità per data/fascia non richiedono slot amministrativi e non influiscono sulle prenotazioni di campo esterne. I vecchi slot continuano ad alimentare soltanto la scheda espandibile delle vecchie preferenze e le relative proposte compatibili in **Cerca partita**. La pulizia esistente elimina ancora i soli slot liberi con `expiresAt` scaduto, preservando quelli prenotati; i dati delle nuove registrazioni non hanno uno slot da far scadere. I ranking mantengono il proprio percorso separato.

## Smartphone, navigazione e gestione risultati

Quando un partecipante apre un evento, l'elenco scorre automaticamente fino alla scheda **Il mio torneo**, senza aprire il torneo o nascondere gli altri. Il riconoscimento usa l'assegnazione ai gironi, inclusa la coppia del giocatore nel Padel. Se il partecipante è in più tornei, viene raggiunto il primo nell'ordine dell'elenco; senza assegnazione e per gli organizzatori non viene effettuato lo scorrimento personale. Il posizionamento avviene una sola volta per ingresso nell'evento, anche se l'assegnazione arriva dopo il caricamento, senza ripetersi agli aggiornamenti Firebase.

Aprire una pagina, cambiare scheda o girone porta all'inizio della sezione selezionata, senza riportare in alto durante aggiornamenti Firebase o compilazione dei moduli. Nel ranking Tennis resta disponibile il posizionamento automatico sulla propria riga. Le tabelle ampie scorrono orizzontalmente nel proprio riquadro; nomi lunghi e azioni delle partite vanno a capo sugli schermi piccoli.

**Prenota**, **Modifica prenotazione**, **Inserisci risultato** e **Modifica risultato** delle partite aprono finestre centrate nello schermo, non ancorate al pulsante. Le finestre hanno scorrimento interno, tengono conto dell'altezza disponibile anche in orizzontale, bloccano lo scorrimento della pagina e mantengono il focus al loro interno. Escape chiude senza salvare, salvo durante un salvataggio; alla chiusura il focus ritorna al controllo precedente senza spostare la pagina.

I partecipanti gestiscono le proprie partite, inclusi entrambi i componenti delle coppie nei tornei Padel. Nei tornei si possono spostare o annullare prenotazioni non completate, inserire/modificare/eliminare risultati. Eliminare un risultato non elimina la prenotazione: la partita torna **Programmata** se conserva data/slot, altrimenti **Da fare**. Playoff e consolazione usano lo stesso salvataggio; cambiare vincitore o eliminare un risultato viene bloccato se modifica un turno successivo già prenotato o giocato: prima occorre annullare quel risultato o prenotazione.

Nel ranking Tennis le partite prenotate hanno **Modifica prenotazione** e **Annulla prenotazione**; **Elimina risultato** conserva anche le prenotazioni manuali senza identificativo dello slot. Nel ranking Padel individuale, dove si registrano partite già giocate con quattro partecipanti, ciascuno dei quattro può modificare o eliminare la propria partita, con ricalcolo dei punti. La registrazione e la modifica avvengono in una finestra dedicata.

I punteggi richiedono numeri interi non negativi; nei tabelloni a eliminazione e nel Padel individuale non è ammesso il pareggio. Le conferme di prenotazioni e risultati dei tornei e le modifiche ai dati ranking vengono inviate subito a Firebase e attendono il completamento della transazione, senza mostrare prima un successo locale. I listener aggiornano gli altri dispositivi; errori di rete o permessi restano visibili e non chiudono il modulo come se fosse salvato. Scritture concorrenti di partite diverse vengono conservate; modifiche incompatibili alla stessa partita richiedono di riaprire l'editor. I campi dei moduli restano bozze fino alla conferma e le transazioni richiedono una connessione attiva. Questi controlli applicativi non sostituiscono le regole di sicurezza Firestore.

## Persistenza e aggiornamenti Firebase

I dati applicativi delle schermate attive provengono dai listener Firestore di eventi, giocatori, utenti e disponibilità. Aggiunte, modifiche e cancellazioni attendono il salvataggio prima di confermare il successo: gli aggiornamenti non vengono pubblicati direttamente nello stato locale degli archivi. Un avviso segnala dati da cache o scritture ancora in corso; gli errori dei listener sono visibili anche durante l'accesso, con la possibilità di ricaricare la sincronizzazione, senza cancellare la sessione per un semplice errore di lettura. Se un altro amministratore elimina l'evento o il torneo aperto, la navigazione torna alla sezione ancora esistente.

Anche gestione di tornei, gironi, squadre, assegnazioni, regolamenti, impostazioni e generazione/reset dei tabelloni usa transazioni con lettura aggiornata. Le modifiche indipendenti vengono conservate, incluse prenotazioni e risultati arrivati nel frattempo; operazioni distruttive o valori incompatibili richiedono di riaprire la modifica. Le bozze dei regolamenti e delle impostazioni seguono gli aggiornamenti remoti finché non vengono modificate dall'utente, poi mantengono il valore iniziale per rilevare conflitti.

Nome, telefono, avatar e punti iniziali sono aggiornati insieme nell'archivio globale e nelle copie del giocatore presenti negli eventi delle quattro modalità. La creazione da gestione giocatori salva account, profilo e associazioni selezionate in un'unica transazione; l'associazione di un giocatore esistente rilegge il suo profilo globale. La rimozione dal solo evento ranking ricontrolla i collegamenti sulle partite più recenti. L'eliminazione globale aggiorna insieme account collegati, preferenze, archivio e copie negli eventi; se il giocatore è ancora collegato a squadre, gironi o partite di un torneo standard, viene bloccata con un messaggio per evitare riferimenti incompleti: rimuovere prima quei collegamenti. La modifica della propria password verifica il valore attuale nel documento utente prima di salvare.

Le coppie Padel del giocatore non più assegnate a gironi o partite vengono rimosse insieme al profilo; le coppie ancora assegnate bloccano invece l'eliminazione. Anche le preferenze di disponibilità mostrano una selezione come salvata solo dopo una notifica Firestore senza scritture pendenti, con indicazione del salvataggio in corso.

Filtri, navigazione e campi non ancora confermati restano intenzionalmente locali: non sono modifiche salvate ai dati dell'evento. Gli aggiornamenti tra dispositivi richiedono una connessione attiva e regole Firestore che consentano le letture/scritture coinvolte; non viene dichiarato riuscito un salvataggio se Firebase lo rifiuta. Le transazioni non aggirano i limiti Firestore né sostituiscono autorizzazioni server.
