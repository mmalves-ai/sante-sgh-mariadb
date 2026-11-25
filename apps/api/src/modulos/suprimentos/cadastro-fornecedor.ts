// Cadastro do fornecedor, avaliação periódica e ocorrências (05-SUP linha 23) sobre o MariaDB do cliente pelo Executor
// do núcleo (trilha na mesma transação, versão conferida, Idempotency-Key honrada). O fornecedor é um só, compartilhado
// com o financeiro: empresa_fornecedora (fiscal, endereço, situação), empresa_fornecedora_contato,
// empresa_fornecedora_categoria, empresa_fornecedora_autorizacao e conta_bancaria_credor (a conta que o pagamento
// eletrônico do financeiro usa). As regras são do domínio (`@sgh/contratos/regras-suprimentos`, cadastro-fornecedor);
// aqui ficam a leitura, a trava das linhas e a gravação:
//   - contato, categoria e autorização retirados saem por exclusão lógica (excluido_em), nunca apagados;
//   - a conta bancária nunca é alterada: inclui-se a nova e inativa-se a antiga;
//   - avaliacao_fornecedor + avaliacao_fornecedor_item: a avaliação periódica (quatro critérios da regra do contrato,
//     ligados ao cadastro de critérios pelo código), com a média do período;
//   - ocorrencia_fornecedor: o número de negócio, a gravidade e o andamento até a solução (nada apagado).
import {
  avaliarFornecedor,
  type AvisoFornecedor,
  avisosFornecedor,
  chavePixNormalizada,
  conferirAndamentoOcorrencia,
  conferirAvaliacaoPeriodica,
  conferirContaBancaria,
  conferirFornecedor,
  conferirOcorrencia,
  type ContaBancariaFornecedorEntrada,
  documentoFornecedor,
  type FornecedorEntrada,
  mascararConta,
  mediaPeriodoAvaliacao,
  type OcorrenciaFornecedorEntrada,
  ocorrenciaEmAberto,
  proximaAvaliacaoFornecedor,
  type RecusaSuprimentos,
  type SituacaoAutorizacaoFornecedor,
  type SituacaoNaDataAutorizacao,
  type SituacaoOcorrenciaFornecedor,
  situacaoAutorizacaoNaData,
  type TipoAutorizacaoFornecedor,
  type AvaliacaoPeriodicaEntrada,
} from '@sgh/contratos/regras-suprimentos';
import { CRITERIOS_AVALIACAO_FORNECEDOR, type CriterioAvaliacao } from '@sgh/contratos';
import {
  type ContextoNucleo,
  type ContextoOperacao,
  definirOperacao,
  type Executor,
  garantirSequencia,
  type Leitor,
  type Linha,
  type NucleoProprio,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoPortaM18 } from '../exames/public-api.js';

export const PORTA_CADASTRO_FORNECEDOR = Symbol('PORTA_CADASTRO_FORNECEDOR');
export const TABELAS_CADASTRO_FORNECEDOR = [
  'empresa_fornecedora',
  'empresa_fornecedora_contato',
  'empresa_fornecedora_categoria',
  'empresa_fornecedora_autorizacao',
  'conta_bancaria_credor',
  'avaliacao_fornecedor',
  'avaliacao_fornecedor_item',
  'criterio_avaliacao_fornecedor',
  'ocorrencia_fornecedor',
  'sequencia_negocio',
] as const;
export const OPERACOES_CADASTRO_FORNECEDOR = {
  incluir: 'suprimentos.fornecedor.incluir',
  alterar: 'suprimentos.fornecedor.alterar',
  incluirConta: 'suprimentos.fornecedor.incluir-conta',
  inativarConta: 'suprimentos.fornecedor.inativar-conta',
  avaliar: 'suprimentos.fornecedor.avaliar',
  ocorrencia: 'suprimentos.fornecedor.registrar-ocorrencia',
  andamento: 'suprimentos.fornecedor.andamento-ocorrencia',
} as const;

/** Tipos de critério do cadastro para cada critério da regra do contrato. */
const TIPO_CRITERIO: Readonly<Record<CriterioAvaliacao, string>> = {
  qualidade: 'qualidade',
  prazo: 'pontualidade',
  atendimento: 'atendimento',
  documentacao: 'documentacao',
};

export interface FornecedorResumo {
  readonly id: number;
  readonly versao: number;
  readonly razaoSocial: string;
  readonly nomeFantasia: string | null;
  readonly tipoPessoa: 'juridica' | 'fisica';
  readonly documento: string;
  readonly situacao: string;
}

export interface FornecedorFicha extends FornecedorResumo {
  readonly dados: Omit<FornecedorEntrada, 'contatos' | 'autorizacoes' | 'categorias' | 'categoriaPrincipal'>;
  readonly categorias: readonly number[];
  readonly categoriaPrincipal: number | null;
  readonly contatos: readonly (FornecedorEntrada['contatos'][number] & { id: number })[];
  readonly autorizacoes: readonly (FornecedorEntrada['autorizacoes'][number] & {
    id: number;
    situacaoNaData: SituacaoNaDataAutorizacao;
    dias: number | null;
  })[];
  readonly contas: readonly {
    id: number;
    versao: number;
    banco: string | null;
    tipoConta: string;
    agencia: string | null;
    contaMascarada: string;
    tipoChavePix: string | null;
    titularNome: string;
    preferencial: boolean;
    ativo: boolean;
  }[];
  readonly avaliacoes: readonly {
    id: number;
    avaliadoEm: string;
    periodoInicio: string | null;
    periodoFim: string | null;
    notas: Record<CriterioAvaliacao, number>;
    media: number;
    resultado: string;
    conta: string;
    mediaPeriodo: number | null;
    parecer: string | null;
    avaliador: number;
  }[];
  readonly ocorrencias: readonly {
    id: number;
    versao: number;
    numero: number;
    tipo: string;
    gravidade: string;
    ocorridoEm: string;
    quantidadeAfetada: number | null;
    valorAfetado: number | null;
    descricao: string;
    situacao: SituacaoOcorrenciaFornecedor;
    notificadoEm: string | null;
    emailNotificacao: string | null;
    tratativa: string | null;
    resolvidaEm: string | null;
  }[];
  readonly proximaAvaliacao: string | null;
  readonly avisos: readonly AvisoFornecedor[];
}

export interface PainelCadastroFornecedor {
  readonly hoje: string;
  readonly categorias: readonly { id: number; descricao: string; exigeAutorizacao: boolean }[];
  readonly bancos: readonly { id: number; descricao: string }[];
}

export interface PortaCadastroFornecedor {
  readonly destino: 'banco' | 'indisponivel';
  painel(c: ContextoPortaM18): Promise<PainelCadastroFornecedor>;
  buscar(c: ContextoPortaM18, termo: string): Promise<FornecedorResumo[]>;
  ficha(c: ContextoPortaM18, id: number): Promise<FornecedorFicha>;
  incluir(c: ContextoPortaM18, e: FornecedorEntrada, chave: string): Promise<{ id: number }>;
  alterar(
    c: ContextoPortaM18,
    id: number,
    versao: number,
    e: FornecedorEntrada,
    chave: string,
  ): Promise<{ id: number }>;
  incluirConta(
    c: ContextoPortaM18,
    id: number,
    e: ContaBancariaFornecedorEntrada,
    chave: string,
  ): Promise<{ id: number }>;
  inativarConta(
    c: ContextoPortaM18,
    id: number,
    conta: number,
    versao: number,
    chave: string,
  ): Promise<{ id: number }>;
  avaliar(
    c: ContextoPortaM18,
    id: number,
    e: AvaliacaoPeriodicaEntrada,
    chave: string,
  ): Promise<{ id: number; media: number; resultado: string; conta: string; mediaPeriodo: number }>;
  registrarOcorrencia(
    c: ContextoPortaM18,
    id: number,
    e: OcorrenciaFornecedorEntrada,
    chave: string,
  ): Promise<{ id: number; numero: number }>;
  andamentoOcorrencia(
    c: ContextoPortaM18,
    ocorrencia: number,
    e: {
      situacao: SituacaoOcorrenciaFornecedor;
      tratativa: string | null;
      email: string | null;
      versao: number;
    },
    chave: string,
  ): Promise<{ id: number; situacao: SituacaoOcorrenciaFornecedor }>;
}

export function portaCadastroFornecedorIndisponivel(): PortaCadastroFornecedor {
  const falha = (): never => {
    throw new ErroProblema('indisponivel', 503, 'O cadastro de fornecedores exige o banco próprio.');
  };
  return {
    destino: 'indisponivel',
    painel: falha,
    buscar: falha,
    ficha: falha,
    incluir: falha,
    alterar: falha,
    incluirConta: falha,
    inativarConta: falha,
    avaliar: falha,
    registrarOcorrencia: falha,
    andamentoOcorrencia: falha,
  };
}

const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const s_ = (v: unknown) => (v === null || v === undefined ? null : String(v));
const bool = (v: unknown) => v === true || Number(v) === 1;
const limpo = (v: string | null | undefined) => (v?.trim() ? v.trim() : null);
const digitos = (v: string | null | undefined) => (v ? v.replace(/\D/g, '') || null : null);

function recusarTodas(rs: readonly RecusaSuprimentos[]): void {
  const [r] = rs;
  if (r)
    throw recusa(r.codigo, rs.map((x) => x.mensagem).join(' '), {
      campos: [...new Set(rs.flatMap((x) => x.campos ?? []))],
    });
}

async function hojeDe(l: Pick<Leitor, 'uma'>): Promise<string> {
  const r = await l.uma<Linha>("SELECT DATE_FORMAT(CURRENT_DATE, '%Y-%m-%d') AS hoje", []);
  return String(r?.['hoje']);
}

/** As colunas do fornecedor a partir da entrada conferida. */
function colunasFornecedor(e: FornecedorEntrada, documento: string): Record<string, unknown> {
  return {
    tipo_pessoa: e.tipoPessoa,
    cnpj: e.tipoPessoa === 'juridica' ? documento : null,
    cpf: e.tipoPessoa === 'fisica' ? documento : null,
    razao_social: e.razaoSocial.trim(),
    nome_fantasia: limpo(e.nomeFantasia),
    inscricao_estadual: limpo(e.inscricaoEstadual),
    inscricao_municipal: limpo(e.inscricaoMunicipal),
    optante_simples: e.optanteSimples,
    contribuinte_icms: e.contribuinteIcms,
    cep: digitos(e.cep),
    logradouro: limpo(e.logradouro),
    numero_endereco: limpo(e.numeroEndereco),
    complemento: limpo(e.complemento),
    bairro: limpo(e.bairro),
    email: limpo(e.email)?.toLowerCase() ?? null,
    site: limpo(e.site),
    numero_cnes: limpo(e.numeroCnes),
    prazo_entrega_dias: e.prazoEntregaDias,
    dias_validade_avaliacao: e.diasValidadeAvaliacao,
    fornece_opme: e.forneceOpme,
    transportadora: e.transportadora,
    prestador_servico: e.prestadorServico,
    disponibilidade: e.disponibilidade,
    situacao: e.situacao,
    motivo_situacao: e.situacao === 'ativo' ? null : limpo(e.motivoSituacao),
    observacao: limpo(e.observacao),
    principal_categoria_fornecimento_id: e.categoriaPrincipal,
  };
}

export class PortaCadastroFornecedorPropria implements PortaCadastroFornecedor {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private contexto(c: ContextoPortaM18): ContextoNucleo & { estabelecimento: number } {
    if (c.estabelecimento === null || c.estabelecimento === undefined)
      throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    return {
      cliente: c.cliente,
      estabelecimento: c.estabelecimento,
      usuario: c.usuario,
      correlacao: c.correlacao || 'cadastro-fornecedor',
    };
  }

  private async executar<
    R extends Readonly<Record<string, string | number | boolean | null>> & { id: number },
  >(
    c: ContextoPortaM18,
    nome: string,
    entrada: Record<string, unknown>,
    chave: string,
    gravar: (tx: TxOperacao, est: number) => Promise<R>,
    alvo: string,
    motivo: string | null = null,
  ): Promise<R> {
    const ctxN = this.contexto(c);
    const op = definirOperacao({
      nome,
      tabelas: [...TABELAS_CADASTRO_FORNECEDOR],
      entrada: z.unknown(),
      gravar: (tx: TxOperacao) => gravar(tx, ctxN.estabelecimento),
      alvo: (_e, r: R) => ({ tabela: alvo, id: r.id }),
      trilha: () => ({ dados: entrada, motivo }),
    });
    const ctx: ContextoOperacao = { ...ctxN, chaveIdempotencia: chave };
    const { resultado } = await this.executor.executar(op, c.cliente, entrada, ctx);
    return resultado as R;
  }

  painel(c: ContextoPortaM18): Promise<PainelCadastroFornecedor> {
    const ctx = this.contexto(c);
    return this.nucleo.lerSomente(ctx, async (l) => {
      const cats = await l.consultar<Linha>(
        'SELECT id, descricao, exige_autorizacao_sanitaria FROM categoria_fornecimento WHERE ativo ORDER BY descricao LIMIT 300',
        [],
      );
      const bancos = await l.consultar<Linha>(
        "SELECT id, CONCAT(COALESCE(CONCAT(codigo_compensacao, ' · '), ''), COALESCE(nome_curto, descricao)) AS descricao FROM banco ORDER BY codigo_compensacao IS NULL, codigo_compensacao, descricao LIMIT 400",
        [],
      );
      return {
        hoje: await hojeDe(l),
        categorias: cats.map((x) => ({
          id: n(x['id']),
          descricao: String(x['descricao']),
          exigeAutorizacao: bool(x['exige_autorizacao_sanitaria']),
        })),
        bancos: bancos.map((x) => ({ id: n(x['id']), descricao: String(x['descricao']) })),
      };
    });
  }

  buscar(c: ContextoPortaM18, termo: string): Promise<FornecedorResumo[]> {
    const ctx = this.contexto(c);
    const t = termo.trim();
    const d = t.replace(/\D/g, '');
    return this.nucleo.lerSomente(ctx, async (l) => {
      const rs = await l.consultar<Linha>(
        `SELECT id, versao, razao_social, nome_fantasia, tipo_pessoa, COALESCE(cnpj, cpf) AS documento, situacao
           FROM empresa_fornecedora
          WHERE excluido_em IS NULL AND (? = '' OR razao_social LIKE ? OR nome_fantasia LIKE ? OR (? <> '' AND (cnpj LIKE ? OR cpf LIKE ?)))
          ORDER BY situacao = 'ativo' DESC, razao_social LIMIT 100`,
        [t, `%${t}%`, `%${t}%`, d, `${d}%`, `${d}%`],
      );
      return rs.map((r) => ({
        id: n(r['id']),
        versao: n(r['versao']),
        razaoSocial: String(r['razao_social']),
        nomeFantasia: s_(r['nome_fantasia']),
        tipoPessoa: String(r['tipo_pessoa']) as 'juridica' | 'fisica',
        documento: String(r['documento'] ?? ''),
        situacao: String(r['situacao']),
      }));
    });
  }

  ficha(c: ContextoPortaM18, id: number): Promise<FornecedorFicha> {
    const ctx = this.contexto(c);
    return this.nucleo.lerSomente(ctx, async (l) => {
      const hoje = await hojeDe(l);
      const f = await l.uma<Linha>(
        `SELECT f.*, COALESCE(f.cnpj, f.cpf) AS documento FROM empresa_fornecedora f WHERE f.id = ? AND f.excluido_em IS NULL`,
        [id],
      );
      if (!f) throw recusa('nao-encontrado', 'O fornecedor não existe.');
      const cats = await l.consultar<Linha>(
        `SELECT fc.categoria_fornecimento_id, c.exige_autorizacao_sanitaria FROM empresa_fornecedora_categoria fc
           JOIN categoria_fornecimento c ON c.id = fc.categoria_fornecimento_id
          WHERE fc.empresa_fornecedora_id = ? AND fc.excluido_em IS NULL ORDER BY fc.id`,
        [id],
      );
      const contatos = await l.consultar<Linha>(
        `SELECT id, finalidade, nome_contato, cargo, telefone, ramal, email, principal FROM empresa_fornecedora_contato
          WHERE empresa_fornecedora_id = ? AND excluido_em IS NULL ORDER BY sequencia`,
        [id],
      );
      const auts = await l.consultar<Linha>(
        `SELECT id, tipo, numero, orgao_emissor, DATE_FORMAT(emitido_em, '%Y-%m-%d') AS emitido_em,
                DATE_FORMAT(valido_ate, '%Y-%m-%d') AS valido_ate, dias_aviso_vencimento, bloqueia_compra_vencido, situacao
           FROM empresa_fornecedora_autorizacao WHERE empresa_fornecedora_id = ? AND excluido_em IS NULL ORDER BY sequencia`,
        [id],
      );
      const contas = await l.consultar<Linha>(
        `SELECT k.id, k.versao, COALESCE(b.nome_curto, b.descricao) AS banco, k.tipo_conta, k.numero_agencia, k.numero_conta,
                k.tipo_chave_pix, k.chave_pix, k.titular_nome, k.preferencial, k.ativo
           FROM conta_bancaria_credor k LEFT JOIN banco b ON b.id = k.banco_id
          WHERE k.empresa_fornecedora_id = ? AND k.excluido_em IS NULL ORDER BY k.ativo DESC, k.preferencial DESC, k.id DESC`,
        [id],
      );
      const avs = await l.consultar<Linha>(
        `SELECT a.id, DATE_FORMAT(a.avaliado_em, '%Y-%m-%d') AS avaliado_em, DATE_FORMAT(a.periodo_inicio, '%Y-%m-%d') AS periodo_inicio,
                DATE_FORMAT(a.periodo_fim, '%Y-%m-%d') AS periodo_fim, a.media_periodo, a.parecer, a.avaliador_usuario_id,
                (SELECT JSON_OBJECTAGG(k.codigo, i.nota) FROM avaliacao_fornecedor_item i
                   JOIN criterio_avaliacao_fornecedor k ON k.id = i.criterio_avaliacao_fornecedor_id
                  WHERE i.avaliacao_fornecedor_id = a.id AND i.excluido_em IS NULL) AS notas
           FROM avaliacao_fornecedor a
          WHERE a.empresa_fornecedora_id = ? AND a.estabelecimento_id = ? AND a.situacao = 'concluida' AND a.excluido_em IS NULL
          ORDER BY a.avaliado_em DESC, a.id DESC LIMIT 50`,
        [id, ctx.estabelecimento],
      );
      const ocs = await l.consultar<Linha>(
        `SELECT id, versao, numero, tipo, gravidade, DATE_FORMAT(ocorrido_em, '%Y-%m-%dT%H:%i') AS ocorrido_em, quantidade_afetada,
                valor_afetado, descricao, situacao, DATE_FORMAT(notificado_em, '%Y-%m-%dT%H:%i') AS notificado_em,
                email_notificacao, tratativa, DATE_FORMAT(resolvida_em, '%Y-%m-%dT%H:%i') AS resolvida_em
           FROM ocorrencia_fornecedor WHERE empresa_fornecedora_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL
          ORDER BY ocorrido_em DESC, id DESC LIMIT 200`,
        [id, ctx.estabelecimento],
      );
      const autorizacoes = auts.map((a) => {
        const base = {
          id: n(a['id']),
          tipo: String(a['tipo']) as TipoAutorizacaoFornecedor,
          numero: String(a['numero']),
          orgaoEmissor: s_(a['orgao_emissor']),
          emitidoEm: s_(a['emitido_em']),
          validoAte: s_(a['valido_ate']),
          diasAviso: n(a['dias_aviso_vencimento']),
          bloqueiaCompraVencido: bool(a['bloqueia_compra_vencido']),
          situacao: String(a['situacao']) as SituacaoAutorizacaoFornecedor,
        };
        const s = situacaoAutorizacaoNaData(base, hoje);
        return { ...base, situacaoNaData: s.situacao, dias: s.dias };
      });
      const avaliacoes = avs.map((a) => {
        const bruto = a['notas'];
        const obj = (typeof bruto === 'string' ? JSON.parse(bruto) : (bruto ?? {})) as Record<
          string,
          unknown
        >;
        const notas = Object.fromEntries(
          CRITERIOS_AVALIACAO_FORNECEDOR.map((k) => [k.codigo, n(obj[k.codigo])]),
        ) as Record<CriterioAvaliacao, number>;
        const r = avaliarFornecedor(notas);
        return {
          id: n(a['id']),
          avaliadoEm: String(a['avaliado_em']),
          periodoInicio: s_(a['periodo_inicio']),
          periodoFim: s_(a['periodo_fim']),
          notas,
          media: r.media,
          resultado: r.resultado,
          conta: r.conta,
          mediaPeriodo: nn(a['media_periodo']),
          parecer: s_(a['parecer']),
          avaliador: n(a['avaliador_usuario_id']),
        };
      });
      const ocorrencias = ocs.map((o) => ({
        id: n(o['id']),
        versao: n(o['versao']),
        numero: n(o['numero']),
        tipo: String(o['tipo']),
        gravidade: String(o['gravidade']),
        ocorridoEm: String(o['ocorrido_em']),
        quantidadeAfetada: nn(o['quantidade_afetada']),
        valorAfetado: nn(o['valor_afetado']),
        descricao: String(o['descricao']),
        situacao: String(o['situacao']) as SituacaoOcorrenciaFornecedor,
        notificadoEm: s_(o['notificado_em']),
        emailNotificacao: s_(o['email_notificacao']),
        tratativa: s_(o['tratativa']),
        resolvidaEm: s_(o['resolvida_em']),
      }));
      const exige = cats.some((x) => bool(x['exige_autorizacao_sanitaria']));
      const ultima = avaliacoes[0];
      const proximaAvaliacao = ultima
        ? proximaAvaliacaoFornecedor({
            ultima: ultima.avaliadoEm,
            diasValidade: nn(f['dias_validade_avaliacao']),
            critico: bool(f['fornece_opme']) || exige,
          })
        : null;
      const abertas = ocorrencias.filter((o) => ocorrenciaEmAberto(o.situacao));
      const situacao = String(f['situacao']) as FornecedorEntrada['situacao'];
      const avisos = avisosFornecedor({
        situacao,
        exigeAutorizacaoSanitaria: exige,
        autorizacoes,
        proximaAvaliacao,
        ultimoResultado: (ultima?.resultado ?? null) as
          'qualificado' | 'condicional' | 'desqualificado' | null,
        ocorrenciasAbertas: abertas.length,
        ocorrenciasCriticasAbertas: abertas.filter((o) => o.gravidade === 'critica' || o.gravidade === 'alta')
          .length,
        contasAtivas: contas.filter((k) => bool(k['ativo'])).length,
        hoje,
      });
      const tipoPessoa = String(f['tipo_pessoa']) as 'juridica' | 'fisica';
      return {
        id,
        versao: n(f['versao']),
        razaoSocial: String(f['razao_social']),
        nomeFantasia: s_(f['nome_fantasia']),
        tipoPessoa,
        documento: String(f['documento'] ?? ''),
        situacao,
        dados: {
          tipoPessoa,
          documento: String(f['documento'] ?? ''),
          razaoSocial: String(f['razao_social']),
          nomeFantasia: s_(f['nome_fantasia']),
          inscricaoEstadual: s_(f['inscricao_estadual']),
          inscricaoMunicipal: s_(f['inscricao_municipal']),
          optanteSimples: bool(f['optante_simples']),
          contribuinteIcms: bool(f['contribuinte_icms']),
          cep: s_(f['cep']),
          logradouro: s_(f['logradouro']),
          numeroEndereco: s_(f['numero_endereco']),
          complemento: s_(f['complemento']),
          bairro: s_(f['bairro']),
          email: s_(f['email']),
          site: s_(f['site']),
          numeroCnes: s_(f['numero_cnes']),
          prazoEntregaDias: nn(f['prazo_entrega_dias']),
          diasValidadeAvaliacao: nn(f['dias_validade_avaliacao']),
          forneceOpme: bool(f['fornece_opme']),
          transportadora: bool(f['transportadora']),
          prestadorServico: bool(f['prestador_servico']),
          disponibilidade: String(f['disponibilidade']) as FornecedorEntrada['disponibilidade'],
          situacao,
          motivoSituacao: s_(f['motivo_situacao']),
          observacao: s_(f['observacao']),
        },
        categorias: cats.map((x) => n(x['categoria_fornecimento_id'])),
        categoriaPrincipal: nn(f['principal_categoria_fornecimento_id']),
        contatos: contatos.map((x) => ({
          id: n(x['id']),
          finalidade: String(x['finalidade']) as FornecedorEntrada['contatos'][number]['finalidade'],
          nome: s_(x['nome_contato']),
          cargo: s_(x['cargo']),
          telefone: s_(x['telefone']),
          ramal: s_(x['ramal']),
          email: s_(x['email']),
          principal: bool(x['principal']),
        })),
        autorizacoes,
        contas: contas.map((k) => ({
          id: n(k['id']),
          versao: n(k['versao']),
          banco: s_(k['banco']),
          tipoConta: String(k['tipo_conta']),
          agencia: s_(k['numero_agencia']),
          contaMascarada: mascararConta(s_(k['numero_conta']), s_(k['chave_pix'])),
          tipoChavePix: s_(k['tipo_chave_pix']),
          titularNome: String(k['titular_nome']),
          preferencial: bool(k['preferencial']),
          ativo: bool(k['ativo']),
        })),
        avaliacoes,
        ocorrencias,
        proximaAvaliacao,
        avisos,
      };
    });
  }

  /** Confere a entrada e as referências (categorias ativas, documento sem repetição). */
  private async conferir(tx: TxOperacao, e: FornecedorEntrada, proprio: number | null): Promise<string> {
    recusarTodas(conferirFornecedor(e));
    const documento = documentoFornecedor(e.tipoPessoa, e.documento)!;
    const outro = await tx.uma<Linha>(
      `SELECT id FROM empresa_fornecedora WHERE (cnpj = ? OR cpf = ?) AND (? IS NULL OR id <> ?)`,
      [documento, documento, proprio, proprio],
    );
    if (outro)
      throw recusa('documento-repetido', 'Já existe fornecedor com este documento.', {
        campos: ['documento'],
      });
    for (const k of e.categorias) {
      const cat = await tx.uma<Linha>('SELECT id FROM categoria_fornecimento WHERE id = ? AND ativo', [k]);
      if (!cat)
        throw recusa('categoria-inexistente', 'A categoria de fornecimento não existe ou está inativa.', {
          campos: ['categorias'],
        });
    }
    return documento;
  }

  /** Grava os filhos: atualiza os que vieram com id, inclui os novos e exclui logicamente os retirados. */
  private async gravarFilhos(tx: TxOperacao, id: number, e: FornecedorEntrada): Promise<void> {
    const agora = new Date();
    const usuario = tx.contexto.usuario ?? null;
    // Categorias: o par é único; a retirada sai por exclusão lógica e a volta reativa a linha.
    const cats = await tx.consultarParaAtualizar<Linha>(
      'SELECT id, versao, categoria_fornecimento_id, excluido_em FROM empresa_fornecedora_categoria WHERE empresa_fornecedora_id = ?',
      [id],
    );
    for (const cat of cats) {
      const k = n(cat['categoria_fornecimento_id']);
      const quer = e.categorias.includes(k);
      const ativa = cat['excluido_em'] === null;
      const principal = e.categoriaPrincipal === k;
      if (quer)
        await tx.alterar('empresa_fornecedora_categoria', n(cat['id']), n(cat['versao']), {
          principal,
          excluido_em: null,
          excluido_por: null,
        });
      else if (ativa)
        await tx.alterar('empresa_fornecedora_categoria', n(cat['id']), n(cat['versao']), {
          principal: false,
          excluido_em: agora,
          excluido_por: usuario,
        });
    }
    for (const k of e.categorias)
      if (!cats.some((x) => n(x['categoria_fornecimento_id']) === k))
        await tx.incluir('empresa_fornecedora_categoria', {
          empresa_fornecedora_id: id,
          categoria_fornecimento_id: k,
          principal: e.categoriaPrincipal === k,
        });
    // Contatos e autorizações: pela sequência; os retirados saem por exclusão lógica.
    const filhos = async (
      tabela: 'empresa_fornecedora_contato' | 'empresa_fornecedora_autorizacao',
      itens: readonly { id?: number | null }[],
      colunas: (i: number) => Record<string, unknown>,
    ) => {
      const atuais = await tx.consultarParaAtualizar<Linha>(
        tabela === 'empresa_fornecedora_contato'
          ? 'SELECT id, versao, sequencia, excluido_em FROM empresa_fornecedora_contato WHERE empresa_fornecedora_id = ?'
          : 'SELECT id, versao, sequencia, excluido_em FROM empresa_fornecedora_autorizacao WHERE empresa_fornecedora_id = ?',
        [id],
      );
      let seq = atuais.reduce((m, x) => Math.max(m, n(x['sequencia'])), 0);
      const mantidos = new Set<number>();
      for (let i = 0; i < itens.length; i++) {
        const alvo = itens[i]!.id
          ? atuais.find((x) => n(x['id']) === itens[i]!.id && x['excluido_em'] === null)
          : null;
        if (itens[i]!.id && !alvo)
          throw recusa(
            'filho-inexistente',
            'Um contato ou autorização da lista não pertence a este fornecedor.',
          );
        if (alvo) {
          mantidos.add(n(alvo['id']));
          await tx.alterar(tabela, n(alvo['id']), n(alvo['versao']), colunas(i));
        } else await tx.incluir(tabela, { empresa_fornecedora_id: id, sequencia: ++seq, ...colunas(i) });
      }
      for (const x of atuais)
        if (x['excluido_em'] === null && !mantidos.has(n(x['id'])))
          await tx.alterar(tabela, n(x['id']), n(x['versao']), { excluido_em: agora, excluido_por: usuario });
    };
    await filhos('empresa_fornecedora_contato', e.contatos, (i) => {
      const c = e.contatos[i]!;
      return {
        finalidade: c.finalidade,
        nome_contato: limpo(c.nome),
        cargo: limpo(c.cargo),
        telefone: digitos(c.telefone),
        ramal: limpo(c.ramal),
        email: limpo(c.email)?.toLowerCase() ?? null,
        principal: c.principal,
      };
    });
    await filhos('empresa_fornecedora_autorizacao', e.autorizacoes, (i) => {
      const a = e.autorizacoes[i]!;
      return {
        tipo: a.tipo,
        numero: a.numero.trim().toUpperCase(),
        orgao_emissor: limpo(a.orgaoEmissor),
        emitido_em: a.emitidoEm,
        valido_ate: a.validoAte,
        dias_aviso_vencimento: a.diasAviso,
        bloqueia_compra_vencido: a.bloqueiaCompraVencido,
        situacao: a.situacao,
      };
    });
  }

  incluir(c: ContextoPortaM18, e: FornecedorEntrada, chave: string) {
    return this.executar(
      c,
      OPERACOES_CADASTRO_FORNECEDOR.incluir,
      { ...e },
      chave,
      async (tx) => {
        const documento = await this.conferir(tx, e, null);
        const id = await tx.incluir('empresa_fornecedora', colunasFornecedor(e, documento));
        await this.gravarFilhos(tx, id, e);
        return { id };
      },
      'empresa_fornecedora',
    );
  }

  alterar(c: ContextoPortaM18, id: number, versao: number, e: FornecedorEntrada, chave: string) {
    return this.executar(
      c,
      OPERACOES_CADASTRO_FORNECEDOR.alterar,
      { id, versao, ...e },
      chave,
      async (tx) => {
        const [f] = await tx.consultarParaAtualizar<Linha>(
          'SELECT id FROM empresa_fornecedora WHERE id = ? AND excluido_em IS NULL',
          [id],
        );
        if (!f) throw recusa('nao-encontrado', 'O fornecedor não existe.');
        const documento = await this.conferir(tx, e, id);
        await tx.alterar('empresa_fornecedora', id, versao, colunasFornecedor(e, documento));
        await this.gravarFilhos(tx, id, e);
        return { id };
      },
      'empresa_fornecedora',
      e.situacao === 'ativo' ? null : limpo(e.motivoSituacao),
    );
  }

  incluirConta(c: ContextoPortaM18, id: number, e: ContaBancariaFornecedorEntrada, chave: string) {
    // A trilha guarda só a forma (banco, tipo, se há Pix), nunca o número da conta nem a chave.
    const resumo = {
      fornecedor: id,
      banco: e.banco,
      tipoConta: e.tipoConta,
      pix: e.tipoChavePix,
      preferencial: e.preferencial,
    };
    return this.executar(
      c,
      OPERACOES_CADASTRO_FORNECEDOR.incluirConta,
      resumo,
      chave,
      async (tx) => {
        recusarTodas(conferirContaBancaria(e));
        const f = await tx.uma<Linha>(
          'SELECT id FROM empresa_fornecedora WHERE id = ? AND excluido_em IS NULL',
          [id],
        );
        if (!f) throw recusa('nao-encontrado', 'O fornecedor não existe.');
        if (e.banco !== null && !(await tx.uma<Linha>('SELECT id FROM banco WHERE id = ?', [e.banco])))
          throw recusa('banco-inexistente', 'O banco não existe.', { campos: ['banco'] });
        if (e.preferencial) {
          const prefs = await tx.consultarParaAtualizar<Linha>(
            'SELECT id, versao FROM conta_bancaria_credor WHERE empresa_fornecedora_id = ? AND preferencial AND excluido_em IS NULL',
            [id],
          );
          for (const p of prefs)
            await tx.alterar('conta_bancaria_credor', n(p['id']), n(p['versao']), { preferencial: false });
        }
        const temConta = e.banco !== null && !!digitos(e.conta);
        const pix = e.tipoChavePix && e.chavePix ? chavePixNormalizada(e.tipoChavePix, e.chavePix) : null;
        const conta = await tx.incluir('conta_bancaria_credor', {
          empresa_fornecedora_id: id,
          banco_id: temConta ? e.banco : null,
          tipo_conta: e.tipoConta,
          numero_agencia: temConta ? digitos(e.agencia) : null,
          digito_agencia: temConta ? limpo(e.digitoAgencia) : null,
          numero_conta: temConta ? digitos(e.conta) : null,
          digito_conta: temConta ? limpo(e.digitoConta) : null,
          tipo_chave_pix: pix ? e.tipoChavePix : null,
          chave_pix: pix,
          titular_nome: e.titularNome.trim(),
          titular_documento: digitos(e.titularDocumento),
          preferencial: e.preferencial,
          ativo: true,
        });
        return { id: conta };
      },
      'conta_bancaria_credor',
    );
  }

  inativarConta(c: ContextoPortaM18, id: number, conta: number, versao: number, chave: string) {
    return this.executar(
      c,
      OPERACOES_CADASTRO_FORNECEDOR.inativarConta,
      { fornecedor: id, conta, versao },
      chave,
      async (tx) => {
        const [k] = await tx.consultarParaAtualizar<Linha>(
          'SELECT id, ativo FROM conta_bancaria_credor WHERE id = ? AND empresa_fornecedora_id = ? AND excluido_em IS NULL',
          [conta, id],
        );
        if (!k) throw recusa('nao-encontrado', 'A conta não existe neste fornecedor.');
        if (!bool(k['ativo'])) throw recusa('conta-inativa', 'A conta já está inativa.');
        await tx.alterar('conta_bancaria_credor', conta, versao, { ativo: false, preferencial: false });
        return { id: conta };
      },
      'conta_bancaria_credor',
    );
  }

  /** O critério do cadastro com o código da regra; na primeira avaliação, o critério entra no cadastro. */
  private async criterio(tx: TxOperacao, codigo: CriterioAvaliacao): Promise<{ id: number; peso: number }> {
    const k = await tx.uma<Linha>('SELECT id, peso FROM criterio_avaliacao_fornecedor WHERE codigo = ?', [
      codigo,
    ]);
    if (k) return { id: n(k['id']), peso: n(k['peso']) };
    const rotulo = CRITERIOS_AVALIACAO_FORNECEDOR.find((x) => x.codigo === codigo)!.rotulo;
    const id = await tx.incluir('criterio_avaliacao_fornecedor', {
      codigo,
      descricao: rotulo,
      tipo: TIPO_CRITERIO[codigo],
      peso: 1,
      tipo_documento: 'ambos',
      permite_revisao: false,
      ativo: true,
    });
    return { id, peso: 1 };
  }

  async avaliar(c: ContextoPortaM18, id: number, e: AvaliacaoPeriodicaEntrada, chave: string) {
    const r = await this.executar(
      c,
      OPERACOES_CADASTRO_FORNECEDOR.avaliar,
      { fornecedor: id, ...e },
      chave,
      async (tx, est) => {
        const hoje = await hojeDe(tx);
        recusarTodas(conferirAvaliacaoPeriodica(e, hoje));
        const f = await tx.uma<Linha>(
          "SELECT id FROM empresa_fornecedora WHERE id = ? AND excluido_em IS NULL AND situacao <> 'inativo'",
          [id],
        );
        if (!f) throw recusa('fornecedor-inexistente', 'O fornecedor não existe ou está inativo.');
        const av = avaliarFornecedor(e.notas);
        const anteriores = await tx.consultar<Linha>(
          `SELECT nota_final FROM avaliacao_fornecedor
            WHERE empresa_fornecedora_id = ? AND estabelecimento_id = ? AND situacao = 'concluida' AND excluido_em IS NULL
              AND nota_final IS NOT NULL AND avaliado_em <= ? AND (? IS NULL OR avaliado_em >= ?)`,
          [id, est, e.avaliadoEm, e.periodoInicio, e.periodoInicio],
        );
        const mp = mediaPeriodoAvaliacao(
          anteriores.map((x) => n(x['nota_final'])),
          av.media,
        );
        const avaliacao = await tx.incluir('avaliacao_fornecedor', {
          estabelecimento_id: est,
          empresa_fornecedora_id: id,
          avaliado_em: e.avaliadoEm,
          periodo_inicio: e.periodoInicio,
          periodo_fim: e.periodoFim,
          nota_entrega: e.notas.prazo,
          nota_qualidade: e.notas.qualidade,
          nota_preco: null,
          nota_final: av.media,
          media_periodo: mp.media,
          avaliador_usuario_id: tx.contexto.usuario,
          parecer: limpo(e.parecer),
          situacao: 'concluida',
        });
        let seq = 0;
        for (const k of CRITERIOS_AVALIACAO_FORNECEDOR) {
          const crit = await this.criterio(tx, k.codigo);
          await tx.incluir('avaliacao_fornecedor_item', {
            avaliacao_fornecedor_id: avaliacao,
            sequencia: ++seq,
            criterio_avaliacao_fornecedor_id: crit.id,
            formula_aplicada: 'média simples das quatro notas; nota 1 desqualifica',
            peso: crit.peso,
            nota: e.notas[k.codigo],
          });
        }
        return {
          id: avaliacao,
          media: av.media,
          resultado: av.resultado,
          conta: av.conta,
          mediaPeriodo: mp.media,
        };
      },
      'avaliacao_fornecedor',
      limpo(e.parecer),
    );
    return {
      id: r.id,
      media: Number(r.media),
      resultado: String(r.resultado),
      conta: String(r.conta),
      mediaPeriodo: Number(r.mediaPeriodo),
    };
  }

  async registrarOcorrencia(c: ContextoPortaM18, id: number, e: OcorrenciaFornecedorEntrada, chave: string) {
    const r = await this.executar(
      c,
      OPERACOES_CADASTRO_FORNECEDOR.ocorrencia,
      { fornecedor: id, ...e },
      chave,
      async (tx, est) => {
        recusarTodas(conferirOcorrencia(e, await hojeDe(tx)));
        const f = await tx.uma<Linha>(
          'SELECT id FROM empresa_fornecedora WHERE id = ? AND excluido_em IS NULL',
          [id],
        );
        if (!f) throw recusa('fornecedor-inexistente', 'O fornecedor não existe.');
        await garantirSequencia(
          tx,
          { tipo: 'ocorrencia_fornecedor', estabelecimento: est, prefixo: null },
          { usuario: tx.contexto.usuario ?? null, agora: new Date() },
        );
        const numero = Number((await tx.proximoNumero('ocorrencia_fornecedor')).valor);
        const oc = await tx.incluir('ocorrencia_fornecedor', {
          estabelecimento_id: est,
          numero,
          empresa_fornecedora_id: id,
          tipo: e.tipo,
          gravidade: e.gravidade,
          ocorrido_em: e.ocorridoEm.replace('T', ' '),
          quantidade_afetada: e.quantidadeAfetada,
          valor_afetado: e.valorAfetado,
          descricao: e.descricao.trim(),
          responsavel_usuario_id: tx.contexto.usuario,
          situacao: 'aberta',
        });
        return { id: oc, numero };
      },
      'ocorrencia_fornecedor',
    );
    return { id: r.id, numero: Number(r.numero) };
  }

  async andamentoOcorrencia(
    c: ContextoPortaM18,
    ocorrencia: number,
    e: {
      situacao: SituacaoOcorrenciaFornecedor;
      tratativa: string | null;
      email: string | null;
      versao: number;
    },
    chave: string,
  ) {
    const r = await this.executar(
      c,
      OPERACOES_CADASTRO_FORNECEDOR.andamento,
      { ocorrencia, ...e },
      chave,
      async (tx, est) => {
        const [o] = await tx.consultarParaAtualizar<Linha>(
          'SELECT id, situacao, tratativa FROM ocorrencia_fornecedor WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [ocorrencia, est],
        );
        if (!o) throw recusa('nao-encontrado', 'A ocorrência não existe neste estabelecimento.');
        const de = String(o['situacao']) as SituacaoOcorrenciaFornecedor;
        recusarTodas(
          conferirAndamentoOcorrencia({ de, para: e.situacao, tratativa: e.tratativa, email: e.email }),
        );
        const agora = new Date();
        const fim = ['resolvida', 'improcedente'].includes(e.situacao);
        await tx.alterar('ocorrencia_fornecedor', ocorrencia, e.versao, {
          situacao: e.situacao,
          ...(e.situacao === 'notificada'
            ? { notificado_em: agora, email_notificacao: limpo(e.email)?.toLowerCase() ?? null }
            : {}),
          ...(limpo(e.tratativa) ? { tratativa: limpo(e.tratativa) } : {}),
          ...(fim ? { resolvida_em: agora } : {}),
        });
        return { id: ocorrencia, situacao: e.situacao };
      },
      'ocorrencia_fornecedor',
      limpo(e.tratativa),
    );
    return { id: r.id, situacao: String(r.situacao) as SituacaoOcorrenciaFornecedor };
  }
}
