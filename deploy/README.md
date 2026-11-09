# deploy/

Kubernetes-manifestene for Romslig: API-et (`api.yaml`), web-appen (`web.yaml`) og HTTPRoute-en
(`httproute.yaml`). Ved hver release kjører `manifests`-jobben i `.github/workflows/container.yml`
`manifests`-actionen fra hwinther/reusable-workflows. Den

1. rendrer denne mappen med api- og web-imagene låst til `tag@digest`;
2. validerer resultatet med kubeconform;
3. pusher det som et OCI-artefakt til `ghcr.io/wshno/romslig/manifests:<versjon>`;
4. signerer det med cosign (keyless).

På pull requests legger `manifest-diff.yml` ut diffen mot base-branchen som en PR-kommentar. Hva som
rendres, står i `.github/manifest-renders.txt` (`romslig.yaml=deploy`). Ikke commit rendret output.

Klyngerepoet (hwinther/proxmox) henter artefaktet med en Flux `OCIRepository` og `Kustomization`. Det
står for alt som ikke ligger her:

- navnerommet (via `targetNamespace`) og nettverkspolicyer. Bare Traefik skal nå `romslig-api`, siden
  API-et stoler på `Remote-*`-headerne;
- en Gateway API-Gateway som HTTPRoute-en kan koble seg til (`GATEWAY_*` under), med en lytter som
  tillater ruter fra navnerommet, og tildeling av vertsnavnet `APP_HOST`;
- Traefik-mellomvaren `authelia-forwardauth` (`traefik.io/v1alpha1` `Middleware`) i navnerommet, som
  sender hver forespørsel til Authelia og setter `Remote-User`, `Remote-Email`, `Remote-Name` og
  `Remote-Groups`;
- PostgreSQL-databasen og rollen, og hemmelighetene under;
- verdiene for variablene under (via `postBuild.substitute`).

## Innlogging

Begge reglene i HTTPRoute-en går gjennom `authelia-forwardauth`, så ingenting serveres før man er
logget inn. API-et kjører med `AUTH_MODE=forward`: det leser brukeren fra `Remote-User` og gruppene
fra `Remote-Groups`, og eier prosjektene etter brukernavnet. Hvem som slipper inn, styres i Authelias
access control (f.eks. `subject: group:romslig-users`). `ALLOWED_GROUP` er en ekstra sjekk i API-et.

## AI-modus

- `byok` (standard): nettleseren kaller `api.anthropic.com` direkte med brukerens egen nøkkel. Nøkkelen
  når aldri serveren, og `AI_SECRET` trengs ikke.
- `server`: API-et videresender AI-kall med sin egen nøkkel (`ANTHROPIC_API_KEY` fra `AI_SECRET`), for
  medlemmer av `AI_GROUP` hvis den er satt, ellers for alle innloggede.

## Kontrakt

### Variabler

CI feiler hvis rendret output inneholder en variabel uten standardverdi som ikke står her. Flux ville
ellers satt inn en tom streng. Bruk bare strengverdier: kustomize fjerner anførselstegn, så et tall
eller en boolsk verdi ville fått feil YAML-type.

| Variabel                      | Standard            | Brukes til                                                                                                                                                                                                                                                      |
| ----------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_HOST`                    | (påkrevd)           | Vertsnavnet i HTTPRoute-en og homepage-lenken, f.eks. `romslig.wsh.no`                                                                                                                                                                                          |
| `PG_HOST`                     | (påkrevd)           | PostgreSQL-tjenesten (read-write)                                                                                                                                                                                                                               |
| `PG_DB`                       | `romslig`           | Databasenavn                                                                                                                                                                                                                                                    |
| `PG_USER`                     | (påkrevd)           | Databaserollen (eier skjemaet)                                                                                                                                                                                                                                  |
| `PG_SECRET`                   | (påkrevd)           | Navnet på hemmeligheten med rollens `password` (blir `PG_PASSWORD` i API-et)                                                                                                                                                                                    |
| `ALLOWED_GROUP`               | (tom)               | Gruppe API-et i tillegg krever i `Remote-Groups`. Tom betyr alle som Authelia slipper inn                                                                                                                                                                       |
| `AI_MODE`                     | `byok`              | `byok`: brukerens egen nøkkel i nettleseren. `server`: API-et bruker sin egen nøkkel                                                                                                                                                                            |
| `AI_SECRET`                   | `romslig-anthropic` | Navnet på en valgfri hemmelighet med nøkkelen `api-key` (blir `ANTHROPIC_API_KEY`). Trengs bare i `server`-modus; mangler den, starter API-et likevel. Standarden er ikke tom fordi Kubernetes avviser et tomt hemmelighetsnavn, også når referansen er valgfri |
| `AI_GROUP`                    | (tom)               | I `server`-modus: gruppen som får bruke serverens nøkkel. Tom betyr alle innloggede                                                                                                                                                                             |
| `CSP_MODE`                    | `report-only`       | `report-only` sender CSP-en som `Content-Security-Policy-Report-Only` (brudd vises i konsollen); `enforce` som `Content-Security-Policy`. Velger `apps/web/static-server.<modus>.json`                                                                          |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | (tom)               | OTLP-collector for API-et. Tom betyr ingen eksport                                                                                                                                                                                                              |
| `APP_ENVIRONMENT`             | `production`        | Ressursattributtet `deployment.environment`                                                                                                                                                                                                                     |
| `HOMEPAGE_NAME`               | `Romslig`           | Navnet på flisen i gethomepage.dev                                                                                                                                                                                                                              |
| `GATEWAY_NAME`                | `traefik`           | Gatewayen HTTPRoute-en kobler seg til                                                                                                                                                                                                                           |
| `GATEWAY_NAMESPACE`           | `traefik`           | Navnerommet til den Gatewayen                                                                                                                                                                                                                                   |
| `GATEWAY_LISTENER`            | `web`               | Lytteren på Gatewayen (`sectionName`)                                                                                                                                                                                                                           |

### Miljøvariabler i API-et

Satt av `api.yaml`, lest av serveren: `PORT` (`8080`), `AUTH_MODE` (`forward`), `ALLOWED_GROUP`,
`PG_HOST`, `PG_DB`, `PG_USER`, `PG_PASSWORD`, `AI_MODE`, `AI_GROUP`, `ANTHROPIC_API_KEY`,
`OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT` og `OTEL_RESOURCE_ATTRIBUTES`.

### Hemmeligheter

I navnerommet:

- `${PG_SECRET}`: nøkkelen `password`, for `PG_USER`.
- `${AI_SECRET}` (valgfri, bare i `server`-modus): nøkkelen `api-key`, en Anthropic API-nøkkel.

### Ressursnavn

`Deployment/romslig-api`, `Service/romslig-api`, `Deployment/romslig-web`, `Service/romslig-web`,
`HTTPRoute/romslig`. Flux sletter det som forsvinner fra artefaktet, så endre navn med vilje.

## Images

- `ghcr.io/wshno/romslig/api` fra `apps/server/Dockerfile`: esbuild pakker serveren til én fil, som
  kjører på `gcr.io/distroless/nodejs26-debian13:nonroot` (uid 65532) og lytter på 8080.
- `ghcr.io/wshno/romslig/web` fra `apps/web/Dockerfile`: Vite-bygget på
  `ghcr.io/wshno/static-server/server` (uid 65532, port 8080), med SPA-fallback, sikkerhetsheadere og
  immutable cache for `/assets/`.

Begge bygges fra repo-roten, f.eks. `docker build -f apps/server/Dockerfile .`.

## Lokalt

`kubectl kustomize deploy` viser manifestene. For kontraktsjekken og kubeconform slik CI kjører dem,
bruk actionens skript fra en checkout av hwinther/reusable-workflows (krever kubectl og kubeconform på
`PATH`):

```bash
RENDERS='romslig.yaml=deploy' \
  bash ../reusable-workflows/.github/actions/manifests/scripts/render-all.sh . /tmp/manifests /tmp/renders.txt validate
```

Hele stacken (postgres, api, web og en nginx som etterligner Authelia) kan kjøres med Docker Compose:

```bash
docker compose -f docker-compose.e2e.yml up --build   # http://localhost:5173, innlogget som e2e-user
```
