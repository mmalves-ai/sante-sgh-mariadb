// M46 (etapa 2): os textos da cirurgia segura e do rastreio cobrem toda recusa do motor, as situações do checklist, os
// momentos e os estados do agendamento no quadro, e não citam o sistema anterior.
import { MOMENTOS_CHECKLIST, RECUSAS_BLOCO_SEGURO, SITUACOES_CHECKLIST } from '@sgh/contratos';
import { ESTADOS_AGENDAMENTO } from '@sgh/dominio-cirurgia';
import { describe, expect, it } from 'vitest';
import { mensagensBlocoSeguro as m } from './i18n-bloco-seguro';

describe('textos da cirurgia segura e do rastreio', () => {
  it('cobrem recusas, situações, momentos e estados do agendamento', () => {
    for (const r of RECUSAS_BLOCO_SEGURO) expect(m.recusas[r]).toBeTruthy();
    expect(Object.keys(m.recusas)).toHaveLength(RECUSAS_BLOCO_SEGURO.length);
    for (const s of SITUACOES_CHECKLIST) expect(m.checklist.situacoes[s]).toBeTruthy();
    for (const x of MOMENTOS_CHECKLIST) expect(m.checklist.momentoCurto[x.codigo]).toBeTruthy();
    for (const e of ESTADOS_AGENDAMENTO) expect(m.quadro.estados[e]).toBeTruthy();
  });

  it('nenhum texto cita o sistema anterior pelo nome nem pela tabela', () => {
    const valores = (o: object): string[] =>
      Object.values(o).flatMap((v) => (typeof v === 'string' ? [v] : valores(v as object)));
    expect(valores(m).join('\n')).not.toMatch(/spdata|legado|sistema anterior|PRFA_|CCAGENDA|CCTIPO/i);
  });
});
