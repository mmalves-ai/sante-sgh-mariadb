// M58-F4 (ficha do M58, seções 2, 7 e 8, regras 8 e 9; cap-12, Decisão): a fachada de compatibilidade da API de
// integração da Hal-AI. Mesmos caminhos, parâmetros, respostas e erros, servidos pelo Sante SGH sob
// `/api/fachada/sante-api/…`; o que a fachada ainda não serve é repassado à API original no mesmo caminho (troca
// gradual, rota a rota), e nada muda nos Squads além do endereço-base.
//
// O que a fachada preserva (regra 9): o motor de ações em dois tempos (proposta de 15 minutos e uso único; a
// confirmação relê o estado e recusa se ele mudou), a escrita desligada por padrão, os escopos de token por
// superfície, o contrato de erro ({ status: "error", codigo, message } em português, nenhum erro do banco no corpo)
// e os limites de resposta. Toda escrita é assinada pelo usuário de integração `hal-ai` e auditada.
//
// A configuração mora em SGH_CFG_PARAMETRO (parâmetros `integracao.fachada.*`, por estabelecimento; ficha, seção 6:
// nenhuma tabela SGH_ nova). Os tokens NÃO moram no banco: vêm do ambiente do servidor, como na API original.
import { z } from 'zod';
import contrato from './fachada-contrato.json' with { type: 'json' };

// ── Superfícies e escopos ─────────────────────────────────────────────────────────────────────────

/** As cinco superfícies da API original (cap-12; ref 01 §1). */
export const SUPERFICIES_FACHADA = ['atendimento', 'gestao', 'acoes', 'auditoria', 'saude'] as const;
export type SuperficieFachada = (typeof SUPERFICIES_FACHADA)[number];

/** O token que cada superfície aceita (ref 01 §6): gestão e auditoria têm token próprio quando configurado. */
export const ESCOPOS_TOKEN_FACHADA = ['principal', 'gestao', 'auditoria'] as const;
export type EscopoTokenFachada = (typeof ESCOPOS_TOKEN_FACHADA)[number];

/** As variáveis de ambiente dos tokens (os nomes da API original, com o prefixo da fachada). */
export const AMBIENTE_TOKENS_FACHADA: Readonly<Record<EscopoTokenFachada, string>> = {
  principal: 'FACHADA_API_TOKEN',
  gestao: 'FACHADA_API_TOKEN_GESTAO',
  auditoria: 'FACHADA_API_TOKEN_AUDITORIA',
};

/** O usuário de integração que assina toda escrita da Hal-AI (TBUSERS.NOME, sensível a maiúsculas; sem login). */
export const USUARIO_INTEGRACAO_FACHADA = 'hal-ai';

/** O prefixo das rotas da fachada na API do Sante SGH (sem o `/api` global). */
export const PREFIXO_FACHADA = 'fachada/sante-api';

// ── O contrato extraído (OpenAPI das superfícies; tools/fachada/extrair-contrato.cjs) ─────────────────

export interface ParametroContratoFachada {
  readonly nome: string;
  readonly em: 'query' | 'path' | 'header' | string;
  readonly obrigatorio: boolean;
  readonly tipo: string | null;
  readonly valores?: readonly (string | number | boolean)[];
}
export interface OperacaoContratoFachada {
  readonly superficie: SuperficieFachada;
  readonly metodo: 'GET' | 'POST';
  readonly caminho: string;
  readonly resumo: string | null;
  readonly parametros: readonly ParametroContratoFachada[];
  readonly corpo: { readonly obrigatorios: readonly string[]; readonly campos: readonly string[] } | null;
  /** A forma da resposta de exemplo por status (chaves e tipos, nunca valores): a expectativa do consumidor. */
  readonly respostas: Readonly<Record<string, FormaRespostaFachada>>;
}
/** Forma de um valor: o tipo (`string`, `number`, `boolean`, `null`), a lista com a forma do item ou o objeto. */
export type FormaRespostaFachada =
  string | readonly FormaRespostaFachada[] | { readonly [chave: string]: FormaRespostaFachada };
export interface ContratoFachada {
  readonly versao: string;
  readonly operacoes: readonly OperacaoContratoFachada[];
}

/** O contrato da versão 0.23.0 da API original (78 operações). */
export const CONTRATO_SANTE_API: ContratoFachada = contrato as ContratoFachada;

// ── O catálogo da fachada: cada operação, quem a serve e a operação equivalente do Sante SGH ─────────

/** Como a fachada atende uma operação: o Sante SGH a serve, repassa à API original ou não atende. */
export const MODOS_FACHADA = ['servida', 'repassada', 'desligada'] as const;
export type ModoFachada = (typeof MODOS_FACHADA)[number];

/** Identificador estável da operação: `GET /convenios/{codigo}`. */
export const idOperacaoFachada = (metodo: string, caminho: string) => `${metodo.toUpperCase()} ${caminho}`;

/**
 * As operações que o Sante SGH já serve nesta versão da fachada. As demais são repassadas (troca gradual): uma rota
 * passa a servida quando tem implementação com a mesma resposta e o mesmo erro, e, se escreve, a operação
 * equivalente provada pelo teste de assinatura.
 */
export const OPERACOES_SERVIDAS_FACHADA: readonly string[] = [
  'GET /health',
  'GET /health/db',
  'GET /convenios',
  'GET /convenios/{codigo}',
  'GET /acoes/status',
  'POST /acoes/convenios/situacao',
  'POST /acoes/confirmar',
];

/**
 * A operação do catálogo do Sante SGH que reproduz a escrita da rota (docs/operacoes/catalogo, origem
 * `sante-api`). A fachada só serve uma escrita pela operação equivalente, com receita e assinatura (executor).
 */
export const OPERACOES_SGH_DA_FACHADA: Readonly<Record<string, readonly string[]>> = {
  'POST /pacientes': ['cadastro.cadastrarPaciente'],
  'POST /consultas/agendamentos': ['agenda.agendarConsulta'],
  'POST /consultas/agendamentos/cancelar': ['agenda.cancelarConsulta'],
  'POST /consultas/agendamentos/remarcar': ['agenda.remarcarConsulta'],
  'POST /exames/agendamentos': ['agenda.agendarExame'],
  'POST /exames/agendamentos/cancelar': ['agenda.cancelarExame'],
  'POST /exames/agendamentos/remarcar': ['agenda.cancelarExame', 'agenda.agendarExame'],
  'POST /acoes/cobertura/convenio': ['agenda.definirCobertura', 'agenda.definirCoberturaExame'],
  'POST /acoes/faturamento/lote/protocolo': ['faturamento.registrarProtocolo'],
  'POST /acoes/glosa/recurso': ['faturamento.registrarRecurso'],
  'POST /acoes/glosa/retorno': ['faturamento.registrarRetornoRecurso'],
  'POST /acoes/cotacao/vencedor': ['suprimentos.definirVencedorCotacao'],
  'POST /acoes/precos/vigencia': ['preco.reajustar'],
  'POST /acoes/precos/vigencia/remover': ['preco.desfazerReajuste'],
  'POST /acoes/convenios/situacao': ['convenio.alterarSituacao'],
  'POST /acoes/faturamento/fechar-conta': ['faturamento.fecharConta'],
  'POST /acoes/faturamento/reabrir-conta': ['faturamento.reabrirConta'],
  'POST /acoes/financeiro/titulo-a-pagar': ['financeiro.criarTituloPagar'],
  'POST /acoes/agenda/encaixe': ['agenda.encaixar'],
  'POST /acoes/agenda/encaixe/desfazer': ['agenda.desfazerEncaixe'],
  'POST /acoes/agenda/grade': ['agenda.gerarGrade', 'agenda.gerarGradeExame'],
  'POST /acoes/cirurgia/agendar': ['cirurgia.agendarCirurgia'],
};

export interface OperacaoFachada {
  readonly id: string;
  readonly superficie: SuperficieFachada;
  readonly metodo: 'GET' | 'POST';
  readonly caminho: string;
  /** Escrita no banco: as escritas diretas do atendimento e as propostas da superfície de ações. */
  readonly escreve: boolean;
  /** Dispensa token (só `/health`, por igualdade exata). */
  readonly publica: boolean;
  readonly escopo: EscopoTokenFachada;
  readonly servidaPeloSante: boolean;
  readonly operacoesSgh: readonly string[];
}

const escopoDe = (s: SuperficieFachada): EscopoTokenFachada =>
  s === 'gestao' ? 'gestao' : s === 'auditoria' ? 'auditoria' : 'principal';

/** O catálogo da fachada, na ordem do contrato. */
export const CATALOGO_FACHADA: readonly OperacaoFachada[] = CONTRATO_SANTE_API.operacoes.map((o) => {
  const id = idOperacaoFachada(o.metodo, o.caminho);
  return {
    id,
    superficie: o.superficie,
    metodo: o.metodo,
    caminho: o.caminho,
    // A confirmação escreve (é ela que aplica); a proposta não, mas ela só existe para escrever: as duas contam.
    escreve: o.metodo === 'POST',
    publica: o.caminho === '/health',
    escopo: escopoDe(o.superficie),
    servidaPeloSante: OPERACOES_SERVIDAS_FACHADA.includes(id),
    operacoesSgh: OPERACOES_SGH_DA_FACHADA[id] ?? [],
  };
});

// ── Contrato de erro e limites ──────────────────────────────────────────────────────────────────────

/** Os códigos estáveis da API original (constants/sgh.js, ERRO), mais os três da própria fachada. */
export const CODIGOS_ERRO_FACHADA = {
  agendaNaoEncontrada: 'agenda_nao_encontrada',
  horarioOcupado: 'horario_ocupado',
  foraDeVigencia: 'fora_de_vigencia',
  agendamentoNaoEncontrado: 'agendamento_nao_encontrado',
  pacienteNaoEncontrado: 'paciente_nao_encontrado',
  cpfInvalido: 'cpf_invalido',
  cpfAmbiguo: 'cpf_ambiguo',
  convenioNaoEncontrado: 'convenio_nao_encontrado',
  convenioNaoAceito: 'convenio_nao_aceito',
  propostaNaoEncontrada: 'proposta_nao_encontrada',
  propostaDesatualizada: 'proposta_desatualizada',
  acoesDesabilitadas: 'acoes_desabilitadas',
  acaoSemEfeito: 'acao_sem_efeito',
  valorForaDaFaixa: 'valor_fora_da_faixa',
  parametroObrigatorio: 'parametro_obrigatorio',
  parametroInvalido: 'parametro_invalido',
  rotaNaoEncontrada: 'rota_nao_encontrada',
  naoAutorizado: 'nao_autorizado',
  erroInterno: 'erro_interno',
  // Da fachada: desligada no estabelecimento, superfície fora do ar e destino do repasse sem resposta.
  fachadaDesligada: 'fachada_desligada',
  superficieDesligada: 'superficie_desligada',
  destinoIndisponivel: 'destino_indisponivel',
} as const;
export type CodigoErroFachada = (typeof CODIGOS_ERRO_FACHADA)[keyof typeof CODIGOS_ERRO_FACHADA];

/** O envelope de erro de toda resposta de erro da API (utils/erros-fastify.js). */
export interface ErroFachada {
  readonly status: 'error';
  readonly codigo?: CodigoErroFachada;
  readonly message: string;
  readonly [extra: string]: unknown;
}

/** A mensagem do 5xx: o erro real vai para o log, nunca para o corpo (utils/http.js). */
export const MENSAGEM_ERRO_INTERNO_FACHADA =
  'Erro interno ao consultar o sistema. Tente novamente; se persistir, acione o suporte.';

/** Limites preservados (ref 01 §4.5 e §4.6; services/acoes.js; routes/convenios.js). */
export const LIMITES_FACHADA = {
  validadePropostaMs: 15 * 60 * 1000,
  maxPropostas: 500,
  /** Teto de linhas em memória por consulta de agenda e de exame. */
  tetoConsultas: 3000,
  tetoExames: 2000,
  /** GET /convenios: limite 1..500, padrão 100. */
  conveniosLimitePadrao: 100,
  conveniosLimiteMaximo: 500,
  /** Tamanho máximo dos textos de busca (maxLength 120 nas rotas). */
  buscaMaxima: 120,
  /** Tempo máximo do repasse à API original. */
  repasseTimeoutMs: 30_000,
} as const;

// ── Parâmetros (SGH_CFG_PARAMETRO, por estabelecimento) ───────────────────────────────────────────────

export const PARAMETROS_FACHADA = {
  ligada: 'integracao.fachada.ligada',
  escrita: 'integracao.fachada.escrita',
  superficies: 'integracao.fachada.superficies',
  destino: 'integracao.fachada.destino',
} as const;
export type ParametroFachada = (typeof PARAMETROS_FACHADA)[keyof typeof PARAMETROS_FACHADA];
export const CHAVES_PARAMETRO_FACHADA: readonly ParametroFachada[] = Object.values(PARAMETROS_FACHADA);

/** A configuração efetiva lida dos parâmetros. */
export interface ConfiguracaoFachada {
  readonly ligada: boolean;
  /** A superfície de ações e as escritas diretas (desligada por padrão; regra 9). */
  readonly escrita: boolean;
  readonly superficies: readonly SuperficieFachada[];
  /** Endereço-base da API original para o repasse (vazio: sem repasse). */
  readonly destino: string | null;
}

export const CONFIGURACAO_FACHADA_PADRAO: ConfiguracaoFachada = {
  ligada: false,
  escrita: false,
  superficies: ['atendimento', 'gestao', 'acoes', 'auditoria', 'saude'],
  destino: null,
};

// ── Painel (/administracao/integracoes/fachada) ───────────────────────────────────────────────────────

/** DP-8: a fachada só é necessária quando a API original não acompanha a mudança (UTF-8) a tempo. */
export const NECESSIDADES_FACHADA = ['nao-necessaria', 'necessaria'] as const;
export type NecessidadeFachada = (typeof NECESSIDADES_FACHADA)[number];

export interface OperacaoFachadaDescrita {
  readonly id: string;
  readonly superficie: SuperficieFachada;
  readonly metodo: 'GET' | 'POST';
  readonly caminho: string;
  readonly escreve: boolean;
  readonly modo: ModoFachada;
  /** Por que não é servida (ou por que a escrita servida está desligada), em português. */
  readonly motivo: string | null;
  readonly operacoesSgh: readonly { readonly nome: string; readonly estado: string | null }[];
  readonly chamadas: number;
  readonly erros: number;
}

export interface SuperficieFachadaDescrita {
  readonly superficie: SuperficieFachada;
  readonly ligada: boolean;
  readonly escopo: EscopoTokenFachada;
  readonly tokenConfigurado: boolean;
  readonly operacoes: number;
  readonly servidas: number;
  readonly repassadas: number;
  readonly desligadas: number;
}

export interface ProntidaoUtf8Fachada {
  /** Toda operação que os Squads usaram é servida pelo Sante SGH (ou não há uso medido). */
  readonly pronta: boolean;
  readonly usadasNaoServidas: readonly string[];
  readonly motivo: string;
}

export interface PainelFachada {
  readonly hospital: string;
  readonly versaoContrato: string;
  readonly necessidade: { readonly situacao: NecessidadeFachada; readonly motivo: string };
  readonly configuracao: ConfiguracaoFachada;
  readonly destinoConfigurado: boolean;
  readonly superficies: readonly SuperficieFachadaDescrita[];
  readonly operacoes: readonly OperacaoFachadaDescrita[];
  readonly motor: {
    readonly pendentes: number;
    readonly validadeMinutos: number;
    readonly maxPropostas: number;
  };
  readonly prontidaoUtf8: ProntidaoUtf8Fachada;
  readonly totais: {
    readonly operacoes: number;
    readonly servidas: number;
    readonly repassadas: number;
    readonly desligadas: number;
  };
  readonly usoDesde: string;
  readonly pode: { readonly configurar: boolean };
}

// ── Configurar (integracao.fachada.configurar, crítica: reautenticação) ───────────────────────────────

export const esquemaConfigurarFachada = z.object({
  chave: z.enum([
    PARAMETROS_FACHADA.ligada,
    PARAMETROS_FACHADA.escrita,
    PARAMETROS_FACHADA.superficies,
    PARAMETROS_FACHADA.destino,
  ]),
  valor: z.string().max(400),
  justificativa: z.string().trim().min(10).max(500),
  senha: z.string().min(1).max(200).optional(),
});
export type PedidoConfigurarFachada = z.infer<typeof esquemaConfigurarFachada>;

export interface ResultadoConfigurarFachada {
  readonly chave: ParametroFachada;
  readonly valor: string;
  readonly configuracao: ConfiguracaoFachada;
  readonly mensagem: string;
}

// ── As ações da superfície de ações (services/acoes-registro.js da versão 0.23.0) ─────────────────────

export interface AcaoFachada {
  /** A chave da ação (fila por recurso: as rotas da mesma linha compartilham a chave). */
  readonly acao: string;
  readonly rotas: readonly string[];
  readonly resumo: string;
  readonly reversivel: boolean;
}

export const ACOES_FACHADA: readonly AcaoFachada[] = [
  {
    acao: 'cobertura/convenio',
    rotas: ['/acoes/cobertura/convenio'],
    resumo: 'Liga ou desliga um convênio na lista de cobertura de uma agenda.',
    reversivel: true,
  },
  {
    acao: 'faturamento/lote/protocolo',
    rotas: ['/acoes/faturamento/lote/protocolo'],
    resumo: 'Registra (ou limpa) o número de protocolo de entrega de um lote TISS.',
    reversivel: true,
  },
  {
    acao: 'glosa/item',
    rotas: ['/acoes/glosa/recurso', '/acoes/glosa/retorno'],
    resumo: 'Recorre da glosa de um item da conta e baixa o retorno do recurso, na mesma fila.',
    reversivel: true,
  },
  {
    acao: 'cotacao/vencedor',
    rotas: ['/acoes/cotacao/vencedor'],
    resumo: 'Fecha a cotação de um item escolhendo o fornecedor vencedor.',
    reversivel: true,
  },
  {
    acao: 'precos/vigencia',
    rotas: ['/acoes/precos/vigencia', '/acoes/precos/vigencia/remover'],
    resumo: 'Reajusta preço criando uma nova vigência, e a apaga para desfazer.',
    reversivel: true,
  },
  {
    acao: 'convenios/situacao',
    rotas: ['/acoes/convenios/situacao'],
    resumo: 'Suspende ou reativa o credenciamento de um convênio.',
    reversivel: true,
  },
  {
    acao: 'faturamento/conta',
    rotas: ['/acoes/faturamento/fechar-conta', '/acoes/faturamento/reabrir-conta'],
    resumo: 'Fecha uma conta já emitida e reabre conta fechada, na mesma fila.',
    reversivel: true,
  },
  {
    acao: 'financeiro/titulo-a-pagar',
    rotas: ['/acoes/financeiro/titulo-a-pagar'],
    resumo: 'Lança um título a pagar em aberto e o apaga enquanto não for baixado. Nenhum dinheiro se move.',
    reversivel: true,
  },
  {
    acao: 'agenda/encaixe',
    rotas: ['/acoes/agenda/encaixe', '/acoes/agenda/encaixe/desfazer'],
    resumo:
      'Abre um encaixe nominal num minuto que a grade não ocupa, e o desfaz até o paciente retirar senha de atendimento.',
    reversivel: true,
  },
  {
    acao: 'agenda/grade',
    rotas: ['/acoes/agenda/grade'],
    resumo: 'Gera a grade de horários de uma agenda de consulta; a reversão só apaga o que continuar vazio.',
    reversivel: false,
  },
  {
    acao: 'cirurgia/agendar',
    rotas: ['/acoes/cirurgia/agendar'],
    resumo: 'Agenda cirurgia no mapa do centro cirúrgico. Confirmar ocupa a sala física.',
    reversivel: true,
  },
];

/** A ação de uma rota da superfície de ações (null: não é rota de proposta). */
export const acaoDaRota = (caminho: string): AcaoFachada | null =>
  ACOES_FACHADA.find((a) => a.rotas.includes(caminho)) ?? null;

// ── Esquemas das respostas do painel (validação no cliente da tela) ───────────────────────────────────

const esquemaConfiguracaoFachada = z.object({
  ligada: z.boolean(),
  escrita: z.boolean(),
  superficies: z.array(z.enum(SUPERFICIES_FACHADA)),
  destino: z.string().nullable(),
});

export const esquemaPainelFachada: z.ZodType<PainelFachada> = z.object({
  hospital: z.string(),
  versaoContrato: z.string(),
  necessidade: z.object({ situacao: z.enum(NECESSIDADES_FACHADA), motivo: z.string() }),
  configuracao: esquemaConfiguracaoFachada,
  destinoConfigurado: z.boolean(),
  superficies: z.array(
    z.object({
      superficie: z.enum(SUPERFICIES_FACHADA),
      ligada: z.boolean(),
      escopo: z.enum(ESCOPOS_TOKEN_FACHADA),
      tokenConfigurado: z.boolean(),
      operacoes: z.number(),
      servidas: z.number(),
      repassadas: z.number(),
      desligadas: z.number(),
    }),
  ),
  operacoes: z.array(
    z.object({
      id: z.string(),
      superficie: z.enum(SUPERFICIES_FACHADA),
      metodo: z.enum(['GET', 'POST']),
      caminho: z.string(),
      escreve: z.boolean(),
      modo: z.enum(MODOS_FACHADA),
      motivo: z.string().nullable(),
      operacoesSgh: z.array(z.object({ nome: z.string(), estado: z.string().nullable() })),
      chamadas: z.number(),
      erros: z.number(),
    }),
  ),
  motor: z.object({ pendentes: z.number(), validadeMinutos: z.number(), maxPropostas: z.number() }),
  prontidaoUtf8: z.object({
    pronta: z.boolean(),
    usadasNaoServidas: z.array(z.string()),
    motivo: z.string(),
  }),
  totais: z.object({
    operacoes: z.number(),
    servidas: z.number(),
    repassadas: z.number(),
    desligadas: z.number(),
  }),
  usoDesde: z.string(),
  pode: z.object({ configurar: z.boolean() }),
});

export const esquemaResultadoConfigurarFachada: z.ZodType<ResultadoConfigurarFachada> = z.object({
  chave: z.enum([
    PARAMETROS_FACHADA.ligada,
    PARAMETROS_FACHADA.escrita,
    PARAMETROS_FACHADA.superficies,
    PARAMETROS_FACHADA.destino,
  ]),
  valor: z.string(),
  configuracao: esquemaConfiguracaoFachada,
  mensagem: z.string(),
});
