// W0-04: os textos da correção e do cancelamento da qualidade não citam o sistema anterior nem tabela, não usam
// caractere especial do vue-i18n, e toda ação do histórico e toda recusa da correção têm texto.
import { ACOES_VERSAO_QUALIDADE } from '@sgh/contratos';
import { MENSAGENS_CORRECAO_CCIH, MENSAGENS_CORRECAO_GESTAO } from '@sgh/dominio-qualidade';
import { describe, expect, it } from 'vitest';
import { mensagensCorrecao, RECUSAS_CORRECAO } from './i18n-correcao.js';

function textos(o: unknown, caminho = ''): Array<[string, string]> {
  if (typeof o === 'string') return [[caminho, o]];
  if (o && typeof o === 'object')
    return Object.entries(o).flatMap(([k, v]) => textos(v, caminho ? `${caminho}.${k}` : k));
  return [];
}
// As chaves de `versoes.campos` são os nomes das colunas (só o rótulo aparece na tela).
const todos = [...textos(mensagensCorrecao), ...textos(RECUSAS_CORRECAO)];

describe('textos da correção da qualidade', () => {
  it('nenhum texto cita o sistema anterior nem nome de tabela', () => {
    expect(todos.filter(([, t]) => /SPDATA|legado|sistema atual|sistema anterior|SGH_/i.test(t))).toEqual([]);
  });

  it('nenhum texto usa "|" nem "@"', () => {
    expect(todos.filter(([, t]) => /[|@]/.test(t))).toEqual([]);
  });

  it('toda ação do histórico e toda recusa da correção têm texto', () => {
    for (const a of ACOES_VERSAO_QUALIDADE) expect(mensagensCorrecao.versoes.acoes[a.codigo]).toBeTruthy();
    for (const c of [...Object.keys(MENSAGENS_CORRECAO_CCIH), ...Object.keys(MENSAGENS_CORRECAO_GESTAO)])
      expect(RECUSAS_CORRECAO[c], c).toBeTruthy();
    expect(RECUSAS_CORRECAO['competencia-fechada']).toMatch(/reabra a competência com motivo/);
  });
});
