// W0-04 (programa CRUD completo, M5 do mercado): a comissão de revisão de prontuários (CFM 1.638/2002, art. 3º a 5º:
// avaliar os itens que devem constar do prontuário, a completude e a qualidade do registro) sobre a comissão do tipo
// 'prontuario' da gestão da qualidade (M48.5). Script 1025 (SGH_QUA_REV_*):
//   - checklist de completude configurável e versionado (alterar publica a revisão seguinte; inativa-se com motivo);
//   - sorteio reproduzível das altas da competência (a semente fica registrada; refazer dá a mesma amostra);
//   - revisão de cada prontuário pelo checklist; o item não conforme vira pendência ao médico assistente da alta, com
//     prazo, que ele responde na lista "Minhas pendências de prontuário";
//   - o percentual conforme por clínica, com as parcelas;
//   - o aval da comissão, lido pelo SAME pelo número da internação.
// Nenhum dado do outro sistema muda (a alta, a clínica e o médico só são lidos).
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';
import { esquemaJustificativaQualidade } from './crud.js';
import { esquemaCompetenciaQualidade } from './gestao.js';

const id = z.number().int().positive().max(9_007_199_254_740_991);
const versao = z.number().int().min(1);
const codigo = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9-]{1,39}$/, 'Código em minúsculas, sem espaço (letras, números e hífen).');

/** Resposta de cada item do checklist na revisão do prontuário. */
export const RESULTADOS_REVISAO_PRONTUARIO = [
  { codigo: 'conforme', rotulo: 'Conforme' },
  { codigo: 'naoConforme', rotulo: 'Não conforme' },
  { codigo: 'naoAplicavel', rotulo: 'Não se aplica' },
] as const;
export type ResultadoRevisaoProntuario = (typeof RESULTADOS_REVISAO_PRONTUARIO)[number]['codigo'];
export const CODIGOS_RESULTADO_REVISAO = RESULTADOS_REVISAO_PRONTUARIO.map((r) => r.codigo) as [
  ResultadoRevisaoProntuario,
  ...ResultadoRevisaoProntuario[],
];

export type SituacaoRevisaoProntuario = 'aRevisar' | 'conforme' | 'naoConforme';
export type SituacaoChecklistRevisao = 'vigente' | 'substituida' | 'inativa';
export type SituacaoPendenciaRevisao = 'aberta' | 'resolvida' | 'cancelada';

/** Prazo padrão da pendência ao profissional (dias corridos; parâmetro `qualidade.revisaoProntuario.prazoDias`). */
export const PRAZO_PENDENCIA_REVISAO_DIAS = 15;
export const PARAMETRO_PRAZO_PENDENCIA_REVISAO = 'qualidade.revisaoProntuario.prazoDias';
/** Teto do sorteio (prontuários por sorteio). */
export const TETO_AMOSTRA_REVISAO = 200;

/**
 * O checklist padrão sugerido na primeira publicação (CFM 1.638/2002, art. 5º, e CFM 1.821/2007: identificação,
 * anamnese, evolução diária, prescrição, resultados, sumário de alta e a assinatura do profissional). A comissão edita
 * antes de publicar; o código não traz conteúdo clínico de produção.
 */
export const CHECKLIST_REVISAO_SUGERIDO = [
  { codigo: 'identificacao', titulo: 'Identificação do paciente completa em todas as folhas' },
  { codigo: 'anamnese', titulo: 'Anamnese e exame físico registrados na admissão' },
  { codigo: 'evolucao-diaria', titulo: 'Evolução médica diária, datada e assinada' },
  { codigo: 'prescricao', titulo: 'Prescrição diária legível, datada e assinada' },
  { codigo: 'exames', titulo: 'Resultados de exames anexados ou registrados' },
  { codigo: 'consentimento', titulo: 'Termo de consentimento nos procedimentos que o exigem' },
  { codigo: 'sumario-alta', titulo: 'Sumário de alta com diagnóstico, conduta e orientações' },
  { codigo: 'assinatura', titulo: 'Assinatura e número do conselho em todos os registros' },
] as const;

export const esquemaItemChecklistRevisao = z
  .object({
    codigo,
    titulo: textoCp1252(160).pipe(z.string().trim().min(3)),
    /** O peso do item no percentual ponderado (lido do item gravado; ausente pesa 1). */
    peso: z.number().min(0).max(999).optional(),
    /** Se o item aceita "não se aplica" (lido do item gravado; ausente aceita). */
    aceitaNaoAplicavel: z.boolean().optional(),
  })
  .strict();
export type ItemChecklistRevisao = z.infer<typeof esquemaItemChecklistRevisao>;

/** Publicar o checklist (a primeira revisão ou a seguinte, que substitui a vigente). */
export const esquemaPublicarChecklistRevisao = z
  .object({
    comissao: id,
    itens: z
      .array(esquemaItemChecklistRevisao)
      .min(1)
      .max(60)
      .refine((xs) => new Set(xs.map((x) => x.codigo)).size === xs.length, 'Código de item repetido.'),
    /** Obrigatório na revisão seguinte (o que mudou e por quê). */
    motivo: esquemaJustificativaQualidade.nullable(),
    /** A revisão vigente que a tela leu (null na primeira). */
    vigente: z.object({ id, versao }).nullable(),
  })
  .strict();
export type PublicarChecklistRevisaoEntrada = z.infer<typeof esquemaPublicarChecklistRevisao>;

export const esquemaInativarChecklistRevisao = z
  .object({ versao, justificativa: esquemaJustificativaQualidade })
  .strict();

/** O sorteio das altas da competência (a semente vazia é gerada pelo servidor e registrada). */
export const esquemaSortearRevisao = z
  .object({
    comissao: id,
    competencia: esquemaCompetenciaQualidade,
    quantidade: z.number().int().min(1).max(TETO_AMOSTRA_REVISAO),
    semente: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9-]{4,40}$/, 'A semente tem de 4 a 40 letras, números ou hífen.')
      .nullable(),
  })
  .strict();
export type SortearRevisaoEntrada = z.infer<typeof esquemaSortearRevisao>;

export const esquemaCancelarSorteioRevisao = z
  .object({ versao, justificativa: esquemaJustificativaQualidade, senha: z.string().min(1).max(128) })
  .strict();

export const esquemaRespostaItemRevisao = z
  .object({
    item: codigo,
    resultado: z.enum(CODIGOS_RESULTADO_REVISAO),
    observacao: textoCp1252(300).nullable(),
  })
  .strict();
export type RespostaItemRevisao = z.infer<typeof esquemaRespostaItemRevisao>;

/** Revisar (ou corrigir a revisão, com a justificativa, antes do aval). */
export const esquemaRevisarProntuario = z
  .object({
    versao,
    respostas: z.array(esquemaRespostaItemRevisao).min(1).max(60),
    observacao: textoCp1252(500).nullable(),
    /** Obrigatória ao corrigir uma revisão já gravada. */
    justificativa: esquemaJustificativaQualidade.nullable(),
  })
  .strict();
export type RevisarProntuarioEntrada = z.infer<typeof esquemaRevisarProntuario>;

export const esquemaAvalRevisao = z.object({ versao, senha: z.string().min(1).max(128) }).strict();

export const esquemaResponderPendenciaRevisao = z
  .object({ versao, resposta: textoCp1252(500).pipe(z.string().trim().min(10)) })
  .strict();
export const esquemaCancelarPendenciaRevisao = z
  .object({ versao, justificativa: esquemaJustificativaQualidade })
  .strict();

export const esquemaFiltroSorteiosRevisao = z.object({
  comissao: z.coerce.number().int().positive(),
});
export const esquemaFiltroIndicadorRevisao = z.object({
  comissao: z.coerce.number().int().positive(),
  competencia: esquemaCompetenciaQualidade,
});
export const esquemaConsultaAvalRevisao = z.object({ reg: z.coerce.number().int().positive() });

// ── Respostas ────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ChecklistRevisaoLido {
  readonly id: number;
  readonly comissao: number;
  readonly revisao: number;
  readonly itens: readonly ItemChecklistRevisao[];
  readonly situacao: SituacaoChecklistRevisao;
  readonly motivo: string | null;
  readonly publicadoPor: string;
  readonly publicadoEm: string;
  readonly inativadoPor: string | null;
  readonly inativadoEm: string | null;
  /** Revisão do W0-04 (1026): o motivo da inativação (o `motivo` é o da publicação e nunca é sobrescrito). */
  readonly motivoInativacao?: string | null;
  readonly versao: number;
}

export interface PendenciaRevisaoLida {
  readonly id: number;
  readonly prontuario: number;
  readonly reg: number;
  readonly item: string;
  readonly descricao: string;
  readonly profissionalNome: string | null;
  readonly profissionalLogin: string | null;
  readonly prazo: string;
  readonly situacao: SituacaoPendenciaRevisao;
  readonly vencida: boolean;
  readonly resposta: string | null;
  readonly resolvidaPor: string | null;
  readonly resolvidaEm: string | null;
  readonly canceladaPor: string | null;
  readonly canceladaEm: string | null;
  readonly motivoCancelamento: string | null;
  readonly criadaEm: string;
  readonly versao: number;
}

export interface ProntuarioRevisaoLido {
  readonly id: number;
  readonly ordem: number;
  readonly reg: number;
  readonly alta: string;
  readonly clinica: string;
  readonly medico: string | null;
  readonly situacao: SituacaoRevisaoProntuario;
  readonly respostas: readonly RespostaItemRevisao[];
  readonly observacao: string | null;
  readonly revisadoPor: string | null;
  readonly revisadoEm: string | null;
  readonly avalPor: string | null;
  readonly avalEm: string | null;
  /** O aval cabe: revisado e sem pendência aberta. */
  readonly podeAval: boolean;
  readonly pendencias: readonly PendenciaRevisaoLida[];
  readonly versao: number;
}

export interface SorteioRevisaoLido {
  readonly id: number;
  readonly comissao: number;
  readonly checklist: number;
  readonly checklistRevisao: number;
  readonly competencia: string;
  readonly semente: string;
  readonly quantidade: number;
  readonly universo: number;
  readonly resumoUniverso: string;
  readonly sorteadoPor: string;
  readonly sorteadoEm: string;
  readonly canceladoEm: string | null;
  readonly canceladoPor: string | null;
  readonly motivoCancelamento: string | null;
  readonly revisados: number;
  readonly versao: number;
}

export interface ConformidadeClinicaRevisao {
  readonly clinica: string;
  readonly revisados: number;
  readonly conformes: number;
  readonly percentual: number | null;
  readonly conta: string | null;
}

export interface IndicadorRevisaoProntuario {
  readonly competencia: string;
  readonly total: ConformidadeClinicaRevisao;
  readonly porClinica: readonly ConformidadeClinicaRevisao[];
  readonly pendenciasAbertas: number;
  readonly pendenciasVencidas: number;
}

/** O que o SAME lê: a revisão mais recente da internação e o aval. */
export interface AvalRevisaoProntuario {
  readonly reg: number;
  readonly revisado: boolean;
  readonly situacao: SituacaoRevisaoProntuario | null;
  readonly avalEm: string | null;
  readonly avalPor: string | null;
  readonly pendenciasAbertas: number;
  /** O texto que o SAME grava no aval do descarte (ex.: "Comissão de revisão: aval em 10/11/2026 por SINT.X"). */
  readonly texto: string | null;
}

export type RecusaRevisaoProntuario =
  | 'comissao-nao-e-de-prontuario'
  | 'comissao-inativa'
  | 'checklist-ausente'
  | 'checklist-vigente-desatualizado'
  | 'motivo-obrigatorio'
  | 'competencia-aberta'
  | 'sem-altas'
  | 'universo-cortado'
  | 'amostra-maior-que-universo'
  | 'sorteio-cancelado'
  | 'sorteio-com-revisao'
  | 'resposta-incompleta'
  | 'item-fora-do-checklist'
  | 'nao-aplicavel-nao-aceito'
  | 'revisao-com-aval'
  | 'justificativa-obrigatoria'
  | 'pendencia-aberta'
  | 'nao-revisado'
  | 'pendencia-nao-e-sua'
  | 'pendencia-encerrada'
  | 'aval-ja-registrado';

export const MENSAGENS_RECUSA_REVISAO: Readonly<Record<RecusaRevisaoProntuario, string>> = {
  'comissao-nao-e-de-prontuario': 'A revisão de prontuários é da comissão do tipo "Revisão de prontuários".',
  'comissao-inativa': 'A comissão está inativa.',
  'checklist-ausente': 'Publique o checklist de completude da comissão antes do sorteio.',
  'checklist-vigente-desatualizado':
    'O checklist vigente mudou desde que a tela foi aberta. Abra de novo e confira.',
  'motivo-obrigatorio': 'Escreva o que mudou no checklist e por quê (10 caracteres ou mais).',
  'competencia-aberta': 'Sorteie só competência terminada (as altas do mês inteiro).',
  'sem-altas': 'A competência não tem alta para sortear.',
  'universo-cortado':
    'A competência tem mais altas do que a leitura alcança: o universo ficaria cortado e a amostra deixaria altas de fora. Fale com o suporte para ampliar o teto antes de sortear.',
  'amostra-maior-que-universo': 'A amostra é maior do que o número de altas da competência.',
  'sorteio-cancelado': 'O sorteio foi cancelado.',
  'sorteio-com-revisao': 'O sorteio já tem prontuário revisado: não se cancela mais.',
  'resposta-incompleta': 'Responda todos os itens do checklist.',
  'item-fora-do-checklist': 'A resposta tem item que não está no checklist do sorteio.',
  'nao-aplicavel-nao-aceito': 'Há item respondido como "não se aplica" que o checklist não aceita assim.',
  'revisao-com-aval': 'O prontuário já tem o aval da comissão: a revisão não muda mais.',
  'justificativa-obrigatoria': 'Corrigir a revisão já gravada exige a justificativa (10 caracteres ou mais).',
  'pendencia-aberta': 'Há pendência aberta com o profissional: o aval espera a resposta ou o cancelamento.',
  'nao-revisado': 'Revise o prontuário antes do aval.',
  'pendencia-nao-e-sua': 'A pendência é de outro profissional.',
  'pendencia-encerrada': 'A pendência já foi resolvida ou cancelada.',
  'aval-ja-registrado': 'O aval já foi registrado.',
};
