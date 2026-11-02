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
