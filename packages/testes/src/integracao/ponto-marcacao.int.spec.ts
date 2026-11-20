// Regra 11 do M52 (M52.4) sobre a cópia: a marcação original nunca é alterada. Com o papel da aplicação, INSERT e SELECT
// em SGH_PES_MARCACAO (e no arquivo do relógio, na trilha do período e no banco de horas) são aceitos; UPDATE e DELETE
// são recusados PELO BANCO (o privilégio do script 0986 a 0989). A conta da aplicação de teste é efêmera, como a do teste
// da trilha (M04): criada só para este teste na cópia, com senha aleatória que nunca é impressa, recebe só o papel
// SGH_APLICACAO e é apagada no fim. As gravações ficam em transação desfeita; o HMAC é de mentira.
import { randomBytes } from 'node:crypto';
import { executarIsql, validarPedidoCopia } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Ambiente,
  codigos,
  criarNucleo,
  ctx,
  env,
  PODE_ESCREVER,
  prepararAmbiente,
} from './escrita.spec-util.js';

const CONTA = `SGH_TESTE_PONTO_${randomBytes(3).toString('hex').toUpperCase()}`;
const SENHA = randomBytes(12).toString('base64url').slice(0, 16);

describe.skipIf(!PODE_ESCREVER)('ponto: marcação original só de inclusão (regra 11)', () => {
  let a: Ambiente;
  beforeAll(async () => {
    a = await prepararAmbiente();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('com o papel da aplicação: INSERT e SELECT aceitos; UPDATE e DELETE recusados pelo banco', async () => {
    const alvo = validarPedidoCopia({ hospital: a.cod, destino: 'dev' }, env);
    const admin = async (sql: string) => {
      const r = executarIsql(alvo.container, alvo.banco, `${sql};\nCOMMIT;\n`);
      if (r.codigo !== 0) throw new Error(`isql: ${r.erro}`);
    };
    await admin(`CREATE USER ${CONTA} PASSWORD '${SENHA}'`);
    try {
      await admin(`GRANT SGH_APLICACAO TO USER ${CONTA}`);
      const cod = codigos[0] as string;
      const app = criarNucleo({
        [`FB_${cod.toUpperCase()}_USUARIO`]: CONTA,
        [`FB_${cod.toUpperCase()}_SENHA`]: SENHA,
        FB_POOL_TETO: '1',
      });
      try {
        const r = await app.desfazendoNaCopia(ctx(a), async (e) => {
          const recusa = async (sql: string) => {
            try {
              await e.executar(sql);
              return 'aceito';
            } catch (x) {
              return /no permission|permission/i.test(String(x))
                ? 'recusado'
                : `outro erro: ${String(x).slice(0, 80)}`;
            }
          };
          const hash = randomBytes(32).toString('hex');
          const arquivo = await e.executar(
            `INSERT INTO SGH_PES_AFD_ARQUIVO (ID, HOSPITAL, NOME, HASH_SHA256, TAMANHO, TIPO_REP, NUMERO_REP, MARCACOES, NOVAS,
               SITUACAO, IMPORTADO_POR)
             VALUES (NEXT VALUE FOR SGH_GEN_PES_AFD_ARQUIVO, 'zz', 'teste', ?, 1, 'REP-C', 'TESTE-PRIV', 1, 1, 'importado', 'SGH.TESTE')`,
            [hash],
          );
          const marcacao = await e.executar(
            `INSERT INTO SGH_PES_MARCACAO (ID, HOSPITAL, ID_AFD_ARQUIVO, NUMERO_REP, NSR, TIPO_REGISTRO, MARCADA_EM, FUSO, CPF_HMAC)
             SELECT NEXT VALUE FOR SGH_GEN_PES_MARCACAO, 'zz', ID, 'TESTE-PRIV', 1, 3, CURRENT_TIMESTAMP, '-0300', ?
               FROM SGH_PES_AFD_ARQUIVO WHERE HASH_SHA256 = ?`,
            ['f'.repeat(64), hash],
          );
          const [lida] = await e.consultar(
            "SELECT COUNT(*) N FROM SGH_PES_MARCACAO WHERE HOSPITAL = 'zz' AND NUMERO_REP = 'TESTE-PRIV'",
            [],
            { teto: 1 },
          );
          return {
            insert: { arquivo, marcacao },
            select: Number(lida?.['N'] ?? 0),
            marcacao: {
              update: await recusa(
                "UPDATE SGH_PES_MARCACAO SET MARCADA_EM = CURRENT_TIMESTAMP WHERE HOSPITAL = 'zz'",
              ),
              delete: await recusa("DELETE FROM SGH_PES_MARCACAO WHERE HOSPITAL = 'zz'"),
            },
            arquivo: {
              update: await recusa("UPDATE SGH_PES_AFD_ARQUIVO SET NOME = 'x' WHERE HOSPITAL = 'zz'"),
              delete: await recusa("DELETE FROM SGH_PES_AFD_ARQUIVO WHERE HOSPITAL = 'zz'"),
            },
            periodo: {
              update: await recusa("UPDATE SGH_PES_PONTO_FECHAMENTO SET TEXTO = 'x' WHERE HOSPITAL = 'zz'"),
              delete: await recusa("DELETE FROM SGH_PES_PONTO_FECHAMENTO WHERE HOSPITAL = 'zz'"),
            },
            banco: {
              update: await recusa("UPDATE SGH_PES_BANCO_HORAS SET MINUTOS = 1 WHERE HOSPITAL = 'zz'"),
              delete: await recusa("DELETE FROM SGH_PES_BANCO_HORAS WHERE HOSPITAL = 'zz'"),
            },
            ajuste: { delete: await recusa("DELETE FROM SGH_PES_PONTO_AJUSTE WHERE HOSPITAL = 'zz'") },
          };
        });
        const recusado = { update: 'recusado', delete: 'recusado' };
        expect(r).toEqual({
          insert: { arquivo: 1, marcacao: 1 },
          select: 1,
          marcacao: recusado,
          arquivo: recusado,
          periodo: recusado,
          banco: recusado,
          ajuste: { delete: 'recusado' },
        });
        console.log(`[${cod}] ponto com o papel da aplicação: ${JSON.stringify(r)}`);
      } finally {
        await app.encerrar();
      }
    } finally {
      await admin(`REVOKE SGH_APLICACAO FROM USER ${CONTA}`).catch(() => undefined);
      await admin(`DROP USER ${CONTA}`);
    }
  });
});
