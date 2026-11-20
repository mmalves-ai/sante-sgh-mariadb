// Vigia de mudanças sobre a cópia (ficha do M16, regra 15): uma transferência SINTÉTICA gravada "por fora" (como o
// outro sistema gravaria, numa transação desfeita) muda o selo do canal de leitos na consulta seguinte, bem abaixo
// de 2 s; depois do ROLLBACK, o selo volta ao de antes e a contagem da tabela também (a tabela não tem gatilho nem
// gerador). Os três canais leem em uma consulta por ciclo. Saída só com contagens.
import { CANAIS_VIGIA } from '@sgh/contratos';
import { lerCanal, MARCA_ZERO } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  contarTransferencias,
  gravarTransferenciaPorFora,
  internacaoAbertaParaOTeste,
} from '../massa/leitos.js';
import { moverAgendamentoParaHojePorFora } from '../massa/bloco.js';
import { type Ambiente, ctx, PODE_ESCREVER, prepararAmbiente } from './escrita.spec-util.js';

describe.skipIf(!PODE_ESCREVER)('vigia de mudanças na cópia', () => {
  let a: Ambiente;
  beforeAll(async () => {
    a = await prepararAmbiente();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('uma consulta por canal e ciclo; o segundo ciclo, com a marca, é leve', async () => {
    for (const canal of CANAIS_VIGIA) {
      const r = await a.nucleo.lerSomente(ctx(a), async (l) => {
        const i0 = performance.now();
        const p = await lerCanal(l, canal, MARCA_ZERO);
        const t1 = Math.round(performance.now() - i0);
        const i1 = performance.now();
        const s = await lerCanal(l, canal, p.marca);
        return {
          t1,
          t2: Math.round(performance.now() - i1),
          c1: p.consultas,
          c2: s.consultas,
          s1: p.selo,
          s2: s.selo,
        };
      });
      console.log(
        `[${a.cod}] canal ${canal}: ciclo inicial ${r.t1} ms (${r.c1} consulta(s)); ciclo com a marca ${r.t2} ms (${r.c2})`,
      );
      expect(r.c2).toBe(1);
      expect(r.t2).toBeLessThan(500);
      // O ciclo inicial também é leve: nos canais de movimento grande, o maior ID vem do gerador (sem ler a tabela).
      expect(r.t1).toBeLessThan(2_000);
      // Sem gravação entre os dois ciclos, o selo do ciclo inicial (marca zero) é o mesmo do seguinte: o
      // recomeço da marca não gera aviso falso (o recorte das transferências sai da própria consulta).
      if (canal === 'leitos') expect(r.s2).toBe(r.s1);
    }
  });

  it('a transferência gravada por fora aparece no ciclo seguinte (< 2 s) e some com o ROLLBACK', async () => {
    const base = await a.nucleo.lerSomente(ctx(a), async (l) => {
      const p = await lerCanal(l, 'leitos', MARCA_ZERO);
      const s = await lerCanal(l, 'leitos', p.marca);
      return {
        marca: s.marca,
        selo: s.selo,
        n: await contarTransferencias(l),
        aberta: await internacaoAbertaParaOTeste(l),
      };
    });
    expect(base.aberta).toBeTruthy();
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const t0 = performance.now();
      // A gravação por fora (sintética, marcada na justificativa): uma transferência da internação em aberto.
      await gravarTransferenciaPorFora(e, base.aberta!);
      const s = await lerCanal(e, 'leitos', base.marca);
      return { mudou: s.selo !== base.selo, ms: Math.round(performance.now() - t0) };
    });
    expect(r.mudou).toBe(true);
    expect(r.ms).toBeLessThan(2_000);
    const depois = await a.nucleo.lerSomente(ctx(a), async (l) => {
      const s = await lerCanal(l, 'leitos', base.marca);
      return { selo: s.selo, n: await contarTransferencias(l) };
    });
    expect(depois).toEqual({ selo: base.selo, n: base.n });
    console.log(`[${a.cod}] por fora: o selo mudou em ${r.ms} ms; depois do ROLLBACK, igual ao de antes`);
  });

  it('duas conexões: a gravação por fora ainda sem COMMIT não aparece no ciclo do vigia, que abre transação nova', async () => {
    // O ciclo do vigia (como o laço da API: fonte → núcleo.lerSomente) abre uma transação NOVA a cada vez, noutra
    // conexão do pool; a gravação por fora fica aberta, sem COMMIT, na conexão reservada da escrita desfeita.
    const ciclo = (m: typeof MARCA_ZERO) =>
      a.nucleo.lerSomente(ctx(a), async (l) => {
        const i = performance.now();
        const r = await lerCanal(l, 'leitos', m);
        return { ...r, ms: Math.round(performance.now() - i) };
      });
    const c0 = await ciclo(MARCA_ZERO);
    const base = await ciclo(c0.marca);
    expect(base.selo).toBe(c0.selo);
    const aberta = await a.nucleo.lerSomente(ctx(a), (l) => internacaoAbertaParaOTeste(l));
    expect(aberta).toBeTruthy();
    const durante = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      await gravarTransferenciaPorFora(e, aberta!);
      // Na própria transação a linha existe (o selo dela muda) ...
      const propria = await lerCanal(e, 'leitos', base.marca);
      // ... e nos ciclos do vigia, noutra conexão, não (sem COMMIT, nada a avisar), sem esperar trava.
      const ciclos = [];
      for (let k = 0; k < 3; k++) ciclos.push(await ciclo(base.marca));
      return { propria: propria.selo, ciclos };
    });
    expect(durante.propria).not.toBe(base.selo);
    for (const c of durante.ciclos) {
      expect(c.selo).toBe(base.selo);
      expect(c.ms).toBeLessThan(2_000);
    }
    const depois = await ciclo(base.marca);
    expect(depois.selo).toBe(base.selo);
    console.log(
      `[${a.cod}] duas conexões: ${durante.ciclos.length} ciclos do vigia durante a gravação sem COMMIT, selo igual (até ${Math.max(...durante.ciclos.map((c) => c.ms))} ms por ciclo); depois do ROLLBACK, igual`,
    );
  });

  it('bloco: o agendamento movido para hoje por fora (como o outro sistema) muda o selo no ciclo seguinte e some com o ROLLBACK', async () => {
    const ciclo = () => a.nucleo.lerSomente(ctx(a), (l) => lerCanal(l, 'bloco', MARCA_ZERO));
    const base = await ciclo();
    expect((await ciclo()).selo).toBe(base.selo);
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const t0 = performance.now();
      // Só a hora de início de um agendamento passado muda (para hoje, 23:59), numa transação desfeita: nada de
      // pessoa é lido ou impresso.
      expect(await moverAgendamentoParaHojePorFora(e)).toBe(true);
      const s = await lerCanal(e, 'bloco', MARCA_ZERO);
      return { mudou: s.selo !== base.selo, ms: Math.round(performance.now() - t0) };
    });
    expect(r.mudou).toBe(true);
    expect(r.ms).toBeLessThan(2_000);
    expect((await ciclo()).selo).toBe(base.selo);
    console.log(
      `[${a.cod}] bloco por fora: o selo mudou em ${r.ms} ms; depois do ROLLBACK, igual ao de antes`,
    );
  });
});
