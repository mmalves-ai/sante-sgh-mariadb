// E2E @C1-082 (03-PEP linha 139): a prescrição de lentes na oftalmologia. Pela internação sintética da oftalmologia, a
// aba "Prescrição de lentes": a conferência na hora (multifocal sem adição), a emissão dos óculos com o grau por olho,
// o histórico do paciente com a prescrição vigente, o ponto de partida na última, a impressão e o cancelamento com
// motivo (a linha fica, cancelada). axe sem violação séria. Sessão real sobre a fonte sintética e as portas em MEMÓRIA
// (dados SINTÉTICOS; nada vai à cópia).
import { expect, type Page, test } from '@playwright/test';
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

test.describe('Prescrição de lentes da oftalmologia @C1-082 @fase8', () => {
  test('emite óculos com conferência na hora, lista no histórico, parte da última, imprime e cancela com motivo', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.ESPECIALISTA');
    await page.goto('/pep/especialidades/oftalmologia/950103');
    await expect(page.getByTestId('tela-oftalmologia')).toBeVisible();
    await page.getByTestId('oftalmo-aba-lentes').click();
    const painel = page.getByTestId('lentes-painel');
    await expect(painel).toBeVisible();
    const f = page.getByTestId('form-lente');

    // Conferência na hora: multifocal sem adição e eixo faltando não saem.
    await escolher(f.getByLabel('Uso', { exact: true }), 'multifocal');
    await f.getByLabel('Esférico em dioptrias (OD)').fill('-1,50');
    await f.getByLabel('Cilíndrico em dioptrias (OD)').fill('-0,75');
    await f.getByLabel('Esférico em dioptrias (OE)').fill('-1,25');
    await f.getByTestId('lente-emitir').click();
    await expect(f.getByTestId('lente-erros')).toContainText('adição');
    await expect(f.getByTestId('lente-erros')).toContainText('eixo');
    await f.getByLabel('Eixo em graus (OD)').fill('180');
    await f.getByLabel('Adição para perto em dioptrias').fill('2,00');
    await f.getByLabel('Distância pupilar em mm').fill('63');
    await expect(f.getByTestId('lente-equivalente-od')).toContainText('-1,75');
    await semViolacaoAxe(page, '/pep/especialidades/oftalmologia/950103 (lentes)');
    await f.getByTestId('lente-emitir').click();
    await expect(painel.getByTestId('lentes-mensagem')).toContainText('Prescrição de lentes emitida');

    // Histórico do paciente: a prescrição vigente com o grau.
    await expect(painel.getByTestId('lentes-historico')).toContainText('-1,50 -0,75 x 180°');
    await expect(painel.getByTestId('lentes-historico')).toContainText('Vigente');

    // Partir da última preenche o grau (menos cliques para a renovação).
    await f.getByTestId('lente-repetir').click();
    await expect(f.getByLabel('Esférico em dioptrias (OD)')).toHaveValue('-1,5');
    await expect(f.getByLabel('Adição para perto em dioptrias')).toHaveValue('2');

    // Impressão: a folha sai com o grau e o prescritor.
    await page.evaluate(() => {
      window.print = () => undefined;
    });
    const id = (await painel
      .locator('[data-testid^="lente-imprimir-"]')
      .first()
      .getAttribute('data-testid'))!.replace('lente-imprimir-', '');
    await painel.getByTestId(`lente-imprimir-${id}`).click();
    await expect(page.getByTestId('lente-impressao')).toContainText('Prescrição de lentes');

    // Cancelamento com motivo: a linha fica, cancelada.
    await painel.getByTestId(`lente-cancelar-${id}`).click();
    await painel.getByLabel('Motivo do cancelamento').fill('Grau revisto na consulta');
    await painel.getByTestId(`lente-confirmar-${id}`).click();
    await expect(painel.getByTestId('lentes-mensagem')).toContainText('cancelada');
    await expect(painel.getByTestId(`lente-situacao-${id}`)).toHaveText('Cancelada');
    // A cancelada não sai como receita válida: sem botão de imprimir e sem a folha.
    await expect(painel.getByTestId(`lente-imprimir-${id}`)).toHaveCount(0);
    await expect(page.getByTestId('lente-impressao')).toHaveCount(0);
    expect(externas).toEqual([]);
  });
});
