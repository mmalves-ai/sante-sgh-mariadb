// Texto formatado no formato que o formulário de origem grava (regra 9 da ficha do M22; cap-11 §11.1): só os
// comandos que ele usa (`\rtf1\ansi\ansicpg1252\deff0\deflang1046`, tabela de fonte, `\viewkind4\uc1\pard`,
// `\fs`, `\par`, `\b`, `\i`, `\ul`, `\li`, `\cf`), caracteres fora do ASCII como `\'hh` do CP1252 (o texto já foi
// recusado na entrada se tiver caractere fora do CP1252). O editor da tela é restrito (negrito, itálico,
// sublinhado, recuo e marcador de lista como texto): o que sai daqui volta igual pelo leitor do M15 (ida e volta).
import { byteDoCaractere, type Paragrafo } from '@sgh/contratos';

/** Fonte do formulário de origem (DFM: `Fonte = 'name=Arial … size=8'`). */
export const FONTE_PADRAO = 'Arial';
const TWIPS_POR_NIVEL = 283;
const CRLF = '\r\n';

/** Escapa um texto para dentro do RTF (barras, chaves e bytes do CP1252 acima de 127). */
export function escaparRtf(texto: string): string {
  let s = '';
  for (const c of texto) {
    if (c === '\\' || c === '{' || c === '}') s += `\\${c}`;
    else if (c === '\t') s += '\\tab ';
    else if (c === '\r') continue;
    else if (c === '\n') s += `\\line `;
    else {
      const b = byteDoCaractere(c);
      if (b === null) throw new Error('Caractere fora do CP1252 no texto formatado.');
      s += b < 0x80 ? c : `\\'${b.toString(16).padStart(2, '0')}`;
    }
  }
  return s;
}

function cabecalho(): string {
  return `{\\rtf1\\ansi\\ansicpg1252\\deff0\\deflang1046{\\fonttbl{\\f0\\fnil\\fcharset0 ${FONTE_PADRAO};}}${CRLF}`;
}

/** Texto digitado (linhas) em parágrafos sem formatação. */
export function paragrafosDoTexto(texto: string): Paragrafo[] {
  return texto
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((linha) => ({
      alinhamento: 'esquerda' as const,
      recuo: 0,
      trechos:
        linha === '' ? [] : [{ texto: linha, negrito: false, italico: false, sublinhado: false, cor: 0 }],
    }));
}

/** Corpo dos parágrafos (com os comandos de formatação só quando mudam, como o editor de origem faz). */
function corpo(paragrafos: readonly Paragrafo[], recuoBase = 0): string {
  let s = '';
  let negrito = false;
  let italico = false;
  let sublinhado = false;
  let recuo = recuoBase;
  paragrafos.forEach((p) => {
    const li = recuoBase + p.recuo * TWIPS_POR_NIVEL;
    if (li !== recuo) {
      s += `\\pard${li > 0 ? `\\li${li}` : ''} `;
      recuo = li;
    }
    for (const t of p.trechos) {
      let cmd = '';
      if (t.negrito !== negrito) cmd += t.negrito ? '\\b' : '\\b0';
      if (t.italico !== italico) cmd += t.italico ? '\\i' : '\\i0';
      if (t.sublinhado !== sublinhado) cmd += t.sublinhado ? '\\ul' : '\\ulnone';
      negrito = t.negrito;
      italico = t.italico;
      sublinhado = t.sublinhado;
      s += cmd ? `${cmd} ${escaparRtf(t.texto)}` : escaparRtf(t.texto);
    }
    s += `\\par${CRLF}`;
  });
  if (negrito) s += '\\b0';
  if (italico) s += '\\i0';
  if (sublinhado) s += '\\ulnone';
  return s;
}

/** RTF de um campo de texto (resposta e valor do componente no formulário gravado). */
export function rtfDoCampo(paragrafos: readonly Paragrafo[]): string {
  return `${cabecalho()}\\viewkind4\\uc1\\pard\\fs16 ${corpo(paragrafos)}\\par${CRLF}}${CRLF}`;
}

export interface BlocoRegistro {
  /** "1 - TÍTULO" ou "1.2 - Pergunta" (numeração dos itens respondidos). */
  readonly rotulo: string;
  readonly nivel: 'secao' | 'pergunta';
  readonly negrito: boolean;
  /** Valor na mesma linha do rótulo (escolha simples: "1.1 - Turno: Diurno"). */
  readonly naLinha?: string;
  /** Valor em parágrafos abaixo do rótulo (texto, lista marcada, grade). */
  readonly valor?: readonly Paragrafo[];
}

/**
 * Texto formatado do registro inteiro (PRCONTEVOL.EVOLUCAO): seção em \cf1 (negrito quando a fonte do vínculo é
 * negrito), pergunta em \li200 e o valor em \li600 \cf0, uma linha em branco depois de cada valor.
 */
export function rtfDoRegistro(blocos: readonly BlocoRegistro[]): string {
  let s = `${cabecalho()}{\\colortbl ;\\red0\\green0\\blue0;}${CRLF}\\viewkind4\\uc1\\pard`;
  let cf = -1;
  let negrito = false;
  let li = 0;
  let primeiro = true;
  const cor = (n: number) => {
    if (n !== cf) {
      cf = n;
      return `\\cf${n}`;
    }
    return '';
  };
  for (const b of blocos) {
    const recuo = b.nivel === 'secao' ? 0 : 200;
    let cmd = '';
    if (recuo !== li) {
      cmd += `\\pard${recuo ? `\\li${recuo}` : ''}`;
      li = recuo;
    } else if (!primeiro && b.nivel === 'secao') cmd += '\\pard';
    cmd += cor(1);
    if (b.negrito !== negrito) {
      cmd += b.negrito ? '\\b' : '\\b0';
      negrito = b.negrito;
    }
    if (primeiro) {
      cmd += '\\fs16';
      primeiro = false;
    }
    const linha = b.naLinha !== undefined ? `${b.rotulo}: ${b.naLinha}` : b.rotulo;
    s += `${cmd} ${escaparRtf(linha)}\\par${CRLF}`;
    if (b.valor && b.valor.length > 0) {
      let v = `\\pard\\li600${cor(0)}`;
      li = 600;
      if (negrito) {
        v += '\\b0';
        negrito = false;
      }
      s += `${v} ${corpo(b.valor, 600)}\\par${CRLF}`;
    }
  }
  return `${s}}${CRLF}`;
}
