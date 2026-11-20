import { expect, test } from '@playwright/test';
import { COMBINACOES, semViolacaoAxe, usarPreferencias, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

// M03, critério de aceite: a tela "Testes de assinatura de dados" lista as operações do catálogo (as 20 do
// protocolo da sante-api, 18 especificadas e as 2 do M04 verdes no pc, acesso.trocarSenha do M05,
// bloqueada pelo plano B do ADR 0012, e a trilha do legado do M06, verde no pc),
// (M08) as 32 da receita genérica do CRUD genérico, verdes no pc, e (ADR 0022) as 11 das permissões do
// próprio banco pelo executor; (M10) as 23 receitas do marco e 20 do CRUD da estrutura, verdes no pc, e 2
// especificadas; (M13) as 18 dos catálogos; com filtro por módulo, estado e
// estabelecimento, e 0 violação axe séria (nos dois temas).
// M35 (revisão, consolidação): as contagens vêm do próprio painel da API (o catálogo cresce a cada marco; o número fixo
// de 154 ficou para trás desde o M14), e a tela tem de mostrar exatamente o que a API devolve, com os filtros.
test.describe('testes de assinatura de dados @M03', () => {
  for (const c of [COMBINACOES[0], COMBINACOES[2]].filter((x) => x !== undefined)) {
    test(`lista as operações do catálogo; filtros; axe ${c.tema} × ${c.densidade}`, async ({ page }) => {
      const externas = vigiarExternas(page);
      await usarPreferencias(page, c);
      await page.goto('/administracao/coexistencia/assinaturas');
      await expect(page.getByRole('heading', { level: 1, name: 'Integridade de gravação' })).toBeVisible();
      const painel = (await (await page.request.get('/api/config/assinaturas')).json()) as {
        operacoes: { nome: string; modulo: string; estados: Record<string, string> }[];
      };
      const tem = (o: { estados: Record<string, string> }, e: string) => Object.values(o.estados).includes(e);
      const total = painel.operacoes.length;
      const agenda = painel.operacoes.filter((o) => o.modulo === 'agenda');
      const agendaEsp = agenda.filter((o) => tem(o, 'especificada'));
      const especificadas = painel.operacoes.filter((o) => tem(o, 'especificada'));
      expect(total).toBeGreaterThan(500);
      const linhas = page.getByTestId('linha-operacao');
      await expect(linhas).toHaveCount(total);
      await expect(page.getByTestId('tabela-assinaturas')).toContainText('agenda.agendarExame');
      await expect(page.getByTestId('tabela-assinaturas')).toContainText('Especificada');
      await semViolacaoAxe(page, `/administracao/coexistencia/assinaturas ${c.tema} ${c.densidade}`);
      await escolher(page.getByTestId('filtro-modulo'), 'agenda');
      await expect(linhas).toHaveCount(agenda.length);
      await escolher(page.getByTestId('filtro-estado'), 'especificada');
      await expect(linhas).toHaveCount(agendaEsp.length);
      await escolher(page.getByTestId('filtro-modulo'), '');
      await expect(linhas).toHaveCount(especificadas.length);
      expect(externas).toEqual([]);
    });
  }
});
