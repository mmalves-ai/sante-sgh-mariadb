// E2E @F34-1 (F3.4, 04-INT linhas 65, 67 e 68): a partir da internação admitida, o atalho "Diagnósticos e acidente"
// abre a tela dos registros da internação; o acidente de trabalho é conferido na hora pela mesma regra do domínio
// (quando ocorreu, CNPJ do empregador que não confere, empregador) e o botão só libera com a regra cumprida; a tela das
// guias mostra os campos do início e de quem autorizou; a tela de quem opera cada unidade abre com a unidade em combo
// do tema. Nada de <select> cru; axe sem violação séria em cada tela.
// Na fonte sintética os registros (diagnósticos, acidente, histórico das guias, operadores) precisam do banco do
// cliente: a tela diz isso em vez de falhar calada; o efeito no banco é provado no contrato de efeito
// apps/api/src/modulos/adt/registros-internacao.int.spec.ts. Sessão real sobre a fonte sintética e as portas em
// MEMÓRIA (dados SINTÉTICOS; nada vai à cópia).
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher, esperarSemSelectNativo } from './combos.js';

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
  // Paciente próprio deste arquivo (o paciente 1004): a fonte sintética guarda as internações em memória durante o lote, e
  // o 1001 já fica internado pelos outros arquivos que admitem (a segunda admissão é recusada, como deve ser).
  await page.getByTestId('admissao-termo').locator('input').fill('ANTONIO CONCEICAO');
  await page.getByTestId('admissao-buscar').click();
  await page.getByTestId('admissao-paciente-1004').click();
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

test.describe('@F34-1 registros da internação, guias e operadores da unidade', () => {
  test.setTimeout(180_000);

  test('diagnósticos e acidente conferidos na hora; guias com início e autorizador; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.INTERNACAO');
    const reg = await admitir(page);
    expect(reg).toBeGreaterThan(0);

    // Guias: os campos do início e de quem autorizou na operadora, sem <select> cru.
    await expect(page.getByTestId('tela-guias')).toBeVisible();
    await expect(page.getByTestId('guia-inicio')).toBeVisible();
    await expect(page.getByTestId('guia-autorizador')).toBeVisible();
    await expect(page.locator('[data-testid="tela-guias"] select')).toHaveCount(0);
    await semViolacaoAxe(page, '/internacao/:reg/guias');

    // O atalho da internação leva aos diagnósticos e ao acidente.
    await page.getByRole('link', { name: 'Diagnósticos e acidente' }).click();
    await expect(page).toHaveURL(new RegExp(`/internacao/${reg}/registros$`));
    const tela = page.getByTestId('tela-registros-internacao');
    await expect(tela).toBeVisible();
    await esperarSemSelectNativo(tela);
    // Sem banco do cliente, a tela avisa (o efeito é provado no contrato de efeito).
    await expect(tela).toContainText('banco do cliente');

    // Acidente de trabalho: a regra do domínio conferida na hora, o botão só libera com ela cumprida.
    await escolher(page.getByTestId('acidente-tipo'), 'trabalho');
    await expect(page.getByTestId('acidente-conferencia')).toContainText(
      'quando o acidente de trabalho ocorreu',
    );
    await expect(page.getByTestId('acidente-gravar')).toBeDisabled();
    await page.getByTestId('acidente-ocorrido').fill('2020-01-02T08:30');
    await expect(page.getByTestId('acidente-conferencia')).toContainText('Informe o empregador');
    await page.getByTestId('acidente-cnpj').locator('input').fill('11.111.111/1111-11');
    await expect(page.getByTestId('acidente-conferencia')).toContainText('CNPJ do empregador não confere');
    await page.getByTestId('acidente-cnpj').locator('input').fill('');
    await page.getByTestId('acidente-empregador').locator('input').fill('EMPRESA SINTETICA');
    await expect(page.getByTestId('acidente-conferencia')).toHaveCount(0);
    await expect(page.getByTestId('acidente-gravar')).toBeEnabled();
    // O diagnóstico novo só grava com o CID escolhido.
    await expect(page.getByTestId('registros-gravar-diagnostico')).toBeDisabled();
    await semViolacaoAxe(page, '/internacao/:reg/registros');
    expect(externas).toEqual([]);
  });

  test('quem opera cada unidade: unidade em combo do tema; sem banco a tela avisa; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.INTERNACAO');
    await page.goto('/internacao/unidades/operadores');
    const tela = page.getByTestId('tela-operadores-unidade');
    await expect(tela).toBeVisible();
    await esperarSemSelectNativo(tela);
    await escolher(page.getByTestId('operadores-unidade'), '4');
    await expect(tela).toContainText('banco do cliente');
    await semViolacaoAxe(page, '/internacao/unidades/operadores');
    expect(externas).toEqual([]);
  });
});
