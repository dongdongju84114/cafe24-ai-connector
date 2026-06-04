function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function layout(title, body) {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      color-scheme: light;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f7f8fa;
      color: #16181d;
    }
    body {
      margin: 0;
      padding: 32px;
    }
    main {
      width: min(840px, 100%);
      margin: 0 auto;
    }
    section {
      background: #fff;
      border: 1px solid #dfe3e8;
      border-radius: 8px;
      padding: 24px;
    }
    h1 {
      margin: 0 0 16px;
      font-size: 24px;
    }
    h2 {
      margin: 24px 0 8px;
      font-size: 16px;
    }
    p,
    li {
      line-height: 1.6;
    }
    code {
      background: #eef2f6;
      border-radius: 4px;
      padding: 2px 5px;
    }
    input {
      box-sizing: border-box;
      width: 100%;
      max-width: 420px;
      padding: 10px 12px;
      border: 1px solid #c8ced6;
      border-radius: 6px;
      font-size: 14px;
    }
    button,
    .button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 40px;
      padding: 0 14px;
      border: 1px solid #1b5fc9;
      border-radius: 6px;
      background: #1b5fc9;
      color: #fff;
      font-size: 14px;
      font-weight: 600;
      text-decoration: none;
      cursor: pointer;
    }
    .muted {
      color: #5d6673;
    }
    .warning {
      padding: 12px;
      border-radius: 6px;
      background: #fff4d6;
      color: #5f4300;
    }
    .success {
      padding: 12px;
      border-radius: 6px;
      background: #e8f7ef;
      color: #145c32;
    }
    .list {
      padding-left: 18px;
    }
  </style>
</head>
<body>
<main>
  <section>
    ${body}
  </section>
</main>
</body>
</html>`;
}

export function appPage({ config, missingSetup, connectedMalls }) {
  const defaultMallId = config.cafe24.defaultMallId || '';
  const connectedList = connectedMalls.length
    ? `<ul class="list">${connectedMalls
        .map(
          (mall) =>
            `<li><strong>${escapeHtml(mall.mall_id)}</strong> · scope ${escapeHtml(
              mall.scopes.length
            )}개 · access ${escapeHtml(mall.access_token_expires_in_seconds)}초 남음</li>`
        )
        .join('')}</ul>`
    : '<p class="muted">아직 연결된 쇼핑몰이 없습니다.</p>';

  const setupWarning = missingSetup.length
    ? `<p class="warning">서버 설정이 아직 비어 있습니다: ${escapeHtml(
        missingSetup.join(', ')
      )}</p>`
    : '';

  return layout(
    'Cafe24 AI Connector',
    `<h1>Cafe24 AI Connector</h1>
    <p class="muted">Cafe24 Admin API 토큰을 보관하고 내부 AI/리포트 서버에 read-only 조회 API를 제공하는 전용 서버입니다.</p>
    ${setupWarning}
    <h2>카페24 연결</h2>
    <form action="/cafe24/oauth/start" method="get">
      <p>
        <label for="mall_id">Mall ID</label><br>
        <input id="mall_id" name="mall_id" value="${escapeHtml(defaultMallId)}" placeholder="예: opengallery12" required>
      </p>
      <button type="submit">카페24 권한 연결하기</button>
    </form>
    <h2>등록할 URL</h2>
    <ul class="list">
      <li>App URL: <code>${escapeHtml(config.appUrl || '(PUBLIC_BASE_URL 필요)')}</code></li>
      <li>Redirect URI: <code>${escapeHtml(config.redirectUri || '(PUBLIC_BASE_URL 필요)')}</code></li>
    </ul>
    <h2>요청 Scope</h2>
    <p><code>${escapeHtml(config.cafe24.scopes.join(' '))}</code></p>
    <h2>연결 상태</h2>
    ${connectedList}`
  );
}

export function callbackSuccessPage({ mallId, scopes }) {
  return layout(
    'Cafe24 연결 완료',
    `<h1>Cafe24 연결 완료</h1>
    <p class="success"><strong>${escapeHtml(mallId)}</strong> 쇼핑몰 토큰이 저장되었습니다.</p>
    <p>동의된 scope: <code>${escapeHtml(scopes.join(' '))}</code></p>
    <p><a class="button" href="/cafe24/app">연결 상태 보기</a></p>`
  );
}

export function errorPage({ title = '오류', message }) {
  return layout(
    title,
    `<h1>${escapeHtml(title)}</h1>
    <p class="warning">${escapeHtml(message)}</p>
    <p><a class="button" href="/cafe24/app">돌아가기</a></p>`
  );
}
