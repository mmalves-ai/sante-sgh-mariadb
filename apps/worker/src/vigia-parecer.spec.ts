// Vigia do parecer do outro sistema (M23, regra 10): a marca nasce no maior registro clínico na primeira execução
// (o histórico fica fora da fila); depois lê acima da marca menos a janela, inclui só o que não está na fila e não
// foi respondido, cada inclusão com a SGH_TRILHA, e a marca avança até o maior ID lido mesmo quando todos já estão
// na fila (sem travar). Ligado fora de dev/ci e, em dev/ci, só com PEP_VIGIA_PARECER=ligado.
import { describe, expect, it } from 'vitest';
import { JANELA_VIGIA_PARECER, type Leitor } from '@sgh/legado';
import {
  type NucleoVigiaParecer,
  trazerPareceresDoLegado,
  vigiaParecerLigada,
} from './vigia-parecer.service.js';

interface Pedido {
  ID: number;
  P: number;
  ATD: number | null;
  E: Date;
  C: number;
  R: number;
}

function nucleoFalso(o: {
  marca: number | null;
  semente?: number;
  maior?: number;
  pedidos: Pedido[];
  jaNaFila: number[];
}) {
  const sqls: { sql: string; p: readonly unknown[] }[] = [];
  let marca = o.marca;
  const leitor: Leitor = {
    hospital: 'pc',
    consultar: async (sql: string, p: readonly unknown[] = []) => {
      sqls.push({ sql, p });
      if (sql.includes('FROM SGH_PEP_VIGIA_MARCA'))
        return (
          p[1] === 'parecer-legado-semente'
            ? o.semente === undefined
              ? []
              : [{ M: o.semente }]
            : marca === null
              ? []
              : [{ M: marca }]
        ) as never;
      if (sql.includes('MAX(ID_CABEVOL)')) return [{ M: o.maior ?? 0 }] as never;
      if (sql.includes('FROM PRCABEVOL c')) {
        const desde = Number(p[0]);
        const teto = Number(/FIRST (\d+)/.exec(sql)?.[1]);
        return o.pedidos.filter((x) => x.ID > desde).slice(0, teto) as never;
      }
      return [] as never;
    },
    lerBlob: async (b: unknown) => b as Buffer,
  };
  let gerado = 0;
  const escritor = {
    ...leitor,
    consultar: async (sql: string, p: readonly unknown[] = []) => {
      sqls.push({ sql, p });
      if (sql.includes('SELECT ID_PRCABEVOL_PEDIDO R FROM SGH_PEP_FLUXO'))
        return o.jaNaFila.filter((x) => x >= Number(p[1]) && x <= Number(p[2])).map((R) => ({ R })) as never;
      if (sql.includes('NEXT VALUE')) return [{ ID: ++gerado }] as never;
      return [] as never;
    },
    executar: async (sql: string, p: readonly unknown[] = []) => {
      sqls.push({ sql, p });
      if (sql.startsWith('INSERT INTO SGH_PEP_VIGIA_MARCA') && p[1] === 'parecer-legado')
        marca = Number(p[2]);
      if (sql.startsWith('UPDATE SGH_PEP_VIGIA_MARCA')) {
        if (Number(p[3]) !== marca) return 0;
        marca = Number(p[0]);
      }
      return 1;
    },
  };
  const nucleo = {
    rede: 'r',
    lerSomente: (_c: unknown, fn: (l: Leitor) => Promise<unknown>) => fn(leitor),
    gravarSgh: (_c: unknown, fn: (e: typeof escritor) => Promise<unknown>) => fn(escritor),
    encerrar: async () => undefined,
  } as unknown as NucleoVigiaParecer;
  const de = (re: RegExp) => sqls.filter((s) => re.test(s.sql));
  return { nucleo, de, marca: () => marca };
}

const pedido = (ID: number, R = 0): Pedido => ({ ID, P: 1000 + ID, ATD: 10, E: new Date(), C: 7, R });

describe('vigia do parecer do outro sistema (M23)', () => {
  it('primeira execução: só semeia a marca no maior registro clínico, com a trilha (o histórico fica fora)', async () => {
    const f = nucleoFalso({ marca: null, maior: 900_000, pedidos: [pedido(10), pedido(20)], jaNaFila: [] });
    const r = await trazerPareceresDoLegado(f.nucleo, 'pc');
    expect(r).toEqual({ lidos: 0, incluidos: 0 });
    expect(f.marca()).toBe(900_000);
    expect(f.de(/INSERT INTO SGH_PEP_FLUXO/)).toHaveLength(0);
    expect(f.de(/FROM PRCABEVOL c/)).toHaveLength(0);
    const t = f.de(/INSERT INTO SGH_TRILHA/);
    expect(t).toHaveLength(1);
    expect(t[0]!.p).toContain('pep.parecer.vigiaIniciada');
  });

  it('lê acima da marca menos a janela; inclui só o novo e não respondido, com a trilha; a marca avança', async () => {
    const f = nucleoFalso({
      marca: 1000,
      pedidos: [pedido(990), pedido(1001), pedido(1002, 1), pedido(1003)],
      jaNaFila: [990, 1001],
    });
    const r = await trazerPareceresDoLegado(f.nucleo, 'pc');
    expect(f.de(/FROM PRCABEVOL c/)[0]!.p[0]).toBe(1000 - JANELA_VIGIA_PARECER);
    expect(r).toEqual({ lidos: 4, incluidos: 1 });
    const ins = f.de(/INSERT INTO SGH_PEP_FLUXO/);
    expect(ins).toHaveLength(1);
    expect(ins[0]!.p).toContain(1003);
    const t = f.de(/INSERT INTO SGH_TRILHA/);
    expect(t).toHaveLength(1);
    expect(t[0]!.p).toContain('pep.parecer.trazido');
    expect(t[0]!.p).toContain('SGH.VIGIA');
    expect(f.marca()).toBe(1003);
  });

  it('não trava: com centenas de pedidos seguidos já na fila, a marca passa por eles e chega ao seguinte', async () => {
    const proprios = Array.from({ length: 500 }, (_, i) => 2001 + i);
    const f = nucleoFalso({
      marca: 2000,
      pedidos: [...proprios.map((id) => pedido(id)), pedido(3000)],
      jaNaFila: proprios,
    });
    const r1 = await trazerPareceresDoLegado(f.nucleo, 'pc');
    expect(r1.incluidos).toBe(0);
    expect(f.marca()).toBe(2400);
    const r2 = await trazerPareceresDoLegado(f.nucleo, 'pc');
    expect(r2.incluidos).toBe(1);
    expect(f.marca()).toBe(3000);
  });

  it('a janela relida não traz o histórico abaixo da semente da primeira execução', async () => {
    const f = nucleoFalso({ marca: 1000, semente: 995, pedidos: [pedido(990), pedido(1001)], jaNaFila: [] });
    const r = await trazerPareceresDoLegado(f.nucleo, 'pc');
    expect(f.de(/FROM PRCABEVOL c/)[0]!.p[0]).toBe(995);
    expect(r.incluidos).toBe(1);
    expect(f.de(/INSERT INTO SGH_PEP_FLUXO/)[0]!.p).toContain(1001);
  });

  it('sem pedido acima da marca: nada gravado', async () => {
    const f = nucleoFalso({ marca: 5000, pedidos: [pedido(10)], jaNaFila: [] });
    expect(await trazerPareceresDoLegado(f.nucleo, 'pc')).toEqual({ lidos: 0, incluidos: 0 });
    expect(f.de(/INSERT|UPDATE/)).toHaveLength(0);
  });

  it('liga fora de dev/ci; em dev/ci só com a marca explícita', () => {
    expect(vigiaParecerLigada({ AMBIENTE: 'producao' })).toBe(true);
    expect(vigiaParecerLigada({ AMBIENTE: 'dev' })).toBe(false);
    expect(vigiaParecerLigada({ AMBIENTE: 'dev', PEP_VIGIA_PARECER: 'ligado' })).toBe(true);
    expect(vigiaParecerLigada({ AMBIENTE: 'producao', PEP_VIGIA_PARECER: 'desligado' })).toBe(false);
  });
});
