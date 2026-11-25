// E2E @F3.5-04 (F3.5, 05-SADT linha 7): o posto de coleta como cadastro próprio e a etiqueta da recoleta e da alíquota.
// A biomédica chega às recoletas pelo menu (Diagnóstico › Laboratório › Recoletas), encontra a reimpressão da etiqueta
// (só com o código da amostra) e abre o cadastro dos postos pelo atalho da própria tela; o formulário do posto confere
// na hora o que impede gravar (código, descrição, setor, horário) e usa só o combo do tema (nada de <select> cru).
// Na fonte sintética o cadastro precisa do banco do cliente: a tela diz isso em vez de falhar calada; o efeito (posto
// incluído, alterado e inativado, etiqueta na fila com a impressão gravada, recoleta no posto, quem cancelou) é provado
// no contrato de efeito posto-etiqueta.int.spec.ts. axe sem violação séria em cada tela.
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

test.describe('@F3.5-04 posto de coleta e etiqueta da recoleta', () => {
  test('das recoletas ao cadastro do posto, com a conferência na hora; sem banco a tela avisa; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.BIOMEDICO');

    // Recoletas pelo menu: a reimpressão da etiqueta só se oferece com o código da amostra.
    await (await itemDoMenu(page, 'Recoletas')).click();
    await expect(page).toHaveURL(/\/sadt\/recoletas$/);
    await expect(page.getByTestId('recoletas')).toBeVisible();
    await expect(page.getByTestId('recoleta-reimprimir')).toBeDisabled();
    await page.getByTestId('recoleta-codigo').fill('SINT0000000017');
    await expect(page.getByTestId('recoleta-reimprimir')).toBeEnabled();
    await expect(page.locator('[data-testid="recoletas"] select')).toHaveCount(0);

    // O cadastro dos postos pelo atalho da tela.
    await page.getByTestId('recoleta-postos').click();
    await expect(page).toHaveURL(/\/sadt\/postos-coleta$/);
    await expect(page.getByTestId('postos-coleta')).toBeVisible();
    await expect(page.locator('[data-testid="postos-coleta"] select')).toHaveCount(0);
    // Antes de digitar, nenhum aviso e nada a gravar.
    await expect(page.getByTestId('posto-problema')).toHaveCount(0);
    await expect(page.getByTestId('posto-salvar')).toBeDisabled();
    // Conferência na hora: código inválido, depois descrição curta, depois o setor que falta.
    await page.getByTestId('posto-codigo').fill('posto com espaço');
    await expect(page.getByTestId('posto-problema')).toContainText('código');
    await page.getByTestId('posto-codigo').fill('PC-01');
    await expect(page.getByTestId('posto-problema')).toContainText('Descreva');
    await page.getByTestId('posto-descricao').fill('Posto do térreo');
    await expect(page.getByTestId('posto-problema')).toContainText('setor');
    await expect(page.getByTestId('posto-salvar')).toBeDisabled();
    // Limpar volta ao posto novo, sem aviso.
    await page.getByTestId('posto-limpar').click();
    await expect(page.getByTestId('posto-codigo')).toHaveValue('');
    await expect(page.getByTestId('posto-problema')).toHaveCount(0);
    // Na fonte sintética, o aviso de que o cadastro precisa do banco do cliente.
    await expect(page.getByTestId('recusa-sadt').first()).toBeVisible();
    await semViolacaoAxe(page, '/sadt/postos-coleta');

    // A volta às recoletas.
    await page.getByTestId('postos-voltar').click();
    await expect(page).toHaveURL(/\/sadt\/recoletas$/);
    await semViolacaoAxe(page, '/sadt/recoletas');

    expect(externas).toEqual([]);
  });

  test('quem não tem a leitura de amostras não abre o cadastro dos postos', async ({ page }) => {
    await entrar(page, 'SINT.MEDICO');
    await expect(await itemDoMenu(page, 'Recoletas')).toHaveCount(0);
    await page.goto('/sadt/postos-coleta');
    await expect(page.getByTestId('postos-coleta')).toHaveCount(0);
  });
});
