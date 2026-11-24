// E2E @F35-2 (F3.5, 05-SADT linhas 4, 5 e 7): o pedido de exames e as recoletas chegam pelo menu do SADT
// (Diagnóstico › Pedido de exames; Diagnóstico › Laboratório › Recoletas) a quem tem a permissão do cargo; a tela do
// pedido parte da busca do paciente (nunca um id digitado) e não oferece gravar antes do paciente escolhido e
// conferido; a tela de recoletas pede o código da amostra e o motivo do cadastro (combo do tema, nada de <select> cru).
// Na fonte sintética o pedido e a recoleta precisam do banco do cliente: a tela diz isso em vez de falhar calada; o
// efeito (requisição numerada, restrição e exceção, cancelamento com motivo, kit com versão, recoleta, alíquotas) é
// provado no contrato de efeito pedido-recoleta.int.spec.ts. axe sem violação séria em cada tela.
// Sessão real sobre a fonte sintética e as portas em MEMÓRIA (dados SINTÉTICOS; nada vai à cópia).
import { expect, type Page, test } from '@playwright/test';
import { itemDoMenu, semViolacaoAxe, vigiarExternas } from './ajuda.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('@F35-2 pedido de exames e recoletas pelo menu do SADT', () => {
  test('o laboratório abre o pedido e as recoletas pelo menu; sem banco a tela avisa; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.LABORATORIO');

    // Pedido de exames pelo menu.
    await (await itemDoMenu(page, 'Pedido de exames')).click();
    await expect(page).toHaveURL(/\/sadt\/pedido$/);
    await expect(page.getByTestId('pedido-exames')).toBeVisible();
    await expect(page.locator('[data-testid="pedido-exames"] select')).toHaveCount(0);
    // Nada a gravar antes de escolher e conferir o paciente.
    await expect(page.getByTestId('pedido-gravar')).toHaveCount(0);
    await expect(page.getByTestId('pedido-cabecalho')).toHaveCount(0);
    await page.getByTestId('pedido-busca').fill('SINTETICO');
    await page.getByTestId('pedido-buscar').click();
    // Na fonte sintética, o aviso de que o pedido precisa do banco do cliente (sem gravar nada).
    await expect(page.getByTestId('recusa-sadt')).toBeVisible();
    await expect(page.getByTestId('pedido-gravar')).toHaveCount(0);
    await semViolacaoAxe(page, '/sadt/pedido');

    // Recoletas pelo menu.
    await (await itemDoMenu(page, 'Recoletas')).click();
    await expect(page).toHaveURL(/\/sadt\/recoletas$/);
    await expect(page.getByTestId('recoletas')).toBeVisible();
    await expect(page.getByTestId('recoleta-codigo')).toBeVisible();
    await expect(page.locator('[data-testid="recoletas"] select')).toHaveCount(0);
    await expect(page.getByTestId('recusa-sadt').first()).toBeVisible();
    await semViolacaoAxe(page, '/sadt/recoletas');

    expect(externas).toEqual([]);
  });

  test('quem não tem a permissão do pedido não vê o item no menu nem abre a tela', async ({ page }) => {
    await entrar(page, 'SINT.MEDICO');
    await expect(await itemDoMenu(page, 'Recoletas')).toHaveCount(0);
  });
});
