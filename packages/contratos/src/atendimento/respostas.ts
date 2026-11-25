// Respostas das telas do atendimento externo (M20; ficha, seções 4 e 7). Nenhum nome de tabela do legado; o nome do
// paciente aparece nas telas de trabalho com a permissão (recepção, consultório, quadro do PA), nunca em área comum.
import { z } from 'zod';
import { CODIGOS_COR_RISCO, esquemaRiscoNoQuadro } from '../recepcao/classificacao.js';
import { esquemaProtocoloNoQuadro } from '../recepcao/protocolo-gerenciado.js';
import { esquemaAlertaEscorePa } from './escore-pa.js';
import { esquemaPadraoAplicado } from './padrao-abertura.js';
import { CODIGOS_CARATER, CODIGOS_DESFECHO, CODIGOS_TIPO_ATENDIMENTO, ETAPAS_PA } from './vocabulario.js';

const txt = z.string();
const n = z.number();
const nul = <T extends z.ZodType>(t: T) => t.nullable();

export const esquemaSituacaoConta = z.object({
  situacao: z.enum(['aberta', 'fechada', 'apresentada', 'emitida', 'semConta']),
  rotulo: txt,
  permiteLancar: z.boolean(),
  /** Itens lançados na conta (contagem). */
  itens: n,
});
export type SituacaoContaLida = z.infer<typeof esquemaSituacaoConta>;

export const esquemaAtendimentoResumo = z.object({
  reg: n,
  /** Identificador do cabeçalho do atendimento (texto: BIGINT). */
  cabecalho: txt,
  data: txt,
  hora: txt,
  tipo: nul(z.enum(CODIGOS_TIPO_ATENDIMENTO)),
  tipoLegado: n,
  tipoRotulo: txt,
  requisicao: z.boolean(),
  paciente: z.object({ id: nul(n), prontuario: n, nome: txt }),
  convenio: z.object({ codigo: n, nome: txt }),
  profissional: z.object({ crm: n, nome: txt }),
  especialidade: z.object({ codigo: n, nome: txt }),
  unidade: n,
  carater: nul(z.enum(CODIGOS_CARATER)),
  senha: nul(z.object({ id: n, texto: txt })),
  desfecho: nul(z.object({ codigo: z.enum(CODIGOS_DESFECHO), rotulo: txt, em: txt })),
  /** Aberto pelo novo (extensão gravada) ou pelo outro sistema. */
  abertoNoNovo: z.boolean(),
});
export type AtendimentoResumo = z.infer<typeof esquemaAtendimentoResumo>;

export const esquemaAtendimentosDia = z.object({
  data: txt,
  itens: z.array(esquemaAtendimentoResumo),
  cortada: z.boolean(),
  /** Requisições de laboratório (sem consulta) do dia, mostradas à parte (regra 3). */
  requisicoes: n,
});
export type AtendimentosDia = z.infer<typeof esquemaAtendimentosDia>;

export const esquemaProcedimentoExtraLido = z.object({
  procedimento: n,
  nome: txt,
  quantidade: n,
  valor: n,
  profissional: txt,
  seq: n,
});
export type ProcedimentoExtraLido = z.infer<typeof esquemaProcedimentoExtraLido>;

export const esquemaAtendimentoDetalhe = esquemaAtendimentoResumo.extend({
  matricula: txt,
  validadeCarteira: nul(txt),
  guia: txt,
  senhaConvenio: txt,
  validadeSenha: nul(txt),
  plano: txt,
  responsavel: nul(z.object({ nome: txt, parentesco: n, telefone: txt })),
  procedimento: z.object({ codigo: n, nome: txt, valor: n }),
  extras: z.array(esquemaProcedimentoExtraLido),
  conta: esquemaSituacaoConta,
  /** Carimbo da ficha (controle otimista das alterações). */
  versao: txt,
  observacao: nul(
    z.object({ leito: txt, local: txt, entrada: txt, saida: nul(txt), horas: n, alerta: z.boolean() }),
  ),
  etapas: z.array(z.object({ etapa: txt, rotulo: txt, em: txt })),
  /** W1-05: o CID principal e o secundário, o solicitante e a observação gravados (a correção mostra e retira). */
  cidPrincipal: nul(z.object({ id: n, codigo: txt, nome: txt })).optional(),
  cidSecundario: nul(z.object({ id: n, codigo: txt, nome: txt })).optional(),
  solicitante: nul(z.object({ id: n, nome: txt, registro: txt })).optional(),
  observacaoFicha: nul(txt).optional(),
});
export type AtendimentoDetalhe = z.infer<typeof esquemaAtendimentoDetalhe>;

/** O que a exclusão desfaria (a tela mostra antes de pedir a confirmação). */
export const esquemaPreviaCancelamento = z.object({
  reg: n,
  pode: z.boolean(),
  motivo: nul(txt),
  conta: esquemaSituacaoConta,
  procedimentosExtras: n,
  senhaVolta: nul(txt),
  /** Operação liberada (receita provada) ou só especificada, com o motivo. */
  liberada: z.boolean(),
  motivoLiberacao: nul(txt),
  /** W1-05: o que impede a exclusão física (quantos e quais, com amostra) e a saída oferecida (anular). */
  dependentes: z.array(z.object({ rotulo: txt, quantidade: n, amostra: z.array(txt) })).optional(),
  saida: z.literal('anular').optional(),
  /** W1-05: a ficha aberta de um agendamento (a marcação volta a não atendida com a exclusão). */
  marcacaoVolta: nul(txt).optional(),
});
export type PreviaCancelamento = z.infer<typeof esquemaPreviaCancelamento>;

// ── Fila do consultório ──────────────────────────────────────────────────────────────────────────

export const esquemaItemFilaConsultorio = z.object({
  reg: n,
  /** O cadastro do paciente (o prontuário do PEP abre por ele; a leitura do prontuário é auditada). */
  idPaciente: nul(n),
  paciente: txt,
  prontuario: n,
  senha: nul(txt),
  prioridade: z.enum(['0', '1', '2']),
  agendadoPara: nul(txt),
  chegada: txt,
  esperaMinutos: n,
  situacao: z.enum(['aguardando', 'chamado', 'emAtendimento', 'liberado']),
  chamadas: n,
  tipo: nul(z.enum(CODIGOS_TIPO_ATENDIMENTO)),
  convenio: txt,
});
export type ItemFilaConsultorio = z.infer<typeof esquemaItemFilaConsultorio>;

export const esquemaFilaConsultorio = z.object({
  local: nul(z.object({ id: n, descricao: txt })),
  locais: z.array(z.object({ id: n, descricao: txt })),
  profissional: nul(z.object({ crm: n, nome: txt })),
  itens: z.array(esquemaItemFilaConsultorio),
  cortada: z.boolean(),
  atualizadoEm: txt,
});
export type FilaConsultorio = z.infer<typeof esquemaFilaConsultorio>;

// ── Quadro do PA ─────────────────────────────────────────────────────────────────────────────────

const ETAPAS = ETAPAS_PA.map((e) => e.codigo) as [string, ...string[]];

export const esquemaCartaoPa = z.object({
  reg: n,
  paciente: txt,
  idade: nul(n),
  senha: nul(txt),
  prioridade: z.enum(['0', '1', '2']),
  chegada: txt,
  etapa: z.enum(ETAPAS),
  etapaDesde: txt,
  minutosNaEtapa: n,
  minutosTotal: n,
  profissional: txt,
  leito: nul(txt),
  alertaObservacao: z.boolean(),
  /** Marcas de tempo do novo (o outro sistema não guarda): falta a chegada quando o atendimento veio de lá. */
  semMarcas: z.boolean(),
  /** M44: a cor da classificação de risco vigente, o prazo e o cronômetro (null: ainda não classificado). */
  risco: esquemaRiscoNoQuadro.nullable().optional(),
  /** M44 (etapa 3): os protocolos gerenciados abertos do atendimento com a próxima meta (o relógio no cartão). */
  protocolos: z.array(esquemaProtocoloNoQuadro).optional(),
  /** W0-07 (M1): o alerta de deterioração e de sepse (NEWS2, qSOFA e SIRS) com a sugestão do protocolo de sepse. */
  alertaEscore: esquemaAlertaEscorePa.nullable().optional(),
});
export type CartaoPa = z.infer<typeof esquemaCartaoPa>;

/**
 * Atendimento de PA que já saiu sem o desfecho codificado no novo: liberado do local ou com a alta registrada pela
 * outra ponta (a letra L no fluxo da senha ou o motivo de alta do cabeçalho). Fica fora das colunas e do total.
 */
export const esquemaSaidaSemDesfechoPa = z.object({
  reg: n,
  paciente: txt,
  senha: nul(txt),
  chegada: txt,
  /** 'liberado' (letra L no fluxo da senha) ou 'alta' (motivo de alta no cabeçalho do atendimento). */
  sinal: z.enum(['liberado', 'alta']),
  leito: nul(txt),
});
export type SaidaSemDesfechoPa = z.infer<typeof esquemaSaidaSemDesfechoPa>;

export const esquemaQuadroPa = z.object({
  colunas: z.array(z.object({ codigo: txt, rotulo: txt, cartoes: z.array(esquemaCartaoPa) })),
  total: n,
  /** As saídas sem desfecho codificado (à parte: não contam no total nem esperam numa coluna). */
  saidasSemDesfecho: z.array(esquemaSaidaSemDesfechoPa),
  atualizadoEm: txt,
  /** Tempos-alvo (minutos) da porta ao médico e da permanência, do parâmetro. */
  alvoPortaMedico: n,
  /** M44: a contagem por cor (com os estourados) no cabeçalho; ausente sem a classificação de risco. */
  porCor: z
    .array(z.object({ cor: z.enum([...CODIGOS_COR_RISCO, 'semClassificacao']), total: n, estourados: n }))
    .optional(),
});
export type QuadroPa = z.infer<typeof esquemaQuadroPa>;

// ── Observação ───────────────────────────────────────────────────────────────────────────────────

export const esquemaLeitoObservacao = z.object({
  id: n,
  codigo: txt,
  local: txt,
  tipo: txt,
  ativo: z.boolean(),
  ocupacao: nul(
    z.object({
      reg: n,
      paciente: txt,
      entrada: txt,
      horas: n,
      /** Perto ou além do limite de 24 horas (regra 7). */
      alerta: z.enum(['nenhum', 'aviso', 'excedido']),
    }),
  ),
});
export type LeitoObservacao = z.infer<typeof esquemaLeitoObservacao>;

export const esquemaObservacaoPa = z.object({
  leitos: z.array(esquemaLeitoObservacao),
  historico: n,
  atualizadoEm: txt,
});
export type ObservacaoPa = z.infer<typeof esquemaObservacaoPa>;

// ── Indicadores ──────────────────────────────────────────────────────────────────────────────────

export const esquemaIndicadoresAtendimento = z.object({
  inicio: txt,
  fim: txt,
  /** Atendimentos com consulta (ESPEC > 0): o denominador dos indicadores (regra 3). */
  atendimentos: n,
  requisicoesLaboratorio: n,
  porTipo: z.array(z.object({ tipo: txt, rotulo: txt, total: n })),
  porCarater: z.array(z.object({ carater: txt, total: n })),
  pa: z.object({
    atendimentos: n,
    comMarcas: n,
    portaMedicoMedianaMin: nul(n),
    portaDecisaoMedianaMin: nul(n),
    permanenciaMedianaMin: nul(n),
    evasoes: n,
    /** PA com o desfecho codificado no novo: o denominador da taxa de evasão (as parcelas impressas). */
    comDesfecho: n,
    taxaEvasao: nul(n),
    observacoes: n,
    observacoesAcima24h: n,
    /** Retorno ao PA em 72 horas: visitas do período com outra visita do mesmo paciente nas 72 h anteriores. */
    retorno72h: n,
    /** As visitas ao PA do período (o denominador do retorno). */
    retorno72hDenominador: n,
    taxaRetorno72h: nul(n),
    /** Fichas do PA que resultaram em internação (desfecho ou encaminhamento; sem contar duas vezes). */
    internacoes: n,
    internacoesViaDesfecho: n,
    internacoesViaEncaminhamento: n,
    /** internacoes / atendimentos do PA. */
    taxaInternacao: nul(n),
  }),
  desfechos: z.array(z.object({ desfecho: txt, rotulo: txt, total: n })),
  /** As parcelas impressas: os atendimentos vindos do outro sistema não têm marcas de tempo (só a contagem). */
  semMarcas: n,
});
export type IndicadoresAtendimento = z.infer<typeof esquemaIndicadoresAtendimento>;

// ── Apoio da abertura (listas da tela) e herança ─────────────────────────────────────────────────

export const esquemaApoioAtendimento = z.object({
  convenios: z.array(z.object({ codigo: n, nome: txt, aceita: z.boolean(), motivo: nul(txt) })),
  unidades: z.array(z.object({ codigo: n, nome: txt })),
  especialidades: z.array(z.object({ codigo: n, nome: txt })),
  profissionais: z.array(
    z.object({ id: n, crm: n, nome: txt, especialidades: z.array(n), conselhoAtivo: z.boolean() }),
  ),
  centrosCusto: z.array(z.object({ codigo: n, nome: txt })),
  /** Locais de atendimento (consultórios e recepções), para o filtro da lista do dia. */
  locais: z.array(z.object({ id: n, descricao: txt })),
  procedimentosPadrao: z.array(z.object({ codigo: n, nome: txt, tipo: txt })),
  motivosExclusao: z.array(z.object({ codigo: n, nome: txt })),
  heranca: z.array(z.object({ campo: txt, rotulo: txt })),
});
export type ApoioAtendimento = z.infer<typeof esquemaApoioAtendimento>;

export const esquemaHerancaPaciente = z.object({
  paciente: n,
  anterior: nul(
    z.object({
      reg: n,
      data: txt,
      valores: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
      /** O que a ficha nova recebe pelas marcas em vigor e pelas regras da cobertura (domínio). */
      herdados: z.record(z.string(), z.union([z.string(), z.number()])),
      /** Avisos para a recepção conferir (validade vencida, cobertura sem o convênio). */
      avisos: z.array(txt),
    }),
  ),
  historico: z.array(z.object({ reg: n, data: txt, tipo: txt, convenio: txt, profissional: txt })),
  /** Os valores habituais (do usuário ou do estabelecimento) para o que a herança não preencheu. */
  padrao: esquemaPadraoAplicado.optional(),
});
export type HerancaPaciente = z.infer<typeof esquemaHerancaPaciente>;

export const esquemaImpressoGerado = z.object({
  impresso: txt,
  formato: z.enum(['zpl', 'pdf']),
  /** ZPL em texto (o que foi para a fila da impressora da estação) ou PDF em base64. */
  conteudo: txt,
  nomeArquivo: txt,
  /** O trabalho na fila de impressão da estação (ZPL): o mesmo pedido repetido não imprime duas vezes. */
  fila: nul(z.object({ id: txt, novo: z.boolean() })),
});
export type ImpressoGerado = z.infer<typeof esquemaImpressoGerado>;

/** As fichas a imprimir do atendimento (configuração comum) e o que cada impresso exige. */
export const esquemaImpressosAtendimento = z.object({
  reg: n,
  impressos: z.array(
    z.object({ impresso: txt, rotulo: txt, formatos: z.array(txt), pode: z.boolean(), motivo: nul(txt) }),
  ),
  fichas: z.array(z.object({ modelo: n, nome: txt, copias: n, ordem: n })),
  /** A configuração das fichas a imprimir não pôde ser lida: a ficha padrão sai sozinha. */
  configuracaoLida: z.boolean(),
});
export type ImpressosAtendimento = z.infer<typeof esquemaImpressosAtendimento>;

/** O agendamento do dia que a abertura preenche (paciente, convênio, profissional, especialidade e procedimento). */
export const esquemaMarcacaoAbertura = z.object({
  id: n,
  data: txt,
  hora: txt,
  hoje: z.boolean(),
  /** A ficha já aberta para o agendamento (0: nenhuma). */
  registro: n,
  paciente: nul(z.object({ id: n, nome: txt, prontuario: n, nascimento: nul(txt) })),
  convenio: n,
  /**
   * O registro no conselho do profissional do agendamento, quando gravado (a tela escolhe o vínculo dele). Na cópia,
   * 0 em todas as marcações atendidas: a recepção escolhe o profissional entre os da especialidade.
   */
  crm: n,
  especialidade: n,
  unidade: n,
  centroCusto: n,
  procedimento: n,
  retorno: z.boolean(),
});
export type MarcacaoAbertura = z.infer<typeof esquemaMarcacaoAbertura>;

/** A configuração da herança (o que a ficha nova copia do atendimento anterior). */
export const esquemaConfiguracaoHeranca = z.object({
  /** herda: em vigor para a sessão; estabelecimento: a do estabelecimento; pessoal: a regra própria (nula: segue). */
  campos: z.array(
    z.object({
      campo: txt,
      rotulo: txt,
      herda: z.boolean(),
      estabelecimento: z.boolean(),
      pessoal: z.boolean().nullable(),
    }),
  ),
  /** As marcas lidas (controle otimista da alteração). */
  versao: txt,
});
export type ConfiguracaoHeranca = z.infer<typeof esquemaConfiguracaoHeranca>;

export const esquemaGravacaoAtendimento = z.object({
  /** A funcionalidade (chave atendimento.ambulatorio / atendimento.pa) está ligada para esta pessoa e setor? */
  ambulatorio: z.object({ ligada: z.boolean(), motivo: nul(txt) }),
  pa: z.object({ ligada: z.boolean(), motivo: nul(txt) }),
  cancelar: z.object({ ligada: z.boolean(), motivo: nul(txt) }),
  /** O desfecho clínico (ato médico): a permissão e o vínculo do próprio médico com conselho ativo. */
  atoMedico: z.object({ pode: z.boolean(), motivo: nul(txt) }),
  operacoes: z.record(z.string(), z.object({ pode: z.boolean(), motivo: nul(txt) })),
});
export type GravacaoAtendimento = z.infer<typeof esquemaGravacaoAtendimento>;

export const esquemaResultadoAtendimento = z.object({
  ok: z.literal(true),
  resultado: z.record(z.string(), z.union([z.number(), z.string(), z.boolean(), z.null()])),
  repetida: z.boolean(),
  mensagem: txt,
});
export type ResultadoAtendimento = z.infer<typeof esquemaResultadoAtendimento>;
