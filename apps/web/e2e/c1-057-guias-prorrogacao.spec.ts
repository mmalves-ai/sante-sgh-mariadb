// E2E @C1-057 (F3.4, 04-INT linha 68): a autorização da internação e as prorrogações, no que a fonte sintética permite.
// A admissão leva à tela das guias com a guia inicial na conta principal (a linha da tabela, conta e número). A
// prorrogação vai só na conta parcial aberta pelo faturamento: a fonte sintética não abre conta parcial, então a tela
// avisa (guias-sem-parcial), o combo da conta não oferece nenhuma conta e o botão fica desabilitado mesmo com número,
// início e autorizador preenchidos (a regra "gravar só com conta e guia", no lado da recusa). O histórico das
// autorizações, a prévia do período, a gravação da prorrogação e a correção com motivo exigem o banco do cliente (a
// leitura dos registros responde 503 na fonte sintética, e a tela mostra a mensagem de erro): ficam SEM E2E e são provados no
// contrato de efeito apps/api/src/modulos/adt/registros-internacao.int.spec.ts (prorrogação com a validade seguinte e
// o autorizador; correção sem linha nova nem diárias somadas). Sessão real sobre a fonte sintética e as portas em
// MEMÓRIA (dados SINTÉTICOS; nada vai à cópia).
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher, esperarOpcoes, esperarSemSelectNativo } from './combos.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

/** Admite o paciente sintético num leito livre da enfermaria e devolve o número da internação. */
async function admitir(page: Page): Promise<number> {
  await page.goto('/leitos/mapa');
  const cartoes = page.locator('[data-testid^="leito-1|ENF1|"][data-situacao="livre"]');
  await expect(cartoes.first()).toBeVisible();
  const origem = ((await cartoes.first().getAttribute('data-testid')) ?? '').replace(/^leito-/, '');
  await page.getByTestId(`admitir-${origem}`).click();
  await expect(page.getByTestId('tela-admissao')).toBeVisible();
  await page.getByTestId('admissao-termo').locator('input').fill('JOSE DA SILVA');
  await page.getByTestId('admissao-buscar').click();
  await page.getByTestId('admissao-paciente-1001').click();
  await escolher(page.getByTestId('admissao-leito'), origem);
  await escolher(page.getByTestId('admissao-convenio'), '901');
  await escolher(page.getByTestId('admissao-especialidade'), '11');
  await page.getByTestId('admissao-termo-medico').locator('input').fill('ANA');
  await page.getByTestId('admissao-buscar-medico').click();
  await escolher(page.getByTestId('admissao-assistente'), '7101');
  await escolher(page.getByTestId('admissao-solicitante'), '7101');
  await page.getByTestId('admissao-termo-cid').locator('input').fill('I21');
  await page.getByTestId('admissao-buscar-cid').click();
  await escolher(page.getByTestId('admissao-cid'), '50001');
  await page.getByTestId('admissao-procedimento').locator('input').fill('303010037');
  await page.getByTestId('admissao-gravar').click();
  await expect(page.getByTestId('admissao-feita')).toBeVisible();
  await page.getByTestId('admissao-abrir').click();
  await expect(page).toHaveURL(/\/internacao\/\d+\/guias/);
  return Number(/\/internacao\/(\d+)\//.exec(page.url())?.[1]);
}

test.describe('@C1-057 autorização da internação e prorrogações', () => {
  test.setTimeout(180_000);

  test('guia inicial da admissão; sem conta parcial a prorrogação não grava, com o aviso; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.INTERNACAO');
    const reg = await admitir(page);
    expect(reg).toBeGreaterThan(0);

    const tela = page.getByTestId('tela-guias');
    await expect(tela).toBeVisible();
    await esperarSemSelectNativo(tela);
    // A guia inicial nasce com a admissão, na conta principal (a própria internação), com 1 diária.
    const inicial = page.getByTestId(`guia-${reg}`);
    await expect(inicial).toBeVisible();
    await expect(inicial.locator('td').nth(0)).toHaveText(String(reg));
    await expect(inicial.locator('td').nth(1)).toHaveText(String(reg));
    await expect(inicial.locator('td').nth(4)).toHaveText('1');
    // O histórico das autorizações pede o banco do cliente: a tela mostra o erro e não inventa histórico nem prévia.
    await expect(tela.getByTestId('mensagem-erro')).toBeVisible();
    await expect(page.getByTestId('tabela-historico-guias')).toHaveCount(0);

    // A prorrogação vai só na conta parcial: sem ela, o aviso, nenhuma conta para escolher e o botão desabilitado.
    await expect(page.getByTestId('guias-sem-parcial')).toContainText('Nenhuma conta parcial aberta');
    await esperarOpcoes(page.getByTestId('guia-conta'), 1);
    await expect(page.getByTestId('guia-gravar')).toBeDisabled();
    // Número, início e quem autorizou preenchidos não bastam: sem a conta parcial, nada grava.
    await page.getByTestId('guia-numero').locator('input').fill('PRORROG-0001');
    await page.getByTestId('guia-inicio').fill('2026-01-10');
    await page.getByTestId('guia-autorizador').locator('input').fill('AUDITOR SINTETICO');
    await expect(page.getByTestId('guia-gravar')).toBeDisabled();
    await expect(page.getByTestId('guia-gravada')).toHaveCount(0);
    await expect(page.getByTestId('guia-PRORROG-0001')).toHaveCount(0);
    await semViolacaoAxe(page, '/internacao/:reg/guias');
    expect(externas).toEqual([]);
  });
});
