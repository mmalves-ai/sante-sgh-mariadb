import { expect, test } from '@playwright/test';
import { COMBINACOES, semViolacaoAxe, usarPreferencias, vigiarExternas } from './ajuda.js';

// M04 (ficha, item 7): "Conferência de gravação" mostra a receita das duas operações verdes (tabelas, colunas
// e classes, triggers, o que o novo não faz) e "Saúde das conexões e avisos de colisão" mostra as conexões do
// sistema novo; 0 violação axe séria nos dois temas.
test.describe('coexistência: gravação e conexões @M04', () => {
  for (const c of [COMBINACOES[0], COMBINACOES[2]].filter((x) => x !== undefined)) {
    test(`conferência de gravação e saúde das conexões; axe ${c.tema} × ${c.densidade}`, async ({ page }) => {
      const externas = vigiarExternas(page);
      await usarPreferencias(page, c);
      await page.goto('/administracao/coexistencia/gravacao');
      await expect(page.getByRole('heading', { level: 1, name: 'Conferência de gravação' })).toBeVisible();
      const cadastro = page.getByTestId('operacao-cadastro.cadastrarPaciente');
      await expect(cadastro).toContainText('RICADPAC (INSERT)');
      await expect(cadastro).toContainText('TRG_RICADPAC_BI');
      await expect(page.getByTestId('operacao-acesso.criarUsuarioIntegracao')).toContainText(
        'TBUSERS (INSERT)',
      );
      await semViolacaoAxe(page, `/administracao/coexistencia/gravacao ${c.tema} ${c.densidade}`);
      await page.goto('/administracao/coexistencia/conexoes');
      await expect(
        page.getByRole('heading', { level: 1, name: 'Conexões e avisos de colisão' }),
      ).toBeVisible();
      await expect(page.getByTestId('tabela-pools')).toBeVisible();
      await semViolacaoAxe(page, `/administracao/coexistencia/conexoes ${c.tema} ${c.densidade}`);
      expect(externas).toEqual([]);
    });
  }
});
