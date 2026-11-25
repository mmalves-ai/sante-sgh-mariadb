// E2E @C2-005 (F3.2, 02-REC linha 33): a situação da senha é nominal de ponta a ponta. O guichê chama a próxima, o
// paciente não atende e a senha fica "Não compareceu" (fora da fila, sem guichê, separada da suspensão); a lista das
// suspensas mostra a situação de cada uma e a retomada chama a senha de novo pelo mesmo guichê. Sessão real sobre a
// fonte sintética de dev e a porta da recepção em memória (senhas SINTÉTICAS; nada vai à cópia). axe sem violação séria.
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

test.describe('@C2-005 não comparecimento da senha', () => {
  test('chamada sem resposta fica "Não compareceu" e a retomada a chama de novo', async ({ page }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.SENHAS');
    await page.goto('/recepcao/guiche');
    await expect(page.getByTestId('tela-guiche')).toBeVisible();
    await page.getByTestId('guiche-numero').fill('3');
    await page.getByTestId('guiche-abrir').click();
    await expect(page.getByTestId('guiche-situacao')).toContainText('Guichê 3 aberto');

    await page.getByTestId('chamar-proxima').click();
    const atual = page.getByTestId('senha-atual');
    await expect(atual).toHaveText(/^[A-Z]{2} \d{3}$/);
    const texto = (await atual.textContent())!.trim();

    // O paciente não atende à chamada.
    await page.getByTestId('evento-naoLocalizado').click();
    await expect(page.getByTestId('mensagem-recepcao')).toContainText('Evento registrado');
    const suspensas = page.getByTestId('tabela-suspensas');
    const linha = suspensas.getByRole('row').filter({ hasText: texto });
    await expect(linha).toContainText('Não compareceu');
    await expect(linha).not.toContainText('Suspensa');
    await semViolacaoAxe(page, '/recepcao/guiche (não compareceu)');

    // A retomada chama a mesma senha pelo guichê.
    await linha.getByRole('button', { name: 'Chamar de novo (suspensa ou não compareceu)' }).click();
    await expect(page.getByTestId('mensagem-recepcao')).toContainText('Evento registrado');
    await expect(atual).toHaveText(texto);
    await expect(suspensas.getByRole('row').filter({ hasText: texto })).toHaveCount(0);

    expect(externas).toEqual([]);
  });
});
