// E2E @M43 (ficha, campo 10): painel e totem por token, sem login de pessoa: o totem emite a senha, o guichê chama e o
// painel mostra a chamada; revogado o token, o painel e o totem saem de serviço (a sessão do aparelho acaba).
// Lote 02-07 (ADR 0003): a aba do fim da coexistência e a revisão dos sem grupo saíram com a convivência.
// Sessão real sobre a fonte sintética de dev e as portas EM MEMÓRIA (aparelhos SINTÉTICOS; nada vai à cópia).
import { expect, test, type Page } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

/** Cadastra o aparelho e devolve o endereço com o token (aparece uma vez). */
async function cadastrarAparelho(page: Page, tipo: 'totem' | 'painel', nome: string): Promise<string> {
  await page.getByTestId(`novo-${tipo}`).click();
  const dialogo = page.getByRole('dialog', { name: 'Cadastrar aparelho' });
  await dialogo.getByLabel('Nome do aparelho').fill(nome);
  if (tipo === 'totem') await dialogo.getByLabel('MC · MARCACAO DE CONSULTA').check();
  await page.getByTestId(`gravar-${tipo}`).click();
  const endereco = page.getByTestId('endereco-aparelho');
  await expect(endereco).toContainText('#token=');
  const texto = (await endereco.textContent())!.trim();
  await page.getByTestId('fechar-token').click();
  return new URL(texto).pathname + new URL(texto).hash;
}

test.describe('Painel e totem por token @M43 @fase4', () => {
  test.setTimeout(180_000);

  test('painel e totem por token sem login de pessoa: senha emitida, chamada no painel; revogado, fora de serviço; axe', async ({
    page,
    context,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.SENHAS');
    await page.goto('/recepcao/senhas/geradores');
    await expect(page.getByTestId('tela-geradores')).toBeVisible();
    const totemEndereco = await cadastrarAparelho(page, 'totem', 'Totem da onda 5');
    await page.goto('/recepcao/senhas/paineis');
    const painelEndereco = await cadastrarAparelho(page, 'painel', 'TV da onda 5');

    // O totem emite a senha pelo token do aparelho (nenhum login de pessoa no aparelho).
    const totem = await context.newPage();
    await totem.goto(totemEndereco);
    await expect(totem.getByTestId('totem')).toContainText('Toque no serviço');
    await totem.getByTestId('totem-servico-24').click();
    await expect(totem.getByTestId('totem-senha')).toHaveText(/^MC \d{3}$/);
    await semViolacaoAxe(totem, '/totem (onda 5)');

    // O guichê chama e o painel mostra a chamada.
    const tv = await context.newPage();
    await tv.goto(painelEndereco);
    await expect(tv.getByTestId('painel-atual')).toBeVisible();
    await page.goto('/recepcao/guiche');
    await page.getByTestId('guiche-numero').fill('4');
    await page.getByTestId('guiche-abrir').click();
    await expect(page.getByTestId('guiche-situacao')).toContainText('Guichê 4 aberto');
    await page.getByTestId('chamar-proxima').click();
    await expect(tv.getByTestId('painel-senha')).toHaveText(/^[A-Z]{2} \d{3}$/, { timeout: 10_000 });
    await semViolacaoAxe(tv, '/painel (onda 5)');

    // Revogado o token, a sessão do aparelho acaba: o painel e o totem saem de serviço.
    await page.goto('/recepcao/senhas/paineis');
    const linhaTv = page.locator('[data-testid^="dispositivo-"]', { hasText: 'TV da onda 5' });
    await linhaTv.getByRole('button', { name: 'Revogar' }).click();
    await page.getByTestId('confirmacao').getByRole('button', { name: 'Confirmar' }).click();
    await expect(linhaTv).toContainText('Revogado em');
    await expect(tv.getByTestId('painel-fora')).toBeVisible({ timeout: 45_000 });
    await page.goto('/recepcao/senhas/geradores');
    const linhaTotem = page.locator('[data-testid^="dispositivo-"]', { hasText: 'Totem da onda 5' });
    await linhaTotem.getByRole('button', { name: 'Revogar' }).click();
    await page.getByTestId('confirmacao').getByRole('button', { name: 'Confirmar' }).click();
    await expect(linhaTotem).toContainText('Revogado em');
    await totem.reload();
    await expect(totem.getByTestId('totem-fora')).toContainText('fora de serviço');
    await semViolacaoAxe(totem, '/totem revogado');
    expect(externas).toEqual([]);
  });
});
