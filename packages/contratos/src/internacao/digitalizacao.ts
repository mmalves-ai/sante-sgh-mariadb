// Digitalização certificada do prontuário em papel (M50, etapa 6; ficha, seções 5 a 8; regra 12; cap-06a §6.3; cap-13
// §13.3.4: CFM 1.821/2007, CFM1821-02 e -03; Lei 13.787/2018; Decreto 10.278/2020): o SAME captura o documento (PDF do
// escâner), indexa (prontuário, internação, tipo documental, data, páginas, resolução), outra pessoa confere a
// fidelidade com o papel e quem conferiu assina com o certificado ICP-Brasil (o serviço de assinatura do M49, com o
// carimbo do tempo da ACT). O arquivo vai ao armazenamento de objetos com Object Lock e o banco guarda só a chave e o
// SHA-256 (SGH_HOT_DIGITALIZACAO). Nenhum papel é eliminado pelo sistema (padrão "não eliminar"; a destinação é da Fase
// 6). Desligada até a comissão de revisão de prontuários aprovar o fluxo (chave `digitalizacao`, POL-3).
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';
import { idBanco } from '../validacao/id-banco.js';

export const CHAVE_LIBERACAO_DIGITALIZACAO = 'digitalizacao';

/** Tipos documentais do prontuário em papel (o índice do Decreto 10.278/2020, anexo II: tipo documental). */
export const TIPOS_DOCUMENTO_DIGITALIZADO = [
  'ficha-atendimento',
  'evolucao',
  'prescricao',
  'exame',
  'laudo',
  'termo-consentimento',
  'folha-sala',
  'prontuario-antigo',
  'outro',
] as const;
export type TipoDocumentoDigitalizado = (typeof TIPOS_DOCUMENTO_DIGITALIZADO)[number];

export const SITUACOES_DIGITALIZACAO = ['capturado', 'conferido', 'recusado', 'assinado'] as const;
export type SituacaoDigitalizacao = (typeof SITUACOES_DIGITALIZACAO)[number];

export const CORES_DIGITALIZACAO = ['monocromatico', 'cinza', 'colorido'] as const;
export type CorDigitalizacao = (typeof CORES_DIGITALIZACAO)[number];

/** Resolução mínima da imagem (Decreto 10.278/2020, anexo I: 300 dpi para documentos textuais). */
export const RESOLUCAO_MINIMA_DPI = 300;
/** O PDF do escâner (base64): até 12 MB (o mesmo teto do anexo do PEP do M23). */
export const TAMANHO_MAXIMO_DIGITALIZACAO = 12_000_000;
/** Documentos numa assinatura em lote (uma autorização do provedor ou um desafio do agente local). */
export const TETO_ASSINATURA_DIGITALIZACAO = 50;
/** Teto da fila (por situação). */
export const TETO_FILA_DIGITALIZACAO = 200;
/** Prazo de guarda do documento digitalizado (Lei 13.787/2018, art. 6: 20 anos a partir do último registro). */
export const ANOS_GUARDA_DIGITALIZACAO = 20;

const id = idBanco;
const idLongo = idBanco;
const data = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'Data no formato AAAA-MM-DD.');
const hash = z.string().regex(/^[a-f0-9]{64}$/, 'Resumo SHA-256 em hexadecimal minúsculo.');

// ── Capturar e indexar (`internacao.digitalizarDocumento`) ─────────────────────────────────────────────────────────

export const esquemaDigitalizarDocumento = z
  .object({
    /** O prontuário (número do prontuário) do paciente; o servidor confere e tira o paciente dele. */
    prontuario: id,
    /** A internação (número da internação) quando o papel é de uma internação; null = documento do prontuário. */
    internacao: id.nullable(),
    tipoDocumento: z.enum(TIPOS_DOCUMENTO_DIGITALIZADO),
    descricao: textoCp1252(120).pipe(z.string().trim().min(3)),
    /** A data do documento em papel (não a da digitalização). */
    dataDocumento: data,
    paginas: z.number().int().min(1).max(500),
    resolucaoDpi: z.number().int().min(75).max(1200),
    cor: z.enum(CORES_DIGITALIZACAO),
    /** O lote de digitalização em que entra (null = um lote novo). */
    lote: idLongo.nullable(),
    /** O PDF do escâner, em base64. */
    conteudo: z
      .string()
      .min(8)
      .max(Math.ceil((TAMANHO_MAXIMO_DIGITALIZACAO * 4) / 3) + 4),
    /** O SHA-256 que a estação calculou (o servidor recalcula e confere). */
    hashConteudo: hash,
  })
  .strict();
export type DigitalizarDocumentoEntrada = z.infer<typeof esquemaDigitalizarDocumento>;

// ── Conferir a fidelidade (`internacao.conferirDigitalizacao`) ───────────────────────────────────────────────────────

export const esquemaConferirDigitalizacao = z
  .object({
    id: idLongo,
    resultado: z.enum(['fiel', 'recusar']),
    /** Motivo da recusa (página faltando, ilegível, documento errado…). */
    motivo: textoCp1252(200).pipe(z.string().trim()).optional(),
    versao: z.number().int().positive(),
  })
  .strict()
  .refine((x) => x.resultado === 'fiel' || (x.motivo?.length ?? 0) >= 3, {
    message: 'Diga o motivo da recusa.',
    path: ['motivo'],
  });
export type ConferirDigitalizacaoEntrada = z.infer<typeof esquemaConferirDigitalizacao>;

// ── Assinar com o certificado ICP-Brasil (um ou o lote; pelo serviço do M49) ────────────────────────────────────────

export const esquemaAssinarDigitalizacao = z
  .object({
    ids: z.array(idLongo).min(1).max(TETO_ASSINATURA_DIGITALIZACAO),
    /** O certificado vinculado (SGH_ACESSO_CERTIFICADO.ID) de quem assina. */
    certificado: id,
  })
  .strict()
  .refine((x) => new Set(x.ids).size === x.ids.length, { message: 'Documento repetido.', path: ['ids'] });
export type AssinarDigitalizacaoEntrada = z.infer<typeof esquemaAssinarDigitalizacao>;

// ── Leituras ─────────────────────────────────────────────────────────────────────────────────────────────────────

export interface DigitalizacaoLida {
  readonly id: number;
  readonly lote: number;
  readonly ordem: number;
  readonly prontuario: number;
  readonly internacao: number | null;
  readonly paciente: number;
  readonly nome: string;
  readonly tipoDocumento: TipoDocumentoDigitalizado;
  readonly descricao: string;
  readonly dataDocumento: string;
  readonly paginas: number;
  readonly resolucaoDpi: number;
  readonly cor: CorDigitalizacao;
  readonly hash: string;
  readonly tamanho: number;
  readonly situacao: SituacaoDigitalizacao;
  readonly capturadoPor: string;
  readonly capturadoEm: string;
  readonly conferidoPor: string | null;
  readonly conferidoEm: string | null;
  readonly motivo: string | null;
  readonly assinatura: number | null;
  readonly assinadoPor: string | null;
  readonly assinadoEm: string | null;
  readonly carimboEm: string | null;
  /** O papel fica guardado (o sistema nunca elimina; destinação na Fase 6). */
  readonly destinacao: 'guardar';
  readonly guardaAte: string;
  readonly versao: number;
}

export interface FilaDigitalizacao {
  readonly itens: readonly DigitalizacaoLida[];
  readonly cortada: boolean;
  readonly contagens: Readonly<Record<SituacaoDigitalizacao, number>>;
  readonly lidoEm: string;
}

export interface PacienteDigitalizacao {
  readonly prontuario: number;
  readonly paciente: number;
  readonly nome: string;
  readonly internacoes: readonly {
    readonly reg: number;
    readonly entrada: string;
    readonly saida: string | null;
  }[];
}

export interface ResultadoDigitalizacao {
  readonly ok: true;
  readonly id: number;
  readonly lote: number;
  readonly situacao: SituacaoDigitalizacao;
  readonly mensagem: string;
}

export interface GravacaoDigitalizacao {
  readonly ligada: boolean;
  readonly motivo: string | null;
  readonly operacoes: Readonly<Record<string, { readonly pode: boolean; readonly motivo: string | null }>>;
  /** Quem está na sessão (a tela esconde "conferir" do que a própria pessoa capturou). */
  readonly login: string;
}

export const esquemaDigitalizacaoLida = z.object({
  id: z.number().int(),
  lote: z.number().int(),
  ordem: z.number().int(),
  prontuario: z.number().int(),
  internacao: z.number().int().nullable(),
  paciente: z.number().int(),
  nome: z.string(),
  tipoDocumento: z.enum(TIPOS_DOCUMENTO_DIGITALIZADO),
  descricao: z.string(),
  dataDocumento: z.string(),
  paginas: z.number().int(),
  resolucaoDpi: z.number().int(),
  cor: z.enum(CORES_DIGITALIZACAO),
  hash: z.string(),
  tamanho: z.number().int(),
  situacao: z.enum(SITUACOES_DIGITALIZACAO),
  capturadoPor: z.string(),
  capturadoEm: z.string(),
  conferidoPor: z.string().nullable(),
  conferidoEm: z.string().nullable(),
  motivo: z.string().nullable(),
  assinatura: z.number().int().nullable(),
  assinadoPor: z.string().nullable(),
  assinadoEm: z.string().nullable(),
  carimboEm: z.string().nullable(),
  destinacao: z.literal('guardar'),
  guardaAte: z.string(),
  versao: z.number().int(),
});
export const esquemaFilaDigitalizacao = z.object({
  itens: z.array(esquemaDigitalizacaoLida),
  cortada: z.boolean(),
  contagens: z.object({
    capturado: z.number().int(),
    conferido: z.number().int(),
    recusado: z.number().int(),
    assinado: z.number().int(),
  }),
  lidoEm: z.string(),
});
export const esquemaPacienteDigitalizacao = z.object({
  prontuario: z.number().int(),
  paciente: z.number().int(),
  nome: z.string(),
  internacoes: z.array(
    z.object({ reg: z.number().int(), entrada: z.string(), saida: z.string().nullable() }),
  ),
});
export const esquemaResultadoDigitalizacao = z.object({
  ok: z.literal(true),
  id: z.number().int(),
  lote: z.number().int(),
  situacao: z.enum(SITUACOES_DIGITALIZACAO),
  mensagem: z.string(),
});
export const esquemaGravacaoDigitalizacao = z.object({
  ligada: z.boolean(),
  motivo: z.string().nullable(),
  operacoes: z.record(z.string(), z.object({ pode: z.boolean(), motivo: z.string().nullable() })),
  login: z.string(),
});
