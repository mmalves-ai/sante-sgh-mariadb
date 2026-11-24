// F3.8 (07-FIN linha 98): a reclassificação gerencial achada pelo número de negócio, sem id do banco. Quem lança grava o
// título a pagar; na tela de reclassificação, a busca pelo número do documento abre o lançamento direto (um só achado),
// com a classificação atual ao lado da nova; o botão só libera com o motivo mínimo. Do detalhe do título, o botão
// Reclassificar chega à mesma tela com o lançamento aberto. Axe em cada passo.
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

test.describe('financeiro: reclassificação pelo número @F3.8-reclassificacao', () => {
  test.setTimeout(180_000);

  test('busca pelo documento abre o lançamento; motivo mínimo; link do título; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    const documento = String(700_000 + (Date.now() % 100_000));
    await entrar(page, 'SINT.FIN.LANCA');
    await page.goto('/financeiro/pagar/titulos');
    await page.getByTestId('tp-novo').click();
    await page.getByTestId('tp-novo-credor').fill('5001');
    await page.getByTestId('tp-novo-documento').fill(documento);
    await page.getByTestId('tp-novo-valor').fill('800');
    await page.getByTestId('tp-novo-quantas').fill('1');
    await escolher(page.getByTestId('tp-novo-classificacao'), '216.2.1');
    await page.getByTestId('tp-lancar').click();
    await expect(page.getByTestId('tp-mensagem')).toContainText('lançado');

    await page.goto('/financeiro/gerencial/reclassificar');
    await expect(page.getByTestId('tela-fin-reclassificar')).toBeVisible();
    await page.getByTestId('rc-numero').fill('000-nao-existe');
    await page.getByTestId('rc-buscar').click();
    await expect(page.getByTestId('rc-nenhum')).toBeVisible();
    await page.getByTestId('rc-numero').fill(documento);
    await page.getByTestId('rc-buscar').click();
    await expect(page.getByTestId('rc-lancamento')).toBeVisible();
    await expect(page.getByTestId('rc-natureza-atual')).toContainText('216.2.1');
    await expect(page.getByTestId('rc-soma')).toContainText('100');
    // Sem o motivo mínimo, o botão fica preso (validação na hora).
    await page.getByTestId('rc-motivo').fill('curto');
    await expect(page.getByTestId('rc-confirmar')).toBeDisabled();
    await semViolacaoAxe(page, '/financeiro/gerencial/reclassificar (lançamento aberto)');

    // Do detalhe do título, o botão leva alvo e id: a tela abre o lançamento sem busca.
    const url = page.url();
    expect(url).toContain('/financeiro/gerencial/reclassificar');
    await page.goto('/financeiro/pagar/titulos');
    await page
      .getByTestId('tp-lista')
      .locator('tbody tr', { hasText: documento })
      .getByRole('link')
      .first()
      .click();
    await page.getByTestId('tpd-reclassificar').click();
    await expect(page).toHaveURL(/alvo=titulo_pagar&id=\d+/);
    await expect(page.getByTestId('rc-lancamento')).toBeVisible();
    await expect(page.getByTestId('rc-natureza-atual')).toContainText('216.2.1');
    expect(externas).toEqual([]);
  });
});
