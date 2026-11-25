// F3.8, 07-FIN linha 108: a escrituração fiscal das entradas e a EFD-Contribuições no banco próprio, pelo executor do
// @sgh/nucleo (trilha, outbox e idempotência na mesma transação). As regras são do @sgh/dominio-financeiro
// (escrituracao-entrada.ts): a classificação do item (CFOP de entrada, CST do PIS e da COFINS, base, alíquota e
// natureza da base do crédito; o crédito é base x alíquota), as pendências, a conferência das somas e o arquivo.
// Aqui ficam a leitura da competência e a gravação nas tabelas do modelo:
//   escrituracao_item_entrada (a classificação do item) e escrituracao_entrada (os totais, o CFOP predominante, a
//   natureza predominante e a situação: pendente, escriturada ou retificada depois da entrega);
//   arquivo_efd_contribuicoes (o arquivo da competência: original ou retificadora com o recibo do entregue, o hash do
//   texto, o resumo da conferência e, na entrega, o recibo).
// Nada é apagado: o arquivo gerado e trocado fica "cancelado"; o entregue continua "transmitido" e a retificadora
// aponta para ele. O texto de cada arquivo gerado vai à guarda de arquivos do financeiro (disco da máquina, imutável,
// guarda legal de 5 anos) e fica registrado em `arquivo` (`arquivo_efd_contribuicoes.arquivo_id`): o entregue continua
// baixável depois de qualquer correção. O lado das receitas vem das notas de serviço autorizadas da competência
// (nota_servico), com a contribuição apurada pelo regime (escrituracao-receitas.ts do domínio). A validação e a transmissão são feitas no programa da Receita, fora do sistema (nenhum envio
// externo): aqui só se registra o recibo.
import { createHash } from 'node:crypto';
import {
  type ApuracaoReceitas,
  apuracaoDoPedido,
  type ClassificacaoFiscalItem,
  conferirClassificacaoItem,
  type ConferenciaEfd,
  conferirEntregaEfd,
  conferirGeracaoEfd,
  conferirSomasEfd,
  creditoDoItem,
  cstDaCredito,
  type DeclaranteEfd,
  type DocumentoEfd,
  type ItemEfd,
  montarEfdContribuicoes,
  NATUREZAS_BASE_CREDITO,
  type PendenciaFiscal,
  pendenciasDoItem,
  type ReceitaServicoEfd,
  type RecusaFinanceiro,
  REGIMES_EFD,
  type RegimeEfd,
  totaisDoDocumento,
} from '@sgh/dominio-financeiro';
import {
  type ContextoOperacao,
  definirOperacao,
  type Leitor,
  recusa,
  type ResultadoOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { ligarArquivo, registrarArquivoGuardado, retencaoAte } from '../tiss/armazem-xml.js';
import { type ArmazemFinanceiro, ErroSobrescritaArquivo } from './armazem.js';
import { dataIso, instanteIso, numero, texto } from './vocabulario.js';

const PERIODO = /^\d{4}-(0[1-9]|1[0-2])$/;
type Consulta = Pick<Leitor, 'consultar'>;

function recusar(r: RecusaFinanceiro | null): void {
  if (r) throw recusa(r.codigo, r.mensagem, r.campos ? { campos: r.campos } : {});
}
function estabelecimentoDe(ctx: ContextoOperacao): number {
  if (ctx.estabelecimento === null)
    throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
  return ctx.estabelecimento;
}
const opc = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : texto(v));
const num = (v: unknown): number | null => (v === null || v === undefined ? null : numero(v));
export const hashDoArquivoEfd = (conteudo: string): string =>
  createHash('sha256').update(conteudo, 'utf8').digest('hex');

// ── Respostas da tela ───────────────────────────────────────────────────────────────────────────────────────────

export interface ItemEscrituracaoTela extends ItemEfd {
  readonly pendencias: readonly PendenciaFiscal[];
}
export interface EntradaEscrituracaoTela extends Omit<DocumentoEfd, 'itens'> {
  readonly versao: number;
  /** pendente, escriturada ou retificada (corrigida depois da entrega: pede a retificadora). */
  readonly situacao: string;
  readonly cfop: string | null;
  readonly arquivo: number | null;
  readonly itens: readonly ItemEscrituracaoTela[];
  readonly pendencias: number;
}
export interface ArquivoEfdTela {
  readonly id: number;
  readonly sequencia: number;
  readonly finalidade: 'original' | 'retificadora';
  readonly regime: RegimeEfd;
  readonly situacao: string;
  readonly hash: string | null;
  readonly recibo: string | null;
  readonly reciboAnterior: string | null;
  readonly geradoEm: string | null;
  readonly entregueEm: string | null;
  readonly resumo: string | null;
  /** O texto do arquivo ainda é o da escrituração de hoje (falso: a escrituração mudou depois dele). */
  readonly confere: boolean;
  /** O texto gerado está guardado (baixável mesmo depois de uma correção). */
  readonly guardado: boolean;
}
export interface PainelEscrituracao {
  readonly periodo: string;
  readonly entradas: readonly EntradaEscrituracaoTela[];
  readonly conferencia: ConferenciaEfd;
  /** A receita das notas de serviço da competência e a contribuição apurada, por regime (só somas e contagens). */
  readonly receitas: { readonly cumulativo: ApuracaoReceitas; readonly naoCumulativo: ApuracaoReceitas };
  readonly arquivos: readonly ArquivoEfdTela[];
  readonly cfops: readonly { codigo: string; descricao: string }[];
  readonly naturezas: readonly string[];
}

// ── Leituras ────────────────────────────────────────────────────────────────────────────────────────────────────

/** As entradas escrituradas da competência com os itens (a escrituração cancelada fica fora). */
export async function entradasDaCompetencia(
  l: Consulta,
  est: number,
  periodo: string,
): Promise<EntradaEscrituracaoTela[]> {
  const cab = await l.consultar(
    `SELECT e.id, e.versao, e.entrada_servico_id, e.modelo_documento, e.serie, e.numero_documento, e.chave_acesso,
            e.data_emissao, e.data_entrada, e.situacao_documento, e.situacao, e.valor_documento, e.valor_desconto,
            e.valor_pis, e.valor_cofins, e.arquivo_efd_contribuicoes_id, cf.codigo_cfop AS cfop,
            ef.razao_social, COALESCE(ef.cnpj, ef.cpf) AS documento
       FROM escrituracao_entrada e JOIN empresa_fornecedora ef ON ef.id = e.empresa_fornecedora_id
       LEFT JOIN cfop cf ON cf.id = e.cfop_id
      WHERE e.estabelecimento_id = ? AND e.competencia = ? AND e.excluido_em IS NULL AND e.situacao <> 'cancelada'
      ORDER BY e.data_entrada, e.id LIMIT 5000`,
    [est, `${periodo}-01`],
  );
  const itens = await l.consultar(
    `SELECT i.escrituracao_entrada_id, i.sequencia, cf.codigo_cfop AS cfop, i.codigo_item, i.descricao, i.quantidade,
            um.sigla, i.valor_item, i.valor_desconto, i.cst_pis, i.base_pis, i.aliquota_pis, i.valor_pis, i.cst_cofins,
            i.base_cofins, i.aliquota_cofins, i.valor_cofins, i.natureza_credito_pis_cofins
       FROM escrituracao_item_entrada i JOIN escrituracao_entrada e ON e.id = i.escrituracao_entrada_id
       JOIN cfop cf ON cf.id = i.cfop_id LEFT JOIN unidade_medida um ON um.id = i.unidade_medida_id
      WHERE e.estabelecimento_id = ? AND e.competencia = ? AND e.excluido_em IS NULL AND e.situacao <> 'cancelada'
        AND i.excluido_em IS NULL
      ORDER BY i.escrituracao_entrada_id, i.sequencia`,
    [est, `${periodo}-01`],
  );
  const porEntrada = new Map<number, ItemEscrituracaoTela[]>();
  for (const r of itens) {
    const base: ItemEfd = {
      sequencia: numero(r['sequencia']),
      cfop: opc(r['cfop']),
      codigoItem: texto(r['codigo_item']),
      descricao: opc(r['descricao']),
      quantidade: numero(r['quantidade']),
      unidade: opc(r['sigla']),
      valorItem: numero(r['valor_item']),
      valorDesconto: numero(r['valor_desconto']),
      cstPis: opc(r['cst_pis']),
      basePis: numero(r['base_pis']),
      aliquotaPis: num(r['aliquota_pis']),
      valorPis: numero(r['valor_pis']),
      cstCofins: opc(r['cst_cofins']),
      baseCofins: numero(r['base_cofins']),
      aliquotaCofins: num(r['aliquota_cofins']),
      valorCofins: numero(r['valor_cofins']),
      naturezaCredito: opc(r['natureza_credito_pis_cofins']),
    };
    const k = numero(r['escrituracao_entrada_id']);
    porEntrada.set(k, [...(porEntrada.get(k) ?? []), { ...base, pendencias: pendenciasDoItem(base) }]);
  }
  return cab.map((r) => {
    const id = numero(r['id']);
    const its = porEntrada.get(id) ?? [];
    return {
      id,
      versao: numero(r['versao']),
      servico: r['entrada_servico_id'] !== null && r['entrada_servico_id'] !== undefined,
      participanteDocumento: texto(r['documento']).replace(/\D/g, ''),
      participanteNome: texto(r['razao_social']),
      modelo: texto(r['modelo_documento']),
      serie: opc(r['serie']),
      numero: texto(r['numero_documento']),
      chave: opc(r['chave_acesso']),
      dataEmissao: dataIso(r['data_emissao']) ?? '',
      dataEntrada: dataIso(r['data_entrada']) ?? '',
      situacaoDocumento: texto(r['situacao_documento']),
      situacao: texto(r['situacao']),
      valorDocumento: numero(r['valor_documento']),
      valorDesconto: numero(r['valor_desconto']),
      valorPis: numero(r['valor_pis']),
      valorCofins: numero(r['valor_cofins']),
      cfop: opc(r['cfop']),
      arquivo: num(r['arquivo_efd_contribuicoes_id']),
      itens: its,
      pendencias: its.reduce((s, i) => s + i.pendencias.length, 0),
    };
  });
}

async function declaranteDe(l: Consulta, est: number): Promise<DeclaranteEfd> {
  const [r] = await l.consultar(
    `SELECT e.cnpj, e.razao_social, e.inscricao_estadual, e.inscricao_municipal, m.codigo_ibge, u.sigla
       FROM estabelecimento e LEFT JOIN municipio_ibge m ON m.id = e.municipio_ibge_id
       LEFT JOIN unidade_federativa u ON u.id = m.unidade_federativa_id
      WHERE e.id = ?`,
    [est],
  );
  return {
    cnpj: r ? (opc(r['cnpj']) ?? '') : '',
    nome: r ? texto(r['razao_social']) : '',
    uf: r ? opc(r['sigla']) : null,
    codigoMunicipio: r ? opc(r['codigo_ibge']) : null,
    inscricaoEstadual: r ? opc(r['inscricao_estadual']) : null,
    inscricaoMunicipal: r ? opc(r['inscricao_municipal']) : null,
  };
}

/**
 * As notas de serviço da competência que contam para a receita: a autorizada em produção é receita; a que ainda
 * espera a autorização (RPS gerado ou enviada) é pendência. A cancelada, a substituída, a rejeitada e a de
 * homologação ficam fora.
 */
export async function receitasDaCompetencia(
  l: Consulta,
  est: number,
  periodo: string,
): Promise<ReceitaServicoEfd[]> {
  const rs = await l.consultar(
    `SELECT n.id, n.numero_nota, n.numero_rps, n.serie_rps, n.chave_acesso, n.data_emissao, n.tipo_tomador,
            n.tomador_documento, n.tomador_nome, n.situacao, n.valor_servicos, n.valor_desconto_incondicionado,
            n.valor_iss, n.iss_retido, n.valor_pis, n.valor_cofins
       FROM nota_servico n
      WHERE n.estabelecimento_id = ? AND n.competencia = ? AND n.excluido_em IS NULL AND n.ambiente = 'producao'
        AND n.situacao IN ('autorizada', 'rps_gerado', 'enviada')
      ORDER BY n.data_emissao, n.id LIMIT 20000`,
    [est, `${periodo}-01`],
  );
  return rs.map((r) => ({
    id: numero(r['id']),
    numero: opc(r['numero_nota']) ?? texto(r['numero_rps']),
    serie: opc(r['serie_rps']),
    chave: opc(r['chave_acesso']),
    dataEmissao: dataIso(r['data_emissao']) ?? '',
    tipoTomador: texto(r['tipo_tomador']) as ReceitaServicoEfd['tipoTomador'],
    tomadorDocumento: texto(r['tipo_tomador']) === 'pessoa_juridica' ? opc(r['tomador_documento']) : null,
    tomadorNome: texto(r['tomador_nome']),
    situacao: texto(r['situacao']) === 'autorizada' ? 'autorizada' : 'aguardando',
    valorServicos: numero(r['valor_servicos']),
    valorDesconto: numero(r['valor_desconto_incondicionado']),
    valorIss: numero(r['valor_iss']),
    pisRetido: numero(r['valor_pis']),
    cofinsRetido: numero(r['valor_cofins']),
  }));
}

interface ArquivoGravado {
  readonly id: number;
  readonly versao: number;
  readonly sequencia: number;
  readonly finalidade: 'original' | 'retificadora';
  readonly regime: RegimeEfd;
  readonly situacao: string;
  readonly hash: string | null;
  readonly recibo: string | null;
  readonly reciboAnterior: string | null;
  readonly geradoEm: string | null;
  readonly entregueEm: string | null;
  readonly resumo: string | null;
  readonly arquivoId: number | null;
}
const COLUNAS_ARQUIVO = `id, versao, sequencia_envio, finalidade, regime, situacao, hash_sha256, recibo, recibo_anterior,
  gerado_em, transmitido_em, mensagem_validacao, arquivo_id`;
const arquivoDe = (r: Record<string, unknown>): ArquivoGravado => ({
  id: numero(r['id']),
  versao: numero(r['versao']),
  sequencia: numero(r['sequencia_envio']),
  finalidade: texto(r['finalidade']) as ArquivoGravado['finalidade'],
  regime: texto(r['regime']) as RegimeEfd,
  situacao: texto(r['situacao']),
  hash: opc(r['hash_sha256']),
  recibo: opc(r['recibo']),
  reciboAnterior: opc(r['recibo_anterior']),
  geradoEm: instanteIso(r['gerado_em']),
  entregueEm: instanteIso(r['transmitido_em']),
  resumo: opc(r['mensagem_validacao']),
  arquivoId: num(r['arquivo_id']),
});

/** O texto do arquivo com os dados de hoje (o regime e o recibo anterior são os do arquivo). */
async function textoDeHoje(
  l: Consulta,
  est: number,
  periodo: string,
  regime: RegimeEfd,
  reciboAnterior: string | null,
) {
  const documentos = await entradasDaCompetencia(l, est, periodo);
  const receitas = await receitasDaCompetencia(l, est, periodo);
  const pedido = {
    declarante: await declaranteDe(l, est),
    periodo,
    regime,
    reciboAnterior,
    documentos,
    receitas,
  };
  return { pedido, conferencia: conferirSomasEfd(documentos), documentos };
}

/** A competência na tela: entradas com as pendências, a conferência das somas e os arquivos gerados. */
export async function painelEscrituracao(
  l: Leitor,
  est: number,
  periodo: string,
): Promise<PainelEscrituracao> {
  const entradas = await entradasDaCompetencia(l, est, periodo);
  const conferencia = conferirSomasEfd(entradas);
  const declarante = await declaranteDe(l, est);
  const receitas = await receitasDaCompetencia(l, est, periodo);
  const pedidoDe = (regime: RegimeEfd, reciboAnterior: string | null) => ({
    declarante,
    periodo,
    regime,
    reciboAnterior,
    documentos: entradas,
    receitas,
  });
  const arquivos = (
    await l.consultar(
      `SELECT ${COLUNAS_ARQUIVO} FROM arquivo_efd_contribuicoes
        WHERE estabelecimento_id = ? AND competencia = ? AND excluido_em IS NULL ORDER BY sequencia_envio DESC`,
      [est, `${periodo}-01`],
    )
  ).map(arquivoDe);
  const cfops = await l.consultar(
    "SELECT codigo_cfop, descricao FROM cfop WHERE sentido = 'entrada' ORDER BY codigo_cfop LIMIT 2000",
    [],
  );
  return {
    periodo,
    entradas,
    conferencia,
    arquivos: arquivos.map((a) => {
      const confere =
        conferencia.liberado &&
        a.hash !== null &&
        hashDoArquivoEfd(montarEfdContribuicoes(pedidoDe(a.regime, a.reciboAnterior)).conteudo) === a.hash;
      return {
        id: a.id,
        sequencia: a.sequencia,
        finalidade: a.finalidade,
        regime: a.regime,
        situacao: a.situacao,
        hash: a.hash,
        recibo: a.recibo,
        reciboAnterior: a.reciboAnterior,
        geradoEm: a.geradoEm,
        entregueEm: a.entregueEm,
        resumo: a.resumo,
        confere,
        guardado: a.arquivoId !== null,
      };
    }),
    receitas: {
      cumulativo: apuracaoDoPedido(pedidoDe('cumulativo', null), conferencia),
      naoCumulativo: apuracaoDoPedido(pedidoDe('nao_cumulativo', null), conferencia),
    },
    cfops: cfops.map((r) => ({
      codigo: texto(r['codigo_cfop']),
      descricao: texto(r['descricao']).slice(0, 160),
    })),
    naturezas: NATUREZAS_BASE_CREDITO,
  };
}

/**
 * O texto do arquivo. O entregue e o trocado (cancelado) vêm da guarda, como foram gerados, conferidos pelo hash:
 * continuam baixáveis depois de qualquer correção. O gerado e ainda não entregue só sai enquanto a escrituração é a
 * mesma de quando ele foi gerado (o hash do texto de hoje confere): assim ninguém entrega um arquivo velho.
 */
export async function textoDoArquivoEfd(
  l: Leitor,
  est: number,
  id: number,
  armazem: Pick<ArmazemFinanceiro, 'ler'>,
): Promise<{ nome: string; conteudo: string; guardado: boolean } | 'desatualizado' | null> {
  const [r] = await l.consultar(
    `SELECT ${COLUNAS_ARQUIVO}, competencia FROM arquivo_efd_contribuicoes
      WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [id, est],
  );
  if (!r) return null;
  const a = arquivoDe(r);
  const periodo = (dataIso(r['competencia']) ?? '').slice(0, 7);
  const nome = `efd-contribuicoes-${periodo}-${String(a.sequencia).padStart(2, '0')}.txt`;
  if ((a.situacao === 'transmitido' || a.situacao === 'cancelado') && a.arquivoId !== null) {
    const [g] = await l.consultar('SELECT chave_armazenamento, hash_sha256 FROM arquivo WHERE id = ?', [
      a.arquivoId,
    ]);
    const bytes = g ? await armazem.ler(texto(g['chave_armazenamento'])) : null;
    if (!bytes)
      throw recusa('arquivo-ausente-na-guarda', 'O texto guardado do arquivo não foi achado na guarda.');
    const conteudo = new TextDecoder().decode(bytes);
    if (hashDoArquivoEfd(conteudo) !== a.hash)
      throw recusa('arquivo-divergente', 'O texto guardado não confere com o hash registrado do arquivo.');
    return { nome, conteudo, guardado: true };
  }
  const { pedido, conferencia } = await textoDeHoje(l, est, periodo, a.regime, a.reciboAnterior);
  if (!conferencia.liberado) return 'desatualizado';
  const conteudo = montarEfdContribuicoes(pedido).conteudo;
  if (hashDoArquivoEfd(conteudo) !== a.hash) return 'desatualizado';
  return { nome, conteudo, guardado: a.arquivoId !== null };
}

// ── Classificação fiscal da entrada ────────────────────────────────────────────────────────────────────────────

const dinheiro = z.number().min(0).max(9_999_999_999.99);
const aliquota = z.number().min(0).max(100).nullable();
const cst = z
  .string()
  .regex(/^\d{2}$/)
  .nullable();
export const esquemaClassificarEntrada = z
  .object({
    entrada: z.number().int().positive(),
    versao: z.number().int().positive(),
    itens: z
      .array(
        z
          .object({
            sequencia: z.number().int().positive(),
            cfop: z.string().regex(/^\d{4}$/),
            cstPis: cst,
            basePis: dinheiro,
            aliquotaPis: aliquota,
            cstCofins: cst,
            baseCofins: dinheiro,
            aliquotaCofins: aliquota,
            naturezaCredito: z
              .string()
              .regex(/^\d{2}$/)
              .nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(999),
  })
  .strict();
export type ClassificarEntrada = z.infer<typeof esquemaClassificarEntrada>;

const classificarEntrada = definirOperacao<ClassificarEntrada, ResultadoOperacao>({
  nome: 'financeiro.escrituracao_classificar_entrada',
  tabelas: ['escrituracao_entrada', 'escrituracao_item_entrada'],
  entrada: esquemaClassificarEntrada as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const [cab] = await tx.consultarParaAtualizar(
      `SELECT e.id, e.versao, e.situacao, e.situacao_documento, a.situacao AS situacao_arquivo
         FROM escrituracao_entrada e LEFT JOIN arquivo_efd_contribuicoes a ON a.id = e.arquivo_efd_contribuicoes_id
        WHERE e.id = ? AND e.estabelecimento_id = ? AND e.excluido_em IS NULL`,
      [e.entrada, est],
    );
    if (!cab) throw recusa('entrada-nao-encontrada', 'Entrada escriturada não encontrada.');
    if (texto(cab['situacao']) === 'cancelada' || ['02', '03'].includes(texto(cab['situacao_documento'])))
      throw recusa('entrada-cancelada', 'O documento cancelado não é classificado.');
    const linhas = await tx.consultarParaAtualizar(
      `SELECT id, versao, sequencia, valor_item, valor_desconto FROM escrituracao_item_entrada
        WHERE escrituracao_entrada_id = ? AND excluido_em IS NULL ORDER BY sequencia`,
      [e.entrada],
    );
    const repetida = e.itens.find((i, n) => e.itens.findIndex((x) => x.sequencia === i.sequencia) !== n);
    if (repetida) throw recusa('item-repetido', `O item ${repetida.sequencia} veio mais de uma vez.`);
    const cfops = new Map<string, number>();
    for (const i of e.itens as readonly ClassificacaoFiscalItem[]) {
      const l = linhas.find((x) => numero(x['sequencia']) === i.sequencia);
      if (!l) throw recusa('item-nao-encontrado', `O item ${i.sequencia} não é desta entrada.`);
      recusar(conferirClassificacaoItem(i, numero(l['valor_item']), numero(l['valor_desconto'])));
      const codigo = String(i.cfop);
      if (!cfops.has(codigo)) {
        const [c] = await tx.consultar("SELECT id FROM cfop WHERE codigo_cfop = ? AND sentido = 'entrada'", [
          codigo,
        ]);
        if (!c)
          throw recusa(
            'cfop-desconhecido',
            `Item ${i.sequencia}: o CFOP ${codigo} não está na tabela oficial.`,
            {
              campos: ['cfop'],
            },
          );
        cfops.set(codigo, numero(c['id']));
      }
      const pis = cstDaCredito(i.cstPis);
      const cofins = cstDaCredito(i.cstCofins);
      await tx.alterar('escrituracao_item_entrada', numero(l['id']), numero(l['versao']), {
        cfop_id: cfops.get(codigo)!,
        cst_pis: i.cstPis,
        base_pis: pis ? i.basePis : 0,
        aliquota_pis: pis ? i.aliquotaPis : null,
        valor_pis: pis ? creditoDoItem(i.basePis, i.aliquotaPis) : 0,
        cst_cofins: i.cstCofins,
        base_cofins: cofins ? i.baseCofins : 0,
        aliquota_cofins: cofins ? i.aliquotaCofins : null,
        valor_cofins: cofins ? creditoDoItem(i.baseCofins, i.aliquotaCofins) : 0,
        natureza_credito_pis_cofins: i.naturezaCredito,
      });
    }
    // O cabeçalho é a soma dos itens, com o CFOP e a natureza de maior valor.
    const todos = await tx.consultar(
      `SELECT i.sequencia, i.cfop_id, cf.codigo_cfop AS cfop, i.valor_item, i.valor_desconto, i.cst_pis, i.base_pis,
              i.aliquota_pis, i.valor_pis, i.cst_cofins, i.base_cofins, i.aliquota_cofins, i.valor_cofins,
              i.natureza_credito_pis_cofins
         FROM escrituracao_item_entrada i JOIN cfop cf ON cf.id = i.cfop_id
        WHERE i.escrituracao_entrada_id = ? AND i.excluido_em IS NULL ORDER BY i.sequencia`,
      [e.entrada],
    );
    const maior = (chave: string, peso: string): unknown => {
      const m = new Map<unknown, number>();
      for (const r of todos) if (r[chave] !== null) m.set(r[chave], (m.get(r[chave]) ?? 0) + numero(r[peso]));
      return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    };
    const pendentes = todos.reduce(
      (s, r) =>
        s +
        pendenciasDoItem({
          sequencia: numero(r['sequencia']),
          cfop: opc(r['cfop']),
          valorItem: numero(r['valor_item']),
          valorDesconto: numero(r['valor_desconto']),
          cstPis: opc(r['cst_pis']),
          basePis: numero(r['base_pis']),
          aliquotaPis: num(r['aliquota_pis']),
          valorPis: numero(r['valor_pis']),
          cstCofins: opc(r['cst_cofins']),
          baseCofins: numero(r['base_cofins']),
          aliquotaCofins: num(r['aliquota_cofins']),
          valorCofins: numero(r['valor_cofins']),
          naturezaCredito: opc(r['natureza_credito_pis_cofins']),
        }).length,
      0,
    );
    const totais = totaisDoDocumento(
      todos.map((r) => ({ valorPis: numero(r['valor_pis']), valorCofins: numero(r['valor_cofins']) })),
    );
    // Corrigida depois da entrega: fica "retificada" até a retificadora sair.
    const entregue = opc(cab['situacao_arquivo']) === 'transmitido';
    const situacao = pendentes > 0 ? 'pendente' : entregue ? 'retificada' : 'escriturada';
    await tx.alterar('escrituracao_entrada', e.entrada, e.versao, {
      cfop_id: maior('cfop_id', 'valor_item'),
      natureza_credito_pis_cofins: maior('natureza_credito_pis_cofins', 'base_cofins'),
      valor_pis: totais.valorPis,
      valor_cofins: totais.valorCofins,
      situacao,
    });
    return {
      entrada: e.entrada,
      itens: e.itens.length,
      pendencias: pendentes,
      valorPis: totais.valorPis,
      valorCofins: totais.valorCofins,
      situacao,
    };
  },
  alvo: (e) => ({ tabela: 'escrituracao_entrada', id: e.entrada }),
});

// ── Arquivo da EFD-Contribuições ────────────────────────────────────────────────────────────────────────────────

export const esquemaGerarEfd = z
  .object({ periodo: z.string().regex(PERIODO), regime: z.enum(REGIMES_EFD) })
  .strict();
export type GerarEfd = z.infer<typeof esquemaGerarEfd>;

/** O resumo da conferência gravado com o arquivo: só contagens e somas. */
const resumoDa = (c: ConferenciaEfd, linhas: number, a: ApuracaoReceitas): string =>
  [
    `documentos=${c.documentos}`,
    `itens=${c.itens}`,
    `linhas=${linhas}`,
    `base_pis=${c.totalBasePis.toFixed(2)}`,
    `credito_pis=${c.totalCreditoPis.toFixed(2)}`,
    `base_cofins=${c.totalBaseCofins.toFixed(2)}`,
    `credito_cofins=${c.totalCreditoCofins.toFixed(2)}`,
    `notas=${a.notas}`,
    `receita=${a.pis.receitaBruta.toFixed(2)}`,
    `pis_apurado=${a.pis.apurada.toFixed(2)}`,
    `pis_recolher=${a.pis.aRecolher.toFixed(2)}`,
    `cofins_apurado=${a.cofins.apurada.toFixed(2)}`,
    `cofins_recolher=${a.cofins.aRecolher.toFixed(2)}`,
  ].join('; ');

const gerarEfd = (armazem: ArmazemFinanceiro) =>
  definirOperacao<GerarEfd, ResultadoOperacao>({
    nome: 'financeiro.efd_contribuicoes_gerar',
    tabelas: ['arquivo_efd_contribuicoes', 'escrituracao_entrada', 'arquivo'],
    entrada: esquemaGerarEfd as never,
    async gravar(tx, e, ctx) {
      const est = estabelecimentoDe(ctx);
      const competencia = `${e.periodo}-01`;
      const anteriores = (
        await tx.consultarParaAtualizar(
          `SELECT ${COLUNAS_ARQUIVO} FROM arquivo_efd_contribuicoes
          WHERE estabelecimento_id = ? AND competencia = ? AND excluido_em IS NULL ORDER BY sequencia_envio`,
          [est, competencia],
        )
      ).map(arquivoDe);
      const entregue = [...anteriores].reverse().find((a) => a.situacao === 'transmitido') ?? null;
      const { pedido, conferencia, documentos } = await textoDeHoje(
        tx,
        est,
        e.periodo,
        e.regime,
        entregue?.recibo ?? null,
      );
      recusar(conferirGeracaoEfd(pedido, conferencia));
      const arquivo = montarEfdContribuicoes(pedido);
      const hash = hashDoArquivoEfd(arquivo.conteudo);
      const base = {
        periodo: e.periodo,
        hash,
        linhas: arquivo.linhas,
        documentos: conferencia.documentos,
        itens: conferencia.itens,
        creditoPis: conferencia.totalCreditoPis,
        creditoCofins: conferencia.totalCreditoCofins,
        notas: arquivo.apuracao.notas,
        receita: arquivo.apuracao.pis.receitaBruta,
        pisRecolher: arquivo.apuracao.pis.aRecolher,
        cofinsRecolher: arquivo.apuracao.cofins.aRecolher,
      };
      const aberto = anteriores.filter((a) => ['gerado', 'validado', 'com_erro'].includes(a.situacao));
      const igual = aberto.find((a) => a.hash === hash && a.situacao !== 'com_erro');
      if (igual)
        return {
          ...base,
          arquivo: igual.id,
          sequencia: igual.sequencia,
          finalidade: igual.finalidade,
          igual: true,
        };
      // Nada mudou desde a entrega: o texto de hoje, com o cabeçalho do entregue, é o próprio entregue.
      if (
        entregue &&
        entregue.regime === e.regime &&
        hashDoArquivoEfd(
          montarEfdContribuicoes({ ...pedido, reciboAnterior: entregue.reciboAnterior }).conteudo,
        ) === entregue.hash
      )
        throw recusa(
          'nada-a-retificar',
          'A escrituração é a mesma do arquivo já entregue: não há o que retificar.',
        );
      // O gerado que não foi entregue é trocado: fica cancelado, nunca apagado.
      for (const a of aberto)
        await tx.alterar('arquivo_efd_contribuicoes', a.id, a.versao, { situacao: 'cancelado' });
      const sequencia = anteriores.reduce((m, a) => Math.max(m, a.sequencia), 0) + 1;
      const finalidade = entregue ? 'retificadora' : 'original';
      // O texto vai à guarda antes do registro (a chave leva a competência, a sequência e o hash). A mesma chave já
      // guardada é o mesmo conteúdo (a transação anterior desfeita): segue para o registro, que confere o hash.
      const agora = new Date();
      const bytes = new TextEncoder().encode(arquivo.conteudo);
      const nomeArquivo = `efd-contribuicoes-${e.periodo}-${String(sequencia).padStart(2, '0')}.txt`;
      const chave = `efd-contribuicoes/${est}/${e.periodo}-${String(sequencia).padStart(2, '0')}-${hash.slice(0, 16)}.txt`;
      try {
        await armazem.guardar(chave, bytes, 'text/plain');
      } catch (x) {
        if (!(x instanceof ErroSobrescritaArquivo)) throw x;
      }
      const guardado = await registrarArquivoGuardado(tx, {
        estabelecimento: est,
        entidade: 'arquivo_efd_contribuicoes',
        entidadeId: null,
        finalidade: 'efd_contribuicoes',
        nomeOriginal: nomeArquivo,
        tipoMime: 'text/plain',
        tamanhoBytes: bytes.length,
        hash,
        chave,
        retencaoAte: retencaoAte(agora),
      });
      const id = await tx.incluir('arquivo_efd_contribuicoes', {
        estabelecimento_id: est,
        competencia,
        sequencia_envio: sequencia,
        finalidade,
        arquivo_retificado_id: entregue?.id ?? null,
        recibo_anterior: entregue?.recibo ?? null,
        regime: e.regime,
        arquivo_id: guardado.id,
        hash_sha256: hash,
        situacao: 'gerado',
        gerado_em: agora,
        gerador_usuario_id: ctx.usuario ?? null,
        mensagem_validacao: resumoDa(conferencia, arquivo.linhas, arquivo.apuracao),
      });
      await ligarArquivo(tx, guardado, id);
      // As entradas ficam ligadas ao arquivo que as levou.
      for (const d of documentos)
        await tx.alterar('escrituracao_entrada', d.id, d.versao, {
          arquivo_efd_contribuicoes_id: id,
          situacao: 'escriturada',
        });
      return { ...base, arquivo: id, sequencia, finalidade, igual: false };
    },
    alvo: (_e, r) => ({ tabela: 'arquivo_efd_contribuicoes', id: numero(r['arquivo']) || null }),
  });

export const esquemaEntregaEfd = z
  .object({ arquivo: z.number().int().positive(), recibo: z.string().trim().min(1).max(60) })
  .strict();
export type EntregaEfd = z.infer<typeof esquemaEntregaEfd>;

const registrarEntregaEfd = definirOperacao<EntregaEfd, ResultadoOperacao>({
  nome: 'financeiro.efd_contribuicoes_registrar_entrega',
  tabelas: ['arquivo_efd_contribuicoes'],
  entrada: esquemaEntregaEfd as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const [r] = await tx.consultarParaAtualizar(
      `SELECT ${COLUNAS_ARQUIVO}, competencia FROM arquivo_efd_contribuicoes
        WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [e.arquivo, est],
    );
    if (!r) throw recusa('arquivo-nao-encontrado', 'Arquivo da EFD-Contribuições não encontrado.');
    const a = arquivoDe(r);
    const recibo = e.recibo.trim();
    recusar(conferirEntregaEfd(a.situacao, recibo));
    // A conferência antes da entrega: o arquivo tem de ser o da escrituração de hoje.
    const periodo = (dataIso(r['competencia']) ?? '').slice(0, 7);
    const { pedido, conferencia } = await textoDeHoje(tx, est, periodo, a.regime, a.reciboAnterior);
    if (!conferencia.liberado || hashDoArquivoEfd(montarEfdContribuicoes(pedido).conteudo) !== a.hash)
      throw recusa(
        'arquivo-desatualizado',
        'A escrituração mudou depois deste arquivo: gere o arquivo de novo antes de registrar a entrega.',
      );
    await tx.alterar('arquivo_efd_contribuicoes', a.id, a.versao, {
      situacao: 'transmitido',
      recibo,
      transmitido_em: new Date(),
    });
    return {
      arquivo: a.id,
      periodo,
      situacao: 'transmitido',
      creditoPis: conferencia.totalCreditoPis,
      creditoCofins: conferencia.totalCreditoCofins,
    };
  },
  alvo: (e) => ({ tabela: 'arquivo_efd_contribuicoes', id: e.arquivo }),
});

/** As operações da escrituração; a geração guarda o texto do arquivo na guarda de arquivos do financeiro. */
export const operacoesEscrituracao = (armazem: ArmazemFinanceiro) =>
  ({
    'financeiro.escrituracaoClassificarEntrada': classificarEntrada,
    'financeiro.efdContribuicoesGerar': gerarEfd(armazem),
    'financeiro.efdContribuicoesRegistrarEntrega': registrarEntregaEfd,
  }) as const;
export type OperacaoEscrituracao = keyof ReturnType<typeof operacoesEscrituracao>;
