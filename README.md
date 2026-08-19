# cemform-actions-only

Repo pubblica "worker" per GitHub Actions del progetto **cemform.it** (repo privata).

I minuti di GitHub Actions sono illimitati e gratuiti per le repo pubbliche: tutti i
workflow girano QUI, mentre il codice, gli script e i dati restano nella repo privata
`cemform/cemform.it`, che viene solo clonata in lettura/scrittura tramite un PAT dedicato.

## Struttura

- `.github/workflows/*.yml` — gli stessi workflow della repo privata, adattati con
  `repository: cemform/cemform.it` + `token: ${{ secrets.PAT_PRIVATE }}`
- Nessun altro file: gli script girano dal checkout della repo privata

## Setup (una tantum, ~10 minuti)

### 1. Creare la repo pubblica

Su GitHub: `New repository` → nome `cemform-actions-only` → **Public** → senza README.
Poi pushare questi file:

```bash
git init
git add .
git commit -m "chore: workflow worker per minuti Actions illimitati"
git branch -M main
git remote add origin https://github.com/cemform/cemform-actions-only.git
git push -u origin main
```

### 2. Creare il PAT per la repo privata

GitHub → Settings → Developer settings → **Fine-grained personal access tokens** → Generate:

- **Repository access**: Only selected repositories → `cemform/cemform.it`
- **Permissions**:
  - Contents: **Read and write** (checkout + push dei commit automatici)
  - Metadata: Read-only (obbligatorio, viene aggiunto in automatico)
- Expiration: 90 giorni (o più)

Il PAT NON serve su `cemform-actions-only` (la repo è pubblica, niente da leggere).

### 3. Secrets della repo pubblica

In `cemform-actions-only` → Settings → Secrets and variables → Actions → New repository
secret. Copiare TUTTI i secrets dalla repo privata (`cemform.it` → Settings → Secrets):

| Secret | Da dove |
|---|---|
| `PAT_PRIVATE` | Il PAT del passo 2 (NUOVO) |
| `GEMINI_API_KEY` | da cemform.it |
| `PEXELS_API_KEY` | da cemform.it |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | da cemform.it |
| `SMTP_USER` / `SMTP_PASS` | da cemform.it |
| `CRON_JOB_API_KEY` | da cemform.it |
| `IMGBB_API_KEY` | da cemform.it |
| `PIXABAY_API_KEY` | da cemform.it |
| `MAKE_WEBHOOK_URL` | da cemform.it |
| `MAKE_API_KEY` | da cemform.it (se presente) |
| `HF_API_KEY` | da cemform.it (se presente) |

### 4. Aggiornare il dispatch su Vercel

`api/dispatch.js` (già modificato nel repo privato) ora punta a
`cemform/cemform-actions-only`. Dopo il push del repo privato, il deploy Vercel
automatico pubblica la modifica.

Il token `GH_DISPATCH_TOKEN` (env Vercel) deve avere accesso alla repo pubblica:
- se è un **classic PAT** (scope `repo`): funziona già così com'è
- se è un **fine-grained PAT**: aggiungere `cemform-actions-only` ai repository access

Test rapido:

```bash
curl -s -X POST -H "X-Dispatch-Key: <DISPATCH_SECRET>" \
  -H "Content-Type: application/json" -d '{"target":"news"}' \
  "https://www.cemform.it/api/dispatch?target=news"
```

### 5. Test di un workflow

Su `cemform-actions-only` → Actions → `News Aggregator` → Run workflow.
Verificare che: (a) il job cloni la repo privata, (b) gli script girino, (c) il commit
"notizie: aggiornamento automatico" appaia nella repo **privata**.

### 6. Rimuovere i workflow dalla repo privata (ultimo passo)

Dopo che il test è andato a buon fine, eliminare `.github/workflows/*.yml` dalla repo
privata (git rm + commit). Così anche un eventuale dispatch manuale sulla privata non
consuma minuti. Mantenere i workflow SOLO in `cemform-actions-only`.

> NOTA: i commit automatici mantengono il tag `[skip actions]` — inoffensivo, serve
> solo se un workflow finisse per errore anche nella privata.

## Sicurezza

- I workflow girano SOLO su `workflow_dispatch` (niente trigger da PR) → il PAT privato
  non può essere esfiltrato da terzi
- Il PAT ha accesso SOLO a `cemform.it` (Contents read/write) — se compromesso,
  non dà accesso ad altre repo
- La repo pubblica espone solo gli YAML dei workflow, nessun dato del sito
