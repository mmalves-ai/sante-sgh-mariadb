// Reprodução dos cenários de assinatura das cargas de catálogo (M13; ficha, seção 9): na transação da captura
// (sempre desfeita), a preparação liga o importador do catálogo no estabelecimento (chave de funcionalidade e,
// no Brasíndice e no Simpro, o contrato de dados), cria a carga aprovada em SGH_CAT_CARGA e monta o lote com
// itens REAIS da cópia (só códigos e nomes de referência em memória, alterados com a marca "SGH M13") e códigos
// SINTÉTICOS livres para os itens novos. O lote vai pelo executor; as tabelas grandes são retratadas pelas
// chaves-alvo do cenário.
import {
  aplicarLoteLiberacao,
  type ChavesAlvo,
  type CenarioCaptura,
  dataParam,
  type Escritor,
  gravarCargaCatalogo,
  gravarPrerequisito,
  mudarSituacaoCargaCatalogo,
} from '@sgh/legado';
import {
  chaveResponsavelCatalogo,
  type CodigoCatalogo,
  type ItemLoteCatalogo,
  type LoteCatalogo,
} from '@sgh/contratos';

export const MARCA_M13 = 'SGH M13';
const SHA = 'ab'.repeat(32);

type Executar = (e: Escritor, entrada: unknown) => Promise<unknown>;
type Exigir = (p: Promise<unknown>, codigo: string) => Promise<void>;

const CATALOGO_DA_OPERACAO: Readonly<Record<string, CodigoCatalogo>> = {
  'catalogo.importarCid': 'cid',
  'catalogo.importarSigtap': 'sigtap',
  'catalogo.importarTuss': 'tuss',
  'catalogo.importarCep': 'cep',
  'catalogo.importarCbo': 'cbo',
  'catalogo.importarListasOficiais': 'listas',
  'catalogo.importarDominiosSus': 'dominiosSus',
  'catalogo.importarSpedContabil': 'spedContabil',
  'catalogo.importarFiscal': 'fiscal',
  'catalogo.importarBrasindice': 'brasindice',
  'catalogo.importarSimpro': 'simpro',
  'operadora.importarCatalogoAns': 'ans',
  // M48 (etapa 4): a lista nacional de notificação compulsória.
  'catalogo.importarAgravos': 'agravos',
};
export const OPERACOES_REPRODUCAO_CATALOGOS = new Set(Object.keys(CATALOGO_DA_OPERACAO));

const trilha = (hospital: string, rede: string) => ({
  rede,
  hospital,
  usuario: 'SGH.REPRODUCAO',
  evento: 'config.liberacao.alterada',
  recurso: 'config.liberacao',
  operacao: 'reproducao.catalogo',
  chaveNaturalAlvo: null,
  resultado: 'sucesso',
  estacao: null,
  correlacao: 'reproducao-catalogo',
});

/** Liga o importador do catálogo (e o contrato de dados), e cria a carga aprovada de 1 lote. */
export async function cargaAprovadaSintetica(
  e: Escritor,
  p: {
    readonly hospital: string;
    readonly rede: string;
    readonly catalogo: CodigoCatalogo;
    readonly contrato: boolean;
    readonly ligar?: boolean;
  },
): Promise<number> {
  const chave = chaveResponsavelCatalogo(p.catalogo);
  if (p.ligar !== false)
    await aplicarLoteLiberacao(
      e,
      {
        hospital: p.hospital,
        tipo: 'recurso',
        chave,
        planejar: () => [{ escopo: 'hospital', valor: '*', ligada: true, antes: null }],
        justificativa: `${MARCA_M13}: reprodução`,
        autor: 'SGH.REPRODUCAO',
      },
      trilha(p.hospital, p.rede),
    );
  if (p.contrato)
    await gravarPrerequisito(
      e,
      {
        hospital: p.hospital,
        recurso: chave,
        tipo: 'contrato',
        situacao: 'cumprido',
        validade: null,
        evidencia: `${MARCA_M13}: contrato sintético`,
        autor: 'SGH.REPRODUCAO',
      },
      trilha(p.hospital, p.rede),
    );
  const { id } = await gravarCargaCatalogo(
    e,
    {
      hospital: p.hospital,
      catalogo: p.catalogo,
      arquivo: `${MARCA_M13}.txt`,
      sha256: SHA,
      bytes: 1,
      arquivoS3: null,
      situacao: 'comparada',
      edicao: null,
      responsavel: 'SGH.REPRODUCAO',
      motivo: null,
      totais: { linhas: 1, validas: 1, erros: 0, novos: 0, removidos: 0, alterados: 0, iguais: 0 },
      lotes: { total: 1, tamanho: 500 },
      linhas: [],
    },
    { ...trilha(p.hospital, p.rede), evento: 'catalogo.carga.preparada', recurso: 'catalogo.carga' },
  );
  await mudarSituacaoCargaCatalogo(
    e,
    {
      hospital: p.hospital,
      id,
      versao: 1,
      de: ['comparada'],
      para: 'aprovada',
      aprovador: 'SGH.REPRODUCAO',
      motivo: null,
    },
    { ...trilha(p.hospital, p.rede), evento: 'catalogo.carga.aprovada', recurso: 'catalogo.carga' },
  );
  return id;
}

const lote = (carga: number, edicao: string | null, itens: ItemLoteCatalogo[]): LoteCatalogo => ({
  carga,
  lote: 1,
  lotes: 1,
  edicao,
  sha256: SHA,
  itens,
});
const alterar = (
  entidade: string,
  chave: Record<string, string>,
  valores: Record<string, string | number | null>,
  antes?: Record<string, string | number | null>,
): ItemLoteCatalogo => ({
  entidade,
  acao: 'alterar',
  chave,
  valores,
  ...(antes ? { antes } : {}),
});
const incluir = (
  entidade: string,
  chave: Record<string, string>,
  valores: Record<string, string | number | null>,
): ItemLoteCatalogo => ({
  entidade,
  acao: 'incluir',
  chave,
  valores,
});
const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v).trimEnd());
const marcado = (nome: unknown, max: number) => `${MARCA_M13} ${txt(nome)}`.slice(0, max).trimEnd();

async function linhas(e: Escritor, sql: string, p: unknown[] = [], teto = 20) {
  return e.consultar(sql, p, { teto, tempoMaximoMs: 120_000 });
}

/** Primeiro inteiro livre a partir de `de` (descendo até `ate`) numa coluna. */
async function livre(
  e: Escritor,
  tabela: string,
  coluna: string,
  de: number,
  ate: number,
  filtro = '',
): Promise<number> {
  const usados = new Set(
    (
      await linhas(
        e,
        `SELECT ${coluna} C FROM ${tabela} WHERE ${coluna} BETWEEN ? AND ?${filtro}`,
        [ate, de],
        5000,
      )
    ).map((r) => Number(r['C'])),
  );
  for (let x = de; x >= ate; x--) if (!usados.has(x)) return x;
  throw new Error(`Sem código livre em ${tabela}.${coluna}.`);
}

/** Monta o cenário da carga de catálogo (preparar e executar na transação da captura). */
export function cenarioDeCatalogo(
  nome: string,
  cenario: string,
  base: Pick<CenarioCaptura, 'operacao' | 'cenario' | 'tabelas'>,
  c: { readonly hospital: string; readonly rede: string },
  executar: Executar,
  exigirRecusa: Exigir,
  prepararOperador: (e: Escritor) => Promise<void>,
): CenarioCaptura {
  const catalogo = CATALOGO_DA_OPERACAO[nome];
  if (!catalogo) throw new Error(`Operação ${nome} sem catálogo.`);
  const contrato = catalogo === 'brasindice' || catalogo === 'simpro';
  let entrada: LoteCatalogo | null = null;
  let recusas: { entrada: unknown; codigo: string }[] = [];
  let alvos: Record<string, Record<string, unknown>[]> = {};
  return {
    ...base,
    chavesAlvo: (): ChavesAlvo => alvos,
    async preparar(e) {
      await prepararOperador(e);
      const carga = await cargaAprovadaSintetica(e, {
        ...c,
        catalogo,
        contrato: contrato && cenario !== 'recusas',
      });
      const montado = await MONTAGENS[catalogo](e, carga, cenario);
      entrada = montado.entrada;
      alvos = montado.alvos ?? {};
      recusas = montado.recusas ?? [];
    },
    async executar(e) {
      if (recusas.length > 0) {
        for (const r of recusas) await exigirRecusa(executar(e, r.entrada), r.codigo);
        return;
      }
      await executar(e, entrada);
    },
  };
}

interface Montagem {
  readonly entrada: LoteCatalogo | null;
  readonly alvos?: Record<string, Record<string, unknown>[]>;
  readonly recusas?: { entrada: unknown; codigo: string }[];
}

/** As duas recusas comuns: reimportação sem mudança (sem efeito) e leiaute errado (chave incompleta). */
function recusasComuns(
  carga: number,
  edicao: string | null,
  igual: ItemLoteCatalogo,
): { entrada: unknown; codigo: string }[] {
  return [
    { entrada: lote(carga, edicao, [igual]), codigo: 'sem-efeito' },
    { entrada: lote(carga, edicao, [{ ...igual, chave: {} }]), codigo: 'entrada-invalida' },
  ];
}

const MONTAGENS: Readonly<
  Record<CodigoCatalogo, (e: Escritor, carga: number, cenario: string) => Promise<Montagem>>
> = {
  async cid(e, carga, cenario) {
    const cids = await linhas(
      e,
      "SELECT FIRST 2 ID, COD, NOME FROM TBCID10 WHERE CHAR_LENGTH(COD) = 4 AND CLASSIF IN ('*', '+') AND SUBCAT = 'S' ORDER BY ID",
    );
    const [a, b] = cids;
    if (!a || !b) throw new Error('Cópia sem CID de referência.');
    if (cenario === 'recusas')
      return {
        entrada: null,
        recusas: recusasComuns(
          carga,
          null,
          alterar('cid10', { codigo: txt(a['COD']) }, { nome: txt(a['NOME']) }),
        ),
      };
    const usados = new Set(
      (await linhas(e, "SELECT COD FROM TBCID10 WHERE COD STARTING WITH 'U9'", [], 500)).map((r) =>
        txt(r['COD']),
      ),
    );
    const novos = ['U990', 'U991', 'U992', 'U993', 'U994', 'U995'].filter((x) => !usados.has(x)).slice(0, 2);
    const [ciap] = await linhas(e, 'SELECT FIRST 1 CODIGO, NOME_LEIGO FROM TBCIAP ORDER BY ID');
    const [morf] = await linhas(
      e,
      `SELECT FIRST 1 m.COD FROM TBCID10 m WHERE CHAR_LENGTH(m.COD) = 6 AND m.COD STARTING WITH 'M' AND NOT EXISTS (
         SELECT 1 FROM TBCIDMORF x WHERE x.ID_TBCID10_PRINCIPAL = ? AND x.ID_TBCID10_MORFOLOGICO = m.ID) ORDER BY m.ID`,
      [a['ID']],
    );
    if (!ciap || !morf || novos.length < 2) throw new Error('Cópia sem CIAP, morfologia ou código livre.');
    return {
      entrada: lote(carga, null, [
        ...novos.map((codigo, i) =>
          incluir(
            'cid10',
            { codigo },
            { codigo, nome: `DOENCA SINTETICA ${MARCA_M13} ${i}`, classificacao: '*', sexo: '5' },
          ),
        ),
        alterar(
          'cid10',
          { codigo: txt(a['COD']) },
          { nome: marcado(a['NOME'], 270) },
          { nome: txt(a['NOME']) },
        ),
        alterar(
          'cid10',
          { codigo: txt(b['COD']) },
          { nome: marcado(b['NOME'], 270) },
          { nome: txt(b['NOME']) },
        ),
        alterar(
          'ciap',
          { codigo: txt(ciap['CODIGO']) },
          { nomeLeigo: marcado(ciap['NOME_LEIGO'], 100) },
          { nomeLeigo: txt(ciap['NOME_LEIGO']) },
        ),
        incluir('cidMorfologia', { cid: txt(a['COD']), morfologia: txt(morf['COD']) }, {}),
      ]),
    };
  },

  async cbo(e, carga, cenario) {
    const [x] = await linhas(e, 'SELECT FIRST 1 COD, DESCRICAO FROM TBCBOSUS ORDER BY ID');
    if (!x) throw new Error('Cópia sem CBO.');
    if (cenario === 'recusas')
      return {
        entrada: null,
        recusas: recusasComuns(
          carga,
          null,
          alterar('cbo', { codigo: txt(x['COD']) }, { nome: txt(x['DESCRICAO']) }),
        ),
      };
    const usados = new Set(
      (await linhas(e, "SELECT COD FROM TBCBOSUS WHERE COD STARTING WITH '9999'", [], 200)).map((r) =>
        txt(r['COD']),
      ),
    );
    const novos = Array.from({ length: 99 }, (_, i) => `9999${String(i).padStart(2, '0')}`)
      .filter((k) => !usados.has(k))
      .slice(0, 2);
    const ocup = await livre(e, 'TBOCUPAC', 'COD', 32767, 32000);
    return {
      entrada: lote(carga, null, [
        ...novos.map((codigo, i) =>
          incluir('cbo', { codigo }, { codigo, nome: `OCUPACAO ${MARCA_M13} ${i}` }),
        ),
        alterar(
          'cbo',
          { codigo: txt(x['COD']) },
          { nome: marcado(x['DESCRICAO'], 150) },
          { nome: txt(x['DESCRICAO']) },
        ),
        incluir(
          'ocupacao',
          { codigo: String(ocup) },
          { codigo: String(ocup), nome: `OCUPACAO ${MARCA_M13}` },
        ),
      ]),
    };
  },

  // M51 (etapa 4): os domínios do SIH e do SIA — um tipo de UTI novo (código livre do alto) e o primeiro alterado.
  async dominiosSus(e, carga, cenario) {
    const [x] = await linhas(e, 'SELECT FIRST 1 ID, NOME FROM FHLEITOUTITP ORDER BY ID');
    if (!x) throw new Error('Cópia sem tipos de UTI.');
    if (cenario === 'recusas')
      return {
        entrada: null,
        recusas: recusasComuns(
          carga,
          null,
          alterar('tipoUtiSih', { codigo: txt(x['ID']) }, { nome: txt(x['NOME']) }),
        ),
      };
    const novo = await livre(e, 'FHLEITOUTITP', 'ID', 32767, 32000);
    return {
      entrada: lote(carga, null, [
        incluir('tipoUtiSih', { codigo: String(novo) }, { codigo: String(novo), nome: `UTI ${MARCA_M13}` }),
        alterar(
          'tipoUtiSih',
          { codigo: txt(x['ID']) },
          { nome: marcado(x['NOME'], 60) },
          { nome: txt(x['NOME']) },
        ),
      ]),
    };
  },

  // M48 (etapa 4): um CID passa a semanal, outro volta a 0 (inativado), um modelo de ficha e uma pergunta novos.
  async agravos(e, carga, cenario) {
    const [sem] = await linhas(
      e,
      "SELECT FIRST 1 COD FROM TBCID10 WHERE COALESCE(TP_AGRAVO, 0) = 0 AND COD SIMILAR TO '[A-Z][0-9]{3}' ORDER BY COD",
    );
    const [com] = await linhas(
      e,
      "SELECT FIRST 1 COD FROM TBCID10 WHERE TP_AGRAVO = 1 AND COD SIMILAR TO '[A-Z][0-9]{3}' ORDER BY COD",
    );
    if (!sem || !com) throw new Error('Cópia sem CID notificável ou sem CID comum.');
    if (cenario === 'recusas')
      return {
        entrada: null,
        recusas: recusasComuns(
          carga,
          null,
          alterar('cidAgravo', { codigo: txt(com['COD']) }, { periodicidade: 1 }),
        ),
      };
    const ficha = await livre(e, 'PRAGRAVOTPARQUETIPO', 'ID', 999, 900);
    return {
      entrada: lote(carga, null, [
        alterar('cidAgravo', { codigo: txt(sem['COD']) }, { periodicidade: 1 }, { periodicidade: 0 }),
        alterar('cidAgravo', { codigo: txt(com['COD']) }, { periodicidade: 0 }, { periodicidade: 1 }),
        incluir('fichaAgravo', { codigo: String(ficha) }, { codigo: String(ficha), nome: 'SINT M48' }),
        incluir(
          'perguntaFichaAgravo',
          { ficha: String(ficha), pergunta: '1', subpergunta: '0' },
          { ficha: String(ficha), pergunta: '1', subpergunta: '0', nome: `Pergunta ${MARCA_M13}` },
        ),
      ]),
    };
  },

  // M54.3: as tabelas do SPED contábil — o nome do primeiro tipo de item alterado pelo código oficial (só alteração).
  async spedContabil(e, carga, cenario) {
    const [x] = await linhas(e, 'SELECT FIRST 1 CODIGO, NOME FROM COTIPOITEM ORDER BY ID');
    if (!x) throw new Error('Cópia sem tipos de item do SPED.');
    const item = alterar(
      'tipoItemSped',
      { codigo: txt(x['CODIGO']) },
      { nome: marcado(x['NOME'], 80) },
      { nome: txt(x['NOME']) },
    );
    if (cenario === 'recusas')
      return {
        entrada: null,
        recusas: recusasComuns(
          carga,
          null,
          alterar('tipoItemSped', { codigo: txt(x['CODIGO']) }, { nome: txt(x['NOME']) }),
        ),
      };
    return { entrada: lote(carga, null, [item]) };
  },

  async listas(e, carga, cenario) {
    const [dcb] = await linhas(e, 'SELECT FIRST 1 COD, NOME, CAS FROM GETABDCB ORDER BY COD');
    const [lab] = await linhas(e, 'SELECT FIRST 1 COD, NOME FROM TBLABORA WHERE COD > 0 ORDER BY COD');
    if (!dcb || !lab) throw new Error('Cópia sem DCB ou fabricante.');
    if (cenario === 'recusas')
      return {
        entrada: null,
        recusas: recusasComuns(
          carga,
          null,
          alterar('dcb', { codigo: txt(dcb['COD']) }, { nome: txt(dcb['NOME']) }),
        ),
      };
    const novoDcb = await livre(e, 'GETABDCB', 'COD', 99999, 99000);
    const novaAtiv = await livre(e, 'TBATIVID', 'COD', 32767, 32000);
    const usados = new Set(
      (await linhas(e, "SELECT COD FROM TBTABBCO WHERE COD STARTING WITH 'Z'", [], 200)).map((r) =>
        txt(r['COD']),
      ),
    );
    const banco =
      Array.from({ length: 99 }, (_, i) => `Z${String(i).padStart(2, '0')}`).find((k) => !usados.has(k)) ??
      'Z00';
    return {
      entrada: lote(carga, null, [
        incluir(
          'dcb',
          { codigo: String(novoDcb) },
          { codigo: String(novoDcb), nome: `SUBSTANCIA ${MARCA_M13}`, cas: '50-00-0' },
        ),
        alterar(
          'dcb',
          { codigo: txt(dcb['COD']) },
          { nome: `${MARCA_M13} ${txt(dcb['COD'])}` },
          { nome: txt(dcb['NOME']) },
        ),
        incluir('banco', { codigo: banco }, { codigo: banco, nome: `BANCO ${MARCA_M13}` }),
        incluir(
          'atividade',
          { codigo: String(novaAtiv) },
          { codigo: String(novaAtiv), nome: `ATIVIDADE ${MARCA_M13}` },
        ),
        alterar(
          'fabricante',
          { codigo: txt(lab['COD']) },
          { nome: marcado(lab['NOME'], 150) },
          { nome: txt(lab['NOME']) },
        ),
      ]),
    };
  },

  async fiscal(e, carga, cenario) {
    const [cfop] = await linhas(e, 'SELECT FIRST 1 CODIGO FROM SDCFOP ORDER BY CODIGO');
    const [ret] = await linhas(e, 'SELECT FIRST 1 ID, NOME FROM SDNATRETFONTE ORDER BY ID DESC');
    if (!cfop || !ret) throw new Error('Cópia sem CFOP ou natureza de retenção.');
    if (cenario === 'recusas')
      return {
        entrada: null,
        recusas: recusasComuns(
          carga,
          null,
          alterar('naturezaRetencao', { codigo: txt(ret['ID']) }, { nome: txt(ret['NOME']) }),
        ),
      };
    const novoCfop = await livre(e, 'SDCFOP', 'CODIGO', 9999, 9000);
    const novoPis = await livre(e, 'SDCSTPIS', 'CODIGO', 99, 1);
    return {
      entrada: lote(carga, null, [
        incluir(
          'cfop',
          { codigo: String(novoCfop) },
          { codigo: String(novoCfop), nome: `CFOP ${MARCA_M13}`, inicio: '2026-01-01', fim: null },
        ),
        alterar(
          'cfop',
          { codigo: txt(cfop['CODIGO']) },
          { nome: `CFOP ${MARCA_M13} ${txt(cfop['CODIGO'])}` },
        ),
        incluir(
          'cstPis',
          { codigo: String(novoPis) },
          { codigo: String(novoPis), nome: `CST ${MARCA_M13}`, inicio: '2026-01-01', fim: null },
        ),
        alterar(
          'naturezaRetencao',
          { codigo: txt(ret['ID']) },
          { nome: marcado(ret['NOME'], 80) },
          { nome: txt(ret['NOME']) },
        ),
      ]),
    };
  },

  async tuss(e, carga, cenario) {
    const [glosa] = await linhas(
      e,
      'SELECT FIRST 1 CODIGO FROM TBMOTGLO WHERE CODIGO NOT IN (0, 3095) AND CODIGO > 1000 ORDER BY CODIGO',
    );
    const [cbo] = await linhas(e, 'SELECT FIRST 1 COD, NOME FROM TBCBOANS ORDER BY ID');
    if (!glosa || !cbo) throw new Error('Cópia sem motivo de glosa ou CBO da ANS.');
    // TBMATMED (900 mil linhas) é retratada pelas chaves-alvo também nas recusas (nada pode mudar nela).
    const [mat0] = await linhas(e, 'SELECT FIRST 1 COD FROM TBMATMED WHERE TAB = 100 ORDER BY ID DESC');
    const alvoMat = { TBMATMED: [{ TAB: 100, COD: Number(mat0?.['COD'] ?? 0) }] };
    if (cenario === 'recusa-versao')
      return {
        entrada: null,
        recusas: [
          {
            entrada: lote(carga, '4.03.00', [
              alterar('cboAns', { codigo: txt(cbo['COD']) }, { nome: `${MARCA_M13}` }),
            ]),
            codigo: 'versao-inexistente',
          },
        ],
        alvos: alvoMat,
      };
    if (cenario === 'recusas')
      return {
        entrada: null,
        recusas: recusasComuns(
          carga,
          '4.02.00',
          alterar('cboAns', { codigo: txt(cbo['COD']) }, { nome: txt(cbo['NOME']) }),
        ),
        alvos: alvoMat,
      };
    const novaGlosa = await livre(e, 'TBMOTGLO', 'CODIGO', 8999, 8000);
    const [mat] = await linhas(
      e,
      'SELECT FIRST 1 COD, NOME FROM TBMATMED WHERE TAB = 100 AND NOME IS NOT NULL ORDER BY ID DESC',
    );
    if (!mat) throw new Error('Cópia sem material TUSS.');
    return {
      entrada: lote(carga, '4.02.00', [
        incluir(
          'motivoGlosa',
          { codigo: String(novaGlosa) },
          { codigo: String(novaGlosa), nome: `GLOSA ${MARCA_M13}`, inicio: '2026-01-01', fim: null },
        ),
        alterar(
          'motivoGlosa',
          { codigo: txt(glosa['CODIGO']) },
          { nome: `GLOSA ${MARCA_M13} ${txt(glosa['CODIGO'])}` },
        ),
        alterar(
          'cboAns',
          { codigo: txt(cbo['COD']) },
          { nome: marcado(cbo['NOME'], 150) },
          { nome: txt(cbo['NOME']) },
        ),
        alterar(
          'materialTuss',
          { codigo: txt(mat['COD']) },
          { nome: marcado(mat['NOME'], 150) },
          { nome: txt(mat['NOME']) },
        ),
      ]),
      alvos: { TBMATMED: [{ TAB: 100, COD: Number(mat['COD']) }] },
    };
  },

  async cep(e, carga, cenario) {
    const [x] = await linhas(
      e,
      `SELECT FIRST 1 c.CEP, c.LOGRA, c.ID_TBMUIBGE, s.IBGE FROM TBCEP c JOIN TBSUSCEP s ON s.CEP = c.CEP
         WHERE c.ID_TBMUIBGE IS NOT NULL AND c.ID_TBMUIBGE = s.IBGE ORDER BY c.CEP`,
    );
    const [mun] = await linhas(
      e,
      'SELECT FIRST 1 COD, DIGITO, NOME, UF FROM TBMUIBGE WHERE COD > 0 AND DIGITO IS NOT NULL AND COD <> ? ORDER BY COD',
      [x?.['ID_TBMUIBGE'] ?? 0],
    );
    if (!x || !mun) throw new Error('Cópia sem CEP ou município de referência.');
    const cep = String(x['CEP']).padStart(8, '0');
    if (cenario === 'recusas')
      return {
        entrada: null,
        recusas: recusasComuns(carga, null, alterar('cep', { cep }, { logradouro: txt(x['LOGRA']) })),
        alvos: { TBCEP: [{ CEP: Number(x['CEP']) }], TBSUSCEP: [{ CEP: Number(x['CEP']) }] },
      };
    const usados = new Set(
      (
        await linhas(
          e,
          'SELECT CEP FROM TBCEP WHERE CEP BETWEEN 99999000 AND 99999999 UNION SELECT CEP FROM TBSUSCEP WHERE CEP BETWEEN 99999000 AND 99999999',
          [],
          2000,
        )
      ).map((r) => Number(r['CEP'])),
    );
    const novos = Array.from({ length: 1000 }, (_, i) => 99_999_999 - i)
      .filter((k) => !usados.has(k))
      .slice(0, 2);
    const ibge = `${String(mun['COD']).padStart(6, '0')}${txt(mun['DIGITO'])}`;
    const keys = [Number(x['CEP']), ...novos];
    return {
      entrada: lote(carga, null, [
        ...novos.map((k, i) =>
          incluir(
            'cep',
            { cep: String(k) },
            {
              cep: String(k),
              uf: txt(mun['UF']),
              cidade: txt(mun['NOME']).slice(0, 50),
              logradouro: `RUA ${MARCA_M13} ${i}`,
              bairro: 'CENTRO',
              tipoLogradouro: 'RUA',
              ibge,
            },
          ),
        ),
        alterar('cep', { cep }, { logradouro: `RUA ${MARCA_M13}`, ibge }, { logradouro: txt(x['LOGRA']) }),
        alterar('municipio', { ibge }, { nome: marcado(mun['NOME'], 60) }, { nome: txt(mun['NOME']) }),
      ]),
      alvos: { TBCEP: keys.map((k) => ({ CEP: k })), TBSUSCEP: keys.map((k) => ({ CEP: k })) },
    };
  },

  async sigtap(e, carga, cenario) {
    const procs = await linhas(
      e,
      `SELECT FIRST 3 p.ID, p.CODSUS, p.ID_TBPROCTO FROM TBPROSUS p WHERE p.COMP_FINAL = 201311 AND COALESCE(p.DESCRICAO, '') = ''
         AND EXISTS (SELECT 1 FROM TBVLRSUS v WHERE v.ID_TBPROSUS = p.ID AND v.DATA = '2013-11-01')
         AND EXISTS (SELECT 1 FROM TBSUSCID s WHERE s.ID_TBPROSUS = p.ID AND s.COMP_FINAL = 201311) ORDER BY p.ID`,
    );
    const [a] = procs;
    if (procs.length < 3 || !a) throw new Error('Cópia sem procedimentos da competência 201311.');
    const codigo = (p: (typeof procs)[number]) => txt(p['CODSUS']).padStart(10, '0');
    // TBPROCTO (270 mil linhas) recebe o nome pelo TRG_TBPROSUS_AU: retratada pelas chaves-alvo.
    const alvos = { TBPROCTO: procs.map((p) => ({ ID: Number(p['ID_TBPROCTO']) })) };
    if (cenario === 'recusas') {
      // Reimportação da competência que o banco já tem (201311): nada muda.
      const [rel] = await linhas(
        e,
        'SELECT FIRST 1 c.COD FROM TBSUSCID s JOIN TBCID10 c ON c.ID = s.ID_TBCID10 WHERE s.ID_TBPROSUS = ? AND s.COMP_FINAL = 201311',
        [a['ID']],
      );
      return {
        entrada: null,
        recusas: recusasComuns(
          carga,
          '201311',
          alterar('procedimentoCid', { procedimento: codigo(a), cid: txt(rel?.['COD']) }, {}),
        ),
        alvos,
      };
    }
    const [pareado] = await linhas(
      e,
      'SELECT FIRST 1 c.COD FROM TBSUSCID s JOIN TBCID10 c ON c.ID = s.ID_TBCID10 WHERE s.ID_TBPROSUS = ? AND s.COMP_FINAL = 201311 ORDER BY c.ID',
      [a['ID']],
    );
    const [semPar] = await linhas(
      e,
      "SELECT FIRST 1 c.COD FROM TBCID10 c WHERE CHAR_LENGTH(c.COD) = 4 AND c.COD NOT STARTING WITH 'M' AND NOT EXISTS (SELECT 1 FROM TBSUSCID s WHERE s.ID_TBPROSUS = ? AND s.ID_TBCID10 = c.ID) ORDER BY c.ID",
      [a['ID']],
    );
    const [cboSemPar] = await linhas(
      e,
      'SELECT FIRST 1 c.COD FROM TBCBOSUS c WHERE NOT EXISTS (SELECT 1 FROM TBSUSCBO s WHERE s.ID_TBPROSUS = ? AND s.ID_TBCBOSUS = c.ID) ORDER BY c.ID',
      [a['ID']],
    );
    if (!pareado || !semPar || !cboSemPar)
      throw new Error('Cópia sem pares de compatibilidade de referência.');
    return {
      entrada: lote(carga, '201312', [
        // Os três valores da competência nova vêm no arquivo (diferentes de zero).
        ...procs.map((p, i) =>
          alterar(
            'procedimento',
            { codigo: codigo(p) },
            { valorSh: 1.23 + i, valorSp: 2.34 + i, valorSa: 3.45 + i },
          ),
        ),
        alterar('procedimentoCid', { procedimento: codigo(a), cid: txt(pareado['COD']) }, {}),
        incluir('procedimentoCid', { procedimento: codigo(a), cid: txt(semPar['COD']) }, {}),
        incluir('procedimentoCbo', { procedimento: codigo(a), cbo: txt(cboSemPar['COD']) }, {}),
      ]),
      alvos,
    };
  },

  async brasindice(e, carga, cenario) {
    return matmed(e, carga, cenario, 99, true);
  },
  async simpro(e, carga, cenario) {
    return matmed(e, carga, cenario, 98, false);
  },
  // Catálogos da ANS (M56, F6; D-IMPORT-56): grupo do SIP e procedimento nele (códigos livres), a TPS numa
  // vigência sintética futura e a classificação e a remuneração reais com a marca (desfeito com a captura).
  async ans(e, carga, cenario) {
    const [prc] = await linhas(
      e,
      'SELECT FIRST 1 COD, NOME FROM PSPRCANS WHERE COD IS NOT NULL ORDER BY COD',
    );
    const [rem] = await linhas(e, 'SELECT FIRST 1 ID, NOME FROM TBTISSREMUNERAOPERPS ORDER BY ID');
    const [mes] = await linhas(e, 'SELECT FIRST 1 ID FROM PSTPSMESRECOL ORDER BY ID');
    if (!prc || !rem || !mes) throw new Error('Cópia sem os catálogos da ANS.');
    if (cenario === 'recusas')
      return {
        entrada: null,
        recusas: recusasComuns(
          carga,
          null,
          alterar('classificacaoProcedimentoAns', { codigo: txt(prc['COD']) }, { nome: txt(prc['NOME']) }),
        ),
      };
    const grupo = await livre(e, 'TBSIPANSATO', 'ID', 999, 900);
    const procedimento = 99_999_901;
    const [ultima] = await linhas(e, 'SELECT CAST(MAX(DATA_VIGENCIA) AS VARCHAR(10)) D FROM PSTPSVIGENCIA');
    const ano = Math.max(new Date().getFullYear() + 3, Number(txt(ultima?.['D']).slice(0, 4) || '0') + 1);
    const inicioTps = `${ano}-01-01`;
    return {
      entrada: lote(carga, null, [
        incluir('grupoSip', { codigo: String(grupo) }, { codigo: String(grupo), nome: `GRUPO ${MARCA_M13}` }),
        incluir(
          'procedimentoSip',
          { procedimento: String(procedimento), grupo: String(grupo), inicio: '2026-01-01' },
          {
            procedimento: String(procedimento),
            grupo: String(grupo),
            inicio: '2026-01-01',
            fim: '9999-12-31',
          },
        ),
        alterar(
          'classificacaoProcedimentoAns',
          { codigo: txt(prc['COD']) },
          { nome: marcado(prc['NOME'], 80) },
          { nome: txt(prc['NOME']) },
        ),
        incluir(
          'valorTps',
          { inicio: inicioTps },
          { inicio: inicioTps, mes: txt(mes['ID']), ano, valorAnual: 9.99, valorTrimestral: 2.4975 },
        ),
        alterar(
          'remuneracaoPrestador',
          { codigo: txt(rem['ID']) },
          { nome: marcado(rem['NOME'], 50) },
          { nome: txt(rem['NOME']) },
        ),
      ]),
      alvos: {
        TBSIPANSPROC: [{ COD_PROCEDIMENTO: procedimento, ID_TBSIPANSATO: grupo }],
      },
    };
  },
};

async function matmed(
  e: Escritor,
  carga: number,
  cenario: string,
  tab: number,
  brasindice: boolean,
): Promise<Montagem> {
  const itens = await linhas(
    e,
    `SELECT FIRST 3 m.COD, m.NOME, m.LAB FROM TBMATMED m WHERE m.TAB = ? AND m.NOME IS NOT NULL
       AND EXISTS (SELECT 1 FROM TBVLRMEM v WHERE v.TAB = m.TAB AND v.COD = m.COD) ORDER BY m.ID DESC`,
    [tab],
  );
  const [a, b, x] = itens;
  if (!a || !b || !x) throw new Error(`Cópia sem itens da tabela ${tab}.`);
  const [ed] = await linhas(e, 'SELECT MAX(VERSAO) V FROM TBVERSAOBRASIN');
  const edicao = String(brasindice ? Number(ed?.['V'] ?? 0) + 1 : 1);
  const [h] = await linhas(e, 'SELECT CAST(CURRENT_DATE AS VARCHAR(10)) H FROM RDB$DATABASE');
  const hoje = dataParam(txt(h?.['H']));
  const ent = brasindice ? 'apresentacao' : 'produto';
  const preco = (v: number) => (brasindice ? { pmc: v } : { valor: v });
  if (cenario === 'recusas') {
    const sem = lote(carga, edicao, [alterar(ent, { codigo: txt(a['COD']) }, preco(9.99))]);
    return {
      entrada: null,
      recusas: [
        // Sem o contrato de dados (DP-36): recusa antes de qualquer gravação.
        { entrada: sem, codigo: 'sem-contrato' },
        {
          entrada: lote(carga, edicao, [{ ...alterar(ent, { codigo: txt(a['COD']) }, {}), chave: {} }]),
          codigo: 'entrada-invalida',
        },
      ],
      alvos: {
        TBMATMED: [{ TAB: tab, COD: Number(a['COD']) }],
        TBVLRMEM: [{ TAB: tab, COD: Number(a['COD']), DATA: hoje }],
      },
    };
  }
  const novo = await livre(e, 'TBMATMED', 'COD', 99_999_999, 99_990_000, ` AND TAB = ${tab}`);
  const cods = [novo, Number(a['COD']), Number(b['COD'])];
  return {
    entrada: lote(carga, edicao, [
      incluir(
        ent,
        { codigo: String(novo) },
        {
          codigo: String(novo),
          nome: `ITEM ${MARCA_M13}`,
          ...(brasindice
            ? {
                laboratorio: Number(a['LAB'] ?? 0),
                pmc: 10.5,
                pfb: 7.25,
                classificacao: 2,
                apresentacao: 'SG01',
                fator: 1,
                tuss: 90000001,
              }
            : {
                valor: 3.21,
                classificacao: 1,
                unidade: 'UN',
                fabricante: Number(a['LAB'] ?? 1),
                registroAnvisa: '80000000000',
                referenciaFabricante: 'REF SGH',
                identificacao: 'F',
                tuss: 0,
              }),
        },
      ),
      alterar(ent, { codigo: txt(a['COD']) }, preco(12.34)),
      alterar(ent, { codigo: txt(b['COD']) }, preco(23.45)),
      alterar(ent, { codigo: txt(x['COD']) }, { nome: marcado(x['NOME'], 150) }, { nome: txt(x['NOME']) }),
    ]),
    alvos: {
      TBMATMED: [...cods, Number(x['COD'])].map((cod) => ({ TAB: tab, COD: cod })),
      TBVLRMEM: cods.map((cod) => ({ TAB: tab, COD: cod, DATA: hoje })),
    },
  };
}
