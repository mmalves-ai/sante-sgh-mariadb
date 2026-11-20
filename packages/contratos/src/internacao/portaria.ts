// Portaria e visitantes (M50, etapa 5; ficha, seções 4, 5, 7 e regras 9, 10 e 13): o cadastro mínimo do visitante
// (com o prazo de retenção do encarregado de dados), a visita com o crachá de validade, a entrada e a saída; as regras de
// visita por unidade (horário, número de visitantes ao mesmo tempo, idade, UTI, isolamento); o bloqueio por paciente
// (pedido do paciente ou da família, ordem judicial, decisão clínica, sigilo de presença); o acompanhante com direito
// legal (Estatuto da Pessoa Idosa, ECA, Lei 11.108/2005, Lei 13.146/2015) e a troca; os terminais e as catracas
// (integração opcional, só em produção) e o relatório de contatos para a investigação de surto. O porteiro vê só o
// necessário: o paciente com sigilo de presença não aparece, o leito só aparece com a visita permitida e o motivo de
// um bloqueio nunca é mostrado na portaria. Tudo é só do novo (SGH_): o sistema anterior não registra a portaria (40
// das 47 tabelas do controle de acesso vazias). Vocabulário de produto.
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';
import { cpfValido, somenteDigitos } from '../validacao/cpf.js';

const livre = (max: number) => textoCp1252(max).overwrite((t) => t.replace(/\s+/g, ' ').trim());
const id = z.number().int().positive().max(2_147_483_647);
const idGrande = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD.');
const horaMinuto = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora no formato HH:MM.');
const dataHoraLocal = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/,
    'Data e hora no formato AAAA-MM-DDTHH:mm.',
  );

// ── Vocabulário ────────────────────────────────────────────────────────────────────────────────────

/** Documento do visitante (cadastro mínimo): o número fica guardado só até o prazo de retenção. */
export const TIPOS_DOCUMENTO_VISITANTE = ['cpf', 'rg', 'cnh', 'passaporte', 'outro'] as const;
export type TipoDocumentoVisitante = (typeof TIPOS_DOCUMENTO_VISITANTE)[number];

/** O papel da pessoa na visita ao paciente: visitante (regras da unidade) ou o acompanhante com direito legal. */
export const PAPEIS_VISITA = ['visitante', 'acompanhante'] as const;
export type PapelVisita = (typeof PAPEIS_VISITA)[number];

/**
 * Motivo do bloqueio por paciente: pedido do paciente ou da família, ordem judicial, decisão clínica (enfermagem ou
 * médico) e sigilo de presença (o paciente não aparece na busca da portaria).
 */
export const MOTIVOS_BLOQUEIO_VISITA = ['pedido', 'judicial', 'clinico', 'sigilo'] as const;
export type MotivoBloqueioVisita = (typeof MOTIVOS_BLOQUEIO_VISITA)[number];

/** Abrangência do bloqueio: nenhuma visita, uma pessoa só ou um limite menor de visitantes ao mesmo tempo. */
export const ABRANGENCIAS_BLOQUEIO = ['todos', 'visitante', 'limite'] as const;
export type AbrangenciaBloqueio = (typeof ABRANGENCIAS_BLOQUEIO)[number];

/**
 * Fundamento legal do acompanhante: pessoa idosa (Lei 10.741/2003, art. 16), criança ou adolescente (Lei 8.069/1990, art.
 * 12), parturiente (Lei 11.108/2005), pessoa com deficiência (Lei 13.146/2015, art. 22) ou autorizado pela equipe.
 */
export const FUNDAMENTOS_ACOMPANHANTE = ['idoso', 'crianca', 'parto', 'deficiencia', 'autorizado'] as const;
export type FundamentoAcompanhante = (typeof FUNDAMENTOS_ACOMPANHANTE)[number];

/** O que a regra da unidade faz com o paciente em isolamento: não libera ou libera com a orientação de precaução. */
export const ISOLAMENTO_REGRA = ['bloquear', 'orientar'] as const;
export type IsolamentoRegra = (typeof ISOLAMENTO_REGRA)[number];

export const SENTIDOS_CATRACA = ['entrada', 'saida'] as const;
export type SentidoCatraca = (typeof SENTIDOS_CATRACA)[number];
export const SENTIDOS_TERMINAL = ['entrada', 'saida', 'ambos'] as const;
export type SentidoTerminal = (typeof SENTIDOS_TERMINAL)[number];
export const RESULTADOS_CATRACA = ['liberado', 'negado'] as const;
export type ResultadoCatraca = (typeof RESULTADOS_CATRACA)[number];

/** Por que a visita não é permitida agora (o texto do porteiro é genérico: nunca o motivo de um bloqueio). */
export const RECUSAS_VISITA = [
  'fora-do-horario',
  'limite',
  'bloqueio',
  'idade',
  'nascimento-exigido',
  'isolamento',
  'ja-em-visita',
  'identificacao-biometrica',
  'sem-internacao',
] as const;
export type RecusaVisita = (typeof RECUSAS_VISITA)[number];

/** Chaves de liberação (POL-3): a portaria, a catraca (autorização do dono) e a biometria (DP-45). */
export const CHAVE_LIBERACAO_PORTARIA = 'portaria';
export const CHAVE_LIBERACAO_CATRACA = 'portaria.catraca';
export const CHAVE_LIBERACAO_BIOMETRIA = 'portaria.biometria';

/** Parâmetro do prazo de retenção do cadastro do visitante (dias depois da última visita; o encarregado de dados). */
export const PARAMETRO_PORTARIA_RETENCAO = 'hotelaria.portariaRetencaoDias';
export const RETENCAO_PADRAO_DIAS = 365;

/**
 * Os códigos do domínio de formas de identificação no acesso do estabelecimento (4 linhas na cópia `pc`: 1 Biometria,
 * 2 Crachá, 3 Etiqueta, 4 Facial). Biometria e facial só com a DP-45 (chave `portaria.biometria`); sem ela, o crachá ou
 * a etiqueta com o documento e a foto.
 */
export const IDENTIFICACAO_BIOMETRICA: readonly number[] = [1, 4];
export const IDENTIFICACAO_CRACHA = 2;
/** O tipo de visitado "Paciente" do domínio (4 na cópia `pc`): a visita ao paciente segue as regras da unidade. */
export const TIPO_VISITADO_PACIENTE = 4;
/** A situação de acesso "Registrar" do domínio (3 na cópia `pc`): a visita registrada na portaria. */
export const SITUACAO_ACESSO_REGISTRAR = 3;

/** A unidade "todas" da regra do estabelecimento (vale onde a unidade não tem regra própria). */
export const UNIDADE_TODAS = '*';

// ── Entradas ──────────────────────────────────────────────────────────────────────────────────────

const documento = z
  .string()
  .transform((s) => s.replace(/[\s.\-/]/g, '').toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9]{3,20}$/, 'Documento com 3 a 20 letras ou números.'));

/** Cadastro mínimo do visitante (regra 9): nome, documento e, conforme a regra da unidade, a data de nascimento. */
export const esquemaVisitante = z
  .object({
    nome: livre(70).pipe(z.string().min(3, 'Informe o nome do visitante.')),
    tipoDocumento: z.enum(TIPOS_DOCUMENTO_VISITANTE),
    documento,
    nascimento: dataIso.nullable().default(null),
    telefone: z
      .string()
      .transform((s) => somenteDigitos(s))
      .pipe(z.string().regex(/^\d{10,11}$/, 'Telefone com DDD (10 ou 11 dígitos).'))
      .nullable()
      .default(null),
    /** O tipo de visitante do domínio do estabelecimento (visitante, acompanhante, fornecedor…): o ID do cadastro
     * (SMALLINT no banco, até 32767; o gerador já passa de 9). */
    tipoVisitante: z.number().int().min(0).max(32767),
    /** Foto da webcam ou do arquivo (JPEG, PNG ou WebP em base64, até 300 KB). */
    foto: z
      .object({
        tipo: z.enum(['image/jpeg', 'image/png', 'image/webp']),
        base64: z
          .string()
          .regex(/^[A-Za-z0-9+/=]+$/, 'Foto inválida.')
          .max(410_000, 'Foto acima de 300 KB.'),
      })
      .strict()
      .nullable()
      .default(null),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.tipoDocumento === 'cpf' && !cpfValido(v.documento))
      ctx.addIssue({ code: 'custom', path: ['documento'], message: 'CPF inválido: confira os dígitos.' });
  });
export type VisitanteEntrada = z.infer<typeof esquemaVisitante>;

/** Destino da visita: um paciente internado (pela internação) ou outro destino (local, setor, profissional). */
export const esquemaDestinoVisita = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('paciente'), internacao: id }).strict(),
  z
    .object({
      tipo: z.literal('outro'),
      tipoVisitado: z.number().int().min(0).max(32767),
      local: livre(60).pipe(z.string().min(2, 'Informe o destino.')),
    })
    .strict(),
]);
export type DestinoVisita = z.infer<typeof esquemaDestinoVisita>;

export const esquemaRegistrarVisita = z
  .object({
    visitante: idGrande,
    destino: esquemaDestinoVisita,
    /** A forma de identificação no acesso (crachá, etiqueta; biometria e facial só com a DP-45). */
    identificacao: z.number().int().min(1).max(32_767),
    /**
     * Exceção autorizada pelo supervisor da portaria (fora do horário, acima do limite, idade): com o motivo. Não vale
     * contra bloqueio do paciente, sigilo nem isolamento que a regra bloqueia.
     */
    excecao: livre(200)
      .pipe(z.string().min(10, 'Justifique a exceção (10 caracteres ou mais).'))
      .nullable()
      .default(null),
  })
  .strict();
export type RegistrarVisitaEntrada = z.infer<typeof esquemaRegistrarVisita>;

export const esquemaRegraVisita = z
  .object({
    /** A unidade de internação (bloco) ou `*` para o estabelecimento. */
    unidade: z.string().regex(/^(\*|[A-Za-z0-9 ._-]{1,5})$/, 'Unidade inválida.'),
    horaInicio: horaMinuto,
    horaFim: horaMinuto,
    maxSimultaneos: z.number().int().min(1).max(10),
    idadeMinima: z.number().int().min(0).max(18),
    uti: z.boolean(),
    isolamento: z.enum(ISOLAMENTO_REGRA),
    duracaoMaxMin: z.number().int().min(15).max(1_440),
    observacao: livre(200).nullable().default(null),
    /** A versão lida (nula na primeira regra da unidade): mudou no meio, a gravação é recusada. */
    versao: z.number().int().min(1).nullable().default(null),
  })
  .strict()
  .refine((r) => r.horaInicio < r.horaFim, {
    path: ['horaFim'],
    message: 'O fim do horário de visita é depois do início.',
  });
export type RegraVisitaEntrada = z.infer<typeof esquemaRegraVisita>;

export const esquemaBloqueioVisita = z
  .object({
    internacao: id,
    motivo: z.enum(MOTIVOS_BLOQUEIO_VISITA),
    abrangencia: z.enum(ABRANGENCIAS_BLOQUEIO),
    visitante: idGrande.nullable().default(null),
    limite: z.number().int().min(1).max(10).nullable().default(null),
    /** O bloqueio vale também para o acompanhante (só com ordem judicial ou decisão clínica). */
    incluiAcompanhante: z.boolean().default(false),
    justificativa: livre(200).pipe(z.string().min(10, 'Justifique o bloqueio (10 caracteres ou mais).')),
    /** Número do processo ou do documento (obrigatório na ordem judicial). */
    documento: livre(60).nullable().default(null),
    /** Até quando (sem data: até revogar ou até a alta). */
    fim: dataIso.nullable().default(null),
  })
  .strict();
export type BloqueioVisitaEntrada = z.infer<typeof esquemaBloqueioVisita>;

export const esquemaMotivo = z
  .object({ motivo: livre(200).pipe(z.string().min(10, 'Justifique (10 caracteres ou mais).')) })
  .strict();

export const esquemaAcompanhante = z
  .object({
    internacao: id,
    visitante: idGrande,
    fundamento: z.enum(FUNDAMENTOS_ACOMPANHANTE),
    /** Direito à refeição do acompanhante (alimenta a dieta do acompanhante na nutrição). */
    refeicao: z.boolean(),
    pernoite: z.boolean(),
    observacao: livre(200).nullable().default(null),
  })
  .strict();
export type AcompanhanteEntrada = z.infer<typeof esquemaAcompanhante>;

export const esquemaTerminal = z
  .object({
    nome: livre(40).pipe(z.string().min(2, 'Informe o nome do terminal.')),
    /** O tipo de terminal do domínio do estabelecimento (catraca, totem…); o fabricante vem dele. */
    tipoTerminal: z.number().int().min(1).max(32_767),
    local: livre(40).pipe(z.string().min(2, 'Informe a portaria ou o local.')),
    sentido: z.enum(SENTIDOS_TERMINAL),
    ativo: z.boolean(),
    versao: z.number().int().min(1).nullable().default(null),
  })
  .strict();
export type TerminalEntrada = z.infer<typeof esquemaTerminal>;

/** Evento da catraca (o integrador local do terminal pergunta se o crachá passa; a resposta é na hora). */
export const esquemaEventoCatraca = z
  .object({
    terminal: idGrande,
    cracha: z.string().regex(/^[A-Z0-9]{6,20}$/, 'Crachá inválido.'),
    sentido: z.enum(SENTIDOS_CATRACA),
    ocorridoEm: dataHoraLocal,
    /** O identificador do evento no terminal (o reenvio do mesmo evento não grava duas vezes). */
    chave: z.string().regex(/^[A-Za-z0-9._:-]{4,60}$/, 'Identificador do evento inválido.'),
  })
  .strict();
export type EventoCatracaEntrada = z.infer<typeof esquemaEventoCatraca>;

export const esquemaConsultaContatos = z
  .object({
    internacao: id.nullable().default(null),
    unidade: z
      .string()
      .regex(/^[A-Za-z0-9 ._-]{1,5}$/)
      .nullable()
      .default(null),
    de: dataIso,
    ate: dataIso,
  })
  .strict()
  .refine((c) => c.internacao !== null || c.unidade !== null, {
    message: 'Escolha o paciente ou a unidade.',
    path: ['internacao'],
  })
  .refine((c) => c.de <= c.ate, { message: 'O fim do período é depois do início.', path: ['ate'] });
export type ConsultaContatos = z.infer<typeof esquemaConsultaContatos>;

// ── Leituras ──────────────────────────────────────────────────────────────────────────────────────

export interface CodigoNome {
  readonly codigo: number;
  readonly nome: string;
}

export interface DominiosPortaria {
  readonly tiposVisitante: readonly (CodigoNome & { readonly ativo: boolean })[];
  readonly tiposVisitado: readonly CodigoNome[];
  /** Formas de identificação: a biométrica só disponível com a DP-45. */
  readonly identificacoes: readonly (CodigoNome & {
    readonly biometrica: boolean;
    readonly disponivel: boolean;
  })[];
  readonly tiposTerminal: readonly (CodigoNome & {
    readonly fabricante: number;
    readonly fabricanteNome: string;
    readonly ativo: boolean;
  })[];
  readonly situacoesAcesso: readonly CodigoNome[];
}

/** O visitante como a portaria o vê: o documento mascarado; o nascimento só para a regra da idade. */
export interface VisitanteLido {
  readonly id: number;
  readonly nome: string;
  readonly tipoDocumento: TipoDocumentoVisitante;
  readonly documentoMascarado: string;
  readonly nascimento: string | null;
  readonly telefone: string | null;
  readonly tipoVisitante: number;
  readonly temFoto: boolean;
  readonly reterAte: string;
  readonly ultimaVisita: string | null;
}

/** A regra de visita de uma unidade (ou do estabelecimento, `*`). */
export interface RegraVisitaLida {
  readonly id: number | null;
  readonly unidade: string;
  readonly horaInicio: string;
  readonly horaFim: string;
  readonly maxSimultaneos: number;
  readonly idadeMinima: number;
  readonly uti: boolean;
  readonly isolamento: IsolamentoRegra;
  readonly duracaoMaxMin: number;
  readonly observacao: string | null;
  readonly versao: number;
  readonly atualizadoPor: string | null;
  readonly atualizadoEm: string | null;
  /** A regra de mercado usada quando a unidade e o estabelecimento não têm regra gravada. */
  readonly padrao: boolean;
}

/** O bloqueio como a supervisão vê (a portaria nunca recebe o motivo nem a justificativa). */
export interface BloqueioVisitaLido {
  readonly id: number;
  readonly internacao: number;
  readonly paciente: string;
  readonly unidade: string;
  readonly motivo: MotivoBloqueioVisita;
  readonly abrangencia: AbrangenciaBloqueio;
  readonly visitante: { readonly id: number; readonly nome: string } | null;
  readonly limite: number | null;
  readonly incluiAcompanhante: boolean;
  readonly justificativa: string;
  readonly documento: string | null;
  readonly inicio: string;
  readonly fim: string | null;
  readonly criadoPor: string;
}

/** O paciente na busca da portaria (regra 9): o leito só com a visita permitida; o motivo do bloqueio nunca. */
export interface PacientePortaria {
  readonly internacao: number;
  readonly nome: string;
  readonly unidade: string;
  readonly unidadeNome: string;
  readonly leito: string | null;
  readonly permitida: boolean;
  readonly recusa: RecusaVisita | null;
  readonly mensagem: string;
  /** Orientação de precaução (isolamento com a regra "orientar"). */
  readonly orientacao: string | null;
  readonly visitantesAgora: number;
  readonly limite: number;
  readonly horario: string;
  readonly acompanhante: { readonly visitante: number; readonly nome: string } | null;
}

export interface VisitaLida {
  readonly id: number;
  readonly visitante: { readonly id: number; readonly nome: string; readonly temFoto: boolean };
  readonly papel: PapelVisita;
  readonly destino:
    | {
        readonly tipo: 'paciente';
        readonly internacao: number;
        readonly paciente: string;
        readonly unidade: string;
        readonly leito: string | null;
      }
    | { readonly tipo: 'outro'; readonly tipoVisitado: number; readonly local: string };
  readonly cracha: string;
  readonly identificacao: number;
  readonly entrada: string;
  readonly validoAte: string;
  readonly saida: string | null;
  readonly excecao: string | null;
  readonly vencida: boolean;
  readonly usuario: string;
}

export interface CrachaVisita {
  readonly visita: number;
  readonly codigo: string;
  readonly visitante: string;
  readonly destino: string;
  readonly validoAte: string;
  readonly zpl: string;
}

export interface AcompanhanteLido {
  readonly id: number;
  readonly internacao: number;
  readonly paciente: string;
  readonly unidade: string;
  readonly unidadeNome: string;
  readonly leito: string;
  readonly visitante: { readonly id: number; readonly nome: string };
  readonly fundamento: FundamentoAcompanhante;
  readonly refeicao: boolean;
  readonly pernoite: boolean;
  readonly observacao: string | null;
  readonly inicio: string;
  readonly fim: string | null;
  readonly substitui: number | null;
  readonly criadoPor: string;
}

export interface TerminalLido {
  readonly id: number;
  readonly nome: string;
  readonly tipoTerminal: number;
  readonly tipoNome: string;
  readonly fabricante: number;
  readonly fabricanteNome: string;
  readonly local: string;
  readonly sentido: SentidoTerminal;
  readonly ativo: boolean;
  readonly versao: number;
}

export interface EventoCatracaLido {
  readonly id: number;
  readonly terminal: number;
  readonly terminalNome: string;
  readonly cracha: string;
  readonly sentido: SentidoCatraca;
  readonly resultado: ResultadoCatraca;
  readonly motivo: string | null;
  readonly ocorridoEm: string;
  readonly visita: number | null;
}

/** Um contato para a investigação de surto: quem esteve com o paciente ou na unidade, e quando. */
export interface ContatoVisita {
  readonly visita: number;
  readonly visitante: string;
  readonly documentoMascarado: string;
  readonly telefone: string | null;
  readonly papel: PapelVisita;
  readonly paciente: string;
  readonly unidade: string;
  readonly entrada: string;
  readonly saida: string | null;
}

/** O estado das gravações para a tela (a liberação e cada ação). */
export interface GravacaoPortaria {
  readonly ligada: boolean;
  readonly motivo: string | null;
  readonly operacoes: Readonly<Record<string, { readonly pode: boolean; readonly motivo: string | null }>>;
}

export interface PainelPortaria {
  readonly agora: string;
  readonly dominios: DominiosPortaria;
  readonly abertas: readonly VisitaLida[];
  readonly biometriaLigada: boolean;
  readonly retencaoDias: number;
  readonly gravacao: GravacaoPortaria;
}

export interface UnidadePortaria {
  readonly unidade: string;
  readonly nome: string;
}

export interface PainelRegrasPortaria {
  readonly unidades: readonly UnidadePortaria[];
  readonly regras: readonly RegraVisitaLida[];
  readonly bloqueios: readonly BloqueioVisitaLido[];
  readonly vencidos: number;
  readonly gravacao: GravacaoPortaria;
}

export interface PainelAcompanhantes {
  readonly unidades: readonly UnidadePortaria[];
  readonly acompanhantes: readonly AcompanhanteLido[];
  /** Os tipos de visitante ativos (o cadastro mínimo da pessoa pela tela dos acompanhantes). */
  readonly tiposVisitante: DominiosPortaria['tiposVisitante'];
  readonly gravacao: GravacaoPortaria;
}

export interface PainelTerminais {
  readonly dominios: DominiosPortaria;
  readonly terminais: readonly TerminalLido[];
  readonly eventos: readonly EventoCatracaLido[];
  readonly catracaLigada: boolean;
  /** Fora de produção, o simulador da catraca (nada sai para fora). */
  readonly simulador: boolean;
  readonly gravacao: GravacaoPortaria;
}

export interface ResultadoPortaria {
  readonly ok: true;
  readonly id: number;
  readonly mensagem: string;
  readonly cracha?: CrachaVisita;
}

export interface RespostaCatraca {
  readonly resultado: ResultadoCatraca;
  readonly motivo: string | null;
  readonly evento: number;
  readonly repetido: boolean;
}

/** O documento mascarado (só os 3 últimos caracteres). */
export function mascararDocumento(d: string): string {
  const s = d.trim();
  if (s.length <= 3) return '•••';
  return `${'•'.repeat(Math.min(8, s.length - 3))}${s.slice(-3)}`;
}
