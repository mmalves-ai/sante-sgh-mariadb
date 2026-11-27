// E2E F3.9 registrarAuditoria (gestão da qualidade: auditoria interna pela tela). A pessoa da qualidade registra a
// auditoria no formulário (título, área, referencial, auditores e o checklist com a seção de cada requisito); a
// auditoria abre no detalhe com o referencial, os auditores, a seção do item e a conformidade calculada pelo domínio.
// axe sem violação séria. Sessão real sobre a fonte sintética (dados SINTÉTICOS; nada vai à cópia).
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('Qualidade: auditoria interna registrada pela tela com referencial, auditores e seção', () => {
  test('nova auditoria → checklist com seção → detalhe com conformidade; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.QUALIDADE');
    await page.goto('/qualidade/gestao/auditorias');
    await expect(page.getByTestId('tela-auditorias')).toBeVisible();

    await page.getByTestId('aud-nova').click();
    const form = page.getByTestId('form-auditoria');
    await expect(form).toBeVisible();
    await form
      .getByTestId('aud-titulo')
      .locator('input')
      .fill('Auditoria de higiene das mãos (E2E registro)');
    await form.getByTestId('aud-area').locator('input').fill('UTI');
    await escolher(form.getByTestId('aud-referencial'), { rotulo: 'Padrão interno' });
    await form.getByTestId('aud-auditores').locator('input').fill('Equipe da qualidade (sintético)');
    await form.getByTestId('aud-item-secao-0').locator('input').fill('Meta 5');
    await form.getByTestId('aud-item-requisito-0').locator('input').fill('Dispensador de álcool no leito');
    await escolher(form.getByTestId('aud-item-resultado-0'), { rotulo: /^Conforme$/ });
    await form
      .getByTestId('aud-conclusao')
      .locator('textarea, input')
      .first()
      .fill('Conforme na amostra (sintético).');
    await semViolacaoAxe(page, '/qualidade/gestao/auditorias (nova auditoria)');
    await form.getByTestId('aud-gravar').click();

    await expect(page.getByTestId('gestao-aviso')).toBeVisible();
    const det = page.getByTestId('auditoria-detalhe');
    await expect(det).toBeVisible();
    await expect(det).toContainText('Padrão interno');
    await expect(det).toContainText('Equipe da qualidade (sintético)');
    await expect(det.getByTestId('aud-checklist')).toContainText('Meta 5');
    await expect(det.getByTestId('aud-conformidade')).not.toHaveText('—');
    await semViolacaoAxe(page, '/qualidade/gestao/auditorias (auditoria registrada)');
    expect(externas).toEqual([]);
  });
});
