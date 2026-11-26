// 08-SGO L96 (C1-086): os textos do reajuste coletivo existem e nenhum usa a barra vertical (plural do vue-i18n)
// nem a arroba (mensagem ligada).
import { describe, expect, it } from 'vitest';
import { mensagensReajusteColetivo as m } from './i18n-reajuste-coletivo';

const valores = (o: object): string[] =>
  Object.values(o).flatMap((v) => (typeof v === 'string' ? [v] : valores(v as object)));

describe('textos do reajuste coletivo e dos índices', () => {
  it('cobrem as três abas', () => {
    for (const a of ['indices', 'agrupamento', 'sinistralidade'] as const) expect(m.abas[a]).toBeTruthy();
  });
  it('nenhum texto usa barra vertical nem arroba', () => {
    for (const v of valores(m)) expect(v).not.toMatch(/[|@]/);
  });
});
