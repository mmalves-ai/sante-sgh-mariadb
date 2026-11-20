// W0-04 (programa CRUD completo, 18/11/2026): as entradas da correção e do cancelamento da qualidade e da CCIH. Toda
// mudança de registro já lançado leva a versão que a tela leu e a justificativa (motivo obrigatório, 10 a 500
// caracteres): a versão anterior fica acessível como inativa (SBIS NGS1.12.01 e NGS1.12.03); nada se apaga.
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';
import {
  CODIGOS_CATEGORIA_OBSERVADA,
  CODIGOS_CRITERIO_IRAS,
  CODIGOS_DISPOSITIVO_INVASIVO,
  CODIGOS_MOTIVO_PRECAUCAO,
  esquemaCompetenciaCcih,
  esquemaOportunidadeHigiene,
} from './ccih.js';
import { CODIGOS_TIPO_MANIFESTACAO, esquemaItemChecklistAuditoria } from './gestao.js';
import { CODIGOS_PRECAUCAO } from '../internacao/adt.js';

const id = z.number().int().positive();
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
const textoMin = (max: number, min: number) => textoCp1252(max).pipe(z.string().trim().min(min));
const textoOpcional = (max: number) => textoCp1252(max).nullable();

/** O motivo de toda correção, cancelamento, estorno, retificação e reabertura. */
export const esquemaJustificativaQualidade = textoMin(500, 10);

/** As ações que geram versão (a mesma lista do CHECK de SGH_QUA_VERSAO). */
export const ACOES_VERSAO_QUALIDADE = [
  { codigo: 'correcao', rotulo: 'Correção' },
  { codigo: 'cancelamento', rotulo: 'Cancelamento' },
  { codigo: 'estorno', rotulo: 'Estorno' },
  { codigo: 'retificacao', rotulo: 'Retificação' },
  { codigo: 'reabertura', rotulo: 'Reabertura' },
  { codigo: 'fechamento', rotulo: 'Fechamento' },
] as const;
export type AcaoVersaoQualidade = (typeof ACOES_VERSAO_QUALIDADE)[number]['codigo'];

/** Os registros da qualidade com histórico de versões (o nome da rota, nunca o da tabela). */
export const REGISTROS_VERSIONADOS_QUALIDADE = {
  dispositivo: 'SGH_QUA_DISPOSITIVO',
  iras: 'SGH_QUA_IRAS',
  precaucao: 'SGH_QUA_PRECAUCAO',
  'observacao-maos': 'SGH_QUA_HIGIENE_MAOS',
  auditoria: 'SGH_QUA_AUDITORIA',
  reuniao: 'SGH_QUA_COMISSAO_REUNIAO',
  'nao-conformidade': 'SGH_QUA_NAO_CONFORM',
  manifestacao: 'SGH_QUA_OUVIDORIA',
  competencia: 'SGH_QUA_COMPETENCIA',
  // W0-04 (M5): a revisão do prontuário corrigida antes do aval e o sorteio e a pendência cancelados.
  'revisao-prontuario': 'SGH_QUA_REV_PRONTUARIO',
  'sorteio-revisao': 'SGH_QUA_REV_SORTEIO',
  'pendencia-revisao': 'SGH_QUA_REV_PENDENCIA',
  // Revisão do W0-04: o checklist do bundle, a comissão e a revisão do checklist de completude.
  bundle: 'SGH_QUA_DISP_BUNDLE',
  comissao: 'SGH_QUA_COMISSAO',
  'checklist-revisao': 'SGH_QUA_REV_CHECKLIST',
} as const;
export type RegistroVersionadoQualidade = keyof typeof REGISTROS_VERSIONADOS_QUALIDADE;
export const CODIGOS_REGISTRO_VERSIONADO = Object.keys(REGISTROS_VERSIONADOS_QUALIDADE) as [
  RegistroVersionadoQualidade,
  ...RegistroVersionadoQualidade[],
];

/** Uma versão anterior (inativa) de um registro, como a tela mostra. */
export interface VersaoRegistroQualidade {
  readonly versao: number;
  readonly acao: AcaoVersaoQualidade;
  readonly motivo: string;
  readonly alteradoPor: string;
  readonly alteradoEm: string;
  readonly dados: Readonly<Record<string, unknown>>;
}

/** Cancelar, estornar ou reabrir: só a versão e o motivo. */
export const esquemaCancelarRegistroQualidade = z.object({
  versao,
  justificativa: esquemaJustificativaQualidade,
});
export type CancelarRegistroQualidadeEntrada = z.infer<typeof esquemaCancelarRegistroQualidade>;

// ── CCIH ──────────────────────────────────────────────────────────────────────────────────────────────

/** Corrigir o dispositivo: data de inserção (e de retirada, se retirado), sítio e tipo, com versão. */
export const esquemaCorrigirDispositivo = z.object({
  versao,
  tipo: z.enum(CODIGOS_DISPOSITIVO_INVASIVO),
  sitio: textoCp1252(40).nullable(),
  inseridoEm: instanteLocal,
  retiradoEm: instanteLocal.nullable(),
  /** Revisão do W0-04: o registro do profissional responsável pela inserção (ausente = não muda; null = sem). */
  responsavel: id.nullable().optional(),
  justificativa: esquemaJustificativaQualidade,
});
export type CorrigirDispositivoEntrada = z.infer<typeof esquemaCorrigirDispositivo>;

/** Alterar a ficha de IRAS: critérios, microrganismo e data (antes do fechamento da competência). */
export const esquemaCorrigirIras = z
  .object({
    versao,
    dataInfeccao: data,
    criterios: z.array(z.enum(CODIGOS_CRITERIO_IRAS)).min(1).max(CODIGOS_CRITERIO_IRAS.length),
    microrganismo: textoCp1252(80).nullable(),
    multirresistente: z.boolean(),
    descricao: textoCp1252(1000).nullable(),
    justificativa: esquemaJustificativaQualidade,
  })
  .refine((e) => !e.multirresistente || (e.microrganismo?.trim().length ?? 0) > 0, {
    message: 'Informe o microrganismo multirresistente.',
    path: ['microrganismo'],
  });
export type CorrigirIrasEntrada = z.infer<typeof esquemaCorrigirIras>;

/** Alterar a precaução aberta: tipo, motivo e o bloqueio dos vizinhos. */
export const esquemaAlterarPrecaucao = z
  .object({
    versao,
    tipo: z.enum(CODIGOS_PRECAUCAO),
    motivo: z.enum(CODIGOS_MOTIVO_PRECAUCAO),
    motivoOutro: textoCp1252(60).nullable(),
    bloquearVizinhos: z.boolean(),
    justificativa: esquemaJustificativaQualidade,
  })
  .refine((e) => e.motivo !== 'outro' || (e.motivoOutro !== null && e.motivoOutro.trim().length >= 3), {
    message: 'Descreva o motivo da precaução.',
    path: ['motivoOutro'],
  });
export type AlterarPrecaucaoEntrada = z.infer<typeof esquemaAlterarPrecaucao>;

/** Corrigir a sessão de observação de higiene das mãos (a unidade e o setor ficam). */
export const esquemaCorrigirObservacaoMaos = z.object({
  versao,
  observadoEm: instanteLocal,
  categoria: z.enum(CODIGOS_CATEGORIA_OBSERVADA),
  oportunidades: z.array(esquemaOportunidadeHigiene).min(1).max(50),
  observacao: textoCp1252(200).nullable(),
  justificativa: esquemaJustificativaQualidade,
});
export type CorrigirObservacaoMaosEntrada = z.infer<typeof esquemaCorrigirObservacaoMaos>;

/** Fechar a competência dos indicadores de IRAS e dispositivos-dia. */
export const esquemaFecharCompetenciaCcih = z.object({ competencia: esquemaCompetenciaCcih });
export type FecharCompetenciaCcihEntrada = z.infer<typeof esquemaFecharCompetenciaCcih>;

// ── Gestão da qualidade ─────────────────────────────────────────────────────────────────────────────────

/** Alterar a auditoria interna (com versão). */
export const esquemaAlterarAuditoria = z.object({
  versao,
  titulo: textoMin(200, 5),
  area: textoMin(80, 2),
  realizadaEm: data,
  auditores: textoMin(400, 3),
  itens: z.array(esquemaItemChecklistAuditoria).min(1).max(150),
  conclusao: textoMin(2000, 10),
  justificativa: esquemaJustificativaQualidade,
});
export type AlterarAuditoriaEntrada = z.infer<typeof esquemaAlterarAuditoria>;

/** Retificar a ata (nova versão; a anterior fica acessível). */
export const esquemaRetificarAta = z.object({
  versao,
  pauta: textoMin(2000, 5),
  ata: textoMin(8000, 20),
  presentes: z.array(z.number().int().min(0).max(39)).max(40),
  convidados: textoOpcional(400),
  deliberacoes: textoOpcional(2000),
  justificativa: esquemaJustificativaQualidade,
});
export type RetificarAtaEntrada = z.infer<typeof esquemaRetificarAta>;

/** Assinar (aprovar) a ata: depois dela a reunião não se cancela, só se retifica. */
export const esquemaAssinarAta = z.object({ versao });

/** Cancelar a não conformidade duplicada ou aberta por engano (a original, quando duplicada). */
export const esquemaCancelarNaoConformidade = z.object({
  versao,
  duplicadaDe: id.nullable(),
  justificativa: esquemaJustificativaQualidade,
});
export type CancelarNaoConformidadeEntrada = z.infer<typeof esquemaCancelarNaoConformidade>;

/** Corrigir a manifestação antes do encaminhamento: tipo, área e relato. */
export const esquemaCorrigirManifestacao = z.object({
  versao,
  tipo: z.enum(CODIGOS_TIPO_MANIFESTACAO),
  area: textoMin(80, 2),
  relato: textoMin(4000, 10),
  justificativa: esquemaJustificativaQualidade,
});
export type CorrigirManifestacaoEntrada = z.infer<typeof esquemaCorrigirManifestacao>;

/** O registro que impede o cancelamento (recusa de órfão): o grupo, quantos e quais. */
export interface DependenteQualidade {
  readonly grupo: string;
  readonly quantidade: number;
  readonly ids: readonly number[];
}
