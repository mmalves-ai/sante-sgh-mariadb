// Conversão do texto para UTF-8 (M58-F3; ficha, seção 5, passos 3 a 5; regra 7; cap-10 §10.2, §10.7 e §10.13): as
// peças puras que o bombeamento do ensaio e a prova de equivalência usam. Nenhuma lê banco.
// - Classe de cada coluna: CHAR/VARCHAR em NONE com bytes CP1252 → transliterada pela tabela sem perda (cp1252.ts);
//   catalogada como UTF-8 (colunas-utf8.ts) → bytes como estão, validados; BLOB → mantido em bytes (D-BLOB-F3-58).
// - A tabela do motor (WIN1252 → UTF8) troca os 5 bytes indefinidos por U+0000 (sonda de 2026-10-27, ADR 0032): por
//   isso a transliteração é feita aqui, e eles viram os controles C1 de mesmo número, que voltam ao mesmo byte.
// - Equivalência: resumo de cada coluna, independente da ordem das linhas (soma dos SHA-256 dos valores decodificados,
//   módulo 2^128, com a contagem de linhas e de nulos): iguais antes e depois ⇒ o mesmo texto, sem levar o texto.
// - Fontes PSQL: onde está cada byte acima de 127 (comentário, literal ou código) e se o literal pede revisão.
import { createHash, hash } from 'node:crypto';
import { type ClasseConversao, MOTIVOS_LITERAL_UTF8, type MotivoLiteralUtf8 } from '@sgh/contratos';
import { contemUtf8Multibyte } from '../codec.js';
import { colunaUtf8 } from '../colunas-utf8.js';
import { BYTES_INDEFINIDOS_CP1252, codificarCp1252, decodificarCp1252 } from '../cp1252.js';

export class ErroConversao extends Error {
  override readonly name = 'ErroConversao';
}

// ── Classe de conversão ──────────────────────────────────────────────────────────────────────────────────

export interface ColunaConversao {
  readonly tabela: string;
  readonly coluna: string;
  readonly tipo: 'CHAR' | 'VARCHAR' | 'BLOB';
}

export function classeConversao(c: ColunaConversao): ClasseConversao {
  if (c.tipo === 'BLOB') return 'bytes';
  return colunaUtf8(c.tabela, c.coluna) ? 'utf8-catalogada' : 'cp1252';
}

// ── Valor ────────────────────────────────────────────────────────────────────────────────────────────────

export interface ValorConvertido {
  /** O texto que vai ao banco UTF-8. */
  readonly texto: string;
  /** Algum dos 5 bytes indefinidos do CP1252 (vai como o controle C1 de mesmo número). */
  readonly byteIndefinido: boolean;
  /** Texto misto (UTF-8 de integração numa coluna CP1252): transliterado como está e contado no relatório. */
  readonly misto: boolean;
  /** Coluna catalogada como UTF-8 com bytes que não são UTF-8 válido: vai como CP1252, contado no relatório. */
  readonly utf8Invalido: boolean;
}

const INDEFINIDOS = new Set(BYTES_INDEFINIDOS_CP1252);
const utf8Estrito = () => new TextDecoder('utf-8', { fatal: true });

/** Os bytes gravados na base (NONE) → o texto do banco UTF-8. BLOB não passa aqui (fica em bytes). */
export function converterValor(bytes: Uint8Array, classe: ClasseConversao): ValorConvertido {
  if (classe === 'bytes') throw new ErroConversao('BLOB fica em bytes: não se converte (D-BLOB-F3-58).');
  const byteIndefinido = bytes.some((b) => INDEFINIDOS.has(b));
  if (classe === 'utf8-catalogada') {
    try {
      return { texto: utf8Estrito().decode(bytes), byteIndefinido: false, misto: false, utf8Invalido: false };
    } catch {
      return { texto: decodificarCp1252(bytes), byteIndefinido, misto: true, utf8Invalido: true };
    }
  }
  return {
    texto: decodificarCp1252(bytes),
    byteIndefinido,
    misto: contemUtf8Multibyte(bytes),
    utf8Invalido: false,
  };
}

/** O caminho de volta (o texto do banco UTF-8 → os bytes da base): a ida e volta tem de dar os mesmos bytes. */
export function voltarValor(texto: string, classe: ClasseConversao, utf8Invalido = false): Buffer {
  if (classe === 'bytes') throw new ErroConversao('BLOB fica em bytes: não se converte (D-BLOB-F3-58).');
  if (classe === 'utf8-catalogada' && !utf8Invalido) return Buffer.from(texto, 'utf8');
  return codificarCp1252(texto);
}

/** A ida e volta de um valor fecha (mesmos bytes)? */
export function idaEVoltaFecha(bytes: Uint8Array, classe: ClasseConversao): boolean {
  const v = converterValor(bytes, classe);
  return Buffer.from(bytes).equals(voltarValor(v.texto, classe, v.utf8Invalido));
}

// ── Equivalência (antes e depois, sem levar o texto) ─────────────────────────────────────────────────────

const MOD_128 = 1n << 128n;

/** O resumo de uma coluna: independe da ordem das linhas; CHAR comparado sem o preenchimento. */
export class ResumoColuna {
  private linhas = 0;
  private nulos = 0;
  /**
   * A soma (mod 2^128) dos 16 primeiros bytes de cada SHA-256, em 4 partes de 32 bits (a menos significativa em [0]):
   * o mesmo valor do BigInt, sem um BigInt por valor (M58.3: a prova das 195 milhões de linhas era limitada por CPU).
   */
  private readonly partes = [0, 0, 0, 0];

  private readonly semPreenchimento: boolean;

  constructor(semPreenchimento = false) {
    this.semPreenchimento = semPreenchimento;
  }

  somar(valor: string | null): void {
    this.linhas++;
    if (valor === null) {
      this.nulos++;
      return;
    }
    const v = this.semPreenchimento ? valor.replace(/ +$/, '') : valor;
    const h = hash('sha256', v, 'buffer');
    const p = this.partes;
    let vai = 0;
    for (let i = 0; i < 4; i++) {
      const x = (p[i] as number) + h.readUInt32BE(12 - 4 * i) + vai;
      vai = x >= 0x1_0000_0000 ? 1 : 0;
      p[i] = x - vai * 0x1_0000_0000;
    }
  }

  private get soma(): bigint {
    const p = this.partes;
    return (
      ((BigInt(p[3] as number) << 96n) |
        (BigInt(p[2] as number) << 64n) |
        (BigInt(p[1] as number) << 32n) |
        BigInt(p[0] as number)) %
      MOD_128
    );
  }

  /** SHA-256 de "linhas|nulos|soma": só o resumo sai do processo. */
  resumo(): string {
    return createHash('sha256')
      .update(`${this.linhas}|${this.nulos}|${this.soma.toString(16)}`)
      .digest('hex');
  }

  get total(): number {
    return this.linhas;
  }
}

/** O resumo de uma lista "TABELA.COLUNA=resumo" (ordenada): iguais ⇒ todas as colunas iguais. */
export function resumoDaLista(resumos: Readonly<Record<string, string>>): string {
  const linhas = Object.keys(resumos)
    .sort()
    .map((k) => `${k}=${resumos[k]}`);
  return createHash('sha256').update(linhas.join('\n')).digest('hex');
}

// ── Fontes PSQL (literais com acento) ────────────────────────────────────────────────────────────────────

export interface AnaliseFontePsql {
  /** Bytes acima de 127 em cada lugar da fonte. */
  readonly emComentario: number;
  readonly emLiteral: number;
  readonly emCodigo: number;
  /** O literal tem byte indefinido do CP1252 ou sequência UTF-8: pede revisão um a um. */
  readonly aRever: boolean;
  /** A fonte decodificada como CP1252 e recodificada dá os mesmos bytes (a letra do literal não muda). */
  readonly idaEVolta: boolean;
}

interface FonteVarrida {
  readonly emComentario: number;
  readonly emLiteral: number;
  readonly emCodigo: number;
  /** Os literais entre aspas simples, na ordem da fonte (com `''` desfeito). */
  readonly literais: Uint8Array[];
}

/**
 * Percorre a fonte (bytes) separando comentário de linha (`--`), de bloco e literal entre aspas simples (com `''`).
 * Identificador entre aspas duplas conta como código. Serve aos bytes em CP1252 e em UTF-8 (as marcas são ASCII).
 */
function varrerFontePsql(fonte: Uint8Array): FonteVarrida {
  let emComentario = 0;
  let emLiteral = 0;
  let emCodigo = 0;
  const literais: number[][] = [];
  let atual: number[] | null = null;
  let estado: 'codigo' | 'linha' | 'bloco' | 'literal' = 'codigo';
  for (let i = 0; i < fonte.length; i++) {
    const b = fonte[i] as number;
    const prox = fonte[i + 1];
    if (estado === 'codigo') {
      if (b === 0x2d && prox === 0x2d) {
        estado = 'linha';
        i++;
        continue;
      }
      if (b === 0x2f && prox === 0x2a) {
        estado = 'bloco';
        i++;
        continue;
      }
      if (b === 0x27) {
        estado = 'literal';
        atual = [];
        continue;
      }
      if (b > 127) emCodigo++;
    } else if (estado === 'linha') {
      if (b === 0x0a) estado = 'codigo';
      else if (b > 127) emComentario++;
    } else if (estado === 'bloco') {
      if (b === 0x2a && prox === 0x2f) {
        estado = 'codigo';
        i++;
      } else if (b > 127) emComentario++;
    } else {
      if (b === 0x27 && prox === 0x27) {
        atual?.push(b);
        i++;
        continue;
      }
      if (b === 0x27) {
        if (atual) literais.push(atual);
        atual = null;
        estado = 'codigo';
        continue;
      }
      atual?.push(b);
      if (b > 127) emLiteral++;
    }
  }
  if (atual) literais.push(atual);
  return { emComentario, emLiteral, emCodigo, literais: literais.map((l) => Uint8Array.from(l)) };
}

/** Analisa a fonte de um gatilho ou procedure da base (bytes em CP1252). */
export function analisarFontePsql(fonte: Uint8Array): AnaliseFontePsql {
  const { emComentario, emLiteral, emCodigo, literais } = varrerFontePsql(fonte);
  const aRever = literais.some((u) => u.some((b) => INDEFINIDOS.has(b)) || contemUtf8Multibyte(u));
  const idaEVolta = Buffer.from(fonte).equals(codificarCp1252(decodificarCp1252(fonte)));
  return { emComentario, emLiteral, emCodigo, aRever, idaEVolta };
}

export interface RevisaoFontePsql {
  readonly motivos: MotivoLiteralUtf8[];
  /**
   * Cada literal do convertido (UTF-8) tem a mesma letra que o da base lido em CP1252, na mesma ordem: o objeto compara
   * e grava exatamente o texto que a conversão fez das linhas (a mesma transliteração dos dois lados).
   */
  readonly mesmaLetra: boolean;
}

function utf8Duplo(l: Uint8Array): boolean {
  const s = new TextDecoder('utf-8', { fatal: true });
  try {
    const uma = s.decode(l);
    return contemUtf8Multibyte(codificarCp1252(uma));
  } catch {
    return false;
  }
}

/** Revisão de uma fonte com literal a rever: a base (bytes em CP1252) contra o convertido (bytes em UTF-8). */
export function revisarFontePsqlUtf8(base: Uint8Array, convertido: Uint8Array): RevisaoFontePsql {
  const b = varrerFontePsql(base);
  const c = varrerFontePsql(convertido);
  const motivos = new Set<MotivoLiteralUtf8>();
  for (const l of b.literais) {
    if (l.some((x) => INDEFINIDOS.has(x))) motivos.add('byte-indefinido');
    if (utf8Duplo(l)) motivos.add('utf8-duplo');
    else if (contemUtf8Multibyte(l)) motivos.add('utf8-no-literal');
  }
  if (b.emCodigo > 0) motivos.add('byte-alto-no-codigo');
  const dec = new TextDecoder('utf-8', { fatal: false });
  const mesmaLetra =
    b.literais.length === c.literais.length &&
    b.literais.every((l, i) => decodificarCp1252(l) === dec.decode(c.literais[i]));
  return { motivos: MOTIVOS_LITERAL_UTF8.filter((m) => motivos.has(m)), mesmaLetra };
}
