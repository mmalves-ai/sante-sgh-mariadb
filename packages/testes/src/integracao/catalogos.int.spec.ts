// Integração do M13 na cópia (ficha, seção 10), sempre na transação desfeita (ROLLBACK): cada importador com
// arquivo SINTÉTICO no leiaute oficial lido, validado e comparado sobre o banco real (as leituras do catálogo), a
// carga na área de preparação, a publicação em lotes pelo executor, a retomada depois de um lote recusado e a
// reimportação sem efeito; e a carga de muitos CEPs sintéticos em lotes de 500 (tempo de cada lote e leitura
// concorrente por outra conexão). Saída só com contagens e tempos; nenhum dado de pessoa.
// Prova do ROLLBACK: o retrato (COUNT e maior chave) das tabelas que as cargas tocam, lido FORA da transação,
// igual antes e depois dos casos (diferença zero). Os geradores (gen_tbvlrsus_id, gen_tbcbosus_id, o da
// SGH_CAT_CARGA…) avançam mesmo com o ROLLBACK: é o comportamento do Firebird (registrado nas evidências).
// Também: os pares SIGTAP de procedimento novo e de CID inexistente não entram na publicação (a carga termina
// "publicada"); a SGH_CAT_CARGA compartilhada com o M12 não mistura as cargas dos dois módulos; e toda consulta
// do M13 roda na cópia.
import { definicaoCatalogo, type DefinicaoCatalogo, type ItemLoteCatalogo } from '@sgh/contratos';
import {
  arquivoBaseCep,
  arquivoCodigoNome,
  arquivoRelacaoCid,
  arquivoTbProcedimento,
  cepsSinteticos,
  type LeituraDoBanco,
  prepararCarga,
} from '@sgh/dominio-catalogo';
import {
  chavesExistentesDoCatalogo,
  codigosReferenciadosExistentes,
  CONSULTAS,
  consultarCatalogo,
  edicaoNoBanco,
  ErroOperacao,
  type Escritor,
  itensAtuaisDoCatalogo,
  leiauteCepDoBanco,
  lerCarga,
  lerCargaCatalogo,
  type Leitor,
  operacao,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cargaAprovadaSintetica, MARCA_M13 } from '../massa/reproducao-catalogos.js';
import {
  type Ambiente,
  contar,
  ctx,
  ctxOperacao,
  PODE_ESCREVER,
  prepararAmbiente,
} from './escrita.spec-util.js';

const VOLUME_CEP = Number(process.env['CEP_VOLUME'] ?? '20000');

const banco = (e: Escritor, catalogo: string): LeituraDoBanco => ({
  atuais: (ent, chaves) => itensAtuaisDoCatalogo(e, ent, chaves),
  existentes: (ent, escopo) => chavesExistentesDoCatalogo(e, ent, escopo),
  edicao: () => edicaoNoBanco(e, catalogo),
  referencias: (tabela, codigos) => codigosReferenciadosExistentes(e, tabela, codigos),
});

/** Tabelas que as cargas do M13 tocam: contagem e maior chave (nenhum dado de linha). */
const RETRATO: readonly [tabela: string, chave: string][] = [
  ['TBCBOSUS', 'ID'],
  ['TBPROSUS', 'ID'],
  ['TBVLRSUS', 'ID'],
  ['HTPROSUS', 'ANO_MES_COMPETENCIA'],
  ['TBSUSCID', 'ID_TBPROSUS'],
  ['TBCEP', 'CEP'],
  ['TBSUSCEP', 'CEP'],
  ['SGH_CAT_CARGA', 'ID'],
  ['SGH_CAT_CARGA_LINHA', 'ID_CARGA'],
  ['SGH_CFG_LIBERACAO', 'ID'],
];
async function retrato(l: Leitor): Promise<Record<string, string>> {
  const r: Record<string, string> = {};
  for (const [t, k] of RETRATO) {
    const [x] = await l.consultar(`SELECT COUNT(*) N, CAST(MAX(${k}) AS VARCHAR(30)) M FROM ${t}`, [], {
      teto: 1,
      tempoMaximoMs: 120_000,
    });
    r[t] = `${String(x?.['N'])}/${String(x?.['M'] ?? '').trim()}`;
  }
  return r;
}
function diferencas(a: Record<string, string>, b: Record<string, string>): string[] {
  return Object.keys(a).filter((k) => a[k] !== b[k]);
}

async function codigo(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'gravou';
  } catch (e) {
    if (e instanceof ErroOperacao) return e.problema.codigo ?? 'sem-codigo';
    throw e;
  }
}

describe.skipIf(!PODE_ESCREVER)('M13 na cópia (transações desfeitas)', () => {
  let a: Ambiente;
  let antes: Record<string, string>;
  beforeAll(async () => {
    a = await prepararAmbiente();
    antes = await a.nucleo.lerSomente(ctx(a), retrato);
  }, 300_000);
  afterAll(async () => {
    if (a) {
      // Prova do ROLLBACK: nada ficou nas tabelas tocadas (lido fora das transações desfeitas).
      const depois = await a.nucleo.lerSomente(ctx(a), retrato);
      const d = diferencas(antes, depois);
      console.log(`[M13] retrato depois dos ROLLBACKs: ${d.length} diferença(s)`);
      expect(d).toEqual([]);
    }
    await a?.nucleo.encerrar();
  }, 300_000);

  /** Prepara, grava a carga aprovada (com as linhas e os lotes) e publica os lotes pelo executor, no escritor. */
  async function publicar(
    e: Escritor,
    def: DefinicaoCatalogo,
    arquivos: { nome: string; conteudo: string }[],
    edicao: string | null,
    tamanho = 500,
  ) {
    const leiauteCep = def.codigo === 'cep' ? await leiauteCepDoBanco(e) : undefined;
    const prep = await prepararCarga(def, arquivos, edicao, banco(e, def.codigo), {
      ...(leiauteCep ? { leiauteCep } : {}),
      tamanhoLote: tamanho,
    });
    expect(prep.errosArquivo).toEqual([]);
    const id = await cargaAprovadaSintetica(e, {
      hospital: a.cod,
      rede: a.nucleo.rede,
      catalogo: def.codigo,
      contrato: def.exigeContrato,
    });
    await e.executar(
      'UPDATE SGH_CAT_CARGA SET LOTES_TOTAL = ? WHERE ID = CAST(CAST(? AS VARCHAR(20)) AS BIGINT)',
      [prep.lotes, String(id)],
    );
    const tempos: number[] = [];
    for (let l = 0; l < prep.lotes; l++) {
      const itens: ItemLoteCatalogo[] = prep.aPublicar.slice(l * tamanho, (l + 1) * tamanho);
      const inicio = performance.now();
      await a.executor.executar(
        operacao(def.operacao),
        a.cod,
        { carga: id, lote: l + 1, lotes: prep.lotes, edicao: prep.edicao, sha256: 'ab'.repeat(32), itens },
        ctxOperacao(a, 'SGH.M13'),
        { escritor: e },
      );
      tempos.push(Math.round(performance.now() - inicio));
    }
    return { prep, id, tempos };
  }

  it('CBO: arquivo sintético no leiaute oficial, comparação com o banco real, publicação e reimportação sem efeito', async () => {
    const def = definicaoCatalogo('cbo') as DefinicaoCatalogo;
    await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const [x] = await e.consultar('SELECT FIRST 1 COD, DESCRICAO FROM TBCBOSUS ORDER BY ID', [], {
        teto: 1,
      });
      const existente = String(x?.['COD']).trim();
      const conteudo = arquivoCodigoNome('CODIGO;TITULO', [
        { codigo: existente, nome: `${MARCA_M13} ALTERADO` },
        { codigo: '999998', nome: `${MARCA_M13} NOVO` },
        { codigo: '999998', nome: 'DUPLICADO' },
      ]);
      // Duplicado: a validação recusa a linha (nada é publicado com erro).
      const comErro = await prepararCarga(
        def,
        [{ nome: 'CBO2002 - Ocupacao.csv', conteudo }],
        null,
        banco(e, 'cbo'),
      );
      expect(comErro.totais.erros).toBe(1);
      expect(comErro.aPublicar).toEqual([]);
      const limpo = conteudo.split('\n').slice(0, 3).join('\n');
      const { prep } = await publicar(e, def, [{ nome: 'CBO2002 - Ocupacao.csv', conteudo: limpo }], null);
      expect(prep.totais).toMatchObject({ novos: 1, alterados: 1 });
      expect(await contar(e, "SELECT COUNT(*) N FROM TBCBOSUS WHERE COD = '999998'")).toBe(1);
      // Reimportação do mesmo conteúdo: tudo igual, nada a publicar.
      const de_novo = await prepararCarga(
        def,
        [{ nome: 'CBO2002 - Ocupacao.csv', conteudo: limpo }],
        null,
        banco(e, 'cbo'),
      );
      expect(de_novo.totais).toMatchObject({ novos: 0, alterados: 0, iguais: 2 });
      expect(de_novo.aPublicar).toEqual([]);
    });
  });

  it('SIGTAP: competência seguinte em lotes de 2, retomada pelo lote seguinte depois de um lote recusado', async () => {
    const def = definicaoCatalogo('sigtap') as DefinicaoCatalogo;
    await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const procs = await e.consultar(
        'SELECT FIRST 5 CODSUS, NOME FROM TBPROSUS WHERE COMP_FINAL = 201311 ORDER BY ID',
        [],
        { teto: 5 },
      );
      const conteudo = arquivoTbProcedimento(
        procs.map((p, i) => ({
          codigo: String(p['CODSUS']).trim(),
          nome: String(p['NOME'] ?? ''),
          competencia: '201312',
          valorSa: 10 + i,
        })),
      );
      const prep = await prepararCarga(
        def,
        [{ nome: 'tb_procedimento.txt', conteudo }],
        null,
        banco(e, 'sigtap'),
        { tamanhoLote: 2 },
      );
      expect(prep.edicao).toBe('201312');
      expect(prep.lotes).toBe(3);
      const id = await cargaAprovadaSintetica(e, {
        hospital: a.cod,
        rede: a.nucleo.rede,
        catalogo: 'sigtap',
        contrato: false,
      });
      await e.executar(
        'UPDATE SGH_CAT_CARGA SET LOTES_TOTAL = 3 WHERE ID = CAST(CAST(? AS VARCHAR(20)) AS BIGINT)',
        [String(id)],
      );
      const lote = (n: number) => ({
        carga: id,
        lote: n,
        lotes: 3,
        edicao: '201312',
        sha256: 'ab'.repeat(32),
        itens: prep.aPublicar.slice((n - 1) * 2, n * 2),
      });
      await a.executor.executar(operacao(def.operacao), a.cod, lote(1), ctxOperacao(a, 'SGH.M13'), {
        escritor: e,
      });
      // Lote 3 antes do 2: recusado (retomada só pelo lote seguinte ao último confirmado).
      expect(
        await codigo(
          a.executor.executar(operacao(def.operacao), a.cod, lote(3), ctxOperacao(a, 'SGH.M13'), {
            escritor: e,
          }),
        ),
      ).toBe('lote-fora-de-ordem');
      await a.executor.executar(operacao(def.operacao), a.cod, lote(2), ctxOperacao(a, 'SGH.M13'), {
        escritor: e,
      });
      await a.executor.executar(operacao(def.operacao), a.cod, lote(3), ctxOperacao(a, 'SGH.M13'), {
        escritor: e,
      });
      const [c] = await e.consultar(
        'SELECT SITUACAO, LOTES_PUBLICADOS FROM SGH_CAT_CARGA WHERE ID = CAST(CAST(? AS VARCHAR(20)) AS BIGINT)',
        [String(id)],
        { teto: 1 },
      );
      expect(c).toMatchObject({ SITUACAO: 'publicada', LOTES_PUBLICADOS: 3 });
      expect(await contar(e, 'SELECT COUNT(*) N FROM HTPROSUS WHERE ANO_MES_COMPETENCIA = 201312')).toBe(
        procs.length,
      );
      expect(await contar(e, "SELECT COUNT(*) N FROM TBVLRSUS WHERE DATA = '2013-12-01'")).toBe(procs.length);
    });
  });

  it('SIGTAP: pares de procedimento novo e de CID inexistente ficam de fora; a carga termina publicada', async () => {
    const def = definicaoCatalogo('sigtap') as DefinicaoCatalogo;
    await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const procs = await e.consultar(
        'SELECT FIRST 2 CODSUS, NOME FROM TBPROSUS WHERE COMP_FINAL = 201311 ORDER BY ID',
        [],
        { teto: 2 },
      );
      const [cid] = await e.consultar(
        'SELECT FIRST 1 c.COD FROM TBCID10 c WHERE CHAR_LENGTH(TRIM(c.COD)) = 4 ORDER BY c.ID',
        [],
        { teto: 1 },
      );
      const cod = (x: unknown) => String(x).trim();
      const novo = '0399999998';
      // CID no formato válido que o banco não tem (conferido aqui).
      const candidatos = ['U989', 'U979', 'U969', 'U959'];
      const tem = new Set(
        (
          await e.consultar(
            `SELECT COD FROM TBCID10 WHERE COD IN (${candidatos.map(() => '?').join(', ')})`,
            candidatos,
            {
              teto: 10,
            },
          )
        ).map((x) => cod(x['COD'])),
      );
      const cidAusente = candidatos.find((x) => !tem.has(x)) ?? 'U989';
      const conteudo = arquivoTbProcedimento([
        ...procs.map((p) => ({
          codigo: cod(p['CODSUS']),
          nome: String(p['NOME'] ?? ''),
          competencia: '201312',
        })),
        { codigo: novo, nome: `${MARCA_M13} NOVO`, competencia: '201312' },
      ]);
      const pares = arquivoRelacaoCid(
        [
          { procedimento: cod(procs[0]?.['CODSUS']), cid: cod(cid?.['COD']) },
          { procedimento: novo, cid: cod(cid?.['COD']) },
          { procedimento: cod(procs[1]?.['CODSUS']), cid: cidAusente },
        ],
        '201312',
      );
      const { prep, id } = await publicar(
        e,
        def,
        [
          { nome: 'tb_procedimento.txt', conteudo },
          { nome: 'rl_procedimento_cid.txt', conteudo: pares },
        ],
        null,
        2,
      );
      const naoIncluidos = prep.linhas.filter(
        (l) => l.entidade === 'procedimentoCid' && !l.publicar && l.motivos.join(' ').includes('não existe'),
      );
      expect(prep.totais.erros).toBe(0);
      expect(naoIncluidos).toHaveLength(2);
      const [c] = await e.consultar(
        'SELECT SITUACAO FROM SGH_CAT_CARGA WHERE ID = CAST(CAST(? AS VARCHAR(20)) AS BIGINT)',
        [String(id)],
        { teto: 1 },
      );
      expect(String(c?.['SITUACAO']).trim()).toBe('publicada');
    });
  });

  it('SGH_CAT_CARGA compartilhada: carga de preço não é lida pelo M13, e a de catálogo não é lida pelo M12', async () => {
    await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const [g] = await e.consultar(
        'SELECT CAST(NEXT VALUE FOR SGH_GEN_CAT_CARGA AS VARCHAR(20)) ID FROM RDB$DATABASE',
        [],
        { teto: 1 },
      );
      const preco = Number(g?.['ID']);
      await e.executar(
        `INSERT INTO SGH_CAT_CARGA (ID, HOSPITAL, CATALOGO, ARQUIVO_NOME, ARQUIVO_SHA256, ARQUIVO_BYTES, SITUACAO, RESPONSAVEL)
         VALUES (CAST(CAST(? AS VARCHAR(20)) AS BIGINT), ?, 'preco.honorarios', ?, ?, 1, 'comparada', 'SGH.M13')`,
        [String(preco), a.cod, `${MARCA_M13}.csv`, 'cd'.repeat(32)],
      );
      const catalogo = await cargaAprovadaSintetica(e, {
        hospital: a.cod,
        rede: a.nucleo.rede,
        catalogo: 'cbo',
        contrato: false,
      });
      expect(await lerCargaCatalogo(e, a.cod, preco)).toBeNull();
      expect(await lerCarga(e, a.cod, preco)).not.toBeNull();
      expect(await lerCarga(e, a.cod, catalogo)).toBeNull();
      expect(await lerCargaCatalogo(e, a.cod, catalogo)).not.toBeNull();
    });
  });

  it('toda consulta do M13 roda na cópia (paginada; só contagens)', async () => {
    const tempos: number[] = [];
    let comLinhas = 0;
    await a.nucleo.lerSomente(ctx(a), async (l) => {
      for (const ent of Object.keys(CONSULTAS)) {
        const ini = performance.now();
        const r = await consultarCatalogo(l, ent, { busca: null, pagina: 0, porPagina: 5 });
        tempos.push(performance.now() - ini);
        expect(r, ent).not.toBeNull();
        if ((r?.total ?? 0) > 0) comLinhas++;
      }
      // Busca de CEP com hífen e competência SIGTAP: o filtro roda.
      await consultarCatalogo(l, 'cep', { busca: '01001-000', pagina: 0, porPagina: 5 });
      await consultarCatalogo(l, 'procedimento', {
        busca: null,
        pagina: 0,
        porPagina: 5,
        competencia: '201311',
      });
    });
    const ord = [...tempos].sort((x, y) => x - y);
    console.log(
      `[M13] consultas: ${tempos.length} tabelas, ${comLinhas} com linhas; p95 ${Math.round(ord[Math.floor(ord.length * 0.95)] ?? 0)} ms; maior ${Math.round(ord.at(-1) ?? 0)} ms`,
    );
  }, 600_000);

  it(`CEP: ${VOLUME_CEP} CEPs sintéticos em lotes de 500; leitura concorrente não espera`, async () => {
    const def = definicaoCatalogo('cep') as DefinicaoCatalogo;
    const ceps = cepsSinteticos(VOLUME_CEP, 'RJ').map((c, i) => ({
      ...c,
      cep: String(10_000_000 + i).padStart(8, '0'),
      cidade: 'CIDADE SINTETICA',
    }));
    // Faixa sintética: nenhum desses CEPs existe hoje (conferido antes).
    const existentes = await a.nucleo.lerSomente(ctx(a), (l) =>
      contar(l, 'SELECT COUNT(*) N FROM TBCEP WHERE CEP BETWEEN ? AND ?', [
        10_000_000,
        10_000_000 + VOLUME_CEP,
      ]),
    );
    const leituras: number[] = [];
    await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const conteudo = arquivoBaseCep(ceps, []);
      const leitor = setInterval(() => {
        const ini = performance.now();
        void a.nucleo
          .lerSomente(ctx(a), (l) => contar(l, 'SELECT COUNT(*) N FROM TBCEP WHERE CEP = ?', [28010000]))
          .then(() => leituras.push(performance.now() - ini));
      }, 500);
      try {
        const { prep, tempos } = await publicar(e, def, [{ nome: 'LOG_RJ.TXT', conteudo }], null, 500);
        expect(prep.totais.novos).toBe(VOLUME_CEP - existentes);
        const maior = Math.max(...tempos);
        const media = tempos.reduce((s, x) => s + x, 0) / tempos.length;
        console.log(
          `[M13] CEP: ${tempos.length} lotes de 500; lote médio ${Math.round(media)} ms; maior ${maior} ms`,
        );
        expect(maior).toBeLessThan(10_000);
      } finally {
        clearInterval(leitor);
      }
    });
    const maiorLeitura = leituras.length ? Math.max(...leituras) : 0;
    console.log(`[M13] leituras concorrentes: ${leituras.length}; maior ${Math.round(maiorLeitura)} ms`);
    expect(maiorLeitura).toBeLessThan(2_000);
  }, 1_800_000);
});
