// Regra 11 (unidade): o fato chega por leitura incremental com a chave anti-duplicação (a mesma versão do fato, relida
// pela sobreposição, não gera outro evento); só o fato que um parceiro ativo assina é lido; a marca anda na mesma
// operação dos eventos; a carga leva só ids. A porta própria é dublada (o banco real fica no porta-propria.int.spec).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chaveEvento } from './porta-propria.js';

const b = vi.hoisted(() => ({
  parceiros: [] as { codigo: string; ativo: boolean; eventos: string[] }[],
  marca: { ultimoId: '0', ultimoCarimbo: null as Date | null },
  fatos: [] as {
    id: number;
    exame: number;
    carimbo: Date;
    atendimento: number | null;
    paciente: number;
    evento?: string | null;
  }[],
  outbox: new Map<string, { tipo: string; entidade: string; carga: Record<string, unknown> }>(),
  publicados: new Set<number>(),
  liberacoes: new Set<number>(),
  desdes: [] as (Date | null)[],
  lidos: 0,
}));

vi.mock('./porta-propria.js', async (original) => {
  const o = await original<typeof import('./porta-propria.js')>();
  // O mesmo contrato da consulta (OpcoesLeituraFato): ordem (carimbo, linha), o lote, o avanço pela chave composta e a
  // releitura limitada pela marca.
  const ler = async (
    _l: unknown,
    _h: string,
    desde: Date | null,
    lote: number,
    op: { depoisDoId?: number; ate?: Date } = {},
  ) => {
    b.desdes.push(desde);
    b.lidos++;
    return b.fatos
      .filter((f) => !desde || f.carimbo >= desde)
      .filter(
        (f) =>
          op.depoisDoId === undefined || !desde || f.carimbo.getTime() > desde.getTime() || f.id > op.depoisDoId,
      )
      .filter((f) => !op.ate || f.carimbo <= op.ate)
      .sort((x, y) => x.carimbo.getTime() - y.carimbo.getTime() || x.id - y.id)
      .slice(0, lote);
  };
  return {
    ...o,
    lerParceiros: async () => b.parceiros,
    lerMarcaFato: async () => b.marca,
    fatosResultadoLiberado: ler,
    fatosExameApoio: ler,
    outboxTemChave: async (_t: unknown, k: string) => b.outbox.has(k),
    fatoJaPublicado: async (_t: unknown, _tipo: string, exame: number) => b.publicados.has(exame),
    liberacaoPublicada: async (_t: unknown, exame: number) =>
      b.liberacoes.has(exame) || [...b.outbox.values()].some((x) => x.tipo === 'fato.resultado.liberado' && x.carga['exame'] === exame),
    publicarFato: async (
      _t: unknown,
      ev: { tipo: string; chave: string; entidade: string; carga: Record<string, unknown> },
    ) => {
      b.outbox.set(ev.chave, { tipo: ev.tipo, entidade: ev.entidade, carga: ev.carga });
      return b.outbox.size;
    },
    gravarMarcaFato: async (_t: unknown, _f: string, m: { ultimoId: string; ultimoCarimbo: Date | null }) => {
      b.marca = { ...m };
    },
  };
});

const { cicloVigiaFatos, proximaMarca } = await import('./vigia-fatos.js');
const acesso = {
  ler: <T>(_h: string, fn: (l: never) => Promise<T>) => fn({} as never),
  gravar: <T>(_h: string, fn: (e: never) => Promise<T>) => fn({} as never),
};

beforeEach(() => {
  b.parceiros = [];
  b.marca = { ultimoId: '0', ultimoCarimbo: null };
  b.fatos = [];
  b.outbox.clear();
  b.publicados.clear();
  b.liberacoes.clear();
  b.desdes = [];
  b.lidos = 0;
});

describe('vigia dos fatos (regra 11)', () => {
  it('sem parceiro ativo que assine, nada é lido', async () => {
    b.parceiros = [{ codigo: 'x', ativo: false, eventos: ['fato.resultado.liberado'] }];
    expect(await cicloVigiaFatos(acesso, 'pc', 100)).toEqual([]);
    expect(b.lidos).toBe(0);
  });

  it('a mesma versão relida não duplica; a versão nova do mesmo exame gera outro evento; a marca anda', async () => {
    b.parceiros = [{ codigo: 'lab', ativo: true, eventos: ['fato.resultado.liberado'] }];
    const t1 = new Date('2026-10-22T10:00:00Z');
    b.fatos = [
      { id: 10, exame: 10, carimbo: t1, atendimento: 7, paciente: 5 },
      { id: 11, exame: 11, carimbo: t1, atendimento: 8, paciente: 6 },
    ];
    const r1 = await cicloVigiaFatos(acesso, 'pc', 100);
    expect(r1).toEqual([{ fato: 'resultado.liberado', lidos: 2, eventos: 2, repetidos: 0, ignorados: 0 }]);
    expect(b.marca.ultimoCarimbo).toEqual(t1);
    // A releitura recua a sobreposição (5 s) e as já vistas não viram evento de novo.
    const r2 = await cicloVigiaFatos(acesso, 'pc', 100);
    expect(r2[0]).toMatchObject({ lidos: 2, eventos: 0, repetidos: 2 });
    expect(b.desdes.at(-1)).toEqual(new Date(t1.getTime() - 5_000));
    // O exame 10 liberado de novo (outra linha, outro carimbo): outro evento, com outra chave.
    b.fatos = [{ id: 12, exame: 10, carimbo: new Date('2026-10-22T10:05:00Z'), atendimento: 7, paciente: 5 }];
    expect((await cicloVigiaFatos(acesso, 'pc', 100))[0]).toMatchObject({ eventos: 1 });
    expect(b.outbox.size).toBe(3);
    const ev = [...b.outbox.values()][0]!;
    expect(ev).toEqual({
      tipo: 'fato.resultado.liberado',
      entidade: 'liberacao_exame',
      carga: { exame: 10, paciente: 5, atendimento: 7 },
    });
    expect(b.outbox.has(chaveEvento('fato:resultado.liberado:pc:10:20261022100000000'))).toBe(true);
  });

  it('o fato que a operação de origem já publicou não vira outro evento', async () => {
    b.parceiros = [{ codigo: 'lab', ativo: true, eventos: ['fato.resultado.liberado'] }];
    b.fatos = [{ id: 20, exame: 77, carimbo: new Date('2026-10-22T10:00:00Z'), atendimento: null, paciente: 1 }];
    b.publicados.add(77);
    expect((await cicloVigiaFatos(acesso, 'pc', 10))[0]).toMatchObject({ lidos: 1, eventos: 0, repetidos: 1 });
    expect(b.outbox.size).toBe(0);
  });

  it('mais linhas no mesmo carimbo do que o lote: a marca anda por (carimbo, linha) e todas viram evento', async () => {
    b.parceiros = [{ codigo: 'lab', ativo: true, eventos: ['fato.resultado.liberado'] }];
    const t1 = new Date('2026-10-22T11:00:00Z');
    // 25 exames liberados no mesmo segundo (o analisador em massa), lote de 10, e 3 logo depois.
    b.fatos = [
      ...Array.from({ length: 25 }, (_, i) => ({ id: 100 + i, exame: 100 + i, carimbo: t1, atendimento: 1, paciente: 2 })),
      ...Array.from({ length: 3 }, (_, i) => ({
        id: 50 + i,
        exame: 50 + i,
        carimbo: new Date(t1.getTime() + 1_000),
        atendimento: 1,
        paciente: 2,
      })),
    ];
    const marcas: string[] = [];
    for (let i = 0; i < 6; i++) {
      await cicloVigiaFatos(acesso, 'pc', 10);
      marcas.push(`${b.marca.ultimoCarimbo?.toISOString()}#${b.marca.ultimoId}`);
    }
    expect(b.outbox.size).toBe(28);
    expect(marcas.slice(0, 3)).toEqual([
      '2026-10-22T11:00:00.000Z#109',
      '2026-10-22T11:00:00.000Z#119',
      '2026-10-22T11:00:01.000Z#52',
    ]);
    // Parada no fim: a marca não recua nem anda sem linha nova.
    expect(marcas[5]).toBe('2026-10-22T11:00:01.000Z#52');
  });

  it('a releitura da sobreposição pega a gravação atrasada e não move a marca', async () => {
    b.parceiros = [{ codigo: 'lab', ativo: true, eventos: ['fato.resultado.liberado'] }];
    const t1 = new Date('2026-10-22T12:00:00Z');
    b.marca = { ultimoId: '500', ultimoCarimbo: t1 };
    // A transação gravou 2 s antes da marca e só confirmou agora.
    b.fatos = [{ id: 7, exame: 7, carimbo: new Date(t1.getTime() - 2_000), atendimento: 1, paciente: 2 }];
    expect((await cicloVigiaFatos(acesso, 'pc', 10))[0]).toMatchObject({ lidos: 1, eventos: 1 });
    expect(b.marca).toMatchObject({ ultimoId: '500', ultimoCarimbo: t1 });
  });

  it('a linha decide o evento: a superada não sai; a revogação só sai depois da liberação entregue; a marca anda', async () => {
    b.parceiros = [{ codigo: 'lab', ativo: true, eventos: ['fato.resultado.liberado'] }];
    const t1 = new Date('2026-10-22T13:00:00Z');
    b.fatos = [
      { id: 30, exame: 30, carimbo: t1, atendimento: 1, paciente: 2, evento: null },
      { id: 31, exame: 30, carimbo: new Date(t1.getTime() + 1_000), atendimento: 1, paciente: 2, evento: 'fato.resultado.revogado' },
      { id: 32, exame: 33, carimbo: new Date(t1.getTime() + 2_000), atendimento: 1, paciente: 2, evento: 'fato.resultado.revogado' },
    ];
    b.liberacoes.add(33);
    expect((await cicloVigiaFatos(acesso, 'pc', 10))[0]).toMatchObject({ lidos: 3, eventos: 1, ignorados: 2 });
    expect([...b.outbox.values()]).toEqual([
      { tipo: 'fato.resultado.revogado', entidade: 'liberacao_exame', carga: { exame: 33, paciente: 2, atendimento: 1 } },
    ]);
    expect(b.marca).toMatchObject({ ultimoId: '32' });
  });

  it('proximaMarca nunca recua', () => {
    const t = new Date('2026-10-22T12:00:00Z');
    const m = { ultimoId: '10', ultimoCarimbo: t };
    const f = (id: number, c: Date) => ({ id, exame: id, carimbo: c, atendimento: null, paciente: 0 });
    expect(proximaMarca(m, f(5, new Date(t.getTime() - 1)))).toEqual(m);
    expect(proximaMarca(m, f(9, t))).toEqual(m);
    expect(proximaMarca(m, f(11, t))).toEqual({ ultimoId: '11', ultimoCarimbo: t });
    expect(proximaMarca(m, undefined)).toEqual(m);
    expect(proximaMarca({ ultimoId: '0', ultimoCarimbo: null }, f(3, t))).toEqual({ ultimoId: '3', ultimoCarimbo: t });
  });
});
