// Codec do legado (cap-10 §10.2 e §10.7; roteiro, seção 4.5): a mesma peça na leitura e na gravação.
// Regra de ouro: o que se grava é o que o SPDATA gravaria (sentinela, HHMM, letra da coluna), nunca a
// forma "limpa". O driver entrega texto de colunas NONE já decodificado pela tabela sem perda de
// cp1252.ts e datas como Date construída com os componentes locais (new Date(a, m, d, ...)); por isso o
// codec só usa getters locais: o horário de São Paulo antes de 1914 (LMT -03:06:28) não desloca a
// sentinela para 00:00:28. Num fuso com horário de verão, a meia-noite do dia de início não existe
// (new Date(2017, 9, 15, 0, 30) vira 01:30 em São Paulo): o processo roda em TZ=UTC (tools/ambiente.sh),
// o núcleo recusa a partida em fuso de deslocamento variável (conferirFusoFixo) e deCivil confere a hora.
import { codificarCp1252, decodificarCp1252, ErroCp1252, foraDoCp1252 } from './cp1252.js';

export class ErroCodec extends Error {
  override readonly name = 'ErroCodec';
}

// ── Texto ────────────────────────────────────────────────────────────────────────────────────────

export type TipoTexto = 'CHAR' | 'VARCHAR' | 'BLOB';

export interface ColunaTexto {
  readonly tipo: TipoTexto;
  /** Tamanho da coluna em bytes (CHAR/VARCHAR). BLOB não tem limite aqui. */
  readonly tamanhoBytes?: number;
  /** Coluna catalogada como UTF-8 (colunas-utf8.ts). */
  readonly utf8?: boolean;
  /**
   * M58-F3: o charset do banco do estabelecimento (codec/charset.ts, conferido na partida). CP1252 (padrão): o banco da
   * coexistência, em NONE. UTF8: o banco convertido; o driver já entrega e recebe o texto em UTF-8, o limite da coluna
   * conta caracteres e a catalogada como UTF-8 não é relida.
   */
  readonly charsetBanco?: 'CP1252' | 'UTF8';
  /** M58-F3: a entrada sem restrição (`entrada.utf8` ligada); só vale com o banco em UTF8 (restricaoEntrada). */
  readonly restricao?: 'cp1252' | 'livre';
}

export interface TextoLido {
  readonly texto: string;
  /**
   * Texto misto de integração: bytes UTF-8 gravados numa coluna CP1252. Mostrado como está e marcado;
   * o Sante SGH nunca o regrava (a gravação recusa texto marcado).
   */
  readonly misto: boolean;
}

/** Há sequência UTF-8 multibyte válida nos bytes? (sinal de texto gravado por integração em UTF-8) */
export function contemUtf8Multibyte(bytes: Uint8Array): boolean {
  const utf8 = new TextDecoder('utf-8', { fatal: true });
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] as number;
    const n = b >= 0xc2 && b <= 0xdf ? 1 : b >= 0xe0 && b <= 0xef ? 2 : b >= 0xf0 && b <= 0xf4 ? 3 : 0;
    if (n === 0 || i + n >= bytes.length) continue;
    const seq = bytes.subarray(i, i + n + 1);
    if (!seq.subarray(1).every((c) => c >= 0x80 && c <= 0xbf)) continue;
    try {
      utf8.decode(seq);
      return true;
    } catch {
      // sequência inválida (ex.: substituto UTF-16 codificado): segue procurando
    }
  }
  return false;
}

/** Leitura de texto: CHAR sem o preenchimento; UTF-8 só em coluna catalogada; texto misto marcado. */
export function lerTexto(valor: string | null, coluna: ColunaTexto): TextoLido | null {
  if (valor === null) return null;
  const semPreenchimento = coluna.tipo === 'CHAR' ? valor.replace(/ +$/, '') : valor;
  if (coluna.charsetBanco === 'UTF8') {
    // Banco convertido: o texto já vem decodificado. Texto misto da coexistência atravessou a conversão como estava
    // (bytes UTF-8 lidos como CP1252): continua marcado, para nunca ser regravado.
    const misto =
      !coluna.utf8 &&
      foraDoCp1252(semPreenchimento) === null &&
      contemUtf8Multibyte(codificarCp1252(semPreenchimento));
    return { texto: semPreenchimento, misto };
  }
  const bytes = codificarCp1252(semPreenchimento);
  if (coluna.utf8) {
    try {
      return { texto: new TextDecoder('utf-8', { fatal: true }).decode(bytes), misto: false };
    } catch {
      // coluna UTF-8 com byte inválido: mostra como CP1252 e marca
      return { texto: semPreenchimento, misto: true };
    }
  }
  return { texto: semPreenchimento, misto: contemUtf8Multibyte(bytes) };
}

/**
 * Prepara texto para gravar: só caracteres do CP1252 (sem troca silenciosa), limite em bytes da coluna.
 * Em coluna UTF-8, devolve a string cujos bytes CP1252 são o UTF-8 do texto (o driver grava os bytes).
 */
export function prepararTexto(texto: string, coluna: ColunaTexto): string {
  if (coluna.charsetBanco === 'UTF8') return prepararTextoUtf8(texto, coluna);
  let bytes: Uint8Array;
  if (coluna.utf8) {
    bytes = new TextEncoder().encode(texto);
  } else {
    const fora = foraDoCp1252(texto);
    if (fora !== null) {
      throw new ErroCodec(
        `Caractere não aceito pelo sistema legado (U+${(fora.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}).`,
      );
    }
    bytes = codificarCp1252(texto);
  }
  if (coluna.tamanhoBytes !== undefined && bytes.length > coluna.tamanhoBytes) {
    throw new ErroCodec(`Texto com ${bytes.length} bytes; a coluna aceita até ${coluna.tamanhoBytes}.`);
  }
  return coluna.utf8 ? decodificarCp1252(bytes) : texto;
}

/**
 * Banco em UTF8 (M58-F3): restrição ao CP1252 até a chave `entrada.utf8` (a catalogada como UTF-8 sempre livre); o
 * limite da coluna conta caracteres (pontos de código, como o Firebird conta). O driver grava o texto em UTF-8.
 */
function prepararTextoUtf8(texto: string, coluna: ColunaTexto): string {
  if (!coluna.utf8 && coluna.restricao !== 'livre') {
    const fora = foraDoCp1252(texto);
    if (fora !== null) {
      throw new ErroCodec(
        `Caractere não aceito pelo sistema legado (U+${(fora.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}).`,
      );
    }
  }
  const caracteres = [...texto].length;
  if (coluna.tamanhoBytes !== undefined && caracteres > coluna.tamanhoBytes) {
    throw new ErroCodec(`Texto com ${caracteres} caracteres; a coluna aceita até ${coluna.tamanhoBytes}.`);
  }
  return texto;
}

/** Texto lido marcado como misto nunca é regravado. */
export function conferirRegravacao(lido: TextoLido): void {
  if (lido.misto) {
    throw new ErroCodec('Texto gravado por integração (codificação mista): o Sante SGH não o regrava.');
  }
}

/** BLOB de texto: bytes → texto (CP1252, ou UTF-8 na coluna catalogada), com a marca de misto. */
export function lerBlobTexto(bytes: Uint8Array, coluna: { readonly utf8?: boolean } = {}): TextoLido {
  return lerTexto(decodificarCp1252(bytes), { tipo: 'BLOB', ...coluna }) as TextoLido;
}

/** Texto → bytes para BLOB (CP1252, ou UTF-8 na coluna catalogada). */
export function prepararBlobTexto(texto: string, coluna: { readonly utf8?: boolean } = {}): Buffer {
  return coluna.utf8 ? Buffer.from(texto, 'utf8') : codificarCp1252(prepararTexto(texto, { tipo: 'BLOB' }));
}

// ── RTF (documentos em BLOB, cap-10 §10.2) ───────────────────────────────────────────────────────

export function ehRtf(texto: string): boolean {
  return texto.trimStart().startsWith('{\\rtf');
}

/** Code page declarada no RTF (`\ansicpgNNNN`), ou null se não houver. */
export function codePageRtf(texto: string): number | null {
  const m = /\\ansicpg(\d+)/.exec(texto);
  return m?.[1] ? Number(m[1]) : null;
}

/** O RTF gravado pelo novo segue o Delphi: `\ansicpg1252` (ou sem declaração) e só CP1252. */
export function conferirRtf(texto: string): void {
  if (!ehRtf(texto)) throw new ErroCodec('Documento sem cabeçalho RTF.');
  const cp = codePageRtf(texto);
  if (cp !== null && cp !== 1252) throw new ErroCodec(`RTF com code page ${cp}; o legado usa 1252.`);
  try {
    codificarCp1252(texto);
  } catch (e) {
    if (e instanceof ErroCp1252) throw new ErroCodec('RTF com caractere fora do CP1252.');
    throw e;
  }
}

// ── Datas e sentinelas ───────────────────────────────────────────────────────────────────────────

export interface DataCivil {
  readonly ano: number;
  readonly mes: number;
  readonly dia: number;
  readonly hora?: number;
  readonly minuto?: number;
  readonly segundo?: number;
  readonly milissegundo?: number;
}

/** 1899-12-30: data "vazia" do Delphi (TDateTime 0). Gravada assim, nunca NULL. */
export const SENTINELA_VAZIO: DataCivil = Object.freeze({ ano: 1899, mes: 12, dia: 30 });
/** Ano 2099: "sem data" (validade indefinida). */
export const ANO_SEM_DATA = 2099;

export interface FaixaSanidade {
  readonly anoMinimo: number;
  readonly anoMaximo: number;
}
/** Fora desta faixa (e sem ser sentinela), a data é marcada como inválida. Parâmetro por coluna. */
export const FAIXA_PADRAO: FaixaSanidade = Object.freeze({ anoMinimo: 1900, anoMaximo: 2098 });

export type DataLida =
  | { readonly tipo: 'nulo' }
  | { readonly tipo: 'vazio' }
  | { readonly tipo: 'sem-data'; readonly valor: DataCivil }
  | { readonly tipo: 'invalida'; readonly valor: DataCivil }
  | { readonly tipo: 'data'; readonly valor: DataCivil };

/** Componentes locais da Date (o driver monta a Date com eles; ver cabeçalho). */
export function paraCivil(d: Date): DataCivil {
  return {
    ano: d.getFullYear(),
    mes: d.getMonth() + 1,
    dia: d.getDate(),
    hora: d.getHours(),
    minuto: d.getMinutes(),
    segundo: d.getSeconds(),
    milissegundo: d.getMilliseconds(),
  };
}

/** Date com os componentes locais (o driver grava com getters locais: ida e volta exata). */
export function deCivil(c: DataCivil): Date {
  const d = new Date(
    c.ano,
    c.mes - 1,
    c.dia,
    c.hora ?? 0,
    c.minuto ?? 0,
    c.segundo ?? 0,
    c.milissegundo ?? 0,
  );
  if (c.ano >= 0 && c.ano < 100) d.setFullYear(c.ano); // Date(a<100) somaria 1900
  const volta = paraCivil(d);
  if (volta.ano !== c.ano || volta.mes !== c.mes || volta.dia !== c.dia) {
    throw new ErroCodec('Data inexistente no calendário.');
  }
  if (
    volta.hora !== (c.hora ?? 0) ||
    volta.minuto !== (c.minuto ?? 0) ||
    volta.segundo !== (c.segundo ?? 0) ||
    volta.milissegundo !== (c.milissegundo ?? 0)
  ) {
    throw new ErroCodec('Hora inexistente no fuso do processo (horário de verão): use TZ=UTC.');
  }
  return d;
}

/**
 * O fuso do processo tem deslocamento fixo de 1850 a 2100 (sem horário de verão nem LMT)? Senão, um
 * TIMESTAMP do legado pode ser lido e regravado com uma hora a mais, sem erro: o núcleo recusa a partida.
 */
export function fusoFixo(): boolean {
  const base = new Date(2000, 0, 1).getTimezoneOffset();
  for (let ano = 1850; ano <= 2100; ano++) {
    for (let mes = 0; mes < 12; mes++) {
      if (new Date(ano, mes, 1).getTimezoneOffset() !== base) return false;
    }
  }
  return true;
}

export function conferirFusoFixo(): void {
  if (!fusoFixo()) {
    throw new ErroCodec(
      'Fuso do processo com horário de verão ou deslocamento histórico: o núcleo do legado exige TZ=UTC.',
    );
  }
}

export function ehSentinelaVazio(c: DataCivil): boolean {
  return (
    c.ano === SENTINELA_VAZIO.ano &&
    c.mes === SENTINELA_VAZIO.mes &&
    c.dia === SENTINELA_VAZIO.dia &&
    (c.hora ?? 0) === 0 &&
    (c.minuto ?? 0) === 0 &&
    (c.segundo ?? 0) === 0 &&
    (c.milissegundo ?? 0) === 0
  );
}

export function lerData(valor: Date | null, faixa: FaixaSanidade = FAIXA_PADRAO): DataLida {
  if (valor === null) return { tipo: 'nulo' };
  const c = paraCivil(valor);
  if (ehSentinelaVazio(c)) return { tipo: 'vazio' };
  if (c.ano === ANO_SEM_DATA) return { tipo: 'sem-data', valor: c };
  if (c.ano < faixa.anoMinimo || c.ano > faixa.anoMaximo) return { tipo: 'invalida', valor: c };
  return { tipo: 'data', valor: c };
}

/** Gravação: vazio (null) vira a sentinela da coluna, nunca NULL. */
export function prepararData(valor: DataCivil | null, sentinela: DataCivil = SENTINELA_VAZIO): Date {
  return deCivil(valor ?? sentinela);
}

/**
 * Datas e horas de controle (inclusão, última alteração) vêm do relógio do banco, nunca do Node:
 * o executor (M04) põe este SQL no lugar do parâmetro.
 */
export const RELOGIO_DO_BANCO = 'CURRENT_TIMESTAMP';

// ── Hora HHMM ────────────────────────────────────────────────────────────────────────────────────

export interface Hora {
  readonly hora: number;
  readonly minuto: number;
}

/** "0830" → 08:30. Vazio ou só espaços → null. Formato fora de HHMM é erro. */
export function lerHoraHHMM(valor: string | null): Hora | null {
  if (valor === null || valor.trim() === '') return null;
  const m = /^(\d{2})(\d{2})$/.exec(valor.trim());
  const h = Number(m?.[1]);
  const mi = Number(m?.[2]);
  if (!m || h > 23 || mi > 59) throw new ErroCodec('Hora fora do formato HHMM.');
  return { hora: h, minuto: mi };
}

/** 08:30 → "0830" (quatro dígitos, sem dois-pontos). Aceita também "08:30" e "8:30". */
export function prepararHoraHHMM(valor: Hora | string): string {
  let h: number;
  let mi: number;
  if (typeof valor === 'string') {
    const m = /^(\d{1,2}):?(\d{2})$/.exec(valor.trim());
    if (!m) throw new ErroCodec('Hora inválida (use HH:MM).');
    h = Number(m[1]);
    mi = Number(m[2]);
  } else {
    h = valor.hora;
    mi = valor.minuto;
  }
  if (!Number.isInteger(h) || !Number.isInteger(mi) || h < 0 || h > 23 || mi < 0 || mi > 59) {
    throw new ErroCodec('Hora inválida (use HH:MM).');
  }
  return `${String(h).padStart(2, '0')}${String(mi).padStart(2, '0')}`;
}

// ── Booleano em letra ────────────────────────────────────────────────────────────────────────────

/** Convenção declarada por coluna (a lista de valores vistos vem do perfil do M03). */
export type LetraBooleana = 'T/F' | 'S/N';

const LETRAS: Record<LetraBooleana, readonly [string, string]> = { 'T/F': ['T', 'F'], 'S/N': ['S', 'N'] };

/** Letra da coluna → sim/não. Vazio → null. Letra de outra convenção é erro (nunca adivinha). */
export function lerBooleano(valor: string | null, convencao: LetraBooleana): boolean | null {
  if (valor === null || valor.trim() === '') return null;
  const [sim, nao] = LETRAS[convencao];
  const v = valor.trim();
  if (v === sim) return true;
  if (v === nao) return false;
  throw new ErroCodec(`Valor fora da convenção ${convencao} da coluna.`);
}

export function prepararBooleano(valor: boolean, convencao: LetraBooleana): string {
  const [sim, nao] = LETRAS[convencao];
  return valor ? sim : nao;
}

// ── Domínio de valores ───────────────────────────────────────────────────────────────────────────

/** Valor nunca visto numa coluna é recusado por padrão (convencoes.md §5). */
export function conferirDominio<T>(valor: T, vistos: ReadonlySet<T>): T {
  if (!vistos.has(valor)) throw new ErroCodec('Valor nunca visto nesta coluna do legado: recusado.');
  return valor;
}

// ── Dinheiro ─────────────────────────────────────────────────────────────────────────────────────

export type ColunaDinheiro =
  { readonly tipo: 'DOUBLE' } | { readonly tipo: 'NUMERIC'; readonly escala: number };

/** Mesmo tipo e precisão da coluna: DOUBLE como veio; NUMERIC arredondado à escala da coluna. */
export function prepararDinheiro(valor: number, coluna: ColunaDinheiro): number {
  if (!Number.isFinite(valor)) throw new ErroCodec('Valor monetário inválido.');
  if (coluna.tipo === 'DOUBLE') return valor;
  const f = 10 ** coluna.escala;
  return Math.sign(valor) * (Math.round(Math.abs(valor) * f + Number.EPSILON) / f);
}

/** Exibição: arredondado a 2 casas (o valor gravado não muda). */
export function exibirDinheiro(valor: number): string {
  return valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Hora civil do banco × instante ───────────────────────────────────────────────────────────────

/**
 * Deslocamento do relógio do banco (CURRENT_TIMESTAMP e as colunas TIMESTAMP gravadas pelo SPDATA): hora de
 * São Paulo, -03:00 fixo (sem horário de verão desde 2019; perfil do M06: FUSO_HORARIO_LOCAL '-03:00' em
 * 100%). O driver devolve a hora CIVIL; o processo roda em TZ=UTC. Comparar essa Date direto com
 * Date.now() erra pelo deslocamento (a sessão de 60 min "vencia" na abertura). Use estas duas funções.
 */
export const DESLOCAMENTO_BANCO_MINUTOS = -180;

/** Hora civil lida do banco → instante real. */
export function instanteDoBanco(civil: Date, deslocamentoMinutos = DESLOCAMENTO_BANCO_MINUTOS): Date {
  const c = paraCivil(civil);
  return new Date(
    Date.UTC(c.ano, c.mes - 1, c.dia, c.hora ?? 0, c.minuto ?? 0, c.segundo ?? 0, c.milissegundo ?? 0) -
      deslocamentoMinutos * 60_000,
  );
}

/** Instante real → hora civil do banco (para gravar numa coluna TIMESTAMP). */
export function civilDoBanco(instante: Date, deslocamentoMinutos = DESLOCAMENTO_BANCO_MINUTOS): Date {
  const local = new Date(instante.getTime() + deslocamentoMinutos * 60_000);
  return deCivil({
    ano: local.getUTCFullYear(),
    mes: local.getUTCMonth() + 1,
    dia: local.getUTCDate(),
    hora: local.getUTCHours(),
    minuto: local.getUTCMinutes(),
    segundo: local.getUTCSeconds(),
    milissegundo: local.getUTCMilliseconds(),
  });
}
