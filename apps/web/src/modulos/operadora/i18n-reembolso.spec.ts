// 08-SGO L106 (C2-047): os textos do reembolso cobrem todas as situações do pedido e nenhum usa a barra vertical
// (plural do vue-i18n) nem a arroba (mensagem ligada).
import { describe, expect, it } from 'vitest';
import { SITUACOES } from './api-reembolso';
import { mensagensReembolso as m } from './i18n-reembolso';

const valores = (o: object): string[] =>
  Object.values(o).flatMap((v) => (typeof v === 'string' ? [v] : valores(v as object)));

describe('textos do reembolso ao beneficiário', () => {
  it('cobrem todas as situações do pedido', () => {
    for (const s of SITUACOES) expect(m.situacoes[s]).toBeTruthy();
  });
  it('nenhum texto usa barra vertical nem arroba', () => {
    for (const v of valores(m)) expect(v).not.toMatch(/[|@]/);
  });
});
