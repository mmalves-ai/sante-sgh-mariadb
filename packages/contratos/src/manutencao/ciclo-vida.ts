// W0-08, parte 9 (mercado M3: treinamento dos operadores e ciclo de vida do equipamento; RDC 509/2021, arts. 8º, 15 e
// 16: o plano de gerenciamento das tecnologias em saúde, a capacitação de quem opera, a rastreabilidade até o descarte
// e a guarda por 5 anos): o curso do catálogo do treinamento (pessoas, f6) exigido para operar um MODELO de equipamento
// (fabricante + modelo), a lista de aptos (concluíram todos os cursos exigidos, dentro da validade), o índice de
// obsolescência (idade, custo e falhas, com as parcelas) e os eventos do ciclo de vida (incorporação, desativação e
// descarte; só inclusão). Tudo em SGH_MAN_MODELO_CURSO e SGH_MAN_EQUIP_EVENTO (script 1107).
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';

export const TIPOS_EVENTO_CICLO = {
  incorporacao: 'Incorporação',
  desativacao: 'Desativação',
  descarte: 'Descarte',
} as const;
export type TipoEventoCiclo = keyof typeof TIPOS_EVENTO_CICLO;
export const CODIGOS_TIPO_EVENTO_CICLO = Object.keys(TIPOS_EVENTO_CICLO) as [
  TipoEventoCiclo,
  ...TipoEventoCiclo[],
];

/** A destinação final no descarte (RDC 509, art. 16; RDC 222/2018 para o resíduo). */
export const DESTINOS_DESCARTE = {
  residuo: 'Resíduo (plano de gerenciamento de resíduos)',
  doacao: 'Doação',
  venda: 'Venda ou leilão',
  devolucao: 'Devolução ao fabricante ou locador',
} as const;
export type DestinoDescarte = keyof typeof DESTINOS_DESCARTE;
export const CODIGOS_DESTINO_DESCARTE = Object.keys(DESTINOS_DESCARTE) as [
  DestinoDescarte,
  ...DestinoDescarte[],
];

/** A faixa do índice de obsolescência (0 a 100). */
export const FAIXAS_OBSOLESCENCIA = {
  manter: 'Manter',
  acompanhar: 'Acompanhar (planejar a substituição)',
  substituir: 'Substituir',
} as const;
export type FaixaObsolescencia = keyof typeof FAIXAS_OBSOLESCENCIA;

/** As recusas próprias do treinamento por modelo e do ciclo de vida (a tela traduz pelo código). */
export type RecusaCicloVida =
  | 'desatualizado'
  | 'vinculo-repetido'
  | 'curso-inativo'
  | 'evento-repetido'
  | 'fora-de-ordem'
  | 'sem-desativacao'
  | 'data-futura'
  | 'descarte-incompleto'
  | 'equipamento-descartado';

const id = z.number().int().positive();
const data = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'Data no formato AAAA-MM-DD.');
const motivo = textoCp1252(500)
  .transform((v) => v.trim())
  .pipe(z.string().min(10, 'Explique com pelo menos 10 caracteres.'));
const opcional = (n: number) =>
  textoCp1252(n)
    .transform((v) => v.trim())
    .nullable()
    .default(null)
    .transform((v) => (v === null || v === '' ? null : v));

/** Exigir um curso do catálogo para operar o modelo (fabricante + modelo, comparados sem acento nem caixa). */
export const esquemaVincularCursoModelo = z
  .object({
    fabricante: textoCp1252(60)
      .transform((v) => v.trim())
      .pipe(z.string().min(2, 'Informe o fabricante.')),
    modelo: textoCp1252(60)
      .transform((v) => v.trim())
      .pipe(z.string().min(1, 'Informe o modelo.')),
    curso: id,
  })
  .strict();
export type VincularCursoModeloEntrada = z.infer<typeof esquemaVincularCursoModelo>;

/** Deixar de exigir o curso (exclusão física com o retrato e o motivo: nada depende do vínculo). */
export const esquemaDesvincularCursoModelo = z.object({ id, motivo }).strict();
export type DesvincularCursoModeloEntrada = z.infer<typeof esquemaDesvincularCursoModelo>;

/**
 * Registrar um evento do ciclo de vida (fato novo, nunca editado). A desativação marca o equipamento desativado; o
 * descarte exige a desativação antes, o documento (laudo ou certificado de destinação) e o destino. A trilha guarda a
 * data, a causa (motivo), o valor contábil (lido do bem, quando houver), o valor obtido e quem autorizou.
 */
export const esquemaRegistrarEventoCiclo = z
  .object({
    equipamento: id,
    tipo: z.enum(CODIGOS_TIPO_EVENTO_CICLO),
    data,
    motivo,
    documento: opcional(60),
    destino: z.enum(CODIGOS_DESTINO_DESCARTE).nullable().default(null),
    valorObtidoCent: z.number().int().min(0).nullable().default(null),
    autorizadoPor: textoCp1252(70)
      .transform((v) => v.trim())
      .pipe(z.string().min(3, 'Informe quem autorizou.')),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.tipo !== 'descarte') return;
    if (!v.documento)
      ctx.addIssue({
        code: 'custom',
        path: ['documento'],
        message: 'Informe o laudo ou o certificado de destinação.',
      });
    if (!v.destino)
      ctx.addIssue({ code: 'custom', path: ['destino'], message: 'Informe o destino do descarte.' });
  });
export type RegistrarEventoCicloEntrada = z.infer<typeof esquemaRegistrarEventoCiclo>;

// ── Respostas ────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface CursoDoModelo {
  readonly id: number;
  readonly fabricante: string;
  readonly modelo: string;
  readonly curso: number;
  readonly cursoCodigo: string;
  readonly cursoTitulo: string;
  readonly cursoAtivo: boolean;
  readonly validadeMeses: number;
  readonly criadoPor: string;
  readonly criadoEm: string;
}

/** Uma conclusão válida do curso (aprovado ou sem avaliação, presente, com a data). */
export interface ConclusaoDeCurso {
  readonly vinculo: number;
  readonly nome: string;
  readonly matricula: string | null;
  readonly curso: number;
  readonly conclusao: string;
  /** Nula: o curso não vence. */
  readonly validoAte: string | null;
}

export interface OperadorApto {
  readonly vinculo: number;
  readonly nome: string;
  readonly matricula: string | null;
  /** A validade mais curta entre os cursos exigidos (nula: nenhum vence). */
  readonly validoAte: string | null;
}

export interface OperadorPendente {
  readonly vinculo: number;
  readonly nome: string;
  readonly matricula: string | null;
  /** Os cursos exigidos que faltam ou venceram (IDs). */
  readonly faltam: readonly number[];
  readonly vencidos: readonly number[];
}

export interface OperadoresDoModelo {
  readonly cursos: readonly CursoDoModelo[];
  readonly aptos: readonly OperadorApto[];
  /** Quem concluiu parte dos cursos ou deixou vencer (a lista do próximo treinamento). */
  readonly pendentes: readonly OperadorPendente[];
}

export interface ParcelaObsolescencia {
  /** Os pontos da parcela (0 até o peso). */
  readonly pontos: number;
  readonly peso: number;
  /** A razão usada (0 a 1, já limitada). Nula: sem base para calcular (a parcela vale 0). */
  readonly razao: number | null;
}

export interface IndiceObsolescencia {
  /** A soma das três parcelas (0 a 100), impressa com elas. */
  readonly indice: number;
  readonly faixa: FaixaObsolescencia;
  readonly janelaMeses: number;
  readonly idade: ParcelaObsolescencia & {
    readonly idadeMeses: number | null;
    readonly vidaUtilMeses: number;
  };
  readonly custo: ParcelaObsolescencia & { readonly custoCent: number; readonly valorCent: number | null };
  readonly falhas: ParcelaObsolescencia & { readonly corretivas: number; readonly teto: number };
}

export interface EventoCicloVida {
  readonly id: number;
  readonly equipamento: number;
  readonly tipo: TipoEventoCiclo;
  readonly data: string;
  readonly motivo: string;
  readonly documento: string | null;
  readonly destino: DestinoDescarte | null;
  /** O valor contábil do bem na data (lido do patrimônio; nulo sem bem ligado). */
  readonly valorContabilCent: number | null;
  readonly valorObtidoCent: number | null;
  readonly autorizadoPor: string;
  readonly por: string;
  readonly em: string;
}
