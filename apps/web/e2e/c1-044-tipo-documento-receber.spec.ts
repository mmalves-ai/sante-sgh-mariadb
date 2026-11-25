// C1-044 (07-FIN linha 99): tipo por perfil no título a receber. Na tela de permissões do financeiro, a operação "Título
// a receber" lista tipos de documento financeiro (fatura, recibo); marcar o primeiro restringe o perfil só nessa operação
// (no título a pagar o perfil segue livre), retirar o último deixa o perfil restrito sem nada e desfazer a restrição é
// um passo explícito. Fonte sintética (sessão em memória). Axe no fim.
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const PERFIL = '9302';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

/** Deixa o perfil livre e sem tipo marcado na operação aberta (a memória da sessão sintética guarda entre execuções). */
async function limparOperacao(page: Page, codigos: readonly string[]): Promise<void> {
  for (const c of codigos) {
    const caixa = page.getByTestId(`pfin-tipo-${c}`);
    await expect(caixa).toBeVisible();
    if (await caixa.isChecked()) {
      await caixa.click();
      await expect(caixa).not.toBeChecked();
    }
  }
  if ((await page.getByTestId('pfin-tipos-aviso').textContent())?.includes('Perfil restrito')) {
    await page.getByTestId('pfin-restricao').click();
    await expect(page.getByTestId('pfin-tipos-aviso')).toContainText('Perfil livre');
  }
}

test.describe('financeiro: tipo de documento por perfil no título a receber @C1-044', () => {
  test.setTimeout(180_000);

  test('a lista do título a receber é de tipos de documento e vale só nessa operação; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.FIN.LANCA');
    await page.goto('/financeiro/parametros/permissoes');
    await expect(page.getByTestId('tela-fin-permissoes')).toBeVisible();

    await escolher(page.getByTestId('pfin-perfil'), PERFIL);
    await escolher(page.getByTestId('pfin-operacao'), 'contas_receber');
    const tipos = page.getByTestId('pfin-tipos');
    await expect(tipos.getByRole('columnheader', { name: 'Tipo de documento' })).toBeVisible();
    await limparOperacao(page, ['fatura', 'recibo']);
    const aviso = page.getByTestId('pfin-tipos-aviso');
    await expect(aviso).toContainText('Perfil livre');

    // Marcar o recibo restringe o perfil: a fatura fica de fora.
    const recibo = page.getByTestId('pfin-tipo-recibo');
    await recibo.click();
    await expect(recibo).toBeChecked();
    await expect(aviso).toContainText('Perfil restrito');
    await expect(page.getByTestId('pfin-tipo-fatura')).not.toBeChecked();

    // No título a pagar o mesmo perfil segue com a sua própria lista (tipos de credor).
    await escolher(page.getByTestId('pfin-operacao'), 'contas_pagar');
    await expect(tipos.getByRole('columnheader', { name: 'Tipo de credor' })).toBeVisible();
    await expect(page.getByTestId('pfin-tipo-fatura')).toHaveCount(0);

    // De volta ao título a receber: retirar o último tipo deixa o perfil restrito sem nada; desfazer é explícito.
    await escolher(page.getByTestId('pfin-operacao'), 'contas_receber');
    await expect(recibo).toBeChecked();
    await recibo.click();
    await expect(recibo).not.toBeChecked();
    await expect(aviso).toContainText('Perfil restrito');
    await semViolacaoAxe(page, '/financeiro/parametros/permissoes (título a receber restrito sem tipo)');
    await page.getByTestId('pfin-restricao').click();
    await expect(aviso).toContainText('Perfil livre');
    expect(externas).toEqual([]);
  });
});
