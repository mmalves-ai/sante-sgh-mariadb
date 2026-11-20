// Regra 11 do M53 na cópia (M53.9, etapa F8), numa transação DESFEITA: o lançamento dos títulos da folha sintética grava,
// na mesma transação, o evento do custo de pessoal na SGH_OUTBOX (um por lançamento, chave natural pelo lançamento, carga
// só com IDs e códigos, pendente de publicação) e os fatos por centro de custo de onde o consumidor (M54) lê o custo do
// período: proventos mais encargos da empresa por centro, a soma dos centros igual ao total dos fatos (parcelas impressas
// no teste). Só IDs, contagens e valores sintéticos; nenhum dado pessoal.
import { EVENTO_CUSTO_PESSOAL_FOLHA } from '@sgh/contratos';
import { chaveEvento } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AmbienteM27, ambienteM27, PODE_ESCREVER } from '../../acesso/aplicacao/copia.spec-util.js';
import {
  cenarioTitulosFolha,
  lancarFolhaSintetica,
  PERIODO_SINTETICO,
} from '../aplicacao/titulos-folha.spec-util.js';

describe.skipIf(!PODE_ESCREVER)('custo de pessoal pela outbox (cópia, transação desfeita)', () => {
  let a: AmbienteM27;
  beforeAll(async () => {
    a = await ambienteM27();
  }, 900_000);
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('o lançamento publica o evento do custo de pessoal e o custo por centro sai dos fatos', async () => {
    await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-m539-outbox' }, async (e) => {
      const x = await cenarioTitulosFolha(a, e);
      const r = await (await lancarFolhaSintetica(x)).lancar();
      const id = r.lancamento.id;
      const ev = await e.consultar(
        `SELECT TIPO, HOSPITAL, CARGA, SITUACAO, PUBLICADO_EM FROM SGH_OUTBOX WHERE CHAVE_EVENTO = ?`,
        [chaveEvento(`${EVENTO_CUSTO_PESSOAL_FOLHA}:${a.c.hospital}:${id}`)],
        { teto: 2 },
      );
      expect(ev).toHaveLength(1);
      expect(String(ev[0]?.['TIPO']).trim()).toBe(EVENTO_CUSTO_PESSOAL_FOLHA);
      expect(String(ev[0]?.['HOSPITAL']).trim()).toBe(a.c.hospital);
      expect(String(ev[0]?.['SITUACAO']).trim()).toBe('pendente');
      expect(ev[0]?.['PUBLICADO_EM'] ?? null).toBeNull();
      // A carga leva só IDs e códigos (nada de valor nem de pessoa): o M54 relê o custo nos fatos.
      const carga = JSON.parse(String(ev[0]?.['CARGA'])) as Record<string, unknown>;
      expect(carga).toEqual({ lancamento: id, empresa: 1, periodo: PERIODO_SINTETICO, apuracao: 'mensal' });
      // O custo do período por centro: centro 1 = 3.120,00 + 240,00; centro 2 = 2.080,00 + 160,00.
      const c = await x.servico.custo(x.sessao(), { empresa: 1, periodo: PERIODO_SINTETICO });
      expect(c.lancamentos).toBe(1);
      expect(c.centros.map((k) => [k.centroCusto, k.proventos, k.encargos, k.total])).toEqual([
        [x.centros[0], 312_000, 24_000, 336_000],
        [x.centros[1], 208_000, 16_000, 224_000],
      ]);
      expect(c.total).toBe(336_000 + 224_000);
      const [f] = await e.consultar(
        `SELECT COUNT(*) N, SUM(VALOR_CENTAVOS) V FROM SGH_PES_FOLHA_FATO
          WHERE ID_LANCAMENTO = CAST(CAST(? AS VARCHAR(20)) AS BIGINT)`,
        [String(id)],
        { teto: 1 },
      );
      expect(Number(f?.['N'])).toBe(r.lancamento.fatos);
      expect(Number(f?.['V'])).toBe(c.total);
    });
  }, 600_000);
});
