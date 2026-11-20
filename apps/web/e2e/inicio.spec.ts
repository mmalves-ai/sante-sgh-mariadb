import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { PRODUTO_NOME_E2E } from './ambiente.js';

// @M00, adaptado no M07: a página inicial provisória do M00 virou a casca (a ficha do M00 já previa a troca).
// O critério do M00 continua: nome configurado e versão vinda da API, sem violação axe séria ou crítica.
test.describe('página inicial @M00', () => {
  test('mostra o nome configurado e a versão vinda da API, sem violação axe séria ou crítica', async ({
    page,
    request,
  }) => {
    const resposta = await request.get('/api/versao');
    expect(resposta.ok()).toBe(true);
    const versao = (await resposta.json()) as { produto: string; identificacao: string };
    expect(versao.produto).toBe(PRODUTO_NOME_E2E);

    await page.goto('/');
    await expect(page).toHaveTitle(PRODUTO_NOME_E2E);
    await expect(page.getByTestId('marca')).toContainText(PRODUTO_NOME_E2E);
    await page.goto('/sobre');
    await expect(page.getByTestId('sobre-api')).toHaveText(versao.identificacao);

    const axe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const graves = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    console.log(
      `[axe /sobre] violações: ${axe.violations.map((v) => `${v.id}(${v.impact ?? '?'})`).join(', ') || 'nenhuma'}`,
    );
    expect(graves.map((v) => v.id)).toEqual([]);
  });
});
