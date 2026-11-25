// Projetos e mutirões cirúrgicos do SUS (F8, 04-CC linha 108), no banco do cliente (`projeto_mutirao_cirurgico` e os
// itens `_procedimento`, `_insumo`, `_fornecedor`; `justificativa_mutirao_cirurgico`; `vinculo_mutirao_cirurgico`).
// Contrato de efeito:
//   - projeto: inclusão validada pela regra do domínio (código, descrição, portaria em `fonte_financiamento`, vigência
//     e valor); mudança de situação pela versão lida (planejado → em andamento → encerrado; cancelar com o motivo em
//     `motivo_cancelamento`; encerrar sem fim de vigência grava a data de hoje); nada apagado;
//   - metas por procedimento SIGTAP: o procedimento cirúrgico precisa do SIGTAP correspondente, sem repetir no projeto;
//     insumos e fornecedores previstos (retirar marca a exclusão; o fornecedor retirado volta pela mesma linha);
//   - vínculo: a AIH ou a APAC do estabelecimento marcada com o projeto (conferirVinculo do domínio, com a justificativa
//     de inclusão); a retirada guarda a justificativa de alteração e fica no histórico (nunca apagada). O projeto fica
//     travado na transação; o documento tem um vínculo vigente só (chave única no banco; a corrida vira 409). A cada
//     vínculo ou retirada, `quantidade_realizada` das metas é recalculada da produção (procedimentos SIGTAP das contas
//     vigentes que valem como produção);
//   - acompanhamento: meta contra produção por SIGTAP, com o ritmo esperado pela vigência (acompanharMetas) e os
//     vínculos por paciente.
import {
  acompanharMetas,
  conferirJustificativa,
  conferirMudancaSituacao,
  conferirVinculo,
  documentoSemProducao,
  type CabecalhoDocumentoSus,
  type DocumentoSus,
  type ProcedimentoProduzido,
  producaoDoDocumento,
  projetoEditavel,
  type SituacaoMutirao,
  type TipoDocumentoMutirao,
  validarMeta,
  validarProjetoMutirao,
} from '@sgh/dominio-cirurgia';
import { ErroOperacao, type Leitor, type TxOperacao } from '@sgh/nucleo';
import { z } from 'zod';
import {
  bool,
  type ContextoPortaPropria,
  entradaValida,
  naoEncontrado,
  num,
  numOuNull,
  PortaEstabelecimentoPropria,
  recusaRegra,
  txtOuNull,
} from '../../porta-estabelecimento-propria.js';

export const PORTA_MUTIRAO_CIRURGICO = Symbol('PORTA_MUTIRAO_CIRURGICO');

const PROJETO = 'projeto_mutirao_cirurgico';
const META = 'projeto_mutirao_cirurgico_procedimento';
const INSUMO = 'projeto_mutirao_cirurgico_insumo';
const FORNECEDOR = 'projeto_mutirao_cirurgico_fornecedor';
const JUSTIFICATIVA = 'justificativa_mutirao_cirurgico';
const VINCULO = 'vinculo_mutirao_cirurgico';
const ERRNO_DUPLICADO = 1062;

type Linha = Record<string, unknown>;

const id = z.number().int().positive();
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const texto = (max: number) => z.string().trim().max(max);
const esquemaProjeto = z
  .object({
    codigo: texto(30),
    descricao: texto(200),
    portaria: texto(150),
    periodoInicio: data,
    periodoFim: data.nullable().optional(),
    metaProcedimentos: z.number().int().positive().max(1e7).nullable().optional(),
    valorFinanciamento: z.number().min(0).max(1e12).nullable().optional(),
    fontePagadora: id.nullable().optional(),
    observacao: texto(2000).nullable().optional(),
  })
  .strict();
const esquemaSituacao = z
  .object({
    versao: id,
    situacao: z.enum(['planejado', 'em_andamento', 'encerrado', 'cancelado']),
    motivo: texto(500).nullable().optional(),
  })
  .strict();
const esquemaMeta = z
  .object({
    procedimento: id,
    quantidadePrevista: z.number().int().positive().max(1e7),
    valorUnitario: z.number().min(0).max(1e9).nullable().optional(),
  })
  .strict();
const esquemaInsumo = z
  .object({
    insumo: id.nullable().optional(),
    itemFaturavel: id.nullable().optional(),
    quantidadePrevista: z.number().positive().max(1e9),
  })
  .strict();
const esquemaFornecedor = z.object({ fornecedor: id }).strict();
const esquemaVersao = z.object({ versao: id }).strict();
const esquemaJustificativa = z
  .object({
    codigo: texto(30),
    descricao: texto(150),
    textoDetalhado: texto(250).nullable().optional(),
    aplicaInclusao: z.boolean().default(true),
    aplicaAlteracao: z.boolean().default(true),
    exigeComplemento: z.boolean().default(false),
  })
  .strict();
const esquemaAtivo = z.object({ versao: id, ativo: z.boolean() }).strict();
const esquemaVinculo = z
  .object({
    documento: id,
    justificativa: id,
    complemento: texto(500).nullable().optional(),
  })
  .strict();
const esquemaRetirada = z
  .object({ versao: id, justificativa: id, complemento: texto(500).nullable().optional() })
  .strict();
const esquemaBusca = z
  .object({ tipo: z.enum(['aih', 'apac']), numero: z.string().regex(/^\d{13}$/) })
  .strict();

const dataIso = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date)
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  return String(v).slice(0, 10);
};
const hojeIso = () => dataIso(new Date())!;

const SQL_PROJETO = `
  SELECT p.id, p.versao, p.codigo, p.descricao, p.fonte_financiamento, p.periodo_inicio, p.periodo_fim,
         p.meta_procedimentos, p.valor_financiamento, p.situacao, p.observacao, p.motivo_cancelamento,
         p.fonte_pagadora_id, fp.nome AS fonte_pagadora
    FROM projeto_mutirao_cirurgico p
    LEFT JOIN fonte_pagadora fp ON fp.id = p.fonte_pagadora_id`;

const projetoLido = (r: Linha) => ({
  id: num(r['id']),
  versao: num(r['versao']),
  codigo: String(r['codigo']),
  descricao: String(r['descricao']),
  portaria: txtOuNull(r['fonte_financiamento']),
  periodoInicio: dataIso(r['periodo_inicio'])!,
  periodoFim: dataIso(r['periodo_fim']),
  metaProcedimentos: numOuNull(r['meta_procedimentos']),
  valorFinanciamento: numOuNull(r['valor_financiamento']),
  situacao: String(r['situacao']) as SituacaoMutirao,
  observacao: txtOuNull(r['observacao']),
  motivoCancelamento: txtOuNull(r['motivo_cancelamento']),
  fontePagadora: txtOuNull(r['fonte_pagadora']),
});

/** As metas do projeto com o SIGTAP do procedimento cirúrgico (o que conta a produção). */
const SQL_METAS = `
  SELECT m.id, m.versao, m.sequencia, m.procedimento_cirurgico_id, pc.codigo AS proc_codigo,
         pc.descricao AS proc_descricao, pc.procedimento_sigtap_id, ps.codigo_sigtap, m.quantidade_prevista,
         m.quantidade_realizada, m.valor_unitario
    FROM projeto_mutirao_cirurgico_procedimento m
    JOIN procedimento_cirurgico pc ON pc.id = m.procedimento_cirurgico_id
    LEFT JOIN procedimento_sigtap ps ON ps.id = pc.procedimento_sigtap_id
   WHERE m.projeto_mutirao_cirurgico_id = ? AND m.excluido_em IS NULL
   ORDER BY m.sequencia`;

/**
 * A produção do projeto por documento: as AIH e as APAC com vínculo vigente, fora das situações que não valem como
 * produção, com as linhas de procedimento lançadas (uma linha nula quando não há) e o procedimento do cabeçalho.
 * `producaoDoDocumento` do domínio decide o que conta, a mesma regra da elegibilidade do vínculo (`documentos`).
 */
const SQL_PRODUCAO = `
  SELECT 'aih' AS tipo, ca.id AS documento, cp.procedimento_sigtap_id AS sigtap, cp.quantidade,
         ca.realizado_procedimento_sigtap_id AS realizado, ca.solicitado_procedimento_sigtap_id AS solicitado
    FROM vinculo_mutirao_cirurgico v
    JOIN conta_aih ca ON ca.id = v.conta_aih_id AND ca.excluido_em IS NULL
                     AND ca.situacao NOT IN ('negada', 'cancelada', 'rejeitada')
    LEFT JOIN conta_aih_procedimento cp ON cp.conta_aih_id = ca.id AND cp.excluido_em IS NULL
   WHERE v.projeto_mutirao_cirurgico_id = ? AND v.situacao = 'vigente'
  UNION ALL
  SELECT 'apac' AS tipo, a.id AS documento, ap.procedimento_sigtap_id AS sigtap, ap.quantidade,
         a.principal_procedimento_sigtap_id AS realizado, NULL AS solicitado
    FROM vinculo_mutirao_cirurgico v
    JOIN apac a ON a.id = v.apac_id AND a.excluido_em IS NULL AND a.situacao NOT IN ('cancelada', 'rejeitada')
    LEFT JOIN apac_procedimento ap ON ap.apac_id = a.id AND ap.excluido_em IS NULL
   WHERE v.projeto_mutirao_cirurgico_id = ? AND v.situacao = 'vigente'`;

/** Soma a produção por SIGTAP a partir das linhas por documento de `SQL_PRODUCAO`. */
function producaoPorSigtap(linhas: readonly Linha[]): Map<number, number> {
  const porDocumento = new Map<
    string,
    { linhas: ProcedimentoProduzido[]; cabecalho: CabecalhoDocumentoSus }
  >();
  for (const r of linhas) {
    const chave = `${String(r['tipo'])}:${num(r['documento'])}`;
    let d = porDocumento.get(chave);
    if (!d) {
      d = {
        linhas: [],
        cabecalho: { realizado: numOuNull(r['realizado']), solicitado: numOuNull(r['solicitado']) },
      };
      porDocumento.set(chave, d);
    }
    if (r['sigtap'] != null) d.linhas.push({ sigtap: num(r['sigtap']), quantidade: num(r['quantidade']) });
  }
  const total = new Map<number, number>();
  for (const d of porDocumento.values())
    for (const x of producaoDoDocumento(d.linhas, d.cabecalho))
      total.set(x.sigtap, (total.get(x.sigtap) ?? 0) + x.quantidade);
  return total;
}

/** Os vínculos do projeto (vigentes e retirados), por paciente. */
const SQL_VINCULOS = `
  SELECT v.id, v.versao, v.tipo_documento, v.situacao, v.complemento, v.criado_em, v.retirado_em,
         v.retirada_complemento, j.descricao AS justificativa, jr.descricao AS retirada_justificativa,
         COALESCE(ca.numero_aih, a.numero_apac) AS numero, COALESCE(ca.situacao, a.situacao) AS doc_situacao,
         COALESCE(ca.data_internacao, a.data_inicio) AS doc_data,
         COALESCE(ca.paciente_id, at.paciente_id) AS paciente_id, pac.numero_prontuario, pf.nome AS paciente
    FROM vinculo_mutirao_cirurgico v
    JOIN justificativa_mutirao_cirurgico j ON j.id = v.justificativa_mutirao_cirurgico_id
    LEFT JOIN justificativa_mutirao_cirurgico jr ON jr.id = v.retirada_justificativa_id
    LEFT JOIN conta_aih ca ON ca.id = v.conta_aih_id
    LEFT JOIN apac a ON a.id = v.apac_id
    LEFT JOIN atendimento at ON at.id = a.atendimento_id
    LEFT JOIN paciente pac ON pac.id = COALESCE(ca.paciente_id, at.paciente_id)
    LEFT JOIN pessoa_fisica pf ON pf.id = pac.pessoa_fisica_id
   WHERE v.projeto_mutirao_cirurgico_id = ?
   ORDER BY v.situacao = 'retirado', pf.nome, v.id`;

const justificativaLida = (r: Linha) => ({
  id: num(r['id']),
  versao: num(r['versao']),
  codigo: String(r['codigo']),
  descricao: String(r['descricao']),
  textoDetalhado: txtOuNull(r['texto_detalhado']),
  ativo: bool(r['ativo']),
  aplicaInclusao: bool(r['aplica_inclusao']),
  aplicaAlteracao: bool(r['aplica_alteracao']),
  exigeComplemento: bool(r['exige_complemento']),
});
const SQL_JUSTIFICATIVAS = `SELECT id, versao, codigo, descricao, texto_detalhado, ativo, aplica_inclusao,
       aplica_alteracao, exige_complemento FROM justificativa_mutirao_cirurgico`;

export class PortaMutiraoCirurgicoPropria extends PortaEstabelecimentoPropria {
  constructor(nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0], cliente: string) {
    super(nucleo, cliente, [PROJETO, META, INSUMO, FORNECEDOR, JUSTIFICATIVA, VINCULO], 'cirurgia.mutirao');
  }

  /** Os projetos do estabelecimento com o resumo da meta contra a produção, as justificativas e as opções. */
  async painel(c: ContextoPortaPropria) {
    return this.ler(c, 'painel', async (l, est) => {
      const projetos = await l.consultar<Linha>(
        `${SQL_PROJETO} WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL
          ORDER BY p.situacao IN ('encerrado', 'cancelado'), p.periodo_inicio DESC, p.id DESC LIMIT 200`,
        [est.id],
      );
      const lista = [];
      for (const r of projetos) {
        const p = projetoLido(r);
        const a = await this.acompanhar(l, p);
        lista.push({ ...p, prevista: a.prevista, realizada: a.realizada, percentual: a.percentual });
      }
      const opcoes = async (sql: string) =>
        (await l.consultar<Linha>(sql)).map((x) => ({ id: num(x['id']), rotulo: String(x['rotulo']) }));
      return {
        projetos: lista,
        justificativas: (await l.consultar<Linha>(`${SQL_JUSTIFICATIVAS} ORDER BY ativo DESC, codigo`)).map(
          justificativaLida,
        ),
        opcoes: {
          procedimentos: (
            await l.consultar<Linha>(
              `SELECT pc.id, CONCAT(pc.codigo, ' - ', pc.descricao) AS rotulo, ps.codigo_sigtap
                 FROM procedimento_cirurgico pc
                 LEFT JOIN procedimento_sigtap ps ON ps.id = pc.procedimento_sigtap_id
                WHERE pc.ativo AND pc.excluido_em IS NULL ORDER BY pc.descricao LIMIT 1000`,
            )
          ).map((x) => ({
            id: num(x['id']),
            rotulo: String(x['rotulo']),
            sigtap: txtOuNull(x['codigo_sigtap']),
          })),
          fornecedores: await opcoes(
            `SELECT id, COALESCE(nome_fantasia, razao_social) AS rotulo FROM empresa_fornecedora
              WHERE excluido_em IS NULL ORDER BY rotulo LIMIT 1000`,
          ),
          insumos: await opcoes(
            `SELECT id, CONCAT(codigo, ' - ', nome) AS rotulo FROM insumo WHERE excluido_em IS NULL
              ORDER BY nome LIMIT 1000`,
          ),
          fontesPagadoras: await opcoes(
            'SELECT id, nome AS rotulo FROM fonte_pagadora WHERE excluido_em IS NULL ORDER BY nome LIMIT 200',
          ),
        },
      };
    });
  }

  /** O projeto com as metas contra a produção, os insumos, os fornecedores e os vínculos por paciente. */
  async detalhe(c: ContextoPortaPropria, projeto: number) {
    return this.ler(c, 'detalhe', async (l, est) => {
      const r = await l.uma(
        `${SQL_PROJETO} WHERE p.id = ? AND p.estabelecimento_id = ? AND p.excluido_em IS NULL`,
        [projeto, est.id],
      );
      if (!r) throw naoEncontrado('Projeto de mutirão');
      const p = projetoLido(r);
      const metas = await l.consultar<Linha>(SQL_METAS, [projeto]);
      const a = await this.acompanhar(l, p, metas);
      const insumos = await l.consultar<Linha>(
        `SELECT pi.id, pi.versao, pi.sequencia, pi.insumo_id, i.nome AS insumo, pi.item_faturavel_id,
                f.descricao AS item, pi.quantidade_prevista, pi.quantidade_utilizada
           FROM projeto_mutirao_cirurgico_insumo pi
           LEFT JOIN insumo i ON i.id = pi.insumo_id
           LEFT JOIN item_faturavel f ON f.id = pi.item_faturavel_id
          WHERE pi.projeto_mutirao_cirurgico_id = ? AND pi.excluido_em IS NULL ORDER BY pi.sequencia`,
        [projeto],
      );
      const fornecedores = await l.consultar<Linha>(
        `SELECT pf.id, pf.versao, pf.empresa_fornecedora_id, COALESCE(e.nome_fantasia, e.razao_social) AS nome,
                e.cnpj
           FROM projeto_mutirao_cirurgico_fornecedor pf
           JOIN empresa_fornecedora e ON e.id = pf.empresa_fornecedora_id
          WHERE pf.projeto_mutirao_cirurgico_id = ? AND pf.excluido_em IS NULL ORDER BY nome`,
        [projeto],
      );
      const vinculos = await l.consultar<Linha>(SQL_VINCULOS, [projeto]);
      return {
        projeto: p,
        acompanhamento: {
          prevista: a.prevista,
          realizada: a.realizada,
          percentual: a.percentual,
          valorPrevisto: a.valorPrevisto,
          valorRealizado: a.valorRealizado,
          decorrido: a.decorrido,
        },
        metas: metas.map((m, i) => ({
          id: num(m['id']),
          versao: num(m['versao']),
          procedimento: num(m['procedimento_cirurgico_id']),
          procedimentoDescricao: `${String(m['proc_codigo'])} - ${String(m['proc_descricao'])}`,
          sigtap: txtOuNull(m['codigo_sigtap']),
          valorUnitario: numOuNull(m['valor_unitario']),
          ...(a.metasPorLinha[i] ?? { prevista: num(m['quantidade_prevista']), realizada: 0, saldo: 0 }),
        })),
        insumos: insumos.map((x) => ({
          id: num(x['id']),
          versao: num(x['versao']),
          descricao: txtOuNull(x['insumo']) ?? txtOuNull(x['item']) ?? '',
          quantidadePrevista: num(x['quantidade_prevista']),
          quantidadeUtilizada: num(x['quantidade_utilizada']),
        })),
        fornecedores: fornecedores.map((x) => ({
          id: num(x['id']),
          versao: num(x['versao']),
          fornecedor: num(x['empresa_fornecedora_id']),
          nome: String(x['nome']),
          cnpj: txtOuNull(x['cnpj']),
        })),
        vinculos: vinculos.map((v) => ({
          id: num(v['id']),
          versao: num(v['versao']),
          tipo: String(v['tipo_documento']) as TipoDocumentoMutirao,
          numero: String(v['numero'] ?? ''),
          documentoSituacao: String(v['doc_situacao'] ?? ''),
          documentoData: dataIso(v['doc_data']),
          paciente: txtOuNull(v['paciente']),
          prontuario: txtOuNull(v['numero_prontuario']),
          situacao: String(v['situacao']),
          justificativa: String(v['justificativa']),
          complemento: txtOuNull(v['complemento']),
          vinculadoEm: v['criado_em'] ? new Date(v['criado_em'] as string).toISOString() : null,
          retiradoEm: v['retirado_em'] ? new Date(v['retirado_em'] as string).toISOString() : null,
          retiradaJustificativa: txtOuNull(v['retirada_justificativa']),
          retiradaComplemento: txtOuNull(v['retirada_complemento']),
        })),
      };
    });
  }

  /** Inclui o projeto (planejado) validado pela regra do domínio. */
  async incluirProjeto(c: ContextoPortaPropria, entrada: unknown) {
    const e = entradaValida(esquemaProjeto, entrada);
    const codigo = e.codigo.toUpperCase();
    const problemas = validarProjetoMutirao({
      codigo,
      descricao: e.descricao,
      portaria: e.portaria,
      periodoInicio: e.periodoInicio,
      periodoFim: e.periodoFim ?? null,
      valorFinanciamento: e.valorFinanciamento ?? null,
    });
    if (problemas.length) throw recusaRegra('Projeto recusado', problemas);
    return this.gravar(c, 'cirurgia.mutirao.projeto-incluir', [PROJETO], async (tx, est) => {
      const ja = await tx.uma(
        'SELECT id FROM projeto_mutirao_cirurgico WHERE estabelecimento_id = ? AND codigo = ?',
        [est.id, codigo],
      );
      if (ja)
        throw recusaRegra('Projeto recusado', [
          { campo: 'codigo', mensagem: 'Já existe projeto com este código.' },
        ]);
      const novo = await tx.incluir(PROJETO, {
        estabelecimento_id: est.id,
        codigo,
        descricao: e.descricao,
        fonte_financiamento: e.portaria,
        fonte_pagadora_id: e.fontePagadora ?? null,
        periodo_inicio: e.periodoInicio,
        periodo_fim: e.periodoFim ?? null,
        meta_procedimentos: e.metaProcedimentos ?? null,
        valor_financiamento: e.valorFinanciamento ?? null,
        situacao: 'planejado',
        observacao: e.observacao || null,
        origem: 'sistema',
      });
      return { tabela: PROJETO, id: novo };
    });
  }

  /** Muda a situação pela versão lida (encerrar sem fim grava hoje; cancelar com o motivo). Nada apagado. */
  async mudarSituacao(c: ContextoPortaPropria, projeto: number, entrada: unknown) {
    const e = entradaValida(esquemaSituacao, entrada);
    return this.gravar(c, 'cirurgia.mutirao.projeto-situacao', [PROJETO], async (tx, est) => {
      const p = await this.projetoTravado(tx, projeto, est.id);
      const problemas = conferirMudancaSituacao(p.situacao, e.situacao, e.motivo ?? null);
      if (problemas.length) throw recusaRegra('Mudança recusada', problemas);
      const campos: Record<string, unknown> = { situacao: e.situacao };
      if (e.situacao === 'cancelado') campos['motivo_cancelamento'] = e.motivo;
      if (e.situacao === 'encerrado' && !p.periodoFim)
        campos['periodo_fim'] = hojeIso() < p.periodoInicio ? p.periodoInicio : hojeIso();
      await tx.alterar(PROJETO, projeto, e.versao, campos);
      return { tabela: PROJETO, id: projeto, situacao: e.situacao };
    });
  }

  /** Inclui a meta por procedimento (contada pelo SIGTAP do procedimento cirúrgico). */
  async incluirMeta(c: ContextoPortaPropria, projeto: number, entrada: unknown) {
    const e = entradaValida(esquemaMeta, entrada);
    return this.gravar(c, 'cirurgia.mutirao.meta-incluir', [META], async (tx, est) => {
      await this.projetoEditavelTravado(tx, projeto, est.id);
      const pc = await tx.uma(
        'SELECT id, procedimento_sigtap_id FROM procedimento_cirurgico WHERE id = ? AND excluido_em IS NULL',
        [e.procedimento],
      );
      if (!pc) throw naoEncontrado('Procedimento cirúrgico');
      const metas = await tx.consultar<Linha>(SQL_METAS, [projeto]);
      const problemas = validarMeta(
        {
          sigtap: numOuNull(pc['procedimento_sigtap_id']),
          quantidadePrevista: e.quantidadePrevista,
          valorUnitario: e.valorUnitario ?? null,
        },
        metas.flatMap((m) => (m['procedimento_sigtap_id'] == null ? [] : [num(m['procedimento_sigtap_id'])])),
      );
      if (metas.some((m) => num(m['procedimento_cirurgico_id']) === e.procedimento))
        problemas.push({ campo: 'procedimento', mensagem: 'O projeto já tem meta para este procedimento.' });
      if (problemas.length) throw recusaRegra('Meta recusada', problemas);
      const seq = await this.proximaSequencia(tx, 'meta', projeto);
      const novo = await tx.incluir(META, {
        projeto_mutirao_cirurgico_id: projeto,
        sequencia: seq,
        procedimento_cirurgico_id: e.procedimento,
        quantidade_prevista: e.quantidadePrevista,
        quantidade_realizada: 0,
        valor_unitario: e.valorUnitario ?? null,
        origem: 'sistema',
      });
      await this.recalcularRealizada(tx, projeto);
      return { tabela: META, id: novo };
    });
  }

  /** Retira a meta (marca a exclusão; a linha fica). */
  async retirarMeta(c: ContextoPortaPropria, projeto: number, meta: number, entrada: unknown) {
    return this.retirarItem(c, 'cirurgia.mutirao.meta-retirar', META, projeto, meta, entrada);
  }

  /** Inclui o insumo ou o item faturável previsto. */
  async incluirInsumo(c: ContextoPortaPropria, projeto: number, entrada: unknown) {
    const e = entradaValida(esquemaInsumo, entrada);
    if (!e.insumo === !e.itemFaturavel)
      throw recusaRegra('Insumo recusado', [
        { campo: 'insumo', mensagem: 'Escolha o insumo do estoque ou o item faturável (um dos dois).' },
      ]);
    return this.gravar(c, 'cirurgia.mutirao.insumo-incluir', [INSUMO], async (tx, est) => {
      await this.projetoEditavelTravado(tx, projeto, est.id);
      const seq = await this.proximaSequencia(tx, 'insumo', projeto);
      const novo = await tx.incluir(INSUMO, {
        projeto_mutirao_cirurgico_id: projeto,
        sequencia: seq,
        insumo_id: e.insumo ?? null,
        item_faturavel_id: e.itemFaturavel ?? null,
        quantidade_prevista: e.quantidadePrevista,
        quantidade_utilizada: 0,
        origem: 'sistema',
      });
      return { tabela: INSUMO, id: novo };
    });
  }

  async retirarInsumo(c: ContextoPortaPropria, projeto: number, item: number, entrada: unknown) {
    return this.retirarItem(c, 'cirurgia.mutirao.insumo-retirar', INSUMO, projeto, item, entrada);
  }

  /** Inclui o fornecedor participante (o retirado antes volta pela mesma linha). */
  async incluirFornecedor(c: ContextoPortaPropria, projeto: number, entrada: unknown) {
    const e = entradaValida(esquemaFornecedor, entrada);
    return this.gravar(c, 'cirurgia.mutirao.fornecedor-incluir', [FORNECEDOR], async (tx, est) => {
      await this.projetoEditavelTravado(tx, projeto, est.id);
      const f = await tx.uma('SELECT id FROM empresa_fornecedora WHERE id = ? AND excluido_em IS NULL', [
        e.fornecedor,
      ]);
      if (!f) throw naoEncontrado('Fornecedor');
      const ja = await tx.uma(
        `SELECT id, versao, excluido_em FROM projeto_mutirao_cirurgico_fornecedor
          WHERE projeto_mutirao_cirurgico_id = ? AND empresa_fornecedora_id = ?`,
        [projeto, e.fornecedor],
      );
      if (ja && ja['excluido_em'] === null)
        throw recusaRegra('Fornecedor recusado', [
          { campo: 'fornecedor', mensagem: 'O fornecedor já participa do projeto.' },
        ]);
      if (ja) {
        await tx.alterar(FORNECEDOR, num(ja['id']), num(ja['versao']), {
          excluido_em: null,
          excluido_por: null,
        });
        return { tabela: FORNECEDOR, id: num(ja['id']) };
      }
      const novo = await tx.incluir(FORNECEDOR, {
        projeto_mutirao_cirurgico_id: projeto,
        empresa_fornecedora_id: e.fornecedor,
      });
      return { tabela: FORNECEDOR, id: novo };
    });
  }

  async retirarFornecedor(c: ContextoPortaPropria, projeto: number, item: number, entrada: unknown) {
    return this.retirarItem(c, 'cirurgia.mutirao.fornecedor-retirar', FORNECEDOR, projeto, item, entrada);
  }

  /** Inclui a justificativa padronizada (cadastro do cliente). */
  async incluirJustificativa(c: ContextoPortaPropria, entrada: unknown) {
    const e = entradaValida(esquemaJustificativa, entrada);
    const codigo = e.codigo.toUpperCase();
    const problemas = [];
    if (!/^[A-Z0-9][A-Z0-9._-]{0,29}$/.test(codigo))
      problemas.push({ campo: 'codigo', mensagem: 'Informe o código (letras, números, ponto ou traço).' });
    if (e.descricao.length < 3) problemas.push({ campo: 'descricao', mensagem: 'Informe a descrição.' });
    if (!e.aplicaInclusao && !e.aplicaAlteracao)
      problemas.push({
        campo: 'aplicaInclusao',
        mensagem: 'A justificativa precisa servir à inclusão ou à retirada.',
      });
    if (problemas.length) throw recusaRegra('Justificativa recusada', problemas);
    return this.gravar(c, 'cirurgia.mutirao.justificativa-incluir', [JUSTIFICATIVA], async (tx) => {
      const ja = await tx.uma('SELECT id FROM justificativa_mutirao_cirurgico WHERE codigo = ?', [codigo]);
      if (ja)
        throw recusaRegra('Justificativa recusada', [
          { campo: 'codigo', mensagem: 'Já existe justificativa com este código.' },
        ]);
      const novo = await tx.incluir(JUSTIFICATIVA, {
        codigo,
        descricao: e.descricao,
        texto_detalhado: e.textoDetalhado || null,
        ativo: true,
        aplica_inclusao: e.aplicaInclusao,
        aplica_alteracao: e.aplicaAlteracao,
        exige_complemento: e.exigeComplemento,
      });
      return { tabela: JUSTIFICATIVA, id: novo };
    });
  }

  /** Ativa ou desativa a justificativa pela versão lida (nada apagado). */
  async ativarJustificativa(c: ContextoPortaPropria, justificativa: number, entrada: unknown) {
    const e = entradaValida(esquemaAtivo, entrada);
    return this.gravar(c, 'cirurgia.mutirao.justificativa-ativo', [JUSTIFICATIVA], async (tx) => {
      const j = await tx.uma('SELECT id FROM justificativa_mutirao_cirurgico WHERE id = ?', [justificativa]);
      if (!j) throw naoEncontrado('Justificativa');
      await tx.alterar(JUSTIFICATIVA, justificativa, e.versao, { ativo: e.ativo });
      return { tabela: JUSTIFICATIVA, id: justificativa, ativo: e.ativo };
    });
  }

  /** Busca a AIH ou a APAC pelo número e devolve a conferência do vínculo (validação na hora, sem gravar). */
  async buscarDocumento(c: ContextoPortaPropria, projeto: number, consulta: unknown) {
    const q = entradaValida(esquemaBusca, consulta);
    return this.ler(c, 'documento', async (l, est) => {
      const r = await l.uma(
        `${SQL_PROJETO} WHERE p.id = ? AND p.estabelecimento_id = ? AND p.excluido_em IS NULL`,
        [projeto, est.id],
      );
      if (!r) throw naoEncontrado('Projeto de mutirão');
      const p = projetoLido(r);
      const docs = await this.documentos(l, q.tipo, est.id, { numero: q.numero });
      const metas = await l.consultar<Linha>(SQL_METAS, [projeto]);
      const sigtaps = metas.flatMap((m) =>
        m['procedimento_sigtap_id'] == null ? [] : [num(m['procedimento_sigtap_id'])],
      );
      return {
        documentos: docs.map((d) => ({
          id: d.id,
          tipo: q.tipo,
          numero: d.numero,
          situacao: d.doc.situacao,
          data: d.doc.data,
          paciente: d.paciente,
          prontuario: d.prontuario,
          problemas: conferirVinculo(
            { ...p, sigtapsDasMetas: sigtaps },
            d.doc,
            { ativo: true, aplicaInclusao: true, aplicaAlteracao: true, exigeComplemento: false },
            null,
          ),
        })),
      };
    });
  }

  /** Marca a AIH ou a APAC com o projeto (projeto travado; um vínculo vigente por documento). */
  async vincular(c: ContextoPortaPropria, projeto: number, tipo: TipoDocumentoMutirao, entrada: unknown) {
    const e = entradaValida(esquemaVinculo, entrada);
    return this.semDuplicado(() =>
      this.gravar(c, `cirurgia.mutirao.vincular-${tipo}`, [VINCULO, META], async (tx, est) => {
        const p = await this.projetoTravado(tx, projeto, est.id);
        const [d] = await this.documentos(tx, tipo, est.id, { id: e.documento });
        if (!d) throw naoEncontrado(tipo === 'aih' ? 'AIH' : 'APAC');
        const metas = await tx.consultar<Linha>(SQL_METAS, [projeto]);
        const j = await tx.uma(`${SQL_JUSTIFICATIVAS} WHERE id = ?`, [e.justificativa]);
        const problemas = conferirVinculo(
          {
            ...p,
            sigtapsDasMetas: metas.flatMap((m) =>
              m['procedimento_sigtap_id'] == null ? [] : [num(m['procedimento_sigtap_id'])],
            ),
          },
          d.doc,
          j ? justificativaLida(j) : null,
          e.complemento ?? null,
        );
        if (problemas.length) throw recusaRegra('Vínculo recusado', problemas);
        const novo = await tx.incluir(VINCULO, {
          projeto_mutirao_cirurgico_id: projeto,
          tipo_documento: tipo,
          conta_aih_id: tipo === 'aih' ? d.id : null,
          apac_id: tipo === 'apac' ? d.id : null,
          justificativa_mutirao_cirurgico_id: e.justificativa,
          complemento: e.complemento || null,
          situacao: 'vigente',
          origem: 'sistema',
        });
        const realizada = await this.recalcularRealizada(tx, projeto);
        return { tabela: VINCULO, id: novo, realizada };
      }),
    );
  }

  /** Retira a AIH ou a APAC do projeto com a justificativa de alteração (a linha fica no histórico). */
  async retirarVinculo(c: ContextoPortaPropria, projeto: number, vinculo: number, entrada: unknown) {
    const e = entradaValida(esquemaRetirada, entrada);
    return this.gravar(c, 'cirurgia.mutirao.vinculo-retirar', [VINCULO, META], async (tx, est, usuario) => {
      const p = await this.projetoTravado(tx, projeto, est.id);
      if (!projetoEditavel(p.situacao))
        throw recusaRegra('Retirada recusada', [
          { campo: 'projeto', mensagem: 'O projeto encerrado ou cancelado guarda os vínculos como estão.' },
        ]);
      const v = await tx.uma(
        'SELECT id, situacao FROM vinculo_mutirao_cirurgico WHERE id = ? AND projeto_mutirao_cirurgico_id = ?',
        [vinculo, projeto],
      );
      if (!v) throw naoEncontrado('Vínculo');
      if (String(v['situacao']) !== 'vigente')
        throw recusaRegra('Retirada recusada', [
          { campo: 'vinculo', mensagem: 'O documento já foi retirado.' },
        ]);
      const j = await tx.uma(`${SQL_JUSTIFICATIVAS} WHERE id = ?`, [e.justificativa]);
      const problemas = conferirJustificativa(
        j ? justificativaLida(j) : null,
        e.complemento ?? null,
        'alteracao',
      );
      if (problemas.length) throw recusaRegra('Retirada recusada', problemas);
      await tx.alterar(VINCULO, vinculo, e.versao, {
        situacao: 'retirado',
        retirado_em: new Date(),
        retirado_por: usuario,
        retirada_justificativa_id: e.justificativa,
        retirada_complemento: e.complemento || null,
      });
      const realizada = await this.recalcularRealizada(tx, projeto);
      return { tabela: VINCULO, id: vinculo, realizada };
    });
  }

  // ── apoio ──

  private async acompanhar(l: Leitor, p: ReturnType<typeof projetoLido>, metasLidas?: Linha[]) {
    const metas = metasLidas ?? (await l.consultar<Linha>(SQL_METAS, [p.id]));
    const producao = [...producaoPorSigtap(await l.consultar<Linha>(SQL_PRODUCAO, [p.id, p.id]))].map(
      ([sigtap, quantidade]) => ({ sigtap, quantidade }),
    );
    // A meta sem SIGTAP (procedimento alterado depois) entra com o id negativo: sem produção, mas com a previsão.
    const a = acompanharMetas(
      metas.map((m) => ({
        sigtap: m['procedimento_sigtap_id'] == null ? -num(m['id']) : num(m['procedimento_sigtap_id']),
        quantidadePrevista: num(m['quantidade_prevista']),
        valorUnitario: numOuNull(m['valor_unitario']),
      })),
      producao,
      { inicio: p.periodoInicio, fim: p.periodoFim },
      hojeIso(),
    );
    return {
      ...a,
      metasPorLinha: a.metas.map((m) => ({
        prevista: m.prevista,
        realizada: m.realizada,
        saldo: m.saldo,
        percentual: m.percentual,
        esperadoAteHoje: m.esperadoAteHoje,
        ritmo: m.ritmo,
        valorPrevisto: m.valorPrevisto,
        valorRealizado: m.valorRealizado,
      })),
    };
  }

  /** Recalcula `quantidade_realizada` de cada meta pela produção vigente; devolve o total realizado. */
  private async recalcularRealizada(tx: TxOperacao, projeto: number): Promise<number> {
    const metas = await tx.consultar<Linha>(
      `SELECT m.id, m.versao, m.quantidade_realizada, pc.procedimento_sigtap_id
         FROM projeto_mutirao_cirurgico_procedimento m
         JOIN procedimento_cirurgico pc ON pc.id = m.procedimento_cirurgico_id
        WHERE m.projeto_mutirao_cirurgico_id = ? AND m.excluido_em IS NULL`,
      [projeto],
    );
    const producao = producaoPorSigtap(await tx.consultar<Linha>(SQL_PRODUCAO, [projeto, projeto]));
    let total = 0;
    for (const m of metas) {
      const nova = Math.round(producao.get(num(m['procedimento_sigtap_id'])) ?? 0);
      total += nova;
      if (nova !== num(m['quantidade_realizada']))
        await tx.alterar(META, num(m['id']), num(m['versao']), { quantidade_realizada: nova });
    }
    return total;
  }

  /** A AIH ou a APAC do estabelecimento com os procedimentos SIGTAP e o projeto vigente. */
  private async documentos(
    l: Leitor,
    tipo: TipoDocumentoMutirao,
    estabelecimento: number,
    filtro: { numero?: string; id?: number },
  ) {
    const porId = filtro.id !== undefined;
    const rs =
      tipo === 'aih'
        ? await l.consultar<Linha>(
            `SELECT ca.id, ca.numero_aih AS numero, ca.situacao, ca.data_internacao AS data, pac.numero_prontuario,
                    pf.nome AS paciente,
                    (SELECT GROUP_CONCAT(cp.procedimento_sigtap_id) FROM conta_aih_procedimento cp
                      WHERE cp.conta_aih_id = ca.id AND cp.excluido_em IS NULL) AS sigtaps,
                    ca.solicitado_procedimento_sigtap_id, ca.realizado_procedimento_sigtap_id,
                    (SELECT v.projeto_mutirao_cirurgico_id FROM vinculo_mutirao_cirurgico v
                      WHERE v.conta_aih_id = ca.id AND v.situacao = 'vigente') AS projeto_atual
               FROM conta_aih ca
               JOIN paciente pac ON pac.id = ca.paciente_id
               JOIN pessoa_fisica pf ON pf.id = pac.pessoa_fisica_id
              WHERE ca.estabelecimento_id = ? AND ca.excluido_em IS NULL AND ${porId ? 'ca.id = ?' : 'ca.numero_aih = ?'}
              ORDER BY ca.id DESC LIMIT 20`,
            [estabelecimento, porId ? filtro.id : filtro.numero],
          )
        : await l.consultar<Linha>(
            `SELECT a.id, a.numero_apac AS numero, a.situacao, a.data_inicio AS data, pac.numero_prontuario,
                    pf.nome AS paciente,
                    (SELECT GROUP_CONCAT(ap.procedimento_sigtap_id) FROM apac_procedimento ap
                      WHERE ap.apac_id = a.id AND ap.excluido_em IS NULL) AS sigtaps,
                    a.principal_procedimento_sigtap_id AS realizado_procedimento_sigtap_id,
                    NULL AS solicitado_procedimento_sigtap_id,
                    (SELECT v.projeto_mutirao_cirurgico_id FROM vinculo_mutirao_cirurgico v
                      WHERE v.apac_id = a.id AND v.situacao = 'vigente') AS projeto_atual
               FROM apac a
               LEFT JOIN atendimento at ON at.id = a.atendimento_id
               LEFT JOIN paciente pac ON pac.id = at.paciente_id
               LEFT JOIN pessoa_fisica pf ON pf.id = pac.pessoa_fisica_id
              WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL AND ${porId ? 'a.id = ?' : 'a.numero_apac = ?'}
              ORDER BY a.id DESC LIMIT 20`,
            [estabelecimento, porId ? filtro.id : filtro.numero],
          );
    return rs.map((r) => {
      // A mesma regra da produção (`producaoDoDocumento`): as linhas lançadas; sem linha, o cabeçalho.
      const lancadas = String(r['sigtaps'] ?? '')
        .split(',')
        .filter(Boolean)
        .map((s) => ({ sigtap: Number(s), quantidade: 1 }));
      const sigtaps = producaoDoDocumento(lancadas, {
        realizado: numOuNull(r['realizado_procedimento_sigtap_id']),
        solicitado: numOuNull(r['solicitado_procedimento_sigtap_id']),
      }).map((x) => x.sigtap);
      const doc: DocumentoSus = {
        tipo,
        situacao: String(r['situacao']),
        data: dataIso(r['data'])!,
        sigtaps,
        projetoAtual: numOuNull(r['projeto_atual']),
      };
      return {
        id: num(r['id']),
        numero: String(r['numero']),
        paciente: txtOuNull(r['paciente']),
        prontuario: txtOuNull(r['numero_prontuario']),
        semProducao: documentoSemProducao(tipo, doc.situacao),
        doc,
      };
    });
  }

  private async projetoTravado(tx: TxOperacao, projeto: number, estabelecimento: number) {
    const [r] = await tx.consultarParaAtualizar<Linha>(
      `SELECT id, versao, codigo, descricao, fonte_financiamento, periodo_inicio, periodo_fim, meta_procedimentos,
              valor_financiamento, situacao, observacao, motivo_cancelamento, NULL AS fonte_pagadora
         FROM projeto_mutirao_cirurgico WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [projeto, estabelecimento],
    );
    if (!r) throw naoEncontrado('Projeto de mutirão');
    return projetoLido(r);
  }

  private async projetoEditavelTravado(tx: TxOperacao, projeto: number, estabelecimento: number) {
    const p = await this.projetoTravado(tx, projeto, estabelecimento);
    if (!projetoEditavel(p.situacao))
      throw recusaRegra('Alteração recusada', [
        {
          campo: 'projeto',
          mensagem: 'O projeto encerrado ou cancelado não muda metas, insumos nem fornecedores.',
        },
      ]);
    return p;
  }

  private async proximaSequencia(tx: TxOperacao, item: 'meta' | 'insumo', projeto: number): Promise<number> {
    const r =
      item === 'meta'
        ? await tx.uma(
            'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM projeto_mutirao_cirurgico_procedimento WHERE projeto_mutirao_cirurgico_id = ?',
            [projeto],
          )
        : await tx.uma(
            'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM projeto_mutirao_cirurgico_insumo WHERE projeto_mutirao_cirurgico_id = ?',
            [projeto],
          );
    return num(r?.['s'] ?? 1);
  }

  /** Retira a meta, o insumo ou o fornecedor pela versão lida (marca a exclusão; nada apagado). */
  private retirarItem(
    c: ContextoPortaPropria,
    nome: string,
    tabela: typeof META | typeof INSUMO | typeof FORNECEDOR,
    projeto: number,
    item: number,
    entrada: unknown,
  ) {
    const e = entradaValida(esquemaVersao, entrada);
    return this.gravar(c, nome, [tabela], async (tx, est, usuario) => {
      await this.projetoEditavelTravado(tx, projeto, est.id);
      const r =
        tabela === META
          ? await tx.uma(
              'SELECT id FROM projeto_mutirao_cirurgico_procedimento WHERE id = ? AND projeto_mutirao_cirurgico_id = ? AND excluido_em IS NULL',
              [item, projeto],
            )
          : tabela === INSUMO
            ? await tx.uma(
                'SELECT id FROM projeto_mutirao_cirurgico_insumo WHERE id = ? AND projeto_mutirao_cirurgico_id = ? AND excluido_em IS NULL',
                [item, projeto],
              )
            : await tx.uma(
                'SELECT id FROM projeto_mutirao_cirurgico_fornecedor WHERE id = ? AND projeto_mutirao_cirurgico_id = ? AND excluido_em IS NULL',
                [item, projeto],
              );
      if (!r) throw naoEncontrado('Item do projeto');
      await tx.alterar(tabela, item, e.versao, { excluido_em: new Date(), excluido_por: usuario });
      return { tabela, id: item };
    });
  }

  /** A chave única do vínculo vigente pegou a corrida: 409, nada gravado. */
  private async semDuplicado<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (erro) {
      const causa = erro as { errno?: unknown; cause?: { errno?: unknown } } | null;
      if (causa?.errno === ERRNO_DUPLICADO || causa?.cause?.errno === ERRNO_DUPLICADO)
        throw new ErroOperacao(
          409,
          'gravacao-concorrente',
          'Documento já marcado',
          'O documento foi marcado em um projeto ao mesmo tempo. Nada foi gravado: confira e tente de novo.',
        );
      throw erro;
    }
  }
}
