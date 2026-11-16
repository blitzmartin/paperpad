# Porting di PaperPad su Android (tablet)

Piano tecnico per portare PaperPad su tablet Android e distribuirlo come APK.

## Decisioni prese

| Tema | Decisione |
|---|---|
| Distribuzione | Solo APK in sideload dalla pagina [Releases](../../releases). Niente Play Store. |
| Dispositivi | Solo tablet. I telefoni sono fuori scope: l'app non viene bloccata su telefono, ma non viene ottimizzata né testata lì. |
| Tecnologia | Tauri 2 per Android. |
| Obiettivo minimo | Scrivere testo e leggere i documenti PaperPad (HTML). Tutto ciò che complica troppo il porting si può escludere. |
| Architettura | Un core condiviso (editor, formato, export, backend Rust comune) e due shell separate: desktop e mobile. Nessuna delle due contiene codice dell'altra. |
| Progetto Rust | Uno solo (`src-tauri`), con il codice di piattaforma dietro `#[cfg(desktop)]` e `#[cfg(mobile)]`. |
| Build Android | Locale, firmata sulla macchina di chi rilascia. L'APK si allega a mano alla release GitHub. La CI fa solo controlli, senza firma né upload. |
| Versione | Una sola, in parallelo con il desktop. L'APK va nella stessa release degli installer desktop. |

## Perché Tauri 2 e non altro

PaperPad è già un'app Tauri 2 con frontend TypeScript e ProseMirror senza framework, e Tauri 2 supporta Android direttamente (`tauri android init` e `tauri android build --apk`). Il core del frontend e la logica Rust (stato, token, archivio delle versioni, base64) restano gli stessi.

| Alternativa | Perché è scartata |
|---|---|
| Capacitor | Il backend Rust andrebbe riscritto in TypeScript o Kotlin: due backend da mantenere per lo stesso modello di sicurezza. |
| PWA o TWA | La TWA richiede un dominio web e quindi la rete, contro il principio local-first. Chrome Android non ha la File System Access API. |
| React Native o Expo | ProseMirror ha bisogno del DOM, quindi servirebbe comunque una WebView (expo-dom). Si riscriverebbe la UI senza alcun vantaggio. |
| Kotlin nativo | Riscrittura completa. |

Il porting in sé costa poco. Il costo vero sta nei punti in cui il codice dà per scontato un desktop, descritti qui sotto.

## Fattibilità in sintesi

Il backend dà per scontati i percorsi su disco in quattro punti: lettura (`fs::read`), scrittura (`write_atomic`), creazione di file accanto a un altro (`save_conflict_copy`, `ensure_extension`) e persistenza dei riferimenti (`recent.json`, `documents-folder.json`). Su Android i selettori di file restituiscono URI `content://`, non percorsi. Quasi tutto il resto deriva da questo.

### Facile da includere

| Funzione | Perché |
|---|---|
| Editor e formattazione di base | Core condiviso, gira nella WebView Chromium senza modifiche. |
| Apertura di HTML, MD e TXT | Il dialog di apertura di `tauri-plugin-dialog` funziona su Android e restituisce un URI. La lettura passa per `tauri-plugin-fs` lato Rust, il parsing (`parseDocument`) non cambia. |
| Salva con nome | Dialog di salvataggio con `ACTION_CREATE_DOCUMENT`. `ensure_extension` non serve. |
| Visualizzazione delle immagini | Le immagini sono nel documento (base64) e le mostra lo schema. |
| Inserimento di immagini (facoltativo) | `pick_image` restituisce già solo i byte: cambia solo la sorgente, da percorso a URI. |
| Storico versioni | L'archivio sta in `app_data_dir`, che su Android è un vero percorso nella sandbox dell'app. Vedi [Storico versioni](#storico-versioni). |
| Crash recovery e autosave | Logica invariata. Cambiano solo i trigger (vedi [Ciclo di vita](#ciclo-di-vita)). |
| Font | `src/editor/palette.ts` include già Atkinson Hyperlegible, Inter e Literata (`bundled: true`). |

### Includibile con compromessi

| Funzione | Compromesso |
|---|---|
| Rilevamento dei conflitti e reload | Il confronto del fingerprint funziona su qualsiasi URI leggibile, ma dipende dal provider cloud, che può servire una copia in cache. Il rilevamento diventa "best effort": non perde dati, ma può accorgersi tardi di una modifica fatta altrove. |
| Scrittura | Non atomica: su `content://` si scrive in modalità truncate (`"wt"`). Un crash a metà scrittura può lasciare il file troncato. Lo storico compensa, perché `save_document` archivia la copia prima di scrivere il file. |
| "Keep both" nei conflitti | Senza permesso sulla cartella non si può creare un file accanto all'originale. Su Android "Keep both" apre il dialog Salva con nome con il nome del file di conflitto già proposto. |
| Cartella PaperPad / cartella cloud | Su Android i servizi cloud non tengono una cartella locale sincronizzata. Vedi [Cartella cloud e sincronizzazione](#cartella-cloud-e-sincronizzazione). |
| File recenti | Solo per la sessione nella v1. Persistenti nella v2, con i permessi URI persistenti. |
| Nome del file | Da un URI non si ricava con `file_name(path)`: serve una query `DISPLAY_NAME` al ContentResolver. |
| IME e Gboard | ProseMirror ha codice specifico per Android, ma va testato su un tablet reale. |

### Da escludere (almeno nella v1)

| Funzione | Motivo | Ritorno possibile |
|---|---|---|
| Stampa ed export PDF | `window.print()` nella WebView Android non fa nulla. | v2, con un plugin Kotlin con `PrintManager`. |
| Export MD, TXT, RTF e DOCX | Fuori dall'obiettivo minimo. Tecnicamente facili: cambia solo la destinazione, come per Salva con nome. | Quando serve. |
| Menubar, menu contestuale, dialog Stili, Opzioni | Strumenti desktop pensati per il mouse. La shell mobile non li ha. | No: se servono, si progettano per il touch. |
| Cartella sincronizzata come su desktop con Dropbox e OneDrive | Su Android non esiste una cartella locale mirror, solo il provider. | Mai per questi provider. Con Syncthing sì, nella v2. |
| Scrittura atomica sui file nel cloud | Limite dello Storage Access Framework. | No, compensata dallo storico. |
| Dialog "unsaved changes" alla chiusura | `CloseRequested` non arriva mai su Android. | Non serve: lo sostituiscono autosave e recovery. |
| Controllo ortografico come opzione | Lo fa Gboard, non la WebView. | No. |
| Fedeltà dei font di Windows (Arial, Times, Courier) | I font mancano. | v2 con Liberation (metriche compatibili), se serve. |

### Perimetro della v1

Nuovo, apri, salva, Salva con nome, formattazione di base, visualizzazione delle immagini, recovery, autosave attivo di default, rilevamento dei conflitti. Inserimento di immagini e storico versioni sono facoltativi: il backend li supporta già, manca solo la UI. I file si aprono e si salvano direttamente dai provider cloud tramite il selettore di sistema.

Se lo spike conferma che `tauri-plugin-fs` legge e scrive su `content://` da Rust e restituisce il nome del file, la v1 non richiede codice Kotlin. Il Kotlin entra solo nella v2 (stampa, cartella, recenti persistenti).

## 1. Architettura: core condiviso e shell separate

`src/editor`, `src/io` ed `src/export` non importano mai `src/ui` né `src/app.ts`. Il core esiste già. La versione mobile è una seconda shell sopra lo stesso core.

```
src/
  editor/ io/ export/   core condiviso
  ui-kit/               core condiviso: dialog, DOM, icone, tema, immagini, impostazioni dello storico
  styles/               CSS condiviso (main.css è l'entry desktop), styles/desktop/ solo desktop
  app.ts, ui/           shell desktop
  mobile/               shell mobile: main.ts (barre e menu), session.ts (documento), mobile.css
index.html              entry desktop
mobile.html             entry mobile
```

Regole:

- **Stesso schema e stesso serializzatore.** La shell mobile può offrire meno comandi, ma deve usare `src/editor/schema.ts` e `src/io/native.ts`. Con uno schema ridotto, aprire e salvare su tablet un documento creato su desktop cancellerebbe stili, allineamenti delle immagini, numeri di pagina e colori.
- **Le shell non si importano a vicenda.** `src/mobile` non importa `src/ui` né `app.ts`, e viceversa. Il core non importa nessuna delle due.
- **Niente eccezioni al confine.** Se un modulo di `src/ui` serve anche al mobile (per esempio la lettura delle preferenze in `theme.ts` o i dati puri di `autosave.ts`), si sposta nel core.
- **`src/io/backend.ts` con export nominati.** Oggi è un unico oggetto `backend`, che Vite non riesce ad alleggerire per singola proprietà. Con un export per comando ogni shell include solo i wrapper che usa.
- **Rust.** I comandi specifici vanno in moduli dichiarati con `#[cfg(desktop)]` o `#[cfg(mobile)]` (i cfg li imposta `tauri-build`). `archive.rs`, `state.rs` e `base64.rs` restano condivisi. `zip.rs` serve solo al DOCX e resta desktop. `lib.rs` ha due liste `generate_handler!`, e il close guard sta solo nel ramo desktop. `run()` ha bisogno di `#[cfg_attr(mobile, tauri::mobile_entry_point)]`, che sul desktop non fa nulla.

## 2. Separazione delle build

### Cosa è separato

| Livello | Come |
|---|---|
| Strumenti Android (JDK, SDK, NDK, target `aarch64-linux-android`) | Solo sulla macchina di chi rilascia, più il workflow di controllo Android. La CI desktop non li installa. |
| Bundle frontend | Entry diverse (`index.html` e `mobile.html`) con config Vite diverse (`vite.config.ts` e `vite.mobile.config.ts`) e cartelle di output diverse (`dist` e `dist-mobile`). Vite include solo quello che si raggiunge dalla propria entry. |
| Config Tauri | `src-tauri/tauri.android.conf.json` si sovrappone a `tauri.conf.json` solo nelle build Android: `beforeDevCommand`, `beforeBuildCommand`, `devUrl` e `frontendDist` puntano alla shell mobile. |
| Codice Rust compilato | Con `#[cfg(desktop)]` e `#[cfg(mobile)]` il codice dell'altra piattaforma non viene compilato. |
| Permessi | Una capability per piattaforma (`desktop.json` e `android.json`), ciascuna con `"platforms"` esplicito. |
| Rilascio | `release.yml` costruisce solo il desktop. L'APK si carica a mano e `tauri-action` non lo tocca. |
| Cartella di build Rust | `src-tauri/target` ha una sottocartella per ogni target, quindi le due build non si sovrascrivono. |

### Dove i due lati si toccano, e il controllo per ciascuno

| Punto di contatto | Rischio | Controllo |
|---|---|---|
| `Cargo.toml` e `Cargo.lock` condivisi | Una dipendenza solo Android (`tauri-plugin-fs` sotto `[target.'cfg(target_os = "android")'.dependencies]`) non viene compilata sul desktop, ma entra nel lockfile. Se richiede una versione più nuova di una dipendenza comune (serde, per esempio), il lockfile la aggiorna anche per il desktop. La versione di `tauri` è una sola. | Revisione del diff di `Cargo.lock` a ogni dipendenza aggiunta. `cargo update -p <crate>` mirato, mai `cargo update` generico. |
| `tauri.android.conf.json` eredita tutto | È un JSON Merge Patch: tutto quello che non ridefinisce (CSP, finestre, bundle) arriva da `tauri.conf.json`. Gli array vengono sostituiti per intero, non uniti. | Ridefinire esplicitamente tutto quello che conta per Android. Commento in testa a `tauri.conf.json`: le modifiche valgono anche lì. |
| Capability senza `platforms` | Una capability senza `platforms` vale su ogni piattaforma. Oggi `default.json` non lo ha: concederebbe ad Android tutti i comandi desktop e `allow-print`. | `"platforms"` in ogni file, più un test che fallisce se un file non lo ha. Va fatto prima della prima build Android. |
| Un solo `build.rs` | Se la lista `COMMANDS` cambiasse in base al target, una capability desktop che cita un comando assente su Android potrebbe far fallire la build Android (`tauri-build` dovrebbe validare tutti i file di capability, da verificare). | Lista `COMMANDS` completa e unica (genera solo gli identificatori dei permessi). La separazione sta in `generate_handler!` e nelle capability. |
| Typecheck | `npm run build` lancia `tsc --noEmit` su tutto `src`: un errore in `src/mobile` blocca la build desktop. | `tsconfig.desktop.json` e `tsconfig.mobile.json`, ciascuno con core e propria shell. `build` e `build:mobile` usano il proprio. `tsconfig.json` completo resta per l'editor e per `ci.yml`. |
| Test | `npm test` lancia tutto, anche in `release.yml`: un test mobile che fallisce blocca un rilascio desktop. | `tests/core`, `tests/desktop`, `tests/mobile`. `release.yml` lancia core e desktop, `ci.yml` tutto. Lo script `test` va aggiornato: oggi il glob `tests/*.test.ts` non entra nelle sottocartelle. |
| Mobile rotto in silenzio | La CI non compila mai il mobile, e `cargo test` gira solo sull'host. Una modifica al core può rompere la shell mobile o il codice `#[cfg(mobile)]` senza che nessuno lo veda. | Workflow di controllo Android separato (vedi sotto). |
| Versione unica | Qualsiasi release pubblicata fa partire le build desktop: un fix solo Android crea comunque una release desktop. | Accettato (vedi Decisioni prese). La release desktop è identica alla precedente. |
| `rust-toolchain.toml` | Se contenesse i target Android, la CI desktop li scaricherebbe ogni volta. | Target Android installati a mano con `rustup target add`, mai nel file. |
| Dev server | Entrambe le shell sulla porta 1420 si escludono a vicenda. | Porta 1421 per `vite.mobile.config.ts`. |
| `.gitignore` | Oggi esclude tutto `src-tauri/gen/`, ma `gen/android` va versionato (Manifest e firma vengono modificati). | Restringere a `src-tauri/gen/schemas/` e aggiungere `dist-mobile/`. |

### Rischi per la pipeline desktop su GitHub Actions

Il workflow Android non gira su GitHub, quindi non può rompere `release.yml` direttamente. Può però cambiare file che `ci.yml` e `release.yml` leggono. I punti dove passa il rischio:

1. **Dipendenze npm aggiunte per il mobile.** `ci.yml` e `release.yml` lanciano `npm ci`, che esegue gli script di installazione di ogni pacchetto. Il job di build in `release.yml` ha `contents: write`. Il token viene passato solo a `tauri-action` e `checkout` non conserva le credenziali, ma un pacchetto compromesso potrebbe modificare `node_modules/@tauri-apps/cli`, che poi gira proprio dentro `tauri-action` con il token. **Regola: la shell mobile non aggiunge dipendenze npm.** Il plugin fs si usa solo da Rust, quindi `@tauri-apps/plugin-fs` non serve.
2. **Modifiche fatte da `tauri android init`.** Il comando genera `gen/android` e può toccare file condivisi (per esempio `lib.rs` o `Cargo.toml`). Il diff dopo l'init va letto riga per riga prima del commit. `ci.yml` (`cargo test --locked`, `vite build`) lo valida comunque sul desktop.
3. **Lockfile Rust.** Vedi la tabella sopra. `cargo test --locked` in `ci.yml` fallisce se `Cargo.lock` non è aggiornato: è un controllo utile e va lasciato.
4. **Cache Rust.** Un `Cargo.lock` cambiato invalida la cache di `swatinem/rust-cache` e rallenta le build desktop. Il workflow Android va tenuto su una chiave di cache sua (`key: android`), così non riempie quella desktop.
5. **Segreti di firma.** Restano fuori da GitHub: keystore e `keystore.properties` sono sulla macchina di chi rilascia e in `.gitignore`. Un keystore committato per errore in un repo pubblico va considerato compromesso, e la chiave di un'app Android non si può cambiare (vedi [Firma](#firma)). Prima di ogni commit che tocca `gen/android`, controllare `git status`.
6. **Procedura di rilascio.** "Se una piattaforma fallisce, cancella la release e il tag" (`RELEASE.md`) cancella anche l'APK allegato a mano, che va ricaricato. L'APK si carica dopo che le build desktop hanno finito.

### Workflow di controllo Android

Un file separato, `.github/workflows/android-check.yml`, non un job in `ci.yml`:

- Parte su push e pull request che toccano `src/**`, `src-tauri/**`, `package*.json`, `tsconfig*.json` o `vite*.ts`.
- `permissions: contents: read`, nessun segreto, nessuna firma, nessun upload.
- Lancia `tsc -p tsconfig.mobile.json`, `vite build --config vite.mobile.config.ts` e `cargo check --target aarch64-linux-android`. Il terzo potrebbe richiedere l'NDK per alcuni build script: va provato. Se lo richiede, l'installazione dell'NDK sta solo in questo file.
- Non è un controllo obbligatorio per il merge. `RELEASE.md` chiede che `ci.yml` sia verde, non questo workflow: un problema su Android non blocca un rilascio desktop, ma resta visibile.

### Alternativa scartata per ora: due progetti Rust

Un secondo progetto `src-tauri-mobile/` con il suo `Cargo.toml`, il suo lockfile e la sua config separerebbe del tutto dipendenze e versione di Tauri. Il codice comune (`archive.rs`, `state.rs`, `base64.rs`) andrebbe in una crate `paperpad-core` usata da entrambi come path dependency. Non come workspace Cargo: un workspace condivide il lockfile.

Costi: config duplicata (la CSP da tenere allineata a mano), due versioni di Tauri che possono divergere, CLI di Tauri da lanciare dalla cartella giusta, refactor del backend prima dello spike. Diventa conveniente solo se Android forza aggiornamenti di Tauri che il desktop non vuole, o se le dipendenze solo Android crescono. La migrazione resta possibile più avanti, perché il core Rust sarà già isolato dietro `Location`.

## 3. Backend

### File e percorsi (il blocco principale)

`src-tauri/src/commands.rs` e `src-tauri/src/state.rs` lavorano su `PathBuf` e `std::fs`. Su Android il selettore restituisce URI `content://`. Punti da adattare:

- `write_atomic` (file temporaneo e poi rename) non funziona su un URI. Si scrive direttamente in modalità truncate (`"wt"`). Il commento in testa a `commands.rs` ("writes are atomic") va aggiornato per Android.
- `read_file` e `changed_on_disk` usano `fs::metadata`, `is_file` e `fs::read`: passano per la nuova astrazione.
- `save_conflict_copy` crea un file nella cartella dell'originale (`original.parent()`): su Android diventa un Salva con nome con il nome proposto.
- `file_name(path)` va sostituito con una query `DISPLAY_NAME`.
- La lista dei recenti (`recent.json` con i `PathBuf`) perde senso al riavvio, a meno di chiedere permessi persistenti sull'URI (`takePersistableUriPermission`).
- `ensure_extension` non serve: su Android il nome del file lo decide il selettore.

Soluzione adottata: due trasporti separati, regole condivise.

- **Desktop invariato.** I comandi di `commands.rs` restano quelli su percorsi, con la scrittura atomica. Su Android i nove comandi che hanno una versione Android non vengono compilati (`#[cfg(desktop)]`): le macro `#[tauri::command]` generano nomi a livello di crate, quindi due comandi con lo stesso nome non possono convivere.
- **Android in `src-tauri/src/android_io.rs`** (`#[cfg(target_os = "android")]`): apri, salva, Salva con nome, controllo delle modifiche esterne, reload, copia di conflitto, versioni e immagini. Stessi nomi, argomenti e risultati dei comandi desktop, quindi `src/io/backend.ts` è uno solo. Unica differenza: `save_conflict_copy` può restituire `null` (l'utente annulla).
- **Condiviso:** formati, limiti di dimensione, ID del documento, `archive.rs` e le impronte (`state::fingerprint`). Un file salvato sul tablet è identico a uno salvato su desktop.
- **Plugin Kotlin nostro** (`gen/android/app/src/main/java/com/paperboardlabs/paperpad/DocumentsPlugin.kt`) al posto di `tauri-plugin-dialog` e `tauri-plugin-fs`. Il dialog su Android apre con `ACTION_GET_CONTENT`, che può restituire una copia in sola lettura o temporanea (Dropbox, per esempio): il salvataggio fallirebbe, o scriverebbe su una copia che non si sincronizza. Nessuno dei due plugin restituisce il nome del file. Il plugin usa `ACTION_OPEN_DOCUMENT` e `ACTION_CREATE_DOCUMENT`, legge `DISPLAY_NAME` e passa a Rust un file descriptor (`"r"` o `"wt"`), così 32 MB non passano per l'IPC. Apre solo URI scelti dall'utente nella sessione, e nessuna capability concede i suoi comandi alla webview.
- **Scrittura:** `"wt"`, poi `set_len` per i provider che ignorano la `t`, poi `sync_all` (ignorato sulle pipe). Non è atomica: lo storico conserva prima la copia del file sostituito e quella nuova.
- **Storico senza modifiche ad `archive.rs`:** la chiave del documento è `<uri>/<nome>`, e la copia di base al primo salvataggio la fa `android_io`, perché `snapshot` non può leggere un URI.
- Per la v2 (permessi persistenti, cartelle) il plugin Kotlin si estende con `takePersistableUriPermission` e `ACTION_OPEN_DOCUMENT_TREE`. La crate `tauri-plugin-android-fs` resta scartata: è una dipendenza di terze parti su un percorso critico per la sicurezza.

### Storico versioni

`src-tauri/src/archive.rs` scrive in `app_data_dir`, che su Android è un percorso reale, quindi funziona quasi senza modifiche. Due ritocchi:

- `doc_dir` per i file senza ID (Markdown, testo, vecchi file PaperPad) calcola l'hash del percorso: su Android la chiave è `<uri>/<nome>`. Un provider può restituire URI diversi per lo stesso file in momenti diversi, quindi per questi formati lo storico può frammentarsi. I file `.html` hanno l'ID UUID (`data-id`) e non hanno questo problema.
- `snapshot` legge il file originale (`fs::read(doc.path)`) per conservare la copia di base al primo salvataggio. Su Android quella lettura fallisce senza danni e la copia la fa `android_io::save_document`.

Lo storico resta per dispositivo, come su desktop, e si perde se si disinstalla l'app.

### Cartella cloud e sincronizzazione

Su desktop Dropbox, OneDrive e Nextcloud tengono una cartella locale sincronizzata, e PaperPad ci lavora come su qualsiasi cartella. Su Android quei servizi espongono i file come *DocumentsProvider*: una "posizione" nel selettore di sistema, con i file scaricati su richiesta.

- **Cosa funziona:** l'utente apre e salva direttamente da Dropbox, Nextcloud, Drive o OneDrive nel selettore, e il provider carica le modifiche. La sincronizzazione tra dispositivi c'è, ma la gestisce il provider.
- **Cosa cambia:** una cartella PaperPad richiede `ACTION_OPEN_DOCUMENT_TREE` con un permesso persistente. Non tutti i provider supportano il selettore di cartelle: Nextcloud e lo storage locale sì, Dropbox storicamente no. Syncthing (o FolderSync) è il caso migliore, perché crea una vera cartella locale come su desktop.
- **v1:** niente cartella PaperPad su Android. Il selettore di sistema ricorda già l'ultima posizione usata. I comandi `get_documents_folder`, `choose_documents_folder` e `clear_documents_folder` restano solo desktop.
- **v2:** cartella con `ACTION_OPEN_DOCUMENT_TREE` e permesso persistente, utile soprattutto con Syncthing e Nextcloud. Con la cartella, "Keep both" può tornare a creare il file di conflitto accanto all'originale.

Da verificare nello spike:

- Il dialog di salvataggio (`ACTION_CREATE_DOCUMENT`) nella versione di `tauri-plugin-dialog` in uso.
- La lettura e la scrittura su `content://` tramite `tauri-plugin-fs` lato Rust.
- Se plugin-fs o plugin-dialog espongono il nome del file (`DISPLAY_NAME`).
- Se il plugin conserva o meno i permessi sugli URI dopo un riavvio.
- Quanto è aggiornato il contenuto letto da un provider cloud dopo una modifica fatta da un altro dispositivo (Dropbox, Nextcloud, Drive).

### Stampa e PDF (v2)

`window.print()` nella WebView di Android in pratica non fa nulla. Serve un plugin Kotlin minimo che chiami `PrintManager` con `WebView.createPrintDocumentAdapter()`. Così si ottiene anche "Salva come PDF" dal sistema.

Il numero di pagina usa `@page { @bottom-center { ... } }` (`PAGE_NUMBER_CSS` in `src/io/native.ts`). Funziona solo con una WebView Chromium recente: va verificato.

### Ciclo di vita

Tutto questo sta nella shell mobile. La shell desktop non cambia.

- Su Android `CloseRequested` non arriva mai: il sistema chiude il processo quando vuole. Il dialog "unsaved changes" in `src-tauri/src/lib.rs` resta solo desktop.
- Recovery e autosave si scrivono su `visibilitychange` con stato `hidden`, oltre che con il timer.
- Il controllo delle modifiche esterne parte su `visibilitychange` con stato `visible` (sul desktop parte su `window.focus`).
- Il tasto o gesto "indietro" chiude prima un eventuale dialog, e solo dopo esce dall'app.

### Permessi e Manifest

- Il template Android di Tauri include il permesso `INTERNET`, che serve al dev server. Le build release lo tolgono con `gen/android/app/src/release/AndroidManifest.xml` (`tools:node="remove"`): è coerente con "no network" e chiunque può verificarlo con `aapt dump permissions`. Nel Manifest unito resta solo `<applicationId>.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`, un permesso di firma interno che AndroidX aggiunge per i propri receiver: non viene mai chiesto all'utente.
- `capabilities/android.json` concede solo i comandi della shell mobile, senza `core:webview:allow-print` e senza i comandi della cartella.
- In un secondo momento: intent filter per "Apri con PaperPad" su `.html`, `.md` e `.txt` dal file manager.

### Navigation guard

Su Android l'origine è `http://tauri.localhost`, quindi la guard funziona già. In sviluppo però il dev server deve essere raggiungibile dal dispositivo (`TAURI_DEV_HOST` e l'host di Vite), mentre la guard accetta solo `127.0.0.1`. Va aggiunto l'host di sviluppo, sempre e solo nelle build debug.

## 4. Shell mobile

Una UI propria, pensata per il touch, sopra il core condiviso. Non è un adattamento della UI desktop: niente menubar, niente menu contestuale, niente dialog Stili né Opzioni. La UI desktop non riceve codice per il touch.

### Contenuto

- **Barra superiore:** menu (hamburger), nome del documento con `*` per le modifiche non salvate, annulla, ripeti, chiaro/scuro, salva.
- **Menu:** Nuovo, Apri, Salva, Salva con nome, Aggiungi immagine, Vista pagina o continua, Tema (i sei temi del desktop, con le stesse anteprime), About.
- **Toolbar di formattazione in basso**, subito sopra la tastiera, scorrevole in orizzontale: grassetto, corsivo, sottolineato, barrato, togli formattazione, Normale, titoli 1-3, citazione, blocco di codice, elenchi, rientri, allineamento, riga orizzontale, immagine. L'app è disegnata fino ai bordi (`enableEdgeToEdge`) e in questa modalità Android non la ridimensiona per la tastiera: lo fa `MainActivity.kt`, che riduce la WebView dell'altezza della tastiera. `interactive-widget=resizes-content` da solo non basta nella WebView.
- **Tocco per scrivere:** l'editor riempie il foglio, e un tocco intorno al foglio porta il cursore in fondo al documento.
- **Blocco di codice senza frecce:** Gboard non ha le frecce, che sul desktop servono a uscire dal blocco. Due Invio alla fine del blocco ne escono (`exitCodeOnTypedEmptyLine`, perché su Chrome per Android ProseMirror non riceve Invio come tasto, ma come testo). Un blocco di codice alla fine del documento ha sempre un paragrafo vuoto dopo, dove toccare. Usa i comandi di `src/editor/commands.ts` e `src/editor/actions.ts`.
- **Vista continua o vista pagina**, dal menu, ricordata come sul desktop (`paperpad.layout`). La vista pagina usa gli stessi fogli A4 del desktop (`pagesPlugin`, `.page.paged`) e uno zoom che li fa stare in larghezza quando il tablet è più stretto di un A4 (in verticale lo è di poco), ricalcolato quando si ruota il tablet. Il pulsante dei numeri di pagina c'è solo in vista pagina. In vista continua i numeri di pagina restano nel file come sono: il desktop invece li toglie, perché lì quella vista non ha il pulsante.
- **Autosave sempre attivo** per i file HTML già salvati, 15 secondi dopo la prima modifica e subito quando l'app va in background (`visibilitychange`). Recovery sempre attivo. Niente opzioni.
- **Reload** dei file cambiati su un altro dispositivo quando l'app torna in primo piano.
- **Dialog dei conflitti** con "Keep both" che apre Salva con nome.
- **Inserimento di immagini** nella v1. Lo storico versioni subito dopo: il backend archivia già a ogni salvataggio.
- **Font dei nuovi documenti:** Atkinson Hyperlegible, incluso nell'app.
- **Logica dei file separata** da `app.ts`, in `src/mobile/session.ts`, con le stesse regole in forma ridotta. È una duplicazione voluta, così la shell desktop non cambia: si riunisce in un modulo del core quando la shell mobile sarà stabile (vedi [Backlog](#backlog)).

Tutto quello che il documento contiene e la shell non sa modificare (stili personalizzati, colori, font, allineamenti, numeri di pagina) resta nel file così com'è, perché lo schema è lo stesso.

### Requisiti touch

1. **Area di tocco.** Pulsanti di almeno 44-48 px. L'estetica anni '90 si può mantenere nei colori e nelle icone, non nella densità.
2. **Focus e tastiera virtuale.** I pulsanti non devono togliere il focus all'editor, altrimenti la tastiera si chiude. `mousedown` con `preventDefault` basta: sul tablet la tastiera resta aperta (vedi [Risultati dello spike](#risultati-dello-spike)). Niente `<select>` nativi e niente popup che danno il focus a un elemento: entrambi chiudono la tastiera. Viewport con `interactive-widget=resizes-content`, così la tastiera non copre il caret.
3. **Selezione nativa.** Niente handler su `contextmenu`: il long-press deve dare maniglie di selezione e il menu nativo (copia, incolla, suggerimenti di Gboard).
4. **IME.** ProseMirror su Android funziona, ma con Gboard (composizione, backspace, Invio, autocorrezione) è il punto da testare di più. Serve una checklist manuale su un tablet reale, non solo sull'emulatore.
5. **Controllo ortografico.** Lo fa Gboard. Nessuna opzione nella shell.
6. **Tastiera fisica.** Le scorciatoie Ctrl della keymap del core funzionano anche con una tastiera collegata.
7. **Testi.** Nessun riferimento a "computer" o a cartelle sincronizzate: i messaggi parlano del selettore di file e dei provider cloud.

## 5. Font

Arial, Verdana, Trebuchet MS, Georgia, Times New Roman, Courier New e Comic Sans MS non esistono su Android. Un documento creato su Windows si aprirebbe con Roboto o Noto.

- **Default per i nuovi documenti su mobile:** uno dei font già inclusi (Atkinson Hyperlegible, Inter o Literata). Gli stack di fallback restano nei documenti, quindi un file riaperto su desktop torna identico.
- **v2, font con le stesse metriche** solo per i casi più comuni nei documenti importati: Liberation Sans, Serif e Mono al posto di Arial, Times New Roman e Courier New. Costa qualche centinaio di KB di woff2. Va controllato con `tests/fonts.test.ts`, e il README va aggiornato con le licenze. Anche su mobile la differenza tocca la paginazione, in vista pagina.

## 6. Build locale e distribuzione in sideload

### Una volta sola

1. Installare Android Studio (SDK + NDK), JDK 17 e il target Rust: `rustup target add aarch64-linux-android`.
2. `npm run tauri android init`. Il progetto Gradle va in `src-tauri/gen/android`. Leggere il diff dei file condivisi prima del commit (vedi [Rischi per la pipeline desktop](#rischi-per-la-pipeline-desktop-su-github-actions)).
3. Aggiornare `.gitignore`: `src-tauri/gen/schemas/` al posto di `src-tauri/gen/`, più `dist-mobile/`.
4. Creare il keystore **fuori dal repo**, con un backup offline:

   ```sh
   keytool -genkey -v -keystore ~/paperpad-release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias paperpad
   ```

5. Aggiungere `keystore.properties` (in `.gitignore`) e la `signingConfig` in `gen/android/app/build.gradle.kts`, come da guida Tauri per la firma Android.

### Sviluppo sul tablet via Wi-Fi

Con il debug wireless l'app gira sul tablet e ricarica le modifiche senza creare un APK. Mac e tablet sulla stessa rete Wi-Fi.

1. Sul tablet: Opzioni sviluppatore, poi Debug wireless attivo, poi "Associa dispositivo con codice di associazione".
2. Sul Mac, una volta sola: `adb pair <ip>:<porta di associazione>` con il codice mostrato. Dopo l'associazione adb ritrova il tablet da solo sulla rete. Un `adb connect` manuale crea una seconda voce per lo stesso tablet e la CLI chiede quale usare: in quel caso `adb disconnect <ip>:<porta>`.
3. `npm run android:dev`. Lo script crea un tunnel adb (`adb reverse tcp:1421 tcp:1421`) e avvia `tauri android dev --host 127.0.0.1`, che lancia la shell mobile (`npm run dev:mobile`, porta 1421): il tablet raggiunge Vite su `127.0.0.1:1421` attraverso adb. Senza `--host` la CLI usa l'IP del Mac sulla rete locale, Vite (che ascolta solo su `127.0.0.1`) non risponde e la navigation guard bloccherebbe comunque quell'host. Così il dev server non è mai esposto sulla rete.

Il tunnel si perde quando il tablet si scollega da adb: basta rilanciare lo script. La console della webview si apre da Chrome sul Mac con `chrome://inspect`.

### A ogni release

Dopo che le build desktop di `release.yml` hanno finito (passo 6 di `RELEASE.md`) e prima di togliere il flag di pre-release:

```sh
npm run tauri android build -- --apk --target aarch64
apksigner verify --print-certs <percorso-apk>      # firma e impronta SHA-256
aapt dump permissions <percorso-apk>               # INTERNET non deve esserci
cp <percorso-apk> PaperPad_<versione>_android_arm64.apk
gh release upload v<versione> PaperPad_<versione>_android_arm64.apk
```

Il percorso esatto dell'APK sotto `src-tauri/gen/android/app/build/outputs/apk/` si conferma dopo l'init. I passi vanno raccolti in `scripts/android-release.sh`, che legge la versione da `tauri.conf.json` e rifiuta di caricare se la release `v<versione>` non esiste. `RELEASE.md` va aggiornato con questo passo e con l'APK nella tabella "Expected files".

- Un solo APK `arm64-v8a`: quasi tutti i tablet sono arm64. Se servono Chromebook x86 o emulatori, si aggiunge un secondo APK `x86_64` con il nome che lo indica chiaramente.
- Nessun AAB: serve solo al Play Store.

### Firma

- Android non installa un APK non firmato.
- **La chiave non può mai cambiare.** Un aggiornamento firmato con un'altra chiave non si installa sopra la versione precedente: l'utente dovrebbe disinstallare e perderebbe i dati dell'app (opzioni, recovery, storico versioni). I documenti salvati con il selettore di file non vanno persi.
- La build locale non è riproducibile come una build in CI: la fiducia dell'utente si basa solo sulla firma. L'impronta SHA-256 del certificato va pubblicata nelle note di ogni release, così l'utente può verificare l'APK (`apksigner verify --print-certs`).

### Versioni e aggiornamenti

- Tauri ricava `versionCode` da `version` in `tauri.conf.json`, quindi `npm run bump` resta l'unica fonte. Va verificato che `versionCode` cresca sempre a ogni release, altrimenti Android rifiuta l'aggiornamento.
- Nessun aggiornamento automatico: richiederebbe la rete. L'utente scarica il nuovo APK dalla pagina Releases e lo installa sopra il precedente.

### Requisiti del dispositivo

- `minSdk` 24 è il default di Tauri.
- Il vero vincolo è la versione della **WebView di sistema**. Sui tablet senza Play Store (per esempio Fire) la WebView può essere vecchia e alcune funzioni CSS potrebbero rompersi. Va fissata e documentata una versione minima di Chromium.

### Installazione per l'utente (da mettere nel README)

1. Scaricare `PaperPad_x.y.z_android_arm64.apk` dalla pagina Releases.
2. Consentire l'installazione da origini sconosciute per il browser o il file manager usato.
3. Play Protect può mostrare un avviso per le app non distribuite dal Play Store: scegliere "Installa comunque".
4. Permessi richiesti: nessuno.

## 7. Fasi

1. **Separazione (fatta).** `capabilities/desktop.json` con `"platforms"` e `tests/core/capabilities.test.ts`; `tsconfig.desktop.json` e gli script `typecheck:desktop` e `test:desktop`, usati da `release.yml`; test divisi in `tests/core` e `tests/desktop`; `src/io/backend.ts` con un export per comando; `tests/core/boundaries.test.ts` sul confine degli import. Restano da spostare nel core, quando la shell mobile ne avrà bisogno:
   - le regole CSS del documento (classi `.ff-*`, `.fs-*`, `.c-*`, `.hl-*`, immagini, liste), che oggi stanno in `src/styles/main.css` insieme alla UI desktop. `tests/core/fonts.test.ts` e `tests/core/palette.test.ts` leggono quel file e andranno aggiornati;
   - i moduli di sole impostazioni di `src/ui` che servono anche al mobile, per esempio `autosave.ts`, `history.ts` e la lettura delle preferenze in `theme.ts`.
2. **Spike (1-3 giorni).** `tauri android init`, esecuzione su emulatore tablet e su un tablet reale con una shell mobile minima. Verificare: lettura e scrittura su `content://` da Rust, nome del file dall'URI, salvataggio con il dialog su Android, IME con Gboard, aggiornamento dei file letti dai provider cloud. Il resto del piano dipende da questi risultati.
3. **Backend v1.** Astrazione `Location`, I/O su URI, adattamento di `archive.rs` e di `save_conflict_copy`, moduli `#[cfg(mobile)]`, capability Android, Manifest senza `INTERNET`.
4. **Shell mobile v1 (in test).** Vedi [Shell mobile](#4-shell-mobile). `mobile.html`, `src/mobile/`, `vite.mobile.config.ts` (porta 1421, output `dist-mobile`), `tsconfig.mobile.json`, `src-tauri/tauri.android.conf.json` (finestra su `mobile.html`, `devCsp` sulla porta 1421), script `dev:mobile`, `build:mobile`, `typecheck:mobile`. I moduli UI condivisi sono passati in `src/ui-kit/`. Il CSS è diviso in `src/styles/` (condiviso: token e temi, base, pulsanti e icone, documento, finestre, anteprime dei temi) e `src/styles/desktop/` (menubar, status bar, pannelli, dialog, stampa). `main.css` li importa tutti nell'ordine originale, e il CSS della build desktop è risultato identico byte per byte a quello di prima. `mobile.css` importa solo quelli condivisi.
5. **Build e distribuzione.** Keystore, `scripts/android-release.sh`, `android-check.yml`, aggiornamento di `RELEASE.md` e del README, checklist di test manuale su tablet reale.
6. **v2.** Plugin di stampa, cartella PaperPad con `ACTION_OPEN_DOCUMENT_TREE`, recenti persistenti, inserimento di immagini e storico versioni se non già nella v1, font con metriche compatibili, intent filter "Apri con".

## Risultati dello spike

Prima build debug (`tauri android build --debug --apk --target aarch64`) sul tablet, con la UI desktop invariata.

| Verifica | Risultato |
|---|---|
| `tauri android init` | Genera solo `src-tauri/gen/android`, nessun file condiviso toccato. Il suo `.gitignore` esclude già `keystore.properties`, `key.properties` e `local.properties`. |
| Compilazione per Android | Richiede `#[cfg(desktop)]` su `set_parent` (dialog di file) e `parent` (dialog di messaggio), che su Android non esistono. |
| Selettore di cartelle | `blocking_pick_folder` non esiste su Android in `tauri-plugin-dialog` 2.8: la cartella PaperPad nella v1 resta solo desktop. |
| Avvio | L'app parte, con la grafica del desktop. |
| Scrittura con Gboard | Funziona, anche il cambio di font. Checklist IME completa ancora da fare. |
| Tastiera e pulsanti con `mousedown` + `preventDefault` | La tastiera resta aperta (grassetto, corsivo, sottolineato, barrato, allineamento). |
| Tastiera e `<select>` nativi, popup che prendono il focus, menu | La tastiera si chiude (font, colore, menu File). Per Apri e Salva è inevitabile: il selettore di file è un'altra schermata. |
| Focus restituito all'editor da codice (`view.focus()` dopo la scelta di un colore) | La tastiera si riapre da sola. Nella shell mobile bastano popup che non prendono il focus, senza un pannello che sostituisce la tastiera. |
| APK debug | 136 MB (Rust non ottimizzato con simboli di debug), solo `arm64-v8a`, firmato con la chiave di debug, `INTERNET` presente come previsto in debug. |

L'I/O su `content://` passa ora per `android_io.rs` e il plugin Kotlin (vedi [File e percorsi](#file-e-percorsi-il-blocco-principale)). Compila per `aarch64-linux-android`, ma è ancora da provare sul tablet:

- [ ] Il plugin Kotlin registrato dall'app (non da una crate) viene trovato all'avvio. Se no, l'app si chiude subito.
- [ ] Apri da storage locale, Dropbox, Nextcloud e Drive: nome corretto e formato riconosciuto.
- [ ] Salva sullo stesso file, poi verifica sul desktop che il file sincronizzato sia quello aggiornato.
- [ ] Un file accorciato non lascia la coda della versione precedente.
- [ ] Salva con nome: nome proposto, nome finale se il provider lo cambia (`Note (1).html`).
- [ ] Conflitto: modifica il file sul desktop, salva sul tablet, prova "Keep both" (anche annullando) e "Replace it".
- [ ] Aggiungi immagine.
- [ ] Storico versioni dopo qualche salvataggio.
- [ ] Dalla console (`chrome://inspect`), `window.__TAURI_INTERNALS__.invoke("plugin:documents|openDescriptor", { uri: "x", mode: "wt" })` deve essere rifiutato.

## Rischi da verificare nello spike

| Rischio | Impatto se fallisce |
|---|---|
| Lettura e scrittura su `content://` non disponibili lato Rust | Plugin Kotlin per l'I/O con il ContentResolver, oppure `tauri-plugin-android-fs` |
| Nome del file non ricavabile dall'URI con i plugin ufficiali | Piccolo plugin Kotlin per `DISPLAY_NAME` |
| Dialog di salvataggio non supportato su Android dalla versione del plugin | Plugin Kotlin per `ACTION_CREATE_DOCUMENT` |
| Bug IME di ProseMirror con Gboard | Patch o workaround nell'editor, test manuali estesi |
| Tastiera virtuale che si chiude ai tocchi sulla toolbar | Gestione del focus da rivedere nella shell mobile |
| Provider cloud che servono copie in cache | Conflitti rilevati tardi: va scritto nella documentazione per l'utente |
| `tauri-build` che valida le capability di tutte le piattaforme | Conferma la scelta di una lista `COMMANDS` unica in `build.rs` |
| `cargo check` per Android che richiede l'NDK in CI | Installazione dell'NDK in `android-check.yml` |
| Selettore di cartelle non supportato da alcuni provider (v2) | Cartella PaperPad solo con storage locale, Syncthing o Nextcloud |
| `window.print()` inattivo (atteso, v2) | Plugin Kotlin con `PrintManager` |
| Permessi URI non persistenti (v2) | Recenti limitati alla sessione, o plugin Kotlin |

## Backlog

| Tema | Note |
|---|---|
| Tasto indietro di Android | Oggi chiude l'app anche con un dialog o il menu aperti. Con `onBackButtonPress` di `@tauri-apps/api/app` si chiude prima il dialog. Richiede `core:app:allow-register-listener` in `capabilities/android.json`. |
| Storico versioni nella shell mobile | Il backend archivia già. Manca la UI touch: elenco, anteprima, ripristino. |
| Logica dei file in comune | `src/mobile/session.ts` e la parte file di `src/app.ts` applicano le stesse regole: riunirle in un modulo del core con i test, quando la shell mobile è stabile. |
