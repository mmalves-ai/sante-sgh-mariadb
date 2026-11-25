import { describe, expect, it } from 'vitest';
import {
  conferirMudancaPrioridade,
  diasDeEspera,
  diferencaPlano,
  ordenarFilaEspera,
  planoEditavel,
  validarPlanoPreInternacao,
} from './pre-internacao-plano.js';

const proc = (item: number, principal = false, incluirNaGuia = true) => ({
  item,
  quantidade: 1,
  principal,
  viaAcesso: null,
  incluirNaGuia,
});

describe('plano da pré-internação (C2-048)', () => {
  it('sem marcação, o primeiro procedimento vira o principal e entra na guia', () => {
    const r = validarPlanoPreInternacao(
      { procedimentos: [proc(1, false, false), proc(2)], materiais: [], equipe: [] },
      'solicitado',
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.valor.procedimentos[0]).toMatchObject({ principal: true, incluirNaGuia: true });
      expect(r.valor.procedimentos[1]!.principal).toBe(false);
    }
  });

  it('recusa dois principais, item repetido, quantidade zero e principal fora da guia', () => {
    const r = validarPlanoPreInternacao(
      {
        procedimentos: [proc(1, true), proc(1, true), { ...proc(3), quantidade: 0 }],
        materiais: [],
        equipe: [],
      },
      'em_espera',
    );
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.problemas.map((p) => p.campo)).toEqual([
        'procedimentos.1.item',
        'procedimentos.2.quantidade',
        'procedimentos',
      ]);
    const fora = validarPlanoPreInternacao(
      { procedimentos: [proc(1, true, false)], materiais: [], equipe: [] },
      'autorizado',
    );
    expect(fora.ok).toBe(false);
  });

  it('recusa material repetido ou sem quantidade e o mesmo profissional duas vezes na mesma função', () => {
    const r = validarPlanoPreInternacao(
      {
        procedimentos: [],
        materiais: [
          { insumo: 5, quantidade: 2, fornecedor: null, observacao: '  opme  ' },
          { insumo: 5, quantidade: -1, fornecedor: null, observacao: null },
        ],
        equipe: [
          { profissional: 7, funcao: 1 },
          { profissional: 7, funcao: 2 },
          { profissional: 7, funcao: 1 },
        ],
      },
      'confirmado',
    );
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.problemas.map((p) => p.campo)).toEqual([
        'materiais.1.quantidade',
        'materiais.1.insumo',
        'equipe.2.profissional',
      ]);
    const ok = validarPlanoPreInternacao(
      {
        procedimentos: [],
        materiais: [{ insumo: 5, quantidade: 2, fornecedor: null, observacao: '  opme  ' }],
        equipe: [{ profissional: 7, funcao: 1 }],
      },
      'confirmado',
    );
    expect(ok.ok && ok.valor.materiais[0]!.observacao).toBe('opme');
  });

  it('o plano de pré-internação internada, cancelada ou com falta é histórico', () => {
    expect(planoEditavel('em_espera')).toBe(true);
    for (const s of ['internado', 'cancelado', 'nao_compareceu']) {
      expect(planoEditavel(s)).toBe(false);
      const r = validarPlanoPreInternacao({ procedimentos: [], materiais: [], equipe: [] }, s);
      expect(r.ok).toBe(false);
    }
  });

  it('limita cada lista a 30 linhas', () => {
    const r = validarPlanoPreInternacao(
      {
        procedimentos: [],
        materiais: [],
        equipe: Array.from({ length: 31 }, (_, i) => ({ profissional: i + 1, funcao: 1 })),
      },
      'solicitado',
    );
    expect(r.ok).toBe(false);
  });

  it('a diferença mantém, revive, inclui no fim da sequência e remove sem apagar', () => {
    const d = diferencaPlano(
      [
        { id: 10, chave: 'a', sequencia: 1, vigente: true, versao: 1 },
        { id: 11, chave: 'b', sequencia: 2, vigente: true, versao: 3 },
        { id: 12, chave: 'c', sequencia: 3, vigente: false, versao: 2 },
      ],
      ['a', 'c', 'd'],
      (v) => v,
    );
    expect(d.manter).toEqual([
      { id: 10, versao: 1, valor: 'a' },
      { id: 12, versao: 2, valor: 'c' },
    ]);
    expect(d.incluir).toEqual([{ valor: 'd', sequencia: 4 }]);
    expect(d.remover).toEqual([{ id: 11, versao: 3 }]);
  });
});

describe('fila de espera eletiva (C2-048)', () => {
  it('ordena pela prioridade clínica, depois pela data do pedido, depois pelo agendamento', () => {
    const f = ordenarFilaEspera([
      { id: 1, prioridade: 'normal', solicitadoEm: '2026-11-01T10:00:00Z' },
      { id: 2, prioridade: 'prioritaria', solicitadoEm: '2026-11-10T10:00:00Z' },
      { id: 3, prioridade: 'urgente', solicitadoEm: '2026-11-20T10:00:00Z' },
      { id: 5, prioridade: 'normal', solicitadoEm: '2026-10-01T10:00:00Z' },
      { id: 4, prioridade: 'normal', solicitadoEm: '2026-10-01T10:00:00Z' },
    ]);
    expect(f.map((x) => [x.id, x.posicao])).toEqual([
      [3, 1],
      [2, 2],
      [4, 3],
      [5, 4],
      [1, 5],
    ]);
  });

  it('conta os dias de espera, nunca negativos', () => {
    const agora = new Date('2026-11-25T12:00:00Z');
    expect(diasDeEspera('2026-11-20T13:00:00Z', agora)).toBe(4);
    expect(diasDeEspera('2026-11-26T13:00:00Z', agora)).toBe(0);
  });

  it('a mudança de prioridade só na fila, para outra prioridade e com justificativa', () => {
    expect(
      conferirMudancaPrioridade({
        situacao: 'em_espera',
        atual: 'normal',
        nova: 'urgente',
        justificativa: '  piora clínica relatada  ',
      }),
    ).toEqual({ ok: true, justificativa: 'piora clínica relatada' });
    const r = conferirMudancaPrioridade({
      situacao: 'solicitado',
      atual: 'normal',
      nova: 'normal',
      justificativa: 'curta',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problemas.map((p) => p.campo)).toEqual(['situacao', 'prioridade', 'justificativa']);
  });
});
