// M58 (etapa 2, ensaio do Firebird 5) sobre a cópia de origem (Firebird 3), sob a trava da cópia: as leituras do ensaio
// rodam READ ONLY no schema real e valem nos dois motores (a mesma consulta roda depois na restaurada). Só estrutura e
// contagens; a contagem por tabela aqui é só de tabelas do catálogo SGH_ pequenas (a contagem inteira é do ensaio, no
// script de infra/firebird/fase7/ensaio-firebird5). Saída só com números (abaixo de 5 vira <5).
import { FUNCOES_EXTERNAS_ESPERADAS, PREFIXOS_VISOES_PARCEIROS } from '@sgh/contratos';
import { compararContagens } from '@sgh/dominio-config';
import {
  contarLinhasTabelas,
  lerConfiguracaoServidor,
  lerObjetosCompilados,
  lerSessaoDriver,
  lerUsoFuncoesExternas,
  listarTabelasUsuario,
  provarFuncaoExterna,
  provarVisoesParceiros,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Ambiente, ctx, PODE_ESCREVER, prepararAmbiente } from './escrita.spec-util.js';

const menos5 = (n: number) => (n > 0 && n < 5 ? '<5' : String(n));

describe.skipIf(!PODE_ESCREVER)('M58 (etapa 2): leituras do ensaio do Firebird 5 na cópia de origem', () => {
  let a: Ambiente;
  beforeAll(async () => {
    a = await prepararAmbiente();
  }, 120_000);
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it(
    'tabelas, objetos compilados, funções externas, sessão do adaptador e parceiros (READ ONLY)',
    async () => {
      const t0 = performance.now();
      const r = await a.nucleo.lerSomente(ctx(a), async (l) => {
        const tabelas = await listarTabelasUsuario(l);
        const pequenas = tabelas.filter((t) => t.startsWith('SGH_CFG_')).slice(0, 5);
        const contagens = await contarLinhasTabelas(l, pequenas, { tempoMaximoPorTabelaMs: 30_000 });
        const uso = await lerUsoFuncoesExternas(l);
        const provas = [];
        for (const f of uso) provas.push(await provarFuncaoExterna(l, f.nome));
        return {
          tabelas,
          contagens,
          objetos: await lerObjetosCompilados(l),
          uso,
          provas,
          sessao: await lerSessaoDriver(l),
          udf: await lerConfiguracaoServidor(l, 'UdfAccess'),
          parceiros: await provarVisoesParceiros(l, PREFIXOS_VISOES_PARCEIROS),
        };
      });
      const ms = Math.round(performance.now() - t0);
      const cmp = compararContagens(r.contagens, r.contagens);
      console.log(
        JSON.stringify({
          tabelas: r.tabelas.length,
          contadas: Object.keys(r.contagens).length,
          gatilhos: r.objetos.gatilhos,
          procedures: r.objetos.procedures,
          invalidos: menos5(r.objetos.invalidos.length),
          funcoes: r.uso.map((u) => `${u.nome}:${u.dependentes}/${u.dependentesValidos}`),
          provas: r.provas.map((p) => `${p.nome}:${p.chamadaOk}:${p.codigo ?? '-'}`),
          sessao: r.sessao,
          udf: r.udf,
          parceiros: r.parceiros.map((p) => `${p.prefixo}:${p.lidosSemErro}/${p.objetos}`),
          ms,
        }),
      );
      // O catálogo da cópia pc (BRIEF §3): 3.756 tabelas do outro sistema, mais as SGH_; 2.538 gatilhos e 181 procedures
      // do outro sistema, mais os das SGH_.
      expect(r.tabelas.length).toBeGreaterThanOrEqual(3700);
      expect(r.objetos.gatilhos).toBeGreaterThanOrEqual(2538);
      expect(r.objetos.procedures).toBeGreaterThanOrEqual(181);
      expect(cmp.diferentes).toEqual([]);
      // As 5 funções externas medidas no preparo, e só elas.
      expect(r.uso.map((u) => u.nome).sort()).toEqual(FUNCOES_EXTERNAS_ESPERADAS.map((f) => f.nome).sort());
      // No Firebird 3 da cópia as de ib_udf respondem; a do fornecedor não tem biblioteca (README do banco-dev).
      for (const p of r.provas.filter((x) => x.nome !== 'VLR_MED')) expect(p.chamadaOk, p.nome).toBe(true);
      expect(r.provas.find((x) => x.nome === 'VLR_MED')?.chamadaOk).not.toBe(true);
      expect(r.sessao.versaoMotor.startsWith('3.0')).toBe(true);
      expect(r.udf).toBeNull(); // RDB$CONFIG não existe no Firebird 3
      expect(r.parceiros.map((p) => p.prefixo)).toEqual([...PREFIXOS_VISOES_PARCEIROS]);
      expect(ms).toBeLessThan(10 * 60_000);
    },
    15 * 60_000,
  );
});
