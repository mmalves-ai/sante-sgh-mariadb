// Ficha do M44, regra 10: o de-para proposto das 23 situações de regulação do sistema anterior (23 de 23 com destino ou
// "a confirmar"; as 6 de baixa confiança marcadas) e a aprovação do NIR por cima.
import { DEPARA_SITUACAO_REGULACAO } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { deparaCompleto, deparaVigente, situacaoEquivalente } from './maquina.js';

describe('de-para das 23 situações (regra 10)', () => {
  it('23 de 23 com destino ou "a confirmar"; as 6 da ficha a confirmar', () => {
    const v = deparaVigente([]);
    expect(v).toHaveLength(23);
    expect(v.map((x) => x.situacao)).toEqual(Array.from({ length: 23 }, (_, i) => i + 1));
    expect(deparaCompleto(v)).toBe(true);
    expect(v.filter((x) => x.aConfirmar).map((x) => x.situacao)).toEqual([4, 14, 15, 17, 20, 22]);
    const por = (estado: string) => v.filter((x) => x.estado === estado).map((x) => x.situacao);
    expect(por('solicitado')).toEqual([7]);
    expect(por('em_analise')).toEqual([1, 2, 3, 10, 16, 18, 23]);
    expect(por('reservado')).toEqual([5, 12]);
    expect(por('em_transito')).toEqual([8, 21]);
    expect(por('internado')).toEqual([9, 19]);
    expect(por('cancelado')).toEqual([6]);
    expect(por('rejeitado')).toEqual([11, 13]);
  });

  it('a linha aprovada pelo NIR sobrepõe a proposta e perde a marca; os rótulos do estabelecimento valem', () => {
    const v = deparaVigente(
      [{ situacao: 4, estado: 'internado', aprovadoPor: 'NIR.SINTETICO', aprovadoEm: '2026-10-24T10:00:00' }],
      new Map([[4, 'ALTA DO PACIENTE']]),
    );
    const l = v.find((x) => x.situacao === 4);
    expect(l).toMatchObject({
      estado: 'internado',
      proposto: null,
      aConfirmar: false,
      rotulo: 'ALTA DO PACIENTE',
    });
    expect(v.filter((x) => x.aConfirmar)).toHaveLength(5);
  });

  it('a situação equivalente de cada estado (a primeira do de-para)', () => {
    const v = deparaVigente([]);
    expect(situacaoEquivalente('em_analise', v)).toEqual({
      codigo: 1,
      rotulo: 'Aguardando disponibilidade',
      aConfirmar: false,
    });
    expect(situacaoEquivalente('reservado', v)?.codigo).toBe(5);
    expect(deparaCompleto(v.slice(1))).toBe(false);
    expect(deparaCompleto(v.map((x) => ({ ...x, estado: null, aConfirmar: false })))).toBe(false);
    expect(
      situacaoEquivalente(
        'internado',
        v.filter((x) => x.estado !== 'internado'),
      ),
    ).toBeNull();
    expect(DEPARA_SITUACAO_REGULACAO.every((x) => x.estado !== null || x.aConfirmar)).toBe(true);
  });
});
