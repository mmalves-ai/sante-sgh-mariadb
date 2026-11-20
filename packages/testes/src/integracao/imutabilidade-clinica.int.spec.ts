// Imutabilidade clínica imposta no banco (M59-F3; ficha do M59, regra 6 e seção 10: "tentativa de apagar registro
// clínico recusada"). O papel do módulo pep sai de `gerarScriptsPapeis` sobre o alcance versionado e é aplicado pelo
// isql sob a trava da cópia; com a conta efêmera do módulo (senha aleatória nunca impressa) o núcleo abre o pool do
// pep e: (a) lê e grava (INSERT/UPDATE) as tabelas clínicas que o plano dá; (b) o DELETE em tabela clínica é recusado
// pelo banco ("no permission"), tanto do prontuário quanto SGH_ do prontuário; (c) o catálogo de segurança não mostra
// DELETE clínico para o papel; (d) o `recolher` deixa 0 papel, 0 conta e 0 privilégio. O DELETE é com WHERE 1 = 0 e
// dentro de transação desfeita: o privilégio é conferido na preparação do comando, e nada seria apagado mesmo assim.
// Ensaio do passo 0002 (a conta ampla da aplicação perde o DELETE clínico): a cópia de dev usa o administrador do
// servidor (DP-15), que não se revoga por script; o ensaio usa uma conta efêmera com DELETE em duas tabelas clínicas e
// numa que não é clínica, gera o par com `gerarScriptsImutabilidade` do retrato lido antes, aplica (só o DELETE
// clínico sai), recolhe (volta exatamente o de antes) e limpa a conta e os privilégios.
import { randomBytes } from 'node:crypto';
import {
  contaModuloBanco,
  deleteClinicoProibido,
  papelModuloBanco,
  TABELAS_CLINICAS_LEGADO,
} from '@sgh/contratos';
import { gerarScriptsImutabilidade, gerarScriptsPapeis, planejarPrivilegios } from '@sgh/dominio-acesso';
import {
  alcanceVersionado,
  type Escritor,
  executarIsql,
  lerPrivilegiosReais,
  listarContainers,
  quemPublica,
  validarPedidoCopia,
} from '@sgh/legado';
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

const MODULO = 'pep';
const SENHA = randomBytes(12).toString('base64url').slice(0, 16);
const naoPode = (x: unknown) =>
  /no permission|permission/i.test(String(x)) ? 'recusado' : `outro erro: ${String(x).slice(0, 200)}`;

describe.skipIf(!PODE_ESCREVER)('imutabilidade clínica na cópia (M59-F3)', () => {
  let a: Ambiente;
  beforeAll(async () => {
    a = await prepararAmbiente();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('o papel do pep grava o prontuário mas não apaga registro clínico; recolher não deixa sobra', async () => {
    const cod = codigos[0] as string;
    const alcance = alcanceVersionado(cod);
    expect(alcance, `alcance versionado de ${cod}`).not.toBeNull();
    const doModulo = alcance!.alcances.find((x) => x.modulo === MODULO)!;
    const plano = planejarPrivilegios([doModulo]);
    // O plano já não dá DELETE clínico a módulo nenhum (a geração recusa); aqui, o do pep.
    expect(plano.filter((i) => i.acao === 'DELETE' && deleteClinicoProibido(i.objeto))).toEqual([]);
    const gravaveis = Object.entries(doModulo.objetos)
      .filter(
        ([o, acoes]) => deleteClinicoProibido(o) && acoes.includes('INSERT') && acoes.includes('SELECT'),
      )
      .map(([o]) => o);
    const doProntuario = gravaveis.find((o) => !o.startsWith('SGH_'));
    const doSante = gravaveis.find((o) => o.startsWith('SGH_'));
    expect(doProntuario, 'tabela clínica do prontuário que o pep grava').toBeTruthy();

    const { aplicar, recolher } = gerarScriptsPapeis(plano, { hospital: cod, versao: alcance!.versao });
    const papel = papelModuloBanco(MODULO);
    const conta = contaModuloBanco(MODULO);
    const alvo = validarPedidoCopia({ hospital: cod, destino: 'dev' }, env);
    const dono = quemPublica(listarContainers(), alvo.estabelecimento.porta);
    if (!dono?.soLoopback) throw new Error(`nenhuma cópia publica 127.0.0.1:${alvo.estabelecimento.porta}`);
    const isql = (sql: string, parar = true) => {
      const r = executarIsql(dono.nome, alvo.banco, `${sql}\nCOMMIT;\n`, { parar });
      if (parar && r.codigo !== 0) throw new Error(`isql: ${r.erro}`);
    };
    const contarSobras = () =>
      a.nucleo.lerSomente(ctx(a), async (l) => {
        const n = async (sql: string) => Number((await l.consultar(sql, [], { teto: 1 }))[0]?.['N'] ?? NaN);
        return {
          papeis: await n(`SELECT COUNT(*) N FROM RDB$ROLES WHERE TRIM(RDB$ROLE_NAME) = '${papel}'`),
          contas: await n(`SELECT COUNT(*) N FROM SEC$USERS WHERE TRIM(SEC$USER_NAME) = '${conta}'`),
          privilegios: await n(
            `SELECT COUNT(*) N FROM RDB$USER_PRIVILEGES WHERE TRIM(RDB$USER) IN ('${papel}', '${conta}')`,
          ),
        };
      });
    expect(await contarSobras()).toEqual({ papeis: 0, contas: 0, privilegios: 0 });

    const r: Record<string, unknown> = {};
    try {
      isql(aplicar);
      isql(`CREATE USER ${conta} PASSWORD '${SENHA}' USING PLUGIN Srp;`);
      const C = cod.toUpperCase();
      const app = criarNucleo({
        FB_POOL_TETO: '2',
        [`FB_${C}_MOD_${conta.slice('SGH_APP_'.length)}_USUARIO`]: conta,
        [`FB_${C}_MOD_${conta.slice('SGH_APP_'.length)}_SENHA`]: SENHA,
      });
      try {
        await app.verificarSchema(cod);
        const ctxM = { ...ctx(a), rede: app.rede, modulo: MODULO };
        const tenta = async (fn: () => Promise<unknown>) => {
          try {
            await fn();
            return 'aceito';
          } catch (x) {
            return naoPode(x);
          }
        };
        r.pep = await app.desfazendoNaCopia(ctxM, async (e: Escritor) => {
          const quem = await e
            .consultar('SELECT TRIM(CURRENT_USER) U, TRIM(CURRENT_ROLE) R FROM RDB$DATABASE', [], { teto: 1 })
            .then(([x]) => `${String(x?.['U'])}/${String(x?.['R'])}`);
          const leitura = await tenta(() =>
            e.consultar(`SELECT FIRST 1 * FROM ${doProntuario}`, [], { teto: 1 }),
          );
          const apagarProntuario = await tenta(() =>
            e.executar(`DELETE FROM ${doProntuario} WHERE 1 = 0`, []),
          );
          const apagarSante = doSante
            ? await tenta(() => e.executar(`DELETE FROM ${doSante} WHERE 1 = 0`, []))
            : 'sem-tabela';
          return { quem, leitura, apagarProntuario, apagarSante };
        });
      } finally {
        await app.encerrar();
      }
      const reais = await a.nucleo.lerSomente(ctx(a), (l) => lerPrivilegiosReais(l, { prefixo: 'SGH_MOD_' }));
      r.deleteClinicoNoCatalogo = reais.filter(
        (x) => x.titular === papel && x.acao === 'DELETE' && deleteClinicoProibido(x.objeto),
      ).length;
    } finally {
      let erroRecolher: unknown = null;
      try {
        isql(recolher);
      } catch (x) {
        erroRecolher = x;
        isql([recolher, `DROP ROLE ${papel};`].join('\n'), false);
      }
      isql(`DROP USER ${conta} USING PLUGIN Srp;`, false);
      r.recolher = erroRecolher ? String(erroRecolher).slice(0, 300) : 'ok';
    }
    r.sobras = await contarSobras();

    expect(r).toEqual({
      pep: {
        quem: `${conta}/${papel}`,
        leitura: 'aceito',
        apagarProntuario: 'recusado',
        apagarSante: expect.stringMatching(/^(recusado|sem-tabela)$/),
      },
      deleteClinicoNoCatalogo: 0,
      recolher: 'ok',
      sobras: { papeis: 0, contas: 0, privilegios: 0 },
    });
    console.log(
      `[${cod}] M59-F3: papel ${papel} lê ${doProntuario}; DELETE recusado em ${doProntuario}${doSante ? ` e ${doSante}` : ''}; ${gravaveis.length} tabelas clínicas graváveis pelo pep, nenhuma com DELETE; recolher sem sobra`,
    );
  });
  it('ensaio do 0002: revoga só o DELETE clínico da conta e o recolher devolve o retrato de antes', async () => {
    const cod = codigos[0] as string;
    const conta = 'SGH_APP_ENSAIO59';
    const clinicas = TABELAS_CLINICAS_LEGADO.filter((t) => deleteClinicoProibido(t)).slice(0, 2);
    const comum = 'TBCODATI';
    expect(clinicas).toHaveLength(2);
    expect(deleteClinicoProibido(comum)).toBe(false);
    const alvo = validarPedidoCopia({ hospital: cod, destino: 'dev' }, env);
    const dono = quemPublica(listarContainers(), alvo.estabelecimento.porta);
    if (!dono?.soLoopback) throw new Error(`nenhuma cópia publica 127.0.0.1:${alvo.estabelecimento.porta}`);
    const isql = (sql: string, parar = true) => {
      const r = executarIsql(dono.nome, alvo.banco, `${sql}\nCOMMIT;\n`, { parar });
      if (parar && r.codigo !== 0) throw new Error(`isql: ${r.erro}`);
    };
    const retrato = () =>
      a.nucleo
        .lerSomente(ctx(a), (l) => lerPrivilegiosReais(l, { conta }))
        .then((xs) => xs.map((x) => `${x.acao} ${x.objeto}`).sort());
    expect(await retrato()).toEqual([]);
    const r: Record<string, unknown> = {};
    try {
      isql(
        [
          `CREATE USER ${conta} PASSWORD '${SENHA}' USING PLUGIN Srp;`,
          ...[...clinicas, comum].map((t) => `GRANT SELECT, DELETE ON ${t} TO USER ${conta};`),
        ].join('\n'),
      );
      const antes = await a.nucleo.lerSomente(ctx(a), (l) => lerPrivilegiosReais(l, { conta }));
      const s = gerarScriptsImutabilidade(conta, antes, {
        hospital: cod,
        versao: 'ensaio',
        autorizacao: 'ensaio na copia de dev (M59-F3), conta efemera',
      });
      r.tabelas = s.tabelas;
      const inicio = await retrato();
      isql(s.aplicar);
      r.depoisDoAplicar = await retrato();
      isql(s.recolher);
      r.recolheuIgual = JSON.stringify(await retrato()) === JSON.stringify(inicio);
    } finally {
      isql(
        [
          ...[...clinicas, comum].map((t) => `REVOKE ALL ON ${t} FROM USER ${conta};`),
          `DROP USER ${conta} USING PLUGIN Srp;`,
        ].join('\n'),
        false,
      );
    }
    r.sobras = await retrato();
    expect(r).toEqual({
      tabelas: [...clinicas].sort(),
      depoisDoAplicar: [...clinicas.map((t) => `SELECT ${t}`), `DELETE ${comum}`, `SELECT ${comum}`].sort(),
      recolheuIgual: true,
      sobras: [],
    });
  });
});
