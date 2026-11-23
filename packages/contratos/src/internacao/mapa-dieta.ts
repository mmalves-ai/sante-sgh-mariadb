// Serviço de nutrição e dietética (M45, etapa 5; ficha, seções 4, 5, 7 e 8, regras 11 e 12; cap-06a §6.3): o mapa de
// dietas por unidade e refeição, gerado da última prescrição válida até o horário de corte de cada refeição (o corte é
// parâmetro por unidade); o jejum prescrito ou agendado (bloco cirúrgico e exames) prevalece sobre qualquer dieta; a
// alergia alimentar aparece no mapa e na etiqueta; a mudança depois do corte alerta a copa. O mapa fechado no corte é um
// RETRATO (nunca regravado). A etiqueta de bandeja leva dois identificadores (nome completo e nascimento), o leito, a
// dieta e as restrições, em ZPL. A refeição do acompanhante só com direito legal. Nenhum nome de tabela aqui.
import { z } from 'zod';
import { esquemaDataIso } from '../preco/entradas.js';
import { textoCp1252 } from '../texto-cp1252.js';
import { esquemaChaveLeito } from './adt.js';
import { idBanco } from '../validacao/id-banco.js';

const id = idBanco;
const livre = (max: number) => textoCp1252(max).overwrite((t) => t.replace(/\s+/g, ' ').trim());

/** O tipo de linha do mapa (pela dieta prescrita; o jejum prevalece). */
export const TIPOS_LINHA_MAPA = [
  { codigo: 'jejum', rotulo: 'Jejum' },
  { codigo: 'livre', rotulo: 'Dieta livre' },
  { codigo: 'oral', rotulo: 'Dieta oral' },
  { codigo: 'enteral', rotulo: 'Dieta enteral' },
  { codigo: 'parenteral', rotulo: 'Nutrição parenteral (sem bandeja)' },
  { codigo: 'sem-prescricao', rotulo: 'Sem dieta prescrita' },
] as const;
export type TipoLinhaMapa = (typeof TIPOS_LINHA_MAPA)[number]['codigo'];
export const CODIGOS_TIPO_LINHA_MAPA = TIPOS_LINHA_MAPA.map((t) => t.codigo) as [
  TipoLinhaMapa,
  ...TipoLinhaMapa[],
];

/** De onde vem o jejum (regra 11): a prescrição, a agenda do bloco cirúrgico ou a agenda de exames. */
export const ORIGENS_JEJUM = [
  { codigo: 'prescrito', rotulo: 'Jejum prescrito' },
  { codigo: 'cirurgia', rotulo: 'Jejum para cirurgia agendada' },
  { codigo: 'exame', rotulo: 'Jejum para exame agendado' },
] as const;
export type OrigemJejum = (typeof ORIGENS_JEJUM)[number]['codigo'];
export const CODIGOS_ORIGEM_JEJUM = ORIGENS_JEJUM.map((o) => o.codigo) as [OrigemJejum, ...OrigemJejum[]];

/**
 * Bases legais do acompanhante (cap-06a §6.3, "Controle de visitantes, acompanhantes e portaria"): a pessoa idosa
 * (Estatuto da Pessoa Idosa, Lei 10.741/2003, art. 16), a criança e o adolescente (ECA, Lei 8.069/1990, art. 12), a
 * parturiente (Lei 11.108/2005) e a pessoa com deficiência (Lei 13.146/2015, art. 22). Idade conferida pelo nascimento
 * do cadastro; a parturiente e a pessoa com deficiência são declaradas por quem registra.
 */
export const BASES_LEGAIS_ACOMPANHANTE = [
  {
    codigo: 'idoso',
    rotulo: 'Pessoa idosa (60 anos ou mais)',
    lei: 'Lei 10.741/2003, art. 16',
    idade: 'idoso',
  },
  {
    codigo: 'crianca-adolescente',
    rotulo: 'Criança ou adolescente (menos de 18 anos)',
    lei: 'Lei 8.069/1990, art. 12',
    idade: 'menor',
  },
  {
    codigo: 'parturiente',
    rotulo: 'Parturiente (trabalho de parto, parto e pós-parto)',
    lei: 'Lei 11.108/2005',
    idade: null,
  },
  {
    codigo: 'pessoa-deficiencia',
    rotulo: 'Pessoa com deficiência',
    lei: 'Lei 13.146/2015, art. 22',
    idade: null,
  },
] as const;
export type BaseLegalAcompanhante = (typeof BASES_LEGAIS_ACOMPANHANTE)[number]['codigo'];
export const CODIGOS_BASE_LEGAL = BASES_LEGAIS_ACOMPANHANTE.map((b) => b.codigo) as [
  BaseLegalAcompanhante,
  ...BaseLegalAcompanhante[],
];

/** Parâmetros do mapa (cap-06a §6.3; padrão de mercado, meta a propor). */
export const PARAMETRO_CORTES_REFEICAO = 'nutricao.cortesRefeicao';
export const PARAMETRO_CORTE_ANTECEDENCIA_MIN = 'nutricao.corteAntecedenciaMin';
export const PARAMETRO_JEJUM_CIRURGIA_HORAS = 'nutricao.jejumCirurgiaHoras';
export const PARAMETRO_JEJUM_EXAME_HORAS = 'nutricao.jejumExameHoras';
export const PARAMETRO_EXAMES_COM_JEJUM = 'nutricao.examesComJejum';
/** Até quantas horas depois do horário de servir o mapa ainda fecha (o retrato é do corte, não de dias depois). */
export const PARAMETRO_FECHAMENTO_TOLERANCIA_HORAS = 'nutricao.fechamentoToleranciaHoras';

export const esquemaRefeicao = z.object({
  codigo: z.number().int(),
  nome: z.string(),
  /** Horário de servir (HH:MM) e o corte (HH:MM) desta unidade. */
  horario: z.string(),
  corte: z.string(),
});
export type Refeicao = z.infer<typeof esquemaRefeicao>;

export const esquemaJejumLinha = z.object({
  origem: z.enum(CODIGOS_ORIGEM_JEJUM),
  /** O que motivou (o item prescrito, a cirurgia e a sala, o exame) e o horário do procedimento. */
  descricao: z.string(),
  procedimentoEm: z.string().nullable(),
});

export const esquemaCaracteristicaLinha = z.object({ nome: z.string(), resposta: z.string().nullable() });

export const esquemaAcompanhanteLinha = z.object({
  id: z.number().int(),
  baseLegal: z.enum(CODIGOS_BASE_LEGAL),
  refeicoes: z.array(z.number().int()),
  inicio: z.string(),
  fim: z.string().nullable(),
  /** De onde veio: o registro da refeição na nutrição ou o acompanhante registrado na portaria (todas as refeições). */
  origem: z.enum(['nutricao', 'portaria']).optional(),
});

export const esquemaLinhaMapa = z.object({
  internacao: z.number().int(),
  paciente: z.number().int(),
  nome: z.string(),
  nascimento: z.string().nullable(),
  prontuario: z.number().int(),
  leito: esquemaChaveLeito,
  tipo: z.enum(CODIGOS_TIPO_LINHA_MAPA),
  /** A dieta prescrita (nome do cadastro) mesmo quando o jejum prevalece; null sem prescrição. */
  dieta: z.string().nullable(),
  itemDieta: z.number().int().nullable(),
  item: z.number().int().nullable(),
  caracteristicas: z.array(esquemaCaracteristicaLinha),
  quantidade: z.string().nullable(),
  jejum: esquemaJejumLinha.nullable(),
  alergiasAlimentares: z.array(z.string()),
  acompanhante: esquemaAcompanhanteLinha.nullable(),
  prescritoEm: z.string().nullable(),
  /** A prescrição mudou depois do corte (alerta à copa). */
  mudouDepoisDoCorte: z.boolean(),
});
export type LinhaMapa = z.infer<typeof esquemaLinhaMapa>;

export const esquemaRetratoMapa = z.object({
  id: z.number().int(),
  em: z.string(),
  por: z.string(),
  corteEm: z.string(),
  itens: z.number().int(),
  jejuns: z.number().int(),
  hash: z.string(),
});
export type RetratoMapa = z.infer<typeof esquemaRetratoMapa>;

/** A diferença entre o retrato fechado e o que está prescrito agora (alerta à copa, regra 11). */
export const esquemaAlertaMapa = z.object({
  internacao: z.number().int(),
  nome: z.string(),
  leito: esquemaChaveLeito,
  antes: z.string(),
  agora: z.string(),
  prescritoEm: z.string().nullable(),
});
export type AlertaMapa = z.infer<typeof esquemaAlertaMapa>;

export const esquemaMapaDietas = z.object({
  unidade: z.string(),
  nomeUnidade: z.string(),
  data: z.string(),
  refeicao: esquemaRefeicao,
  corteEm: z.string(),
  /** Já passou do corte pelo relógio do banco (o fechamento é pedido). */
  passouDoCorte: z.boolean(),
  /** Até quando o retrato ainda fecha (o horário de servir mais a tolerância; depois, não é mais o do corte). */
  fechamentoAte: z.string(),
  linhas: z.array(esquemaLinhaMapa),
  contagens: z.record(z.enum(CODIGOS_TIPO_LINHA_MAPA), z.number().int()),
  acompanhantes: z.number().int(),
  retrato: esquemaRetratoMapa.nullable(),
  alertas: z.array(esquemaAlertaMapa),
  cortada: z.boolean(),
  lidoEm: z.string(),
});
export type MapaDietas = z.infer<typeof esquemaMapaDietas>;

export const esquemaOpcoesMapa = z.object({
  unidades: z.array(z.object({ unidade: z.string(), nome: z.string(), internados: z.number().int() })),
  refeicoes: z.array(esquemaRefeicao),
  hoje: z.string(),
  agora: z.string(),
});
export type OpcoesMapa = z.infer<typeof esquemaOpcoesMapa>;

/** POST /api/nutricao/mapa/fechar: fecha o retrato da refeição da unidade no dia (um só; nunca regravado). */
export const esquemaFecharMapa = z
  .object({
    unidade: livre(5).pipe(z.string().min(1)),
    refeicao: id,
    data: esquemaDataIso,
    /** O hash do mapa que a pessoa viu (o retrato fecha exatamente o que estava na tela). */
    hashVisto: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();
export type FecharMapaEntrada = z.infer<typeof esquemaFecharMapa>;

/** POST /api/nutricao/mapa/etiquetas: as etiquetas de bandeja da refeição (todas ou as escolhidas). */
export const esquemaEtiquetasBandeja = z
  .object({
    unidade: livre(5).pipe(z.string().min(1)),
    refeicao: id,
    data: esquemaDataIso,
    internacoes: z.array(id).max(300).default([]),
  })
  .strict();
export type EtiquetasBandejaEntrada = z.infer<typeof esquemaEtiquetasBandeja>;

export const esquemaEtiquetasGeradas = z.object({
  formato: z.literal('zpl'),
  conteudo: z.string(),
  nomeArquivo: z.string(),
  etiquetas: z.number().int(),
  /** Linhas sem bandeja (jejum, parenteral, sem dieta) e as sem os dois identificadores (sem nascimento): não saem. */
  semBandeja: z.number().int(),
  semIdentificador: z.number().int(),
  fila: z.object({ id: z.string(), novo: z.boolean() }).nullable(),
});
export type EtiquetasGeradas = z.infer<typeof esquemaEtiquetasGeradas>;

/** POST /api/nutricao/acompanhantes: a refeição do acompanhante com direito legal. */
export const esquemaRegistrarDietaAcompanhante = z
  .object({
    internacao: id,
    baseLegal: z.enum(CODIGOS_BASE_LEGAL),
    refeicoes: z.array(id).min(1).max(10),
    inicio: esquemaDataIso,
    fim: esquemaDataIso.nullable().default(null),
    observacao: livre(200).optional(),
  })
  .strict()
  .refine((x) => x.fim === null || x.fim >= x.inicio, {
    message: 'O fim não pode ser antes do início.',
    path: ['fim'],
  });
export type RegistrarDietaAcompanhanteEntrada = z.infer<typeof esquemaRegistrarDietaAcompanhante>;

export const esquemaEncerrarDietaAcompanhante = z
  .object({
    motivo: livre(200).pipe(z.string().min(5, 'Diga o motivo do encerramento (ao menos 5 caracteres).')),
  })
  .strict();

export const esquemaResultadoMapa = z.object({
  ok: z.literal(true),
  id: z.number().int(),
  mensagem: z.string(),
});
export type ResultadoMapa = z.infer<typeof esquemaResultadoMapa>;
