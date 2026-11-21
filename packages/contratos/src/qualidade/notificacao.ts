// Notificação de incidentes, etapa 1 do M48 (ficha, seções 5 a 8; cap-05b §5.11; manual m17 "Como notificar um
// incidente" e "Como o NSP trata uma notificação"): o botão "Notificar incidente" em qualquer tela, com ou sem
// identificação; a classificação pela taxonomia da OMS, o grau e o tipo de dano; a triagem, a distribuição ao gestor
// da área e a devolutiva ao notificador pelo número de acompanhamento; os prazos regulatórios (RDC 36/2013, art. 10;
// NT GVIMS/GGTES/Anvisa 05/2019) e os campos para transcrição no Notivisa (sem API conhecida: DP-47.8).
// Tudo fica em SGH_QUA_NOTIFICACAO e SGH_QUA_NOTIF_EVENTO (só SGH_): o outro sistema não tem tabela de incidentes
// (o modelo de gerenciamento de riscos foi descontinuado com 246 registros de 2020 a 2022; o cadastro de incidentes
// da anestesia está vazio). Perfil da cópia pc (só agregados, 2026-10-24): 6 unidades, todas ativas; 11 feriados
// cadastrados (8 recorrentes, ano 9999; nenhum de 2026 nem de 2027: os móveis não estão no cadastro); 24 internados
// sem alta, todos com leito no atendimento.
// Regra 1 (não punitiva): o notificador só é gravado quando a notificação NÃO é anônima; o gestor da área nunca o vê;
// o NSP o vê só quando não é anônima. Nenhum nome de tabela do outro sistema sai daqui para a tela (ADR 0023).
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';

// ── Vocabulário ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Tipo do incidente (cap-05b §5.11: medicação, queda, LPP, identificação, cirurgia, IRAS, transfusão, dispositivo).
 * `outro` (decisão do preparo, POL-5): incidente fora dos oito (dieta, comunicação, equipamento), com a descrição do
 * tipo obrigatória; o NSP reclassifica na triagem.
 */
export const TIPOS_INCIDENTE = [
  { codigo: 'medicacao', rotulo: 'Medicação' },
  { codigo: 'queda', rotulo: 'Queda' },
  { codigo: 'lesaoPressao', rotulo: 'Lesão por pressão' },
  { codigo: 'identificacao', rotulo: 'Identificação do paciente' },
  { codigo: 'cirurgia', rotulo: 'Cirurgia ou procedimento' },
  { codigo: 'infeccao', rotulo: 'Infecção relacionada à assistência' },
  { codigo: 'transfusao', rotulo: 'Transfusão' },
  { codigo: 'dispositivo', rotulo: 'Dispositivo, equipamento ou material' },
  // W0-04 (M2): a flebite tem tipo próprio para o indicador da segurança do paciente (script 1024).
  { codigo: 'flebite', rotulo: 'Flebite (acesso venoso periférico)' },
  { codigo: 'outro', rotulo: 'Outro' },
] as const;
export type TipoIncidente = (typeof TIPOS_INCIDENTE)[number]['codigo'];
export const CODIGOS_TIPO_INCIDENTE = TIPOS_INCIDENTE.map((t) => t.codigo) as [
  TipoIncidente,
  ...TipoIncidente[],
];

/**
 * Classificação da OMS (Classificação Internacional para a Segurança do Paciente; RDC 36/2013):
 *   - circunstância notificável: situação com potencial de dano, sem incidente;
 *   - quase erro: o incidente não atingiu o paciente;
 *   - incidente sem dano: atingiu o paciente, sem dano;
 *   - evento adverso: atingiu o paciente e causou dano.
 */
export const CLASSIFICACOES_OMS = [
  { codigo: 'circunstanciaNotificavel', rotulo: 'Circunstância notificável', atingiu: false },
  { codigo: 'quaseErro', rotulo: 'Quase erro', atingiu: false },
  { codigo: 'incidenteSemDano', rotulo: 'Incidente sem dano', atingiu: true },
  { codigo: 'eventoAdverso', rotulo: 'Evento adverso', atingiu: true },
] as const;
export type ClassificacaoOms = (typeof CLASSIFICACOES_OMS)[number]['codigo'];
export const CODIGOS_CLASSIFICACAO_OMS = CLASSIFICACOES_OMS.map((c) => c.codigo) as [
  ClassificacaoOms,
  ...ClassificacaoOms[],
];

/** Grau de dano (cap-05b §5.11), em ordem crescente. */
export const GRAUS_DANO = [
  { codigo: 'nenhum', rotulo: 'Nenhum', ordem: 0 },
  { codigo: 'leve', rotulo: 'Leve', ordem: 1 },
  { codigo: 'moderado', rotulo: 'Moderado', ordem: 2 },
  { codigo: 'grave', rotulo: 'Grave', ordem: 3 },
  { codigo: 'obito', rotulo: 'Óbito', ordem: 4 },
] as const;
export type GrauDano = (typeof GRAUS_DANO)[number]['codigo'];
export const CODIGOS_GRAU_DANO = GRAUS_DANO.map((g) => g.codigo) as [GrauDano, ...GrauDano[]];

/**
 * Situação da notificação no fluxo do NSP. A etapa 1 vai de `recebida` a `distribuida` (ou `descartada`); `emAnalise`
 * e `concluida` são da etapa 2 (análise de causa e plano 5W2H), declaradas aqui para a tabela nascer completa.
 */
export const SITUACOES_NOTIFICACAO = [
  { codigo: 'recebida', rotulo: 'Recebida (aguarda triagem)' },
  { codigo: 'triada', rotulo: 'Triada' },
  { codigo: 'distribuida', rotulo: 'Distribuída ao gestor da área' },
  { codigo: 'emAnalise', rotulo: 'Em análise' },
  { codigo: 'concluida', rotulo: 'Concluída' },
  { codigo: 'descartada', rotulo: 'Descartada' },
] as const;
export type SituacaoNotificacao = (typeof SITUACOES_NOTIFICACAO)[number]['codigo'];
export const CODIGOS_SITUACAO_NOTIFICACAO = SITUACOES_NOTIFICACAO.map((s) => s.codigo) as [
  SituacaoNotificacao,
  ...SituacaoNotificacao[],
];

/** Motivos de descarte na triagem (a notificação continua no banco para o NSP; nada é apagado). */
export const MOTIVOS_DESCARTE_NOTIFICACAO = [
  { codigo: 'duplicada', rotulo: 'Duplicada (o mesmo incidente já foi notificado)' },
  { codigo: 'naoEIncidente', rotulo: 'Não é incidente de segurança do paciente' },
  { codigo: 'outroCanal', rotulo: 'É de outro canal (ouvidoria, segurança do trabalho, manutenção)' },
] as const;
export type MotivoDescarteNotificacao = (typeof MOTIVOS_DESCARTE_NOTIFICACAO)[number]['codigo'];
export const CODIGOS_MOTIVO_DESCARTE = MOTIVOS_DESCARTE_NOTIFICACAO.map((m) => m.codigo) as [
  MotivoDescarteNotificacao,
  ...MotivoDescarteNotificacao[],
];

/** Eventos do fluxo (SGH_QUA_NOTIF_EVENTO.TIPO): a linha do tempo da notificação, só de inclusão. */
export const TIPOS_EVENTO_NOTIFICACAO = [
  'recebida',
  'triada',
  'reclassificada',
  'distribuida',
  'devolutiva',
  'descartada',
  'notivisaExportada',
  'notivisaTranscrita',
  // Etapa 2: a análise começou (distribuída → em análise) e foi concluída (em análise → concluída).
  'analiseIniciada',
  'analiseConcluida',
] as const;
export type TipoEventoNotificacao = (typeof TIPOS_EVENTO_NOTIFICACAO)[number];

/**
 * Situação perante o Notivisa: `naoObrigatoria` (quase erro, circunstância e incidente sem dano: a notificação é
 * recomendada, não obrigatória; o NSP pode exportar mesmo assim), `pendente` (evento adverso triado), `exportada`
 * (campos gerados para transcrição) e `transcrita` (o NSP informou o número do Notivisa: o relógio para).
 */
export const SITUACOES_NOTIVISA = [
  { codigo: 'naoObrigatoria', rotulo: 'Não obrigatória' },
  { codigo: 'pendente', rotulo: 'Pendente' },
  { codigo: 'exportada', rotulo: 'Campos gerados (aguarda transcrição)' },
  { codigo: 'transcrita', rotulo: 'Transcrita no portal' },
] as const;
export type SituacaoNotivisa = (typeof SITUACOES_NOTIVISA)[number]['codigo'];

/** Prazos regulatórios da etapa 1 (regra 3). O agravo imediato (24 h) é da etapa 4. */
export const TIPOS_PRAZO_REGULATORIO = [
  { codigo: 'notivisaObito', rotulo: 'Óbito: notificar em até 72 horas' },
  { codigo: 'notivisaMensal', rotulo: 'Evento adverso: até o 15º dia útil do mês seguinte' },
  { codigo: 'analiseCausaRaiz', rotulo: 'Óbito ou never event: análise de causa raiz em até 60 dias' },
] as const;
export type TipoPrazoRegulatorio = (typeof TIPOS_PRAZO_REGULATORIO)[number]['codigo'];

/** Situação de um prazo no instante da consulta (a cor e o filtro da fila de prazos). */
export const SITUACOES_PRAZO = ['cumprido', 'noPrazo', 'venceEmBreve', 'vencido'] as const;
export type SituacaoPrazo = (typeof SITUACOES_PRAZO)[number];

/** Rótulo do tipo, da classificação ou do grau (texto de produto). */
export function rotuloTipoIncidente(t: TipoIncidente): string {
  return TIPOS_INCIDENTE.find((x) => x.codigo === t)?.rotulo ?? t;
}
export function rotuloClassificacaoOms(c: ClassificacaoOms): string {
  return CLASSIFICACOES_OMS.find((x) => x.codigo === c)?.rotulo ?? c;
}
export function rotuloGrauDano(g: GrauDano): string {
  return GRAUS_DANO.find((x) => x.codigo === g)?.rotulo ?? g;
}
export function ordemDoDano(g: GrauDano): number {
  return GRAUS_DANO.find((x) => x.codigo === g)?.ordem ?? 0;
}

// ── Protocolo e código de acompanhamento ────────────────────────────────────────────────────────────────────

/** Número de acompanhamento mostrado ao notificador: `NSP-AAAA-NNNNNN` (ano da notificação e sequencial do ano). */
export const FORMATO_PROTOCOLO = /^NSP-\d{4}-\d{6}$/;

/**
 * Código de acompanhamento da notificação anônima: 10 caracteres do alfabeto sem letras ambíguas (sem 0, O, 1, I, L),
 * mostrado uma vez; o banco guarda só o resumo (SHA-256) para conferir a devolutiva sem identificar ninguém.
 */
export const ALFABETO_CODIGO_ACOMPANHAMENTO = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const TAMANHO_CODIGO_ACOMPANHAMENTO = 10;
export const FORMATO_CODIGO_ACOMPANHAMENTO = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$/;

// ── Entradas ────────────────────────────────────────────────────────────────────────────────────────────

const id = z.number().int().positive();
/** Instante local (o horário de parede do estabelecimento), como o núcleo do legado lê: `AAAA-MM-DDTHH:mm[:ss]`. */
const instanteLocal = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/, 'Data e hora sem fuso (horário local).')
  .refine((v) => {
    const d = new Date(`${v.length === 16 ? `${v}:00` : v}Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 16) === v.slice(0, 16);
  }, 'Data ou hora inexistente.');
/** Login da conta do usuário. */
const login = z
  .string()
  .trim()
  .min(1)
  .max(31)
  .regex(/^[A-Za-z0-9._@-]+$/);

/** De onde o diálogo foi aberto (a rota da tela; nada de dado clínico), para o contexto e o indicador de origem. */
export const esquemaOrigemNotificacao = z.object({
  tela: z
    .string()
    .max(120)
    .regex(/^\/[A-Za-z0-9/_:.-]*$/),
  /** Quando o diálogo veio de uma sugestão automática (etapa 2: queda, reação transfusional, dose omitida...). */
  sugestao: z
    .string()
    .regex(/^[a-z][a-zA-Z0-9]*:[0-9]{1,18}$/)
    .optional(),
});

/**
 * `qualidade.notificarIncidente`. O paciente e o local vêm do contexto da tela (o atendimento aberto), que o servidor
 * relê pelo ID: o cliente nunca manda o nome do paciente. Sem atendimento, o notificador escolhe a unidade e descreve
 * o local. `anonima`: o servidor não grava quem notificou (nem na trilha, nem no log).
 */
export const esquemaNotificarIncidente = z
  .object({
    atendimento: id.nullable(),
    unidade: z.number().int().min(0).max(32767).nullable(),
    local: textoCp1252(80).nullable(),
    ocorridoEm: instanteLocal,
    tipo: z.enum(CODIGOS_TIPO_INCIDENTE),
    tipoOutro: textoCp1252(60).nullable(),
    chegouAoPaciente: z.boolean(),
    danoPercebido: z.enum(CODIGOS_GRAU_DANO),
    descricao: textoCp1252(4000).pipe(z.string().trim().min(10)),
    anonima: z.boolean(),
    origem: esquemaOrigemNotificacao,
  })
  .refine((e) => e.tipo !== 'outro' || (e.tipoOutro !== null && e.tipoOutro.trim().length >= 3), {
    message: 'Descreva o tipo do incidente.',
    path: ['tipoOutro'],
  })
  .refine((e) => e.chegouAoPaciente || e.danoPercebido === 'nenhum', {
    message: 'Se o incidente não chegou ao paciente, o dano é "nenhum".',
    path: ['danoPercebido'],
  })
  .refine((e) => e.atendimento !== null || e.unidade !== null, {
    message: 'Informe a unidade onde o incidente aconteceu.',
    path: ['unidade'],
  });
export type NotificarIncidenteEntrada = z.infer<typeof esquemaNotificarIncidente>;

/** Controle otimista: a versão (contagem de eventos) que a tela leu. */
const versao = z.number().int().min(0);

/**
 * `qualidade.triarNotificacao`: o NSP confirma ou corrige a classificação; corrigir o que o notificador propôs exige
 * justificativa (fica na linha do tempo). `neverEvent`: evento que nunca deveria acontecer (prazo de 60 dias).
 */
export const esquemaTriarNotificacao = z
  .object({
    notificacao: id,
    versao,
    tipo: z.enum(CODIGOS_TIPO_INCIDENTE),
    tipoOutro: textoCp1252(60).nullable(),
    classificacao: z.enum(CODIGOS_CLASSIFICACAO_OMS),
    dano: z.enum(CODIGOS_GRAU_DANO),
    neverEvent: z.boolean(),
    justificativa: textoCp1252(500).nullable(),
  })
  .refine((e) => e.tipo !== 'outro' || (e.tipoOutro !== null && e.tipoOutro.trim().length >= 3), {
    message: 'Descreva o tipo do incidente.',
    path: ['tipoOutro'],
  });
export type TriarNotificacaoEntrada = z.infer<typeof esquemaTriarNotificacao>;

/** `qualidade.distribuirNotificacao`: ao gestor da área, com o prazo da análise. */
export const esquemaDistribuirNotificacao = z.object({
  notificacao: id,
  versao,
  gestor: login,
  unidade: z.number().int().min(0).max(32767),
  prazoAnalise: z.iso.date(),
  orientacao: textoCp1252(500).nullable(),
});
export type DistribuirNotificacaoEntrada = z.infer<typeof esquemaDistribuirNotificacao>;

/**
 * `qualidade.devolverAoNotificador`: o retorno do que foi feito, que o notificador lê pelo número de acompanhamento
 * (mesmo anônimo). Sem dado do paciente no texto (a tela avisa).
 */
export const esquemaDevolverAoNotificador = z.object({
  notificacao: id,
  versao,
  texto: textoCp1252(2000).pipe(z.string().trim().min(10)),
});
export type DevolverAoNotificadorEntrada = z.infer<typeof esquemaDevolverAoNotificador>;

/** Descarte na triagem (operação `qualidade.triarNotificacao` com o desfecho "descartada"). */
export const esquemaDescartarNotificacao = z.object({
  notificacao: id,
  versao,
  motivo: z.enum(CODIGOS_MOTIVO_DESCARTE),
  justificativa: textoCp1252(500).pipe(z.string().trim().min(10)),
  /** Duplicada: o protocolo da notificação que fica. */
  duplicadaDe: z.string().regex(FORMATO_PROTOCOLO).nullable(),
});
export type DescartarNotificacaoEntrada = z.infer<typeof esquemaDescartarNotificacao>;

/** O NSP informa que transcreveu no portal (o número que o Notivisa devolveu): o relógio do prazo para. */
export const esquemaRegistrarTranscricaoNotivisa = z.object({
  notificacao: id,
  versao,
  numeroNotivisa: z
    .string()
    .trim()
    .min(3)
    .max(30)
    .regex(/^[A-Za-z0-9./-]+$/),
  transcritaEm: instanteLocal,
});
export type RegistrarTranscricaoNotivisaEntrada = z.infer<typeof esquemaRegistrarTranscricaoNotivisa>;

/** O notificador (identificado ou anônimo) consulta a devolutiva pelo número e pelo código de acompanhamento. */
export const esquemaAcompanharNotificacao = z.object({
  protocolo: z.string().trim().toUpperCase().pipe(z.string().regex(FORMATO_PROTOCOLO)),
  codigo: z.string().trim().toUpperCase().pipe(z.string().regex(FORMATO_CODIGO_ACOMPANHAMENTO)),
});
export type AcompanharNotificacaoEntrada = z.infer<typeof esquemaAcompanharNotificacao>;

/** Filtros da lista do NSP e da fila de prazos. */
export const esquemaFiltroNotificacoes = z.object({
  situacao: z.enum(CODIGOS_SITUACAO_NOTIFICACAO).optional(),
  tipo: z.enum(CODIGOS_TIPO_INCIDENTE).optional(),
  classificacao: z.enum(CODIGOS_CLASSIFICACAO_OMS).optional(),
  prazo: z.enum(SITUACOES_PRAZO).optional(),
  unidade: z.coerce.number().int().min(0).max(32767).optional(),
  de: z.iso.date().optional(),
  ate: z.iso.date().optional(),
  protocolo: z.string().trim().toUpperCase().pipe(z.string().regex(FORMATO_PROTOCOLO)).optional(),
  pagina: z.coerce.number().int().min(1).max(1000).default(1),
});
export type FiltroNotificacoes = z.infer<typeof esquemaFiltroNotificacoes>;

// ── Leituras e respostas ────────────────────────────────────────────────────────────────────────────────

/**
 * Contexto da tela de origem relido pelo servidor (o atendimento pelo id, com o cadastro do paciente, a unidade e o
 * leito). O nome serve só às iniciais dos campos do Notivisa e à tela do NSP; não vai a log nem à trilha.
 */
export interface ContextoNotificacaoLido {
  readonly atendimento: number;
  /** Id do paciente. */
  readonly paciente: number;
  readonly nomePaciente: string;
  readonly prontuario: number | null;
  readonly sexo: 'F' | 'M' | 'I';
  /** AAAA-MM-DD ou null (sentinela). */
  readonly nascimento: string | null;
  /** `I` internação; `E` externo (ambulatório, pronto atendimento, SADT). */
  readonly tipoAtendimento: 'internacao' | 'externo';
  /** O registro da internação (o número do atendimento quando é internação). */
  readonly registro: number | null;
  readonly unidade: number | null;
  readonly nomeUnidade: string | null;
  readonly leito: string | null;
  readonly acomodacao: string | null;
  readonly entradaEm: string | null;
  readonly encerrado: boolean;
}

/** Unidade para o notificador escolher quando não há atendimento na tela. */
export interface UnidadeNotificacao {
  readonly codigo: number;
  readonly nome: string;
}

/** Um prazo regulatório calculado (regra 3). */
export interface PrazoRegulatorio {
  readonly tipo: TipoPrazoRegulatorio;
  /** Instante local em que vence. */
  readonly venceEm: string;
  readonly situacao: SituacaoPrazo;
  /** Minutos até vencer (negativo: vencido há tantos minutos); null quando cumprido. */
  readonly minutosRestantes: number | null;
}

/** Resumo na lista do NSP (sem o notificador; sem o nome do paciente fora da lista do NSP). */
export interface NotificacaoResumo {
  readonly id: number;
  readonly protocolo: string;
  readonly notificadaEm: string;
  readonly ocorridoEm: string;
  readonly tipo: TipoIncidente;
  readonly classificacao: ClassificacaoOms;
  readonly dano: GrauDano;
  readonly situacao: SituacaoNotificacao;
  readonly notivisa: SituacaoNotivisa;
  readonly unidade: string | null;
  readonly comPaciente: boolean;
  readonly anonima: boolean;
  /** O prazo mais próximo ainda aberto (a ordem da fila de prazos). */
  readonly proximoPrazo: PrazoRegulatorio | null;
}

/** Linha do tempo (SGH_QUA_NOTIF_EVENTO): quem fez só aparece para o NSP; nunca o notificador anônimo. */
export interface EventoNotificacaoLido {
  readonly tipo: TipoEventoNotificacao;
  readonly em: string;
  readonly por: string | null;
  readonly texto: string | null;
}

/** Detalhe como cada leitor o vê (a projeção da regra 1 decide o que vem preenchido). */
export interface NotificacaoDetalhe extends NotificacaoResumo {
  readonly versao: number;
  readonly descricao: string;
  readonly local: string | null;
  readonly chegouAoPaciente: boolean;
  readonly danoPercebido: GrauDano;
  readonly tipoOutro: string | null;
  readonly neverEvent: boolean;
  /** Login de quem notificou: só para o NSP e só quando não é anônima. */
  readonly notificador: string | null;
  readonly paciente: {
    readonly id: number;
    readonly nome: string;
    readonly prontuario: number | null;
    readonly leito: string | null;
  } | null;
  readonly gestor: string | null;
  readonly prazoAnalise: string | null;
  readonly prazos: readonly PrazoRegulatorio[];
  readonly eventos: readonly EventoNotificacaoLido[];
}

/** Resposta do botão global: o número de acompanhamento e, só nessa resposta, o código (mostrado uma vez). */
export interface RespostaNotificarIncidente {
  readonly protocolo: string;
  readonly codigoAcompanhamento: string;
}

/** O que o notificador vê ao acompanhar: a situação e as devolutivas, sem a classificação nem o gestor. */
export interface AcompanhamentoNotificacao {
  readonly protocolo: string;
  readonly notificadaEm: string;
  readonly situacao: SituacaoNotificacao;
  readonly devolutivas: readonly { readonly em: string; readonly texto: string }[];
}

/**
 * Campos para transcrição no Notivisa (módulo Assistência à Saúde, Notivisa 2.0). Espelham as perguntas do
 * formulário com o que o Sante tem; o paciente vai só com iniciais, sexo e idade (nunca nome nem documento).
 * A ordem das etapas do formulário vigente (Comunicado GVIMS/GGTES/DIRE3 05/2025) é conferida pelo NSP na validação.
 */
export interface CamposNotivisa {
  readonly protocoloInterno: string;
  readonly tipoIncidente: string;
  readonly classificacao: string;
  readonly ocorridoEm: string;
  /** Período do dia (manhã 06–12, tarde 12–18, noite 18–24, madrugada 00–06). */
  readonly periodo: 'manha' | 'tarde' | 'noite' | 'madrugada';
  readonly unidade: string | null;
  readonly local: string | null;
  readonly descricao: string;
  readonly dano: string;
  readonly obito: boolean;
  readonly neverEvent: boolean;
  readonly paciente: {
    readonly iniciais: string;
    readonly sexo: 'F' | 'M' | 'I';
    readonly idade: number | null;
  } | null;
  readonly prazo: PrazoRegulatorio | null;
}
