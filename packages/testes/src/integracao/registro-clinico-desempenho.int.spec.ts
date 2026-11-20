// Desempenho do registro clínico na cópia (corretor do M22; ficha, seção 10; cap-14 §14.5): o p95 de ABRIR o
// formulário (as mesmas leituras da API, cada uma na sua transação curta: profissional, selo, rascunhos do
// paciente, último registro, atendimentos e relógio; com a representação em cache, como a API serve depois da
// primeira abertura, e a primeira, que converte o DFM) e de FINALIZAR (o executor com a prova relida, em
// transação desfeita), nos 10 modelos do escopo. Meta: abrir com p95 abaixo de 1,5 s; finalizar é medido e
// registrado. Respostas SINTÉTICAS; profissional e paciente da cópia só em memória; saída só com tempos.
import { converterModelo, respostasSinteticas } from '@sgh/dominio-pep';
import { MODELOS_ESCOPO_MINIMO } from '@sgh/contratos';
import {
  agoraDoBanco,
  atendimentosDoPaciente,
  lerDefinicaoFormulario,
  listarModelosFormulario,
  operacao,
  profissionalDoUsuario,
  rascunhosDoPaciente,
  respostasDoUltimoRegistro,
  seloDoModelo,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { atendimento, gravacaoEvolucao, modeloPronto, profissional } from '../massa/reproducao-pep.js';
import { type Ambiente, ctx, ctxOperacao, PODE_ESCREVER, prepararAmbiente } from './escrita.spec-util.js';

const REPETICOES = 5;
const META_ABRIR_MS = 1_500;

function p95(xs: readonly number[]): number {
  const o = [...xs].sort((a, b) => a - b);
  return o[Math.min(o.length - 1, Math.ceil(0.95 * o.length) - 1)] ?? 0;
}
const ms = (t0: number) => performance.now() - t0;

describe.skipIf(!PODE_ESCREVER)('desempenho do registro clínico na cópia (10 modelos)', () => {
  let a: Ambiente;
  beforeAll(async () => {
    a = await prepararAmbiente();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('abrir o formulário (p95 < 1,5 s com a representação em cache) e finalizar (com ROLLBACK)', async () => {
    const frio: number[] = [];
    const quente: number[] = [];
    const finalizar: number[] = [];
    const ler = <T>(fn: Parameters<typeof a.nucleo.lerSomente<T>>[1]) => a.nucleo.lerSomente(ctx(a), fn);
    const porModelo: string[] = [];
    for (const codigo of MODELOS_ESCOPO_MINIMO) {
      // Profissional, paciente e atendimento da cópia (só em memória).
      const base = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
        const m = await modeloPronto(e, codigo);
        return { m, prof: await profissional(e, m.id), at: await atendimento(e, 'I') };
      });
      const abrir = async (converter: boolean) => {
        const t0 = performance.now();
        await ler((l) => profissionalDoUsuario(l, base.prof.login));
        await ler((l) => seloDoModelo(l, base.m.id));
        if (converter) {
          const def = await ler(async (l) => {
            const mm = (await listarModelosFormulario(l)).find((x) => x.id === base.m.id);
            return mm ? lerDefinicaoFormulario(l, mm) : null;
          });
          if (def) await converterModelo(def);
        }
        await ler((l) => rascunhosDoPaciente(l, base.at.paciente, base.m.id, a.cod));
        await ler((l) => respostasDoUltimoRegistro(l, base.at.paciente, base.m.id));
        await ler((l) => atendimentosDoPaciente(l, base.at.paciente));
        await ler((l) => agoraDoBanco(l));
        return ms(t0);
      };
      frio.push(await abrir(true));
      const q: number[] = [];
      for (let i = 0; i < REPETICOES; i++) q.push(await abrir(false));
      quente.push(...q);
      const f: number[] = [];
      for (let i = 0; i < REPETICOES; i++)
        f.push(
          await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
            const g = await gravacaoEvolucao(
              e,
              a.cod,
              base.m,
              base.prof,
              base.at,
              respostasSinteticas(base.m.rep),
            );
            const t0 = performance.now();
            await a.executor.executar(
              operacao('pep.registrarEvolucao'),
              a.cod,
              g,
              ctxOperacao(a, base.prof.login),
              {
                escritor: e,
              },
            );
            return ms(t0);
          }),
        );
      finalizar.push(...f);
      porModelo.push(`${codigo}: abrir ${Math.round(p95(q))} ms, finalizar ${Math.round(p95(f))} ms`);
    }
    const r = {
      abrirFrio: Math.round(p95(frio)),
      abrirQuente: Math.round(p95(quente)),
      finalizar: Math.round(p95(finalizar)),
    };
    console.log(
      `[${a.cod}] p95 em ${MODELOS_ESCOPO_MINIMO.length} modelos × ${REPETICOES}: abrir ${r.abrirQuente} ms (primeira abertura, com a conversão do DFM: ${r.abrirFrio} ms); finalizar ${r.finalizar} ms`,
    );
    for (const x of porModelo) console.log(`[${a.cod}] p95 ${x}`);
    expect(r.abrirQuente).toBeLessThan(META_ABRIR_MS);
  });
});
