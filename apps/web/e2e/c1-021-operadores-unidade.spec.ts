// E2E @C1-021 (F3.4, 04-INT linha 65): quem opera cada unidade de internação sai do cadastro da estrutura. Em
// "Blocos, acomodações e leitos" o atalho leva à tela dos operadores da unidade (admitir, transferir para ela, dar
// alta), com a unidade em combo do tema; nada de <select> cru; axe sem violação séria nas duas telas. Na fonte
// sintética a lista de operadores precisa do banco do cliente: a tela diz isso em vez de falhar calada; o efeito no
// banco (regra da unidade, retirada lógica, acesso total da sessão da plataforma) é provado no contrato de efeito
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

test.describe('@C1-021 operadores da unidade no cadastro da estrutura', () => {
  test('o cadastro dos leitos leva à tela dos operadores; axe nas duas telas', async ({ page }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/cadastros/estrutura/leitos');
    await expect(page.getByRole('heading', { level: 1, name: 'Blocos, acomodações e leitos' })).toBeVisible();
    const atalho = page.getByTestId('leitos-operadores-unidade');
    await expect(atalho).toHaveText('Quem opera cada unidade de internação');
    await semViolacaoAxe(page, '/cadastros/estrutura/leitos');
    await atalho.click();
    await expect(page).toHaveURL(/\/internacao\/unidades\/operadores$/);
    await expect(page.getByTestId('tela-operadores-unidade')).toBeVisible();
    expect(externas).toEqual([]);
  });

  test('a tela dos operadores escolhe a unidade pelo combo do tema; sem banco avisa; axe', async ({
    page,
  }) => {
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
