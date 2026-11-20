// M60, etapa 1 (migração) na CÓPIA compartilhada, sob a trava da cópia: só leitura e uma transação SEMPRE
// desfeita (ROLLBACK, desfazendoNaCopia). (1) A simulação lê o plano sem gravar; (2) o catálogo SGH_ do banco
// lido pelo recolhimento: nada de fora do SGH_ depende de objeto SGH_ e o plano de recolhimento passa na
// conferência (o plano NUNCA é executado aqui: o recolhimento real é só na cópia limpa do ensaio); (3) o
// Firebird aceita o DDL de um script e o INSERT do registro em SGH_VERSAO_SCRIPT na MESMA transação (a base
// da aplicação retomável). Saída só com contagens.
import { resolve } from 'node:path';
import { lerObjetosSgh, lerScriptsSgh, planejarRecolhimento, TABELA_VERSAO } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Ambiente, ctx, PODE_ESCREVER, prepararAmbiente, raiz } from './escrita.spec-util.js';

describe.skipIf(!PODE_ESCREVER)(
  'M60.1: simulação, catálogo do recolhimento e registro na transação do DDL',
  () => {
    let a: Ambiente;
    beforeAll(async () => {
      a = await prepararAmbiente();
    });
    afterAll(async () => {
      await a?.nucleo.encerrar();
    });

    it('simular: nada a aplicar nem bloqueio na cópia já aplicada; nada gravado', async () => {
      const scripts = lerScriptsSgh(resolve(raiz, 'packages/legado/src'));
      const r = await a.nucleo.simularScriptsSgh(a.cod, scripts, {
        ambiente: 'dev',
        aceitarDeOutrosRamos: true,
      });
      expect(r.bloqueios).toHaveLength(0);
      expect(r.pendentes).toHaveLength(0);
      expect(r.jaAplicados).toBe(scripts.length);
      console.log(`[${a.cod}] simular: ${r.pendentes.length} pendente(s); ${r.jaAplicados} já registrados`);
    });

    it('catálogo SGH_: nenhum dependente de fora; o plano de recolhimento passa na conferência', async () => {
      const o = await a.nucleo.lerSomente(ctx(a), (l) => lerObjetosSgh(l));
      expect(o.dependentesDeFora).toEqual([]);
      expect(o.tabelas).toContain(TABELA_VERSAO);
      expect(o.papeis).toContain('SGH_APLICACAO');
      const plano = planejarRecolhimento(o);
      expect(plano.at(-1)).toBe('DROP ROLE SGH_APLICACAO');
      expect(plano.filter((c) => c.startsWith('DROP TABLE')).at(-1)).toBe('DROP TABLE SGH_VERSAO_SCRIPT');
      console.log(
        `[${a.cod}] recolhimento (só o plano): ${o.tabelas.length} tabela(s), ${o.visoes.length} visão(ões), ` +
          `${o.chavesEstrangeiras.length} FK, ${o.sequencias.length} sequência(s), ${o.papeis.length} papel(éis); ${plano.length} comando(s)`,
      );
    });

    it('DDL e registro em SGH_VERSAO_SCRIPT na mesma transação (desfeita)', async () => {
      const n = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
        await e.executar('CREATE TABLE SGH_M60_PROVA_TX (ID INTEGER NOT NULL)');
        await e.executar('GRANT SELECT ON SGH_M60_PROVA_TX TO ROLE SGH_APLICACAO');
        return e.executar(
          `INSERT INTO SGH_VERSAO_SCRIPT (NUMERO, ARQUIVO, DESCRICAO, HASH_SHA256, AMBIENTE, CONTA)
         VALUES (?, ?, ?, ?, ?, CURRENT_USER)`,
          [9999, 'prova/sgh/9999_prova_tx.sql', 'prova tx', '0'.repeat(64), 'dev'],
        );
      });
      expect(n).toBe(1);
      const [x] = await a.nucleo.consultar(
        ctx(a),
        `SELECT (SELECT COUNT(*) FROM RDB$RELATIONS WHERE RDB$RELATION_NAME = 'SGH_M60_PROVA_TX') T,
              (SELECT COUNT(*) FROM ${TABELA_VERSAO} WHERE NUMERO = 9999) R FROM RDB$DATABASE`,
      );
      expect([Number(x?.['T']), Number(x?.['R'])]).toEqual([0, 0]);
    });
  },
);
