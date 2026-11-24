// F3.8 (financeiro): o adiantamento ponta a ponta. Conceder ao fornecedor (sai da conta), compensar no título em aberto
// do mesmo credor (a tela lista só os títulos dele e sugere o valor) e registrar a devolução do saldo; axe em cada passo.
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

const linhaCom = (page: Page, tabela: string, texto: string) =>
  page.getByTestId(tabela).locator('tbody tr', { hasText: texto });

test.describe('financeiro: adiantamento @F3.8', () => {
  test.setTimeout(240_000);

  test('conceder → compensar no título do mesmo credor → devolver o saldo; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    const documento = String(600_000 + (Date.now() % 100_000));
    const finalidade = `Viagem técnica ${documento}`;

    // O título em aberto do credor 5001, lançado por quem lança.
    await entrar(page, 'SINT.FIN.LANCA');
    await page.goto('/financeiro/pagar/titulos');
    await page.getByTestId('tp-novo').click();
    await page.getByTestId('tp-novo-credor').fill('5001');
    await page.getByTestId('tp-novo-documento').fill(documento);
    await page.getByTestId('tp-novo-valor').fill('1500');
    await page.getByTestId('tp-novo-quantas').fill('1');
    await escolher(page.getByTestId('tp-novo-classificacao'), '216.2.1');
    await page.getByTestId('tp-lancar').click();
    await expect(page.getByTestId('tp-mensagem')).toContainText('lançado');

    // A tesouraria concede o adiantamento de 2.000,00 ao mesmo credor.
    await entrar(page, 'SINT.FIN.PAGA');
    await page.goto('/financeiro/pagar/adiantamentos');
    await expect(page.getByTestId('tela-fin-adiantamentos')).toBeVisible();
    await expect(page.getByTestId('ad-conceder')).toBeDisabled();
    await page.getByTestId('ad-novo-credor').fill('5001');
    await page.getByTestId('ad-novo-valor').fill('2000');
    await page.getByTestId('ad-novo-referente').fill(finalidade);
    await semViolacaoAxe(page, '/financeiro/pagar/adiantamentos (novo)');
    await page.getByTestId('ad-conceder').click();
    await expect(page.getByTestId('ad-mensagem')).toContainText('concedido');
    const linha = linhaCom(page, 'ad-lista', finalidade);
    await expect(linha).toContainText('2.000,00');

    // Compensa no título do credor: o valor sugerido é o saldo do título (1.500,00); sobra 500,00.
    await linha.getByRole('button').click();
    const titulo = page.getByTestId('ad-titulos').locator('li', { hasText: `${documento}/1` });
    await expect(titulo).toContainText('1.500,00');
    await semViolacaoAxe(page, '/financeiro/pagar/adiantamentos (compensar)');
    await titulo.getByRole('button').click();
    await expect(page.getByTestId('ad-mensagem')).toContainText('compensado');
    await expect(linhaCom(page, 'ad-lista', finalidade)).toContainText('500,00');

    // A devolução do saldo pede o motivo e encerra o adiantamento.
    await linhaCom(page, 'ad-lista', finalidade).getByRole('button').click();
    await expect(page.getByTestId('ad-devolver')).toBeDisabled();
    await page.getByTestId('ad-dev-valor').fill('500');
    await page.getByTestId('ad-dev-motivo').fill('Sobra devolvida pelo fornecedor');
    await page.getByTestId('ad-devolver').click();
    await expect(page.getByTestId('ad-mensagem')).toContainText('Devolução');
    await expect(linhaCom(page, 'ad-lista', finalidade)).toContainText('Encerrado');
    await semViolacaoAxe(page, '/financeiro/pagar/adiantamentos (encerrado)');
    expect(externas).toEqual([]);
  });
});
