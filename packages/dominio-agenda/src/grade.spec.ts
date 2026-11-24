// Regras 4 e 5 e a prévia da geração (`agenda.gerarGrade`): fim exclusivo, intervalo, feriados (9999 = todo
// ano; móveis viram alerta), bloqueios, horários já existentes, corte de hoje, tetos e vetos.
import { describe, expect, it } from 'vitest';
import {
  type ContextoGrade,
  faixasDaEscala,
  feriadoNaData,
  feriadosMoveis,
  pontosFacultativosMoveis,
  mudancasDaEscala,
  pascoa,
  planejarGrade,
  type PedidoGrade,
  VetoGrade,
} from './grade.js';

const ctx = (x: Partial<ContextoGrade> = {}): ContextoGrade => ({
  relogio: { hoje: '2026-10-21', hhmm: '07:00' },
  agendaAtiva: true,
  feriados: [],
  bloqueios: [],
  existentes: new Set(),
  ...x,
});
// 2026-10-26 é segunda (2); 2026-10-27 terça (3).
const pedido = (x: Partial<PedidoGrade> = {}): PedidoGrade => ({
  de: '2026-10-26',
  ate: '2026-10-27',
  duracaoMinutos: 15,
  faixas: [{ semana: 2, inicio: '08:00', fim: '12:00' }],
  ...x,
});
const veto = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    if (e instanceof VetoGrade) return e.codigo;
    throw e;
  }
  return null;
};

describe('horários da faixa', () => {
  it('fim exclusivo: 08:00 a 12:00 com 15 min → 16 horários, o último 11:45', () => {
    const p = planejarGrade(pedido(), ctx());
    expect(p.horarios).toHaveLength(16);
    expect(p.horarios.at(-1)).toEqual({ data: '2026-10-26', hora: '11:45' });
    expect(p.duracao).toBe('00:15');
    expect(p.semanas).toEqual(['F', 'T', 'F', 'F', 'F', 'F', 'F']);
  });
  it('intervalo: nenhum horário começa dentro dele; escala com o intervalo', () => {
    const p = planejarGrade(
      pedido({
        duracaoMinutos: 30,
        faixas: [
          { semana: 2, inicio: '08:00', fim: '14:00', intervaloInicio: '12:00', intervaloFim: '13:00' },
        ],
      }),
      ctx(),
    );
    expect(p.horarios.map((h) => h.hora)).toEqual([
      '08:00',
      '08:30',
      '09:00',
      '09:30',
      '10:00',
      '10:30',
      '11:00',
      '11:30',
      '13:00',
      '13:30',
    ]);
    expect(p.escala).toEqual([
      {
        semana: 2,
        duracao: '00:30',
        horaInicio: '08:00',
        horaFim: '14:00',
        intervaloInicio: '12:00',
        intervaloFim: '13:00',
      },
    ]);
  });
  it('duração que não alinha: o atendimento termina dentro da faixa', () => {
    const p = planejarGrade(
      pedido({ duracaoMinutos: 25, faixas: [{ semana: 2, inicio: '08:00', fim: '09:00' }] }),
      ctx(),
    );
    expect(p.horarios.map((h) => h.hora)).toEqual(['08:00', '08:25']);
  });
  it('duas faixas no dia (manhã e tarde), ordenadas', () => {
    const p = planejarGrade(
      pedido({
        duracaoMinutos: 60,
        faixas: [
          { semana: 2, inicio: '14:00', fim: '16:00' },
          { semana: 2, inicio: '08:00', fim: '10:00' },
        ],
      }),
      ctx(),
    );
    expect(p.porDia[0]?.horarios).toEqual(['08:00', '09:00', '14:00', '15:00']);
    expect(p.escala.map((e) => e.horaInicio)).toEqual(['08:00', '14:00']);
  });
});

describe('feriados, bloqueios, existentes e o corte de hoje', () => {
  it('feriado da lista pulado; incluirFeriados gera com alerta', () => {
    const feriados = [{ data: '2026-10-26', nome: 'FERIADO FIXO' }];
    const p = planejarGrade(
      pedido({ ate: '2026-11-02', faixas: [{ semana: 2, inicio: '08:00', fim: '09:00' }] }),
      ctx({ feriados }),
    );
    expect(p.pulados.feriados).toEqual([{ data: '2026-10-26', nome: 'FERIADO FIXO' }]);
    expect(p.horarios.every((h) => h.data === '2026-11-02')).toBe(true);
    const com = planejarGrade(
      pedido({ incluirFeriados: true, faixas: [{ semana: 2, inicio: '08:00', fim: '09:00' }] }),
      ctx({ feriados: [{ data: '2026-10-26', nome: 'DATADO' }] }),
    );
    expect(com.horarios).toHaveLength(4);
    expect(com.alertas.some((a) => a.codigo === 'feriado-incluido')).toBe(true);
  });
  it('dia com faixa sem expediente (meio expediente): só a faixa é pulada, o resto do dia gera', () => {
    const p = planejarGrade(
      pedido({ faixas: [{ semana: 2, inicio: '08:00', fim: '10:00' }] }),
      ctx({
        feriados: [{ data: '2026-10-26', nome: 'Meio expediente', horaInicio: '09:00', horaFim: '18:00' }],
      }),
    );
    expect(p.pulados.feriados).toEqual([]);
    expect(p.horarios.filter((h) => h.data === '2026-10-26').map((h) => h.hora)).toEqual([
      '08:00',
      '08:15',
      '08:30',
      '08:45',
    ]);
    expect(p.pulados.bloqueados).toBe(4);
  });
  it('ponto facultativo móvel (Carnaval, Corpus Christi) não cadastrado vira alerta (não pula)', () => {
    // Corpus Christi de 2027: 2027-05-27 (quinta, 5).
    const p = planejarGrade(
      {
        de: '2027-05-27',
        ate: '2027-05-27',
        duracaoMinutos: 30,
        faixas: [{ semana: 5, inicio: '08:00', fim: '09:00' }],
      },
      ctx(),
    );
    expect(p.horarios).toHaveLength(2);
    expect(p.alertas.find((a) => a.codigo === 'feriado-movel')?.texto).toMatch(/Corpus Christi/);
  });
  it('bloqueio do dia inteiro e bloqueio por faixa de horas', () => {
    const p = planejarGrade(
      pedido({
        faixas: [
          { semana: 2, inicio: '08:00', fim: '09:00' },
          { semana: 3, inicio: '08:00', fim: '09:00' },
        ],
      }),
      ctx({
        bloqueios: [
          { inicio: '2026-10-26', fim: '2026-10-26' },
          { inicio: '2026-10-27', fim: '2026-10-27', horaInicio: '08:00', horaFim: '08:30' },
        ],
      }),
    );
    expect(p.horarios).toEqual([
      { data: '2026-10-27', hora: '08:30' },
      { data: '2026-10-27', hora: '08:45' },
    ]);
    expect(p.pulados.bloqueados).toBe(6);
  });
  it('horário que já existe é pulado (a chave primária recusaria)', () => {
    const p = planejarGrade(
      pedido({ faixas: [{ semana: 2, inicio: '08:00', fim: '09:00' }] }),
      ctx({ existentes: new Set(['2026-10-26 0800', '2026-10-26 0815']) }),
    );
    expect(p.horarios.map((h) => h.hora)).toEqual(['08:30', '08:45']);
    expect(p.pulados.existentes).toBe(2);
  });
  it('hoje só a partir de 1 hora à frente; os dias seguintes inteiros', () => {
    const p = planejarGrade(
      {
        de: '2026-10-21',
        ate: '2026-10-28',
        duracaoMinutos: 30,
        faixas: [{ semana: 4, inicio: '08:00', fim: '12:00' }],
      },
      ctx({ relogio: { hoje: '2026-10-21', hhmm: '09:45' } }),
    );
    expect(p.porDia[0]).toEqual({ data: '2026-10-21', semana: 4, horarios: ['11:00', '11:30'] });
    expect(p.porDia[1]?.horarios).toHaveLength(8);
    expect(p.pulados.cortadosHoje).toHaveLength(6);
    expect(p.alertas.some((a) => a.codigo === 'corte-hoje')).toBe(true);
  });

  // Porta de vigencia-grade.test.js (sante-api): o corte de hoje perto da meia-noite e o motivo real do veto.
  it('a menos de uma hora da meia-noite, hoje não entra horário nenhum', () => {
    const p = planejarGrade(
      {
        de: '2026-10-21',
        ate: '2026-10-28',
        duracaoMinutos: 30,
        faixas: [{ semana: 4, inicio: '08:00', fim: '23:59' }],
      },
      ctx({ relogio: { hoje: '2026-10-21', hhmm: '23:10' } }),
    );
    expect(p.porDia.find((d) => d.data === '2026-10-21')).toBeUndefined();
    expect(p.porDia.find((d) => d.data === '2026-10-28')?.horarios.length).toBeGreaterThan(0);
  });

  it('se o corte de hoje esvazia a proposta, o veto diz o motivo (não "nada a criar" genérico)', () => {
    const r = (() => {
      try {
        planejarGrade(
          {
            de: '2026-10-21',
            ate: '2026-10-21',
            duracaoMinutos: 30,
            faixas: [{ semana: 4, inicio: '08:00', fim: '10:00' }],
          },
          ctx({ relogio: { hoje: '2026-10-21', hhmm: '09:45' } }),
        );
        return null;
      } catch (e) {
        return e instanceof VetoGrade ? e : null;
      }
    })();
    expect(r).not.toBeNull();
    expect(r?.message).toMatch(/hora|hoje|passad/i);
  });
});

describe('vetos', () => {
  it('agenda inativa, janela no passado, invertida e longa', () => {
    expect(veto(() => planejarGrade(pedido(), ctx({ agendaAtiva: false })))).toBe('agenda-inativa');
    expect(veto(() => planejarGrade(pedido({ de: '2026-10-20' }), ctx()))).toBe('janela-no-passado');
    expect(veto(() => planejarGrade(pedido({ ate: '2026-10-25' }), ctx()))).toBe('janela-invalida');
    expect(veto(() => planejarGrade(pedido({ de: 'x' }), ctx()))).toBe('janela-invalida');
    expect(veto(() => planejarGrade(pedido({ ate: '2027-03-01' }), ctx()))).toBe('janela-longa');
  });
  it('duração fora de 5 a 240 minutos', () => {
    expect(veto(() => planejarGrade(pedido({ duracaoMinutos: 4 }), ctx()))).toBe('duracao-invalida');
    expect(veto(() => planejarGrade(pedido({ duracaoMinutos: 241 }), ctx()))).toBe('duracao-invalida');
  });
  it('sábado e domingo não vistos no legado são recusados (parâmetro libera)', () => {
    expect(
      veto(() => planejarGrade(pedido({ faixas: [{ semana: 7, inicio: '08:00', fim: '09:00' }] }), ctx())),
    ).toBe('dia-nao-visto');
    const p = planejarGrade(
      {
        de: '2026-10-24',
        ate: '2026-10-24',
        duracaoMinutos: 30,
        faixas: [{ semana: 7, inicio: '08:00', fim: '09:00' }],
      },
      ctx({ semanasPermitidas: [7] }),
    );
    expect(p.horarios).toHaveLength(2);
  });
  it('faixas inválidas', () => {
    const f = (x: object) =>
      veto(() =>
        planejarGrade(pedido({ faixas: [{ semana: 2, inicio: '08:00', fim: '12:00', ...x }] }), ctx()),
      );
    expect(f({ semana: 8 })).toBe('faixa-invalida');
    expect(f({ fim: '07:00' })).toBe('faixa-invalida');
    expect(f({ fim: '08:10' })).toBe('faixa-invalida');
    expect(f({ inicio: '25:00' })).toBe('faixa-invalida');
    expect(f({ intervaloInicio: '10:00' })).toBe('faixa-invalida');
    expect(f({ intervaloInicio: '10:00', intervaloFim: '09:00' })).toBe('faixa-invalida');
    expect(f({ intervaloInicio: '07:00', intervaloFim: '09:00' })).toBe('faixa-invalida');
    expect(f({ intervaloInicio: 'xx', intervaloFim: '09:00' })).toBe('faixa-invalida');
    expect(veto(() => planejarGrade(pedido({ faixas: [] }), ctx()))).toBe('faixa-invalida');
    expect(
      veto(() =>
        planejarGrade(
          pedido({
            faixas: [
              { semana: 2, inicio: '08:00', fim: '10:00' },
              { semana: 2, inicio: '09:00', fim: '11:00' },
            ],
          }),
          ctx(),
        ),
      ),
    ).toBe('faixa-invalida');
  });
  it('nada a criar e teto de horários', () => {
    expect(
      veto(() =>
        planejarGrade(
          pedido({ faixas: [{ semana: 2, inicio: '08:00', fim: '08:15' }] }),
          ctx({ existentes: new Set(['2026-10-26 0800']) }),
        ),
      ),
    ).toBe('sem-horario');
    expect(
      veto(() =>
        planejarGrade(
          pedido({ faixas: [{ semana: 3, inicio: '08:00', fim: '08:15' }], ate: '2026-10-26' }),
          ctx(),
        ),
      ),
    ).toBe('sem-horario');
    expect(veto(() => planejarGrade(pedido(), ctx({ teto: 10 })))).toBe('acima-do-teto');
  });
  it('erro que não é de tempo não é engolido', () => {
    expect(() =>
      veto(() => {
        throw new Error('outro');
      }),
    ).toThrow('outro');
  });
});

describe('feriados móveis e modelo da escala', () => {
  it('Páscoa (Meeus), o feriado móvel e os pontos facultativos móveis', () => {
    expect(pascoa(2026)).toBe('2026-04-05');
    expect(pascoa(2027)).toBe('2027-03-28');
    expect(feriadosMoveis(2026).map((f) => f.data)).toEqual(['2026-04-03']);
    expect(pontosFacultativosMoveis(2026).map((f) => f.data)).toEqual(['2026-02-17', '2026-06-04']);
  });
  it('feriado na data: só o dia inteiro conta; a faixa de horas não', () => {
    const f = [
      { data: '2026-12-25', nome: 'NATAL' },
      { data: '2026-12-24', nome: 'VÉSPERA', horaInicio: '12:00', horaFim: null },
    ];
    expect(feriadoNaData('2026-12-25', f)?.nome).toBe('NATAL');
    expect(feriadoNaData('2026-12-24', f)).toBeNull();
    expect(feriadoNaData('2027-12-25', f)).toBeNull();
  });
  it('mudanças do modelo pela chave (semana, duração, início)', () => {
    const atual = [
      {
        semana: 2,
        duracao: '00:15',
        horaInicio: '08:00',
        horaFim: '11:00',
        intervaloInicio: '00:00',
        intervaloFim: '00:00',
      },
      {
        semana: 3,
        duracao: '00:15',
        horaInicio: '08:00',
        horaFim: '12:00',
        intervaloInicio: '00:00',
        intervaloFim: '00:00',
      },
    ];
    const alvo = [
      {
        semana: 2,
        duracao: '00:15',
        horaInicio: '08:00',
        horaFim: '12:00',
        intervaloInicio: '00:00',
        intervaloFim: '00:00',
      },
      {
        semana: 3,
        duracao: '00:15',
        horaInicio: '08:00',
        horaFim: '12:00',
        intervaloInicio: '00:00',
        intervaloFim: '00:00',
      },
      {
        semana: 4,
        duracao: '00:15',
        horaInicio: '08:00',
        horaFim: '12:00',
        intervaloInicio: '00:00',
        intervaloFim: '00:00',
      },
    ];
    const m = mudancasDaEscala(atual, alvo);
    expect(m.map((x) => x.acao)).toEqual(['alterar', 'manter', 'incluir']);
    expect(m[0]?.anterior).toEqual({ horaFim: '11:00', intervaloInicio: '00:00', intervaloFim: '00:00' });
    expect(m[2]?.anterior).toBeNull();
  });
  it('faixas a partir da escala ("0000" = sem intervalo)', () => {
    expect(
      faixasDaEscala([
        {
          semana: 2,
          duracao: '00:15',
          horaInicio: '08:00',
          horaFim: '12:00',
          intervaloInicio: '00:00',
          intervaloFim: '00:00',
        },
        {
          semana: 3,
          duracao: '00:15',
          horaInicio: '08:00',
          horaFim: '14:00',
          intervaloInicio: '12:00',
          intervaloFim: '13:00',
        },
      ]),
    ).toEqual([
      { semana: 2, inicio: '08:00', fim: '12:00', intervaloInicio: null, intervaloFim: null },
      { semana: 3, inicio: '08:00', fim: '14:00', intervaloInicio: '12:00', intervaloFim: '13:00' },
    ]);
  });
});
