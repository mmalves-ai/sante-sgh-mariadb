// F3.6 (05-SUP linha 7): regra de integração prescrição × estoque e grade de horários padrão de medicação.
import { describe, expect, it } from 'vitest';
import {
  chaveRegraIntegracao,
  type ContextoIntegracao,
  conferirGradePadrao,
  conferirHorariosPadrao,
  decidirIntegracao,
  type RegraCandidata,
  regraVigente,
  conferirRegraIntegracao,
  diasDoTexto,
  dosesDaFrequencia,
  diasParaTexto,
  type RegraIntegracaoConferida,
} from '@sgh/contratos/regras-suprimentos';

const base: RegraIntegracaoConferida = {
  centroCusto: 1,
  setor: null,
  unidade: null,
  grupo: null,
  subgrupo: null,
  item: null,
  localAtendente: 10,
  localSubstituto: null,
  tipoIntegracao: 'requisicao_automatica',
  momento: 'na_prescricao',
  antecedenciaMinutos: null,
  geraManipulacao: false,
};
const codigos = (r: Partial<RegraIntegracaoConferida>) =>
  conferirRegraIntegracao({ ...base, ...r }).map((x) => x.codigo);

describe('regra de integração prescrição × estoque', () => {
  it('a regra completa passa', () => {
    expect(codigos({})).toEqual([]);
    expect(codigos({ momento: 'antes_do_horario', antecedenciaMinutos: 60, localSubstituto: 20 })).toEqual(
      [],
    );
  });
  it('exige o escopo (centro, setor ou unidade)', () => {
    expect(codigos({ centroCusto: null })).toEqual(['escopo-obrigatorio']);
    expect(codigos({ centroCusto: null, unidade: 3 })).toEqual([]);
  });
  it('substituto diferente do local que atende', () => {
    expect(codigos({ localSubstituto: 10 })).toEqual(['mesmo-local']);
  });
  it('antecedência só e sempre com o momento "antes do horário"', () => {
    expect(codigos({ momento: 'antes_do_horario' })).toEqual(['antecedencia-obrigatoria']);
    expect(codigos({ antecedenciaMinutos: 30 })).toEqual(['antecedencia-sem-uso']);
  });
  it('exceção por item não se mistura com grupo; subgrupo exige grupo', () => {
    expect(codigos({ item: 5, grupo: 2 })).toEqual(['item-e-grupo']);
    expect(codigos({ subgrupo: 4 })).toEqual(['subgrupo-sem-grupo']);
  });
  it('sem integração não gera manipulação', () => {
    expect(codigos({ tipoIntegracao: 'sem_integracao', geraManipulacao: true })).toEqual([
      'manipulacao-sem-integracao',
    ]);
  });
  it('a chave de ambiguidade considera escopo, filtros e prioridade', () => {
    const k = (p: number, tipoItem: number | null = null) =>
      chaveRegraIntegracao({ ...base, tipoItem, prioridade: p });
    expect(k(100)).toBe(k(100));
    expect(k(100)).not.toBe(k(50));
    expect(k(100)).not.toBe(k(100, 7));
  });
});

describe('grade de horários padrão', () => {
  const h = (...horas: string[]) => horas.map((hora) => ({ hora, dias: [] as number[] }));
  it('aceita a grade com o número de doses da frequência, inclusive virando o dia', () => {
    expect(conferirHorariosPadrao(h('22:00', '06:00', '14:00'), 3)).toEqual([]);
    expect(conferirHorariosPadrao(h('08:00'), null)).toEqual([]);
  });
  it('recusa grade vazia, horário inválido ou repetido', () => {
    expect(conferirHorariosPadrao([], 2).map((r) => r.codigo)).toEqual(['sem-horario']);
    expect(conferirHorariosPadrao(h('24:00'), null).map((r) => r.codigo)).toEqual(['hora-invalida']);
    expect(conferirHorariosPadrao(h('08:00', '08:00'), null).map((r) => r.codigo)).toEqual([
      'horario-repetido',
    ]);
  });
  it('recusa o número de horários diferente das doses por dia', () => {
    expect(conferirHorariosPadrao(h('08:00', '20:00'), 3).map((r) => r.codigo)).toEqual([
      'doses-da-frequencia',
    ]);
  });
  it('dias de 1 a 7 sem repetir; todos os dias gravam nulo', () => {
    expect(conferirHorariosPadrao([{ hora: '08:00', dias: [1, 8] }], null).map((r) => r.codigo)).toEqual([
      'dia-invalido',
    ]);
    expect(conferirHorariosPadrao([{ hora: '08:00', dias: [2, 2] }], null).map((r) => r.codigo)).toEqual([
      'dia-invalido',
    ]);
    expect(diasParaTexto([])).toBeNull();
    expect(diasParaTexto([1, 2, 3, 4, 5, 6, 7])).toBeNull();
    expect(diasParaTexto([6, 2, 4])).toBe('2,4,6');
    expect(diasDoTexto('2,4,6')).toEqual([2, 4, 6]);
    expect(diasDoTexto(null)).toEqual([]);
  });
});

describe('regra vigente e decisão da integração', () => {
  const ctx: ContextoIntegracao = {
    centroCusto: 1,
    setor: 5,
    unidade: null,
    tipoItem: 2,
    grupo: 3,
    subgrupo: 4,
    item: 99,
  };
  const r = (regra: number, x: Partial<RegraCandidata>): RegraCandidata => ({
    ...base,
    regra,
    tipoItem: null,
    prioridade: 100,
    ativo: true,
    ...x,
  });

  it('a mais específica vence: item > subgrupo > grupo > tipo; e o setor antes do centro de custo', () => {
    const regras = [
      r(1, { centroCusto: 1 }),
      r(2, { centroCusto: null, setor: 5 }),
      r(3, { tipoItem: 2 }),
      r(4, { grupo: 3 }),
      r(5, { subgrupo: 4 }),
      r(6, { item: 99 }),
    ];
    expect(regraVigente(regras, ctx)?.regra).toBe(6);
    expect(regraVigente(regras.slice(0, 5), ctx)?.regra).toBe(5);
    expect(regraVigente(regras.slice(0, 2), ctx)?.regra).toBe(2);
  });

  it('a prioridade desempata (menor número vence) e, por fim, a regra mais antiga', () => {
    expect(regraVigente([r(1, { prioridade: 50 }), r(2, { prioridade: 10 })], ctx)?.regra).toBe(2);
    expect(regraVigente([r(8, {}), r(7, {})], ctx)?.regra).toBe(7);
  });

  it('regra inativa ou de outro escopo ou item não vale; sem regra, nada vai ao estoque', () => {
    expect(
      regraVigente([r(1, { ativo: false }), r(2, { centroCusto: 9 }), r(3, { item: 98 })], ctx),
    ).toBeNull();
    const d = decidirIntegracao(null, { temSaldo: () => true, prescritoEm: new Date(0), horarioDose: null });
    expect(d.integraEstoque).toBe(false);
  });

  it('local atendente com saldo; sem saldo, o substituto; antecedência conta do horário da dose', () => {
    const regra = r(1, { localSubstituto: 20, momento: 'antes_do_horario', antecedenciaMinutos: 90 });
    const dose = new Date('2026-11-24T14:00:00Z');
    const comSaldo = decidirIntegracao(regra, {
      temSaldo: () => true,
      prescritoEm: new Date(0),
      horarioDose: dose,
    });
    expect(comSaldo).toEqual({
      integraEstoque: true,
      local: 10,
      usouSubstituto: false,
      liberarEm: new Date('2026-11-24T12:30:00Z'),
    });
    const semSaldo = decidirIntegracao(regra, {
      temSaldo: (l) => l === 20,
      prescritoEm: new Date(0),
      horarioDose: dose,
    });
    expect(semSaldo.local).toBe(20);
    expect(semSaldo.usouSubstituto).toBe(true);
    const nenhum = decidirIntegracao(regra, {
      temSaldo: () => false,
      prescritoEm: new Date(0),
      horarioDose: dose,
    });
    expect(nenhum.local).toBeNull();
    expect(
      decidirIntegracao(r(2, { tipoIntegracao: 'sem_integracao' }), {
        temSaldo: () => true,
        prescritoEm: new Date(0),
        horarioDose: null,
      }).integraEstoque,
    ).toBe(false);
  });
});

describe('grade padrão unificada (a mesma do aprazamento)', () => {
  it('a frequência dá o número de doses: o declarado ou o intervalo que fecha o dia', () => {
    expect(dosesDaFrequencia({ dosesPorDia: 3, intervaloMinutos: null })).toBe(3);
    expect(dosesDaFrequencia({ dosesPorDia: null, intervaloMinutos: 480 })).toBe(3);
    expect(dosesDaFrequencia({ dosesPorDia: null, intervaloMinutos: 30 })).toBe(48);
    expect(dosesDaFrequencia({ dosesPorDia: 2, intervaloMinutos: 480 })).toBe(2);
  });
  it('sem número de doses não há grade: intervalo que não fecha o dia, curto demais, a critério', () => {
    expect(dosesDaFrequencia({ dosesPorDia: null, intervaloMinutos: 420 })).toBeNull();
    expect(dosesDaFrequencia({ dosesPorDia: null, intervaloMinutos: 20 })).toBeNull();
    expect(dosesDaFrequencia({ dosesPorDia: null, intervaloMinutos: null })).toBeNull();
    expect(dosesDaFrequencia({ dosesPorDia: 60, intervaloMinutos: null })).toBeNull();
  });
  it('recusa a frequência sem doses e exige o número exato de horários', () => {
    const h = (...hs: string[]) => hs.map((hora) => ({ hora }));
    expect(conferirGradePadrao(h('08:00'), null).map((r) => r.codigo)).toEqual(['frequencia-sem-doses']);
    expect(conferirGradePadrao(h('06:00', '14:00', '22:00'), 3)).toEqual([]);
    expect(conferirGradePadrao(h('06:00', '18:00'), 3).map((r) => r.codigo)).toEqual(['doses-da-frequencia']);
    expect(conferirGradePadrao(h('06:00', '06:00'), 2).map((r) => r.codigo)).toEqual(['horario-repetido']);
  });
});
