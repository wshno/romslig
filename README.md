# Romslig

Romslig er en lokal web-app for å planlegge renovering: plantegning (JPG/PNG) → målriktig 2D-modell → 3D → (snart) innredning og AI-forslag.

## Kom i gang

```
npm install
cp .env.example .env      # legg inn ANTHROPIC_API_KEY for AI-digitalisering
npm run dev               # web: http://localhost:5173  API: http://localhost:8787
npm test
```

## Arbeidsflyt

1. **Nytt prosjekt**: last opp plantegningen.
2. **Kalibrer (K)**: klikk på endene av en målsatt vegg/målelinje og skriv inn lengden.
3. **Digitaliser med AI**: Claude foreslår vegger, dører, vinduer og rom (oransje overlegg). Godta eller forkast.
   Alternativt kan du tegne selv: Vegg (W), Dør (D), Vindu (N), Åpning (O), Rom (R).
4. **Finn rom automatisk**: rom beregnes fra veggene (målt til innvendig veggflate), og avvik mot oppgitt m² vises.
5. **Møbler**: dra fra katalogen inn i 2D/3D. Møblene snapper mot vegg, og kollisjon, fri plass og dørslag sjekkes.
6. **Bilder**: på et rom kan du laste opp bilder, så gjenkjenner AI-en møblene og legger dem inn.
7. **Assistent**: still spørsmål eller be om forslag. Konkrete forslag lages som nye varianter.
8. **Varianter**: kopier «Eksisterende» og prøv endringer (f.eks. riv en vegg) uten å røre originalen.

**Installasjoner**: verktøyene Punkt (P), Føring (F) og Himling (H). Sammenligning og assistent advarer når vegger med installasjoner endres.

Snarveier: Ctrl+Z / Ctrl+Y, Delete, Esc, Shift = fri vinkel ved tegning, dobbeltklikk avslutter vegg.

## Struktur

- `packages/shared`: datamodell (zod) og geometri (romdeteksjon, snapping, veggsegmenter)
- `apps/server`: Hono-API, lagring i `data/projects/<id>/`, AI-digitalisering (`src/ai/digitize.ts`)
- `apps/web`: React + Konva (2D) + react-three-fiber (3D)

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
