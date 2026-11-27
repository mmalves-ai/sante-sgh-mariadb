// E2E @F3.9 registrarAnaliseIndicador (ficha F3.9-apoio): a qualidade abre o painel de indicadores na competência
// fechada mais recente, abre a ficha técnica de um indicador e registra a análise crítica em texto livre com o plano de
// ação com dono (responsável e prazo); a análise aparece no histórico do indicador e a linha passa a "Analisada". O que
// fica no banco próprio (apuração fechada, análise, plano com dono, trilha) está no contrato de efeito
// apps/api/src/modulos/qualidade/porta-propria-complemento-q6.int.spec.ts. Axe sem violação séria na ficha. Sessão real
// sobre a fonte sintética e as portas em MEMÓRIA (dados SINTÉTICOS; nada vai à cópia).
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';

const SENHA = 'Sintetico#2026';
const INDICADOR = 'adesaoHigieneMaos';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('Qualidade: análise crítica do indicador com plano de ação @F3.9 @fase3', () => {
  test.setTimeout(180_000);

  test('ficha técnica → análise com plano e dono → histórico e linha analisada; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.QUALIDADE');
    await page.goto('/qualidade/indicadores');
    await expect(page.getByTestId('tela-indicadores')).toBeVisible();
    await expect(page.getByTestId(`indicador-${INDICADOR}`)).toBeVisible();

    await page.getByTestId(`abrir-indicador-${INDICADOR}`).click();
    await expect(page.getByTestId('ficha-indicador')).toBeVisible();
    const form = page.getByTestId('form-analise');
    await expect(form).toBeVisible();
    await semViolacaoAxe(page, 'ficha do indicador com o formulário da análise');

    const texto = 'Adesão abaixo do esperado no turno da noite (análise sintética E2E)';
    await form.getByTestId('analise-texto').locator('textarea').fill(texto);
    await form.getByTestId('analise-causas').locator('textarea').fill('Falta de dispensadores no corredor');
    await form
      .getByTestId('analise-plano')
      .locator('textarea')
      .fill('Instalar dispensadores e reforçar a auditoria');
    await form.getByTestId('analise-responsavel').locator('input').fill('Coordenação de enfermagem');
    const prazo = form.getByTestId('analise-prazo').locator('input');
    await prazo.fill('31/12/2026');
    await prazo.press('Enter');
    await form.getByTestId('analise-gravar').click();

    await expect(page.getByTestId('gestao-aviso')).toContainText(/análise crítica gravada/i);
    await expect(page.getByTestId('analise-historico')).toContainText(texto);
    await expect(page.getByTestId(`indicador-${INDICADOR}`)).toContainText(/analisada/i);
    await semViolacaoAxe(page, 'ficha do indicador com a análise gravada');
    expect(externas).toEqual([]);
  });
});
