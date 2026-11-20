// E2E @M54.5 (ficha do M54, etapa F5: custeio por absorção, custo por paciente e margem, ApuraSUS e Federassantas):
// o analista de custos deixa a estrutura sintética pronta (classes, ordem e critério do rateio e as estatísticas de
// 03/2026, pela API, como a F4 já prova pela tela) → o controller abre Controladoria > Custos hospitalares > Custo por
// procedimento e por paciente pelo menu → apura 03/2026 com o limite da linha atípica → a apuração sai parcial (sem
// pessoal), com a impressão, a conservação que fecha com as parcelas, o custo por centro e as pendências → aprova pela
// versão → exporta o ApuraSUS (só gerado, com os centros sem código) e baixa o arquivo → baixa o relatório (PDF/A, ou
// HTML sem conversor) → refazer a aprovada exige justificativa → Resultado por unidade e por convênio: agrupado por
// convênio com o total e os indicadores Σnum÷Σden, "Ver as contas" do convênio e o filtro da margem negativa → quem só
// consulta abre a apuração sem apurar, aprovar nem exportar, e não abre o resultado. Axe sem violação séria em cada
// estado. Sessão real sobre a fonte sintética de dev; a estrutura e as fontes do custeio em MEMÓRIA (centros, contas e
// convênios SINTÉTICOS; nada vai à cópia); nenhum dado de pessoa.
import { expect, type Page, test } from '@playwright/test';
import { itemDoMenu, semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const COMP = '2026-03';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

async function postar(page: Page, url: string, data: Record<string, unknown>): Promise<number> {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'sgh_csrf')?.value ?? '';
  const r = await page.request.post(url, {
    data,
    headers: {
      'x-csrf': csrf,
      'idempotency-key': `e2e-m54-5-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    },
  });
  return r.status();
}

/** A estrutura sintética completa (ADM → LAV → NUT → UTI, CC, LAB) e as estatísticas de 03/2026, como o analista grava. */
async function prepararEstrutura(page: Page): Promise<void> {
  const cls: [number, Record<string, unknown>][] = [
    [101, { classe: 'produtivo' }],
    [102, { classe: 'produtivo' }],
    [103, { classe: 'produtivo' }],
    [106, { classe: 'administrativo', ordemRateio: 1, criterio: 'requisicoes' }],
    [104, { classe: 'auxiliar', ordemRateio: 2, criterio: 'kgRoupa' }],
    [105, { classe: 'auxiliar', ordemRateio: 3, criterio: 'pacienteDia' }],
  ];
  for (const [id, corpo] of cls)
    expect(await postar(page, `/api/custos/centros/${id}`, { ...corpo, versao: null }), `centro ${id}`).toBe(
      200,
    );
  expect(await postar(page, '/api/custos/estatisticas/coleta', { competencia: COMP })).toBe(201);
  for (const [centro, quantidade] of [
    [101, 300],
    [102, 100],
  ] as const)
    expect(
      await postar(page, '/api/custos/estatisticas/lancamentos', {
        competencia: COMP,
        centro,
        codigo: 'kgRoupa',
        quantidade,
      }),
    ).toBe(201);
}

test.describe('controladoria, etapa F5: apuração do custo do mês e resultado @M54.5', () => {
  test.setTimeout(300_000);
  test.use({ actionTimeout: 30_000 });

  test('estrutura → menu → apurar 03/2026 → conservação e parcelas → aprovar → ApuraSUS → relatório → resultado por convênio → contas → consulta; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);

    await entrar(page, 'SINT.CUSTOS');
    await prepararEstrutura(page);

    // O controller chega pela árvore do menu.
    await entrar(page, 'SINT.CUSTOS.CONTROLLER');
    await (await itemDoMenu(page, 'Custo por procedimento e por paciente')).click();
    await expect(page).toHaveURL(/\/custos\/apuracao/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Custo por procedimento e por paciente' }),
    ).toBeVisible();
    await escolher(page.getByTestId('apuracao-competencia'), COMP);
    await expect(page.getByTestId('apuracao-nao-apurada')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('apuracao-bloqueios')).toHaveCount(0);
    await semViolacaoAxe(page, '/custos/apuracao (não apurada)');

    // Apurar com o limite da linha atípica em reais.
    await page.getByTestId('apuracao-limite').fill('100.000,00');
    await page.getByTestId('apuracao-apurar').click();
    await expect(page.getByTestId('apuracao-feito')).toContainText('Competência apurada', {
      timeout: 60_000,
    });
    await expect(page.getByTestId('apuracao-situacao')).toContainText('Apurada (aguarda aprovação)');
    await expect(page.getByTestId('apuracao-parcial')).toBeVisible();
    await expect(page.getByTestId('apuracao-impressao')).toHaveText(/[0-9a-f]{64}/);
    await expect(page.getByTestId('apuracao-conservacao')).toBeVisible();
    await expect(page.getByTestId('apuracao-fecha')).toContainText('A conta fecha');
    await expect(page.getByTestId('apuracao-pendencias')).toBeVisible();
    await expect(page.getByTestId('tela-apuracao-custos')).toContainText('UTI ADULTO SINTETICA');
    await expect(page.getByTestId('apuracao-exportacao')).toContainText('Só a apuração aprovada');
    await semViolacaoAxe(page, '/custos/apuracao (apurada)');

    // Aprovar pela versão.
    await page.getByTestId('apuracao-aprovar').click();
    await expect(page.getByTestId('apuracao-feito')).toContainText('aprovada', { timeout: 30_000 });
    await expect(page.getByTestId('apuracao-situacao')).toHaveText('Aprovada');

    // Exportar o ApuraSUS (só gerado) e baixar o arquivo.
    await escolher(page.getByTestId('apuracao-destino'), 'apurasus');
    await page.getByTestId('apuracao-exportar').click();
    await expect(page.getByTestId('apuracao-arquivo')).toContainText('SHA-256', { timeout: 30_000 });
    await expect(page.getByTestId('apuracao-sem-codigo')).toContainText('sem o código');
    const baixa = page.waitForEvent('download');
    await page.getByTestId('apuracao-baixar').click();
    expect((await baixa).suggestedFilename()).toMatch(/\.csv$/);
    await semViolacaoAxe(page, '/custos/apuracao (aprovada e exportada)');

    // O relatório de custos da apuração vigente.
    const rel = page.waitForEvent('download', { timeout: 60_000 });
    await page.getByTestId('apuracao-relatorio').click();
    expect((await rel).suggestedFilename()).toMatch(/^relatorio-custos-2026-03\.(pdf|html)$/);

    // Refazer a aprovada pede justificativa (o botão só libera com ela).
    await expect(page.getByTestId('apuracao-justificativa')).toBeVisible();
    await expect(page.getByTestId('apuracao-apurar')).toBeDisabled();
    await page
      .getByTestId('apuracao-justificativa')
      .locator('input, textarea')
      .first()
      .fill('Refazer a competência no E2E M54.5');
    await expect(page.getByTestId('apuracao-apurar')).toBeEnabled();
    await semViolacaoAxe(page, '/custos/apuracao (refazer a aprovada)');

    // Resultado por convênio, com o total, os indicadores e as contas do convênio.
    await (await itemDoMenu(page, 'Resultado por unidade e por convênio')).click();
    await expect(page).toHaveURL(/\/custos\/resultado/);
    await escolher(page.getByTestId('resultado-competencia'), COMP);
    await escolher(page.getByTestId('resultado-agrupamento'), 'convenio');
    await expect(page.getByTestId('resultado-grupos')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('resultado-grupos')).toContainText('OPERADORA SINTETICA A');
    await expect(page.getByTestId('resultado-total')).toContainText('5');
    await expect(page.getByTestId('resultado-indicadores')).toBeVisible();
    await semViolacaoAxe(page, '/custos/resultado (por convênio)');
    await page.getByTestId('resultado-ver-contas-12').click();
    await expect(page.getByTestId('resultado-contas')).toBeVisible();
    await expect(page.getByTestId('resultado-conta-501')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('resultado-conta-502')).toBeVisible();
    await expect(page.getByTestId('resultado-conta-503')).toHaveCount(0);
    await semViolacaoAxe(page, '/custos/resultado (contas do convênio)');

    // Quem só consulta: vê a apuração aprovada, sem apurar, aprovar nem exportar; o resultado não abre.
    await entrar(page, 'SINT.CUSTOS.CONSULTA');
    await page.goto('/custos/apuracao');
    await escolher(page.getByTestId('apuracao-competencia'), COMP);
    await expect(page.getByTestId('apuracao-situacao')).toHaveText('Aprovada', { timeout: 30_000 });
    await expect(page.getByTestId('apuracao-aviso')).toContainText('Seu perfil consulta');
    await expect(page.getByTestId('apuracao-form-apurar')).toHaveCount(0);
    await expect(page.getByTestId('apuracao-aprovar')).toHaveCount(0);
    await expect(page.getByTestId('apuracao-exportar')).toHaveCount(0);
    await semViolacaoAxe(page, '/custos/apuracao (somente consulta)');
    await page.goto('/custos/resultado');
    await expect(page.getByRole('heading', { level: 1, name: 'Sem permissão' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId('tela-resultado-custos')).toHaveCount(0);

    expect(externas).toEqual([]);
  });
});
