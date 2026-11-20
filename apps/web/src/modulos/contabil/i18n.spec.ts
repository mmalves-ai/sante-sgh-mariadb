// Textos da contabilidade (etapa 1): sem o nome do outro sistema (ADR 0023), sem nome de tabela nem chave técnica, e
// com rótulo para todo código do vocabulário que a tela mostra.
import {
  CODIGOS_GRUPO_CONTA,
  CODIGOS_ORIGEM_LANCAMENTO,
  CODIGOS_TIPO_FATO,
  CODIGOS_TIPO_LANCAMENTO,
  SITUACOES_CONCILIACAO,
  SITUACOES_FATO,
  SITUACOES_PERIODO,
} from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { mensagensContabil } from './i18n.js';

function textos(o: unknown, caminho = ''): Array<[string, string]> {
  if (typeof o === 'string') return [[caminho, o]];
  if (o && typeof o === 'object')
    return Object.entries(o).flatMap(([k, v]) => textos(v, caminho ? `${caminho}.${k}` : k));
  return [];
}

describe('textos da contabilidade', () => {
  const todos = textos(mensagensContabil);

  it('não citam o outro sistema, tabela do banco nem chave técnica', () => {
    const ruins = todos.filter(
      ([, t]) =>
        /spdata|legado|sistema atual|sistema anterior/i.test(t) ||
        /\b(TBINTCRC|FCCTAEXT|FCLANEXT|MFCONPAG|COTP_ORIGEM_LANCAMENTO|SGH_CTB_[A-Z_]+)\b/.test(t) ||
        /\bcontabil\.[a-z]+\b/.test(t),
    );
    expect(ruins).toEqual([]);
  });

  it('todo código mostrado tem rótulo', () => {
    for (const o of CODIGOS_ORIGEM_LANCAMENTO) expect(mensagensContabil.origens[o]).toBeTruthy();
    for (const t of CODIGOS_TIPO_FATO) expect(mensagensContabil.tiposFato[t]).toBeTruthy();
    for (const g of CODIGOS_GRUPO_CONTA) expect(mensagensContabil.grupos[g]).toBeTruthy();
    for (const s of Object.keys(SITUACOES_FATO) as (keyof typeof SITUACOES_FATO)[])
      expect(mensagensContabil.situacoesFato[s]).toBeTruthy();
    // M54.2: tipos de lançamento, situações do período e da conciliação.
    for (const x of CODIGOS_TIPO_LANCAMENTO) expect(mensagensContabil.lancamentos.tipos[x]).toBeTruthy();
    for (const x of Object.keys(SITUACOES_PERIODO) as (keyof typeof SITUACOES_PERIODO)[])
      expect(mensagensContabil.periodos.situacoes[x]).toBeTruthy();
    for (const x of Object.keys(SITUACOES_CONCILIACAO) as (keyof typeof SITUACOES_CONCILIACAO)[])
      expect(mensagensContabil.conciliacao.situacoes[x]).toBeTruthy();
  });

  it('cada regra de conferência do plano tem texto', () => {
    expect(Object.keys(mensagensContabil.plano.problemas).sort()).toEqual(
      [
        'analiticaComFilhos',
        'grupoDiferenteDoPai',
        'mascara',
        'naturezaDoGrupo',
        'paiAnalitico',
        'repetida',
        'semPai',
        'semReferencial',
      ].sort(),
    );
  });
});
