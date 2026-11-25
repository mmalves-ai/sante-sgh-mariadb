// E2E @C1-020 (F3.6, 05-SUP linha 3): a concessão do usuário só por classificação de despesa, pela tela do escopo. A
// pessoa acha o usuário, troca "conceder por" para a classificação de despesa, escolhe a classificação e concede; a
// concessão aparece marcada como de despesa (atravessa os grupos ligados a ela) e se retira com motivo. Roda com a
// porta do cadastro do estoque EM MEMÓRIA (usuários e classificações SINTÉTICOS; nada vai ao banco). O que fica no
// banco, e a restrição que a concessão impõe ao requisitar, movimentar e comprar, estão no contrato de efeito
// politica-local-propria.int.spec.ts.
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const DESPESA = 'MATERIAIS SINTETICOS';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('Escopo do usuário por classificação de despesa @C1-020', () => {
  test('concede só pela classificação de despesa, a concessão aparece como de despesa e se retira; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/suprimentos/usuarios-estoque/escopo');
    await expect(page.getByTestId('tela-suprimentos-escopo-cadastro')).toBeVisible();
    await page.getByTestId('escopo-termo').fill('ALMOX');
    await page.getByTestId('escopo-termo').press('Enter');
    await page.getByTestId('escopo-usuario-SINT.ALMOXARIFE').click();
    await expect(page.getByTestId('escopo-grade')).toBeVisible();

    // "Conceder por" troca o combo do grupo pelo da classificação de despesa.
    await escolher(page.getByTestId('escopo-conceder-por'), {
      rotulo: 'Classificação de despesa (todos os grupos dela)',
    });
    await escolher(page.getByTestId('escopo-despesa'), { rotulo: `MAT · ${DESPESA}` });
    const form = page.locator('form', { has: page.getByTestId('escopo-despesa') });
    await form.getByRole('button', { name: 'Conceder' }).click();
    await expect(page.getByTestId('recusa-suprimentos')).toHaveCount(0);
    const concessao = page.locator('li', { hasText: `Classificação de despesa: ${DESPESA}` });
    await expect(concessao).toHaveCount(1);
    await expect(concessao).toContainText('Vigente');
    await semViolacaoAxe(page, '/suprimentos/usuarios-estoque/escopo');

    // Retirar pede motivo; a concessão que começou hoje é cancelada e sai da lista.
    await page.getByTestId('escopo-motivo-retirada').fill('Mudou de função no estoque');
    await concessao.getByRole('button', { name: 'Retirar' }).click();
    await expect(page.getByTestId('recusa-suprimentos')).toHaveCount(0);
    await expect(concessao).toHaveCount(0);
    expect(externas).toEqual([]);
  });
});
