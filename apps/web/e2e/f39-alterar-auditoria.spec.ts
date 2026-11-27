// E2E F3.9 alterarAuditoria (gestão da qualidade: auditoria interna alterada com versão pela tela). A pessoa da
// qualidade registra a auditoria com um requisito conforme e depois a altera no diálogo de correção (título e o
// resultado do item, com justificativa obrigatória): o detalhe passa à versão 2, com o título novo, o item não conforme
// e a conformidade recalculada pelo domínio. axe sem violação séria. Sessão real sobre a fonte sintética (dados
// SINTÉTICOS; nada vai à cópia).
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

test.describe('Qualidade: auditoria interna alterada pela tela com versão e justificativa', () => {
  test('registra → altera título e resultado do item → versão 2 e conformidade recalculada; axe', async ({
    page,
  }) => {
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
      .fill('Auditoria de identificação do paciente (E2E)');
    await form.getByTestId('aud-area').locator('input').fill('Clínica médica');
    await escolher(form.getByTestId('aud-referencial'), { rotulo: 'Padrão interno' });
    await form.getByTestId('aud-auditores').locator('input').fill('Equipe da qualidade (sintético)');
    await form.getByTestId('aud-item-secao-0').locator('input').fill('Meta 1');
    await form.getByTestId('aud-item-requisito-0').locator('input').fill('Pulseira com dois identificadores');
    await escolher(form.getByTestId('aud-item-resultado-0'), { rotulo: /^Conforme$/ });
    await form
      .getByTestId('aud-conclusao')
      .locator('textarea, input')
      .first()
      .fill('Conforme na amostra (sintético).');
    await form.getByTestId('aud-gravar').click();

    const det = page.getByTestId('auditoria-detalhe');
    await expect(det).toBeVisible();
    await expect(det).toContainText('Versão 1');
    const conformidadeAntes = (await det.getByTestId('aud-conformidade').textContent())?.trim() ?? '';
    expect(conformidadeAntes).not.toBe('—');

    await det.getByTestId('aud-alterar').click();
    const d = page.getByTestId('dialogo-correcao');
    await expect(d).toBeVisible();
    await page
      .getByTestId('correcao-aud-titulo')
      .locator('input')
      .fill('Auditoria de identificação do paciente (E2E, alterada)');
    await escolher(page.getByTestId('correcao-aud-resultado-0'), { rotulo: /^Não conforme$/ });
    // O item não conforme pede evidência (regra do domínio: ao menos 5 caracteres).
    await page
      .getByTestId('correcao-auditoria')
      .locator('fieldset.item')
      .first()
      .getByLabel('Evidência')
      .fill('Pulseira sem a data de nascimento (sintético)');
    await d.getByTestId('correcao-justificativa').fill('curta');
    await expect(d.getByTestId('correcao-confirmar')).toBeDisabled();
    await d
      .getByTestId('correcao-justificativa')
      .fill('Resultado do item lançado errado na primeira gravação');
    await semViolacaoAxe(page, '/qualidade/gestao/auditorias (alterar auditoria)');
    await d.getByTestId('correcao-confirmar').click();
    await expect(d).toBeHidden();

    await expect(det).toContainText('Versão 2');
    await expect(det).toContainText('alterada');
    await expect(det.getByTestId('aud-checklist')).toContainText('Não conforme');
    await expect(det.getByTestId('aud-checklist')).toContainText('Meta 1');
    await expect(det.getByTestId('aud-conformidade')).not.toHaveText(conformidadeAntes);
    await semViolacaoAxe(page, '/qualidade/gestao/auditorias (auditoria alterada)');
    expect(externas).toEqual([]);
  });
});
