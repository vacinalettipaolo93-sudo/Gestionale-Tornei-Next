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

Nei tornei vengono proposti solo gli avversari di incontri non completati del torneo, inclusi playoff e consolazione già definiti. Entrambi devono aver selezionato **Voglio giocare** sullo stesso slot futuro e libero, senza aver escluso quella data. Nel Padel a coppie la scheda **Disponibilità di gioco** raccoglie le preferenze dei singoli giocatori e lo slot deve essere scelto da tutti e quattro. Le preferenze usano le collezioni Firebase esistenti `slot_preferences` e `date_unavailabilities`, aggiornate in tempo reale; non vengono effettuate prenotazioni automatiche.

## Slot e prenotazioni dei tornei Tennis e Padel

Nella pagina amministratore dell'evento, accanto a **Tornei** e **Lista giocatori**, le schede **Slot orari Canottieri Salò** e **Slot orari Paitone Arena** aggiungono slot liberi con giorno, ora e campo al calendario dell'evento, senza selezionare un torneo. Per inserire più campi alla stessa ora, aggiungere uno slot per ciascun campo. I nuovi slot sono salvati in `events/{eventId}.globalTimeSlots` con un identificativo del centro e compaiono in tutti i tornei dell'evento; gli slot prenotati non sono eliminabili finché non viene annullata la relativa prenotazione.

Nel tab **Partite**, **Prenota** mostra prima due riquadri per scegliere il centro, poi gli slot liberi raggruppati per giorno con orario e campo. La conferma salva sulla partita centro, data, ora, campo e identificativo dello slot. Anche **Modifica prenotazione** usa lo stesso percorso. Prenotare un campo a un dato orario lo rende occupato in tutti i tornei dell'evento (gironi, playoff e consolazione); annullare o spostare la prenotazione libera il vecchio slot per tutti. Eventi diversi restano completamente indipendenti.

L'occupazione viene ricontrollata sui dati più recenti in una transazione Firestore: due prenotazioni concorrenti sullo stesso slot, anche da tornei diversi dello stesso evento, non vengono accettate entrambe. Campi diversi o centri diversi rimangono prenotabili allo stesso orario. La scheda disponibilità e **Cerca partita** usano lo stesso calendario condiviso nell'evento.

Anche le nuove esclusioni di date della scheda disponibilità sono salvate con `eventId` e `tournamentId`: indicare una data come non disponibile in un torneo non modifica gli altri. Le vecchie esclusioni senza questi riferimenti restano archiviate, ma non vengono applicate automaticamente a tutti i calendari.

Gli slot già presenti in `tournament.timeSlots` e `event.globalTimeSlots` vengono letti insieme e condivisi tra tutti i tornei dell'evento senza migrazioni distruttive o modifiche agli identificativi. Restano valide anche le prenotazioni esistenti e i nomi storici dei centri; gli slot di altri centri sono accessibili da **Altri slot esistenti dell'evento**. Eliminare uno slot libero ne rimuove tutte le copie con lo stesso identificativo nell'evento.
