// Privilégio mínimo por módulo na cópia (ficha do M59, regra 4; preparo-e1 §4.5): os papéis de dois módulos
// (acesso e carga) saem de `gerarScriptsPapeis` sobre o alcance versionado e são aplicados pelo isql sob a trava da
// cópia; com a conta de cada módulo (efêmera, senha aleatória nunca impressa) o núcleo abre o pool do módulo e
// (a) lê e grava o que o plano dá (receita do executor numa transação desfeita), (b) recebe "no permission" fora
// do plano, (c) os gatilhos da tabela gravada disparam com o privilégio do papel (ID pelo generator do gatilho),
// e o catálogo de segurança confere com o plano (sem excesso nem falta); (d) o `recolher` deixa 0 papel, 0 conta e
// 0 privilégio. DDL de segurança com COMMIT só pelo isql, com a limpeza no finally. Massa sintética. Revisão do
// M59.1: (e) o papel do atendimento grava ATCABECATEND e os gatilhos dela (que leem outras tabelas, como
// ATTISSAUTORIZ e RILICENCADOM) não recebem "no permission"; (f) o papel do pep grava o evento na trilha do legado
// (TBCABTRILHA e TBLANTRILHASGH, o que o executor faz em toda receita com evento), tudo em transação desfeita.
import { randomBytes } from 'node:crypto';
import { contaModuloBanco, papelModuloBanco } from '@sgh/contratos';
import { compararPrivilegios, gerarScriptsPapeis, planejarPrivilegios } from '@sgh/dominio-acesso';
import {
  alcanceVersionado,
  type Escritor,
  executarIsql,
  fonteCatalogoArquivo,
  gravarEventoLegado,
  lerPrivilegiosReais,
  listarContainers,
  operacao,
  quemPublica,
  validarPedidoCopia,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Ambiente,
  CATALOGO,
  codigos,
  criarNucleo,
  ctx,
  env,
  PODE_ESCREVER,
  prepararAmbiente,
} from './escrita.spec-util.js';

const MODULOS = ['acesso', 'carga', 'atendimento', 'pep'] as const;
const senha = () => randomBytes(12).toString('base64url').slice(0, 16);
const SENHAS = Object.fromEntries(MODULOS.map((m) => [m, senha()])) as Record<
  (typeof MODULOS)[number],
  string
>;
const naoPode = (x: unknown) =>
  /no permission|permission/i.test(String(x)) ? 'recusado' : `outro erro: ${String(x)}`;

describe.skipIf(!PODE_ESCREVER)('privilégio mínimo por módulo na cópia (M59-F1)', () => {
  let a: Ambiente;
  beforeAll(async () => {
    a = await prepararAmbiente();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('todo objeto do plano inteiro existe no banco (o GRANT de objeto inexistente derruba o script da TI)', async () => {
    const cod = codigos[0] as string;
    const plano = planejarPrivilegios(alcanceVersionado(cod)!.alcances);
    const existentes = await a.nucleo.lerSomente(ctx(a), async (l) => {
      const nomes = async (sql: string) =>
        new Set((await l.consultar(sql, [], { teto: 100_000 })).map((x) => String(x['N']).trim()));
      return {
        relacoes: await nomes('SELECT TRIM(RDB$RELATION_NAME) N FROM RDB$RELATIONS'),
        procedures: await nomes('SELECT TRIM(RDB$PROCEDURE_NAME) N FROM RDB$PROCEDURES'),
        generators: await nomes('SELECT TRIM(RDB$GENERATOR_NAME) N FROM RDB$GENERATORS'),
      };
    });
    const faltam = [
      ...new Set(
        plano
          .filter((i) =>
            i.acao === 'EXECUTE'
              ? !existentes.procedures.has(i.objeto)
              : i.acao === 'USAGE'
                ? !existentes.generators.has(i.objeto)
                : !existentes.relacoes.has(i.objeto),
          )
          .map((i) => `${i.acao} ${i.objeto}`),
      ),
    ].sort();
    expect(faltam).toEqual([]);
    console.log(
      `[${cod}] M59-F1: os ${plano.length} privilégios do plano citam só objetos que existem na cópia`,
    );
  });

  it('papéis de dois módulos: lê e grava o plano, recusa fora dele, gatilho dispara; recolher não deixa sobra', async () => {
    const cod = codigos[0] as string;
    const alcance = alcanceVersionado(cod);
    expect(alcance, `alcance versionado de ${cod}`).not.toBeNull();
    const doModulo = (m: string) => alcance!.alcances.find((x) => x.modulo === m)!;
    const plano = planejarPrivilegios(MODULOS.map(doModulo));
    const { aplicar, recolher } = gerarScriptsPapeis(plano, { hospital: cod, versao: alcance!.versao });
    const papeis = MODULOS.map(papelModuloBanco);
    const contas = MODULOS.map(contaModuloBanco);
    const lista = (xs: readonly string[]) => xs.map((x) => `'${x}'`).join(', ');

    // O isql roda no container que publica a porta da conexão (com-copia.sh escolhe 3351 ou 3352 pelo FB_PC_PORTA;
    // o container padrão do código é só o da 3351).
    const alvo = validarPedidoCopia({ hospital: cod, destino: 'dev' }, env);
    const dono = quemPublica(listarContainers(), alvo.estabelecimento.porta);
    if (!dono?.soLoopback) throw new Error(`nenhuma cópia publica 127.0.0.1:${alvo.estabelecimento.porta}`);
    // O isql faz COMMIT de cada DDL: o aplicar para no primeiro erro (-bail), e a limpeza tenta cada comando.
    const isql = (sql: string, parar = true) => {
      const r = executarIsql(dono.nome, alvo.banco, `${sql}\nCOMMIT;\n`, { parar });
      if (parar && r.codigo !== 0) throw new Error(`isql: ${r.erro}`);
    };
    const contarSobras = () =>
      a.nucleo.lerSomente(ctx(a), async (l) => {
        const n = async (sql: string) => Number((await l.consultar(sql, [], { teto: 1 }))[0]?.['N'] ?? NaN);
        return {
          papeis: await n(`SELECT COUNT(*) N FROM RDB$ROLES WHERE TRIM(RDB$ROLE_NAME) IN (${lista(papeis)})`),
          contas: await n(`SELECT COUNT(*) N FROM SEC$USERS WHERE TRIM(SEC$USER_NAME) IN (${lista(contas)})`),
          privilegios: await n(
            `SELECT COUNT(*) N FROM RDB$USER_PRIVILEGES WHERE TRIM(RDB$USER) IN (${lista([...papeis, ...contas])})`,
          ),
        };
      });

    // Nada destes papéis e contas antes (o plano ainda não foi aplicado nesta cópia): o teste não apaga o que é de outro.
    expect(await contarSobras()).toEqual({ papeis: 0, contas: 0, privilegios: 0 });

    // Fora do plano de cada módulo: uma tabela que só o outro lê e que não é de todos (PUBLIC).
    const publicas = await a.nucleo.lerSomente(
      ctx(a),
      async (l) =>
        new Set(
          (
            await l.consultar(
              "SELECT DISTINCT TRIM(RDB$RELATION_NAME) N FROM RDB$USER_PRIVILEGES WHERE TRIM(RDB$USER) = 'PUBLIC' AND RDB$PRIVILEGE = 'S'",
              [],
              { teto: 100_000 },
            )
          ).map((x) => String(x['N'])),
        ),
    );
    const so = (m: string, outro: string) =>
      Object.entries(doModulo(m).objetos)
        .filter(
          ([o, acoes]) =>
            acoes.includes('SELECT') &&
            !o.startsWith('SGH_') &&
            !(o in doModulo(outro).objetos) &&
            !publicas.has(o),
        )
        .map(([o]) => o)[0]!;
    const soCarga = so('carga', 'acesso');
    const soAcesso = so('acesso', 'carga');
    expect(soCarga && soAcesso).toBeTruthy();

    const r: Record<string, unknown> = {};
    try {
      isql(aplicar);
      for (const [i, m] of MODULOS.entries())
        isql(`CREATE USER ${contas[i]} PASSWORD '${SENHAS[m]}' USING PLUGIN Srp;`);
      const C = cod.toUpperCase();
      const app = criarNucleo({
        FB_POOL_TETO: '2',
        ...Object.fromEntries(
          MODULOS.flatMap((m, i) => [
            [`FB_${C}_MOD_${contas[i]!.slice('SGH_APP_'.length)}_USUARIO`, contas[i]!],
            [`FB_${C}_MOD_${contas[i]!.slice('SGH_APP_'.length)}_SENHA`, SENHAS[m]],
          ]),
        ),
      });
      try {
        await app.verificarSchema(cod);
        const executor = app.criarExecutor({ catalogo: fonteCatalogoArquivo(CATALOGO) });
        const ctxM = (modulo: string) => ({ ...ctx(a), rede: app.rede, modulo });
        const tenta = async (fn: () => Promise<unknown>) => {
          try {
            await fn();
            return 'aceito';
          } catch (x) {
            return naoPode(x);
          }
        };

        // (a) e (b) leitura: o plano dá; fora dele, o banco recusa. Com `*`: no Firebird 3, `SELECT 1 FROM T` (sem
        // coluna) passa sem o privilégio da tabela, então não prova nada.
        const leitura = async (m: string, dentro: string, fora: string) =>
          app.lerSomente(ctxM(m), async (l) => ({
            quem: await l
              .consultar('SELECT TRIM(CURRENT_USER) U, TRIM(CURRENT_ROLE) R FROM RDB$DATABASE', [], {
                teto: 1,
              })
              .then(([x]) => `${String(x?.['U'])}/${String(x?.['R'])}`),
            dentro: await tenta(() => l.consultar(`SELECT FIRST 1 * FROM ${dentro}`, [], { teto: 1 })),
            fora: await tenta(() => l.consultar(`SELECT FIRST 1 * FROM ${fora}`, [], { teto: 1 })),
          }));
        r.leituraAcesso = await leitura('acesso', soAcesso, soCarga);
        r.leituraCarga = await leitura('carga', soCarga, soAcesso);

        // (a) e (c) escrita pelo executor com o pool do módulo acesso, desfeita: o usuário sintético e o aceite do
        // termo vigente (gatilho TRG_PRTERMOACEITE_BI com GEN_PRTERMOACEITE_ID); (b) UPDATE na trilha recusado.
        const sufixo = Date.now().toString(36).toUpperCase();
        const login = `sgh.int.m59.${sufixo}`.slice(0, 31);
        let n = 0;
        r.escrita = await app.desfazendoNaCopia(ctxM('acesso'), async (e: Escritor) => {
          const exec = (nome: string, entrada: unknown, quem: string) =>
            executor.executar(
              operacao(nome),
              cod,
              entrada,
              {
                ...ctxM('acesso'),
                usuarioLegado: quem,
                idempotencyKey: `int-m59-${sufixo}-${++n}`,
                reautenticadoEm: Date.now(),
              },
              { escritor: e },
            );
          const usuario = await tenta(() =>
            exec(
              'acesso.criarUsuarioIntegracao',
              { nome: login, nomeCompleto: 'USUARIO SINTETICO SGH M59' },
              'SGH.INT',
            ),
          );
          const [t] = await e.consultar(
            `SELECT FIRST 1 ID FROM PRTERMOCAD WHERE ATIVO = 'T' ORDER BY ID DESC`,
            [],
            {
              teto: 1,
            },
          );
          let termo = 'sem-termo';
          let gatilho = 'sem-termo';
          if (t) {
            termo = await tenta(() => exec('acesso.aceitarTermo', { termo: Number(t['ID']) }, login));
            const [g] = await e.consultar(
              'SELECT FIRST 1 ID FROM PRTERMOACEITE WHERE ID_PRTERMOCAD = ? AND UPPER(TRIM(USUARIO_ACEITE)) = ? ORDER BY ID DESC',
              [t['ID'], login.toUpperCase()],
              { teto: 1 },
            );
            gatilho = g && Number(g['ID']) > 0 ? 'disparou' : 'sem ID';
          }
          const trilhaUpdate = await tenta(() =>
            e.executar("UPDATE SGH_TRILHA SET RESULTADO = 'x' WHERE ID = CAST(? AS BIGINT)", ['0']),
          );
          return { usuario, termo, gatilho, trilhaUpdate };
        });
        // (e) Gatilhos que usam outras tabelas: a linha é regravada com o próprio valor (nada muda; desfeito).
        r.gatilhosAtendimento = await app.desfazendoNaCopia(ctxM('atendimento'), async (e: Escritor) => {
          const [x] = await e.consultar('SELECT FIRST 1 ID FROM ATCABECATEND', [], { teto: 1 });
          if (!x) return 'sem-linha';
          return tenta(() =>
            e.executar(
              'UPDATE ATCABECATEND SET ATIVO = ATIVO WHERE ID = CAST(CAST(? AS VARCHAR(20)) AS NUMERIC(13,0))',
              [String(x['ID'])],
            ),
          );
        });
        // (f) O evento na trilha do legado com a conta do pep (gatilho TRG_TBCABTRILHA_BI dá o ID).
        r.eventoLegadoPep = await app.desfazendoNaCopia(ctxM('pep'), async (e: Escritor) => {
          let id = '';
          const res = await tenta(async () => {
            id = (
              await gravarEventoLegado(e, { tipo: 6, criticidade: 7, opcao: 5416, estacao: 'SGH-INT:m59' }, {
                ...ctxM('pep'),
                usuarioLegado: 'SGH.INT',
              } as never)
            ).idTrilha;
          });
          return res === 'aceito' ? (/^\d+$/.test(id) ? 'gravado' : 'sem ID') : res;
        });
        r.escritaCargaForaDoPlano = await app.desfazendoNaCopia(ctxM('carga'), async (e: Escritor) =>
          tenta(() =>
            e.executar("UPDATE SGH_TRILHA SET RESULTADO = 'x' WHERE ID = CAST(? AS BIGINT)", ['0']),
          ),
        );
      } finally {
        await app.encerrar();
      }

      // O catálogo de segurança confere com o plano dos dois papéis (o painel de desvios lê o mesmo).
      const reais = await a.nucleo.lerSomente(ctx(a), (l) => lerPrivilegiosReais(l, { prefixo: 'SGH_MOD_' }));
      const d = compararPrivilegios(
        plano,
        reais.filter((x) => (papeis as string[]).includes(x.titular)),
      );
      r.desvios = { excesso: d.excesso.length, falta: d.falta.length, iguais: d.iguais, plano: plano.length };
    } finally {
      // (d) recolher: o script inverso e as contas efêmeras (a ordem do recolher já tira o papel das contas).
      let erroRecolher: unknown = null;
      try {
        isql(recolher);
      } catch (x) {
        erroRecolher = x;
        // Falha no meio do aplicar deixa parte do plano: o recolher sem -bail e o DROP de cada papel limpam o resto.
        isql([recolher, ...papeis.map((p) => `DROP ROLE ${p};`)].join('\n'), false);
      }
      isql(contas.map((c) => `DROP USER ${c} USING PLUGIN Srp;`).join('\n'), false);
      r.recolher = erroRecolher ? String(erroRecolher).slice(0, 300) : 'ok';
    }
    r.sobras = await contarSobras();

    expect(r).toEqual({
      leituraAcesso: { quem: 'SGH_APP_ACESSO/SGH_MOD_ACESSO', dentro: 'aceito', fora: 'recusado' },
      leituraCarga: { quem: 'SGH_APP_CARGA/SGH_MOD_CARGA', dentro: 'aceito', fora: 'recusado' },
      escrita: {
        usuario: 'aceito',
        termo: expect.stringMatching(/^(aceito|sem-termo)$/),
        gatilho: expect.stringMatching(/^(disparou|sem-termo)$/),
        trilhaUpdate: 'recusado',
      },
      gatilhosAtendimento: 'aceito',
      eventoLegadoPep: 'gravado',
      escritaCargaForaDoPlano: 'recusado',
      desvios: { excesso: 0, falta: 0, iguais: plano.length, plano: plano.length },
      recolher: 'ok',
      sobras: { papeis: 0, contas: 0, privilegios: 0 },
    });
    console.log(
      `[${cod}] M59-F1: papéis ${papeis.join(', ')} com ${plano.length} privilégios; leitura e escrita no plano, fora recusado; termo ${String((r.escrita as { termo: string }).termo)}; gatilhos do atendimento ${String(r.gatilhosAtendimento)}; evento do pep ${String(r.eventoLegadoPep)}; recolher sem sobra`,
    );
  });
});
