// Critério de aceite do M09 (`pnpm nx test dominio-pep`): os 67 modelos da cópia `pc`, convertidos por
// `./pnpm formularios:converter -- --hospital=pc`, estão em src/__fixtures__/dfm/ (cópia da estrutura, sem dado de paciente) e conferem com o relatório:
// 2.368 de 2.368 componentes mapeados, 0 classe desconhecida, 0 U+FFFD, vínculos inativos preservados e
// pendências de escolha listadas. Só estrutura do formulário (nenhum dado de paciente).
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLASSES_DFM } from './classes.js';
import type { ItemFormulario, RepresentacaoFormulario } from './mapeamento.js';
import { totalizar } from './relatorio.js';

const pasta = resolve(import.meta.dirname, '../../__fixtures__/dfm');
const arquivos = readdirSync(pasta)
  .filter((f) => f.endsWith('.json'))
  .sort();
const reps = arquivos.map(
  (f) => JSON.parse(readFileSync(resolve(pasta, f), 'utf8')) as RepresentacaoFormulario,
);
const relatorio = readFileSync(resolve(pasta, 'relatorio.md'), 'utf8');

function todos(itens: readonly ItemFormulario[]): ItemFormulario[] {
  return itens.flatMap((i) => [i, ...todos(i.itens)]);
}

describe('os 67 modelos convertidos da cópia (critério de aceite)', () => {
  it('67 modelos, 2.368 de 2.368 componentes, 0 classe desconhecida, 0 U+FFFD', () => {
    const t = totalizar(reps);
    expect(t.modelos).toBe(67);
    expect(t.componentes).toBe(2368);
    expect(t.componentesMapeados).toBe(2368);
    expect(t.classesDesconhecidas).toBe(0);
    expect(t.caracteresSubstituicao).toBe(0);
    expect(Object.keys(t.porClasse).sort()).toEqual(CLASSES_DFM.map((c) => c.classe).sort());
    expect(t.vinculos).toBe(2832);
    expect(t.vinculosInativos).toBe(1240);
    expect(t.expressoesHabilitar + t.expressoesCalcular).toBe(270);
    expect(t.expressoesHabilitar).toBe(146);
    expect(t.expressoesCalcular).toBe(124);
    expect(t.expressoesPorPadrao.outro).toBe(0);
  });

  it('o relatório publicado bate com os arquivos', () => {
    const t = totalizar(reps);
    expect(relatorio).toContain('| Componentes mapeados | 2.368 de 2.368 |');
    expect(relatorio).toContain('| Classes desconhecidas | 0 |');
    expect(relatorio).toContain(
      '| Caracteres U+FFFD ou de byte CP1252 indefinido (0x81, 0x8D, 0x8F, 0x90, 0x9D) no DFM decodificado | 0 |',
    );
    expect(relatorio).toContain(`| Pendências de escolha | ${t.escolhasPendentes.toLocaleString('pt-BR')} |`);
    const linhasPendencia = relatorio
      .split('\n')
      .filter((l) => /^\| \d+ \| [^|]+ \| [\d.]+ \| \d+ \|/.test(l));
    expect(linhasPendencia).toHaveLength(t.escolhasPendentes);
  });

  it('cada item tem linkId da ordem do legado, x-legacy completo e vínculo inativo como inativo', () => {
    let itens = 0;
    for (const r of reps) {
      expect(r.formato).toBe('sgh-formulario/1');
      expect(r.impressaoLayout).toMatch(/^[0-9a-f]{64}$/);
      for (const i of todos(r.itens)) {
        itens++;
        expect(i.linkId).toMatch(/^\d{2}(\.\d{2}){0,5}$/);
        expect(i.linkId.replace(/\./g, '')).toBe(i['x-legacy'].ordem);
        expect(i['x-legacy'].vinculo).toBeGreaterThan(0);
        expect(i['x-legacy'].pergunta).toBeGreaterThan(0);
        expect(i.ativo).toBe((i['x-legacy'].ativo ?? 'T').trim().toUpperCase() !== 'F');
        if (i.tipo !== 'sem-componente') expect(i['x-legacy'].classe).not.toBeNull();
        for (const o of i.opcoes ?? []) expect(Number.isInteger(o.indice)).toBe(true);
      }
    }
    expect(itens).toBe(2832);
  });

  it('nomes de arquivo únicos por código do modelo', () => {
    expect(new Set(reps.map((r) => r.modelo.id)).size).toBe(67);
    expect(arquivos).toHaveLength(67);
  });
});
