// E2E @F33 @C1-005 (03-PEP L112): o médico prescreve a dieta livre com a composição por refeição. Na mesma refeição,
// o alimento titular com a parte das calorias do dia e, por um clique em "Substituto", o alimento que pode trocá-lo
// (entra logo abaixo, na mesma refeição). A conferência do domínio aparece na hora: o alimento repetido na refeição
// e a soma das calorias acima de 100% são recusados à vista e o item não entra; corrigido, o item entra na lista.
// Sessão real sobre a fonte sintética e a porta da prescrição em MEMÓRIA (refeições, alimentos e medidas
// SINTÉTICOS; nada vai à cópia). axe sem violação séria.
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

test.describe('Dieta com composição por refeição @F33 @C1-005', () => {
  test.setTimeout(90_000);
  test('dieta livre: titular e substituto na refeição, recusa na hora e inclusão; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.MEDICO');
    await page.goto('/pep/prescricao');
    await page.getByTestId('busca-paciente-prescricao').fill('jose');
    await page.getByTestId('buscar-paciente-prescricao').click();
    await page.getByTestId('paciente-prescricao-1001').getByRole('link').click();
    await expect(page.getByTestId('tela-prescricao-paciente')).toBeVisible();
    await page.getByTestId('nova-prescricao').click();
    await expect(page.getByTestId('tela-prescricao-editor')).toBeVisible();
    await escolher(page.getByTestId('editor-periodo'), 'seguinte');

    await page.getByTestId('aba-dietas').click();
    const editor = page.getByTestId('editor-dietas');
    await escolher(editor.getByTestId('tipo-item'), 'dieta-livre');
    await escolher(editor.getByTestId('dieta'), '3');
    const comp = editor.getByTestId('composicao-refeicoes');
    await expect(comp).toBeVisible();

    // Titular no desjejum, com 30% das calorias do dia.
    await comp.getByTestId('acrescentar-alimento').click();
    await escolher(comp.getByTestId('refeicao-1'), '1');
    await escolher(comp.getByTestId('alimento-1'), '1');
    await comp.getByTestId('quantidade-alimento-1').fill('50');
    await comp.getByTestId('percentual-1').fill('30');
    await expect(comp.getByTestId('percentual-total')).toContainText('30%');

    // Repetir o mesmo alimento na mesma refeição: a recusa do domínio aparece na hora e o item não entra.
    await comp.getByTestId('acrescentar-alimento').click();
    await escolher(comp.getByTestId('alimento-2'), '1');
    await comp.getByTestId('quantidade-alimento-2').fill('40');
    await expect(comp.getByTestId('composicao-recusa')).toContainText('duas vezes na mesma refeição');
    await editor.getByTestId('incluir-item').click();
    await expect(page.getByTestId('itens-prescricao')).toHaveCount(0);

    // Troca para outro alimento, mas com a soma das calorias acima de 100%: recusado à vista.
    await escolher(comp.getByTestId('alimento-2'), '2');
    await comp.getByTestId('percentual-2').fill('80');
    await expect(comp.getByTestId('composicao-recusa')).toContainText('passa de 100%');
    await comp.getByTestId('percentual-2').fill('');
    await expect(comp.getByTestId('composicao-recusa')).toHaveCount(0);
    await semViolacaoAxe(page, 'composição da dieta por refeição');

    // Em vez de um segundo titular, o substituto do pão: um clique, entra logo abaixo, na mesma refeição.
    await comp.getByTestId('refeicao-linha-2').getByRole('button', { name: 'Remover' }).click();
    await comp.getByTestId('substituto-1').click();
    await expect(comp.getByTestId('refeicao-linha-2')).toContainText('Substituto de');
    await escolher(comp.getByTestId('alimento-2'), '2');
    await comp.getByTestId('quantidade-alimento-2').fill('30');
    await expect(comp.getByTestId('composicao-recusa')).toHaveCount(0);
    await expect(comp.getByTestId('percentual-total')).toContainText('30%');

    await editor.getByTestId('incluir-item').click();
    await expect(editor.getByTestId('item-incompleto')).toHaveCount(0);
    await expect(page.getByTestId('itens-prescricao').locator('tbody tr')).toHaveCount(1);
    await semViolacaoAxe(page, 'dieta incluída');
    expect(externas).toEqual([]);
  });
});
