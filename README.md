# Romslig

Romslig er en lokal web-app for å planlegge renovering: plantegning (JPG/PNG) → målriktig 2D-modell → 3D → (snart) innredning og AI-forslag.

## Kom i gang

```
npm install
cp .env.example .env      # valgfritt, se «AI» under
npm run dev               # web: http://localhost:5173  API: http://localhost:8787
npm test
```

### AI

AI-funksjonene (digitalisering, bildegjenkjenning og assistenten) kjører i nettleseren, fra `packages/ai`.

- **`byok` (standard):** du limer inn din egen Anthropic-nøkkel i appen («🔑 Nøkkel» i toppmenyen). Den lagres bare i fanen (`sessionStorage`), går direkte fra nettleseren til Anthropic og når aldri serveren. Serveren trenger ingen nøkkel.
- **`server`:** én nøkkel på serveren for alle. Sett `AI_MODE=server` og `ANTHROPIC_API_KEY=...` i `.env`. Nettleseren går da via proxyen `/api/ai/v1/messages`, som legger på nøkkelen.

Se [deploy/README.md](deploy/README.md) for `AI_GROUP` og grensene i proxyen.

## Arbeidsflyt

1. **Nytt prosjekt**: last opp plantegningen.
2. **Kalibrer (K)**: klikk på endene av en målsatt vegg/målelinje og skriv inn lengden.
3. **Digitaliser med AI**: Claude foreslår vegger, dører, vinduer og rom (oransje overlegg). Godta eller forkast.
   Alternativt kan du tegne selv: Vegg (W), Dør (D), Vindu (N), Åpning (O), Rom (R).
4. **Finn rom automatisk**: rom beregnes fra veggene (målt til innvendig veggflate), og avvik mot oppgitt m² vises.
5. **Møbler**: dra fra katalogen inn i 2D/3D. Møblene snapper mot vegg. Appen sier fra om kollisjoner, for lite fri plass, møbler i slagfeltet til en dør eller i veien for en døråpning, møbler som dekker et vindu og møbler som er for høye for nedforet tak.
6. **Bilder**: på et rom kan du laste opp bilder, så gjenkjenner AI-en møblene og legger dem inn.
7. **Assistent**: still spørsmål eller be om forslag. Konkrete forslag lages som nye varianter.
8. **Varianter**: kopier «Eksisterende» og prøv endringer (f.eks. riv en vegg) uten å røre originalen.

**Installasjoner**: verktøyene Punkt (P), Føring (F) og Himling (H). Sammenligning og assistent advarer når vegger med installasjoner endres.

Snarveier: Ctrl+Z / Ctrl+Y, Delete, Esc, Shift = fri vinkel ved tegning, dobbeltklikk avslutter vegg.

## Struktur

- `packages/shared`: datamodell (zod) og geometri (romdeteksjon, snapping, veggsegmenter)
- `packages/ai`: AI-logikken (assistent, digitalisering, bildegjenkjenning), uten Node-avhengigheter. Hver funksjon får en Anthropic-klient inn
- `apps/server`: Hono-API, lagring i filer (`data/projects/<id>/`) eller PostgreSQL, `/api/config` og AI-proxyen for `server`-modus (`src/ai/proxy.ts`)
- `apps/web`: React + Konva (2D) + react-three-fiber (3D), og AI-klienten (`src/ai/client.ts`)

## Bygg og deploy

- `npm run build` bygger web-appen (`apps/web/dist`) og pakker serveren til én fil (`apps/server/dist/server.mjs`).
- To images bygges fra repo-roten: `apps/server/Dockerfile` (API på distroless Node) og `apps/web/Dockerfile` (SPA på `ghcr.io/wshno/static-server/server`). Begge lytter på 8080.
- `deploy/` har Kubernetes-manifestene (Deployment, Service og HTTPRoute med Authelia forward auth). Variablene, hemmelighetene og hvordan de leveres til klyngen, står i [deploy/README.md](deploy/README.md).
- `.github/workflows/`: `ci.yml` kjører typesjekk, bygg, lint og tester på pull requests. «Create release» lager en versjonstag, og `container.yml` bygger og signerer imagene og manifest-artefaktet `ghcr.io/wshno/romslig/manifests`.
- Nattlige ende-til-ende-tester: `nightly-preview.yml` (01:30 UTC) deployer `main` til et midlertidig preview-miljø og kjører hele e2e-suiten mot det gjennom NAXSI og Authelia. `production-smoke.yml` (02:15 UTC) kjører én kort test mot produksjon (https://romslig.wsh.no) som e2e-brukeren: lager et prosjekt med æøå i navnet, endrer takhøyden, sjekker at endringen er lagret i PostgreSQL og sletter prosjektet igjen. Testen er merket `@production-smoke` og kjøres bare når `E2E_SUITE=production-smoke`. Feiler en planlagt kjøring, åpnes en issue med etiketten `nightly-preview` eller `production-smoke`. Manuelt: `gh workflow run production-smoke.yml`.
- Lokal ende-til-ende-stack med postgres, api, web og en nginx som etterligner Authelia: `docker compose -f docker-compose.e2e.yml up --build`, deretter http://localhost:5173 (innlogget som `e2e-user`).

## Veikart

- [x] Fase 1: prosjekter, opplasting, kalibrering, 2D-editor (vegger, dører, vinduer, rom)
- [x] Fase 2: AI-digitalisering av plantegning med arealvalidering
- [x] Fase 3: 3D-visning (fugleperspektiv, gå rundt, lave vegger, bærevegger)
- [x] Fase 4: møbelkatalog (45 møbler), dra og slipp i 2D/3D, snapping mot vegg, sjekk av kollisjon, fri plass og dørslag
- [x] Fase 5: AI-assistent (chat) som svarer på spørsmål og lager forslag til møblering og veggendringer som egne varianter, med advarsler om bærevegg, våtrom og yttervegg
- [x] Gjenkjenne eksisterende møbler fra bilder av rommene (AI) og legge dem inn mot riktig vegg
- [x] Sammenligne to varianter side om side, med oversikt over forskjeller
- [x] Tekniske installasjoner: stikkontakter, brytere, lys, sikringsskap (også utenfor leiligheten), vanninntak og hovedkran, sluk, ventiler, rør/kanaler/kabler i vegg, gulv, himling og nedforet tak

> Riving eller flytting av vegger må alltid vurderes av fagperson (RIB). Appen gir forslag, ikke byggteknisk godkjenning.
