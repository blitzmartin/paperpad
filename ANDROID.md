# Porting di PaperPad su Android (tablet)

Piano tecnico per portare PaperPad su tablet Android e distribuirlo come APK.

## Decisioni prese

| Tema | Decisione |
|---|---|
| Distribuzione | Solo APK in sideload dalla pagina [Releases](../../releases). Niente Play Store. |
| Dispositivi | Solo tablet. I telefoni sono fuori scope: l'app non viene bloccata su telefono, ma non viene ottimizzata né testata lì. |
| Tecnologia | Tauri 2 per Android, con lo stesso codice del desktop. |
| Obiettivo minimo | Scrivere testo e leggere i documenti PaperPad (HTML). Tutto ciò che complica troppo il porting si può escludere. |

## Perché Tauri 2 e non altro

PaperPad è già un'app Tauri 2 con frontend TypeScript e ProseMirror senza framework, e Tauri 2 supporta Android direttamente (`tauri android init` e `tauri android build --apk`). Il frontend e la logica Rust (zip DOCX, base64, stato, token, archivio delle versioni) restano gli stessi.

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
| Editor, formattazione, stili, ricerca, undo | Frontend puro, gira nella WebView Chromium senza modifiche. |
| Apertura di HTML, MD e TXT | Il dialog di apertura di `tauri-plugin-dialog` funziona su Android e restituisce un URI. La lettura passa per `tauri-plugin-fs` lato Rust, il parsing (`parseDocument`) non cambia. |
| Salva con nome | Dialog di salvataggio con `ACTION_CREATE_DOCUMENT`. `ensure_extension` non serve. |
| Immagini | `pick_image` restituisce già solo i byte: cambia solo la sorgente, da percorso a URI. |
| Storico versioni | L'archivio sta in `app_data_dir`, che su Android è un vero percorso nella sandbox dell'app. `snapshot`, `list`, `read`, la potatura e `write_atomic` funzionano lì. Vedi [Storico versioni](#storico-versioni). |
| Crash recovery | `recovery.html` sta in `app_data_dir`. Va aggiunta la scrittura su `visibilitychange`. |
| Autosave | Logica invariata, cambia solo il trigger (vedi [Ciclo di vita](#ciclo-di-vita)). |
| Export MD, TXT, RTF e DOCX | Generati nel frontend o con lo zip in Rust: cambia solo la destinazione, come per Salva con nome. |
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
| UI touch | Aree di tocco più grandi, menu contestuale custom disattivato con il touch, vista infinita come default. Vedi [UI per tablet](#2-ui-per-tablet). |
| IME e Gboard | ProseMirror ha codice specifico per Android, ma va testato su un tablet reale. |

### Da escludere (almeno nella v1)

| Funzione | Motivo | Ritorno possibile |
|---|---|---|
| Stampa ed export PDF | `window.print()` nella WebView Android non fa nulla. | v2, con un plugin Kotlin con `PrintManager`. |
| Cartella sincronizzata come su desktop con Dropbox e OneDrive | Su Android non esiste una cartella locale mirror, solo il provider. | Mai per questi provider. Con Syncthing sì, nella v2. |
| Scrittura atomica sui file nel cloud | Limite dello Storage Access Framework. | No, compensata dallo storico. |
| Dialog "unsaved changes" alla chiusura | `CloseRequested` non arriva mai su Android. | Non serve: lo sostituiscono autosave e recovery. |
| Drag & drop di file | Non ha senso su tablet. | No. |
| Opzione del controllo ortografico | Lo fa Gboard, non la WebView. | Va nascosta. |
| Fedeltà della paginazione con documenti in Arial, Times o Courier | I font di Windows mancano. | v2 con Liberation (metriche compatibili), se serve. |

### Perimetro della v1

Scrivere, aprire, salvare, Salva con nome, immagini, storico versioni, recovery, autosave, rilevamento dei conflitti, export di testo e DOCX. I file si aprono e si salvano direttamente dai provider cloud tramite il selettore di sistema. Niente cartella PaperPad, niente recenti persistenti, niente stampa.

Se lo spike conferma che `tauri-plugin-fs` legge e scrive su `content://` da Rust e restituisce il nome del file, la v1 non richiede codice Kotlin. Il Kotlin entra solo nella v2 (stampa, cartella, recenti persistenti).

## 1. Backend

### File e percorsi (il blocco principale)

`src-tauri/src/commands.rs` e `src-tauri/src/state.rs` lavorano su `PathBuf` e `std::fs`. Su Android il selettore restituisce URI `content://`. Punti da adattare:

- `write_atomic` (file temporaneo e poi rename) non funziona su un URI. Si scrive direttamente in modalità truncate (`"wt"`). Il commento in testa a `commands.rs` ("writes are atomic") va aggiornato per Android.
- `read_file` e `changed_on_disk` usano `fs::metadata`, `is_file` e `fs::read`: passano per la nuova astrazione.
- `save_conflict_copy` crea un file nella cartella dell'originale (`original.parent()`): su Android diventa un Salva con nome con il nome proposto.
- `file_name(path)` va sostituito con una query `DISPLAY_NAME`.
- La lista dei recenti (`recent.json` con i `PathBuf`) perde senso al riavvio, a meno di chiedere permessi persistenti sull'URI (`takePersistableUriPermission`).
- `ensure_extension` non serve: su Android il nome del file lo decide il selettore.

Soluzione proposta:

- Separare il "dove sta il documento" con un `enum Location { Path(PathBuf), Uri(String) }` dietro i token che già esistono. Il modello di sicurezza attuale (la webview non vede mai un percorso) resta intatto.
- Usare `tauri-plugin-fs` **solo da Rust**, come già succede con `tauri-plugin-dialog`, senza dare alcuna capability alla webview.
- Il codice specifico va dietro `#[cfg(target_os = "android")]` o `#[cfg(mobile)]`.
- Per la v2 (permessi persistenti, cartelle, nome del file) valutare la crate della community `tauri-plugin-android-fs` contro un piccolo plugin Kotlin scritto da noi. La crate toglierebbe quasi tutto il Kotlin, ma è una dipendenza di terze parti su un percorso critico per la sicurezza: prima di adottarla vanno controllate manutenzione e superficie dei permessi.

### Storico versioni

`src-tauri/src/archive.rs` scrive in `app_data_dir`, che su Android è un percorso reale, quindi funziona quasi senza modifiche. Due ritocchi:

- `doc_dir` per i file senza ID (Markdown, testo, vecchi file PaperPad) calcola l'hash del percorso: su Android deve usare la stringa URI. Un provider può restituire URI diversi per lo stesso file in momenti diversi, quindi per questi formati lo storico può frammentarsi. I file `.html` hanno l'ID UUID (`data-id`) e non hanno questo problema.
- `snapshot` legge il file originale (`fs::read(doc.path)`) per conservare la copia di base al primo salvataggio: deve passare per l'astrazione `Location`.

Lo storico resta per dispositivo, come su desktop, e si perde se si disinstalla l'app.

### Cartella cloud e sincronizzazione

Su desktop Dropbox, OneDrive e Nextcloud tengono una cartella locale sincronizzata, e PaperPad ci lavora come su qualsiasi cartella. Su Android quei servizi espongono i file come *DocumentsProvider*: una "posizione" nel selettore di sistema, con i file scaricati su richiesta.

- **Cosa funziona:** l'utente apre e salva direttamente da Dropbox, Nextcloud, Drive o OneDrive nel selettore, e il provider carica le modifiche. La sincronizzazione tra dispositivi c'è, ma la gestisce il provider.
- **Cosa cambia:** "Choose your PaperPad folder" richiede `ACTION_OPEN_DOCUMENT_TREE` con un permesso persistente. Non tutti i provider supportano il selettore di cartelle: Nextcloud e lo storage locale sì, Dropbox storicamente no. Syncthing (o FolderSync) è il caso migliore, perché crea una vera cartella locale come su desktop.
- **v1:** niente cartella PaperPad su Android. Il selettore di sistema ricorda già l'ultima posizione usata. La schermata di benvenuto (`src/ui/welcome.ts`) ha bisogno di un testo per Android: "salva i documenti in Dropbox o Nextcloud direttamente dal selettore".
- **v2:** cartella con `ACTION_OPEN_DOCUMENT_TREE` e permesso persistente, utile soprattutto con Syncthing e Nextcloud. Con la cartella, "Keep both" può tornare a creare il file di conflitto accanto all'originale.

Da verificare nello spike:

- Il dialog di salvataggio (`ACTION_CREATE_DOCUMENT`) nella versione di `tauri-plugin-dialog` in uso.
- La lettura e la scrittura su `content://` tramite `tauri-plugin-fs` lato Rust.
- Se plugin-fs o plugin-dialog espongono il nome del file (`DISPLAY_NAME`).
- Se il plugin conserva o meno i permessi sugli URI dopo un riavvio.
- Quanto è aggiornato il contenuto letto da un provider cloud dopo una modifica fatta da un altro dispositivo (Dropbox, Nextcloud, Drive).

### Stampa e PDF

`window.print()` nella WebView di Android in pratica non fa nulla. Serve un plugin Kotlin minimo che chiami `PrintManager` con `WebView.createPrintDocumentAdapter()`. Così si ottiene anche "Salva come PDF" dal sistema. Nella v1 Print ed Export PDF vanno nascosti.

Il numero di pagina usa `@page { @bottom-center { ... } }` (`PAGE_NUMBER_CSS` in `src/io/native.ts`). Funziona solo con una WebView Chromium recente: va verificato.

### Ciclo di vita

- Su Android `CloseRequested` non arriva mai: il sistema chiude il processo quando vuole. Il dialog "unsaved changes" in `src-tauri/src/lib.rs` non serve lì.
- Il recovery ogni 15 secondi non basta più. Bisogna scrivere il recovery (e fare l'autosave, se è attivo) su `visibilitychange` con stato `hidden`, che sostituisce il `blur` usato in `src/app.ts`.
- Il controllo delle modifiche esterne (`reloadIfChanged`) oggi parte su `window.focus`. Su Android va agganciato a `visibilitychange` con stato `visible`.
- Il tasto o gesto "indietro" deve chiudere nell'ordine modali, menu e pannello di ricerca, e solo dopo uscire dall'app.

### Permessi, Manifest e capability

- Il template Android di Tauri include il permesso `INTERNET`, che serve al dev server. Nel Manifest di release va tolto: è coerente con "no network" e chiunque può verificarlo con `aapt dump permissions`.
- `capabilities/default.json` punta a `desktop-schema.json` e concede `core:webview:allow-print`. Su Android serve una capability separata (`"platforms": ["android"]`) senza la stampa e senza i comandi della cartella, finché non esistono.
- In un secondo momento: intent filter per "Apri con PaperPad" su `.html`, `.md` e `.txt` dal file manager.

### Navigation guard

Su Android l'origine è `http://tauri.localhost`, quindi la guard funziona già. In sviluppo però il dev server deve essere raggiungibile dal dispositivo (`TAURI_DEV_HOST` e l'host di Vite), mentre la guard accetta solo `127.0.0.1`. Va aggiunto l'host di sviluppo, sempre e solo nelle build debug.

## 2. UI per tablet

Niente UI separata. Una sola UI che si adatta a tre assi indipendenti:

| Asse | Come si rileva | Uso |
|---|---|---|
| Tipo di input | `@media (pointer: coarse)` e `(any-hover: none)` | Area di tocco, menu, menu contestuale. Un tablet con tastiera e trackpad si comporta da desktop. |
| Larghezza | Breakpoint esistenti (720 e 560 px) più uno intorno a 900 px | Tablet in verticale contro tablet in orizzontale. |
| Piattaforma | `TAURI_ENV_PLATFORM`, impostata dalla CLI Tauri durante `beforeBuildCommand`, esposta con `define` di Vite | Solo per stampa, file e cartella. Il codice non usato viene eliminato in build e non serve `plugin-os`. |

Lo user agent non va mai letto.

### Interventi

1. **Area di tocco.** Pulsanti della toolbar e voci di menu di almeno 44-48 px con `pointer: coarse`. La toolbar anni '90 è il cuore estetico dell'app: va mantenuta ingrandendo la densità, non nascosta. In verticale i gruppi meno usati finiscono in un menu "altro".
2. **Menu contestuale.** Su Android il long-press genera `contextmenu`. L'handler in `src/app.ts` che chiama `preventDefault` toglierebbe le maniglie di selezione e il menu nativo (copia, incolla, suggerimenti di Gboard). Con il touch il menu custom va disattivato. Nella v1 gli strumenti immagine (dimensione, allineamento, testo alternativo) restano raggiungibili dalla menubar. Una barra che compare quando si tocca l'immagine può arrivare dopo.
3. **Focus e tastiera virtuale.** La toolbar usa `mousedown` con `preventDefault` per non togliere il focus all'editor (`src/ui/toolbar.ts`, `src/ui/menu.ts`, `src/ui/dom.ts`). Con il touch va verificato che la tastiera non si chiuda a ogni tocco sulla toolbar; probabilmente servirà `pointerdown`. Il viewport va impostato con `interactive-widget=resizes-content`, così la tastiera non copre caret e status bar.
4. **Vista pagina.** Un A4 a 96 dpi è largo circa 794 px. In orizzontale ci sta, in verticale no. Nella v1 su Android la vista infinita è il default (`setPageView` esiste già): si perde la paginazione a schermo, non quella dei file. In seguito si può aggiungere un adattamento alla larghezza (scala della sola superficie pagina) che non tocchi la paginazione di `src/editor/pages.ts` né la stampa.
5. **Menubar.** Le voci si aprono già con il `click` oltre che con `mouseenter` (`src/ui/menu.ts`), quindi un tocco basta. Va verificato che `mouseenter`, che i browser emulano con il touch, non apra e chiuda i sottomenu in modo incoerente. I tooltip `title` sul touch non compaiono, quindi le funzioni che si capiscono solo dal tooltip vanno ripensate. Le scorciatoie Ctrl con tastiera fisica funzionano già: su Android `IS_MAC` è falso.
6. **IME.** ProseMirror su Android funziona, ma con Gboard (composizione, backspace, Invio, autocorrezione) è il punto da testare di più. Serve una checklist manuale su un tablet reale, non solo sull'emulatore.
7. **Controllo ortografico.** Su Android lo fa la tastiera (Gboard), non la WebView come su Windows. L'opzione in View, Options va nascosta.
8. **Testi pensati per il desktop.** La schermata di benvenuto e il dialog dei conflitti parlano di "computer" e di cartelle sincronizzate: servono testi per Android.

## 3. Font

Arial, Verdana, Trebuchet MS, Georgia, Times New Roman, Courier New e Comic Sans MS non esistono su Android. Un documento creato su Windows si aprirebbe con Roboto o Noto e la paginazione cambierebbe.

Proposta:

- **Default su Android:** uno dei font già inclusi (Atkinson Hyperlegible, Inter o Literata). I font di sistema assenti si nascondono dalla lista, ma gli stack di fallback restano nei documenti, quindi un file riaperto su desktop torna identico.
- **v2, font con le stesse metriche** solo per i casi più comuni nei documenti importati: Liberation Sans, Serif e Mono al posto di Arial, Times New Roman e Courier New. La paginazione resta fedele, al costo di qualche centinaio di KB di woff2. Va controllato con `tests/fonts.test.ts`, e il README va aggiornato con le licenze.

## 4. Build e distribuzione in sideload

### Build

- `tauri android build --apk --target aarch64`. Quasi tutti i tablet sono arm64: un solo APK `arm64-v8a` è il più semplice per chi scarica e il più leggero. Se servono Chromebook x86 o emulatori, si aggiunge un secondo APK `x86_64` con il nome che lo indica chiaramente.
- Nessun AAB: serve solo al Play Store.

### Firma (obbligatoria anche in sideload)

- Android non installa un APK non firmato. Serve un keystore di release, conservato nei secrets di GitHub Actions e con una copia di backup offline.
- **La chiave non può mai cambiare.** Un aggiornamento firmato con un'altra chiave non si installa sopra la versione precedente: l'utente dovrebbe disinstallare e perderebbe i dati dell'app (recenti, opzioni, recovery, storico versioni). I documenti salvati con il selettore di file non vanno persi.
- Pubblicare l'impronta SHA-256 del certificato nella pagina della release, così l'utente può verificare l'APK (`apksigner verify --print-certs`).

### Versioni e aggiornamenti

- Tauri ricava `versionCode` da `version` in `tauri.conf.json`, quindi `npm run bump` resta l'unica fonte. Va verificato che `versionCode` cresca sempre a ogni release, altrimenti Android rifiuta l'aggiornamento.
- Nessun aggiornamento automatico: richiederebbe la rete. L'utente scarica il nuovo APK dalla pagina Releases e lo installa sopra il precedente.

### Requisiti del dispositivo

- `minSdk` 24 è il default di Tauri.
- Il vero vincolo è la versione della **WebView di sistema**. Sui tablet senza Play Store (per esempio Fire) la WebView può essere vecchia e la stampa con `@page` o alcune funzioni CSS potrebbero rompersi. Va fissata e documentata una versione minima di Chromium.

### CI

Aggiungere a `.github/workflows/release.yml` un job Android con SDK, NDK, target Rust `aarch64-linux-android`, firma con il keystore dai secrets e upload dell'APK nella release.

### Installazione per l'utente (da mettere nel README)

1. Scaricare `PaperPad_x.y.z_android_arm64.apk` dalla pagina Releases.
2. Consentire l'installazione da origini sconosciute per il browser o il file manager usato.
3. Play Protect può mostrare un avviso per le app non distribuite dal Play Store: scegliere "Installa comunque".
4. Permessi richiesti: nessuno.

## 5. Fasi

1. **Spike (1-3 giorni).** `tauri android init`, esecuzione su emulatore tablet e su un tablet reale. Verificare: lettura e scrittura su `content://` da Rust, nome del file dall'URI, salvataggio con il dialog su Android, IME con Gboard, aggiornamento dei file letti dai provider cloud. Il resto del piano dipende da questi risultati.
2. **Backend v1.** Astrazione `Location`, I/O su URI, adattamento di `archive.rs` e di `save_conflict_copy`, capability Android, Manifest senza `INTERNET`, comandi della cartella esclusi su Android.
3. **Frontend v1.** `visibilitychange` per recovery, autosave e reload. Densità per `pointer: coarse`, menu contestuale disattivato con il touch, vista infinita come default, tastiera virtuale. Stampa, PDF, cartella e controllo ortografico nascosti su Android. Testi per Android (benvenuto, conflitti). Font incluso come default.
4. **Distribuzione.** Keystore, build firmata, sezione Android nel README, checklist di test manuale su tablet reale.
5. **v2.** Plugin di stampa, cartella PaperPad con `ACTION_OPEN_DOCUMENT_TREE`, recenti persistenti, tasto indietro completo, font con metriche compatibili, intent filter "Apri con".

## Rischi da verificare nello spike

| Rischio | Impatto se fallisce |
|---|---|
| Lettura e scrittura su `content://` non disponibili lato Rust | Plugin Kotlin per l'I/O con il ContentResolver, oppure `tauri-plugin-android-fs` |
| Nome del file non ricavabile dall'URI con i plugin ufficiali | Piccolo plugin Kotlin per `DISPLAY_NAME` |
| Dialog di salvataggio non supportato su Android dalla versione del plugin | Plugin Kotlin per `ACTION_CREATE_DOCUMENT` |
| Bug IME di ProseMirror con Gboard | Patch o workaround nell'editor, test manuali estesi |
| Provider cloud che servono copie in cache | Conflitti rilevati tardi: va scritto nella documentazione per l'utente |
| Selettore di cartelle non supportato da alcuni provider (v2) | Cartella PaperPad solo con storage locale, Syncthing o Nextcloud |
| `window.print()` inattivo (atteso, v2) | Plugin Kotlin con `PrintManager` |
| Margin box di `@page` non supportati dalla WebView (v2) | Numeri di pagina assenti nel PDF su WebView vecchie |
| Permessi URI non persistenti (v2) | Recenti limitati alla sessione, o plugin Kotlin |
