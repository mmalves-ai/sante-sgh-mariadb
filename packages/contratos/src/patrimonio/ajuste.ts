// W0-08, parte 7 (mercado M1; CPC 27 itens 51 e 61, CPC 23 item 32 e CPC 01; matriz, linhas "Patrimônio" e
// "Contábil"): os ajustes do valor do bem são EVENTOS, nunca edição do cadastro nem das cotas já calculadas.
//   - revisão de estimativa: nova vida útil restante e novo residual, prospectiva (vale da próxima competência sem
//     cálculo em diante; as cotas passadas não mudam);
//   - perda por impairment (CPC 01): o valor recuperável do laudo abaixo do valor contábil; a diferença é a perda,
//     lançada na contabilidade, e a depreciação seguinte parte do valor recuperável;
//   - reavaliação: registrada como evento informativo, com o laudo e o valor justo, SEM lançamento (a Lei 11.638/2007
//     vedou a reavaliação espontânea do imobilizado; o valor contábil não muda).
// O ajuste se corrige por estorno (fato novo com motivo, data e origem), pelo mesmo caminho do estorno da depreciação.
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';

export const TIPOS_AJUSTE_BEM = ['revisao-estimativa', 'impairment', 'reavaliacao'] as const;
export type TipoAjusteBem = (typeof TIPOS_AJUSTE_BEM)[number];
export const ROTULOS_TIPO_AJUSTE_BEM: Readonly<Record<TipoAjusteBem, string>> = {
  'revisao-estimativa': 'Revisão de vida útil e residual',
  impairment: 'Perda por redução ao valor recuperável (impairment)',
  reavaliacao: 'Reavaliação (evento, sem lançamento)',
};

/** Origem gravada no ajuste e no estorno dele (a trilha contábil diz de onde veio o fato). */
export const ORIGEM_AJUSTE_BEM = 'patrimonio/ajuste-bem';
export const ORIGEM_ESTORNO_AJUSTE_BEM = 'patrimonio/estorno-ajuste-bem';

const id = z.number().int().positive();
const centavos = z.number().int().min(0).max(99_999_999_999);
const motivo = (msg: string) =>
  textoCp1252(500)
    .pipe(z.string().trim().min(1, msg))
    .refine((v) => v.trim().length >= 5, 'Descreva o motivo (pelo menos 5 caracteres).');
const base = {
  bem: id,
  /** A versão do bem lida (o ajuste concorrente devolve 409). */
  versao: z.number().int().min(0),
  motivo: motivo('Informe o motivo do ajuste.'),
};

export const esquemaRegistrarAjusteBem = z.discriminatedUnion('tipo', [
  z
    .object({
      ...base,
      tipo: z.literal('revisao-estimativa'),
      /** Meses de vida útil que restam a partir da próxima competência sem cálculo. */
      vidaRestanteMeses: z.number().int().min(1).max(1200),
      residualCent: centavos,
      /** O laudo ou parecer técnico anexado ao bem (LaudoBem); opcional na revisão. */
      laudo: id.nullable().default(null),
    })
    .strict(),
  z
    .object({
      ...base,
      tipo: z.literal('impairment'),
      /** O valor recuperável do laudo (o maior entre o valor justo líquido e o valor em uso; CPC 01, item 18). */
      recuperavelCent: centavos,
      /** O laudo do teste de recuperabilidade anexado ao bem (LaudoBem): obrigatório. */
      laudo: id,
    })
    .strict(),
  z
    .object({
      ...base,
      tipo: z.literal('reavaliacao'),
      valorJustoCent: centavos,
      laudo: id,
    })
    .strict(),
]);
export type RegistrarAjusteBem = z.infer<typeof esquemaRegistrarAjusteBem>;

export const esquemaEstornarAjusteBem = z.object({ motivo: motivo('Informe o motivo do estorno.') }).strict();
export type EstornarAjusteBem = z.infer<typeof esquemaEstornarAjusteBem>;

/** O ajuste gravado (SGH_PAT_AJUSTE). */
export interface AjusteBem {
  readonly id: number;
  readonly bem: number;
  readonly tipo: TipoAjusteBem;
  /** A última competência com cota antes do ajuste: ele vale da seguinte em diante. */
  readonly competenciaMarco: string;
  /** Data do lançamento (a do registro). */
  readonly data: string;
  readonly valorContabilAntesCent: number;
  readonly valorContabilDepoisCent: number;
  /** A depreciação acumulada do bem no marco. */
  readonly acumuladaMarcoCent: number;
  /** Perda por impairment (0 nos demais). */
  readonly perdaCent: number;
  readonly residualCent: number;
  readonly vidaRestanteMeses: number;
  /** Valor justo da reavaliação (null nos demais). */
  readonly valorJustoCent: number | null;
  readonly laudo: number | null;
  readonly motivo: string;
  readonly origem: string;
  readonly registradoPor: string;
  readonly registradoEm: string;
  readonly estorno: {
    readonly motivo: string;
    readonly origem: string;
    readonly estornadoPor: string;
    readonly estornadoEm: string;
  } | null;
}

// ── Laudo do ajuste (W0-08, achado 6 da revisão; CPC 01 e CPC 27; RDC 509 art. 8º, guarda ≥ 5 anos) ─────────────────
// O laudo do teste de recuperabilidade, da reavaliação ou o parecer da revisão é um PDF anexado AO BEM: o arquivo vai ao
// armazenamento de objetos com Object Lock (nunca sobrescreve; a chave sai do SHA-256) e o banco guarda só a chave, o
// resumo e o nome (SGH_PAT_LAUDO, script 1109). É registro imutável: não se altera nem se exclui (o laudo errado
// simplesmente não é usado; o certo se anexa de novo). O ajuste só aceita laudo anexado ao MESMO bem (409
// `laudo-inexistente`).

/** O corpo da requisição tem 1 MiB: o PDF em base64 cabe até ~700 KB (o laudo digitalizado em tons de cinza cabe). */
export const TAMANHO_MAXIMO_LAUDO_BEM = 700_000;

export const esquemaAnexarLaudoBem = z
  .object({
    /** Nome do arquivo enviado (só para exibir). */
    nome: textoCp1252(120).pipe(z.string().trim().min(1, 'Informe o nome do arquivo.')),
    /** O que é o laudo (ex.: "Teste de recuperabilidade 2026, engenharia clínica"). */
    descricao: textoCp1252(200).pipe(z.string().trim().min(3, 'Descreva o laudo (pelo menos 3 caracteres).')),
    /** O PDF em base64. */
    conteudo: z
      .string()
      .min(8, 'Escolha o arquivo PDF do laudo.')
      .max(Math.ceil((TAMANHO_MAXIMO_LAUDO_BEM * 4) / 3) + 4, 'O PDF do laudo tem de ter até 700 KB.')
      .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'Arquivo inválido.'),
  })
  .strict();
export type AnexarLaudoBem = z.infer<typeof esquemaAnexarLaudoBem>;

/** O laudo anexado ao bem (SGH_PAT_LAUDO). */
export interface LaudoBem {
  readonly id: number;
  readonly bem: number;
  readonly nome: string;
  readonly descricao: string;
  /** SHA-256 do PDF (o arquivo baixado é conferido contra ele). */
  readonly sha256: string;
  readonly tamanho: number;
  readonly enviadoPor: string;
  readonly enviadoEm: string;
}
