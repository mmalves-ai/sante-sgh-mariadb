// 08-SGO L110 (C1-036): os textos das declarações periódicas cobrem toda situação da TPS e da DMED, todo tipo de
// divergência e todo tratamento; nenhum texto usa a barra vertical (plural do vue-i18n) nem a arroba (mensagem ligada).
import { describe, expect, it } from 'vitest';
import { mensagensDeclaracoesAns as m } from './i18n-declaracoes';

const valores = (o: object): string[] =>
  Object.values(o).flatMap((v) => (typeof v === 'string' ? [v] : valores(v as object)));

describe('textos das declarações periódicas da operadora', () => {
  it('cobrem as situações, os tipos de divergência e os tratamentos', () => {
    for (const s of ['apurada', 'guia_emitida', 'paga', 'cancelada'] as const)
      expect(m.tps.situacoes[s]).toBeTruthy();
    for (const s of ['em_preparacao', 'gerada', 'transmitida', 'aceita', 'rejeitada', 'cancelada'] as const)
      expect(m.dmed.situacoes[s]).toBeTruthy();
    for (const s of [
      'nao_localizado_cadastro',
      'nao_localizado_ans',
      'campo_divergente',
      'situacao_divergente',
    ] as const)
      expect(m.conferencia.tipos[s]).toBeTruthy();
    for (const s of ['pendente', 'corrigir_cadastro', 'retificar_ans', 'corrigida', 'ignorada'] as const)
      expect(m.conferencia.correcoes[s]).toBeTruthy();
  });

  it('nenhum texto usa a barra vertical nem a arroba', () => {
    for (const v of valores(m)) {
      expect(v.includes('|'), v).toBe(false);
      expect(v.includes('@'), v).toBe(false);
    }
  });
});
