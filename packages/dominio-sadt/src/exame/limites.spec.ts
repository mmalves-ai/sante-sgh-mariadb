import { describe, expect, it } from 'vitest';
import {
  bloqueiosPorResultado,
  conferirBloqueioPorResultado,
  conferirCota,
  conferirIntervalo,
  type CotaExame,
  cotasAcionadas,
  decisaoDosLimites,
  intervalosAcionados,
  type ItemAvaliado,
  janelaDaCota,
  type LimiteAcionado,
  RecusaLimite,
} from './limites.js';

const item: ItemAvaliado = {
  exame: 10,
  setor: 3,
  fontePagadora: 7,
  unidade: 2,
  setorSolicitante: 5,
  data: '2026-11-24',
  hora: '10:00',
};
const cota: CotaExame = {
  id: 1,
  exame: 10,
  setor: null,
  fontePagadora: 7,
  unidade: null,
  setorSolicitante: null,
  periodo: 'mes',
  quantidadeMaxima: 3,
  percentualLimite: null,
  permiteExceder: false,
  vigenciaInicio: '2026-01-01',
  vigenciaFim: null,
};

describe('janela da cota', () => {
  it('dia, semana de segunda a domingo, mês e competência', () => {
    expect(janelaDaCota('dia', '2026-11-24')).toEqual({ inicio: '2026-11-24', fim: '2026-11-24' });
    expect(janelaDaCota('semana', '2026-11-24')).toEqual({ inicio: '2026-11-23', fim: '2026-11-29' });
    expect(janelaDaCota('semana', '2026-11-29')).toEqual({ inicio: '2026-11-23', fim: '2026-11-29' });
    expect(janelaDaCota('mes', '2026-02-10')).toEqual({ inicio: '2026-02-01', fim: '2026-02-28' });
    expect(janelaDaCota('competencia', '2026-12-31')).toEqual({ inicio: '2026-12-01', fim: '2026-12-31' });
  });
});

describe('cota por período', () => {
  it('bloqueia quando o pedido passa da quantidade, contando o que já veio no mesmo pedido', () => {
    expect(cotasAcionadas([cota], item, () => ({ usados: 2, totalDoAlvo: 2 }))).toEqual([]);
    const a = cotasAcionadas(
      [cota],
      item,
      () => ({ usados: 2, totalDoAlvo: 2 }),
      () => 1,
    );
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ tipo: 'cota', regra: 1, acao: 'bloquear' });
    expect(a[0]!.mensagem).toContain('cota de 3 no mês');
  });
  it('a cota que permite exceder só avisa; fora do filtro ou da vigência, não vale', () => {
    const solta = { ...cota, permiteExceder: true };
    expect(cotasAcionadas([solta], item, () => ({ usados: 3, totalDoAlvo: 3 }))[0]!.acao).toBe('alertar');
    expect(
      cotasAcionadas([cota], { ...item, fontePagadora: 8 }, () => ({ usados: 9, totalDoAlvo: 9 })),
    ).toEqual([]);
    expect(
      cotasAcionadas([{ ...cota, vigenciaFim: '2026-10-31' }], item, () => ({ usados: 9, totalDoAlvo: 9 })),
    ).toEqual([]);
    const setor = { ...cota, exame: null, setor: 3 };
    expect(cotasAcionadas([setor], item, () => ({ usados: 3, totalDoAlvo: 3 }))).toHaveLength(1);
    expect(cotasAcionadas([setor], { ...item, setor: 4 }, () => ({ usados: 3, totalDoAlvo: 3 }))).toEqual([]);
  });
  it('percentual: a fatia da fonte pagadora só decide com 10 pedidos ou mais no período', () => {
    const pct = { ...cota, quantidadeMaxima: null, percentualLimite: 30 };
    expect(cotasAcionadas([pct], item, () => ({ usados: 3, totalDoAlvo: 5 }))).toEqual([]);
    expect(cotasAcionadas([pct], item, () => ({ usados: 2, totalDoAlvo: 20 }))).toEqual([]);
    const a = cotasAcionadas([pct], item, () => ({ usados: 3, totalDoAlvo: 9 }));
    expect(a[0]!.mensagem).toContain('fatia de 30%');
  });
});

describe('intervalo e repetição no mesmo dia', () => {
  const mesmoDia = {
    id: 5,
    exame: 10,
    conflitante: 10,
    fontePagadora: null,
    intervaloMinimoHoras: 0,
    mesmoDia: true,
    acao: 'bloquear' as const,
    mensagem: null,
    vigenciaInicio: '2026-01-01',
    vigenciaFim: null,
  };
  it('repetição proibida no mesmo dia; no dia seguinte passa', () => {
    const a = intervalosAcionados(
      [mesmoDia],
      item,
      [{ exame: 10, fontePagadora: 7, em: '2026-11-24 07:30' }],
      [],
    );
    expect(a).toEqual([
      { tipo: 'intervalo', regra: 5, exame: 10, acao: 'bloquear', mensagem: 'Exame já pedido no mesmo dia.' },
    ]);
    expect(
      intervalosAcionados([mesmoDia], item, [{ exame: 10, fontePagadora: 7, em: '2026-11-23 23:50' }], []),
    ).toEqual([]);
  });
  it('intervalo em horas e exame incompatível no mesmo pedido, nos dois sentidos', () => {
    const horas = {
      ...mesmoDia,
      id: 6,
      mesmoDia: false,
      intervaloMinimoHoras: 72,
      acao: 'exigir_justificativa' as const,
    };
    const a = intervalosAcionados(
      [horas],
      item,
      [{ exame: 10, fontePagadora: 7, em: '2026-11-22 10:00' }],
      [],
    );
    expect(a[0]!.mensagem).toContain('há 48 h (mínimo de 72 h)');
    expect(
      intervalosAcionados([horas], item, [{ exame: 10, fontePagadora: 7, em: '2026-11-21 09:00' }], []),
    ).toEqual([]);
    const par = { ...mesmoDia, id: 7, conflitante: 11 };
    expect(intervalosAcionados([par], item, [], [11])[0]!.mensagem).toContain('incompatível');
    expect(intervalosAcionados([par], { ...item, exame: 11 }, [], [10])).toHaveLength(1);
    expect(intervalosAcionados([{ ...par, fontePagadora: 8 }], item, [], [11])).toEqual([]);
  });
});

describe('bloqueio pelo último resultado', () => {
  const regra = {
    id: 9,
    exame: 10,
    exameAvaliado: 20,
    analito: 30,
    operador: 'menor' as const,
    valor: '5,7',
    janelaDias: 90,
    acao: 'bloquear' as const,
    mensagem: null,
  };
  it('vale o resultado mais recente dentro da janela', () => {
    const res = [
      { exame: 20, analito: 30, valorTexto: '6,2', valorNumerico: null, data: '2026-06-01' },
      { exame: 20, analito: 30, valorTexto: null, valorNumerico: 5.1, data: '2026-10-01' },
    ];
    expect(bloqueiosPorResultado([regra], item, res)).toHaveLength(1);
    expect(bloqueiosPorResultado([regra], item, res.slice(0, 1))).toEqual([]);
    expect(bloqueiosPorResultado([{ ...regra, janelaDias: 30 }], item, res)).toEqual([]);
  });
  it('entre, igual em texto e contém', () => {
    const r = { exame: 20, analito: 30, valorTexto: 'Não reagente', valorNumerico: null, data: '2026-11-20' };
    expect(
      bloqueiosPorResultado([{ ...regra, operador: 'igual', valor: 'não reagente' }], item, [r]),
    ).toHaveLength(1);
    expect(
      bloqueiosPorResultado([{ ...regra, operador: 'contem', valor: 'reagente' }], item, [r]),
    ).toHaveLength(1);
    const num = { ...r, valorTexto: '4.5' };
    expect(bloqueiosPorResultado([{ ...regra, operador: 'entre', valor: '4;5' }], item, [num])).toHaveLength(
      1,
    );
    expect(bloqueiosPorResultado([{ ...regra, operador: 'entre', valor: '5;6' }], item, [num])).toEqual([]);
  });
});

describe('decisão dos limites', () => {
  const b: LimiteAcionado = { tipo: 'cota', regra: 1, exame: 10, acao: 'bloquear', mensagem: 'Cota.' };
  const j: LimiteAcionado = { ...b, tipo: 'intervalo', acao: 'exigir_justificativa' };
  const al: LimiteAcionado = { ...b, acao: 'alertar' };
  const sem = { confirmado: false, justificativa: null, podeAutorizarExcecao: false };
  it('bloqueio pede justificativa e permissão; a justificativa basta no "exigir"', () => {
    expect(decisaoDosLimites([b], sem).codigo).toBe('limite-bloqueio');
    expect(decisaoDosLimites([b], { ...sem, justificativa: 'paciente em quimioterapia' }).codigo).toBe(
      'limite-autorizacao',
    );
    const ok = decisaoDosLimites([b, j], {
      ...sem,
      justificativa: 'paciente em quimioterapia',
      podeAutorizarExcecao: true,
    });
    expect(ok).toEqual({ segue: true, codigo: null, motivo: null, liberados: [b, j] });
    expect(decisaoDosLimites([j], sem).codigo).toBe('limite-justificativa');
    expect(decisaoDosLimites([j], { ...sem, justificativa: 'controle pós-operatório' }).segue).toBe(true);
  });
  it('alerta pede só confirmação e não vira liberação', () => {
    expect(decisaoDosLimites([al], sem).codigo).toBe('limite-confirmar');
    expect(decisaoDosLimites([al], { ...sem, confirmado: true })).toMatchObject({
      segue: true,
      liberados: [],
    });
    expect(decisaoDosLimites([], sem).segue).toBe(true);
  });
});

describe('cadastro', () => {
  it('confere cota, intervalo e bloqueio por resultado', () => {
    const c: Omit<CotaExame, 'id'> = { ...cota };
    delete (c as Partial<CotaExame>).id;
    expect(() => conferirCota(c)).not.toThrow();
    expect(() => conferirCota({ ...c, exame: null })).toThrow(RecusaLimite);
    expect(() => conferirCota({ ...c, quantidadeMaxima: null })).toThrow('quantidade máxima');
    expect(() => conferirCota({ ...c, percentualLimite: 20, fontePagadora: null })).toThrow('fonte pagadora');
    expect(() =>
      conferirIntervalo({
        exame: 1,
        conflitante: 1,
        fontePagadora: null,
        intervaloMinimoHoras: 0,
        mesmoDia: false,
        acao: 'bloquear',
        mensagem: null,
        vigenciaInicio: '2026-01-01',
        vigenciaFim: null,
      }),
    ).toThrow('mesmo dia');
    const r = {
      exame: 1,
      exameAvaliado: null,
      analito: 2,
      operador: 'entre' as const,
      valor: '1;x',
      janelaDias: 30,
      acao: 'alertar' as const,
      mensagem: null,
    };
    expect(() => conferirBloqueioPorResultado(r)).toThrow('mínimo;máximo');
    expect(() => conferirBloqueioPorResultado({ ...r, operador: 'maior', valor: 'alto' })).toThrow('número');
    expect(() => conferirBloqueioPorResultado({ ...r, valor: '1;2', janelaDias: 0 })).toThrow('janela');
  });
});
