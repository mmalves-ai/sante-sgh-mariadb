// Codec e validador de entrada CP1252 (ADR 0008; cap-10 §10.7; regra 6 do M07).
// O banco do legado tem charset NONE e guarda texto em CP1252: o que não existe na tabela não entra.
// O MESMO validador roda na tela (@sgh/ui) e no servidor (Zod do contrato): nunca divergem.
import { z } from 'zod';
import type { FalhaValidacao } from '../validacao/erro.js';

/** Bytes 0x80 a 0x9F do CP1252 (Windows-1252). `null` = posição não definida na tabela. */
const FAIXA_80_9F: readonly (number | null)[] = [
  0x20ac,
  null,
  0x201a,
  0x0192,
  0x201e,
  0x2026,
  0x2020,
  0x2021,
  0x02c6,
  0x2030,
  0x0160,
  0x2039,
  0x0152,
  null,
  0x017d,
  null,
  null,
  0x2018,
  0x2019,
  0x201c,
  0x201d,
  0x2022,
  0x2013,
  0x2014,
  0x02dc,
  0x2122,
  0x0161,
  0x203a,
  0x0153,
  null,
  0x017e,
  0x0178,
];

/** Bytes que o CP1252 não define (0x81, 0x8D, 0x8F, 0x90, 0x9D). */
export const BYTES_INDEFINIDOS: readonly number[] = FAIXA_80_9F.flatMap((c, i) =>
  c === null ? [0x80 + i] : [],
);

const BYTE_PARA_CODIGO: readonly (number | null)[] = Array.from({ length: 256 }, (_, b) =>
  b < 0x80 || b > 0x9f ? b : (FAIXA_80_9F[b - 0x80] ?? null),
);

const CODIGO_PARA_BYTE = new Map<number, number>();
BYTE_PARA_CODIGO.forEach((codigo, byte) => {
  if (codigo !== null) CODIGO_PARA_BYTE.set(codigo, byte);
});

/** Caractere Unicode de um byte CP1252, ou null se o byte não é definido. */
export function caractereDoByte(byte: number): string | null {
  const codigo = BYTE_PARA_CODIGO[byte];
  return codigo === null || codigo === undefined ? null : String.fromCodePoint(codigo);
}

/** Byte CP1252 de um caractere (um ponto de código), ou null se não existe no CP1252. */
export function byteDoCaractere(caractere: string): number | null {
  const codigo = caractere.codePointAt(0);
  if (codigo === undefined || [...caractere].length !== 1) return null;
  return CODIGO_PARA_BYTE.get(codigo) ?? null;
}

export class ErroCp1252 extends Error {
  override readonly name = 'ErroCp1252';
}

/** Texto → bytes CP1252. Lança se houver caractere fora da tabela (nunca troca por "?" em silêncio). */
export function codificarCp1252(texto: string): Uint8Array {
  const saida: number[] = [];
  let posicao = 0;
  for (const c of texto) {
    const b = byteDoCaractere(c);
    if (b === null) throw new ErroCp1252(`caractere U+${hex(c)} na posição ${posicao} não existe no CP1252`);
    saida.push(b);
    posicao++;
  }
  return Uint8Array.from(saida);
}

/** Bytes CP1252 → texto. Byte indefinido lança (o leitor do adaptador decide como marcar). */
export function decodificarCp1252(bytes: Uint8Array): string {
  let s = '';
  bytes.forEach((b, i) => {
    const c = caractereDoByte(b);
    if (c === null) throw new ErroCp1252(`byte 0x${b.toString(16)} na posição ${i} não é definido no CP1252`);
    s += c;
  });
  return s;
}

function hex(c: string): string {
  return (c.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Trocas propostas para símbolos fora do CP1252 (mostradas antes de salvar, nunca aplicadas em silêncio).
 * Aspas curvas, travessão, meia-risca, reticências, € e • existem no CP1252 e ficam como estão.
 */
export const TROCAS_PROPOSTAS: Readonly<Record<string, string>> = Object.freeze({
  '≥': '>=',
  '≤': '<=',
  '≠': '<>',
  '≈': '~',
  '−': '-', // sinal de menos
  '‐': '-', // hífen tipográfico
  '‑': '-', // hífen inseparável
  '‒': '-',
  '→': '->',
  '←': '<-',
  '↑': '^',
  '⇒': '=>',
  '′': "'",
  '″': '"',
  '∞': 'infinito',
  '√': 'raiz de ',
  Δ: 'delta',
  α: 'alfa',
  β: 'beta',
  γ: 'gama',
  '\u03bc': '\u00b5', // mi grego → sinal de micro (este existe no CP1252)
  Ω: 'ohm',
  '℃': '°C',
  '№': 'nº',
  '✓': 'ok',
  '✔': 'ok',
  '✗': 'x',
});

/** Espaços especiais que viram espaço comum (colagem de documentos e páginas). */
const ESPACOS_ESPECIAIS = /[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g;
/** Caracteres invisíveis removidos (largura zero, marca de ordem de byte). */
const INVISIVEIS = /[\u200b-\u200d\u2060\ufeff]/g;

/** Controles aceitos no texto (tabulação e quebra de linha); os demais controles são recusados. */
const CONTROLES_ACEITOS = new Set([0x09, 0x0a, 0x0d]);

export type MotivoRecusa = 'emoji' | 'fora-do-cp1252' | 'controle';

export interface CaractereRecusado {
  readonly caractere: string;
  /** Posição (em caracteres) no texto normalizado. */
  readonly posicao: number;
  /** Ponto de código, como "U+1F600". */
  readonly codigo: string;
  readonly motivo: MotivoRecusa;
  /** Troca proposta, quando existe. */
  readonly troca: string | null;
}

export interface AnaliseCp1252 {
  /** Texto depois das normalizações automáticas (NFC, espaços especiais, invisíveis). */
  readonly normalizado: string;
  readonly recusados: readonly CaractereRecusado[];
  /** Bytes que o texto ocupa no CP1252 (1 por caractere). */
  readonly bytes: number;
  /** Texto com as trocas propostas aplicadas, se TODOS os recusados tiverem troca; senão null. */
  readonly proposta: string | null;
}

const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|\u{fe0f}|\u{20e3}/u;

/** Normalizações automáticas e seguras: composição NFC, espaço especial → espaço, invisíveis removidos. */
export function normalizarEntrada(texto: string): string {
  return texto.normalize('NFC').replace(ESPACOS_ESPECIAIS, ' ').replace(INVISIVEIS, '');
}

export function analisarCp1252(texto: string): AnaliseCp1252 {
  const normalizado = normalizarEntrada(texto);
  const recusados: CaractereRecusado[] = [];
  let posicao = 0;
  let proposta = '';
  let todosComTroca = true;
  for (const c of normalizado) {
    const codigo = c.codePointAt(0) ?? 0;
    const byte = byteDoCaractere(c);
    const controle = codigo < 0x20 || (codigo >= 0x7f && codigo <= 0x9f);
    if (byte !== null && !(controle && !CONTROLES_ACEITOS.has(codigo))) {
      proposta += c;
    } else {
      const motivo: MotivoRecusa = EMOJI.test(c) ? 'emoji' : controle ? 'controle' : 'fora-do-cp1252';
      const troca = TROCAS_PROPOSTAS[c] ?? null;
      if (troca === null) todosComTroca = false;
      else proposta += troca;
      recusados.push({ caractere: c, posicao, codigo: `U+${hex(c)}`, motivo, troca });
    }
    posicao++;
  }
  return {
    normalizado,
    recusados,
    bytes: posicao,
    proposta: recusados.length > 0 && todosComTroca ? proposta : null,
  };
}

/**
 * Falha do texto como CÓDIGO e parâmetros (a tela traduz por `ui.validacao.<codigo>`; regra 15).
 * `mais` = quantos outros caracteres recusados; `comTroca` = há troca proposta para todos.
 */
export function falhaCp1252(analise: AnaliseCp1252, maxBytes?: number): FalhaValidacao | null {
  if (analise.recusados.length > 0) {
    const r = analise.recusados[0]!;
    const codigo =
      r.motivo === 'emoji'
        ? 'cp1252.emoji'
        : r.motivo === 'controle'
          ? 'cp1252.controle'
          : 'cp1252.caractere';
    return {
      codigo,
      parametros: {
        caractere: r.caractere,
        mais: analise.recusados.length - 1,
        comTroca: analise.proposta !== null,
      },
    };
  }
  if (maxBytes !== undefined && analise.bytes > maxBytes) {
    return { codigo: 'texto.tamanho', parametros: { bytes: analise.bytes, maxBytes } };
  }
  return null;
}

/** Mensagens em português claro para o servidor e os testes (a tela usa falhaCp1252 + vue-i18n). */
export function mensagemCp1252(analise: AnaliseCp1252, maxBytes?: number): string | null {
  const f = falhaCp1252(analise, maxBytes);
  if (f === null) return null;
  const p = f.parametros;
  if (f.codigo === 'texto.tamanho') {
    return `O texto tem ${p['bytes']} caracteres; o limite deste campo é ${p['maxBytes']}.`;
  }
  const qual =
    f.codigo === 'cp1252.emoji'
      ? 'Emoji não pode ser gravado neste campo'
      : f.codigo === 'cp1252.controle'
        ? 'Há um caractere de controle invisível no texto'
        : `O caractere "${p['caractere']}" não pode ser gravado neste campo`;
  const mais = Number(p['mais']);
  const extra = mais > 0 ? ` (e mais ${mais})` : '';
  const como = p['comTroca']
    ? ' Use a troca proposta antes de salvar.'
    : ' Apague-o ou troque por letras e símbolos comuns.';
  return `${qual}${extra}.${como}`;
}

/**
 * Schema Zod de texto CP1252: normaliza (NFC, espaços), recusa emoji e caractere fora do CP1252 e limita
 * pelo tamanho da coluna legada em bytes. Usado pela tela e pelo servidor.
 */
export function esquemaTextoCp1252(opcoes: { readonly maxBytes: number }) {
  return z
    .string()
    .transform((t) => normalizarEntrada(t))
    .superRefine((t, ctx) => {
      const analise = analisarCp1252(t);
      const falha = falhaCp1252(analise, opcoes.maxBytes);
      const mensagem = mensagemCp1252(analise, opcoes.maxBytes);
      if (falha !== null && mensagem !== null) {
        ctx.addIssue({
          code: 'custom',
          message: mensagem,
          params: {
            regra: analise.recusados.length > 0 ? 'cp1252' : 'tamanho',
            codigo: falha.codigo,
            parametros: falha.parametros,
            proposta: analise.proposta,
            recusados: analise.recusados.map((r) => r.codigo),
          },
        });
      }
    });
}
