# Cafe24 AI Connector

Cafe24 Admin API OAuth 토큰을 메인 서버와 분리해서 보관하고, AI/리포트 서버에는 내부 read-only API만 제공하는 전용 커넥터 서버입니다.

## 역할

- Cafe24 앱 실행 화면 제공: `/cafe24/app`
- OAuth 시작/콜백 처리: `/cafe24/oauth/start`, `/cafe24/oauth/callback`
- access token 만료 시 refresh token으로 재발급
- token payload를 AES-256-GCM으로 암호화해 `data/tokens.enc.json`에 저장
- 내부 API key가 있는 요청에만 Cafe24 Admin API 조회 제공
- 외부로 token 값을 반환하거나 로그에 남기지 않음

## Cafe24 앱 설정값

아래 URL은 예시입니다. 실제 DNS/터널/서버가 연결된 HTTPS 도메인으로 바꿔서 등록해야 합니다.

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

`.env`를 채운 뒤 실행합니다.

```bash
npm start
```

브라우저에서 확인합니다.

```text
http://127.0.0.1:4173/cafe24/app
```

Cafe24 OAuth는 HTTPS 실제 도메인이 필요하므로 로컬 개발 중에는 Cloudflare Tunnel 또는 ngrok 같은 터널로 public hostname을 붙입니다.

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
4. `sync: false`로 표시된 값들을 입력합니다.
   - `CAFE24_CLIENT_ID`
   - `CAFE24_CLIENT_SECRET`
   - `CAFE24_DEFAULT_MALL_ID`
5. 배포가 끝나면 Render URL을 확인합니다.

예를 들어 Render URL이 아래와 같다면:

```text
https://cafe24-ai-connector.onrender.com
```

Cafe24 Developer Admin에는 이렇게 등록합니다.

```text
App URL
https://cafe24-ai-connector.onrender.com/cafe24/app

Redirect URI(s)
https://cafe24-ai-connector.onrender.com/cafe24/oauth/callback
```

Render는 web service에 `RENDER_EXTERNAL_URL`을 자동으로 넣어주므로, `PUBLIC_BASE_URL`을 따로 설정하지 않아도 이 URL을 기준으로 App URL/Redirect URI를 화면에 표시합니다. 나중에 custom domain을 붙이면 `PUBLIC_BASE_URL=https://your-domain`으로 직접 지정하세요.

`render.yaml`은 persistent disk를 `/var/data`에 붙이고 `CAFE24_TOKEN_STORE_PATH=/var/data/tokens.enc.json`로 설정합니다. Render의 일반 filesystem은 redeploy/restart 때 사라질 수 있으므로 Cafe24 refresh token 저장에는 disk가 필요합니다.

주의: Render persistent disk는 유료 web service에서 사용할 수 있습니다. 무료 플랜으로 띄우면 토큰 저장 파일이 재배포 때 사라질 수 있어 OAuth를 다시 연결해야 합니다.

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

운영에서는 `data/` 볼륨을 반드시 보존하세요. refresh token은 재발급 때 회전되므로, 토큰 저장 파일이 사라지면 다시 OAuth 연결을 해야 합니다.

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
| `INTERNAL_API_KEY` | 내부 API 호출용 Bearer secret |
| `CAFE24_TOKEN_ENCRYPTION_KEY` | token store 암호화 키 |
| `CAFE24_OAUTH_STATE_SECRET` | OAuth state 서명 키 |
| `CAFE24_ALLOWED_ADMIN_PATH_PREFIXES` | generic proxy에서 허용할 Admin API path prefix |

## 내부 API

모든 `/internal/*` API는 아래 헤더 중 하나가 필요합니다.

```text
Authorization: Bearer {INTERNAL_API_KEY}
X-Internal-Api-Key: {INTERNAL_API_KEY}
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
  "http://127.0.0.1:4173/internal/cafe24/admin/YOUR_MALL_ID/api/v2/admin/products?limit=10"
```

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

- 이 스캐폴드는 단일 서버/단일 파일 저장소 기준입니다. 다중 인스턴스로 키우면 Postgres 또는 KMS 기반 secret storage로 옮기세요.
- Cafe24 refresh token은 재발급 시 회전될 수 있으므로 token store 쓰기 실패를 운영 알림으로 잡는 편이 좋습니다.
- AI에는 Cafe24 token을 넘기지 말고 이 서버의 내부 API 결과만 전달하세요.
- Generic proxy는 GET-only지만 개인정보가 포함된 API를 호출할 수 있으므로 내부 네트워크, 방화벽, API key로 한 번 더 감싸세요.

## 참고한 공식 문서

- Cafe24 App creation: https://developers.cafe24.com/en/app/front/app/develop/createapps
- Cafe24 OAuth authorization code: https://developers.cafe24.com/en/app/front/app/develop/oauth/oauthcode
- Cafe24 access token: https://developers.cafe24.com/app/front/app/develop/oauth/token
- Cafe24 Admin API call: https://developers.cafe24.com/app/front/app/develop/api/adminapi
- Cafe24 Orders API: https://developers.cafe24.com/docs/api/admin/?version=2024-12-01
- Cloudflare Tunnel routing: https://developers.cloudflare.com/tunnel/routing/
