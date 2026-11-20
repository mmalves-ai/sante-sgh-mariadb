// W0-05 (programa CRUD completo, 18/11/2026): inclusão, alteração e exclusão da nutrição, do serviço social, da
// oncologia e do lactário, e a ficha EMTN completa. Regras da matriz de governança (base brasileira):
//   - registro clínico finalizado (triagem, acompanhamento da terapia, avaliação social): a correção é do PRÓPRIO autor,
//     como nova versão com justificativa; a anterior fica inativa e visível (SBIS NGS1.12.01); o estorno é inativação
//     com justificativa (NGS1.12.03); nunca exclusão física;
//   - prescrição (meta da EMTN, ciclo de quimioterapia): o ajuste é nova versão; a suspensão e o cancelamento são fatos
//     novos com motivo; o ciclo validado não se edita;
//   - protocolo de quimioterapia: a versão publicada é imutável; o protocolo se inativa ou a versão se revoga, nunca se
//     exclui, porque ciclos a referenciam;
//   - ordem do lactário: pedido interno antes da conferência (alteração livre, com log); depois, só o cancelamento com
//     motivo, porque a etiqueta pode ter sido impressa;
//   - refeição do acompanhante: alteração com histórico (o valor anterior no log; não é dado clínico do paciente).
// Todas as gravações são só SGH_: nenhuma tabela do legado é tocada (desfazer a ligação ciclo–prescrição remove só o
// vínculo SGH_ e deixa a prescrição do legado intacta).
import { z } from 'zod';
import { esquemaDataIso } from '../preco/entradas.js';
import { textoCp1252 } from '../texto-cp1252.js';
import { CODIGOS_MOTIVO_META, esquemaRespostasTriagem } from './nutricao.js';
import {
  ACESSOS_NPT,
  ANDAMENTOS_CICLO,
  CODIGOS_CATEGORIA_CICLO,
  CODIGOS_PARECER_NPT,
} from './correcao-base.js';

export * from './correcao-base.js';

const livre = (max: number) => textoCp1252(max).overwrite((t) => t.replace(/\s+/g, ' ').trim());
const id = z.number().int().positive().max(2_147_483_647);

/** A justificativa de toda correção, inativação, cancelamento ou alteração (5 a 500 caracteres). */
export const esquemaJustificativaCorrecao = livre(500).pipe(
  z.string().min(5, 'Diga o motivo (ao menos 5 caracteres).'),
);

/** Corpo das ações que só pedem o motivo (estorno, encerramento, cancelamento, inativação, retomada). */
export const esquemaSoMotivo = z.object({ motivo: esquemaJustificativaCorrecao }).strict();
export type SoMotivoEntrada = z.infer<typeof esquemaSoMotivo>;

// ── A correção lida (comum) ──────────────────────────────────────────────────────────────────────

/** O que inativou o registro (quem, quando, a ação, o motivo e a versão nova, quando houver). */
/** A situação de um registro clínico: ativo, ou inativo pela retificação (nova versão) ou pelo estorno. */
/** Resposta das correções. */
export const esquemaResultadoCorrecao = z.object({
  ok: z.literal(true),
  id: z.number().int(),
  /** A versão nova (retificação, nova versão da meta), quando houver. */
  idNovo: z.number().int().nullable(),
  mensagem: z.string(),
});
export type ResultadoCorrecao = z.infer<typeof esquemaResultadoCorrecao>;

// ── Nutrição: triagem, meta e acompanhamento ─────────────────────────────────────────────────────

/** POST /api/nutricao/triagens/:id/retificar: a nova versão da triagem, pelo próprio autor, com a justificativa. */
export const esquemaRetificarTriagem = z
  .object({
    respostas: esquemaRespostasTriagem,
    pesoKg: z.number().positive().max(400).nullable().default(null),
    alturaCm: z.number().int().min(30).max(250).nullable().default(null),
    conduta: livre(500).optional(),
    motivo: esquemaJustificativaCorrecao,
  })
  .strict();
export type RetificarTriagemEntrada = z.infer<typeof esquemaRetificarTriagem>;

/** POST /api/nutricao/terapias/metas/:id/alterar: a nova versão da meta da EMTN (os dados todos, com o motivo). */
export const esquemaAlterarMetaTerapia = z
  .object({
    itemDieta: id.nullable(),
    pesoKg: z.number().positive().max(400),
    kcalPorKg: z.number().positive().max(60),
    proteinaGPorKg: z.number().positive().max(4),
    densidadeKcalMl: z.number().positive().max(3),
    proteinaGL: z.number().min(0).max(150),
    observacao: livre(500).optional(),
    motivo: esquemaJustificativaCorrecao,
  })
  .strict();
export type AlterarMetaTerapiaEntrada = z.infer<typeof esquemaAlterarMetaTerapia>;

/** POST /api/nutricao/terapias/acompanhamentos/:id/retificar: o volume informado à mão corrigido (nova versão). */
export const esquemaRetificarAcompanhamento = z
  .object({
    volumeInformadoMl: z.number().min(0).max(10_000),
    motivoMeta: z.enum(CODIGOS_MOTIVO_META).nullable().default(null),
    observacao: livre(500).optional(),
    motivo: esquemaJustificativaCorrecao,
  })
  .strict();
export type RetificarAcompanhamentoEntrada = z.infer<typeof esquemaRetificarAcompanhamento>;

/** De onde veio o volume do dia: a checagem da dieta (enteral), o balanço hídrico (parenteral) ou informado. */
/** A terapia da meta: ligada ao item de dieta prescrito ou informada na ficha EMTN (a NPT sem a ordem da CPOE). */
/** A situação da meta: vigente, substituída por uma versão nova ou encerrada. */
/**
 * De onde vem a NPT: a ficha EMTN (terapia informada) enquanto a ordem de NPT com composição não existe na prescrição;
 * 'cpoe' quando ela existir (troca por parâmetro; DP do pacote da CPOE).
 */
export const PARAMETRO_NPT_ORIGEM = 'nutricao.nptOrigem';
export const ORIGENS_NPT = ['ficha-emtn', 'cpoe'] as const;
export type OrigemNpt = (typeof ORIGENS_NPT)[number];
/** Quantos dias seguidos abaixo do adequado acendem o alerta de meta não atingida (padrão 3). */
export const PARAMETRO_ALERTA_META_DIAS = 'nutricao.alertaMetaDias';

// ── Avaliação farmacêutica da NPT (Portaria SVS/MS 272/1998) ─────────────────────────────────────

/** POST /api/nutricao/terapias/metas/:id/avaliacao-npt: a avaliação farmacêutica da formulação (uma por versão). */
export const esquemaAvaliarNpt = z
  .object({
    parecer: z.enum(CODIGOS_PARECER_NPT),
    acesso: z.enum(ACESSOS_NPT),
    /** Osmolaridade calculada da formulação (mOsm/L). */
    osmolaridade: z.number().positive().max(5_000),
    estabilidade: z.boolean(),
    compatibilidade: z.boolean(),
    observacao: livre(1000).optional(),
  })
  .strict();
export type AvaliarNptEntrada = z.infer<typeof esquemaAvaliarNpt>;

/** O percentual atingido por dia e o acumulado desde o início da meta (as parcelas para conferir a conta). */
/** O alerta de meta não atingida: os dias seguidos abaixo do adequado (padrão 3) até o último acompanhamento. */
/** O volume da parenteral lido do balanço hídrico por dia (os ganhos do grupo da NPT, sem os estornados). */
// ── Serviço social ───────────────────────────────────────────────────────────────────────────────

/** POST /api/servico-social/registros/:id/adendo: o complemento do registro (o original continua ativo). */
export const esquemaAdendoSocial = z
  .object({
    texto: livre(4000).pipe(z.string().min(5, 'Escreva o adendo (ao menos 5 caracteres).')),
    motivo: esquemaJustificativaCorrecao,
  })
  .strict();
export type AdendoSocialEntrada = z.infer<typeof esquemaAdendoSocial>;

// ── Oncologia ────────────────────────────────────────────────────────────────────────────────────

/** POST /api/especialidades/oncologia/protocolos/:id/revogar: revoga a versão (com ciclos, exige a ciência). */
export const esquemaRevogarVersaoProtocolo = z
  .object({
    motivo: esquemaJustificativaCorrecao,
    cienteDosCiclos: z.boolean().default(false),
    /**
     * Quantos ciclos em andamento a pessoa viu na lista ao dar a ciência: se houver mais agora (ou na transação), a
     * revogação recusa (409) e a lista é mostrada de novo.
     */
    ciclosVistos: z.number().int().min(0).optional(),
  })
  .strict();
export type RevogarVersaoProtocoloEntrada = z.infer<typeof esquemaRevogarVersaoProtocolo>;

/** Os ciclos que usam a versão (a contagem e a lista que a revogação mostra). */
export const esquemaCicloDependente = z.object({
  id: z.number().int(),
  paciente: z.number().int(),
  internacao: z.number().int(),
  numero: z.number().int(),
  curso: z.number().int(),
  dataPrevista: z.string(),
  situacao: z.enum(['prescrito', 'validado']),
  andamento: z.enum(ANDAMENTOS_CICLO),
});
export type CicloDependente = z.infer<typeof esquemaCicloDependente>;

export const esquemaDependenciasProtocolo = z.object({
  protocolo: z.number().int(),
  codigo: z.string(),
  versao: z.number().int(),
  /** Os ciclos em andamento (ativos ou suspensos) e o total de ciclos que referenciam a versão. */
  emAndamento: z.number().int(),
  total: z.number().int(),
  /** A lista vem cortada no teto (os mais recentes); as contagens são sempre as do banco. */
  cortada: z.boolean(),
  ciclos: z.array(esquemaCicloDependente),
});
export type DependenciasProtocolo = z.infer<typeof esquemaDependenciasProtocolo>;

/** POST /api/especialidades/oncologia/ciclos/:id/ajustar: o ajuste antes da validação (nova versão do ciclo). */
export const esquemaAjustarCiclo = z
  .object({
    dataPrevista: esquemaDataIso,
    reducaoPct: z.number().int().min(0).max(75),
    motivoReducao: livre(200).optional(),
    /** A justificativa clínica quando a data nova fica dentro do intervalo do protocolo (como na inclusão). */
    justificativaIntervalo: livre(200).optional(),
    motivo: esquemaJustificativaCorrecao,
  })
  .strict();
export type AjustarCicloEntrada = z.infer<typeof esquemaAjustarCiclo>;

/** POST /api/especialidades/oncologia/ciclos/:id/suspender | cancelar: o fato novo com a categoria e o motivo. */
export const esquemaInterromperCiclo = z
  .object({ categoria: z.enum(CODIGOS_CATEGORIA_CICLO), motivo: esquemaJustificativaCorrecao })
  .strict();
export type InterromperCicloEntrada = z.infer<typeof esquemaInterromperCiclo>;

// ── Lactário e acompanhante ──────────────────────────────────────────────────────────────────────

const esquemaHorario = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horário no formato HH:MM.');
const esquemaInstante = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Data e hora AAAA-MM-DDTHH:MM.');

/** POST /api/nutricao/lactario/ordens/:id/alterar: só antes da conferência (depois, 409 e só o cancelamento). */
export const esquemaAlterarOrdemLactario = z
  .object({
    formula: livre(60).pipe(z.string().min(3, 'Informe a fórmula.')),
    volumeMl: z.number().int().min(5).max(500),
    horarios: z.array(esquemaHorario).min(1).max(12),
    preparoEm: esquemaInstante,
    lote: livre(30).optional(),
    observacao: livre(200).optional(),
    /** Obrigatório como em toda ação de I/A/E (o log da alteração guarda até 200 letras). */
    motivo: esquemaJustificativaCorrecao,
  })
  .strict();
export type AlterarOrdemLactarioEntrada = z.infer<typeof esquemaAlterarOrdemLactario>;

/** POST /api/nutricao/acompanhantes/:id/alterar: a dieta, as refeições e o fim, sem encerrar o direito. */
export const esquemaAlterarDietaAcompanhante = z
  .object({
    dieta: livre(60).optional(),
    refeicoes: z.array(id).min(1).max(10),
    fim: esquemaDataIso.nullable().default(null),
    observacao: livre(200).optional(),
    motivo: livre(200).pipe(z.string().min(5, 'Diga o motivo da alteração (ao menos 5 caracteres).')),
  })
  .strict();
export type AlterarDietaAcompanhanteEntrada = z.infer<typeof esquemaAlterarDietaAcompanhante>;
