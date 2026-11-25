// E2E @F33-2 (03-PEP L100): o médico registra a alergia escolhendo as manifestações do catálogo na própria tela, abre
// o histórico da alergia (manifestações e a linha do tempo: registrada, com quem), retira da lista ativa com o motivo
// e o histórico continua lá, com a retirada e o motivo: nada é apagado. Sessão real sobre a fonte sintética de dev e
// as portas em MEMÓRIA (agentes e manifestações SINTÉTICOS; nada vai à cópia).
import { expect, test, type Page } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('Alergia: manifestações e histórico @F33-2 @fase3', () => {
  test.setTimeout(180_000);
  test('médico registra com manifestação, vê o histórico, retira e o histórico fica', async ({ page }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.MEDICO');

    // A alergia parte de um registro clínico do atendimento.
    await page.goto('/pep/1001/registro/EVAM');
    await expect(page.getByTestId('form-renderer')).toBeVisible();
    await page.getByRole('textbox', { name: /Quadro clínico/ }).fill('Quadro SINTETICO estável');
    await page.getByTestId('finalizar-registro').click();
    await expect(page).toHaveURL(/\/pep\/1001\/registro\/\d+\?finalizado=1/);

    await page.goto('/pep/paciente/1001/alergias');
    await expect(page.getByTestId('form-alergia')).toBeVisible();
    await escolher(page.getByTestId('alergia-agente'), { rotulo: 'LÁTEX SINTETICO' });
    // As manifestações vêm do catálogo, marcadas na mesma tela (sem digitar a reação à mão).
    await expect(page.getByTestId('alergia-manifestacoes')).toBeVisible();
    await page.getByTestId('alergia-manifestacao-2').check();
    await page.getByTestId('alergia-manifestacao-3').check();
    await page.getByTestId('alergia-registrar').click();

    const cartao = page
      .getByTestId('aba-alergias-conteudo')
      .locator('li.cartao')
      .filter({ hasText: 'LÁTEX SINTETICO' })
      .first();
    await expect(cartao).toBeVisible();
    // O histórico só é lido ao abrir.
    const historico = cartao.locator('[data-testid^="historico-alergia-"]');
    await historico.locator('summary').click();
    await expect(historico).toContainText('BRONCOESPASMO SINTETICO');
    await expect(historico).toContainText('EDEMA SINTETICO');
    await expect(historico.getByRole('list', { name: 'Histórico desta alergia' })).toContainText(
      'Registrada',
    );
    await semViolacaoAxe(page, 'alergias: histórico aberto');

    // Retirada com o motivo: a alergia sai da lista ativa, o histórico continua e mostra a retirada.
    await cartao
      .locator('input[data-testid^="motivo-inativar-"]')
      .fill('Teste de contato negativo SINTETICO');
    await cartao.getByRole('button', { name: 'Retirar da lista ativa' }).click();
    await page.getByTestId('confirmacao').getByRole('button', { name: 'Confirmar' }).click();
    await expect(
      page.getByTestId('aba-alergias-conteudo').locator('li.cartao[data-testid^="alergia-"]').filter({
        hasText: 'LÁTEX SINTETICO',
      }),
    ).toHaveCount(0);

    const retiradas = page
      .getByTestId('aba-alergias-conteudo')
      .locator('details')
      .filter({
        has: page.locator('summary', { hasText: /\(\d+\)/ }),
      });
    await retiradas.locator('summary').first().click();
    const antiga = retiradas.locator('li.cartao').filter({ hasText: 'LÁTEX SINTETICO' }).first();
    const historicoAntigo = antiga.locator('[data-testid^="historico-alergia-"]');
    await historicoAntigo.locator('summary').click();
    const passos = historicoAntigo.getByRole('list', { name: 'Histórico desta alergia' });
    await expect(passos).toContainText('Registrada');
    await expect(passos).toContainText('Retirada da lista');
    await expect(passos).toContainText('Teste de contato negativo SINTETICO');
    await expect(historicoAntigo).toContainText('BRONCOESPASMO SINTETICO');
    await semViolacaoAxe(page, 'alergias: retirada com histórico');
    expect(externas).toEqual([]);
  });
});
