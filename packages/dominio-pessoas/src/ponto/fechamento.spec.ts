// Fechamento do período e ciência do espelho (M52.4): a trilha do período é só de inclusão; o estado é o do último
// fechamento ou reabertura; a ciência vale para o fechamento em vigor. AEJ e biometria (regra 15) no fim.
import { describe, expect, it } from 'vitest';
import { gerarAej } from './aej.js';
import { biometriaNoPonto } from './biometria.js';
import {
  conferirCiencia,
  conferirFechamento,
  conferirReabertura,
  type EventoPeriodoLido,
  estadoDoPeriodo,
  ultimoDiaDaCompetencia,
} from './fechamento.js';

const ev = (id: number, acao: EventoPeriodoLido['acao'], ref: number | null = null): EventoPeriodoLido => ({
  id,
  acao,
  ref,
  concorda: acao === 'ciencia' ? true : null,
  registradoPor: 'X',
  registradoEm: '2026-10-02T10:00',
});

describe('fechamento e ciência', () => {
  it('estado: aberto sem eventos; fechado; reaberto; fechado de novo pede nova ciência', () => {
    expect(estadoDoPeriodo([])).toEqual({ estado: 'aberto', fechamento: null, versao: 0, ciencia: null });
    const um = estadoDoPeriodo([ev(1, 'fechado'), ev(2, 'ciencia', 1)]);
    expect(um).toMatchObject({ estado: 'fechado', fechamento: 1, versao: 1 });
    expect(um.ciencia?.id).toBe(2);
    const dois = estadoDoPeriodo([
      ev(4, 'fechado'),
      ev(3, 'reaberto', 1),
      ev(1, 'fechado'),
      ev(2, 'ciencia', 1),
    ]);
    expect(dois).toMatchObject({ estado: 'fechado', fechamento: 4, versao: 2, ciencia: null });
    expect(estadoDoPeriodo([ev(1, 'fechado'), ev(2, 'reaberto', 1)]).estado).toBe('aberto');
  });

  it('fecha só a competência que terminou, sem pendência nem inconsistência', () => {
    const aberto = estadoDoPeriodo([]);
    const base = {
      competencia: '2026-09',
      hoje: '2026-10-01',
      estado: aberto,
      diasInconsistentes: 0,
      ajustesPendentes: 0,
    };
    expect(conferirFechamento(base)).toBeNull();
    expect(conferirFechamento({ ...base, hoje: '2026-09-30' })?.codigo).toBe('periodo-em-curso');
    expect(conferirFechamento({ ...base, ajustesPendentes: 2 })?.codigo).toBe('ajustes-pendentes');
    expect(conferirFechamento({ ...base, diasInconsistentes: 1 })?.codigo).toBe('inconsistencias');
    expect(conferirFechamento({ ...base, estado: estadoDoPeriodo([ev(1, 'fechado')]) })?.codigo).toBe(
      'ja-fechado',
    );
    expect(ultimoDiaDaCompetencia('2028-02')).toBe('2028-02-29');
  });

  it('reabertura: só o fechado e só se a competência seguinte não estiver fechada', () => {
    const f = estadoDoPeriodo([ev(1, 'fechado')]);
    expect(conferirReabertura(f, false)).toBeNull();
    expect(conferirReabertura(f, true)?.codigo).toBe('seguinte-fechado');
    expect(conferirReabertura(estadoDoPeriodo([]), false)?.codigo).toBe('nao-fechado');
  });

  it('ciência: do próprio, do fechado, uma vez', () => {
    const f = estadoDoPeriodo([ev(1, 'fechado')]);
    expect(conferirCiencia(f, true)).toBeNull();
    expect(conferirCiencia(f, false)?.codigo).toBe('nao-e-o-proprio');
    expect(conferirCiencia(estadoDoPeriodo([]), true)?.codigo).toBe('nao-fechado');
    expect(conferirCiencia(estadoDoPeriodo([ev(1, 'fechado'), ev(2, 'ciencia', 1)]), true)?.codigo).toBe(
      'ja-ciente',
    );
  });
});

describe('AEJ', () => {
  it('registros na ordem do leiaute, sequência de entrada e saída, desconsiderada sem sequência e o trailer', () => {
    const t = gerarAej({
      empregador: { cnpj: '00000000000191', razaoSocial: 'HOSPITAL | SINTETICO' },
      dataInicial: '2026-09-01',
      dataFinal: '2026-09-30',
      geradoEm: '2026-10-02T10:00',
      reps: [{ id: '1', tipo: '1', numero: '00004000000000123' }],
      horarios: [{ codigo: 'H1', duracaoMin: 720, entrada: '0700', saida: '1900' }],
      vinculos: [
        {
          id: '10',
          cpf: '12345678909',
          nome: 'COLABORADORA SINTETICA',
          matricula: 'M-1',
          marcacoes: [
            { instante: '2026-09-02T19:00', rep: '1', tipo: 'S', fonte: 'O', horario: 'H1', motivo: null },
            {
              instante: '2026-09-02T07:00',
              rep: null,
              tipo: 'E',
              fonte: 'I',
              horario: 'H1',
              motivo: 'Relógio parado',
            },
            {
              instante: '2026-09-02T07:05',
              rep: '1',
              tipo: 'D',
              fonte: 'O',
              horario: 'H1',
              motivo: 'Duplicada',
            },
          ],
          ausencias: [{ tipo: 2, data: '2026-09-04', minutos: 720, movimentoBanco: null }],
        },
        {
          id: '11',
          cpf: '11144477735',
          nome: 'SEM MATRICULA',
          matricula: null,
          marcacoes: [],
          ausencias: [],
        },
      ],
      programa: {
        nome: 'Sistema',
        versao: '1.0',
        cnpjDesenvolvedor: null,
        razaoDesenvolvedor: 'Rede',
        email: 'a@b',
      },
    });
    const l = t.trimEnd().split('\r\n');
    expect(l[0]).toBe(
      '01|1|00000000000191|||HOSPITAL   SINTETICO|2026-09-01|2026-09-30|2026-10-02T10:00:00-0300|001',
    );
    expect(l.filter((x) => x.startsWith('05|'))).toEqual([
      '05|10|2026-09-02T07:00:00-0300||E|1|I|H1|Relógio parado',
      '05|10|2026-09-02T07:05:00-0300|1|D||O|H1|Duplicada',
      '05|10|2026-09-02T19:00:00-0300|1|S|1|O|H1|',
    ]);
    expect(l.filter((x) => x.startsWith('06|'))).toEqual(['06|10|M-1']);
    expect(l).toContain('07|10|2|2026-09-04|720|');
    expect(l).toContain('08|Sistema|1.0||||Rede|a@b'.replace('||||', '|||'));
    expect(l[l.length - 1]).toBe('99|1|1|2|1|3|1|1|1');
  });
});

describe('biometria no ponto (regra 15)', () => {
  it('só liga com o verdadeiro gravado de propósito', () => {
    expect(biometriaNoPonto(undefined)).toBe(false);
    expect(biometriaNoPonto('false')).toBe(false);
    expect(biometriaNoPonto(1)).toBe(false);
    expect(biometriaNoPonto(true)).toBe(true);
    expect(biometriaNoPonto('true')).toBe(true);
    expect(biometriaNoPonto('sim')).toBe(true);
    expect(biometriaNoPonto('nao')).toBe(false);
  });
});
