// Respostas da API da internação, dos leitos, da higienização e do SAME (M21; ficha, seções 4 e 7): o que as telas
// de trabalho recebem. Nenhum nome de tabela nem de coluna do banco (fronteira). O nome do paciente só vai às telas
// com a permissão de ler a internação (e a leitura com nome vai à trilha); o mapa leva só as iniciais (regra 16 do M16).
import { z } from 'zod';
import { esquemaPainelLeitos } from './leitos.js';

const codNome = z.object({ codigo: z.number().int(), nome: z.string() });
const leitoChave = z.object({ bloco: z.string(), acomodacao: z.string(), leito: z.string() });

// ── Gravação (as ações valem agora? com o motivo) ─────────────────────────────────────────────────

export const esquemaGravacaoInternacao = z.object({
  ligada: z.boolean(),
  motivo: z.string().nullable(),
  operacoes: z.record(z.string(), z.object({ pode: z.boolean(), motivo: z.string().nullable() })),
  /** A alta médica é ato médico: a sessão tem o conselho ativo e a permissão? */
  altaMedica: z.object({ pode: z.boolean(), motivo: z.string().nullable() }),
});
export type GravacaoInternacao = z.infer<typeof esquemaGravacaoInternacao>;

export const esquemaResultadoInternacao = z.object({
  ok: z.literal(true),
  resultado: z.record(z.string(), z.union([z.number(), z.string(), z.boolean(), z.null()])),
  repetida: z.boolean(),
  mensagem: z.string(),
});
export type ResultadoInternacao = z.infer<typeof esquemaResultadoInternacao>;

// ── Internação ────────────────────────────────────────────────────────────────────────────────────

export const esquemaInternacaoResumo = z.object({
  reg: z.number().int(),
  paciente: z.number().int(),
  prontuario: z.number().int(),
  nome: z.string(),
  leito: leitoChave,
  /** O tipo da acomodação atual e se é de terapia intensiva (pelo trecho em curso). */
  tipoAcomodacao: z.string(),
  intensiva: z.boolean(),
  entrada: z.string(),
  horaEntrada: z.string(),
  alta: z.string().nullable(),
  horaSaida: z.string().nullable(),
  convenio: codNome,
  clinica: z.string(),
  especialidade: codNome,
  medicoAssistente: z.string(),
  /** Diárias até hoje pela regra do legado (as faturáveis) e a permanência pela Portaria 312. */
  diasInternacao: z.number().int(),
  isolamento: z.boolean(),
  /** A alta médica decidida no novo e ainda sem a saída (o segundo tempo da alta). */
  altaMedica: z
    .object({ motivo: z.number().int(), destino: z.string(), decididaEm: z.string(), medico: z.string() })
    .nullable(),
  versao: z.string(),
});
export type InternacaoResumo = z.infer<typeof esquemaInternacaoResumo>;

export const esquemaInternacoes = z.object({
  itens: z.array(esquemaInternacaoResumo),
  cortada: z.boolean(),
  lidoEm: z.string(),
});
export type InternacoesLista = z.infer<typeof esquemaInternacoes>;

export const esquemaTrechoInternacao = z.object({
  leito: leitoChave,
  tipo: codNome,
  entrada: z.string(),
  horaEntrada: z.string(),
  saida: z.string().nullable(),
  horaSaida: z.string().nullable(),
});

export const esquemaGuiaInternacao = z.object({
  conta: z.number(),
  guia: z.string(),
  inicio: z.string(),
  fim: z.string().nullable(),
  validadeDias: z.number().int(),
  temSenha: z.boolean(),
  /** A guia vence em até 1 dia (o alerta de vencimento) ou já venceu com a internação aberta. */
  vencimento: z.enum(['vigente', 'vence-hoje', 'vencida']),
});

export const esquemaTrocaInternacao = z.object({
  tipo: z.enum(['convenio', 'clinica', 'especialidade', 'medico']),
  data: z.string(),
  hora: z.string(),
  de: z.string(),
  para: z.string(),
  usuario: z.string(),
});

export const esquemaContaInternacao = z.object({
  conta: z.number(),
  inicio: z.string(),
  fim: z.string().nullable(),
  /** P parcial (do faturamento) ou D definitiva, como o legado marca. */
  tipo: z.string(),
  guias: z.number().int(),
});

export const esquemaProcedimentoExtraInternacao = z.object({
  conta: z.number(),
  procedimento: z.number(),
  sequencia: z.number().int(),
  convenio: z.number().int().nullable(),
  apac: z.boolean(),
  dataApac: z.string().nullable(),
  especialidade: z.number().int().nullable(),
});

export const esquemaInternacaoDetalhe = esquemaInternacaoResumo.extend({
  cabecalho: z.string(),
  procedimento: z.number(),
  cid: z.string().nullable(),
  medicoSolicitante: z.string(),
  acomodacaoPlano: z.string(),
  matricula: z.string(),
  validadeCarteira: z.string().nullable(),
  carater: z.string(),
  origem: z.string().nullable(),
  nivelCuidado: z.string().nullable(),
  trechos: z.array(esquemaTrechoInternacao),
  guias: z.array(esquemaGuiaInternacao),
  trocas: z.array(esquemaTrocaInternacao),
  contas: z.array(esquemaContaInternacao),
  procedimentosExtras: z.array(esquemaProcedimentoExtraInternacao),
  /** A saída gravada (alta administrativa) e o grupo do motivo (regra 6). */
  saida: z
    .object({
      motivo: codNome,
      grupo: z.string(),
      diariasFaturaveis: z.number().int(),
      permanencia312: z.number().int(),
    })
    .nullable(),
  reinternacao30: z.boolean(),
});
export type InternacaoDetalhe = z.infer<typeof esquemaInternacaoDetalhe>;

// ── Pré-internação ────────────────────────────────────────────────────────────────────────────────

export const esquemaPreInternacaoItem = z.object({
  paciente: z.number().int(),
  prontuario: z.number().int(),
  nome: z.string(),
  dataPrevista: z.string(),
  horaPrevista: z.string(),
  situacao: z.enum(['pendente', 'outra']),
  problema: z.enum(['sem-data', 'impossivel']).nullable(),
  convenio: codNome,
  especialidade: codNome,
  medico: z.string(),
  acomodacao: z.string().nullable(),
  procedimento: z.number(),
});
export type PreInternacaoItem = z.infer<typeof esquemaPreInternacaoItem>;

export const esquemaPreInternacoes = z.object({
  itens: z.array(esquemaPreInternacaoItem),
  contagens: z.object({
    pendentes: z.number().int(),
    semData: z.number().int(),
    impossiveis: z.number().int(),
  }),
  cortada: z.boolean(),
});
export type PreInternacoes = z.infer<typeof esquemaPreInternacoes>;

// ── Mapa de leitos operacional ────────────────────────────────────────────────────────────────────

export const SITUACOES_MAPA_LEITO = [
  'livre',
  'ocupado',
  'inativo',
  'bloqueado',
  'higienizacao',
  'conflito',
  // M44 (etapa 2): o leito livre com a reserva vigente do NIR (só o paciente da solicitação é admitido nele).
  'reservado',
] as const;
export type SituacaoMapaLeito = (typeof SITUACOES_MAPA_LEITO)[number];

export const esquemaLeitoMapa = z.object({
  chave: z.string(),
  leito: leitoChave,
  /** Situação no mapa operacional (a do painel do M16 sobreposta pelos estados só do novo). */
  situacao: z.enum(SITUACOES_MAPA_LEITO),
  estados: z.array(
    z.object({
      estado: z.string(),
      motivo: z.string().nullable(),
      precaucao: z.string().nullable(),
      previsaoFim: z.string().nullable(),
      desde: z.string(),
      /** W0-07: a observação do estado (o bloqueio de uma OS traz "OS <número>"). */
      observacao: z.string().nullable().optional(),
    }),
  ),
  /** Admitir aqui no novo (o outro sistema pode ocupar o bloqueado: o mapa mostra o conflito). */
  admissivel: z.boolean(),
  motivo: z.string().nullable(),
  limpeza: z
    .object({
      solicitacao: z.number().int(),
      etapa: z.string(),
      prazo: z.string().nullable(),
      atrasada: z.boolean(),
    })
    .nullable(),
  conflito: z
    .object({
      internacao: z.number().int(),
      desde: z.string(),
      /** O conflito já foi registrado (SGH_INT_LEITO_ESTADO e trilha): a releitura não registra de novo. */
      registrado: z.boolean().optional(),
      /** M44: o conflito vem da reserva do NIR (o outro sistema ocupou o leito reservado aqui). */
      reserva: z.number().int().optional(),
    })
    .nullable(),
  /**
   * Com `?paciente=` ou `?internacao=` no mapa: por que o leito não aceita aquele paciente pelos atributos do novo
   * (sexo e faixa de idade); null quando aceita. Ausente sem paciente.
   */
  incompatibilidade: z.string().nullable().optional(),
  atributos: z
    .object({
      sexo: z.string().nullable(),
      idadeMinima: z.number().int().nullable(),
      idadeMaxima: z.number().int().nullable(),
      criticidade: z.number().int().nullable(),
    })
    .nullable(),
  /**
   * M44 (etapa 2): a reserva vigente do NIR no leito (a solicitação, a validade e se confirmada); `conflito` na reserva
   * quando o outro sistema ocupou o leito reservado aqui (regra 12: o mapa mostra e o NIR é avisado).
   */
  reserva: z
    .object({
      id: z.number().int(),
      solicitacao: z.number().int(),
      validaAte: z.string(),
      confirmada: z.boolean(),
    })
    .nullable()
    .optional(),
});
export type LeitoMapa = z.infer<typeof esquemaLeitoMapa>;

export const esquemaMapaOperacional = z.object({
  painel: esquemaPainelLeitos,
  leitos: z.array(esquemaLeitoMapa),
  resumo: z.object({
    bloqueados: z.number().int(),
    emHigienizacao: z.number().int(),
    conflitos: z.number().int(),
    admissiveis: z.number().int(),
    /** M44 (etapa 2): os leitos reservados pelo NIR. */
    reservados: z.number().int().optional(),
  }),
});
export type MapaOperacional = z.infer<typeof esquemaMapaOperacional>;

export const esquemaHistoricoOcupacao = z.object({
  itens: z.array(
    z.object({
      internacao: z.number().int(),
      leito: leitoChave,
      tipo: codNome,
      entrada: z.string(),
      horaEntrada: z.string(),
      saida: z.string().nullable(),
      horaSaida: z.string().nullable(),
      /** Horas no trecho (até agora no trecho aberto). */
      horas: z.number(),
    }),
  ),
  total: z.number().int(),
  pagina: z.number().int(),
  porPagina: z.number().int(),
});
export type HistoricoOcupacao = z.infer<typeof esquemaHistoricoOcupacao>;

// ── Higienização ──────────────────────────────────────────────────────────────────────────────────

export const esquemaSolicitacaoLimpeza = z.object({
  solicitacao: z.number().int(),
  leito: leitoChave,
  chave: z.string(),
  origem: z.string().nullable(),
  tipoLimpeza: codNome.nullable(),
  etapa: z.string(),
  situacaoLegado: z.number().int(),
  profissional: codNome.nullable(),
  precaucao: z.string().nullable(),
  solicitadaEm: z.string(),
  prazo: z.string().nullable(),
  atrasada: z.boolean(),
  /** Minutos em execução (sem as pausas) e minutos desde a solicitação. */
  minutosExecucao: z.number().int(),
  minutosDesdeSolicitacao: z.number().int(),
  checklist: z.array(z.string()),
  foto: z.string().nullable(),
  historico: z.array(
    z.object({ etapa: z.string(), em: z.string(), por: z.string(), aparelho: z.string().nullable() }),
  ),
});
export type SolicitacaoLimpeza = z.infer<typeof esquemaSolicitacaoLimpeza>;

export const esquemaPainelHigienizacao = z.object({
  itens: z.array(esquemaSolicitacaoLimpeza),
  contagens: z.record(z.string(), z.number().int()),
  atrasadas: z.number().int(),
  /** As solicitações antigas paradas no primeiro estado (o legado não as fecha): só a contagem, fora da fila. */
  paradasAntigas: z.number().int(),
  /**
   * Na fila de quem só executa: o profissional ligado ao login (o cadastro do profissional da limpeza). A etapa sai sempre em
   * nome dele; ausente para o supervisor, que escolhe.
   */
  profissionalDaSessao: z.number().int().nullable().optional(),
  lidoEm: z.string(),
});
export type PainelHigienizacao = z.infer<typeof esquemaPainelHigienizacao>;

/**
 * W0-07 (M3): os indicadores de higienização e giro de leito do período, cada linha com o numerador e o denominador,
 * no total e por tipo de limpeza, área (bloco) e profissional (o cálculo em @sgh/dominio-hotelaria).
 */
export const esquemaIndicadoresGiroLeito = z.object({
  de: z.string(),
  ate: z.string(),
  liberadas: z.number().int(),
  linhas: z.array(
    z.object({
      codigo: z.enum(['tempoGiroLeito', 'higienizacaoNoPrazo', 'tempoExecucaoLimpeza']),
      indicador: z.string(),
      recorte: z.enum(['total', 'tipo', 'area', 'profissional']),
      chave: z.string(),
      rotulo: z.string(),
      numerador: z.number(),
      denominador: z.number(),
      valor: z.number().nullable(),
      unidade: z.enum(['minutos', 'percentual']),
    }),
  ),
});
export type IndicadoresGiroLeitoResposta = z.infer<typeof esquemaIndicadoresGiroLeito>;

// ── SAME ──────────────────────────────────────────────────────────────────────────────────────────

export const esquemaMovimentoSame = z.object({
  id: z.number().int(),
  operacao: codNome,
  origem: codNome,
  destino: codNome,
  em: z.string(),
  usuario: z.string(),
  responsavel: z.string(),
  excluido: z.boolean(),
  motivoExclusao: z.string().nullable(),
  protocolo: z.string().nullable(),
  prazoDevolucao: z.string().nullable(),
  /** A remessa aceita por quem recebe (no novo) e a devolução já cobrada (no novo). */
  aceito: z.boolean().optional(),
  cobrada: z.boolean().optional(),
});
export type MovimentoSame = z.infer<typeof esquemaMovimentoSame>;

export const esquemaLocalizacaoConta = z.object({
  conta: z.number().int(),
  numero: z.number(),
  atendimento: z.number().int(),
  tipo: z.enum(['internacao', 'externo']),
  paciente: z.string(),
  prontuario: z.number().int(),
  local: z.object({ setor: codNome, desde: z.string(), operacao: z.string() }).nullable(),
  /** A devolução cobrada (o prazo passou com o volume fora do SAME). */
  devolucaoAtrasada: z.boolean(),
  linhaDoTempo: z.array(esquemaMovimentoSame),
  /** As ocorrências registradas no novo (o recebimento do que não foi enviado), mais recentes primeiro. */
  ocorrencias: z.array(z.object({ motivo: z.string(), em: z.string(), por: z.string() })).optional(),
  cortada: z.boolean(),
});
export type LocalizacaoConta = z.infer<typeof esquemaLocalizacaoConta>;

/** Os volumes fora do SAME além do prazo de devolução (a lista da cobrança): só a conta e os setores. */
export const esquemaDevolucoesAtrasadas = z.object({
  itens: z.array(
    z.object({
      conta: z.number().int(),
      movimento: z.number().int(),
      setor: codNome,
      desde: z.string(),
      prazo: z.string(),
      diasAtraso: z.number().int(),
      cobrada: z.boolean(),
    }),
  ),
  cortada: z.boolean(),
  lidoEm: z.string(),
});
export type DevolucoesAtrasadas = z.infer<typeof esquemaDevolucoesAtrasadas>;

// ── Apoio das telas ───────────────────────────────────────────────────────────────────────────────

export const esquemaApoioInternacao = z.object({
  convenios: z.array(codNome),
  especialidades: z.array(codNome),
  motivosAlta: z.array(codNome.extend({ grupo: z.string() })),
  acomodacoes: z.array(
    z.object({ bloco: z.string(), acomodacao: z.string(), nome: z.string(), tipo: z.number().int() }),
  ),
  tiposLimpeza: z.array(codNome),
  profissionaisLimpeza: z.array(codNome),
  setores: z.array(codNome),
  operacoesSame: z.array(codNome),
  motivosSame: z.array(codNome),
  motivosExclusao: z.array(codNome),
  unidades: z.array(codNome),
  centrosCusto: z.array(codNome),
});
export type ApoioInternacaoTela = z.infer<typeof esquemaApoioInternacao>;

export const esquemaProfissionalBusca = z.array(
  z.object({ vinculo: z.number().int(), nome: z.string(), conselho: z.string(), especialidade: z.string() }),
);
