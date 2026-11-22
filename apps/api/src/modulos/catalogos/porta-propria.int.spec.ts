// A fonte própria dos catálogos (M13) no MariaDB real: cliente f22_o2 (banco cliente_f22_o2). Massa sintética própria do
// lote (códigos f22o202*, procedimento 9999990001, termo U99X), montada no beforeAll e limpa no afterAll; nenhum dado
// real. SGH_NUCLEO_SEM_BANCO=1 pula o arquivo.
// A área de preparação (carga_catalogo, carga_catalogo_linha) e a licença (licenca_catalogo) estão pedidas ao
// integrador (docs/obra/fatias/f22/saida/02-02.sql). Enquanto a migração não entra, o teste cria as tabelas com esse
// mesmo DDL, marcadas no comentário com "[teste 02-02]", e as apaga no fim; depois da migração, usa as do banco.
// A mesma bateria da área de preparação roda na memória e no banco (describe.each). O fluxo real (HTTP → controller →
// serviço → fonte própria) roda contra o f22_o2 com a sessão sintética no estabelecimento f22o202a: envio SIGTAP,
// detalhe, aprovação com a senha, reenvio idempotente e a carga com uma linha gigante (gravada com o corte no motivo).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { arquivoCodigoNome, arquivoTbProcedimento } from '@sgh/dominio-catalogo';
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { ErroProblema } from '../../problema.filter.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { type ContextoModulo, REGISTRO_MODULOS } from '../registro.js';
import {
  type CtxCatalogos,
  ErroCargaCatalogo,
  type FonteCatalogos,
  type PreparoCargaCatalogo,
  type Trilha,
} from './fonte.js';
import { FonteCatalogosMemoria } from './fonte-memoria.js';
import { modulo } from './modulo.js';
import { FonteCatalogosPropria } from './porta-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const BANCO = `cliente_${CLIENTE}`;
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const RAIZ = resolve(import.meta.dirname, '../../../../..');
const H = 'f22o202a';
const OUTRO = 'f22o202b';
const LOGIN = 'f22o202.servico';
/** Usuário sintético da sessão HTTP (grupo de faturamento: cria e aprova cargas SIGTAP). */
const LOGIN_HTTP = 'SINT.FATURAMENTO';
const MARCA = '[teste 02-02]';
const TABELAS = ['carga_catalogo_linha', 'carga_catalogo', 'licenca_catalogo'] as const;

const ctx = (hospital = H): CtxCatalogos => ({ rede: 'rede-teste', hospital, traceId: 'teste-f22-0202' });
let nChave = 0;
const novaChave = () => `f22-0202-${++nChave}-${Date.now()}`;
const trilha = (evento = 'catalogo.carga.preparada', extra: Partial<Trilha> = {}): Trilha => ({
  rede: 'rede-teste',
  hospital: H,
  usuario: LOGIN,
  evento,
  recurso: 'catalogo.carga',
  operacao: 'catalogo.carga.preparar',
  chaveNaturalAlvo: 'CATALOGO:cid',
  resultado: 'sucesso',
  estacao: 'TESTE:127.0.0.1',
  enderecoIp: '127.0.0.1',
  correlacao: 'teste-f22-0202',
  idempotencia: novaChave(),
  ...extra,
});

const SHA = (n: number) => n.toString(16).padStart(64, '0');
const preparo = (sha: string, situacao: 'comparada' | 'rejeitada' = 'comparada'): PreparoCargaCatalogo => ({
  hospital: H,
  catalogo: 'cid',
  arquivo: 'CID-10-SUBCATEGORIAS.CSV (windows-1252)',
  sha256: sha,
  bytes: 1234,
  arquivoGuardado: null,
  situacao,
  edicao: null,
  responsavel: LOGIN,
  motivo: situacao === 'rejeitada' ? 'arquivo sem cabeçalho (teste)' : null,
  totais: { linhas: 3, validas: 2, erros: 1, novos: 1, removidos: 0, alterados: 1, iguais: 0 },
  lotes: { total: 1, tamanho: 500 },
  linhas: [
    {
      linha: 1,
      entidade: 'cid10',
      chave: 'codigo=U990',
      resultado: 'valida',
      comparacao: 'alterado',
      antes: { codigo: 'U990', nome: 'DOENCA SINTÉTICA 0' },
      depois: { nome: 'DOENÇA SINTÉTICA 0 (revista)' },
      motivo: null,
      lote: 1,
    },
    {
      linha: 2,
      entidade: 'cid10',
      chave: 'codigo=U993',
      resultado: 'valida',
      comparacao: 'novo',
      antes: null,
      depois: { codigo: 'U993', nome: 'DOENÇA SINTÉTICA 3' },
      motivo: null,
      lote: 1,
    },
    {
      linha: 3,
      entidade: 'cid10',
      chave: 'codigo=',
      resultado: 'erro',
      comparacao: null,
      antes: null,
      depois: null,
      motivo: 'código obrigatório',
      lote: null,
    },
  ],
});

const sql = (entrada: string, ...args: string[]) =>
  execFileSync(resolve(RAIZ, 'tools/db/sql.sh'), [BANCO, ...args], { input: entrada, encoding: 'utf8' });

let nucleo: NucleoProprio | null = null;
let criadasPeloTeste = false;
let idUsuario = 0;
let idUsuarioHttp = 0;
let usuarioHttpCriado = false;
let idEstab = 0;

async function prepararBanco(): Promise<void> {
  nucleo = new NucleoProprio();
  expect((await nucleo.cliente(CLIENTE)).banco).toBe(BANCO);
  const presentes = sql(
    `SELECT TABLE_NAME, TABLE_COMMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN ('carga_catalogo','carga_catalogo_linha','licenca_catalogo')`,
    '-N',
  )
    .trim()
    .split('\n')
    .filter(Boolean);
  if (presentes.length === 0) {
    const ddl = readFileSync(resolve(RAIZ, 'docs/obra/fatias/f22/saida/02-02.sql'), 'utf8').replace(
      /\) COMMENT='/g,
      `) COMMENT='${MARCA} `,
    );
    sql(ddl);
    criadasPeloTeste = true;
  } else criadasPeloTeste = presentes.every((l) => l.includes(MARCA));
  await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-f22-0202' }, async (e) => {
    const agora = new Date();
    for (const codigo of [H, OUTRO])
      if (!(await e.uma('SELECT id FROM estabelecimento WHERE codigo = ?', [codigo])))
        await e.inserir(
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [codigo, `Hospital sintético ${codigo}`, `Hospital sintético ${codigo} (fictício)`, agora],
        );
    idEstab = Number(
      (await e.uma<{ id: number }>('SELECT id FROM estabelecimento WHERE codigo = ?', [H]))!.id,
    );
    const u = await e.uma<{ id: number }>('SELECT id FROM usuario WHERE login = ?', [LOGIN]);
    idUsuario = u
      ? Number(u.id)
      : await e.inserir(
          "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, 'Conta de serviço sintética', 'servico', ?)",
          [LOGIN, agora],
        );
    const uh = await e.uma<{ id: number }>('SELECT id FROM usuario WHERE login = ?', [LOGIN_HTTP]);
    usuarioHttpCriado ||= !uh;
    idUsuarioHttp = uh
      ? Number(uh.id)
      : await e.inserir(
          "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, 'Usuário sintético do teste 02-02', 'servico', ?)",
          [LOGIN_HTTP, agora],
        );
    // Catálogo sintético para a consulta, a edição e o histórico (códigos fora das faixas oficiais).
    let t = await e.uma<{ id: number }>("SELECT id FROM terminologia WHERE codigo = 'cid10'");
    if (!t)
      await e.inserir(
        "INSERT INTO terminologia (codigo, nome, tipo, criado_em) VALUES ('cid10', 'CID-10 (sintética do teste 02-02)', 'diagnostico', ?)",
        [agora],
      );
    t = await e.uma<{ id: number }>("SELECT id FROM terminologia WHERE codigo = 'cid10'");
    if (!(await e.uma("SELECT id FROM termo_terminologia WHERE codigo_termo = 'U99X'")))
      await e.inserir(
        "INSERT INTO termo_terminologia (terminologia_id, codigo_termo, descricao, criado_em) VALUES (?, 'U99X', 'Doença sintética de consulta', ?)",
        [Number(t!.id), agora],
      );
    const g = await e.uma<{ id: number }>('SELECT id FROM grupo_sigtap ORDER BY id LIMIT 1');
    if (g && !(await e.uma("SELECT id FROM procedimento_sigtap WHERE codigo_sigtap = '9999990001'"))) {
      const p = await e.inserir(
        `INSERT INTO procedimento_sigtap (codigo_sigtap, descricao, grupo_sigtap_id, sexo, idade_minima_meses,
           vigencia_inicio, versao_fonte, criado_em) VALUES ('9999990001', 'Consulta sintética', ?, 'ambos', 0, '2026-08-01', '202609', ?)`,
        [Number(g.id), agora],
      );
      for (const [inicio, fim, sa] of [
        ['2026-08-01', '2026-08-31', 10],
        ['2026-09-01', null, 12.5],
      ] as const)
        await e.inserir(
          `INSERT INTO procedimento_sigtap_valor (procedimento_sigtap_id, valor_servico_ambulatorial, vigencia_inicio,
             vigencia_fim, versao_fonte, criado_em) VALUES (?, ?, ?, ?, '202609', ?)`,
          [p, sa, inicio, fim, agora],
        );
    }
  });
}

async function limparBanco(): Promise<void> {
  if (!nucleo) return;
  await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-f22-0202' }, async (e) => {
    const est = (
      await e.consultar<{ id: number }>('SELECT id FROM estabelecimento WHERE codigo IN (?, ?)', [H, OUTRO])
    ).map((x) => Number(x.id));
    if (est.length) {
      const m = est.map(() => '?').join(', ');
      await e.executar(
        `DELETE x FROM carga_catalogo_linha x JOIN carga_catalogo c ON c.id = x.carga_catalogo_id WHERE c.estabelecimento_id IN (${m})`,
        est,
      );
      await e.executar(`DELETE FROM carga_catalogo WHERE estabelecimento_id IN (${m})`, est);
      await e.executar(`DELETE FROM licenca_catalogo WHERE estabelecimento_id IN (${m})`, est);
    }
    await e.executar(
      "DELETE v FROM procedimento_sigtap_valor v JOIN procedimento_sigtap p ON p.id = v.procedimento_sigtap_id WHERE p.codigo_sigtap = '9999990001'",
    );
    await e.executar("DELETE FROM procedimento_sigtap WHERE codigo_sigtap = '9999990001'");
    await e.executar("DELETE FROM termo_terminologia WHERE codigo_termo = 'U99X'");
    await e.executar("DELETE FROM terminologia WHERE codigo = 'cid10' AND nome LIKE '%teste 02-02%'");
    if (idUsuario) {
      await e.executar('DELETE FROM idempotencia_operacao WHERE usuario_id = ?', [idUsuario]);
      await e.executar('DELETE FROM trilha_auditoria WHERE usuario_id = ?', [idUsuario]);
    }
    if (idUsuarioHttp) {
      // Só as linhas do teste (carga de catálogo): o usuário sintético pode ser usado por outro lote.
      await e.executar(
        "DELETE FROM idempotencia_operacao WHERE usuario_id = ? AND operacao LIKE 'catalogo.carga.%'",
        [idUsuarioHttp],
      );
      await e.executar("DELETE FROM trilha_auditoria WHERE usuario_id = ? AND entidade = 'carga_catalogo'", [
        idUsuarioHttp,
      ]);
      if (usuarioHttpCriado)
        await e.executar('DELETE FROM usuario WHERE id = ? AND login = ?', [idUsuarioHttp, LOGIN_HTTP]);
    }
  });
}

/** Status e código como a API devolve a recusa. */
async function falha(p: Promise<unknown>): Promise<{ status: number; codigo: unknown }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErroCargaCatalogo) return { status: 409, codigo: e.codigo };
    if (e instanceof ErroProblema) return { status: e.getStatus(), codigo: e.extras['codigo'] ?? e.tipo };
    const pr = (e as { problema?: { status: number; codigo: string } }).problema;
    if (pr) return { status: pr.status, codigo: pr.codigo };
    // A memória recusa com o código no próprio erro (o controller traduz em 409).
    const codigo = (e as { codigo?: unknown }).codigo;
    if (typeof codigo === 'string') return { status: 409, codigo };
    throw e;
  }
  throw new Error('era para recusar');
}

describe.skipIf(SEM_BANCO)(
  'catálogos: fonte própria no MariaDB (cliente f22_o2)',
  { timeout: 60_000 },
  () => {
    beforeAll(async () => {
      await prepararBanco();
      await limparBanco();
      await prepararBanco();
    });
    afterAll(async () => {
      await limparBanco();
      await nucleo?.encerrar();
      if (criadasPeloTeste) sql(`DROP TABLE IF EXISTS ${TABELAS.join(', ')}`);
    });

    const fabricas: [string, () => FonteCatalogos][] = [
      ['memória', () => new FonteCatalogosMemoria()],
      ['banco', () => new FonteCatalogosPropria(nucleo!, CLIENTE)],
    ];

    describe.each(fabricas)('área de preparação (%s)', (_nome, fabrica) => {
      it('grava a carga com as linhas; lista, lê, pagina e filtra; reimportação só da publicada', async () => {
        const f = fabrica();
        const sha = SHA(Date.now());
        const { id } = await f.gravarCarga(ctx(), preparo(sha), trilha());
        const c = await f.carga(ctx(), id);
        expect(c).toMatchObject({
          id,
          catalogo: 'cid',
          situacao: 'comparada',
          sha256: sha,
          versao: 1,
          totais: { linhas: 3, validas: 2, erros: 1, novos: 1, alterados: 1 },
          lotes: { total: 1, publicados: 0, tamanho: 500 },
          arquivoGuardado: false,
        });
        expect((await f.cargas(ctx(), 'cid'))?.map((x) => x.id)).toContain(id);
        const pg = await f.linhas(ctx(), id, { pagina: 0, porPagina: 2 });
        expect(pg.total).toBe(3);
        expect(pg.itens.map((l) => l.linha)).toEqual([1, 2]);
        expect(pg.itens[0]).toMatchObject({ entidade: 'cid10', comparacao: 'alterado', lote: 1 });
        expect(pg.itens[0]?.depois).toEqual({ nome: 'DOENÇA SINTÉTICA 0 (revista)' });
        const erros = await f.linhas(ctx(), id, { pagina: 0, porPagina: 50, resultado: 'erro' });
        expect(erros.itens.map((l) => l.motivo)).toEqual(['código obrigatório']);
        expect(await f.publicadaComHash(ctx(), 'cid', sha)).toBeNull();
      });

      it('aprovar com a versão lida; versão velha é conflito; situação que não permite é recusada', async () => {
        const f = fabrica();
        const { id } = await f.gravarCarga(ctx(), preparo(SHA(Date.now() + 1)), trilha());
        const aprovar = (versao: number) =>
          f.mudarSituacao(
            ctx(),
            {
              hospital: H,
              id,
              versao,
              de: ['comparada'],
              para: 'aprovada',
              aprovador: LOGIN,
              motivo: 'aprovação de teste',
            },
            trilha('catalogo.carga.aprovada'),
          );
        await aprovar(1);
        const c = await f.carga(ctx(), id);
        expect(c).toMatchObject({ situacao: 'aprovada', versao: 2, motivo: 'aprovação de teste' });
        expect(await falha(aprovar(1))).toEqual({ status: 409, codigo: 'conflito-concorrente' });
        expect(await falha(aprovar(2))).toEqual({ status: 409, codigo: 'situacao-invalida' });
        // Cancelar a aprovada (entre lotes), com o motivo.
        await f.mudarSituacao(
          ctx(),
          {
            hospital: H,
            id,
            versao: 2,
            de: ['aprovada', 'publicando', 'falhou'],
            para: 'cancelada',
            aprovador: LOGIN,
            motivo: 'cancelada no teste',
          },
          trilha('catalogo.carga.rejeitada'),
        );
        expect(await f.carga(ctx(), id)).toMatchObject({ situacao: 'cancelada', versao: 3 });
      });
    });

    describe('contrato de efeito no banco', () => {
      it('preparar: cabeçalho, linhas, versão 1, quem enviou, trilha e idempotência na mesma transação', async () => {
        const f = new FonteCatalogosPropria(nucleo!, CLIENTE);
        const { id } = await f.gravarCarga(ctx(), preparo(SHA(Date.now() + 2)), trilha());
        const [cab, n, trilhas, idem] = await nucleo!.lerSomente(
          { cliente: CLIENTE, correlacao: 'conf-0202' },
          async (l) => [
            await l.uma(
              'SELECT estabelecimento_id, criado_por, versao, situacao, linhas_erro FROM carga_catalogo WHERE id = ?',
              [id],
            ),
            await l.uma<{ n: number; lote: number }>(
              'SELECT COUNT(*) AS n, SUM(lote IS NOT NULL) AS lote FROM carga_catalogo_linha WHERE carga_catalogo_id = ?',
              [id],
            ),
            await l.consultar(
              "SELECT acao FROM trilha_auditoria WHERE entidade = 'carga_catalogo' AND entidade_id = ?",
              [id],
            ),
            await l.uma<{ n: number }>(
              "SELECT COUNT(*) AS n FROM idempotencia_operacao WHERE operacao = 'catalogo.carga.preparar' AND usuario_id = ?",
              [idUsuario],
            ),
          ],
        );
        expect(cab).toMatchObject({ situacao: 'comparada', linhas_erro: 1 });
        expect(Number(cab!['estabelecimento_id'])).toBe(idEstab);
        expect(Number(cab!['criado_por'])).toBe(idUsuario);
        expect(Number(cab!['versao'])).toBe(1);
        expect(Number(n!.n)).toBe(3);
        expect(Number(n!.lote)).toBe(2);
        expect((trilhas as { acao: string }[]).map((x) => x.acao)).toEqual(['inclusao']);
        expect(Number(idem!.n)).toBeGreaterThanOrEqual(1);
        expect((await f.carga(ctx(), id))?.responsavel).toBe(LOGIN);
      });

      it('rejeitada na preparação nasce encerrada; aprovar grava aprovador, data e trilha de alteração', async () => {
        const f = new FonteCatalogosPropria(nucleo!, CLIENTE);
        const r = await f.gravarCarga(ctx(), preparo(SHA(Date.now() + 3), 'rejeitada'), trilha());
        const rej = await nucleo!.lerSomente({ cliente: CLIENTE, correlacao: 'conf-0202' }, (l) =>
          l.uma('SELECT encerrada_em, encerrada_por_usuario_id FROM carga_catalogo WHERE id = ?', [r.id]),
        );
        expect(rej!['encerrada_em']).not.toBeNull();
        expect(Number(rej!['encerrada_por_usuario_id'])).toBe(idUsuario);
        const { id } = await f.gravarCarga(ctx(), preparo(SHA(Date.now() + 4)), trilha());
        await f.mudarSituacao(
          ctx(),
          {
            hospital: H,
            id,
            versao: 1,
            de: ['comparada'],
            para: 'aprovada',
            aprovador: LOGIN,
            motivo: 'aprovada',
          },
          trilha('catalogo.carga.aprovada'),
        );
        const [cab, acoes] = await nucleo!.lerSomente(
          { cliente: CLIENTE, correlacao: 'conf-0202' },
          async (l) => [
            await l.uma(
              'SELECT versao, aprovada_em, aprovada_por_usuario_id, alterado_por FROM carga_catalogo WHERE id = ?',
              [id],
            ),
            await l.consultar(
              "SELECT acao FROM trilha_auditoria WHERE entidade = 'carga_catalogo' AND entidade_id = ? ORDER BY id",
              [id],
            ),
          ],
        );
        expect(Number(cab!['versao'])).toBe(2);
        expect(cab!['aprovada_em']).not.toBeNull();
        expect(Number(cab!['aprovada_por_usuario_id'])).toBe(idUsuario);
        expect(Number(cab!['alterado_por'])).toBe(idUsuario);
        expect((acoes as { acao: string }[]).map((x) => x.acao)).toEqual(['inclusao', 'alteracao']);
        expect((await f.carga(ctx(), id))?.aprovador).toBe(LOGIN);
      });

      it('outro estabelecimento não vê nem muda a carga; entrada inválida não grava; restrição do banco segura', async () => {
        const f = new FonteCatalogosPropria(nucleo!, CLIENTE);
        const { id } = await f.gravarCarga(ctx(), preparo(SHA(Date.now() + 5)), trilha());
        expect(await f.carga(ctx(OUTRO), id)).toBeNull();
        expect((await f.linhas(ctx(OUTRO), id, { pagina: 0, porPagina: 10 })).total).toBe(0);
        expect(
          await falha(
            f.mudarSituacao(
              ctx(OUTRO),
              {
                hospital: OUTRO,
                id,
                versao: 1,
                de: ['comparada'],
                para: 'rejeitada',
                aprovador: LOGIN,
                motivo: 'x',
              },
              trilha(),
            ),
          ),
        ).toMatchObject({ status: 404 });
        expect((await f.carga(ctx(), id))?.situacao).toBe('comparada');
        expect(
          await falha(f.gravarCarga(ctx(), { ...preparo('nao-e-hash'), sha256: 'nao-e-hash' }, trilha())),
        ).toMatchObject({
          status: 400,
        });
        // Totais que não fecham: o CHECK do banco recusa (nada gravado).
        const antes = (await f.cargas(ctx(), 'cid'))?.length ?? 0;
        const ruim = preparo(SHA(Date.now() + 6));
        expect(
          (await falha(f.gravarCarga(ctx(), { ...ruim, totais: { ...ruim.totais, validas: 9 } }, trilha())))
            .status,
        ).toBeGreaterThanOrEqual(400);
        expect((await f.cargas(ctx(), 'cid'))?.length ?? 0).toBe(antes);
      });
    });

    describe('autor, idempotência e trilha', () => {
      it('usuário que não existe no cliente: 403 e nada gravado (nunca carga sem autor)', async () => {
        const f = new FonteCatalogosPropria(nucleo!, CLIENTE);
        const antes = (await f.cargas(ctx(), 'cid'))?.length ?? 0;
        expect(
          await falha(
            f.gravarCarga(
              ctx(),
              preparo(SHA(Date.now() + 7)),
              trilha(undefined, { usuario: 'f22o202.inexistente' }),
            ),
          ),
        ).toEqual({ status: 403, codigo: 'usuario-sem-cadastro' });
        const { id } = await f.gravarCarga(ctx(), preparo(SHA(Date.now() + 8)), trilha());
        expect(
          await falha(
            f.mudarSituacao(
              ctx(),
              {
                hospital: H,
                id,
                versao: 1,
                de: ['comparada'],
                para: 'aprovada',
                aprovador: null,
                motivo: 'x',
              },
              trilha('catalogo.carga.aprovada', { usuario: 'f22o202.inexistente' }),
            ),
          ),
        ).toEqual({ status: 403, codigo: 'usuario-sem-cadastro' });
        expect((await f.carga(ctx(), id))?.situacao).toBe('comparada');
        expect((await f.cargas(ctx(), 'cid'))?.length ?? 0).toBe(antes + 1);
        // O banco também recusa a aprovada sem aprovador (CHECK ck_carga_catalogo_aprovador).
        expect(() =>
          sql(`UPDATE carga_catalogo SET situacao = 'aprovada', aprovada_em = NOW(3) WHERE id = ${id}`),
        ).toThrow();
      });

      it('o mesmo pedido repetido devolve o mesmo id sem duplicar; a trilha leva IP, estação e alvo', async () => {
        const f = new FonteCatalogosPropria(nucleo!, CLIENTE);
        const sha = SHA(Date.now() + 9);
        const t = trilha();
        const a = await f.gravarCarga(ctx(), preparo(sha), t);
        const b = await f.gravarCarga(ctx(), preparo(sha), t);
        expect(b.id).toBe(a.id);
        const ap = trilha('catalogo.carga.aprovada', {
          operacao: 'catalogo.carga.aprovar',
          chaveNaturalAlvo: `CARGA:${a.id}`,
        });
        const m = {
          hospital: H,
          id: a.id,
          versao: 1,
          de: ['comparada'] as const,
          para: 'aprovada' as const,
          aprovador: LOGIN,
          motivo: 'ok',
        };
        await f.mudarSituacao(ctx(), { ...m, de: [...m.de] }, ap);
        await f.mudarSituacao(ctx(), { ...m, de: [...m.de] }, ap);
        const [n, tr] = await nucleo!.lerSomente({ cliente: CLIENTE, correlacao: 'conf-0202' }, async (l) => [
          await l.uma<{ n: number }>('SELECT COUNT(*) AS n FROM carga_catalogo WHERE arquivo_sha256 = ?', [
            sha,
          ]),
          await l.consultar(
            "SELECT acao, endereco_ip, dados_depois FROM trilha_auditoria WHERE entidade = 'carga_catalogo' AND entidade_id = ? ORDER BY id",
            [a.id],
          ),
        ]);
        expect(Number((n as { n: number }).n)).toBe(1);
        expect((await f.carga(ctx(), a.id))?.versao).toBe(2);
        const linhas = tr as { acao: string; endereco_ip: string; dados_depois: unknown }[];
        expect(linhas.map((x) => x.acao)).toEqual(['inclusao', 'alteracao']);
        expect(linhas.every((x) => x.endereco_ip === '127.0.0.1')).toBe(true);
        const dados = (x: unknown) =>
          (typeof x === 'string' ? JSON.parse(x) : x) as { dados: Record<string, unknown> };
        expect(dados(linhas[0]!.dados_depois).dados).toMatchObject({
          estacao: 'TESTE:127.0.0.1',
          chaveNaturalAlvo: 'CATALOGO:cid',
        });
        expect(dados(linhas[1]!.dados_depois).dados).toMatchObject({
          estacao: 'TESTE:127.0.0.1',
          chaveNaturalAlvo: `CARGA:${a.id}`,
          operacaoTela: 'catalogo.carga.aprovar',
        });
      });
    });

    describe('fluxo HTTP real: controller → serviço → fonte própria', () => {
      let app: NestFastifyApplication;
      let chave = 0;
      const env: Record<string, string> = {
        ...envTeste,
        AMBIENTE: 'dev',
        API_MODULOS: 'catalogos',
        ESTABELECIMENTOS: H,
      };
      beforeAll(async () => {
        const fonte = new FonteCatalogosPropria(nucleo!, CLIENTE);
        const registro = {
          ...REGISTRO_MODULOS,
          catalogos: async () => ({ modulo: (c: ContextoModulo) => modulo(c, { fonte }) }),
        } as typeof REGISTRO_MODULOS;
        app = await criarApp(lerConfiguracao(env), null, env, {
          trilha: new RegistradorTrilhaMemoria(),
          registro,
        });
        await app.init();
        await app.getHttpAdapter().getInstance().ready();
      });
      afterAll(async () => {
        await app?.close();
      });
      async function entrar(): Promise<{ cookie: string; csrf: string }> {
        const r = await app.inject({
          method: 'POST',
          url: '/api/sessao',
          payload: { estabelecimento: H, login: LOGIN_HTTP, senha: SENHA },
        });
        expect(r.statusCode).toBe(201);
        const set = r.headers['set-cookie'] as string[];
        return {
          cookie: set.map((c) => c.split(';')[0]).join('; '),
          csrf:
            set
              .find((c) => c.startsWith('sgh_csrf='))
              ?.split(';')[0]
              ?.slice(9) ?? '',
        };
      }
      const post = (
        s: { cookie: string; csrf: string },
        url: string,
        payload: unknown,
        k = `f22-0202-http-${++chave}-${Date.now()}`,
      ) =>
        app.inject({
          method: 'POST',
          url,
          headers: { cookie: s.cookie, 'x-csrf': s.csrf, 'idempotency-key': k },
          payload: payload as Record<string, unknown>,
        });

      it('SIGTAP: envio, detalhe, aprovação com a senha e reenvios idempotentes, gravados no banco', async () => {
        const s = await entrar();
        const ultima =
          (await new FonteCatalogosPropria(nucleo!, CLIENTE).leituraDoBanco(ctx(), 'sigtap').edicao())
            .ultima ?? '202609';
        const a = Number(ultima.slice(0, 4));
        const m = Number(ultima.slice(4, 6));
        const competencia = m === 12 ? `${a + 1}01` : `${a}${String(m + 1).padStart(2, '0')}`;
        const envio = {
          catalogo: 'sigtap',
          arquivos: [
            {
              nome: 'tb_procedimento.txt',
              conteudo: arquivoTbProcedimento([
                { codigo: '9999990001', nome: 'CONSULTA SINTÉTICA REVISTA', competencia, valorSa: 13 },
                { codigo: '9999990002', nome: 'NOVO SINTÉTICO', competencia, valorSa: 1 },
              ]),
            },
          ],
        };
        const k = `f22-0202-envio-${Date.now()}`;
        const r = await post(s, '/api/catalogos/cargas', envio, k);
        expect(r.statusCode, r.body).toBe(201);
        expect(r.json()).toMatchObject({
          situacao: 'comparada',
          lotes: 1,
          totais: { linhas: 2, novos: 1, alterados: 1 },
        });
        const id = r.json().id as number;
        const r2 = await post(s, '/api/catalogos/cargas', envio, k);
        expect(r2.statusCode).toBe(201);
        expect(r2.json().id).toBe(id);
        const d = await app.inject({
          method: 'GET',
          url: `/api/catalogos/cargas/${id}`,
          headers: { cookie: s.cookie },
        });
        expect(d.statusCode).toBe(200);
        expect(d.json().publicacao).toEqual({ pode: true, motivo: null });
        const alterada = d.json().linhas.find((x: { comparacao: string }) => x.comparacao === 'alterado');
        expect(alterada.antes).toMatchObject({ codigo: '9999990001', nome: 'Consulta sintética' });
        expect(alterada.depois).toMatchObject({ nome: 'CONSULTA SINTÉTICA REVISTA' });
        const corpo = {
          justificativa: 'competência sintética do teste',
          senha: SENHA,
          versao: d.json().versao as number,
        };
        const ka = `f22-0202-aprovar-${Date.now()}`;
        const ap = await post(s, `/api/catalogos/cargas/${id}/aprovar`, corpo, ka);
        expect(ap.statusCode, ap.body).toBe(200);
        expect(ap.json()).toMatchObject({ id, situacao: 'aprovada' });
        const ap2 = await post(s, `/api/catalogos/cargas/${id}/aprovar`, corpo, ka);
        expect(ap2.statusCode, ap2.body).toBe(200);
        expect(ap2.json()).toMatchObject({ id });
        // Outro pedido com a versão velha: conflito.
        expect((await post(s, `/api/catalogos/cargas/${id}/aprovar`, corpo)).statusCode).toBe(409);
        const cab = await nucleo!.lerSomente({ cliente: CLIENTE, correlacao: 'conf-0202' }, (l) =>
          l.uma(
            `SELECT situacao, versao, aprovada_por_usuario_id, criado_por,
             (SELECT COUNT(*) FROM carga_catalogo x WHERE x.arquivo_sha256 = c.arquivo_sha256 AND x.estabelecimento_id = c.estabelecimento_id) AS iguais
             FROM carga_catalogo c WHERE id = ?`,
            [id],
          ),
        );
        expect(cab).toMatchObject({ situacao: 'aprovada' });
        expect(Number(cab!['versao'])).toBe(2);
        expect(Number(cab!['iguais'])).toBe(1);
        expect(Number(cab!['aprovada_por_usuario_id'])).toBe(idUsuarioHttp);
        expect(Number(cab!['criado_por'])).toBe(idUsuarioHttp);
      });

      it('linha gigante (chave muito maior que o código): carga gravada com a linha de erro e o corte no motivo', async () => {
        const s = await entrar();
        const conteudo = arquivoCodigoNome('CODIGO;TITULO', [
          { codigo: '999901', nome: 'OCUPACAO SINTETICA' },
          { codigo: '9'.repeat(5000), nome: 'LINHA FUNDIDA' },
        ]);
        const r = await post(s, '/api/catalogos/cargas', {
          catalogo: 'cbo',
          arquivos: [{ nome: 'CBO2002 - Ocupacao.csv', conteudo }],
        });
        expect(r.statusCode, r.body).toBe(201);
        expect(r.json().totais).toMatchObject({ linhas: 2, erros: 1 });
        const id = r.json().id as number;
        const d = await app.inject({
          method: 'GET',
          url: `/api/catalogos/cargas/${id}?resultado=erro`,
          headers: { cookie: s.cookie },
        });
        expect(d.statusCode).toBe(200);
        const [erro] = d.json().linhas as { chave: string; motivo: string }[];
        expect(erro!.chave.length).toBe(200);
        expect(erro!.motivo).toContain('chave cortada em 200');
      });

      it('sem Idempotency-Key: 400 e nada gravado', async () => {
        const s = await entrar();
        const r = await app.inject({
          method: 'POST',
          url: '/api/catalogos/cargas',
          headers: { cookie: s.cookie, 'x-csrf': s.csrf },
          payload: {
            catalogo: 'cbo',
            arquivos: [{ nome: 'CBO2002 - Ocupacao.csv', conteudo: 'CODIGO;TITULO\n999902;X' }],
          },
        });
        expect(r.statusCode).toBe(400);
      });
    });

    describe('consultas, edição, histórico, licença e responsável', () => {
      it('consulta no servidor pela tabela própria; fora do mapa, null; leiaute do produto', async () => {
        const f = new FonteCatalogosPropria(nucleo!, CLIENTE);
        const cid = await f.consultar(ctx(), 'cid10', { busca: 'U99X', pagina: 0, porPagina: 10 });
        expect(cid?.itens).toEqual([{ codigo: 'U99X', nome: 'Doença sintética de consulta', ativo: 1 }]);
        const trecho = await f.consultar(ctx(), 'cid10', {
          busca: 'sintetica de consul',
          pagina: 0,
          porPagina: 10,
        });
        expect(trecho?.itens.map((x) => x['codigo'])).toContain('U99X');
        const proc = await f.consultar(ctx(), 'procedimento', {
          busca: '99.99.99.0001',
          pagina: 0,
          porPagina: 10,
          competencia: '202609',
        });
        expect(proc?.itens.map((x) => x['codigo'])).toEqual(['9999990001']);
        expect(await f.consultar(ctx(), 'motivoGlosa', { busca: null, pagina: 0, porPagina: 10 })).toBeNull();
        expect(await f.consultar(ctx(), 'constructor', { busca: null, pagina: 0, porPagina: 10 })).toBeNull();
        const leiaute = await f.consultar(ctx(), 'leiautePosicao', {
          busca: null,
          pagina: 0,
          porPagina: 500,
        });
        expect(leiaute?.total).toBeGreaterThan(0);
        expect((await f.leiauteCep()).length).toBeGreaterThan(0);
      });

      it('histórico SIGTAP por competência; edição no banco; sem licença, catálogo licenciado fechado', async () => {
        const f = new FonteCatalogosPropria(nucleo!, CLIENTE);
        const h = await f.historico(ctx(), '9999990001');
        expect(h?.nome).toBe('Consulta sintética');
        expect(h?.competencias.map((c) => [c.competencia, c.valorSa])).toEqual([
          ['202609', 12.5],
          ['202608', 10],
        ]);
        expect(h?.competencias[0]?.atributos).toMatchObject({ sexo: 'ambos', idadeMinimaMeses: 0 });
        expect(await f.historico(ctx(), '0000000000')).toBeNull();
        const e = await f.edicao(ctx(), 'sigtap');
        expect(e.descricao).toBe('competência');
        expect(e.linhas).toBeGreaterThanOrEqual(1);
        expect(await f.edicao(ctx(), 'brasindice')).toEqual({
          ultima: null,
          descricao: 'sem tabela própria',
          linhas: 0,
        });
        expect(await f.contrato(ctx(), 'brasindice')).toBe(false);
        expect(await f.responsavel()).toBe('novo');
      });

      it('leitura para a comparação: mapa ao modelo próprio no vocabulário do contrato; sem mapa, recusa com o motivo', async () => {
        const f = new FonteCatalogosPropria(nucleo!, CLIENTE);
        const cid = f.leituraDoBanco(ctx(), 'cid');
        expect([...(await cid.atuais('cid10', ['codigo=U99X', 'codigo=U99Y']))]).toEqual([
          ['codigo=U99X', { codigo: 'U99X', nome: 'Doença sintética de consulta' }],
        ]);
        expect([...((await cid.existentes('cid10', new Map())) ?? [])]).toContain('codigo=U99X');
        expect(await cid.referencias!('cid10', ['U99X', 'U99Y'])).toEqual(new Set(['U99X']));
        expect(await falha(cid.atuais('ciap', ['codigo=A01']))).toEqual({
          status: 409,
          codigo: 'catalogo-sem-mapa',
        });
        const sus = f.leituraDoBanco(ctx(), 'sigtap');
        expect((await sus.edicao()).ultima).toMatch(/^\d{6}$/);
        const proc = await sus.atuais('procedimento', ['codigo=9999990001']);
        expect(proc.get('codigo=9999990001')).toMatchObject({
          codigo: '9999990001',
          nome: 'Consulta sintética',
          idadeMinima: 0,
        });
        expect(await sus.referencias!('procedimentoSigtap', ['9999990001', '0000000000'])).toEqual(
          new Set(['9999990001']),
        );
        expect(await falha(f.leituraDoBanco(ctx(), 'tuss').edicao())).toEqual({
          status: 409,
          codigo: 'catalogo-sem-mapa',
        });
      });
    });
  },
);
