// Agenda de sessões (M50, etapa 6; ficha, regra 11): a série ligada ao plano, sem sobreposição de cadeira ou sala nem
// do paciente, com a duração e a complexidade do domínio e a faixa etária do recurso.
import { describe, expect, it } from 'vitest';
import {
  conferirRecurso,
  conflitosDaSerie,
  datasDaSerie,
  ErroSessao,
  faixaDoRecurso,
  idadeEmAnos,
  restantesDaSerie,
  sobrepoe,
  somarMinutos,
  transicaoSessao,
} from './serie.js';

const recusa = (fn: () => unknown, codigo: string) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ErroSessao);
    expect((e as ErroSessao).codigo).toBe(codigo);
    return;
  }
  throw new Error(`Não recusou (${codigo}).`);
};

describe('datas da série', () => {
  it('semanal: 4 sessões a cada 7 dias, com o fim pela duração', () => {
    const d = datasDaSerie({
      inicio: '2027-03-01',
      hora: '0800',
      sessoes: 4,
      intervaloDias: 7,
      pularFimDeSemana: false,
      duracaoMin: 90,
    });
    expect(d.map((x) => x.inicio)).toEqual([
      '2027-03-01T08:00',
      '2027-03-08T08:00',
      '2027-03-15T08:00',
      '2027-03-22T08:00',
    ]);
    expect(d[0]).toEqual({ ordem: 1, inicio: '2027-03-01T08:00', fim: '2027-03-01T09:30' });
  });

  it('diária pulando o fim de semana: sexta, segunda, terça (o sábado e o domingo vão para a segunda)', () => {
    const d = datasDaSerie({
      inicio: '2027-03-05',
      hora: '1400',
      sessoes: 3,
      intervaloDias: 1,
      pularFimDeSemana: true,
      duracaoMin: 45,
    });
    expect(d.map((x) => x.inicio.slice(0, 10))).toEqual(['2027-03-05', '2027-03-08', '2027-03-09']);
    const domingo = datasDaSerie({
      inicio: '2027-03-07',
      hora: '1400',
      sessoes: 1,
      intervaloDias: 1,
      pularFimDeSemana: true,
      duracaoMin: 45,
    });
    expect(domingo[0]?.inicio).toBe('2027-03-08T14:00');
  });

  it('sem pular, o sábado fica; a sessão que passa da meia-noite termina no outro dia', () => {
    const d = datasDaSerie({
      inicio: '2027-03-06',
      hora: '2300',
      sessoes: 1,
      intervaloDias: 1,
      pularFimDeSemana: false,
      duracaoMin: 120,
    });
    expect(d[0]).toEqual({ ordem: 1, inicio: '2027-03-06T23:00', fim: '2027-03-07T01:00' });
  });

  it('recusa a série vazia, a hora e a data inexistentes', () => {
    const base = {
      inicio: '2027-03-01',
      hora: '0800',
      sessoes: 1,
      intervaloDias: 1,
      pularFimDeSemana: false,
      duracaoMin: 30,
    };
    recusa(() => datasDaSerie({ ...base, sessoes: 0 }), 'serie-vazia');
    recusa(() => datasDaSerie({ ...base, hora: '2460' }), 'hora-invalida');
    recusa(() => datasDaSerie({ ...base, inicio: '2027-02-30' }), 'data-invalida');
  });

  it('soma minutos na virada do mês', () => {
    expect(somarMinutos('2027-01-31T23:50', 20)).toBe('2027-02-01T00:10');
  });
});

describe('sobreposição', () => {
  const a = { inicio: '2027-03-01T08:00', fim: '2027-03-01T09:30' };
  it('o intervalo é [início, fim): encostar não sobrepõe', () => {
    expect(sobrepoe(a, { inicio: '2027-03-01T09:30', fim: '2027-03-01T10:00' })).toBe(false);
    expect(sobrepoe(a, { inicio: '2027-03-01T07:00', fim: '2027-03-01T08:00' })).toBe(false);
    expect(sobrepoe(a, { inicio: '2027-03-01T09:00', fim: '2027-03-01T10:00' })).toBe(true);
    expect(sobrepoe(a, { inicio: '2027-03-01T07:00', fim: '2027-03-01T11:00' })).toBe(true);
  });

  it('a cadeira ocupada vem antes do paciente ocupado; o resto fica livre', () => {
    const datas = datasDaSerie({
      inicio: '2027-03-01',
      hora: '0800',
      sessoes: 3,
      intervaloDias: 7,
      pularFimDeSemana: false,
      duracaoMin: 60,
    });
    const c = conflitosDaSerie(
      datas,
      [{ inicio: '2027-03-01T08:30', fim: '2027-03-01T09:30' }],
      [
        { inicio: '2027-03-01T08:00', fim: '2027-03-01T08:15' },
        { inicio: '2027-03-08T08:45', fim: '2027-03-08T10:00' },
      ],
    );
    expect(c.map((x) => x.conflito)).toEqual(['recurso', 'paciente', null]);
  });
});

describe('recurso', () => {
  const r = {
    ativo: true,
    complexidade: 0,
    duracao: 0,
    faixa: null,
    identificacao: 'CADEIRA 01',
  };
  it('o recurso "todas" aceita qualquer complexidade e duração', () => {
    expect(() => conferirRecurso(r, { complexidade: 3, duracao: 1, idade: 40 })).not.toThrow();
  });
  it('recusa o inativo, a complexidade e a duração diferentes e a idade fora da faixa', () => {
    recusa(
      () => conferirRecurso({ ...r, ativo: false }, { complexidade: 1, duracao: 1, idade: 4 }),
      'recurso-inativo',
    );
    recusa(
      () => conferirRecurso({ ...r, complexidade: 2 }, { complexidade: 3, duracao: 1, idade: 4 }),
      'complexidade-nao-aceita',
    );
    recusa(
      () => conferirRecurso({ ...r, duracao: 1 }, { complexidade: 3, duracao: 3, idade: 4 }),
      'duracao-nao-aceita',
    );
    recusa(
      () => conferirRecurso({ ...r, faixa: { de: 0, ate: 17 } }, { complexidade: 3, duracao: 3, idade: 30 }),
      'fora-da-faixa-etaria',
    );
  });
  it('a faixa não se confere sem a idade; dentro da faixa passa', () => {
    expect(() =>
      conferirRecurso({ ...r, faixa: { de: 0, ate: 17 } }, { complexidade: 1, duracao: 1, idade: null }),
    ).not.toThrow();
    expect(() =>
      conferirRecurso({ ...r, faixa: { de: 0, ate: 17 } }, { complexidade: 1, duracao: 1, idade: 17 }),
    ).not.toThrow();
  });
  it('a faixa padrão (0–99), a vazia (0–0) e a invertida valem como sem limite', () => {
    expect(faixaDoRecurso(0, 99)).toBeNull();
    expect(faixaDoRecurso(0, 0)).toBeNull();
    expect(faixaDoRecurso(null, null)).toBeNull();
    expect(faixaDoRecurso(30, 10)).toBeNull();
    expect(faixaDoRecurso(0, 17)).toEqual({ de: 0, ate: 17 });
    expect(faixaDoRecurso(60, 99)).toEqual({ de: 60, ate: 99 });
  });
  it('idade em anos completos no dia', () => {
    expect(idadeEmAnos('2010-05-20', '2027-05-19')).toBe(16);
    expect(idadeEmAnos('2010-05-20', '2027-05-20')).toBe(17);
    expect(idadeEmAnos('2010-05-20', '2027-04-30')).toBe(16);
    expect(idadeEmAnos(null, '2027-05-20')).toBeNull();
  });
});

describe('sessão', () => {
  it('realizada e falta só hoje ou antes; cancelar a qualquer tempo', () => {
    expect(transicaoSessao('agendada', 'realizar', '2027-03-01T08:00', '2027-03-01T07:00')).toBe('realizada');
    expect(transicaoSessao('agendada', 'falta', '2027-02-28T08:00', '2027-03-01T07:00')).toBe('falta');
    expect(transicaoSessao('agendada', 'cancelar', '2027-04-01T08:00', '2027-03-01T07:00')).toBe('cancelada');
    expect(transicaoSessao('agendada', 'cancelar-restantes', '2027-04-01T08:00', '2027-03-01T07:00')).toBe(
      'cancelada',
    );
    recusa(
      () => transicaoSessao('agendada', 'realizar', '2027-03-02T08:00', '2027-03-01T23:00'),
      'sessao-futura',
    );
    recusa(
      () => transicaoSessao('agendada', 'falta', '2027-03-02T08:00', '2027-03-01T23:00'),
      'sessao-futura',
    );
  });
  it('a sessão já registrada não muda', () => {
    for (const s of ['realizada', 'falta', 'cancelada'] as const)
      recusa(
        () => transicaoSessao(s, 'cancelar', '2027-03-01T08:00', '2027-03-01T07:00'),
        'sessao-encerrada',
      );
  });
  it('cancelar as restantes pega esta e as seguintes ainda agendadas', () => {
    const serie = [
      { ordem: 1, situacao: 'realizada' as const },
      { ordem: 2, situacao: 'agendada' as const },
      { ordem: 3, situacao: 'cancelada' as const },
      { ordem: 4, situacao: 'agendada' as const },
    ];
    expect(restantesDaSerie(serie, 2).map((s) => s.ordem)).toEqual([2, 4]);
    expect(restantesDaSerie(serie, 4).map((s) => s.ordem)).toEqual([4]);
  });
});
