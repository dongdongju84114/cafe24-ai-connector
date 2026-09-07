# Cafe24 AI Connector

Render에서 Cafe24 Admin API 호출을 중앙 처리하고, AI/리포트 도구에는 내부 read-only API를 제공하는 커넥터 서버입니다. 운영 기본 구성에서는 OAuth와 refresh token을 기존 LUNA가 관리하며, 이 서버는 LUNA에서 받은 access token만 짧게 메모리에 보관합니다.

## 역할

- Render에서 Cafe24 Admin API read-only proxy 제공
- LUNA 내부 endpoint에서 access token만 요청
- Cafe24가 `401`을 반환하면 LUNA 내부 갱신을 요청한 뒤 원래 API를 1회 재시도
- access token을 기본 10분 동안 프로세스 메모리에만 캐시
- OAuth와 refresh token은 LUNA에서만 관리
- 내부 API key가 있는 요청에만 Cafe24 Admin API 조회 제공
- token과 내부 API key를 로그에 남기지 않음

## 운영 구성

LUNA와 Render에는 서로 같은 토큰 브리지용 secret을 각기 아래 이름으로 설정합니다. 실제 값은 저장소에 커밋하지 않습니다.

```text
LUNA
CAFE24_CONNECTOR_INTERNAL_API_KEY

Render
LUNA_CAFE24_TOKEN_API_KEY
```

Render의 주요 설정은 다음과 같습니다.

```text
CAFE24_TOKEN_SOURCE=luna
CAFE24_DEFAULT_MALL_ID=opengallery12
LUNA_CAFE24_TOKEN_URL=https://www.opengallery.co.kr/api/cafe24/connector-token/
LUNA_CAFE24_MANAGE_URL=https://www.opengallery.co.kr/luna/cafe24/
```

LUNA endpoint는 인증된 Render 요청에 access token만 반환합니다. refresh token은 응답하지 않으며, Render의 파일·SQLite·Supabase에도 저장하지 않습니다.

## Legacy 자체 OAuth 모드

`CAFE24_TOKEN_SOURCE=store`로 설정하면 기존 자체 OAuth/token store 모드도 사용할 수 있습니다. 아래 URL은 이 legacy 모드에서만 Cafe24 Developer Admin에 등록합니다.

개발 도메인을 `https://cafe24-ai-dev.opengallery.co.kr`로 실제 연결했다면 Cafe24 Developer Admin에는 아래처럼 등록합니다.

```text
App URL
https://cafe24-ai-dev.opengallery.co.kr/cafe24/app

Redirect URI(s)
https://cafe24-ai-dev.opengallery.co.kr/cafe24/oauth/callback
```

운영 전환 시에는 같은 path를 운영 도메인으로 옮기면 됩니다.

```text
https://cafe24-ai.opengallery.co.kr/cafe24/app
https://cafe24-ai.opengallery.co.kr/cafe24/oauth/callback
```

## 로컬 실행

```bash
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

`.env`에서 LUNA token source와 내부 API key를 채운 뒤 실행합니다.

```bash
npm start
```

브라우저에서 확인합니다.

```text
http://127.0.0.1:4173/cafe24/app
```

LUNA token source 모드에서는 로컬 connector가 OAuth를 직접 처리하지 않으므로 터널이 필요하지 않습니다. 아래 터널 설명은 legacy 자체 OAuth 모드에만 해당합니다.

```text
public hostname: https://cafe24-ai-dev.opengallery.co.kr
local service: http://localhost:4173
```

## public HTTPS 도메인 붙이기

아직 `https://cafe24-ai-dev.opengallery.co.kr`가 실제 서버에 연결되어 있지 않다면 아래 방식 중 하나를 선택하세요.

### 옵션 A. GitHub + Render

가장 빠르게 실제 HTTPS 서버를 만드는 방식입니다. GitHub는 코드 저장소로 쓰고, Render가 Node 서버를 계속 실행합니다.

이 프로젝트에는 Render Blueprint 파일이 포함되어 있습니다.

```text
render.yaml
```

로컬에서 GitHub 저장소를 만들고 push합니다.

```bash
cd /path/to/cafe24-ai-connector
git init
git add .
git commit -m "Initial Cafe24 AI connector"
gh repo create cafe24-ai-connector --private --source=. --remote=origin --push
```

`gh`를 쓰지 않는다면 GitHub 웹에서 private repo를 만든 뒤 `git remote add origin ...`으로 push하면 됩니다.

Render에서 생성합니다.

1. Render Dashboard에서 **New > Blueprint**를 선택합니다.
2. 방금 만든 GitHub repo를 연결합니다.
3. `render.yaml`을 감지하면 `cafe24-ai-connector` web service를 생성합니다.
4. 배포가 끝나면 Render URL을 확인합니다.

예를 들어 Render URL이 아래와 같다면:

```text
https://cafe24-ai-connector.onrender.com
```

Legacy 자체 OAuth 모드라면 Cafe24 Developer Admin에는 이렇게 등록합니다.

```text
App URL
https://cafe24-ai-connector.onrender.com/cafe24/app

Redirect URI(s)
https://cafe24-ai-connector.onrender.com/cafe24/oauth/callback
```

Render는 web service에 `RENDER_EXTERNAL_URL`을 자동으로 넣어주므로, `PUBLIC_BASE_URL`을 따로 설정하지 않아도 이 URL을 기준으로 App URL/Redirect URI를 화면에 표시합니다. 나중에 custom domain을 붙이면 `PUBLIC_BASE_URL=https://your-domain`으로 직접 지정하세요.

기본 `render.yaml`은 Render 무료 web service와 LUNA token source를 사용합니다. Render 로컬 디스크나 Supabase에 token을 보존할 필요가 없습니다. 배포 전에 Render 환경변수에 토큰 브리지 secret을 추가하고, 같은 값을 LUNA에 설정하세요.

```text
Render: LUNA_CAFE24_TOKEN_API_KEY
LUNA: CAFE24_CONNECTOR_INTERNAL_API_KEY
```

### 옵션 B. Cloudflare Tunnel

Cloudflare에 `opengallery.co.kr` 또는 사용할 도메인이 연결되어 있을 때 편한 방식입니다. 서버에 직접 443 포트를 열지 않아도 됩니다.

1. Cloudflare Zero Trust에서 Tunnel을 생성합니다.
2. Public hostname을 추가합니다.
   - Hostname: `cafe24-ai-dev.opengallery.co.kr`
   - Service: `http://cafe24-ai-connector:4173`
3. 발급된 tunnel token을 `.env`의 `CLOUDFLARE_TUNNEL_TOKEN`에 넣습니다.
4. compose를 실행합니다.

```bash
docker compose -f docker-compose.yml -f docker-compose.cloudflare.yml up --build -d
```

Cloudflare Tunnel은 public hostname을 local service에 매핑하고, Dashboard route를 만들면 DNS record도 tunnel로 연결합니다.

### 옵션 C. 일반 VPS + DNS + HTTPS

VPS에 이 compose를 올리고 `cafe24-ai-dev.opengallery.co.kr`의 A record를 VPS IP로 보냅니다. 그 다음 Caddy/Nginx/Traefik 같은 reverse proxy에서 HTTPS를 붙여 `http://127.0.0.1:4173`으로 proxy하면 됩니다.

### 옵션 D. ngrok static domain

빠른 테스트에는 좋지만, Cafe24 Redirect URI가 고정되어야 하므로 무료 랜덤 URL보다 static domain을 쓰는 편이 낫습니다.

## Docker 실행

```bash
cp .env.example .env
docker compose up --build
```

파일 또는 SQLite 저장소를 운영에서 쓴다면 `data/` 볼륨을 반드시 보존하세요. refresh token은 재발급 때 회전될 수 있으므로, token store가 사라지면 다시 OAuth 연결을 해야 합니다.

## 환경변수

| Name | Description |
| --- | --- |
| `PORT` | 서버 포트. 기본값 `4173` |
| `HOST` | 바인딩 주소. 로컬 기본값 `127.0.0.1`, 컨테이너 공개 시 `0.0.0.0` |
| `PUBLIC_BASE_URL` | Cafe24에 등록할 공개 HTTPS 도메인 |
| `CAFE24_CLIENT_ID` | Cafe24 Developer Admin의 Client ID |
| `CAFE24_CLIENT_SECRET` | Cafe24 Developer Admin의 Client Secret |
| `CAFE24_DEFAULT_MALL_ID` | 기본 mall ID |
| `CAFE24_API_VERSION` | `X-Cafe24-Api-Version` 헤더 |
| `CAFE24_SCOPES` | OAuth 요청 scope 목록 |
| `CAFE24_TOKEN_SOURCE` | 운영 기본값 `luna`. Legacy 자체 저장 모드는 `store` |
| `LUNA_CAFE24_TOKEN_URL` | access token만 반환하는 LUNA 내부 endpoint |
| `LUNA_CAFE24_TOKEN_API_KEY` | LUNA endpoint 인증용 Bearer secret |
| `LUNA_CAFE24_MANAGE_URL` | OAuth 재연결이 필요할 때 안내할 LUNA Cafe24 관리 URL |
| `LUNA_CAFE24_TOKEN_CACHE_TTL_MS` | Render 프로세스 메모리의 access token 캐시 시간. 기본 600000ms(10분) |
| `LUNA_CAFE24_TOKEN_TIMEOUT_MS` | LUNA token 요청 timeout. 기본 15000ms |
| `INTERNAL_API_KEY` | 내부 API 호출용 Bearer secret |
| `INTERNAL_ALLOWED_ORIGINS` | 브라우저에서 내부 API를 호출할 때 허용할 Origin. 서버 간 호출만 쓰면 비워둡니다. |
| `INTERNAL_ALLOWED_IPS` | 내부 API 호출을 허용할 IP/CIDR allowlist. Render 환경에서는 보조 방어로만 사용하세요. |
| `INTERNAL_RATE_LIMIT_MAX` | 내부 API rate limit 횟수. 기본값 `120` |
| `INTERNAL_RATE_LIMIT_WINDOW_MS` | 내부 API rate limit 윈도우. 기본값 `60000` |
| `INTERNAL_EXPOSE_CAFE24_ERROR_BODY` | Cafe24 오류 본문 노출 여부. 운영 기본값은 `false` |
| `CAFE24_TOKEN_ENCRYPTION_KEY` | token store 암호화 키 |
| `CAFE24_OAUTH_STATE_SECRET` | OAuth state 서명 키 |
| `CAFE24_TOKEN_STORE_PROVIDER` | `file`, `sqlite`, `supabase`. Render Persistent Disk 운영값은 `sqlite` |
| `CAFE24_TOKEN_STORE_PATH` | file 또는 SQLite 저장 경로. Render SQLite는 `/var/data/cafe24-token-store.sqlite3` |
| `CAFE24_TOKEN_MIGRATION_SOURCE` | 기존 저장소에서 1회 이전할 source. 현재 지원값은 `supabase` |
| `CAFE24_ALLOWED_ADMIN_PATH_PREFIXES` | generic proxy에서 허용할 Admin API path prefix |
| `SUPABASE_URL` | Supabase Project URL |
| `SUPABASE_SECRET_KEY` | Supabase backend secret key. 없으면 `SUPABASE_SERVICE_ROLE_KEY` 사용 |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase legacy service role key |
| `SUPABASE_TOKEN_TABLE` | Cafe24 token 저장 table. 기본값 `cafe24_tokens` |

## Legacy Supabase token store

이 절은 `CAFE24_TOKEN_SOURCE=store`를 계속 사용하는 기존 배포를 위한 호환 문서입니다. LUNA token source에서는 Supabase token store를 사용하지 않습니다.

1. Supabase에서 무료 프로젝트를 생성합니다.
2. SQL Editor에서 아래 파일 내용을 실행합니다.

```text
supabase/cafe24_tokens.sql
```

3. Render Environment에 아래 값을 추가합니다.

```text
CAFE24_TOKEN_STORE_PROVIDER=supabase
SUPABASE_URL={Supabase Project URL}
SUPABASE_SECRET_KEY={Supabase Secret Key 또는 Service Role Key}
SUPABASE_TOKEN_TABLE=cafe24_tokens
```

`SUPABASE_SECRET_KEY` 또는 `SUPABASE_SERVICE_ROLE_KEY`는 서버 전용 키입니다. 브라우저, AI 프롬프트, 클라이언트 번들에 넣지 마세요.

Supabase table에는 Cafe24 token 원문을 저장하지 않습니다. 서버가 `CAFE24_TOKEN_ENCRYPTION_KEY`로 token payload를 AES-GCM 암호화한 envelope만 저장합니다.

## Legacy 선택 사항: Render Persistent Disk + SQLite

이 구성은 legacy 자체 OAuth 모드에서 유료 Render 인스턴스와 Persistent Disk를 사용하기로 결정했을 때만 적용합니다. 기본 `render.yaml`에는 포함하지 않습니다.

```text
CAFE24_TOKEN_STORE_PROVIDER=sqlite
CAFE24_TOKEN_STORE_PATH=/var/data/cafe24-token-store.sqlite3
CAFE24_TOKEN_MIGRATION_SOURCE=supabase
```

전환 시 배포 순서는 토큰 유실 방지를 위해 고정합니다.

1. Render 서비스를 유료 단일 인스턴스로 전환하고 `/var/data`에 Persistent Disk를 연결합니다.
2. SQLite 지원 코드를 배포합니다.
3. `/internal/cafe24/status`를 한 번 호출해 기존 Supabase 암호화 레코드를 SQLite로 이전합니다.
4. access token 발급과 Admin API proxy를 확인합니다.
5. 서비스를 재시작한 뒤 같은 mall 연결 상태가 유지되는지 확인합니다.
6. 검증이 끝나면 `CAFE24_TOKEN_MIGRATION_SOURCE`를 제거해 Supabase fallback을 비활성화합니다.

마이그레이션 중에도 token 원문은 로그나 응답에 출력하지 않습니다. SQLite DB에는 기존과 동일한 AES-256-GCM envelope만 저장됩니다. 기존 Supabase 레코드는 롤백 확인이 끝날 때까지 읽기 전용 백업으로 유지합니다.

## URL 역할

루트(`/`)는 공개 앱 화면으로 사용하지 않고, 내부 인증 전용 access token 발급 경로로만 사용합니다.

| Path | Role |
| --- | --- |
| `/healthz` | Render health check |
| `/` | 내부 인증 전용 Cafe24 access token 발급 |
| `/cafe24/app` | Cafe24 OAuth 연결용 화면 |
| `/cafe24/oauth/start` | Cafe24 OAuth 시작 |
| `/cafe24/oauth/callback` | Cafe24 OAuth callback |
| `/internal/cafe24/*` | 내부 서버 간 조회 API |

## 내부 API

모든 `/internal/*` API는 아래 헤더 중 하나가 필요합니다.

```text
Authorization: Bearer {INTERNAL_API_KEY}
X-Internal-Api-Key: {INTERNAL_API_KEY}
```

### Access token 발급

다른 서버가 Cafe24 API를 직접 호출해야 하는 경우에만 사용합니다. 이 응답에는 refresh token을 포함하지 않습니다.

```bash
curl -H "Authorization: Bearer $INTERNAL_API_KEY" \
  "https://cafe24-ai-connector.onrender.com/?mall_id=YOUR_MALL_ID"
```

명시적 내부 경로가 필요하면 아래 alias도 동일하게 동작합니다.

```bash
curl -H "Authorization: Bearer $INTERNAL_API_KEY" \
  "https://cafe24-ai-connector.onrender.com/internal/cafe24/token?mall_id=YOUR_MALL_ID"
```

### 연결 상태

```bash
curl -H "Authorization: Bearer $INTERNAL_API_KEY" \
  http://127.0.0.1:4173/internal/cafe24/status
```

### 주문 목록 조회

Cafe24 Orders list의 `start_date`, `end_date`는 `YYYY-MM-DD` 형식으로 보냅니다.

```bash
curl -H "Authorization: Bearer $INTERNAL_API_KEY" \
  "http://127.0.0.1:4173/internal/cafe24/orders?mall_id=YOUR_MALL_ID&start_date=2026-06-01&end_date=2026-06-04&limit=100&embed=items,cancellation,return"
```

### Generic Admin API GET proxy

GET만 허용합니다. path는 `CAFE24_ALLOWED_ADMIN_PATH_PREFIXES`에 포함된 prefix로 제한됩니다.

```bash
curl -H "Authorization: Bearer $INTERNAL_API_KEY" \
  "https://cafe24-ai-connector.onrender.com/internal/cafe24/admin/YOUR_MALL_ID/api/v2/admin/products?limit=10"
```

다른 앱에서 Cafe24 데이터를 조회할 때는 가능하면 `/internal/cafe24/...` proxy 경로를 우선 사용합니다. Cafe24 access token 발급이 꼭 필요한 앱만 `/` 또는 `/internal/cafe24/token`을 호출합니다.

## 권장 scope

AI 리포트/조회용 최소 시작점:

```text
mall.read_application mall.write_application
mall.read_order
mall.read_product
mall.read_category
mall.read_store
mall.read_salesreport
mall.read_analytics
```

쿠폰/혜택 분석이 필요하면 `mall.read_promotion`, 브랜드/공급사 분석이 필요하면 `mall.read_collection`, `mall.read_supply`를 추가합니다. 고객 개인정보, 알림, 디자인, 게시판, 번역 scope는 실제 사용 전까지 붙이지 않는 것을 권장합니다.

## 운영 메모

- Render Persistent Disk + SQLite 구성은 단일 인스턴스 기준입니다. 다중 인스턴스로 확장할 때는 Postgres 또는 KMS 기반 secret storage로 옮기세요.
- Cafe24 refresh token은 재발급 시 회전될 수 있으므로 token store 쓰기 실패를 운영 알림으로 잡는 편이 좋습니다.
- AI에는 가능하면 Cafe24 token을 넘기지 말고 이 서버의 내부 API 결과만 전달하세요. token 발급 endpoint는 서버 간 호출에만 사용하세요.
- Generic proxy는 GET-only지만 개인정보가 포함된 API를 호출할 수 있으므로 내부 네트워크, 방화벽, API key로 한 번 더 감싸세요.

## 참고한 공식 문서

- Cafe24 App creation: https://developers.cafe24.com/en/app/front/app/develop/createapps
- Cafe24 OAuth authorization code: https://developers.cafe24.com/en/app/front/app/develop/oauth/oauthcode
- Cafe24 access token: https://developers.cafe24.com/app/front/app/develop/oauth/token
- Cafe24 Admin API call: https://developers.cafe24.com/app/front/app/develop/api/adminapi
- Cafe24 Orders API: https://developers.cafe24.com/docs/api/admin/?version=2026-03-01
- Render Persistent Disks: https://render.com/docs/disks
- Render Blueprints: https://render.com/docs/blueprint-spec
- Cloudflare Tunnel routing: https://developers.cloudflare.com/tunnel/routing/
