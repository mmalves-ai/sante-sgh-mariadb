// E2E @C1-057 (F3.4, 04-INT linha 68): a autorização da internação e as prorrogações. A admissão já leva à tela das
// guias; ali o registro da prorrogação pede a conta parcial (combo do tema), o número da guia, a senha, as diárias
// liberadas, o início (opcional: sem ele a validade começa no dia seguinte ao fim da anterior, sem buraco) e quem
// autorizou na operadora. O botão só libera com conta e guia; nada de <select> cru; axe sem violação séria.
// Na fonte sintética o histórico das guias (inicial, prorrogações, correção com motivo) precisa do banco do cliente: o
// efeito no banco é provado no contrato de efeito apps/api/src/modulos/adt/registros-internacao.int.spec.ts
// (prorrogação com a validade seguinte e o autorizador; correção sem linha nova nem diárias somadas). Sessão real
// sobre a fonte sintética e as portas em MEMÓRIA (dados SINTÉTICOS; nada vai à cópia).
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

  test('guias: conta parcial em combo, início e autorizador; gravar só com conta e guia; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.INTERNACAO');
    const reg = await admitir(page);
    expect(reg).toBeGreaterThan(0);

    const tela = page.getByTestId('tela-guias');
    await expect(tela).toBeVisible();
    await esperarSemSelectNativo(tela);
    // A guia inicial nasce com a admissão e aparece entre as guias da conta.
    await expect(page.getByTestId('tabela-guias')).toBeVisible();

    // O formulário da prorrogação: conta parcial, número, início e quem autorizou.
    await expect(page.getByTestId('guia-conta')).toBeVisible();
    await expect(page.getByTestId('guia-numero')).toBeVisible();
    await expect(page.getByTestId('guia-inicio')).toBeVisible();
    await expect(page.getByTestId('guia-autorizador')).toBeVisible();
    await expect(page.getByTestId('guia-gravar')).toBeDisabled();
    // Só o número não basta: a prorrogação pede a conta parcial.
    await page.getByTestId('guia-numero').locator('input').fill('PRORROG-0001');
    await page.getByTestId('guia-autorizador').locator('input').fill('AUDITOR SINTETICO');
    await page.getByTestId('guia-inicio').fill('2026-01-10');
    await expect(page.getByTestId('guia-gravar')).toBeDisabled();
    await semViolacaoAxe(page, '/internacao/:reg/guias');
    expect(externas).toEqual([]);
  });
});
