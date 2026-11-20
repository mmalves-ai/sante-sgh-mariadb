// M46 (etapa 3): os textos do OPME cobrem toda situação da solicitação, toda etapa e toda situação da conciliação, e não
// citam o sistema anterior.
import { CODIGOS_ETAPA_OPME, CODIGOS_SITUACAO_OPME, SITUACOES_CONCILIACAO_OPME } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { mensagensOpme as m } from './i18n-opme';

describe('textos do OPME', () => {
  it('cobrem situações, etapas e a conciliação', () => {
    for (const s of CODIGOS_SITUACAO_OPME) expect(m.situacoes[s]).toBeTruthy();
    for (const e of CODIGOS_ETAPA_OPME) expect(m.etapas[e]).toBeTruthy();
    for (const c of SITUACOES_CONCILIACAO_OPME) expect(m.conciliacao.situacoes[c.codigo]).toBeTruthy();
  });

  it('nenhum texto cita o sistema anterior pelo nome nem pela tabela', () => {
    const valores = (o: object): string[] =>
      Object.values(o).flatMap((v) => (typeof v === 'string' ? [v] : valores(v as object)));
    expect(valores(m).join('\n')).not.toMatch(
      /spdata|legado|sistema anterior|GE[A-Z]*OPME|GELANSAI|FCLANEXT/i,
    );
  });
});
