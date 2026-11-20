// M44 (correção da revisão), sobre a cópia (transação DESFEITA): os sinais recentes da fila de classificação lidos em
// lote pelo índice SGH_IDX_PEP_SINAL_ATEND (0442), com um volume SINTÉTICO de sinais semeado (pacientes e atendimentos
// de faixa fora do cadastro, IDs negativos que não gastam o gerador) e desfeito no fim. Mede a leitura por lote dos 200
// atendimentos que a fila pode ter e a leitura antiga, uma por atendimento, sobre o mesmo volume. Só contagens e tempos.
import { sinaisRecentesDoAtendimento, sinaisRecentesDosAtendimentos } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AmbienteM27, ambienteM27, PODE_ESCREVER } from '../../acesso/aplicacao/copia.spec-util.js';

const VOLUME = 30_000;
const ATENDIMENTOS = 3_000;
const BASE = 1_990_000_000;

describe.skipIf(!PODE_ESCREVER)('sinais recentes da fila na cópia (transação desfeita)', () => {
  let a: AmbienteM27;
  beforeAll(async () => {
    a = await ambienteM27();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('a fila de 200 lê os sinais em 2 consultas pelo índice do atendimento, sobre 30 mil sinais semeados', async () => {
    const r = await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-m44-sinais' }, async (e) => {
      const [ix] = await e.consultar(
        "SELECT COUNT(*) N FROM RDB$INDICES WHERE RDB$INDEX_NAME = 'SGH_IDX_PEP_SINAL_ATEND'",
        [],
        { teto: 1 },
      );
      await e.executar(
        `EXECUTE BLOCK AS DECLARE i INTEGER = 0; BEGIN
           WHILE (i < ${VOLUME}) DO BEGIN
             INSERT INTO SGH_PEP_SINAL_VITAL (ID, HOSPITAL, ID_RICADPAC, ID_ATCABECATEND, TIPO, VALOR, UNIDADE, HORA_REAL, USUARIO)
             VALUES (-9000000000 - :i, '${a.cod}', ${BASE} + MOD(:i, 900), ${BASE} + MOD(:i, ${ATENDIMENTOS}),
                     IIF(MOD(:i, 2) = 0, 'fc', 'dor'), MOD(:i, 10), 'x', DATEADD(-MOD(:i, 2880) MINUTE TO CURRENT_TIMESTAMP), 'SGH.M44');
             i = i + 1;
           END
         END`,
      );
      const desde = new Date('2000-01-01T00:00:00Z');
      const itens = Array.from({ length: 200 }, (_, i) => ({ atendimento: BASE + i * 7, desde }));
      let t = performance.now();
      const lote = await sinaisRecentesDosAtendimentos(e, a.cod, itens);
      const msLote = Math.round(performance.now() - t);
      t = performance.now();
      let um = 0;
      for (const i of itens) if (await sinaisRecentesDoAtendimento(e, a.cod, i.atendimento, i.desde)) um++;
      const msUm = Math.round(performance.now() - t);
      return { indice: Number(ix?.['N'] ?? 0), comSinais: lote.size, um, msLote, msUm };
    });
    console.log(
      `[${a.cod}] sinais da fila: ${VOLUME} semeados; 200 atendimentos em lote ${r.msLote} ms (${r.comSinais} com sinais); um por um ${r.msUm} ms; desfeito`,
    );
    expect(r.indice).toBe(1);
    expect(r.comSinais).toBe(r.um);
    expect(r.msLote).toBeLessThan(5_000);
    // Depois do ROLLBACK, nada ficou.
    const depois = await a.nucleo.lerSomente({ ...a.c, traceId: 'int-m44-sinais' }, (l) =>
      l.consultar('SELECT COUNT(*) N FROM SGH_PEP_SINAL_VITAL WHERE ID <= -9000000000', [], { teto: 1 }),
    );
    expect(Number(depois[0]?.['N'] ?? -1)).toBe(0);
  });
});
