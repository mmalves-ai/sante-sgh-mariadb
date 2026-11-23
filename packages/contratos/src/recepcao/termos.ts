// W1-04 (mercado): termos de consentimento e LGPD por tipo de atendimento, assinados no balcão. O modelo é versionado
// (alterar o texto é versão nova, nunca sobrescreve); a assinatura é imutável, com hash do conteúdo canônico, e a
// revogação é fato novo com motivo. A finalidade vem do catálogo de finalidades de consentimento do cadastro do
// paciente (FINALIDADES_CONSENTIMENTO). Termo exigido ausente dá BLOQUEIO SUAVE: a tela avisa e pede a confirmação
// de quem atende, nunca impede a chegada (parâmetro recepcao.termos.exigir; desligado até os textos aprovados).
import { z } from 'zod';
import { CODIGOS_TIPO_ATENDIMENTO } from '../atendimento/vocabulario.js';
import { FINALIDADES_CONSENTIMENTO } from '../cadastro/telas.js';
import { textoCp1252 } from '../texto-cp1252.js';
import { idBanco, idBancoTexto } from '../validacao/id-banco.js';

/** Tipos de atendimento em que um termo pode ser exigido (os do balcão mais a internação). */
export const TIPOS_ATENDIMENTO_TERMO = [...CODIGOS_TIPO_ATENDIMENTO, 'internacao'] as const;
export type TipoAtendimentoTermo = (typeof TIPOS_ATENDIMENTO_TERMO)[number];

export const MEIOS_ASSINATURA_TERMO = ['tela', 'portal'] as const;
export type MeioAssinaturaTermo = (typeof MEIOS_ASSINATURA_TERMO)[number];

/** Tamanho máximo do texto do termo (bytes CP1252) e da imagem do traço (PNG em base64). */
export const MAX_TEXTO_TERMO = 20_000;
export const MAX_IMAGEM_ASSINATURA = 200_000;

const espacos = (t: string) => t.replace(/\s+/g, ' ').trim();
const motivo = textoCp1252(200)
  .overwrite(espacos)
  .refine((t) => t.length >= 10, 'Diga o motivo (10 caracteres ou mais).');
const titulo = textoCp1252(120)
  .overwrite(espacos)
  .refine((t) => t.length >= 3, 'Dê um título ao termo.');
const texto = textoCp1252(MAX_TEXTO_TERMO)
  .overwrite((t) => t.replace(/\r\n/g, '\n').trim())
  .refine((t) => t.length >= 20, 'O texto do termo precisa de 20 caracteres ou mais.');
const tipos = z
  .array(z.enum(TIPOS_ATENDIMENTO_TERMO))
  .min(1, 'Escolha ao menos um tipo de atendimento.')
  .max(TIPOS_ATENDIMENTO_TERMO.length)
  .transform((t) => [...new Set(t)].sort());

export const esquemaIncluirModeloTermo = z
  .object({
    codigo: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9][a-z0-9-]{1,29}$/, 'Código com letras minúsculas, números e hífen (2 a 30).'),
    titulo,
    finalidade: z.enum(FINALIDADES_CONSENTIMENTO),
    tiposAtendimento: tipos,
    exigido: z.boolean(),
    texto,
  })
  .strict();
export type IncluirModeloTermo = z.infer<typeof esquemaIncluirModeloTermo>;

/** Alterar o modelo = nova versão (o texto, o título, os tipos ou a exigência); a anterior fica no histórico. */
export const esquemaNovaVersaoTermo = z
  .object({
    titulo,
    tiposAtendimento: tipos,
    exigido: z.boolean(),
    texto,
    versaoVista: z.number().int().min(1),
  })
  .strict();
export type NovaVersaoTermo = z.infer<typeof esquemaNovaVersaoTermo>;

export const esquemaSituacaoTermo = z.object({ ativo: z.boolean(), motivo }).strict();
export type SituacaoTermoEntrada = z.infer<typeof esquemaSituacaoTermo>;

export const esquemaExcluirTermo = z.object({ motivo }).strict();

export const esquemaAssinarTermo = z
  .object({
    modelo: z.number().int().positive(),
    prontuario: idBanco,
    senha: idBanco.nullable(),
    tipoAtendimento: z.enum(TIPOS_ATENDIMENTO_TERMO).nullable(),
    meio: z.enum(MEIOS_ASSINATURA_TERMO),
    signatario: z.number().int().min(0).max(32_767),
    nomeSignatario: textoCp1252(70)
      .overwrite(espacos)
      .refine((t) => t.length >= 3, 'Diga o nome de quem assina.'),
    /** O traço da assinatura em tela (PNG em base64, sem o prefixo data:); só no meio "tela". */
    imagem: z
      .string()
      .max(MAX_IMAGEM_ASSINATURA)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'Imagem da assinatura inválida.')
      .nullable(),
  })
  .strict()
  .superRefine((v, c) => {
    if (v.meio === 'tela' && !v.imagem)
      c.addIssue({ code: 'custom', path: ['imagem'], message: 'Falta a assinatura em tela.' });
    if (v.meio === 'portal' && v.imagem)
      c.addIssue({ code: 'custom', path: ['imagem'], message: 'O aceite pelo portal não leva imagem.' });
  });
export type AssinarTermo = z.infer<typeof esquemaAssinarTermo>;

export const esquemaRevogarTermo = z.object({ motivo }).strict();

export const esquemaConsultaTermos = z
  .object({
    prontuario: idBancoTexto,
    tipo: z.enum(TIPOS_ATENDIMENTO_TERMO).optional(),
  })
  .strict();

// ── Leituras ──────────────────────────────────────────────────────────────────────────────────────────────────

export interface VersaoModeloTermo {
  readonly id: number;
  readonly versao: number;
  readonly titulo: string;
  readonly tiposAtendimento: readonly TipoAtendimentoTermo[];
  readonly exigido: boolean;
  readonly texto: string;
  readonly hashTexto: string;
  readonly criadoPor: string;
  readonly criadoEm: string;
}

export interface ModeloTermo {
  readonly codigo: string;
  readonly finalidade: (typeof FINALIDADES_CONSENTIMENTO)[number];
  readonly ativo: boolean;
  /** A versão vigente (a última) e as anteriores, da mais nova à mais antiga. */
  readonly versoes: readonly VersaoModeloTermo[];
  /** Quantas assinaturas há em todas as versões (com assinatura, o código só se inativa). */
  readonly assinaturas: number;
}

export interface AssinaturaTermo {
  readonly id: number;
  readonly modelo: number;
  readonly codigo: string;
  readonly versao: number;
  readonly titulo: string;
  readonly finalidade: string;
  readonly prontuario: number;
  readonly senha: number | null;
  readonly tipoAtendimento: string | null;
  readonly meio: MeioAssinaturaTermo;
  readonly signatario: number;
  readonly nomeSignatario: string;
  readonly hash: string;
  readonly assinadoEm: string;
  readonly registradoPor: string;
  readonly revogacao: { readonly motivo: string; readonly usuario: string; readonly em: string } | null;
}

export interface PendenciaTermo {
  readonly codigo: string;
  readonly titulo: string;
  readonly versao: number;
  readonly modelo: number;
}

/** Quem assina (domínio do cadastro: paciente ou representante legal), lido ao vivo. */
export interface SignatarioTermo {
  readonly codigo: number;
  readonly rotulo: string;
}

export interface TermosDoPaciente {
  readonly prontuario: number;
  readonly signatarios: readonly SignatarioTermo[];
  readonly assinaturas: readonly AssinaturaTermo[];
  /** Os termos exigidos no tipo pedido sem assinatura válida na versão vigente. */
  readonly faltando: readonly PendenciaTermo[];
  /** Bloqueio suave: o parâmetro está ligado e falta termo (a tela pede a confirmação; nada é impedido). */
  readonly bloqueioSuave: boolean;
  readonly exigir: boolean;
}

/**
 * Os termos exigidos no tipo de atendimento que o paciente ainda não assinou na versão vigente (assinatura revogada ou
 * de versão anterior não vale). Código inativo não é exigido.
 */
export function termosFaltando(
  modelos: readonly ModeloTermo[],
  assinaturas: readonly Pick<AssinaturaTermo, 'modelo' | 'revogacao'>[],
  tipo: TipoAtendimentoTermo,
): PendenciaTermo[] {
  const validas = new Set(assinaturas.filter((a) => a.revogacao === null).map((a) => a.modelo));
  const r: PendenciaTermo[] = [];
  for (const m of modelos) {
    const v = m.versoes[0];
    if (!m.ativo || !v || !v.exigido || !v.tiposAtendimento.includes(tipo)) continue;
    if (!validas.has(v.id)) r.push({ codigo: m.codigo, titulo: v.titulo, versao: v.versao, modelo: v.id });
  }
  return r;
}

/**
 * O conteúdo canônico que a assinatura guarda em hash (SHA-256, calculado no servidor): a versão do modelo com o hash
 * do texto, o paciente, a senha, o signatário, o meio, a hora e o hash da imagem do traço. Ordem fixa das chaves.
 */
export function conteudoCanonicoAssinatura(a: {
  modelo: number;
  hashTexto: string;
  prontuario: number;
  senha: number | null;
  tipoAtendimento: string | null;
  meio: MeioAssinaturaTermo;
  signatario: number;
  nomeSignatario: string;
  assinadoEm: string;
  hashImagem: string | null;
}): string {
  return JSON.stringify([
    'sgh-termo-v1',
    a.modelo,
    a.hashTexto,
    a.prontuario,
    a.senha,
    a.tipoAtendimento,
    a.meio,
    a.signatario,
    a.nomeSignatario,
    a.assinadoEm,
    a.hashImagem,
  ]);
}

// ── Esquemas das respostas (a tela valida o que lê) ─────────────────────────────────────────────────────────────

const tipoTermo = z.enum(TIPOS_ATENDIMENTO_TERMO);
export const esquemaVersaoModeloTermo = z.object({
  id: z.number().int(),
  versao: z.number().int(),
  titulo: z.string(),
  tiposAtendimento: z.array(tipoTermo),
  exigido: z.boolean(),
  texto: z.string(),
  hashTexto: z.string(),
  criadoPor: z.string(),
  criadoEm: z.string(),
}) satisfies z.ZodType<VersaoModeloTermo>;

export const esquemaModeloTermo = z.object({
  codigo: z.string(),
  finalidade: z.enum(FINALIDADES_CONSENTIMENTO),
  ativo: z.boolean(),
  versoes: z.array(esquemaVersaoModeloTermo),
  assinaturas: z.number().int(),
}) satisfies z.ZodType<ModeloTermo>;

export const esquemaAssinaturaTermo = z.object({
  id: z.number().int(),
  modelo: z.number().int(),
  codigo: z.string(),
  versao: z.number().int(),
  titulo: z.string(),
  finalidade: z.string(),
  prontuario: z.number().int(),
  senha: z.number().int().nullable(),
  tipoAtendimento: z.string().nullable(),
  meio: z.enum(MEIOS_ASSINATURA_TERMO),
  signatario: z.number().int(),
  nomeSignatario: z.string(),
  hash: z.string(),
  assinadoEm: z.string(),
  registradoPor: z.string(),
  revogacao: z.object({ motivo: z.string(), usuario: z.string(), em: z.string() }).nullable(),
}) satisfies z.ZodType<AssinaturaTermo>;

export const esquemaTermosDoPaciente = z.object({
  prontuario: z.number().int(),
  signatarios: z.array(z.object({ codigo: z.number().int(), rotulo: z.string() })),
  assinaturas: z.array(esquemaAssinaturaTermo),
  faltando: z.array(
    z.object({ codigo: z.string(), titulo: z.string(), versao: z.number().int(), modelo: z.number().int() }),
  ),
  bloqueioSuave: z.boolean(),
  exigir: z.boolean(),
}) satisfies z.ZodType<TermosDoPaciente>;

export const esquemaTermoAssinado = z.object({
  ok: z.literal(true),
  id: z.number().int(),
  hash: z.string(),
  mensagem: z.string(),
});

/**
 * A chegada pode seguir? Sem termo faltando, sim; faltando com o parâmetro desligado, sim (a tela só oferece a
 * assinatura); no bloqueio suave, só com a confirmação de quem atende (nada é impedido no servidor).
 */
export function chegadaPodeSeguir(
  t: Pick<TermosDoPaciente, 'faltando' | 'bloqueioSuave'>,
  confirmado: boolean,
): boolean {
  return t.faltando.length === 0 || !t.bloqueioSuave || confirmado;
}
