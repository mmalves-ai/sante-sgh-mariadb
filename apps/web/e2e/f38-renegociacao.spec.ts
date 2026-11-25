// F3.8-05 (07-FIN linha 76): a tela de renegociação de títulos a receber. Quem lança escolhe o tipo de devedor, marca um
// título em aberto e vê a prévia do acordo na hora: o total, as parcelas mensais e a recusa da regra (desconto que zera
// o acordo) antes de gravar. A tela de demonstrativos mostra o bloco da baixa pelo demonstrativo da operadora. Axe em
// cada passo. A gravação do acordo e da baixa é provada no contrato de efeito contra o banco
// (renegociacao-demonstrativo.int.spec.ts): a fonte sintética do E2E não tem os demonstrativos importados.
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('financeiro: renegociação a receber e baixa pelo demonstrativo @F3.8-05', () => {
  test.setTimeout(180_000);

  test('marcar o título → prévia do acordo na hora → recusa do desconto total; bloco da baixa; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.FIN.LANCA');
    await page.goto('/financeiro/receber/renegociacoes');
    await expect(page.getByTestId('tela-fin-renegociacoes')).toBeVisible();
    await expect(page.getByTestId('ac-formulario')).toBeVisible();
    await semViolacaoAxe(page, '/financeiro/receber/renegociacoes');

    // Sem título marcado não há prévia nem botão de gravar.
    await escolher(page.getByTestId('ac-tipo'), 'Convênio');
    await expect(page.getByTestId('ac-titulos')).toBeVisible();
    await expect(page.getByTestId('ac-gravar')).toHaveCount(0);
    await page.getByTestId('ac-titulos').locator('tbody tr input[type="checkbox"]').first().check();

    // A prévia aparece na hora: uma parcela pelo saldo; com três, três linhas.
    await expect(page.getByTestId('ac-previa')).toBeVisible();
    await expect(page.getByTestId('ac-previa-parcelas').locator('tbody tr')).toHaveCount(1);
    await page.getByTestId('ac-parcelas').fill('3');
    await expect(page.getByTestId('ac-previa-parcelas').locator('tbody tr')).toHaveCount(3);
    await expect(page.getByTestId('ac-previa-total')).toContainText('R$');
    await semViolacaoAxe(page, '/financeiro/receber/renegociacoes (prévia)');

    // A regra recusa antes de gravar: o desconto não pode zerar o acordo; corrigido, a prévia volta.
    await page.getByTestId('ac-desconto').fill('99999999');
    await expect(page.getByTestId('ac-impedimento')).toContainText('desconto');
    await expect(page.getByTestId('ac-previa')).toHaveCount(0);
    await expect(page.getByTestId('ac-gravar')).toBeDisabled();
    await page.getByTestId('ac-desconto').fill('');
    await expect(page.getByTestId('ac-impedimento')).toHaveCount(0);
    await expect(page.getByTestId('ac-previa')).toBeVisible();
    await page.getByTestId('ac-parcelas').fill('0');
    await expect(page.getByTestId('ac-impedimento')).toContainText('parcelas');

    // A tela de demonstrativos traz o bloco da baixa pelo demonstrativo da operadora.
    await page.goto('/financeiro/receber/demonstrativos');
    await expect(page.getByTestId('tela-fin-demonstrativos')).toBeVisible();
    await expect(page.getByTestId('fin-baixa-demonstrativo')).toBeVisible();
    await semViolacaoAxe(page, '/financeiro/receber/demonstrativos (baixa pelo demonstrativo)');
    expect(externas).toEqual([]);
  });
});
