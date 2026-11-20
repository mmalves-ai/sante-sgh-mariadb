// Trilha dupla e cadeia de hash na cópia (ficha do M06, regra 10 e seção 10): (1) a operação do M04
// (cadastro.cadastrarPaciente) grava TBCABTRILHA/TBLANTRILHASGH e SGH_TRILHA na MESMA transação e, desfeita,
// as duas trilhas somem juntas; (2) a cadeia fecha por dia e um evento alterado a quebra; (3) com o papel da
// aplicação, UPDATE e DELETE em SGH_TRILHA são recusados pelo banco. Massa sintética; tudo desfeito; conta
// da aplicação efêmera (senha aleatória nunca impressa).
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import {
  carregarDominiosVistos,
  executarIsql,
  gravarTrilha,
  operacao,
  validarPedidoCopia,
  verificarCadeia,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cepCompleto,
  cpfLivre,
  loginLivre,
  pacienteSintetico,
  papelSintetico,
  usuarioSintetico,
} from '../massa/sintetica.js';
import {
  type Ambiente,
  codigos,
  criarNucleo,
  ctx,
  ctxOperacao,
  env,
  PODE_ESCREVER,
  prepararAmbiente,
  raiz,
} from './escrita.spec-util.js';

const cadastrar = operacao('cadastro.cadastrarPaciente');
const criarUsuario = operacao('acesso.criarUsuarioIntegracao');
const CONTA = `SGH_TESTE_CADEIA_${randomBytes(3).toString('hex').toUpperCase()}`;
const SENHA = randomBytes(12).toString('base64url').slice(0, 16);

describe.skipIf(!PODE_ESCREVER)('trilha dupla e cadeia de hash (M06)', () => {
  let a: Ambiente;
  beforeAll(async () => {
    a = await prepararAmbiente();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('cadastrar paciente grava as duas trilhas na mesma transação; desfeita, as duas somem juntas', async () => {
    const ids = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const login = (await loginLivre(e, Date.now() % 1_000_000_000)).toUpperCase();
      await a.executor.executar(
        criarUsuario,
        a.cod,
        usuarioSintetico('usuario-tecnico', login),
        ctxOperacao(a, login),
        {
          escritor: e,
        },
      );
      await papelSintetico(e, login);
      const cpf = await cpfLivre(e, Date.now() % 90_000_000);
      const tipos = carregarDominiosVistos(resolve(raiz, 'packages/legado/src')).vistos('RICADPAC', 'TPLGR');
      const cep = await cepCompleto(e, tipos ?? new Set<string>());
      const r = await a.executor.executar(
        cadastrar,
        a.cod,
        pacienteSintetico('minimo', cpf, cep),
        ctxOperacao(a, login),
        {
          escritor: e,
        },
      );
      const [t] = await e.consultar(
        'SELECT CAST(ID_TBCABTRILHA AS VARCHAR(20)) L, CAST(ID_RICADPAC AS VARCHAR(20)) P, EVENTO FROM SGH_TRILHA WHERE ID = CAST(? AS BIGINT)',
        [r.trilha],
        { teto: 1 },
      );
      const legado = String(t?.['L'] ?? '');
      const [c] = await e.consultar(
        `SELECT ID_TBTPACAOAUDIT T, ID_TBNVLCRITICID C, ID_TBOPCOES O, USUARIO U,
                (SELECT COUNT(*) FROM TBLANTRILHASGH l WHERE l.ID_TBCABTRILHA = h.ID AND l.TABELA_CAMPO = 'RICADPAC.ID' AND l.ID_TABELA = ?) N
           FROM TBCABTRILHA h WHERE h.ID = CAST(? AS BIGINT)`,
        [Number(r.resultado['idPaciente']), legado],
        { teto: 1 },
      );
      expect(c).toMatchObject({ T: 2, C: 4, O: 3255, N: 1 });
      expect(String(c?.['U']).trimEnd()).toBe(login);
      return { sgh: String(r.trilha), legado };
    });
    // Fora da transação (depois do ROLLBACK): nenhuma das duas linhas existe.
    const fora = await a.nucleo.lerSomente(ctx(a), async (l) => {
      const [x] = await l.consultar(
        `SELECT (SELECT COUNT(*) FROM SGH_TRILHA WHERE ID = CAST(? AS BIGINT)) S,
                (SELECT COUNT(*) FROM TBCABTRILHA WHERE ID = CAST(? AS BIGINT)) L FROM RDB$DATABASE`,
        [ids.sgh, ids.legado],
        { teto: 1 },
      );
      return x;
    });
    expect(fora).toEqual({ S: 0, L: 0 });
    console.log(`[${a.cod}] trilha dupla: as duas trilhas na mesma transação; desfeita, 0 e 0 linhas`);
  });

  it('a cadeia fecha por dia; um evento alterado quebra a cadeia (a verificação diária detecta)', async () => {
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const base = {
        rede: a.nucleo.rede,
        hospital: 'zy',
        usuario: 'SGH.TESTE',
        recurso: 'teste.cadeia',
        operacao: 'teste.cadeia',
        tabelaAlvo: null,
        idAlvo: null,
        chaveNaturalAlvo: null,
        resultado: 'sucesso',
        estacao: 'SGH-TESTE:sintetico',
        correlacao: 'int-m06',
        origem: 'SGH-TESTE:sintetico',
      };
      const g = [];
      for (let i = 0; i < 3; i++)
        g.push(await gravarTrilha(e, { ...base, evento: `teste.cadeia.e${i}`, idPaciente: 900 + i }));
      const [d] = await e.consultar(
        'SELECT CAST(CAST(CURRENT_TIMESTAMP AS DATE) AS VARCHAR(10)) D FROM RDB$DATABASE',
        [],
        { teto: 1 },
      );
      const dia = String(d?.['D']);
      const inteira = await verificarCadeia(e, 'zy');
      const doDia = await verificarCadeia(e, 'zy', 1_000, { dia });
      await e.executar("UPDATE SGH_TRILHA SET USUARIO = 'OUTRO' WHERE ID = CAST(? AS BIGINT)", [g[1]?.id]);
      const depois = await verificarCadeia(e, 'zy', 1_000, { dia });
      return { inteira, doDia, depois, quebra: g[1]?.id };
    });
    expect(r.inteira).toMatchObject({ ok: true, linhas: 3 });
    expect(r.doDia).toMatchObject({ ok: true, linhas: 3 });
    expect(r.depois).toMatchObject({ ok: false, quebraEm: r.quebra });
    console.log(
      `[${a.cod}] cadeia: 3 elos fecham (inteira e do dia); o evento alterado quebra no elo ${r.quebra}`,
    );
  });

  it('com o papel da aplicação: INSERT aceito; UPDATE e DELETE em SGH_TRILHA recusados pelo banco', async () => {
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
          const t = await gravarTrilha(e, {
            rede: a.nucleo.rede,
            hospital: 'zx',
            usuario: 'SGH.TESTE',
            evento: 'teste.privilegio',
            recurso: 'teste',
            operacao: 'teste',
            tabelaAlvo: null,
            idAlvo: null,
            chaveNaturalAlvo: null,
            resultado: 'sucesso',
            estacao: null,
            correlacao: 'int-m06',
          });
          const recusa = async (sql: string) => {
            try {
              await e.executar(sql, [t.id]);
              return 'aceito';
            } catch (x) {
              return /no permission|permission/i.test(String(x)) ? 'recusado' : 'outro erro';
            }
          };
          return {
            insert: t.id !== '',
            update: await recusa("UPDATE SGH_TRILHA SET RESULTADO = 'x' WHERE ID = CAST(? AS BIGINT)"),
            delete: await recusa('DELETE FROM SGH_TRILHA WHERE ID = CAST(? AS BIGINT)'),
          };
        });
        expect(r).toEqual({ insert: true, update: 'recusado', delete: 'recusado' });
      } finally {
        await app.encerrar();
      }
    } finally {
      await admin(`REVOKE SGH_APLICACAO FROM USER ${CONTA}`).catch(() => undefined);
      await admin(`DROP USER ${CONTA}`);
    }
    // A conta efêmera é o único COMMIT do teste (DDL de segurança, pelo isql, sob a trava da cópia, que
    // PODE_ESCREVER exige): ao terminar, nenhuma conta nem privilégio dela fica na cópia (revisão do M06).
    const sobra = await a.nucleo.lerSomente(ctx(a), async (l) => {
      const [u] = await l.consultar('SELECT COUNT(*) N FROM SEC$USERS WHERE SEC$USER_NAME = ?', [CONTA], {
        teto: 1,
      });
      const [p] = await l.consultar(
        'SELECT COUNT(*) N FROM RDB$USER_PRIVILEGES WHERE RDB$USER = ?',
        [CONTA],
        {
          teto: 1,
        },
      );
      return { contas: Number(u?.['N']), privilegios: Number(p?.['N']) };
    });
    expect(sobra).toEqual({ contas: 0, privilegios: 0 });
  });
});
