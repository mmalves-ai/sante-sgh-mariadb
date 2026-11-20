// E2E @W0-07 (programa CRUD completo, mercado M1): o alerta de deterioração e de sepse no quadro do PA. A enfermeira
// abre os escores do paciente, registra a aferição (o servidor calcula NEWS2, qSOFA e SIRS), o cartão mostra o chip e o
// atalho do protocolo de sepse no limiar; o escore errado é estornado com o motivo (o botão fica desligado sem ele) e
// relançado com os sinais certos; o estornado continua no histórico, marcado. axe sem violação séria nos diálogos.
// Sessão real sobre a fonte sintética e as portas em MEMÓRIA (dados SINTÉTICOS; nada vai à cópia; nenhuma mensagem a
// paciente).
import { type APIRequestContext, type Browser, expect, type Page, test } from '@playwright/test';
import { ORIGEM, semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}
async function novaAba(browser: Browser, login: string): Promise<Page> {
  const ctx = await browser.newContext({ baseURL: ORIGEM, timezoneId: 'America/Sao_Paulo' });
  const p = await ctx.newPage();
  await entrar(p, login);
  return p;
}
let sequencia = 0;
async function postar(page: Page, url: string, data: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'sgh_csrf')?.value ?? '';
  return (page.request as APIRequestContext).post(url, {
    headers: { 'x-csrf': csrf, 'idempotency-key': `e2e-w007-escore-${Date.now()}-${++sequencia}` },
    data: data as object,
  });
}

test.describe('W0-07 (M1): alerta de deterioração e sepse no PA @W0-07', () => {
  test('registrar a aferição, chip e sugestão de sepse; estornar com motivo e relançar; axe', async ({
    page,
    browser,
  }) => {
    // Três sessões, dois diálogos com o axe e a navegação ao protocolo: mais que os 30 s padrão.
    test.setTimeout(120_000);
    const externas = vigiarExternas(page);
    const recepcao = await novaAba(browser, 'SINT.ATENDIMENTO');
    const ab = await postar(recepcao, '/api/atendimento', {
      tipo: 'pa',
      paciente: 1003,
      convenio: 306,
      profissional: 7101,
      especialidade: 15,
      unidade: 3,
      centroCusto: 300400,
      procedimento: 10101039,
      carater: 'urgencia',
      cidPrincipal: 1,
      matricula: '900000000780',
    });
    expect(ab.status(), await ab.text()).toBe(201);
    const reg = Number((await ab.json()).resultado.reg);
    await recepcao.context().close();

    await entrar(page, 'SINT.ENFERMEIRO.PA');
    await page.goto('/pa/quadro');
    const cartao = page.getByTestId(`cartao-${reg}`);
    await expect(cartao).toBeVisible();
    await expect(page.getByTestId(`escore-quadro-${reg}`)).toHaveCount(0);

    // Registrar a aferição: o botão só liga com a aferição completa (a consciência inclusive).
    await page.getByTestId(`escores-${reg}`).click();
    const d = page.getByTestId(`escores-pa-${reg}`);
    await expect(d).toBeVisible();
    const sinais: Record<string, string> = {
      fr: '24',
      spo2: '95',
      o2: '0',
      pas: '98',
      fc: '112',
      temperatura: '38,3',
    };
    for (const [c, v] of Object.entries(sinais)) await d.getByTestId(`escores-pa-${c}`).fill(v);
    await expect(d.getByTestId('escores-pa-registrar')).toBeDisabled();
    await escolher(d.getByTestId('escores-pa-consciencia'), 'A');
    await semViolacaoAxe(page, 'diálogo escores do PA');
    await d.getByTestId('escores-pa-registrar').click();
    await expect(d.getByTestId('escores-pa-mensagem')).toContainText(/Limiar de sepse atingido/);
    await expect(d.getByTestId('escores-pa-alerta')).toContainText('NEWS2 8 · qSOFA 2 · SIRS 3');
    await expect(d.getByTestId('escores-pa-sepse')).toBeVisible();

    // Estornar o errado: sem motivo, o botão fica desligado; relança com a pressão certa na mesma operação.
    const linha = d.locator('[data-testid^="escore-pa-linha-"]').first();
    await expect(linha).toContainText(/Válido/);
    await linha.locator('[data-testid^="escore-pa-estornar-"]').click();
    const e = page.getByTestId('escore-pa-estorno');
    await expect(e).toBeVisible();
    await expect(e.getByTestId('escore-pa-estorno-confirmar')).toBeDisabled();
    await e
      .getByTestId('escore-pa-estorno-motivo')
      .locator('textarea, input')
      .first()
      .fill('Pressão com manguito errado');
    await e.getByTestId('escore-pa-estorno-relancar').check();
    await e.getByTestId('escore-pa-estorno-pas').fill('128');
    await semViolacaoAxe(page, 'diálogo estornar escore do PA');
    await e.getByTestId('escore-pa-estorno-confirmar').click();
    await expect(e).toBeHidden();
    await expect(d.getByTestId('escores-pa-mensagem')).toContainText(/estornado e relançado/);
    const linhas = d.locator('[data-testid^="escore-pa-linha-"]');
    await expect(linhas).toHaveCount(2);
    await expect(d.getByTestId('escores-pa-historico')).toContainText(
      /Estornado em .* Pressão com manguito errado/,
    );
    await expect(linhas.first()).toContainText('NEWS2 6 · qSOFA 1');
    await expect(linhas.first()).toContainText(/Substitui o escore/);
    await page.keyboard.press('Escape');

    // O chip do cartão segue o relançado (NEWS2 6 ainda atinge o limiar 5) e o atalho do protocolo de sepse.
    await expect(page.getByTestId(`escore-quadro-${reg}`)).toContainText('NEWS2 6 · qSOFA 1 · SIRS 3');
    await page.getByTestId(`escore-sepse-${reg}`).click();
    await expect(page).toHaveURL(new RegExp(`/pa/protocolos\\?reg=${reg}&tipo=sepse`));
    expect(externas).toEqual([]);
  });
});
