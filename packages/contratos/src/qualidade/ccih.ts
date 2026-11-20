// CCIH, etapa 3 do M48 (ficha, seções 4 a 8, regras 5, 6, 7 e 11; cap-05b §5.11, "CCIH", "Antimicrobiano",
// "Isolamento", "Denominadores"; manual m17 "CCIH: vigilância das infecções", "Como registrar uma infecção relacionada
// à assistência", "Como liberar um antimicrobiano restrito" e "Isolamento e precauções no mapa de leitos"):
//   - vigilância ativa dos internados (dispositivos invasivos, antimicrobiano em uso, culturas, febre, pós-operatório);
//   - dispositivo invasivo (CVC, sonda vesical, tubo e ventilação mecânica) com inserção e retirada: o denominador
//     dispositivo-dia sai daqui e do censo diário, nunca de digitação paralela (regra 5);
//   - ficha de IRAS por sítio com os critérios diagnósticos da Anvisa;
//   - liberação do antimicrobiano restrito no prazo da política, revisão no 3º e no 7º dia, DDD e DOT (regra 6);
//   - precaução por multirresistente refletida no mapa de leitos (regra 7);
//   - higiene das mãos (os 5 momentos da OMS) e surtos.
// Tudo fica em SGH_QUA_* (só SGH_; o leito também em SGH_INT_LEITO_ESTADO do M21): o outro sistema não tem ficha de
// IRAS, a validação de antimicrobiano dele está desligada (72 pedidos antigos, só leitura) e o isolamento dele está
// vazio (não usado sem estudo). Perfil da cópia pc (só agregados, 2026-10-26): 24 internados; 59 itens marcados como
// antimicrobiano no cadastro de produtos; 18 exames de cultura no cadastro, 2.938 pedidos de cultura em 2026 (2.489
// com resultado liberado); o censo diário do novo ainda vazio na cópia. Nenhum nome de tabela do outro sistema sai daqui
// para a tela (ADR 0023).
import { z } from 'zod';
import { CODIGOS_PRECAUCAO, type Precaucao } from '../internacao/adt.js';
import { textoCp1252 } from '../texto-cp1252.js';

// ── Vocabulário ──────────────────────────────────────────────────────────────────────────────────────

/** Dispositivos invasivos com denominador próprio (Anvisa, indicadores nacionais de IRAS; NHSN). PICC conta como CVC. */
export const TIPOS_DISPOSITIVO_INVASIVO = [
  { codigo: 'cvc', rotulo: 'Cateter venoso central', sigla: 'CVC' },
  { codigo: 'sondaVesical', rotulo: 'Sonda vesical de demora', sigla: 'SVD' },
  { codigo: 'ventilacaoMecanica', rotulo: 'Tubo e ventilação mecânica', sigla: 'VM' },
] as const;
export type TipoDispositivoInvasivo = (typeof TIPOS_DISPOSITIVO_INVASIVO)[number]['codigo'];
export const CODIGOS_DISPOSITIVO_INVASIVO = TIPOS_DISPOSITIVO_INVASIVO.map((t) => t.codigo) as [
  TipoDispositivoInvasivo,
  ...TipoDispositivoInvasivo[],
];

/** Motivo da retirada. `acidental` (inclui a extubação não planejada) gera a sugestão de notificação ao NSP. */
export const MOTIVOS_RETIRADA_DISPOSITIVO = [
  { codigo: 'eletiva', rotulo: 'Retirada eletiva (sem indicação)' },
  { codigo: 'acidental', rotulo: 'Retirada acidental ou não planejada' },
  { codigo: 'troca', rotulo: 'Troca do dispositivo' },
  { codigo: 'alta', rotulo: 'Alta ou transferência' },
  { codigo: 'obito', rotulo: 'Óbito' },
] as const;
export type MotivoRetiradaDispositivo = (typeof MOTIVOS_RETIRADA_DISPOSITIVO)[number]['codigo'];
export const CODIGOS_MOTIVO_RETIRADA = MOTIVOS_RETIRADA_DISPOSITIVO.map((m) => m.codigo) as [
  MotivoRetiradaDispositivo,
  ...MotivoRetiradaDispositivo[],
];

/**
 * Sítios de IRAS (Anvisa, Critérios diagnósticos de IRAS). `dispositivo`: o dispositivo cuja associação a ficha
 * confere (mais de 2 dias de uso no dia do evento); `cirurgia`: ISC, com a janela de 30 dias (90 com implante).
 */
export const SITIOS_IRAS = [
  { codigo: 'ipcs', rotulo: 'Infecção primária da corrente sanguínea', dispositivo: 'cvc' },
  { codigo: 'pav', rotulo: 'Pneumonia associada à ventilação mecânica', dispositivo: 'ventilacaoMecanica' },
  { codigo: 'itu', rotulo: 'Infecção do trato urinário', dispositivo: 'sondaVesical' },
  { codigo: 'isc', rotulo: 'Infecção de sítio cirúrgico', dispositivo: null },
  { codigo: 'pneumonia', rotulo: 'Pneumonia não associada à ventilação', dispositivo: null },
  { codigo: 'outra', rotulo: 'Outra IRAS', dispositivo: null },
] as const;
export type SitioIras = (typeof SITIOS_IRAS)[number]['codigo'];
export const CODIGOS_SITIO_IRAS = SITIOS_IRAS.map((s) => s.codigo) as [SitioIras, ...SitioIras[]];

/**
 * Critérios marcados na ficha (os grupos e o mínimo de cada sítio estão nas regras puras de @sgh/dominio-qualidade).
 * Rótulos curtos dos critérios da Anvisa; o detalhe fica no manual m17.
 */
export const CRITERIOS_IRAS = [
  { codigo: 'hemoculturaPatogeno', rotulo: 'Patógeno reconhecido em hemocultura' },
  { codigo: 'comensalDuasAmostras', rotulo: 'Comensal da pele em duas ou mais hemoculturas' },
  { codigo: 'febre', rotulo: 'Febre (temperatura maior que 38 °C)' },
  { codigo: 'calafrios', rotulo: 'Calafrios' },
  { codigo: 'hipotensao', rotulo: 'Hipotensão' },
  { codigo: 'imagemPulmonar', rotulo: 'Imagem pulmonar com infiltrado novo ou progressivo' },
  { codigo: 'leucopeniaLeucocitose', rotulo: 'Leucopenia ou leucocitose' },
  { codigo: 'alteracaoMental', rotulo: 'Alteração do nível de consciência (idoso)' },
  { codigo: 'secrecaoPurulenta', rotulo: 'Secreção purulenta ou mudança da secreção' },
  { codigo: 'tosseDispneia', rotulo: 'Tosse, dispneia ou taquipneia' },
  { codigo: 'estertores', rotulo: 'Estertores ou sons brônquicos' },
  { codigo: 'pioraTrocaGasosa', rotulo: 'Piora da troca gasosa' },
  { codigo: 'uroculturaPositiva', rotulo: 'Urocultura positiva (até duas espécies)' },
  { codigo: 'dorSuprapubica', rotulo: 'Dor suprapúbica' },
  { codigo: 'dorLombar', rotulo: 'Dor lombar ou no ângulo costovertebral' },
  { codigo: 'disuriaUrgencia', rotulo: 'Disúria, urgência ou polaciúria (sem sonda)' },
  { codigo: 'drenagemPurulenta', rotulo: 'Drenagem purulenta da incisão ou do órgão' },
  { codigo: 'culturaSitio', rotulo: 'Cultura positiva do sítio cirúrgico' },
  { codigo: 'deiscenciaComSinal', rotulo: 'Deiscência ou abertura com sinal de infecção' },
  { codigo: 'abscessoImagem', rotulo: 'Abscesso visto em exame de imagem ou reoperação' },
  { codigo: 'diagnosticoMedico', rotulo: 'Diagnóstico do médico assistente ou da CCIH' },
] as const;
export type CriterioIras = (typeof CRITERIOS_IRAS)[number]['codigo'];
export const CODIGOS_CRITERIO_IRAS = CRITERIOS_IRAS.map((c) => c.codigo) as [CriterioIras, ...CriterioIras[]];

/** Profundidade da ISC (Anvisa). */
export const NIVEIS_ISC = [
  { codigo: 'superficial', rotulo: 'Incisional superficial' },
  { codigo: 'profunda', rotulo: 'Incisional profunda' },
  { codigo: 'orgaoCavidade', rotulo: 'Órgão ou cavidade' },
] as const;
export type NivelIsc = (typeof NIVEIS_ISC)[number]['codigo'];
export const CODIGOS_NIVEL_ISC = NIVEIS_ISC.map((n) => n.codigo) as [NivelIsc, ...NivelIsc[]];

/** Situação da ficha de IRAS: a CCIH confirma ao registrar; descarta (com motivo) quando revê. */
export const SITUACOES_IRAS = ['confirmada', 'descartada'] as const;
export type SituacaoIras = (typeof SITUACOES_IRAS)[number];

/**
 * Motivo da precaução (cap-05b §5.11, Isolamento): o tipo sugerido e se é multirresistente (a precaução por
 * multirresistente vinda da microbiologia aparece no cabeçalho, no mapa e na higienização; regra 7).
 */
export const MOTIVOS_PRECAUCAO = [
  { codigo: 'kpc', rotulo: 'Enterobactéria produtora de carbapenemase (KPC)', tipo: 'contato', mr: true },
  {
    codigo: 'mrsa',
    rotulo: 'Staphylococcus aureus resistente à meticilina (MRSA)',
    tipo: 'contato',
    mr: true,
  },
  { codigo: 'vre', rotulo: 'Enterococo resistente à vancomicina (VRE)', tipo: 'contato', mr: true },
  { codigo: 'acinetobacter', rotulo: 'Acinetobacter multirresistente', tipo: 'contato', mr: true },
  { codigo: 'outroMultirresistente', rotulo: 'Outro multirresistente', tipo: 'contato', mr: true },
  { codigo: 'clostridioides', rotulo: 'Clostridioides difficile', tipo: 'contato', mr: false },
  { codigo: 'tuberculose', rotulo: 'Tuberculose pulmonar ou laríngea', tipo: 'aerossois', mr: false },
  {
    codigo: 'varicelaSarampo',
    rotulo: 'Varicela, herpes-zóster disseminado ou sarampo',
    tipo: 'aerossois',
    mr: false,
  },
  { codigo: 'influenza', rotulo: 'Influenza e outros vírus respiratórios', tipo: 'goticulas', mr: false },
  { codigo: 'meningite', rotulo: 'Meningite ou doença meningocócica', tipo: 'goticulas', mr: false },
  { codigo: 'outro', rotulo: 'Outro motivo', tipo: 'contato', mr: false },
] as const satisfies readonly { codigo: string; rotulo: string; tipo: Precaucao; mr: boolean }[];
export type MotivoPrecaucao = (typeof MOTIVOS_PRECAUCAO)[number]['codigo'];
export const CODIGOS_MOTIVO_PRECAUCAO = MOTIVOS_PRECAUCAO.map((m) => m.codigo) as [
  MotivoPrecaucao,
  ...MotivoPrecaucao[],
];

/** De onde veio a precaução: a CCIH ou o assistente (manual) ou a cultura da microbiologia (o exame fica ligado). */
export const ORIGENS_PRECAUCAO = ['manual', 'microbiologia'] as const;
export type OrigemPrecaucao = (typeof ORIGENS_PRECAUCAO)[number];

export const MOTIVOS_FIM_PRECAUCAO = [
  { codigo: 'culturasNegativas', rotulo: 'Culturas de controle negativas' },
  { codigo: 'fimDoPeriodo', rotulo: 'Fim do período de transmissibilidade' },
  { codigo: 'reavaliacao', rotulo: 'Reavaliação da CCIH' },
  { codigo: 'alta', rotulo: 'Alta ou transferência' },
  { codigo: 'obito', rotulo: 'Óbito' },
] as const;
export type MotivoFimPrecaucao = (typeof MOTIVOS_FIM_PRECAUCAO)[number]['codigo'];
export const CODIGOS_MOTIVO_FIM_PRECAUCAO = MOTIVOS_FIM_PRECAUCAO.map((m) => m.codigo) as [
  MotivoFimPrecaucao,
  ...MotivoFimPrecaucao[],
];

/** Decisão da CCIH sobre o antimicrobiano restrito (o sistema nunca suspende sozinho: regra 6). */
export const DECISOES_ANTIMICROBIANO = [
  { codigo: 'liberado', rotulo: 'Liberado' },
  { codigo: 'liberadoComAjuste', rotulo: 'Liberado com ajuste' },
  { codigo: 'naoLiberado', rotulo: 'Não liberado (orientação ao prescritor)' },
] as const;
export type DecisaoAntimicrobiano = (typeof DECISOES_ANTIMICROBIANO)[number]['codigo'];
export const CODIGOS_DECISAO_ANTIMICROBIANO = DECISOES_ANTIMICROBIANO.map((d) => d.codigo) as [
  DecisaoAntimicrobiano,
  ...DecisaoAntimicrobiano[],
];

/** Revisões da terapia (3º e 7º dia, contados do início do tratamento como dia 1). */
export const MARCOS_REVISAO_ANTIMICROBIANO = [
  { codigo: 'd3', rotulo: 'Revisão do 3º dia', dia: 3 },
  { codigo: 'd7', rotulo: 'Revisão do 7º dia', dia: 7 },
] as const;
export type MarcoRevisaoAntimicrobiano = (typeof MARCOS_REVISAO_ANTIMICROBIANO)[number]['codigo'];

export const CONDUTAS_REVISAO_ANTIMICROBIANO = [
  { codigo: 'manter', rotulo: 'Manter' },
  { codigo: 'descalonar', rotulo: 'Descalonar (espectro menor pela cultura)' },
  { codigo: 'escalonar', rotulo: 'Escalonar' },
  { codigo: 'ajustarDose', rotulo: 'Ajustar dose ou intervalo' },
  { codigo: 'trocarVia', rotulo: 'Trocar para via oral' },
  { codigo: 'suspender', rotulo: 'Recomendar a suspensão' },
] as const;
export type CondutaRevisaoAntimicrobiano = (typeof CONDUTAS_REVISAO_ANTIMICROBIANO)[number]['codigo'];
export const CODIGOS_CONDUTA_REVISAO = CONDUTAS_REVISAO_ANTIMICROBIANO.map((c) => c.codigo) as [
  CondutaRevisaoAntimicrobiano,
  ...CondutaRevisaoAntimicrobiano[],
];

/** Situação do antimicrobiano restrito prescrito, para a fila da CCIH e o alerta (regra 6). */
export const SITUACOES_LIBERACAO_ANTIMICROBIANO = [
  { codigo: 'aguardando', rotulo: 'Aguardando a CCIH' },
  { codigo: 'vencida', rotulo: 'Sem liberação no prazo' },
  { codigo: 'liberado', rotulo: 'Liberado' },
  { codigo: 'naoLiberado', rotulo: 'Não liberado' },
] as const;
export type SituacaoLiberacaoAntimicrobiano = (typeof SITUACOES_LIBERACAO_ANTIMICROBIANO)[number]['codigo'];

/** Prazo da política de liberação (24 a 48 h; ficha, regra 6); o padrão é 48 h até a CCIH definir. */
export const PRAZO_LIBERACAO_HORAS = { minimo: 24, maximo: 48, padrao: 48 } as const;

/** Os 5 momentos da higiene das mãos (OMS). */
export const MOMENTOS_HIGIENE_MAOS = [
  { codigo: 'antesContato', rotulo: '1. Antes de tocar o paciente' },
  { codigo: 'antesAsseptico', rotulo: '2. Antes de procedimento limpo ou asséptico' },
  { codigo: 'aposFluidos', rotulo: '3. Após risco de exposição a fluidos corporais' },
  { codigo: 'aposContato', rotulo: '4. Após tocar o paciente' },
  { codigo: 'aposAmbiente', rotulo: '5. Após tocar superfícies próximas ao paciente' },
] as const;
export type MomentoHigieneMaos = (typeof MOMENTOS_HIGIENE_MAOS)[number]['codigo'];
export const CODIGOS_MOMENTO_HIGIENE = MOMENTOS_HIGIENE_MAOS.map((m) => m.codigo) as [
  MomentoHigieneMaos,
  ...MomentoHigieneMaos[],
];

export const ACOES_HIGIENE_MAOS = [
  { codigo: 'friccao', rotulo: 'Fricção com preparação alcoólica', conforme: true },
  { codigo: 'lavagem', rotulo: 'Lavagem com água e sabonete', conforme: true },
  { codigo: 'naoRealizada', rotulo: 'Não realizada', conforme: false },
] as const;
export type AcaoHigieneMaos = (typeof ACOES_HIGIENE_MAOS)[number]['codigo'];
export const CODIGOS_ACAO_HIGIENE = ACOES_HIGIENE_MAOS.map((a) => a.codigo) as [
  AcaoHigieneMaos,
  ...AcaoHigieneMaos[],
];

export const CATEGORIAS_OBSERVADAS = [
  { codigo: 'medico', rotulo: 'Médico' },
  { codigo: 'enfermeiro', rotulo: 'Enfermeiro' },
  { codigo: 'tecnicoEnfermagem', rotulo: 'Técnico ou auxiliar de enfermagem' },
  { codigo: 'fisioterapeuta', rotulo: 'Fisioterapeuta' },
  { codigo: 'outro', rotulo: 'Outro profissional' },
] as const;
export type CategoriaObservada = (typeof CATEGORIAS_OBSERVADAS)[number]['codigo'];
export const CODIGOS_CATEGORIA_OBSERVADA = CATEGORIAS_OBSERVADAS.map((c) => c.codigo) as [
  CategoriaObservada,
  ...CategoriaObservada[],
];

export const SITUACOES_SURTO = [
  { codigo: 'investigacao', rotulo: 'Em investigação' },
  { codigo: 'controle', rotulo: 'Em controle' },
  { codigo: 'encerrado', rotulo: 'Encerrado' },
] as const;
export type SituacaoSurto = (typeof SITUACOES_SURTO)[number]['codigo'];
export const CODIGOS_SITUACAO_SURTO = SITUACOES_SURTO.map((s) => s.codigo) as [
  SituacaoSurto,
  ...SituacaoSurto[],
];

/** Motivos de um paciente estar na vigilância ativa (a fila da CCIH e o cartão da página inicial). */
export const MOTIVOS_VIGILANCIA = [
  { codigo: 'dispositivo', rotulo: 'Dispositivo invasivo', peso: 3 },
  { codigo: 'antimicrobianoSemLiberacao', rotulo: 'Antimicrobiano restrito sem liberação', peso: 4 },
  { codigo: 'antimicrobiano', rotulo: 'Antimicrobiano em uso', peso: 2 },
  { codigo: 'revisaoAntimicrobiano', rotulo: 'Revisão do antimicrobiano devida', peso: 2 },
  { codigo: 'cultura', rotulo: 'Cultura recente', peso: 2 },
  { codigo: 'febre', rotulo: 'Febre nas últimas 48 horas', peso: 3 },
  { codigo: 'posOperatorio', rotulo: 'Pós-operatório (até 30 dias)', peso: 1 },
  { codigo: 'precaucao', rotulo: 'Em precaução', peso: 1 },
  { codigo: 'iras', rotulo: 'IRAS registrada nesta internação', peso: 1 },
] as const;
export type MotivoVigilancia = (typeof MOTIVOS_VIGILANCIA)[number]['codigo'];

const rotuloDe =
  <T extends { readonly codigo: string; readonly rotulo: string }>(lista: readonly T[]) =>
  (c: T['codigo']): string =>
    lista.find((x) => x.codigo === c)?.rotulo ?? c;
export const rotuloDispositivoInvasivo = rotuloDe(TIPOS_DISPOSITIVO_INVASIVO);
export const rotuloSitioIras = rotuloDe(SITIOS_IRAS);
export const rotuloCriterioIras = rotuloDe(CRITERIOS_IRAS);
export const rotuloMotivoPrecaucao = rotuloDe(MOTIVOS_PRECAUCAO);
export const rotuloMotivoVigilancia = rotuloDe(MOTIVOS_VIGILANCIA);
export const rotuloSituacaoLiberacaoAntimicrobiano = rotuloDe(SITUACOES_LIBERACAO_ANTIMICROBIANO);
export const rotuloMomentoHigiene = rotuloDe(MOMENTOS_HIGIENE_MAOS);

/** O tipo de precaução sugerido para o motivo (a CCIH pode trocar). */
export function tipoSugeridoDaPrecaucao(m: MotivoPrecaucao): Precaucao {
  return MOTIVOS_PRECAUCAO.find((x) => x.codigo === m)?.tipo ?? 'contato';
}
export function motivoMultirresistente(m: MotivoPrecaucao): boolean {
  return MOTIVOS_PRECAUCAO.find((x) => x.codigo === m)?.mr ?? false;
}

// ── Entradas ────────────────────────────────────────────────────────────────────────────────────────────

const id = z.number().int().positive();
/** O pedido de exame (o ID do outro sistema é DOUBLE PRECISION, sempre inteiro). */
const idExame = z.number().int().positive().max(999_999_999_999_999);
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
/** Competência `AAAA-MM`. */
export const esquemaCompetenciaCcih = z
  .string()
  .regex(/^(20\d{2})-(0[1-9]|1[0-2])$/, 'Competência no formato AAAA-MM.');
/** Setor de internação (o bloco do mapa de leitos). */
const setor = z
  .string()
  .trim()
  .min(1)
  .max(5)
  .regex(/^[A-Za-z0-9 ._-]+$/);
const observacao = textoCp1252(200).nullable();
const justificativa = textoCp1252(500).pipe(z.string().trim().min(10));

/** `qualidade.registrarDispositivo`: a inserção (ou o dispositivo já em uso na admissão) de um internado. */
export const esquemaRegistrarDispositivo = z.object({
  internacao: id,
  tipo: z.enum(CODIGOS_DISPOSITIVO_INVASIVO),
  sitio: textoCp1252(40).nullable(),
  inseridoEm: instanteLocal,
  /** O item da prescrição que pediu o dispositivo (ventilação, cateter), quando houver. */
  itemPrescricao: id.nullable(),
  observacao,
  /** Revisão do W0-04: o registro do profissional responsável pela inserção (quem passou o cateter), quando houver. */
  responsavel: id.nullable().optional(),
});
export type RegistrarDispositivoEntrada = z.infer<typeof esquemaRegistrarDispositivo>;

/** `qualidade.retirarDispositivo`. */
export const esquemaRetirarDispositivo = z.object({
  dispositivo: id,
  versao,
  retiradoEm: instanteLocal,
  motivo: z.enum(CODIGOS_MOTIVO_RETIRADA),
  observacao,
});
export type RetirarDispositivoEntrada = z.infer<typeof esquemaRetirarDispositivo>;

/** `qualidade.registrarIras`: a ficha por sítio com os critérios marcados (conferidos pelas regras puras). */
export const esquemaRegistrarIras = z
  .object({
    internacao: id,
    sitio: z.enum(CODIGOS_SITIO_IRAS),
    dataInfeccao: data,
    criterios: z.array(z.enum(CODIGOS_CRITERIO_IRAS)).min(1).max(CODIGOS_CRITERIO_IRAS.length),
    nivelIsc: z.enum(CODIGOS_NIVEL_ISC).nullable(),
    /** A cirurgia da ISC (do bloco cirúrgico). */
    cirurgia: id.nullable(),
    implante: z.boolean(),
    exame: idExame.nullable(),
    microrganismo: textoCp1252(80).nullable(),
    multirresistente: z.boolean(),
    descricao: textoCp1252(1000).nullable(),
  })
  .refine((e) => e.sitio !== 'isc' || (e.cirurgia !== null && e.nivelIsc !== null), {
    message: 'Na infecção de sítio cirúrgico informe a cirurgia e a profundidade.',
    path: ['cirurgia'],
  })
  .refine((e) => e.sitio === 'isc' || (e.nivelIsc === null && e.cirurgia === null && !e.implante), {
    message: 'Cirurgia, profundidade e implante são só da infecção de sítio cirúrgico.',
    path: ['nivelIsc'],
  })
  .refine((e) => e.sitio !== 'outra' || (e.descricao !== null && e.descricao.trim().length >= 10), {
    message: 'Descreva a infecção.',
    path: ['descricao'],
  })
  .refine((e) => !e.multirresistente || e.microrganismo !== null, {
    message: 'Informe o microrganismo multirresistente.',
    path: ['microrganismo'],
  });
export type RegistrarIrasEntrada = z.infer<typeof esquemaRegistrarIras>;

export const esquemaDescartarIras = z.object({ iras: id, versao, justificativa });
export type DescartarIrasEntrada = z.infer<typeof esquemaDescartarIras>;

/** `qualidade.configurarAntimicrobiano`: a política (restrito ou não) e a DDD do item do cadastro de produtos. */
export const esquemaConfigurarAntimicrobiano = z
  .object({
    item: id,
    restrito: z.boolean(),
    /** Código ATC (grupo J01 a J05 e afins). */
    atc: z
      .string()
      .trim()
      .regex(/^[A-Z]\d{2}[A-Z]{0,2}\d{0,2}$/)
      .nullable(),
    /** DDD da OMS em gramas (ex.: ceftriaxona 2 g). */
    dddGramas: z.number().positive().max(1000).nullable(),
    /** Gramas do princípio ativo por unidade dispensada (ex.: frasco de 1 g = 1). */
    gramasPorUnidade: z.number().positive().max(1000).nullable(),
  })
  .refine((e) => (e.dddGramas === null) === (e.gramasPorUnidade === null), {
    message: 'Para calcular a DDD informe a DDD e as gramas por unidade (ou nenhuma das duas).',
    path: ['gramasPorUnidade'],
  });
export type ConfigurarAntimicrobianoEntrada = z.infer<typeof esquemaConfigurarAntimicrobiano>;

/** `qualidade.liberarAntimicrobiano`: a decisão da CCIH sobre o item restrito prescrito. */
export const esquemaLiberarAntimicrobiano = z
  .object({
    itemPrescricao: id,
    decisao: z.enum(CODIGOS_DECISAO_ANTIMICROBIANO),
    diasAutorizados: z.number().int().min(1).max(60).nullable(),
    justificativa: textoCp1252(500).nullable(),
  })
  .refine((e) => e.decisao === 'naoLiberado' || e.diasAutorizados !== null, {
    message: 'Informe por quantos dias o antimicrobiano está liberado.',
    path: ['diasAutorizados'],
  })
  .refine((e) => e.decisao !== 'naoLiberado' || e.diasAutorizados === null, {
    message: 'Antimicrobiano não liberado não tem dias autorizados.',
    path: ['diasAutorizados'],
  })
  .refine(
    (e) => e.decisao === 'liberado' || (e.justificativa !== null && e.justificativa.trim().length >= 10),
    {
      message: 'Escreva a orientação ao prescritor (pelo menos 10 caracteres).',
      path: ['justificativa'],
    },
  );
export type LiberarAntimicrobianoEntrada = z.infer<typeof esquemaLiberarAntimicrobiano>;

/** `qualidade.revisarAntimicrobiano`: a revisão do 3º ou do 7º dia. */
export const esquemaRevisarAntimicrobiano = z.object({
  liberacao: id,
  versao,
  marco: z.enum(['d3', 'd7']),
  conduta: z.enum(CODIGOS_CONDUTA_REVISAO),
  observacao,
});
export type RevisarAntimicrobianoEntrada = z.infer<typeof esquemaRevisarAntimicrobiano>;

/** `qualidade.definirPrecaucao`: a precaução do internado, que abre o estado do leito no mapa (M21). */
export const esquemaDefinirPrecaucao = z
  .object({
    internacao: id,
    motivo: z.enum(CODIGOS_MOTIVO_PRECAUCAO),
    motivoOutro: textoCp1252(60).nullable(),
    tipo: z.enum(CODIGOS_PRECAUCAO),
    origem: z.enum(ORIGENS_PRECAUCAO),
    exame: idExame.nullable(),
    /** Bloquear os outros leitos da acomodação (exigido para aerossóis em quarto compartilhado). */
    bloquearVizinhos: z.boolean(),
    observacao,
  })
  .refine((e) => e.motivo !== 'outro' || (e.motivoOutro !== null && e.motivoOutro.trim().length >= 3), {
    message: 'Descreva o motivo da precaução.',
    path: ['motivoOutro'],
  })
  .refine((e) => e.origem !== 'microbiologia' || e.exame !== null, {
    message: 'Na precaução vinda da microbiologia escolha a cultura.',
    path: ['exame'],
  });
export type DefinirPrecaucaoEntrada = z.infer<typeof esquemaDefinirPrecaucao>;

export const esquemaEncerrarPrecaucao = z.object({
  precaucao: id,
  versao,
  motivo: z.enum(CODIGOS_MOTIVO_FIM_PRECAUCAO),
  observacao,
});
export type EncerrarPrecaucaoEntrada = z.infer<typeof esquemaEncerrarPrecaucao>;

/** Uma oportunidade observada (OMS): o momento e o que o profissional fez. */
export const esquemaOportunidadeHigiene = z.object({
  momento: z.enum(CODIGOS_MOMENTO_HIGIENE),
  acao: z.enum(CODIGOS_ACAO_HIGIENE),
  luvas: z.boolean(),
});

/** `qualidade.registrarObservacaoMaos`: uma sessão de observação (tablet), sem identificar quem foi observado. */
export const esquemaRegistrarObservacaoMaos = z.object({
  unidade: z.number().int().min(0).max(32767),
  setor: setor.nullable(),
  observadoEm: instanteLocal,
  categoria: z.enum(CODIGOS_CATEGORIA_OBSERVADA),
  oportunidades: z.array(esquemaOportunidadeHigiene).min(1).max(50),
  observacao,
});
export type RegistrarObservacaoMaosEntrada = z.infer<typeof esquemaRegistrarObservacaoMaos>;

/** O consumo de preparação alcoólica do setor na competência (em mL; uma linha por setor e competência). */
export const esquemaRegistrarConsumoAlcool = z.object({
  unidade: z.number().int().min(0).max(32767),
  setor: setor.nullable(),
  competencia: esquemaCompetenciaCcih,
  mililitros: z.number().int().min(0).max(100_000_000),
});
export type RegistrarConsumoAlcoolEntrada = z.infer<typeof esquemaRegistrarConsumoAlcool>;

/** `qualidade.registrarSurto`: abertura do surto. */
export const esquemaRegistrarSurto = z.object({
  titulo: textoCp1252(80).pipe(z.string().trim().min(5)),
  /** O tipo do cadastro de tipos de surto (domínio do outro sistema, só leitura). */
  tipoSurto: z.number().int().positive().max(32767).nullable(),
  agente: textoCp1252(80).nullable(),
  unidade: z.number().int().min(0).max(32767),
  setor: setor.nullable(),
  inicio: data,
  casos: z.number().int().min(1).max(10_000),
  medidas: textoCp1252(2000).nullable(),
});
export type RegistrarSurtoEntrada = z.infer<typeof esquemaRegistrarSurto>;

/** Atualização do surto (casos, medidas, situação; encerrar exige a data e o resumo). */
export const esquemaAtualizarSurto = z
  .object({
    surto: id,
    versao,
    situacao: z.enum(CODIGOS_SITUACAO_SURTO),
    casos: z.number().int().min(1).max(10_000),
    medidas: textoCp1252(2000).nullable(),
    encerradoEm: data.nullable(),
  })
  .refine((e) => (e.situacao === 'encerrado') === (e.encerradoEm !== null), {
    message: 'Ao encerrar o surto informe a data do encerramento (e só ao encerrar).',
    path: ['encerradoEm'],
  });
export type AtualizarSurtoEntrada = z.infer<typeof esquemaAtualizarSurto>;

/** Filtros das leituras por competência. */
export const esquemaFiltroCompetencia = z.object({
  competencia: esquemaCompetenciaCcih,
  setor: setor.optional(),
});

// ── Respostas (o que a API devolve; a tela confere com zod no módulo web) ────────────────────────────────

export interface DispositivoInvasivoLido {
  readonly id: number;
  readonly internacao: number;
  readonly tipo: TipoDispositivoInvasivo;
  readonly sitio: string | null;
  readonly setor: string;
  readonly inseridoEm: string;
  readonly retiradoEm: string | null;
  readonly motivoRetirada: MotivoRetiradaDispositivo | null;
  readonly itemPrescricao: number | null;
  /** Revisão do W0-04: o profissional responsável pela inserção. */
  readonly responsavel?: { readonly registro: number; readonly nome: string } | null;
  /** Dias de uso até agora (ou até a retirada), contando o dia da inserção como 1. */
  readonly dias: number;
  readonly versao: number;
}

/** Uma parcela de indicador com o numerador e o denominador impressos (regra 5: "com as parcelas impressas"). */
export interface ParcelaIndicador {
  readonly numerador: number;
  readonly denominador: number;
  /** Por 1.000 (densidade), por 100 (taxa) ou por 1 (mL por paciente-dia); null quando o denominador é zero. */
  readonly valor: number | null;
  readonly fator: 1 | 100 | 1000;
}

export interface DenominadorSetor {
  readonly setor: string;
  readonly pacientesDia: number;
  readonly dispositivosDia: Readonly<Record<TipoDispositivoInvasivo, number>>;
  readonly iras: Readonly<Record<'ipcs' | 'pav' | 'itu', number>>;
  readonly densidade: Readonly<Record<'ipcs' | 'pav' | 'itu', ParcelaIndicador>>;
  readonly utilizacao: Readonly<Record<TipoDispositivoInvasivo, ParcelaIndicador>>;
}

export interface ConsumoAntimicrobianoItem {
  readonly item: number;
  readonly nome: string;
  readonly atc: string | null;
  readonly unidadesDispensadas: number;
  /** null quando o item não tem DDD configurada (aparece na lista "sem DDD"). */
  readonly ddd: number | null;
  readonly diasTerapia: number;
}
