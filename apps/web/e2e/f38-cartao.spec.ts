// F3.8 (07-FIN linha 89): a tela do cartão de débito e crédito. Chega-se por um clique a partir do fluxo de caixa; na
// aba das taxas a taxa digitada é conferida a cada tecla pela regra do domínio (percentual em branco ou faixa de
// parcelas fora do limite prende o botão e diz o motivo), a venda de exemplo mostra na hora a taxa, o líquido e o
// primeiro crédito, e fora do crédito a faixa de parcelas some (débito é parcela única). A fonte do E2E é a sintética,
// sem banco: a gravação (taxa com vigência, transação e parcelas a receber do recebimento, fluxo de caixa projetado e
// baixa do crédito) é provada nos contratos de efeito cartao.int.spec.ts e porta-propria.int.spec.ts do faturamento.
// Axe nos passos.
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

test.describe('financeiro: cartão de débito e crédito @F3.8-07', () => {
  test.setTimeout(180_000);

  test('atalho do fluxo de caixa; taxa conferida a cada tecla e venda de exemplo na hora; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.FIN.LANCA');
    await page.goto('/financeiro/tesouraria/fluxo-caixa');
    await page.getByTestId('fc-cartao').click();
    await expect(page).toHaveURL(/\/financeiro\/receber\/cartao/);
    await expect(page.getByTestId('tela-fin-cartao')).toBeVisible();
    await expect(page.getByTestId('ct-aba-receber')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('ct-de')).not.toHaveValue('');
    await semViolacaoAxe(page, '/financeiro/receber/cartao (a receber)');

    await page.getByTestId('ct-aba-taxas').click();
    await expect(page.getByTestId('ct-aba-taxas')).toHaveAttribute('aria-pressed', 'true');
    // Percentual em branco: o motivo aparece na hora e o botão fica preso.
    await expect(page.getByTestId('ct-recusa-taxa')).toContainText('percentual');
    await expect(page.getByTestId('ct-gravar-taxa')).toBeDisabled();
    // Crédito de 1 a 3 parcelas a 2,5%: a venda de exemplo de R$ 1.000,00 mostra a taxa, o líquido e o prazo.
    await page.getByTestId('ct-percentual').fill('2,5');
    await page.getByTestId('ct-parcela-final').fill('3');
    await expect(page.getByTestId('ct-recusa-taxa')).toHaveCount(0);
    const simulacao = page.getByTestId('ct-simulacao');
    await expect(simulacao).toContainText('em 3x');
    await expect(simulacao).toContainText('25,00');
    await expect(simulacao).toContainText('975,00');
    await expect(simulacao).toContainText('30 dia(s)');
    // Outro valor de exemplo: a conta refaz na hora.
    await page.getByTestId('ct-exemplo').fill('200');
    await expect(simulacao).toContainText('195,00');
    // Faixa de parcelas fora do limite: recusada antes de enviar.
    await page.getByTestId('ct-parcela-final').fill('30');
    await expect(page.getByTestId('ct-recusa-taxa')).toContainText('faixa de parcelas');
    await expect(page.getByTestId('ct-gravar-taxa')).toBeDisabled();
    // Percentual de 100: recusado.
    await page.getByTestId('ct-parcela-final').fill('3');
    await page.getByTestId('ct-percentual').fill('100');
    await expect(page.getByTestId('ct-recusa-taxa')).toContainText('menos de 100');
    await page.getByTestId('ct-percentual').fill('1,2');
    // Débito é parcela única: a faixa some e a venda de exemplo vira 1x.
    await escolher(page.getByTestId('ct-modalidade'), 'debito');
    await expect(page.getByTestId('ct-parcela-inicial')).toHaveCount(0);
    await expect(page.getByTestId('ct-parcela-final')).toHaveCount(0);
    await expect(simulacao).toContainText('em 1x');
    // Taxa em valor fixo por venda.
    await escolher(page.getByTestId('ct-tipo'), 'valor');
    await expect(page.getByTestId('ct-recusa-taxa')).toContainText('valor fixo');
    await page.getByTestId('ct-valor').fill('0,50');
    await expect(simulacao).toContainText('0,50');
    await expect(simulacao).toContainText('199,50');
    // Sem administradora escolhida a taxa não é gravada.
    await expect(page.getByTestId('ct-gravar-taxa')).toBeDisabled();
    // Administradora nova: o nome curto prende o botão.
    await page.getByTestId('ct-adm-nome').fill('A');
    await expect(page.getByTestId('ct-gravar-administradora')).toBeDisabled();
    await page.getByTestId('ct-adm-nome').fill('Administradora Sintética');
    await expect(page.getByTestId('ct-gravar-administradora')).toBeEnabled();
    await semViolacaoAxe(page, '/financeiro/receber/cartao (taxas)');
    expect(externas).toEqual([]);
  });
});
