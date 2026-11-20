// Notificação compulsória de agravos, etapa 4 do M48 (ficha, seções 4 a 8, regras 3, 8 e 11; cap-05b §5.11,
// "Notificação compulsória" e "Agravos"; manual m17 "Notificação compulsória de agravos"; DP-47.3):
//   - gatilhos: CID notificável registrado no atendimento (principal ou secundário), resultado reagente de exame
//     configurado e óbito de atendimento com CID notificável; quem abre o caso é a vigilância (a fila sugere);
//   - caso de agravo com prazo (imediata em 24 h; semanal em 7 dias), autoridade (SMS, SES, MS), ficha SINAN
//     pré-preenchida, notificação registrada (número, canal) ou descarte justificado;
//   - a lista nacional é a do próprio cadastro de CID do estabelecimento (a periodicidade por CID), atualizada pelo
//     importador `catalogo.importarAgravos` sem nova versão do sistema.
// O caso fica só em SGH_QUA_AGRAVO_CASO (só SGH_): as tabelas de ficha preenchida do outro sistema estão vazias e não
// são usadas sem estudo (ficha, seção 5). Perfil da cópia pc (só agregados, 2026-10-27): 288 CIDs notificáveis no
// cadastro (230 semanais, 58 imediatos); 53 modelos de ficha com 4.766 perguntas; desde 07/2025, 428 atendimentos com CID
// principal semanal e <5 imediato; 2.736 resultados de 2026 com "reagente" no texto (123 reagentes de fato). Nenhum nome
// de tabela do outro sistema sai daqui para a tela (ADR 0023).
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';

// ── Vocabulário ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Periodicidade da notificação (lista nacional; Portaria de consolidação, anexo 1 do anexo V). `codigoCadastro` é o
 * valor do cadastro de CID do estabelecimento (0 = não notificável, 1 = semanal, 2 = imediata), confirmado pelo
 * perfil da cópia (cólera, peste, poliomielite e raiva em 2; tuberculose e salmoneloses em 1; D-TP-48.4).
 */
export const PERIODICIDADES_AGRAVO = [
  { codigo: 'imediata', rotulo: 'Imediata (até 24 horas)', horas: 24, codigoCadastro: 2 },
  { codigo: 'semanal', rotulo: 'Semanal (até 7 dias)', horas: 168, codigoCadastro: 1 },
] as const;
export type PeriodicidadeAgravo = (typeof PERIODICIDADES_AGRAVO)[number]['codigo'];
export const CODIGOS_PERIODICIDADE_AGRAVO = PERIODICIDADES_AGRAVO.map((p) => p.codigo) as [
  PeriodicidadeAgravo,
  ...PeriodicidadeAgravo[],
];

/** O que fez o caso nascer. `manual`: a vigilância abriu sem gatilho (busca ativa, telefonema, suspeita clínica). */
export const ORIGENS_CASO_AGRAVO = [
  { codigo: 'cid', rotulo: 'CID notificável registrado no atendimento' },
  { codigo: 'exame', rotulo: 'Resultado reagente de exame' },
  { codigo: 'obito', rotulo: 'Óbito com CID notificável' },
  { codigo: 'manual', rotulo: 'Aberto pela vigilância' },
] as const;
export type OrigemCasoAgravo = (typeof ORIGENS_CASO_AGRAVO)[number]['codigo'];
export const CODIGOS_ORIGEM_CASO_AGRAVO = ORIGENS_CASO_AGRAVO.map((o) => o.codigo) as [
  OrigemCasoAgravo,
  ...OrigemCasoAgravo[],
];
export type GatilhoAgravo = Exclude<OrigemCasoAgravo, 'manual'>;

export const SITUACOES_CASO_AGRAVO = [
  { codigo: 'aberto', rotulo: 'Aguardando notificação' },
  { codigo: 'notificado', rotulo: 'Notificado' },
  { codigo: 'descartado', rotulo: 'Descartado' },
] as const;
export type SituacaoCasoAgravo = (typeof SITUACOES_CASO_AGRAVO)[number]['codigo'];
export const CODIGOS_SITUACAO_CASO_AGRAVO = SITUACOES_CASO_AGRAVO.map((s) => s.codigo) as [
  SituacaoCasoAgravo,
  ...SituacaoCasoAgravo[],
];

/** Autoridades sanitárias (o cadastro de autoridades do estabelecimento: 1 SMS, 2 SES, 3 MS). */
export const AUTORIDADES_SANITARIAS = [
  { codigo: 'SMS', id: 1, rotulo: 'Secretaria Municipal de Saúde' },
  { codigo: 'SES', id: 2, rotulo: 'Secretaria Estadual de Saúde' },
  { codigo: 'MS', id: 3, rotulo: 'Ministério da Saúde' },
] as const;
export type AutoridadeSanitaria = (typeof AUTORIDADES_SANITARIAS)[number]['codigo'];
export const CODIGOS_AUTORIDADE_SANITARIA = AUTORIDADES_SANITARIAS.map((a) => a.codigo) as [
  AutoridadeSanitaria,
  ...AutoridadeSanitaria[],
];

/**
 * Canal da notificação. O SINAN não tem API (cap-12 §12.4): o Sante gera a ficha e registra como ela foi entregue. O
 * canal de Campos está por confirmar pelo núcleo de vigilância (DP-47.3); até lá, ficha impressa.
 */
export const CANAIS_NOTIFICACAO_AGRAVO = [
  { codigo: 'fichaImpressa', rotulo: 'Ficha impressa entregue à vigilância municipal', exigeNumero: false },
  { codigo: 'sinanOnline', rotulo: 'Digitada no Sinan', exigeNumero: true },
  { codigo: 'esusSinan', rotulo: 'Digitada no e-SUS Sinan', exigeNumero: true },
  { codigo: 'telefone', rotulo: 'Comunicada por telefone (imediata)', exigeNumero: false },
  { codigo: 'email', rotulo: 'Comunicada por e-mail à autoridade', exigeNumero: false },
] as const;
export type CanalNotificacaoAgravo = (typeof CANAIS_NOTIFICACAO_AGRAVO)[number]['codigo'];
export const CODIGOS_CANAL_NOTIFICACAO_AGRAVO = CANAIS_NOTIFICACAO_AGRAVO.map((c) => c.codigo) as [
  CanalNotificacaoAgravo,
  ...CanalNotificacaoAgravo[],
];

/** Motivos do descarte do caso (a vigilância descarta com justificativa; nada é apagado). */
export const MOTIVOS_DESCARTE_AGRAVO = [
  { codigo: 'jaNotificado', rotulo: 'Já notificado por outro serviço ou em outro atendimento' },
  { codigo: 'naoConfirmado', rotulo: 'Suspeita não confirmada (CID de exclusão ou registro equivocado)' },
  { codigo: 'resultadoAntigo', rotulo: 'Resultado reflete infecção antiga ou já acompanhada' },
  { codigo: 'outro', rotulo: 'Outro motivo' },
] as const;
export type MotivoDescarteAgravo = (typeof MOTIVOS_DESCARTE_AGRAVO)[number]['codigo'];
export const CODIGOS_MOTIVO_DESCARTE_AGRAVO = MOTIVOS_DESCARTE_AGRAVO.map((m) => m.codigo) as [
  MotivoDescarteAgravo,
  ...MotivoDescarteAgravo[],
];

const rotuloDe =
  <T extends { readonly codigo: string; readonly rotulo: string }>(lista: readonly T[]) =>
  (c: T['codigo']): string =>
    lista.find((x) => x.codigo === c)?.rotulo ?? c;
export const rotuloPeriodicidadeAgravo = rotuloDe(PERIODICIDADES_AGRAVO);
export const rotuloOrigemCasoAgravo = rotuloDe(ORIGENS_CASO_AGRAVO);
export const rotuloSituacaoCasoAgravo = rotuloDe(SITUACOES_CASO_AGRAVO);
export const rotuloAutoridadeSanitaria = rotuloDe(AUTORIDADES_SANITARIAS);
export const rotuloCanalNotificacaoAgravo = rotuloDe(CANAIS_NOTIFICACAO_AGRAVO);
export const rotuloMotivoDescarteAgravo = rotuloDe(MOTIVOS_DESCARTE_AGRAVO);

/** A periodicidade do valor do cadastro de CID (0 ou desconhecido = não notificável). */
export function periodicidadeDoCadastro(valor: number | null | undefined): PeriodicidadeAgravo | null {
  return PERIODICIDADES_AGRAVO.find((p) => p.codigoCadastro === valor)?.codigo ?? null;
}
export function horasDaPeriodicidade(p: PeriodicidadeAgravo): number {
  return PERIODICIDADES_AGRAVO.find((x) => x.codigo === p)?.horas ?? 168;
}
export function canalExigeNumero(c: CanalNotificacaoAgravo): boolean {
  return CANAIS_NOTIFICACAO_AGRAVO.find((x) => x.codigo === c)?.exigeNumero ?? false;
}

// ── Entradas ────────────────────────────────────────────────────────────────────────────────────────────

const id = z.number().int().positive();
/** O pedido de exame e o atendimento do outro sistema (NUMERIC/DOUBLE, sempre inteiros). */
const idGrande = z.number().int().positive().max(999_999_999_999_999);
const versao = z.number().int().min(1);
const instanteLocal = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/, 'Data e hora sem fuso (horário local).')
  .refine((v) => {
    const d = new Date(`${v.length === 16 ? `${v}:00` : v}Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 16) === v.slice(0, 16);
  }, 'Data ou hora inexistente.');
const data = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, 'Data inexistente.');
/** CID-10 como o cadastro guarda: letra, dois dígitos e, opcionalmente, a subcategoria (sem ponto). */
export const esquemaCidAgravo = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase().replace('.', ''))
  .pipe(z.string().regex(/^[A-Z]\d{2}[0-9X]?$/, 'CID-10 no formato A00 ou A000.'));
const observacao = textoCp1252(500).nullable();
const justificativa = textoCp1252(500).pipe(z.string().trim().min(10));

/**
 * `qualidade.abrirCasoAgravo`: o caso a partir de um gatilho da fila (com a referência dele: o atendimento, o
 * pedido de exame ou o atendimento do óbito) ou aberto pela vigilância (manual, com o atendimento quando houver).
 */
export const esquemaAbrirCasoAgravo = z
  .object({
    origem: z.enum(CODIGOS_ORIGEM_CASO_AGRAVO),
    /** O pedido de exame (gatilho `exame`); nos outros, nulo. */
    exame: idGrande.nullable(),
    atendimento: idGrande.nullable(),
    paciente: id,
    cid: esquemaCidAgravo,
    /** Quando o gatilho aconteceu (o registro do CID, a liberação do resultado, o óbito) ou a suspeita (manual). */
    gatilhoEm: instanteLocal,
    observacao,
  })
  .refine((e) => e.origem !== 'exame' || e.exame !== null, {
    message: 'Informe o exame do resultado reagente.',
    path: ['exame'],
  })
  .refine((e) => e.origem === 'exame' || e.exame === null, {
    message: 'O exame é só do gatilho de resultado reagente.',
    path: ['exame'],
  })
  .refine((e) => e.origem === 'manual' || e.atendimento !== null, {
    message: 'O caso vindo da fila traz o atendimento do gatilho.',
    path: ['atendimento'],
  })
  .refine((e) => e.origem !== 'manual' || (e.observacao !== null && e.observacao.trim().length >= 10), {
    message: 'No caso aberto pela vigilância, descreva a suspeita (pelo menos 10 caracteres).',
    path: ['observacao'],
  });
export type AbrirCasoAgravoEntrada = z.infer<typeof esquemaAbrirCasoAgravo>;

/** `qualidade.registrarNotificacaoAgravo`: a notificação entregue (autoridade, canal, número quando o canal dá). */
export const esquemaRegistrarNotificacaoAgravo = z
  .object({
    caso: id,
    versao,
    autoridade: z.enum(CODIGOS_AUTORIDADE_SANITARIA),
    canal: z.enum(CODIGOS_CANAL_NOTIFICACAO_AGRAVO),
    /** Número da notificação no Sinan (7 dígitos no Sinan Net; até 12 no e-SUS Sinan). */
    numero: z
      .string()
      .trim()
      .regex(/^\d{1,12}$/, 'Número só com dígitos (até 12).')
      .nullable(),
    notificadoEm: instanteLocal,
    /** Quem recebeu (telefone e e-mail): nome ou setor da vigilância, sem dado do paciente. */
    recebidoPor: textoCp1252(80).nullable(),
    observacao,
  })
  .refine((e) => !canalExigeNumero(e.canal) || e.numero !== null, {
    message: 'Informe o número da notificação gerado pelo Sinan.',
    path: ['numero'],
  })
  .refine((e) => !['telefone', 'email'].includes(e.canal) || (e.recebidoPor?.trim().length ?? 0) >= 3, {
    message: 'Informe quem recebeu a comunicação.',
    path: ['recebidoPor'],
  });
export type RegistrarNotificacaoAgravoEntrada = z.infer<typeof esquemaRegistrarNotificacaoAgravo>;

/** `qualidade.descartarCasoAgravo`. */
export const esquemaDescartarCasoAgravo = z.object({
  caso: id,
  versao,
  motivo: z.enum(CODIGOS_MOTIVO_DESCARTE_AGRAVO),
  justificativa,
});
export type DescartarCasoAgravoEntrada = z.infer<typeof esquemaDescartarCasoAgravo>;

/**
 * `qualidade.configurarGatilhoExame`: o exame cujo resultado reagente sugere o agravo (pelo nome do exame no
 * cadastro: contém `padrao` e não contém `exceto`). Sem configuração, vale a lista padrão das regras puras.
 */
export const esquemaConfigurarGatilhoExame = z.object({
  /** Nulo inclui; com ID altera. */
  gatilho: id.nullable(),
  versao: versao.nullable(),
  padrao: textoCp1252(40).pipe(z.string().trim().min(3)),
  exceto: textoCp1252(40).nullable(),
  cid: esquemaCidAgravo,
  ativo: z.boolean(),
});
export type ConfigurarGatilhoExameEntrada = z.infer<typeof esquemaConfigurarGatilhoExame>;

// ── Consultas ──────────────────────────────────────────────────────────────────────────────────────────

/** A fila de gatilhos ainda sem caso (janela de busca em dias; teto de 30, a ficha pede "desde a última leitura"). */
export const esquemaFiltroGatilhosAgravo = z.object({
  dias: z.coerce.number().int().min(1).max(30).default(7),
  origem: z.enum(['cid', 'exame', 'obito']).optional(),
});
export type FiltroGatilhosAgravo = z.infer<typeof esquemaFiltroGatilhosAgravo>;

export const esquemaFiltroCasosAgravo = z.object({
  situacao: z.enum(CODIGOS_SITUACAO_CASO_AGRAVO).optional(),
  periodicidade: z.enum(CODIGOS_PERIODICIDADE_AGRAVO).optional(),
  desde: data.optional(),
  ate: data.optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(100).default(50),
});
export type FiltroCasosAgravo = z.infer<typeof esquemaFiltroCasosAgravo>;

// ── Respostas ──────────────────────────────────────────────────────────────────────────────────────────

/** Estado do prazo do caso aberto (regra 3: agravo imediato em 24 h). */
export type EstadoPrazoAgravo = 'noPrazo' | 'vencendo' | 'vencido' | 'cumprido' | 'naoSeAplica';

/** Paciente do caso: só o necessário para a ficha e a busca na fila (não sai em log nem em trilha). */
export interface PacienteAgravo {
  readonly id: number;
  readonly nome: string;
  readonly prontuario: number | null;
  readonly nascimento: string | null;
  readonly sexo: 'M' | 'F' | null;
}

/** Um gatilho sem caso aberto (a sugestão da fila; quem decide abrir é a vigilância). */
export interface GatilhoAgravoLido {
  /** Chave estável do gatilho (origem, referência e CID): a fila não repete o que já virou caso. */
  readonly chave: string;
  readonly origem: GatilhoAgravo;
  readonly atendimento: number;
  readonly exame: number | null;
  readonly paciente: PacienteAgravo;
  readonly cid: string;
  readonly nomeCid: string;
  readonly periodicidade: PeriodicidadeAgravo;
  readonly gatilhoEm: string;
  readonly prazoEm: string;
  readonly estadoPrazo: EstadoPrazoAgravo;
  /** O exame e o resultado (gatilho `exame`), sem o laudo inteiro. */
  readonly exameNome: string | null;
  readonly resultado: string | null;
  readonly unidade: string | null;
}

export interface CasoAgravoLido {
  readonly id: number;
  readonly versao: number;
  readonly situacao: SituacaoCasoAgravo;
  readonly origem: OrigemCasoAgravo;
  readonly atendimento: number | null;
  readonly exame: number | null;
  readonly paciente: PacienteAgravo;
  readonly cid: string;
  readonly nomeCid: string;
  readonly periodicidade: PeriodicidadeAgravo;
  readonly gatilhoEm: string;
  readonly prazoEm: string;
  readonly estadoPrazo: EstadoPrazoAgravo;
  /** Horas até o prazo (negativas depois dele); nulo quando notificado ou descartado. */
  readonly horasRestantes: number | null;
  readonly fichaModelo: number | null;
  readonly autoridade: AutoridadeSanitaria | null;
  readonly canal: CanalNotificacaoAgravo | null;
  readonly numero: string | null;
  readonly notificadoEm: string | null;
  readonly recebidoPor: string | null;
  readonly motivoDescarte: MotivoDescarteAgravo | null;
  readonly justificativaDescarte: string | null;
  readonly observacao: string | null;
  readonly abertoPor: string;
  readonly abertoEm: string;
  readonly encerradoPor: string | null;
  readonly encerradoEm: string | null;
}

export interface PaginaCasosAgravo {
  readonly itens: readonly CasoAgravoLido[];
  readonly total: number;
  readonly pagina: number;
  readonly porPagina: number;
}

/** Resumo da fila (cartão da página inicial e cabeçalho da tela). */
export interface ResumoAgravos {
  readonly abertos: number;
  readonly imediatosAbertos: number;
  readonly vencidos: number;
  readonly gatilhosSemCaso: number;
  readonly notificadosNoMes: number;
  /** A funcionalidade ligada no estabelecimento (desligada: a tela fica em consulta, com o motivo). */
  readonly ligada: boolean;
  readonly motivo: string | null;
  /** A sessão pode gravar (ligada e com `qualidade.agravo.notificar`). */
  readonly podeNotificar: boolean;
  /** O relógio do servidor (horário local), para os campos de data e hora. */
  readonly agora: string;
}

/** Uma pergunta da ficha SINAN do agravo, com o valor pré-preenchido quando o Sante sabe. */
export interface PerguntaFichaAgravo {
  readonly codigo: number;
  readonly subcodigo: number;
  readonly texto: string;
  readonly valor: string | null;
}

export interface FichaAgravo {
  readonly caso: number;
  readonly modelo: { readonly id: number; readonly nome: string } | null;
  readonly perguntas: readonly PerguntaFichaAgravo[];
  readonly preenchidas: number;
  /** O modelo é o genérico (individual) porque o CID não tem ficha própria no cadastro. */
  readonly generica: boolean;
}

/** Um CID notificável do cadastro (a lista nacional como o estabelecimento a tem). */
export interface CidNotificavel {
  readonly cid: string;
  readonly nome: string;
  readonly periodicidade: PeriodicidadeAgravo;
}

export interface GatilhoExameLido {
  readonly id: number | null;
  readonly versao: number | null;
  readonly padrao: string;
  readonly exceto: string | null;
  readonly cid: string;
  readonly ativo: boolean;
  /** `padrao`: da lista padrão das regras (sem configuração do estabelecimento). */
  readonly fonte: 'padrao' | 'configurado';
}
