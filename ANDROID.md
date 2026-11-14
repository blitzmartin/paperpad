# Porting di PaperPad su Android (tablet)

Piano tecnico per portare PaperPad su tablet Android e distribuirlo come APK.

## Decisioni prese

| Tema | Decisione |
|---|---|
| Distribuzione | Solo APK in sideload dalla pagina [Releases](../../releases). Niente Play Store. |
| Dispositivi | Solo tablet. I telefoni sono fuori scope: l'app non viene bloccata su telefono, ma non viene ottimizzata né testata lì. |
| Tecnologia | Tauri 2 per Android, con lo stesso codice del desktop. |

## Perché Tauri 2 e non altro

PaperPad è già un'app Tauri 2 con frontend TypeScript e ProseMirror senza framework, e Tauri 2 supporta Android direttamente (`tauri android init` e `tauri android build --apk`). Il frontend e la logica Rust (zip DOCX, base64, stato, token) restano gli stessi.

| Alternativa | Perché è scartata |
|---|---|
| Capacitor | Il backend Rust andrebbe riscritto in TypeScript o Kotlin: due backend da mantenere per lo stesso modello di sicurezza. |
| PWA o TWA | La TWA richiede un dominio web e quindi la rete, contro il principio local-first. Chrome Android non ha la File System Access API. |
| React Native o Expo | ProseMirror ha bisogno del DOM, quindi servirebbe comunque una WebView (expo-dom). Si riscriverebbe la UI senza alcun vantaggio. |
| Kotlin nativo | Riscrittura completa. |

Il porting in sé costa poco. Il costo vero sta nei punti in cui il codice dà per scontato un desktop, descritti qui sotto.

## 1. Backend

### File e percorsi (il blocco principale)

`src-tauri/src/commands.rs` e `src-tauri/src/state.rs` lavorano su `PathBuf` e `std::fs`. Su Android i selettori di file (Storage Access Framework) restituiscono URI `content://`, non percorsi. Ne seguono tre cose:

- `write_atomic` (file temporaneo e poi rename) non funziona su un URI. Bisogna scrivere direttamente con il ContentResolver, in modalità truncate (`"wt"`).
- La lista dei recenti (`recent.json` con i `PathBuf`) perde senso al riavvio, a meno di chiedere permessi persistenti sull'URI (`takePersistableUriPermission`).
- `ensure_extension` non serve: su Android il nome del file lo decide il selettore.

Soluzione proposta:

- Separare il "dove sta il documento" con un `enum Location { Path(PathBuf), Uri(String) }` dietro i token che già esistono. Il modello di sicurezza attuale (la webview non vede mai un percorso) resta intatto.
- Usare `tauri-plugin-fs` **solo da Rust**, come già succede con `tauri-plugin-dialog`, senza dare alcuna capability alla webview.
- Il codice specifico va dietro `#[cfg(target_os = "android")]` o `#[cfg(mobile)]`.
- I permessi persistenti per i recenti richiedono probabilmente un piccolo plugin Kotlin.

Da verificare nello spike:

- Il dialog di salvataggio (`ACTION_CREATE_DOCUMENT`) nella versione di `tauri-plugin-dialog` in uso.
- La scrittura su `content://` tramite `tauri-plugin-fs` lato Rust.
- Se il plugin conserva o meno i permessi sugli URI dopo un riavvio.

### Stampa e PDF

`window.print()` nella WebView di Android in pratica non fa nulla. Serve un plugin Kotlin minimo che chiami `PrintManager` con `WebView.createPrintDocumentAdapter()`. Così si ottiene anche "Salva come PDF" dal sistema.

Il numero di pagina usa `@page { @bottom-center { ... } }` (`PAGE_NUMBER_CSS` in `src/io/native.ts`). Funziona solo con una WebView Chromium recente: va verificato.

### Ciclo di vita

- Su Android `CloseRequested` non arriva mai: il sistema chiude il processo quando vuole. Il dialog "unsaved changes" in `src-tauri/src/lib.rs` non serve lì.
- Il recovery ogni 15 secondi non basta più. Bisogna scrivere il recovery (e fare l'autosave, se è attivo) su `visibilitychange` con stato `hidden`, che sostituisce il `blur` usato in `src/app.ts`.
- Il tasto o gesto "indietro" deve chiudere nell'ordine modali, menu e pannello di ricerca, e solo dopo uscire dall'app.

### Permessi e Manifest

- Il template Android di Tauri include il permesso `INTERNET`, che serve al dev server. Nel Manifest di release va tolto: è coerente con "no network" e chiunque può verificarlo con `aapt dump permissions`.
- In un secondo momento: intent filter per "Apri con PaperPad" su `.html`, `.md` e `.txt` dal file manager.

### Navigation guard

Su Android l'origine è `http://tauri.localhost`, quindi la guard funziona già. In sviluppo però il dev server deve essere raggiungibile dal dispositivo (`TAURI_DEV_HOST` e l'host di Vite), mentre la guard accetta solo `127.0.0.1`. Va aggiunto l'host di sviluppo, sempre e solo nelle build debug.

## 2. UI per tablet

Niente UI separata. Una sola UI che si adatta a tre assi indipendenti:

| Asse | Come si rileva | Uso |
|---|---|---|
| Tipo di input | `@media (pointer: coarse)` e `(any-hover: none)` | Area di tocco, menu, menu contestuale. Un tablet con tastiera e trackpad si comporta da desktop. |
| Larghezza | Breakpoint esistenti (720 e 560 px) più uno intorno a 900 px | Tablet in verticale contro tablet in orizzontale. |
| Piattaforma | `TAURI_ENV_PLATFORM`, impostata dalla CLI Tauri durante `beforeBuildCommand`, esposta con `define` di Vite | Solo per stampa e file. Il codice non usato viene eliminato in build e non serve `plugin-os`. |

Lo user agent non va mai letto.

### Interventi

1. **Area di tocco.** Pulsanti della toolbar e voci di menu di almeno 44-48 px con `pointer: coarse`. La toolbar anni '90 è il cuore estetico dell'app: va mantenuta ingrandendo la densità, non nascosta. In verticale i gruppi meno usati finiscono in un menu "altro".
2. **Menu contestuale.** Su Android il long-press genera `contextmenu`. L'handler in `src/app.ts` che chiama `preventDefault` toglierebbe le maniglie di selezione e il menu nativo (copia, incolla, suggerimenti di Gboard). Con il touch il menu custom va disattivato. Gli strumenti immagine (dimensione, allineamento, testo alternativo) passano a una piccola barra che compare quando si tocca l'immagine.
3. **Focus e tastiera virtuale.** La toolbar usa `mousedown` con `preventDefault` per non togliere il focus all'editor (`src/ui/toolbar.ts`, `src/ui/menu.ts`, `src/ui/dom.ts`). Con il touch va verificato che la tastiera non si chiuda a ogni tocco sulla toolbar; probabilmente servirà `pointerdown`. Il viewport va impostato con `interactive-widget=resizes-content`, così la tastiera non copre caret e status bar.
4. **Vista pagina.** Un A4 a 96 dpi è largo circa 794 px. In orizzontale ci sta, in verticale no. Serve un adattamento alla larghezza (scala della sola superficie pagina) che non tocchi la paginazione di `src/editor/pages.ts` né la stampa.
5. **Menubar.** Oggi si apre al passaggio del mouse, che con il touch non esiste: va aperta con un tocco. I tooltip `title` sul touch non compaiono, quindi le funzioni che si capiscono solo dal tooltip vanno ripensate. Le scorciatoie Ctrl con tastiera fisica funzionano già: su Android `IS_MAC` è falso.
6. **IME.** ProseMirror su Android funziona, ma con Gboard (composizione, backspace, Invio, autocorrezione) è il punto da testare di più. Serve una checklist manuale su un tablet reale, non solo sull'emulatore.
7. **Controllo ortografico.** Su Android lo fa la tastiera (Gboard), non la WebView come su Windows. L'opzione in View, Options va descritta in modo diverso o nascosta.

## 3. Font

Arial, Verdana, Trebuchet MS, Georgia, Times New Roman, Courier New e Comic Sans MS non esistono su Android, e Trebuchet MS è il font predefinito. Un documento creato su Windows si aprirebbe con Roboto o Noto e la paginazione cambierebbe.

Proposta:

- **Default su Android:** un font incluso, ad esempio Atkinson Hyperlegible. I font di sistema assenti si nascondono dalla lista, ma gli stack di fallback restano nei documenti.
- **Font con le stesse metriche** solo per i casi più comuni nei documenti importati: Liberation Sans, Serif e Mono al posto di Arial, Times New Roman e Courier New. La paginazione resta fedele, al costo di qualche centinaio di KB di woff2. Va controllato con `tests/fonts.test.ts`, e il README va aggiornato con le licenze.

## 4. Build e distribuzione in sideload

### Build

- `tauri android build --apk --target aarch64`. Quasi tutti i tablet sono arm64: un solo APK `arm64-v8a` è il più semplice per chi scarica e il più leggero. Se servono Chromebook x86 o emulatori, si aggiunge un secondo APK `x86_64` con il nome che lo indica chiaramente.
- Nessun AAB: serve solo al Play Store.

### Firma (obbligatoria anche in sideload)

- Android non installa un APK non firmato. Serve un keystore di release, conservato nei secrets di GitHub Actions e con una copia di backup offline.
- **La chiave non può mai cambiare.** Un aggiornamento firmato con un'altra chiave non si installa sopra la versione precedente: l'utente dovrebbe disinstallare e perderebbe i dati dell'app (recenti, opzioni, recovery). I documenti salvati con il selettore di file non vanno persi.
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

1. **Spike (1-3 giorni).** `tauri android init`, esecuzione su emulatore tablet e su un tablet reale. Verificare i quattro rischi: salvataggio con il dialog su Android, scrittura su `content://`, stampa e IME. Il resto del piano dipende da questi risultati.
2. **Backend.** Astrazione `Location`, I/O su URI, plugin di stampa, ciclo di vita e tasto indietro, Manifest senza `INTERNET`.
3. **UI touch.** Densità per `pointer: coarse`, menu contestuale, menubar al tocco, toolbar in verticale, vista pagina adattata alla larghezza, tastiera virtuale.
4. **Font.**
5. **Distribuzione.** Keystore, job CI, sezione Android nel README, checklist di test manuale su tablet reale.

## Rischi da verificare nello spike

| Rischio | Impatto se fallisce |
|---|---|
| Dialog di salvataggio non supportato su Android dalla versione del plugin | Plugin Kotlin per `ACTION_CREATE_DOCUMENT` |
| Scrittura su `content://` non disponibile lato Rust | Plugin Kotlin per l'I/O con il ContentResolver |
| `window.print()` inattivo (atteso) | Plugin Kotlin con `PrintManager` |
| Margin box di `@page` non supportati dalla WebView | Numeri di pagina assenti nel PDF su WebView vecchie |
| Bug IME di ProseMirror con Gboard | Patch o workaround nell'editor, test manuali estesi |
| Permessi URI non persistenti | Recenti limitati alla sessione, o plugin Kotlin |
