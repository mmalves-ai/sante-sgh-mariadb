// E2E @M05: porta de entrada. Em dev, a fonte de acesso é SINTÉTICA (sem tocar no TBUSERS da cópia): o
// login usa usuários sintéticos. Cobre o seletor (ARQ-1/ARQ-2: indisponível, rede do endereço), o cookie
// HttpOnly/Secure/SameSite sem token no corpo nem no armazenamento do navegador, o erro genérico, o
// primeiro acesso, a unidade, o bloqueio por inatividade (relógio simulado) com desbloqueio por senha,
// trocar usuário, sair e axe. Nenhum dado de pessoa real.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { vigiarExternas } from './ajuda.js';
import { ESTABELECIMENTO_FORA_E2E } from './ambiente.js';
import { escolher, rotulosDoCombo } from './combos.js';

const API = `http://127.0.0.1:${/^\d{4,5}:(\d{4,5})$/.exec(process.env['E2E_PORTAS'] ?? '')?.[1] ?? '3300'}`;
const SENHA = 'Sintetico#2026';
const [CODIGO_FORA, NOME_FORA] = ESTABELECIMENTO_FORA_E2E.split(':') as [string, string];

async function entrarPelaTela(page: Page, login: string, senha = SENHA): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(senha);
  await page.getByTestId('botao-entrar').click();
}

test.describe('porta de entrada @M05 @jornada', () => {
  test('sem sessão (401), a tela de entrada mostra o formulário, não "Sessão encerrada"', async ({
    page,
  }) => {
    // Contra a cópia real, GET /api/sessao responde 401 antes do login; aqui a sessão sintética está
    // ligada, então o 401 é simulado.
    await page.route('**/api/sessao', (rota) =>
      rota.request().method() === 'GET'
        ? rota.fulfill({
            status: 401,
            contentType: 'application/problem+json',
            body: JSON.stringify({
              type: 'urn:sgh:problema:nao-autenticado',
              title: 'Sessão necessária',
              status: 401,
              detail: 'Entre para continuar.',
            }),
          })
        : rota.fallback(),
    );
    await page.goto('/entrar');
    await expect(page.getByTestId('campo-login')).toBeVisible();
    await expect(page.getByText('Sessão encerrada')).toHaveCount(0);
    // Tela protegida sem sessão: leva à porta de entrada.
    await page.goto('/inicio');
    await expect(page).toHaveURL(/\/entrar/);
    await expect(page.getByTestId('campo-login')).toBeVisible();
  });

  test('seletor: só a rede do endereço; o fora do ar aparece "indisponível" (ARQ-1/ARQ-2)', async ({
    page,
    request,
  }) => {
    const r = await request.get('/api/estabelecimentos');
    expect(r.ok()).toBe(true);
    const corpo = (await r.json()) as {
      rede: string;
      estabelecimentos: { codigo: string; nome: string; disponivel: boolean }[];
    };
    expect(corpo.rede).toBeTruthy();
    expect(corpo.estabelecimentos.filter((e) => e.disponivel).length).toBeGreaterThanOrEqual(1);
    expect(corpo.estabelecimentos.find((e) => e.codigo === CODIGO_FORA)?.disponivel).toBe(false);
    // Sem dado sensível na lista do seletor.
    expect(JSON.stringify(corpo)).not.toMatch(/senha|fdb|127\.0\.0\.1/i);

    await page.goto('/entrar');
    await expect(page.getByRole('heading', { level: 1, name: 'Entrar' })).toBeVisible();
    await expect(page.getByTestId('estabelecimentos-indisponiveis')).toContainText(NOME_FORA);
    await expect(page.getByTestId('estabelecimentos-indisponiveis')).toContainText('indisponível');
    if (corpo.estabelecimentos.filter((e) => e.disponivel).length > 1) {
      await expect(page.getByTestId('seletor-estabelecimento')).toBeVisible();
      const rotulos = await rotulosDoCombo(page.getByTestId('seletor-estabelecimento'));
      expect(rotulos.some((r) => r.includes(NOME_FORA))).toBe(false);
    }
    // Entrar no estabelecimento fora do ar é recusado pelo servidor.
    const fora = await request.post('/api/sessao', {
      data: { estabelecimento: CODIGO_FORA, login: 'SINT.USUARIO', senha: SENHA },
    });
    expect(fora.status()).toBe(400);
  });

  test('sessão aberta num endereço de rede não vale noutro; endereço desconhecido é recusado', async ({
    playwright,
  }) => {
    const local = await playwright.request.newContext({ baseURL: API });
    const login = await local.post('/api/sessao', {
      data: { estabelecimento: 'pc', login: 'SINT.USUARIO', senha: SENHA },
    });
    expect(login.status()).toBe(201);
    const cookie = (login.headersArray().filter((h) => h.name.toLowerCase() === 'set-cookie') ?? [])
      .map((h) => h.value.split(';')[0])
      .join('; ');
    expect(cookie).toMatch(/sgh_sessao=/);
    const mesma = await local.get('/api/sessao', { headers: { cookie } });
    expect(((await mesma.json()) as { sintetica: boolean }).sintetica).toBe(false);
    const outra = await local.get('/api/sessao', { headers: { cookie, host: 'outra.rede.exemplo' } });
    expect(outra.status()).toBe(404);
    expect(((await outra.json()) as { type: string }).type).toBe('urn:sgh:problema:rede-desconhecida');
    const lista = await local.get('/api/estabelecimentos', { headers: { host: 'outra.rede.exemplo' } });
    expect(lista.status()).toBe(404);
    await local.dispose();
  });

  test('login com credencial sintética: cookie HttpOnly, Secure, SameSite=Strict e corpo sem token', async ({
    request,
  }) => {
    const r = await request.post('/api/sessao', {
      data: { estabelecimento: 'pc', login: 'SINT.USUARIO', senha: SENHA },
    });
    expect(r.status()).toBe(201);
    const sessao = r
      .headersArray()
      .filter((h) => h.name.toLowerCase() === 'set-cookie')
      .map((h) => h.value)
      .find((v) => v.startsWith('sgh_sessao='));
    expect(sessao).toMatch(/HttpOnly/);
    expect(sessao).toMatch(/Secure/);
    expect(sessao).toMatch(/SameSite=Strict/);
    const corpo = await r.json();
    expect(corpo.sintetica).toBe(false);
    expect(corpo.usuario.login).toBe('SINT.USUARIO');
    expect(JSON.stringify(corpo)).not.toMatch(/Sintetico#2026|csrf|idSessao/i);
  });

  test('credencial inválida: erro genérico em português, sem cookie de sessão', async ({ page, request }) => {
    const r = await request.post('/api/sessao', {
      data: { estabelecimento: 'pc', login: 'SINT.USUARIO', senha: 'errada' },
    });
    expect(r.status()).toBe(401);
    expect(r.headers()['set-cookie'] ?? '').not.toMatch(/sgh_sessao=[^;]/);
    await entrarPelaTela(page, 'SINT.BLOQUEADO');
    await expect(page.getByTestId('erro-entrar')).toHaveText('Usuário ou senha inválidos.');
  });

  test('@M05 primeiro-acesso: sem senha guardada não entra; texto puro entra e vai à troca', async ({
    page,
  }) => {
    await entrarPelaTela(page, 'SINT.SEMCIFRA', 'qualquer');
    await expect(page.getByTestId('erro-entrar')).toContainText('Primeiro acesso');
    await expect(page).toHaveURL(/\/entrar/);
    await entrarPelaTela(page, 'SINT.TEXTOPURO', 'Textopuro#2026');
    await expect(page).toHaveURL(/\/senha$/);
    // W1-01: com a troca pelo novo ligada no E2E (ACESSO_TROCA_SENHA_PELO_NOVO=sim), o formulário da troca aparece.
    await expect(page.getByTestId('form-senha')).toBeVisible();
    await expect(page.getByTestId('senha-indisponivel')).toHaveCount(0);
  });

  test('@M05 unidade: com acesso a duas unidades, pede a unidade depois do login', async ({ page }) => {
    await entrarPelaTela(page, 'SINT.MULTIUNIDADE');
    await expect(page.getByTestId('seletor-unidade')).toBeVisible();
    await escolher(page.getByTestId('seletor-unidade'), '2');
    await page.getByTestId('botao-unidade').click();
    await expect(page).toHaveURL(/\/inicio$/);
    const s = (await (await page.request.get('/api/sessao')).json()) as { unidadeAtiva: number };
    expect(s.unidadeAtiva).toBe(2);
  });

  test('@M05 cookie: nada no armazenamento do navegador, só o cookie do servidor', async ({ page }) => {
    await entrarPelaTela(page, 'SINT.USUARIO');
    await expect(page).toHaveURL(/\/inicio$/);
    const guardado = await page.evaluate(async () => {
      const bancos = 'databases' in indexedDB ? await indexedDB.databases() : [];
      return {
        local: { ...window.localStorage },
        sessao: { ...window.sessionStorage },
        indexedDb: bancos.map((b) => b.name ?? ''),
      };
    });
    // A sessão não fica em localStorage/sessionStorage/IndexedDB (só preferências de tela e a última
    // escolha do estabelecimento podem estar no local).
    expect(JSON.stringify(guardado)).not.toMatch(/SINT\.USUARIO|Sintetico|token|idSessao|csrf/i);
    expect(guardado.indexedDb).toEqual([]);
    // O cookie da sessão é HttpOnly: não aparece em document.cookie.
    const cookieJs = await page.evaluate(() => document.cookie);
    expect(cookieJs).not.toMatch(/sgh_sessao=/);
    const cookies = await page.context().cookies();
    const s = cookies.find((c) => c.name === 'sgh_sessao');
    expect(s).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict' });
  });

  test('@M05 bloqueio e reautenticação: inatividade (relógio simulado) bloqueia; só a senha desbloqueia', async ({
    page,
  }) => {
    await page.clock.install();
    await entrarPelaTela(page, 'SINT.USUARIO');
    await expect(page).toHaveURL(/\/inicio$/);
    await page.clock.fastForward('31:00');
    await expect(page.getByTestId('camada-bloqueio')).toBeVisible();
    await page.getByTestId('senha-desbloqueio').fill('errada');
    await page.getByTestId('desbloquear').click();
    await expect(page.getByTestId('erro-desbloqueio')).toBeVisible();
    await expect(page.getByTestId('camada-bloqueio')).toBeVisible();
    await page.getByTestId('senha-desbloqueio').fill(SENHA);
    await page.getByTestId('desbloquear').click();
    await expect(page.getByTestId('camada-bloqueio')).toBeHidden();
    await expect(page).toHaveURL(/\/inicio$/);
  });

  test('@M05 trocar usuário: da tela bloqueada volta à entrada e encerra a sessão', async ({ page }) => {
    await entrarPelaTela(page, 'SINT.USUARIO');
    await expect(page).toHaveURL(/\/inicio$/);
    await page.getByTestId('menu-usuario').click();
    await page.getByTestId('bloquear').click();
    await expect(page.getByTestId('camada-bloqueio')).toBeVisible();
    const saida = page.waitForResponse(
      (r) => r.url().endsWith('/api/sessao') && r.request().method() === 'DELETE',
    );
    await page.getByTestId('trocar-usuario').click();
    expect((await saida).status()).toBe(204);
    await expect(page).toHaveURL(/\/entrar/);
    expect((await page.context().cookies()).some((c) => c.name === 'sgh_sessao' && c.value)).toBe(false);
  });

  test('@M05 sair: o menu do usuário encerra a sessão no servidor', async ({ page }) => {
    await entrarPelaTela(page, 'SINT.USUARIO');
    await expect(page).toHaveURL(/\/inicio$/);
    await page.getByTestId('menu-usuario').click();
    const saida = page.waitForResponse(
      (r) => r.url().endsWith('/api/sessao') && r.request().method() === 'DELETE',
    );
    await page.getByTestId('sair').click();
    expect((await saida).status()).toBe(204);
    await expect(page).toHaveURL(/\/entrar/);
    expect((await page.context().cookies()).some((c) => c.name === 'sgh_sessao' && c.value)).toBe(false);
  });

  test('@M05 entrar: sem violação axe séria', async ({ page }) => {
    const externas = vigiarExternas(page);
    await page.goto('/entrar');
    await page.waitForTimeout(300);
    const axe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const graves = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    console.log(`[axe /entrar] ${axe.violations.map((v) => v.id).join(', ') || 'nenhuma'}`);
    expect(graves.map((v) => v.id)).toEqual([]);
    expect(externas).toEqual([]);
  });

  test('@M05 tela bloqueada: sem violação axe séria', async ({ page }) => {
    await entrarPelaTela(page, 'SINT.USUARIO');
    await expect(page).toHaveURL(/\/inicio$/);
    await page.getByTestId('menu-usuario').click();
    await page.getByTestId('bloquear').click();
    await expect(page.getByTestId('camada-bloqueio')).toBeVisible();
    const axe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const graves = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    console.log(`[axe bloqueio] ${axe.violations.map((v) => v.id).join(', ') || 'nenhuma'}`);
    expect(graves.map((v) => v.id)).toEqual([]);
  });
});
