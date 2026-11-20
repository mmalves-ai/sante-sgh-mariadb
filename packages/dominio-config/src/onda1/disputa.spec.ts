// M39: os indicadores de disputa por dia (o gravado em SGH_CFG_COEX_USO_DIA mais o processo da API) e a recusa do lote
// de um setor da onda 1 com a lista incompleta (regra 1).
import { describe, expect, it } from 'vitest';
import {
  avaliarLigarSetor,
  contagemDoUso,
  disputaDosDias,
  disputaPendente,
  ehSetorOnda1,
  juntarContagens,
  motivoLoteOnda1,
} from './onda1.js';

const uso = (
  dia: string,
  operacao: string,
  x: Partial<{
    colisoes: number;
    esperasTrava: number;
    recusasOcupado: number;
    noNovo: number;
    noLegado: number;
  }> = {},
) => ({
  dia,
  operacao,
  noNovo: x.noNovo ?? 0,
  noLegado: x.noLegado ?? 0,
  colisoes: x.colisoes ?? 0,
  esperasTrava: x.esperasTrava ?? 0,
  recusasOcupado: x.recusasOcupado ?? 0,
});

describe('disputa por dia', () => {
  it('colisões = conflitos + travas; a contagem do uso volta a separar as duas', () => {
    expect(
      contagemDoUso(
        'pc',
        uso('2026-11-09', 'agenda.agendarConsulta', { colisoes: 5, esperasTrava: 2, recusasOcupado: 3 }),
      ),
    ).toEqual({
      operacao: 'agenda.agendarConsulta',
      hospital: 'pc',
      conflitosVersao: 3,
      travas: 2,
      recusasPorCodigo: { 'horario-ocupado': 3 },
    });
  });

  it('o dia corrente pelo gravado mais o pendente do processo; os dias passados pelo gravado', () => {
    const r = disputaDosDias({
      hospital: 'pc',
      dias: ['2026-11-08', '2026-11-09'],
      hoje: '2026-11-09',
      uso: [
        uso('2026-11-08', 'agenda.agendarConsulta', { recusasOcupado: 7 }),
        uso('2026-11-08', 'recepcao.chamarSenha', { noNovo: 5, noLegado: 15 }),
        uso('2026-11-09', 'agenda.agendarConsulta', { recusasOcupado: 2, colisoes: 1, esperasTrava: 1 }),
      ],
      doProcesso: [
        {
          operacao: 'agenda.agendarConsulta',
          hospital: 'pc',
          conflitosVersao: 0,
          travas: 0,
          recusasPorCodigo: { 'horario-ocupado': 1 },
        },
        { operacao: 'agenda.encaixar', hospital: 'pc', conflitosVersao: 1, travas: 0, recusasPorCodigo: {} },
        { operacao: 'agenda.encaixar', hospital: 'hs', conflitosVersao: 9, travas: 9, recusasPorCodigo: {} },
      ],
      senhasHoje: { operacao: 'recepcao.chamarSenha', noNovo: 3, noLegado: 4 },
    });
    const ontem = r[0]!.setores.find((s) => s.setor === 'agendamento')!;
    expect(ontem.recusasHorarioOcupado).toBe(7);
    expect(r[0]!.setores.find((s) => s.setor === 'recepcao-ambulatorial')!.senhas).toEqual({
      noNovo: 5,
      noOutro: 15,
      total: 20,
    });
    const hoje = r[1]!.setores.find((s) => s.setor === 'agendamento')!;
    expect(hoje.recusasHorarioOcupado).toBe(3);
    expect(hoje.colisoesGrade).toBe(2);
    expect(hoje.parcelas['colisoes-grade']).toBe('agendarConsulta 1 + encaixar 1 = 2');
    expect(
      r[1]!.setores.find((s) => s.setor === 'recepcao-ambulatorial')!.parcelas['senhas-por-sistema'],
    ).toBe('3 no novo + 4 no outro = 7');
  });

  it('juntar: a soma de cada número e de cada código (gravado + pendente)', () => {
    const a = { operacao: 'o', hospital: 'pc', conflitosVersao: 2, travas: 0, recusasPorCodigo: { x: 1 } };
    const b = {
      operacao: 'o',
      hospital: 'pc',
      conflitosVersao: 1,
      travas: 3,
      recusasPorCodigo: { x: 4, y: 1 },
    };
    expect(juntarContagens(a, b)).toEqual({
      ...a,
      conflitosVersao: 3,
      travas: 3,
      recusasPorCodigo: { x: 5, y: 1 },
    });
    expect(juntarContagens(undefined, b)).toBe(b);
  });

  it('pendente: o total do processo menos o que ele já gravou; a reinicialização não perde o contado', () => {
    const op = (recusas: number, travas = 0) => ({
      operacao: 'agenda.agendarConsulta',
      hospital: 'pc',
      conflitosVersao: 0,
      travas,
      recusasPorCodigo: recusas ? { 'horario-ocupado': recusas } : {},
    });
    // Antes da reinicialização: 10 recusas, as 10 gravadas.
    const ja = new Map([['pc|agenda.agendarConsulta', op(10, 1)]]);
    expect(disputaPendente([op(12, 1)], ja)).toEqual([op(2)]);
    expect(disputaPendente([op(10, 1)], ja)).toEqual([op(0)]);
    // Depois da reinicialização o processo novo começa do zero e nada gravou: 6 pendentes, somados aos 10 do banco.
    const [p] = disputaPendente([op(6)], new Map());
    const banco = {
      operacao: 'agenda.agendarConsulta',
      hospital: 'pc',
      conflitosVersao: 0,
      travas: 1,
      recusasPorCodigo: { 'horario-ocupado': 10 },
    };
    expect(juntarContagens(banco, p).recusasPorCodigo['horario-ocupado']).toBe(16);
  });
});

describe('lote de um setor da onda 1', () => {
  it('o motivo diz o que falta; bloqueado diz por quê; pode ligar não tem motivo', () => {
    const base = {
      setor: 'agendamento' as const,
      hospital: 'pc',
      estados: {},
      itens: [],
      ondasProntasNoPrimeiro: true,
      bloqueio: null,
    };
    expect(motivoLoteOnda1(avaliarLigarSetor(base))).toMatch(
      /^A lista para ligar o setor não está completa: Operações do setor conferidas/,
    );
    expect(
      motivoLoteOnda1(avaliarLigarSetor({ ...base, hospital: 'hs', ondasProntasNoPrimeiro: false })),
    ).toMatch(/DP-4/);
    expect(ehSetorOnda1('agendamento')).toBe(true);
    expect(ehSetorOnda1('sadt')).toBe(false);
  });
});
