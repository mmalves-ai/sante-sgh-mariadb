import { describe, expect, it } from 'vitest';
import {
  alertasCompletude,
  SINALIZADORES,
  sinalizadores,
  type InternacaoAuditada,
} from './alertas-completude.js';

const reg = (em: string, cbo = '225125', suspenso = false) => ({ em, cbo, suspenso });

describe('alertas de completude (regra 14)', () => {
  const base = {
    internado: true,
    registros: [],
    assinaturasPendentes: 0,
    altaMedica: false,
    sumarioFinalizado: false,
    criticosSemCiencia: 0,
    pareceresAtrasados: 0,
    entrada: '2026-10-19T08:00:00',
  };
  const agora = new Date('2026-10-21T12:00:00');

  it('sem evolução médica há 24 h (suspensa e não médica não contam)', () => {
    expect(alertasCompletude(base, agora).map((a) => a.tipo)).toEqual(['sem-evolucao-medica-24h']);
    expect(
      alertasCompletude({ ...base, registros: [reg('2026-10-21T09:00:00')] }, agora).map((a) => a.tipo),
    ).toEqual([]);
    expect(
      alertasCompletude({ ...base, registros: [reg('2026-10-21T09:00:00', '225125', true)] }, agora)[0]?.tipo,
    ).toBe('sem-evolucao-medica-24h');
    expect(
      alertasCompletude({ ...base, registros: [reg('2026-10-21T09:00:00', '223505')] }, agora)[0]?.tipo,
    ).toBe('sem-evolucao-medica-24h');
    expect(alertasCompletude({ ...base, internado: false }, agora)).toEqual([]);
    expect(alertasCompletude({ ...base, entrada: null }, agora)).toEqual([]);
  });

  it('assinatura pendente, alta sem sumário, crítico sem ciência, parecer atrasado', () => {
    const r = alertasCompletude(
      {
        ...base,
        internado: false,
        assinaturasPendentes: 2,
        altaMedica: true,
        criticosSemCiencia: 1,
        pareceresAtrasados: 3,
      },
      agora,
    );
    expect(r.map((a) => a.tipo)).toEqual([
      'assinatura-pendente',
      'alta-sem-sumario',
      'critico-sem-ciencia',
      'parecer-atrasado',
    ]);
    expect(
      alertasCompletude({ ...base, internado: false, altaMedica: true, sumarioFinalizado: true }, agora),
    ).toEqual([]);
  });

  describe('os 13 sinalizadores da auditoria clínica', () => {
    const inter = (x: Partial<InternacaoAuditada>): InternacaoAuditada => ({
      entrada: '2026-05-01T08:00:00',
      alta: '2026-05-03T08:00:00',
      cidPrincipal: 'I21',
      nivel: 'enfermaria',
      passouUti: false,
      entradaUti: null,
      desfecho: 'alta',
      registros: [reg('2026-05-01T09:00:00'), reg('2026-05-02T09:00:00'), reg('2026-05-03T07:00:00')],
      ...x,
    });
    const casos: [Sinalizador13, Partial<InternacaoAuditada>][] = [
      ['sem-evolucao-medica', { registros: [reg('2026-05-01T09:00:00', '223505')] }],
      ['so-registro-nao-medico', { registros: [reg('2026-05-01T09:00:00', '223505')] }],
      ['nenhum-registro', { registros: [] }],
      [
        'uti-sem-registro-medico-anterior',
        { passouUti: true, nivel: 'uti_depois', entradaUti: '2026-05-01T08:30:00' },
      ],
      ['cid-z', { cidPrincipal: 'Z51' }],
      ['cid-z-com-uti', { cidPrincipal: 'Z51', passouUti: true, entradaUti: '2026-05-02T10:00:00' }],
      ['obito-sem-evolucao', { desfecho: 'obito', registros: [] }],
      ['evasao-apos-uti', { desfecho: 'evasao', passouUti: true, entradaUti: '2026-05-02T10:00:00' }],
      ['transferencia-sem-evolucao', { desfecho: 'transferencia', registros: [] }],
      [
        'ultima-evolucao-24h-antes-alta',
        { registros: [reg('2026-05-01T09:00:00'), reg('2026-05-01T20:00:00')] },
      ],
      ['densidade-baixa', { alta: '2026-05-06T08:00:00' }],
      [
        'dias-sem-evolucao',
        {
          alta: '2026-05-15T08:00:00',
          registros: [reg('2026-05-14T09:00:00'), reg('2026-05-10T09:00:00', '225125', true)],
        },
      ],
      [
        'uti-direta-cid-sintomatico',
        { nivel: 'uti_direto', passouUti: true, cidPrincipal: 'R07', entradaUti: '2026-05-01T08:00:00' },
      ],
    ];
    type Sinalizador13 = (typeof SINALIZADORES)[number];
    it('cobre os 13', () => expect(new Set(casos.map((c) => c[0])).size).toBe(13));
    for (const [esperado, x] of casos)
      it(esperado, () => expect(sinalizadores(inter(x))).toContain(esperado));
    it('internação bem documentada: nenhum sinalizador', () => expect(sinalizadores(inter({}))).toEqual([]));
  });
});
