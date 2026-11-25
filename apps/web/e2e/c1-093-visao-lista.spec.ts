// E2E @C1-093 (01-ADM L84, ficha F3.9): a visão de lista segue a conta. O auditor abre a trilha de auditoria, esconde
// duas colunas e passa o usuário para antes da origem na própria tela (sem outra tela), guarda como a sua visão e, num
// navegador limpo (outro computador: nada guardado no navegador), a tabela já abre com as mesmas colunas na mesma
// ordem. A última coluna visível não sai. No fim volta às colunas de fábrica (a conta é compartilhada com outros E2E).
// O que fica no banco é provado no contrato de efeito operacoes-preferencias-propria.int.spec.ts. Sessão real sobre a
// fonte sintética de dev; nenhum dado real.
import { expect, test, type Browser, type Page } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';

const SENHA = 'Sintetico#2026';
const LOGIN = 'SINT.AUDITOR';
const ROTA = '/administracao/auditoria/trilha';
const FABRICA = ['dataHora', 'origem', 'usuario', 'acao', 'opcao', 'alvo', 'paciente', 'estacao', 'ator'];
const ESCOLHIDA = ['dataHora', 'usuario', 'origem', 'acao', 'opcao', 'alvo', 'paciente'];

async function entrar(page: Page): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(LOGIN);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

async function abrirTrilha(page: Page): Promise<void> {
  await page.goto(ROTA);
  await page.getByTestId('trilha-consultar').click();
  await expect(page.getByTestId('tabela-trilha')).toBeVisible();
}

/** As colunas do cabeçalho da tabela, na ordem em que aparecem. */
const cabecalho = (page: Page) =>
  page
    .getByTestId('tabela-trilha')
    .locator('thead th')
    .evaluateAll((els) => els.map((e) => (e.getAttribute('data-testid') ?? '').replace('trilha-cab-', '')));

async function navegadorLimpo(browser: Browser): Promise<Page> {
  const contexto = await browser.newContext();
  const page = await contexto.newPage();
  await entrar(page);
  return page;
}

test.describe('Visão de lista por usuário @C1-093', () => {
  test('esconder e mover colunas na trilha, guardar na conta e abrir igual em outro computador', async ({
    page,
    browser,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page);
    await abrirTrilha(page);
    // Começa de fábrica (o teste anterior, se houve, devolveu a conta).
    await page.getByTestId('trilha-colunas').locator('summary').click();
    if ((await cabecalho(page)).join('|') !== FABRICA.join('|')) {
      await page.getByTestId('trilha-visao-fabrica').click();
      await expect.poll(() => cabecalho(page)).toEqual(FABRICA);
    }
    await expect(page.getByTestId('trilha-guardar-visao')).toBeDisabled();

    // Esconder duas colunas e mover o usuário para antes da origem: muda na hora, sem gravar ainda.
    await page.getByTestId('trilha-mostrar-estacao').uncheck();
    await page.getByTestId('trilha-mostrar-ator').uncheck();
    await page.getByTestId('trilha-antes-usuario').click();
    await expect.poll(() => cabecalho(page)).toEqual(ESCOLHIDA);
    await expect(page.getByTestId('trilha-situacao-visao')).toContainText('ainda não guardadas');

    const gravou = page.waitForResponse(
      (r) => r.url().includes('/api/acesso/preferencias/minhas/telas/') && r.request().method() === 'PUT',
    );
    await page.getByTestId('trilha-guardar-visao').click();
    expect((await gravou).status()).toBeLessThan(300);
    await expect(page.getByTestId('trilha-situacao-visao')).toContainText('guardada na sua conta');
    await semViolacaoAxe(page, ROTA);

    // Outro computador: a tabela já abre com a visão guardada.
    const outra = await navegadorLimpo(browser);
    await abrirTrilha(outra);
    await expect.poll(() => cabecalho(outra)).toEqual(ESCOLHIDA);

    // A última coluna visível não sai.
    await outra.getByTestId('trilha-colunas').locator('summary').click();
    for (const c of ESCOLHIDA.slice(1)) await outra.getByTestId(`trilha-mostrar-${c}`).uncheck();
    await expect.poll(() => cabecalho(outra)).toEqual(['dataHora']);
    await expect(outra.getByTestId('trilha-mostrar-dataHora')).toBeDisabled();

    // Volta às colunas de fábrica e guarda assim (devolve a conta para os outros E2E).
    await outra.getByTestId('trilha-visao-fabrica').click();
    await expect.poll(() => cabecalho(outra)).toEqual(FABRICA);
    await expect(outra.getByTestId('trilha-situacao-visao')).toContainText('guardada na sua conta');
    await outra.context().close();

    expect(externas).toEqual([]);
  });
});
