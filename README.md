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

In **Controllo Utenti**, il pulsante **Nome e telefono** permette di modificare i dati del giocatore collegato all'account. Il nome è obbligatorio; il telefono può essere modificato o svuotato. Dopo la conferma, un'unica transazione Firestore aggiorna l'archivio globale `players` e le copie del giocatore negli eventi, inclusi tornei e ranking Tennis e Padel. I listener esistenti mostrano i dati aggiornati anche agli altri utenti. Username, password, identificativo, iscrizioni, risultati e punti del giocatore non cambiano. Gli account senza giocatore collegato mantengono le sole azioni su username e password.

## Cerca partita per i partecipanti

Nel tab **Partite** di tutte le modalità, **Cerca partita** propone avversari con disponibilità dichiarate in comune e permette di contattarli. **Modifica disponibilità** apre la scheda per inserirle o aggiornarle; l'assenza di dichiarazioni non viene interpretata come disponibilità.

Nei ranking Tennis e Padel individuale si confrontano giorno della settimana e fascia oraria, rispettando anche i formati storici delle disponibilità e le esclusioni salvate. Nel Tennis gli avversari devono essere ancora sfidabili secondo il limite di incontri del regolamento e il pulsante **Sfida** apre la creazione partita esistente. Nel Padel individuale i suggerimenti riguardano il singolo avversario: occorre concordare anche gli altri due giocatori per completare le coppie.

Nei tornei Tennis e Padel, **Disponibilità di gioco** richiede prima di scegliere **Canottieri Salò**, **Paitone Arena** o **Entrambi i centri**; poi si seleziona una data e si indica **Voglio giocare** sugli orari desiderati. Si possono salvare orari su più date. La scelta dei centri è persistita in `availability_settings/{eventId}_{tournamentId}_{playerId}` con `venueIds`: conta solo la disponibilità nei centri attualmente selezionati. Le preferenze precedenti degli altri centri restano archiviate e si riattivano se il giocatore li seleziona di nuovo. Per le vecchie disponibilità senza una scelta di centri salvata continuano a valere le preferenze degli slot esistenti; la scheda richiede la scelta del centro al prossimo inserimento. Le preferenze orarie e le esclusioni continuano a usare `slot_preferences` e `date_unavailabilities`, con aggiornamenti in tempo reale.

**Cerca partita** propone solo avversari degli incontri non completati del torneo, inclusi playoff e consolazione già definiti. Ordina prima le coincidenze di **centro, data e ora** (anche su campi diversi dello stesso centro), poi la **stessa data e centro con orari diversi**, infine la **stessa data con centri diversi**. Ogni data usa il livello migliore disponibile per quell'avversario; lo stesso avversario può comparire in più livelli per date diverse. Le alternative indicano esplicitamente le disponibilità dichiarate di ciascuno e sono **da concordare**, non orari già compatibili. Nel Padel a coppie tutti e quattro devono aver dichiarato disponibilità per quella data; solo la prima categoria ha un centro e un orario comuni a tutti. Slot occupati, scaduti o passati e date escluse non producono suggerimenti. Non vengono effettuate prenotazioni automatiche; le alternative non modificano le disponibilità dei giocatori. I ranking mantengono il confronto settimanale descritto sopra.

## Slot e prenotazioni dei tornei Tennis e Padel

Nel tab amministratore **Controllo partite**, il filtro del numero di partite (incluso **Completato**) si combina con **Torneo** e **Girone**. Selezionare un torneo per vedere tutti i suoi gironi o sceglierne uno specifico; cambiando torneo il girone viene azzerato. **Tutti i tornei** ripristina la vista complessiva dell'evento.

Nella pagina amministratore dell'evento, accanto a **Tornei** e **Lista giocatori**, le schede **Slot orari Canottieri Salò** e **Slot orari Paitone Arena** aggiungono slot liberi con giorno, ora e campo al calendario dell'evento, senza selezionare un torneo. Per inserire più campi alla stessa ora, aggiungere uno slot per ciascun campo. I nuovi slot sono salvati in `events/{eventId}.globalTimeSlots` con un identificativo del centro e compaiono in tutti i tornei dell'evento; gli slot prenotati non sono eliminabili finché non viene annullata la relativa prenotazione.

Nel tab **Partite**, **Prenota** mostra prima due riquadri per scegliere il centro, poi gli slot liberi raggruppati per giorno con orario e campo. La conferma salva sulla partita centro, data, ora, campo e identificativo dello slot. Anche **Modifica prenotazione** usa lo stesso percorso. Prenotare un campo a un dato orario lo rende occupato in tutti i tornei dell'evento (gironi, playoff e consolazione); annullare o spostare la prenotazione libera il vecchio slot per tutti. Eventi diversi restano completamente indipendenti.

L'occupazione viene ricontrollata sui dati più recenti in una transazione Firestore: due prenotazioni concorrenti sullo stesso slot, anche da tornei diversi dello stesso evento, non vengono accettate entrambe. Campi diversi o centri diversi rimangono prenotabili allo stesso orario. La scheda disponibilità e **Cerca partita** usano lo stesso calendario condiviso nell'evento.

Il tab amministratore **Slot orari prenotati** riepiloga le prenotazioni di tutti i tornei dell'evento: **Canottieri Salò** a sinistra e **Paitone Arena** a destra (su schermi piccoli, una sezione sotto l'altra). Ogni voce mostra giocatori o coppie Padel con i loro componenti, torneo, giorno e ora della partita e campo, in ordine cronologico, per la trascrizione manuale nei gestionali dei centri. Legge le prenotazioni Firebase esistenti, aggiornandosi con spostamenti e annullamenti senza creare copie dei dati o riservare automaticamente campi nei gestionali esterni. Restano visibili anche le prenotazioni passate e delle partite completate; eventuali centri non riconosciuti o dati mancanti vengono evidenziati separatamente.

Da questo riepilogo, **Modifica prenotazione** riapre la scelta di centro, giorno, orario e campo; **Cancella prenotazione**, dopo conferma, libera il campo senza eliminare la partita. Entrambe le operazioni usano le stesse transazioni delle altre schermate, ricontrollando disponibilità e stato della partita. Le partite completate restano di sola lettura.

In alto nel modulo di inserimento di ciascun centro, **Slot disponibili fino a** imposta una data e ora di scadenza opzionale, salvata come `expiresAt` sui soli nuovi slot inseriti con quel valore. Modificare o svuotare il campo non cambia gli slot già salvati; lasciarlo vuoto crea slot senza scadenza. Alla scadenza gli slot liberi scompaiono automaticamente dai calendari, dalle disponibilità e da **Cerca partita**, anche con la schermata già aperta; la transazione impedisce di prenotarli da una finestra rimasta aperta. Gli slot occupati e le relative partite vengono conservati. Annullare o spostare una prenotazione dopo la scadenza rimuove lo slot liberato invece di riproporlo agli utenti.

La rimozione fisica degli slot liberi scaduti da Firebase avviene automaticamente al primo accesso successivo alla scadenza, sia di un amministratore sia di un giocatore iscritto all'evento, anche dalla dashboard senza aprire il torneo. La pulizia resta attiva durante la sessione e nelle transazioni di gestione slot/prenotazioni. I giocatori puliscono solo gli eventi ai quali sono iscritti; l'amministratore può pulire tutti gli eventi. Accessi contemporanei ricontrollano i dati con transazioni, conservando gli slot prenotati. A sito chiuso non viene eseguito alcun processo server: gli slot rimangono comunque non visibili e non prenotabili dopo la scadenza. Eventuali errori di pulizia sono segnalati all'utente con un pulsante per riprovare, senza riaprire gli slot scaduti. La scadenza segue l'orologio del dispositivo; non sostituisce una regola di sicurezza o un processo server.

Anche le nuove esclusioni di date della scheda disponibilità sono salvate con `eventId` e `tournamentId`: indicare una data come non disponibile in un torneo non modifica gli altri. Le vecchie esclusioni senza questi riferimenti restano archiviate, ma non vengono applicate automaticamente a tutti i calendari.

Gli slot già presenti in `tournament.timeSlots` e `event.globalTimeSlots` vengono letti insieme e condivisi tra tutti i tornei dell'evento senza migrazioni distruttive o modifiche agli identificativi. Restano valide anche le prenotazioni esistenti e i nomi storici dei centri; gli slot di altri centri sono accessibili da **Altri slot esistenti dell'evento**. Eliminare uno slot libero ne rimuove tutte le copie con lo stesso identificativo nell'evento.

## Smartphone, navigazione e gestione risultati

Aprire una pagina, cambiare scheda o girone porta all'inizio della sezione selezionata, senza riportare in alto durante aggiornamenti Firebase o compilazione dei moduli. Nel ranking Tennis resta disponibile il posizionamento automatico sulla propria riga. Le tabelle ampie scorrono orizzontalmente nel proprio riquadro; nomi lunghi e azioni delle partite vanno a capo sugli schermi piccoli.

**Prenota**, **Modifica prenotazione**, **Inserisci risultato** e **Modifica risultato** delle partite aprono finestre centrate nello schermo, non ancorate al pulsante. Le finestre hanno scorrimento interno, tengono conto dell'altezza disponibile anche in orizzontale, bloccano lo scorrimento della pagina e mantengono il focus al loro interno. Escape chiude senza salvare, salvo durante un salvataggio; alla chiusura il focus ritorna al controllo precedente senza spostare la pagina.

I partecipanti gestiscono le proprie partite, inclusi entrambi i componenti delle coppie nei tornei Padel. Nei tornei si possono spostare o annullare prenotazioni non completate, inserire/modificare/eliminare risultati. Eliminare un risultato non elimina la prenotazione: la partita torna **Programmata** se conserva data/slot, altrimenti **Da fare**. Playoff e consolazione usano lo stesso salvataggio; cambiare vincitore o eliminare un risultato viene bloccato se modifica un turno successivo già prenotato o giocato: prima occorre annullare quel risultato o prenotazione.

Nel ranking Tennis le partite prenotate hanno **Modifica prenotazione** e **Annulla prenotazione**; **Elimina risultato** conserva anche le prenotazioni manuali senza identificativo dello slot. Nel ranking Padel individuale, dove si registrano partite già giocate con quattro partecipanti, ciascuno dei quattro può modificare o eliminare la propria partita, con ricalcolo dei punti. La registrazione e la modifica avvengono in una finestra dedicata.

I punteggi richiedono numeri interi non negativi; nei tabelloni a eliminazione e nel Padel individuale non è ammesso il pareggio. Le conferme di prenotazioni e risultati dei tornei e le modifiche ai dati ranking vengono inviate subito a Firebase e attendono il completamento della transazione, senza mostrare prima un successo locale. I listener aggiornano gli altri dispositivi; errori di rete o permessi restano visibili e non chiudono il modulo come se fosse salvato. Scritture concorrenti di partite diverse vengono conservate; modifiche incompatibili alla stessa partita richiedono di riaprire l'editor. I campi dei moduli restano bozze fino alla conferma e le transazioni richiedono una connessione attiva. Questi controlli applicativi non sostituiscono le regole di sicurezza Firestore.
