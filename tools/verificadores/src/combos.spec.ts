import { describe, expect, it } from 'vitest';
import { verificarCombos, verificarE2e } from './combos.ts';

const vue = (template: string, script = '') =>
  `<script setup lang="ts">\n${script}\n</script>\n<template>\n${template}\n</template>\n`;

describe('combos com busca (ADR 0027)', () => {
  it('recusa <select> cru, busca desligada e combo da biblioteca de base', () => {
    const { achados } = verificarCombos([
      { arquivo: 'apps/web/src/a.vue', conteudo: vue('<select v-model="x"><option>1</option></select>') },
      {
        arquivo: 'apps/web/src/b.vue',
        conteudo: vue('<SanteSelecao v-model="x" rotulo="P" :opcoes="o" :busca="false" />'),
      },
      { arquivo: 'apps/web/src/c.vue', conteudo: vue('', "import Select from 'openvue/select';") },
    ]);
    expect(achados.map((a) => [a.arquivo, a.linha])).toEqual([
      ['apps/web/src/a.vue', 5],
      ['apps/web/src/b.vue', 5],
      ['apps/web/src/c.vue', 2],
    ]);
  });

  it('aceita SanteSelecao, ignora comentário HTML e não confunde com outras tags', () => {
    const { achados } = verificarCombos([
      {
        arquivo: 'apps/web/src/a.vue',
        conteudo: vue(
          '<!-- antes era um <select> -->\n<SanteSelecao v-model="x" rotulo="P" :opcoes="o" />\n<selection-x />',
        ),
      },
    ]);
    expect(achados).toEqual([]);
  });

  it('exceção nominal vale só para o trecho; sem uso, falha', () => {
    const ex = { arquivo: 'apps/web/src/a.vue', trecho: 'id="raro"', justificativa: 'teste' };
    const sobra = { arquivo: 'apps/web/src/z.vue', trecho: 'nada', justificativa: 'teste' };
    const r = verificarCombos(
      [
        {
          arquivo: 'apps/web/src/a.vue',
          conteudo: vue('<select id="raro"></select>\n<select id="outro"></select>'),
        },
      ],
      [ex, sobra],
    );
    expect(r.achados.map((a) => a.trecho)).toEqual(['<select id="outro"></select>']);
    expect(r.excecoesSemUso).toEqual([sobra]);
  });

  it("E2E: recusa selectOption e locator('select'); aceita o auxiliar", () => {
    const achados = verificarE2e([
      { arquivo: 'apps/web/e2e/a.spec.ts', conteudo: "await page.getByLabel('X').selectOption('1');" },
      {
        arquivo: 'apps/web/e2e/b.spec.ts',
        conteudo: "await expect(page.locator('select#y')).toHaveValue('2');",
      },
      { arquivo: 'apps/web/e2e/c.spec.ts', conteudo: "await escolher(page.getByTestId('z'), '3');" },
    ]);
    expect(achados.map((a) => a.arquivo)).toEqual(['apps/web/e2e/a.spec.ts', 'apps/web/e2e/b.spec.ts']);
  });
});
