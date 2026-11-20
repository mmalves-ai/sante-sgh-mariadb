// M46 (etapa 1): os textos da anestesia cobrem toda recusa do motor e todo tipo de ingestão, situação e momento, e
// não citam o sistema anterior.
import { MOMENTOS_SRPA, RECUSAS_ANESTESIA, SITUACOES_FICHA, TIPOS_INGESTAO } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { mensagensAnestesia as m } from './i18n-anestesia';

describe('textos da anestesia', () => {
  it('cobrem recusas, ingestões, situações da ficha e momentos da recuperação', () => {
    for (const r of RECUSAS_ANESTESIA) expect(m.recusas[r]).toBeTruthy();
    expect(Object.keys(m.recusas)).toHaveLength(RECUSAS_ANESTESIA.length);
    for (const t of TIPOS_INGESTAO) expect(m.apa.ingestoes[t]).toBeTruthy();
    for (const s of SITUACOES_FICHA) expect(m.ficha.situacoes[s]).toBeTruthy();
    for (const x of MOMENTOS_SRPA) expect(m.srpa.momentos[x]).toBeTruthy();
  });

  it('nenhum texto cita o sistema anterior pelo nome nem pela tabela', () => {
    const valores = (o: object): string[] =>
      Object.values(o).flatMap((v) => (typeof v === 'string' ? [v] : valores(v as object)));
    expect(valores(m).join('\n')).not.toMatch(/spdata|legado|sistema anterior|PRFA_|TBANESTESIA|CCAGENDA/i);
  });
});
