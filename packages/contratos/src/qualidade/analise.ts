// Segurança do paciente, etapa 2 do M48 (ficha, seções 4, 5, 7 e 8; cap-05b §5.11; manual m17 "Como o NSP trata uma
// notificação" e "Protocolos de segurança"):
//   - a análise de causa da notificação distribuída (5 porquês, Ishikawa ou Protocolo de Londres), com a causa raiz,
//     os fatores contribuintes e a conclusão (`qualidade.registrarAnalise`, SGH_QUA_ANALISE);
//   - o plano de ação 5W2H com o acompanhamento de cada ação e a verificação da eficácia
//     (`qualidade.registrarPlanoAcao`, SGH_QUA_PLANO_ACAO);
//   - a sugestão automática de notificação a partir do que o próprio usuário registrou (regra 4: dose não administrada
//     por falta do item ou ausência do paciente, erro interceptado na checagem, reação transfusional, exceção no
//     checklist de cirurgia segura); quem decide notificar é o usuário;
//   - a tecnovigilância e a farmacovigilância (queixa técnica, evento adverso de produto, reação adversa, alerta
//     sanitário) ligadas ao item e ao lote, com a lista dos pacientes expostos (`qualidade.registrarQueixaTecnica`,
//     SGH_QUA_TECNOVIG);
//   - o painel do plano de segurança do paciente: adesão aos protocolos (metas internacionais e protocolos gerenciados),
//     notificações, análises e ações, sempre com numerador e denominador impressos.
// Tudo só no novo (SGH_QUA_*): o outro sistema não tem análise de incidente nem tecnovigilância. Regra 1: nada aqui liga
// a pessoa que notificou à notificação; a sugestão resolvida guarda só um resumo (sem login nem origem legíveis).
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';
import type { TipoIncidente } from './notificacao.js';

// ── Vocabulário da análise ───────────────────────────────────────────────────────────────────────────

export const METODOS_ANALISE = [
  { codigo: 'cincoPorques', rotulo: '5 porquês' },
  { codigo: 'ishikawa', rotulo: 'Diagrama de causa e efeito (Ishikawa, 6M)' },
  { codigo: 'londres', rotulo: 'Protocolo de Londres' },
] as const;
export type MetodoAnalise = (typeof METODOS_ANALISE)[number]['codigo'];
export const CODIGOS_METODO_ANALISE = METODOS_ANALISE.map((m) => m.codigo) as [
  MetodoAnalise,
  ...MetodoAnalise[],
];

/** As seis categorias do diagrama de causa e efeito (6M). */
export const CATEGORIAS_ISHIKAWA = [
  { codigo: 'metodo', rotulo: 'Método (processo, protocolo)' },
  { codigo: 'maquina', rotulo: 'Máquina (equipamento)' },
  { codigo: 'material', rotulo: 'Material (insumo, medicamento)' },
  { codigo: 'maoDeObra', rotulo: 'Mão de obra (pessoas, equipe)' },
  { codigo: 'meioAmbiente', rotulo: 'Meio ambiente (local, estrutura)' },
  { codigo: 'medida', rotulo: 'Medida (indicador, conferência)' },
] as const;
export type CategoriaIshikawa = (typeof CATEGORIAS_ISHIKAWA)[number]['codigo'];
export const CODIGOS_CATEGORIA_ISHIKAWA = CATEGORIAS_ISHIKAWA.map((c) => c.codigo) as [
  CategoriaIshikawa,
  ...CategoriaIshikawa[],
];

/** Fatores contribuintes do Protocolo de Londres (Vincent e Taylor-Adams), usados também na causa raiz dos outros métodos. */
export const FATORES_CONTRIBUINTES = [
  { codigo: 'paciente', rotulo: 'Fatores do paciente' },
  { codigo: 'tarefa', rotulo: 'Tarefa e tecnologia' },
  { codigo: 'individuo', rotulo: 'Profissional (individual)' },
  { codigo: 'equipe', rotulo: 'Equipe' },
  { codigo: 'ambiente', rotulo: 'Ambiente de trabalho' },
  { codigo: 'organizacao', rotulo: 'Organização e gestão' },
  { codigo: 'institucional', rotulo: 'Contexto institucional' },
] as const;
export type FatorContribuinte = (typeof FATORES_CONTRIBUINTES)[number]['codigo'];
export const CODIGOS_FATOR_CONTRIBUINTE = FATORES_CONTRIBUINTES.map((f) => f.codigo) as [
  FatorContribuinte,
  ...FatorContribuinte[],
];

export const SITUACOES_ANALISE = [
  { codigo: 'rascunho', rotulo: 'Em elaboração' },
  { codigo: 'concluida', rotulo: 'Concluída' },
] as const;
export type SituacaoAnalise = (typeof SITUACOES_ANALISE)[number]['codigo'];

// ── Vocabulário do plano de ação ─────────────────────────────────────────────────────────────────────

export const SITUACOES_ACAO = [
  { codigo: 'planejada', rotulo: 'Planejada' },
  { codigo: 'emAndamento', rotulo: 'Em andamento' },
  { codigo: 'concluida', rotulo: 'Concluída' },
  { codigo: 'cancelada', rotulo: 'Cancelada' },
] as const;
export type SituacaoAcao = (typeof SITUACOES_ACAO)[number]['codigo'];
export const CODIGOS_SITUACAO_ACAO = SITUACOES_ACAO.map((s) => s.codigo) as [SituacaoAcao, ...SituacaoAcao[]];

export const EFICACIAS_ACAO = [
  { codigo: 'eficaz', rotulo: 'Eficaz' },
  { codigo: 'parcial', rotulo: 'Parcialmente eficaz' },
  { codigo: 'ineficaz', rotulo: 'Ineficaz' },
] as const;
export type EficaciaAcao = (typeof EFICACIAS_ACAO)[number]['codigo'];
export const CODIGOS_EFICACIA_ACAO = EFICACIAS_ACAO.map((e) => e.codigo) as [EficaciaAcao, ...EficaciaAcao[]];

// ── Vocabulário da tecnovigilância e da farmacovigilância ──────────────────────────────────────────

export const AREAS_VIGILANCIA_PRODUTO = [
  { codigo: 'tecnovigilancia', rotulo: 'Tecnovigilância (equipamento, material, implante)' },
  { codigo: 'farmacovigilancia', rotulo: 'Farmacovigilância (medicamento)' },
] as const;
export type AreaVigilanciaProduto = (typeof AREAS_VIGILANCIA_PRODUTO)[number]['codigo'];
export const CODIGOS_AREA_VIGILANCIA = AREAS_VIGILANCIA_PRODUTO.map((a) => a.codigo) as [
  AreaVigilanciaProduto,
  ...AreaVigilanciaProduto[],
];

/** O tipo do registro e em que área ele cabe. */
export const TIPOS_VIGILANCIA_PRODUTO = [
  {
    codigo: 'queixaTecnica',
    rotulo: 'Queixa técnica (desvio de qualidade, defeito)',
    areas: ['tecnovigilancia', 'farmacovigilancia'],
  },
  { codigo: 'eventoAdverso', rotulo: 'Evento adverso associado ao produto', areas: ['tecnovigilancia'] },
  { codigo: 'reacaoAdversa', rotulo: 'Reação adversa a medicamento', areas: ['farmacovigilancia'] },
  { codigo: 'inefetividade', rotulo: 'Inefetividade terapêutica', areas: ['farmacovigilancia'] },
  {
    codigo: 'alertaSanitario',
    rotulo: 'Alerta sanitário (recolhimento, suspensão)',
    areas: ['tecnovigilancia', 'farmacovigilancia'],
  },
] as const satisfies readonly { codigo: string; rotulo: string; areas: readonly AreaVigilanciaProduto[] }[];
export type TipoVigilanciaProduto = (typeof TIPOS_VIGILANCIA_PRODUTO)[number]['codigo'];
export const CODIGOS_TIPO_VIGILANCIA = TIPOS_VIGILANCIA_PRODUTO.map((t) => t.codigo) as [
  TipoVigilanciaProduto,
  ...TipoVigilanciaProduto[],
];

export const CONDUTAS_PRODUTO = [
  { codigo: 'nenhuma', rotulo: 'Nenhuma ainda' },
  { codigo: 'segregado', rotulo: 'Lote segregado (fora de uso)' },
  { codigo: 'suspensoUso', rotulo: 'Uso suspenso no hospital' },
  { codigo: 'recolhido', rotulo: 'Recolhido das unidades' },
  { codigo: 'devolvido', rotulo: 'Devolvido ao fornecedor' },
] as const;
export type CondutaProduto = (typeof CONDUTAS_PRODUTO)[number]['codigo'];
export const CODIGOS_CONDUTA_PRODUTO = CONDUTAS_PRODUTO.map((c) => c.codigo) as [
  CondutaProduto,
  ...CondutaProduto[],
];

export const SITUACOES_VIGILANCIA_PRODUTO = [
  { codigo: 'aberta', rotulo: 'Aberta' },
  { codigo: 'emInvestigacao', rotulo: 'Em investigação' },
  { codigo: 'notificada', rotulo: 'Notificada à Anvisa' },
  { codigo: 'encerrada', rotulo: 'Encerrada' },
] as const;
export type SituacaoVigilanciaProduto = (typeof SITUACOES_VIGILANCIA_PRODUTO)[number]['codigo'];
export const CODIGOS_SITUACAO_VIGILANCIA = SITUACOES_VIGILANCIA_PRODUTO.map((s) => s.codigo) as [
  SituacaoVigilanciaProduto,
  ...SituacaoVigilanciaProduto[],
];

// ── Vocabulário da sugestão automática (regra 4) ────────────────────────────────────────────────────

/**
 * De onde vem a sugestão: o prefixo da origem (`<fonte>:<ID>`, o mesmo formato de `origem.sugestao` do diálogo).
 * Queda, lesão por pressão e extubação não planejada ainda não têm registro estruturado no novo (o escore de Morse e
 * o de Braden são risco, não evento): ficam no vocabulário para quando o registro existir (D-SUG-FONTES-48.2).
 */
export const FONTES_SUGESTAO = [
  { codigo: 'omitida', rotulo: 'Dose não administrada na checagem', tipo: 'medicacao', disponivel: true },
  { codigo: 'interceptado', rotulo: 'Erro interceptado na checagem', tipo: 'medicacao', disponivel: true },
  {
    codigo: 'naoAdministrada',
    rotulo: 'Dose marcada como não administrada',
    tipo: 'medicacao',
    disponivel: true,
  },
  { codigo: 'reacao', rotulo: 'Reação transfusional', tipo: 'transfusao', disponivel: true },
  {
    codigo: 'checklist',
    rotulo: 'Exceção no checklist de cirurgia segura',
    tipo: 'cirurgia',
    disponivel: true,
  },
  { codigo: 'queda', rotulo: 'Queda registrada', tipo: 'queda', disponivel: false },
  { codigo: 'lesao', rotulo: 'Lesão por pressão adquirida', tipo: 'lesaoPressao', disponivel: true },
  { codigo: 'extubacao', rotulo: 'Extubação não planejada', tipo: 'dispositivo', disponivel: false },
] as const satisfies readonly { codigo: string; rotulo: string; tipo: TipoIncidente; disponivel: boolean }[];
export type FonteSugestao = (typeof FONTES_SUGESTAO)[number]['codigo'];
export const CODIGOS_FONTE_SUGESTAO = FONTES_SUGESTAO.map((f) => f.codigo) as [
  FonteSugestao,
  ...FonteSugestao[],
];

/** A origem da sugestão como vai no diálogo (`origem.sugestao`) e na decisão: `<fonte>:<ID>`. */
export const FORMATO_ORIGEM_SUGESTAO =
  /^(omitida|interceptado|naoAdministrada|reacao|checklist|queda|lesao|extubacao):[0-9]{1,18}$/;

// ── Entradas ────────────────────────────────────────────────────────────────────────────────────────────

const id = z.number().int().positive();
const versao = z.number().int().min(0);
const login = z
  .string()
  .trim()
  .min(1)
  .max(31)
  .regex(/^[A-Za-z0-9._@-]+$/);
const texto = (min: number, max: number) => textoCp1252(max).pipe(z.string().trim().min(min));

/** O conteúdo de cada método (vai como JSON em SGH_QUA_ANALISE.CONTEUDO; teto de 6.000 caracteres serializado). */
export const esquemaConteudoAnalise = z.discriminatedUnion('metodo', [
  z.object({
    metodo: z.literal('cincoPorques'),
    /** O problema e cada "por quê?" em sequência (o último é a causa raiz proposta). */
    porques: z.array(texto(3, 400)).min(1).max(7),
  }),
  z.object({
    metodo: z.literal('ishikawa'),
    causas: z
      .array(z.object({ categoria: z.enum(CODIGOS_CATEGORIA_ISHIKAWA), texto: texto(3, 300) }))
      .min(1)
      .max(30),
  }),
  z.object({
    metodo: z.literal('londres'),
    /** A cronologia resumida do que aconteceu. */
    cronologia: texto(10, 1500),
    /** Os problemas na prestação do cuidado, cada um com os fatores que contribuíram. */
    problemas: z
      .array(
        z.object({
          descricao: texto(3, 400),
          fatores: z.array(z.enum(CODIGOS_FATOR_CONTRIBUINTE)).min(1).max(7),
        }),
      )
      .min(1)
      .max(10),
  }),
]);
export type ConteudoAnalise = z.infer<typeof esquemaConteudoAnalise>;

/**
 * `qualidade.registrarAnalise`: grava (ou atualiza) a análise da notificação distribuída; `concluir` fecha a análise
 * (exige a causa raiz e o plano com pelo menos uma ação, ou a justificativa de não haver ação).
 */
export const esquemaRegistrarAnalise = z.object({
  notificacao: id,
  /** A versão da análise que a tela leu (0 quando ainda não existe). */
  versao,
  conteudo: esquemaConteudoAnalise,
  causaRaiz: textoCp1252(2000).nullable(),
  fatores: z.array(z.enum(CODIGOS_FATOR_CONTRIBUINTE)).max(7),
  /** Lições aprendidas (vão à devolutiva e ao painel). */
  licoes: textoCp1252(2000).nullable(),
  concluir: z.boolean(),
  /** Quando a análise conclui sem ação no plano (ex.: circunstância já corrigida): por quê. */
  semAcaoJustificativa: textoCp1252(500).nullable(),
});
export type RegistrarAnaliseEntrada = z.infer<typeof esquemaRegistrarAnalise>;

/** As sete perguntas do 5W2H de uma ação. */
export const esquema5w2h = z.object({
  oQue: texto(5, 400),
  porQue: texto(5, 400),
  onde: texto(2, 120),
  /** O prazo da ação (data local). */
  quando: z.iso.date(),
  /** O responsável (login de uma conta ativa). */
  quem: login,
  como: texto(5, 400),
  /** Quanto custa (texto livre: valor estimado, "sem custo"). */
  quanto: textoCp1252(120).nullable(),
});
export type Acao5w2h = z.infer<typeof esquema5w2h>;

/**
 * `qualidade.registrarPlanoAcao`: incluir ou alterar uma ação, mudar a situação (iniciar, concluir com a evidência,
 * cancelar com o motivo) ou registrar a verificação da eficácia da ação concluída.
 */
export const esquemaRegistrarPlanoAcao = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('incluir'), notificacao: id, acao: esquema5w2h }),
  z.object({ tipo: z.literal('alterar'), notificacao: id, id, versao, acao: esquema5w2h }),
  z.object({
    tipo: z.literal('situacao'),
    notificacao: id,
    id,
    versao,
    situacao: z.enum(['emAndamento', 'concluida', 'cancelada']),
    /** A evidência da conclusão ou o motivo do cancelamento (obrigatório nos dois). */
    texto: textoCp1252(1000).nullable(),
  }),
  z.object({
    tipo: z.literal('eficacia'),
    notificacao: id,
    id,
    versao,
    eficacia: z.enum(CODIGOS_EFICACIA_ACAO),
    texto: texto(10, 1000),
  }),
]);
export type RegistrarPlanoAcaoEntrada = z.infer<typeof esquemaRegistrarPlanoAcao>;

/** O item do estoque (código), o lote, a série e o registro Anvisa, como estão no produto. */
const lote = z
  .string()
  .trim()
  .min(1)
  .max(30)
  .regex(/^[A-Za-z0-9./ _-]+$/);

/** `qualidade.registrarQueixaTecnica`: abrir o registro ou dar andamento (situação, conduta, número do Notivisa). */
export const esquemaRegistrarQueixaTecnica = z.discriminatedUnion('acao', [
  z
    .object({
      acao: z.literal('abrir'),
      area: z.enum(CODIGOS_AREA_VIGILANCIA),
      tipo: z.enum(CODIGOS_TIPO_VIGILANCIA),
      /** O item do cadastro de produtos; null quando o produto não está no cadastro (descrito em `produto`). */
      item: z.number().int().positive().nullable(),
      produto: textoCp1252(120).nullable(),
      lote: lote.nullable(),
      serie: textoCp1252(40).nullable(),
      fabricante: textoCp1252(80).nullable(),
      registroAnvisa: z
        .string()
        .trim()
        .regex(/^[0-9.]{5,20}$/)
        .nullable(),
      descricao: texto(10, 4000),
      /** A notificação de incidente ligada (o evento adverso que motivou), quando houver. */
      notificacao: id.nullable(),
      /** O número do alerta da Anvisa ou do fabricante (alerta sanitário). */
      alerta: textoCp1252(40).nullable(),
      conduta: z.enum(CODIGOS_CONDUTA_PRODUTO),
    })
    .refine((e) => e.item !== null || (e.produto !== null && e.produto.trim().length >= 3), {
      message: 'Escolha o produto do cadastro ou descreva-o.',
      path: ['produto'],
    })
    .refine((e) => e.tipo !== 'alertaSanitario' || (e.alerta !== null && e.alerta.trim().length >= 3), {
      message: 'Informe o número do alerta.',
      path: ['alerta'],
    }),
  z.object({
    acao: z.literal('andamento'),
    id,
    versao,
    situacao: z.enum(CODIGOS_SITUACAO_VIGILANCIA),
    conduta: z.enum(CODIGOS_CONDUTA_PRODUTO),
    /** O número que o Notivisa devolveu (obrigatório para "notificada"). */
    notivisaNumero: z
      .string()
      .trim()
      .min(3)
      .max(30)
      .regex(/^[A-Za-z0-9./-]+$/)
      .nullable(),
    texto: texto(10, 1000),
  }),
]);
export type RegistrarQueixaTecnicaEntrada = z.infer<typeof esquemaRegistrarQueixaTecnica>;

/** O usuário dispensa a sugestão (não é incidente, já notificado por outro canal): ela não volta. */
export const esquemaDispensarSugestao = z.object({
  origem: z.string().regex(FORMATO_ORIGEM_SUGESTAO),
});
export type DispensarSugestaoEntrada = z.infer<typeof esquemaDispensarSugestao>;

/** O período do painel (no máximo 12 meses; padrão: os últimos 30 dias). */
export const esquemaPeriodoPainel = z
  .object({ de: z.iso.date().optional(), ate: z.iso.date().optional() })
  .refine((p) => !p.de || !p.ate || p.de <= p.ate, { message: 'O início vem antes do fim.', path: ['de'] });
export type PeriodoPainel = z.infer<typeof esquemaPeriodoPainel>;

// ── Saídas ──────────────────────────────────────────────────────────────────────────────────────────────

export interface AnaliseLida {
  readonly id: number;
  readonly notificacao: number;
  readonly metodo: MetodoAnalise;
  readonly conteudo: ConteudoAnalise;
  readonly causaRaiz: string | null;
  readonly fatores: readonly FatorContribuinte[];
  readonly licoes: string | null;
  readonly semAcaoJustificativa: string | null;
  readonly situacao: SituacaoAnalise;
  readonly versao: number;
  readonly registradaPor: string;
  readonly registradaEm: string;
  readonly atualizadaEm: string | null;
  readonly concluidaEm: string | null;
  readonly concluidaPor: string | null;
}

export interface AcaoPlanoLida extends Acao5w2h {
  readonly id: number;
  readonly notificacao: number;
  readonly sequencia: number;
  readonly situacao: SituacaoAcao;
  readonly versao: number;
  readonly texto: string | null;
  readonly concluidaEm: string | null;
  readonly eficacia: EficaciaAcao | null;
  readonly eficaciaTexto: string | null;
  readonly eficaciaEm: string | null;
  readonly eficaciaPor: string | null;
  readonly criadaPor: string;
  readonly criadaEm: string;
  /** Calculado: aberta (planejada ou em andamento) com o prazo antes de hoje. */
  readonly atrasada: boolean;
}

export interface QueixaTecnicaLida {
  readonly id: number;
  readonly area: AreaVigilanciaProduto;
  readonly tipo: TipoVigilanciaProduto;
  readonly item: number | null;
  readonly produto: string | null;
  readonly lote: string | null;
  readonly serie: string | null;
  readonly fabricante: string | null;
  readonly registroAnvisa: string | null;
  readonly descricao: string;
  readonly notificacao: number | null;
  readonly alerta: string | null;
  readonly conduta: CondutaProduto;
  readonly situacao: SituacaoVigilanciaProduto;
  readonly notivisaNumero: string | null;
  readonly versao: number;
  readonly registradaPor: string;
  readonly registradaEm: string;
  readonly atualizadaEm: string | null;
  readonly encerradaEm: string | null;
}

/** Um paciente exposto ao lote (só identificadores; o nome é lido pela tela do prontuário, com a permissão dela). */
export interface ExpostoAoLote {
  readonly origem: 'consumo-em-sala' | 'estoque';
  readonly data: string | null;
  readonly atendimento: number;
  readonly paciente: number | null;
  readonly quantidade: number;
}

export interface SugestaoNotificacao {
  /** `<fonte>:<ID>`: vai no diálogo como `origem.sugestao`. */
  readonly origem: string;
  readonly fonte: FonteSugestao;
  readonly tipo: TipoIncidente;
  readonly titulo: string;
  /** Quando o registro de origem aconteceu (instante local). */
  readonly quando: string;
  /** O atendimento do registro (o diálogo relê o contexto por ele). */
  readonly atendimento: number | null;
  readonly chegouAoPaciente: boolean;
  /** O texto inicial da descrição (sem nome de pessoa; o usuário completa). */
  readonly descricao: string;
}

/** Um indicador com as parcelas (numerador e denominador sempre impressos). */
export interface IndicadorPainel {
  readonly codigo: string;
  readonly titulo: string;
  readonly numerador: number;
  readonly denominador: number;
  /** null quando o denominador é zero (sem dado no período). */
  readonly percentual: number | null;
  /** A meta (%), quando o hospital definiu; null sem meta. */
  readonly meta: number | null;
  readonly fonte: string;
}

export interface ContagemPainel {
  readonly codigo: string;
  readonly rotulo: string;
  readonly quantidade: number;
}
