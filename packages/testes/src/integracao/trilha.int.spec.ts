// SGH_TRILHA sobre a cópia (ficha do M04, regra 9): só de inclusão para o papel da aplicação (UPDATE e
// DELETE recusados pelo banco) e a cadeia de hash fecha. A conta da aplicação de teste é efêmera: criada só
// para este teste na cópia (DP-15: em dev, contas no container do projeto), com senha aleatória que nunca é
// impressa, recebe só o papel SGH_APLICACAO e é apagada no fim. As gravações ficam em transação desfeita.
import { randomBytes } from 'node:crypto';
import { executarIsql, operacao, validarPedidoCopia, verificarCadeia } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loginLivre, usuarioSintetico } from '../massa/sintetica.js';
import {
  type Ambiente,
  codigos,
  criarNucleo,
  ctx,
  ctxOperacao,
  env,
  PODE_ESCREVER,
  prepararAmbiente,
} from './escrita.spec-util.js';

const criarUsuario = operacao('acesso.criarUsuarioIntegracao');
const CONTA = `SGH_TESTE_TRILHA_${randomBytes(3).toString('hex').toUpperCase()}`;
const SENHA = randomBytes(12).toString('base64url').slice(0, 16);

describe.skipIf(!PODE_ESCREVER)('trilha só de inclusão e cadeia de hash', () => {
  let a: Ambiente;
  beforeAll(async () => {
    a = await prepararAmbiente();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('a cadeia fecha com as linhas novas (na transação) e com as já confirmadas', async () => {
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      for (let i = 0; i < 3; i++) {
        const login = await loginLivre(e, (Date.now() + i * 101) % 1_000_000);
        await a.executor.executar(
          criarUsuario,
          a.cod,
          usuarioSintetico('usuario-tecnico', login),
          ctxOperacao(a, 'SGH.TESTE'),
          { escritor: e },
        );
      }
      return verificarCadeia(e, a.cod);
    });
    expect(r.ok).toBe(true);
    expect(r.linhas).toBeGreaterThanOrEqual(3);
    console.log(`[${a.cod}] cadeia da trilha: ${r.linhas} linha(s), fecha`);
  });

  it('com o papel da aplicação: INSERT e SELECT aceitos; UPDATE e DELETE recusados pelo banco', async () => {
    // Conta efêmera: o administrador da cópia a cria e apaga pelo isql do container (ferramenta de cópia do
    // M01, SQL pela entrada padrão; a senha nunca vai à linha de comando nem à saída).
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
          const ok = await e.executar(
            `INSERT INTO SGH_TRILHA (ID, DATA_HORA, REDE, HOSPITAL, USUARIO, EVENTO, RECURSO, OPERACAO, RESULTADO, CORRELACAO, HASH_ANTERIOR, HASH_LINHA)
             VALUES (NEXT VALUE FOR SGH_GEN_TRILHA, CURRENT_TIMESTAMP, 'teste', 'zz', 'SGH.TESTE', 'teste', 'teste', 'teste', 'teste', 'teste', ?, ?)`,
            ['f'.repeat(64), 'e'.repeat(64)],
          );
          const recusa = async (sql: string) => {
            try {
              await e.executar(sql);
              return 'aceito';
            } catch (x) {
              return /no permission|permission/i.test(String(x)) ? 'recusado' : 'outro erro';
            }
          };
          return {
            insert: ok,
            update: await recusa("UPDATE SGH_TRILHA SET RESULTADO = 'x' WHERE HOSPITAL = 'zz'"),
            delete: await recusa("DELETE FROM SGH_TRILHA WHERE HOSPITAL = 'zz'"),
          };
        });
        expect(r).toEqual({ insert: 1, update: 'recusado', delete: 'recusado' });
        console.log(`[${cod}] SGH_TRILHA com o papel da aplicação: ${JSON.stringify(r)}`);
      } finally {
        await app.encerrar();
      }
    } finally {
      await admin(`REVOKE SGH_APLICACAO FROM USER ${CONTA}`).catch(() => undefined);
      await admin(`DROP USER ${CONTA}`);
    }
  });
});
