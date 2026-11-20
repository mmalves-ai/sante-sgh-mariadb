// Texto formatado do registro (RTF do prontuário; regra 4 da ficha do M15; cap-11 §11.1 "Leitura do prontuário
// ao vivo"): o RTF do formulário usa poucos comandos (\par, \b, \li, \cf, \qc). O conversor monta PARÁGRAFOS e
// TRECHOS (negrito, itálico, sublinhado, cor, alinhamento, recuo), que a tela desenha com componentes, sem HTML
// cru: o resultado é seguro por construção (nada vira marcação). Destinos de metadado (fontes, estilos, info)
// são pulados; conteúdo ativo (objeto, imagem, campo com link) é neutralizado e contado; todo comando fora do
// conjunto tratado é contado em `ignorados` (relatório do leitor). Os escapes \'hh são bytes CP1252 (o texto
// chega do adaptador já decodificado do CP1252; os escapes continuam bytes do código de página).
import { caractereDoByte, type Paragrafo, type TextoFormatado } from '@sgh/contratos';

/** Teto de entrada (o maior RTF de registro na cópia tem centenas de KB). */
export const TETO_RTF = 8_000_000;

interface Estado {
  negrito: boolean;
  italico: boolean;
  sublinhado: boolean;
  cor: number;
  /** Destino pulado (fontes, estilos, info, \*…). */
  pular: boolean;
  /** Tabela de cores sendo lida. */
  cores: boolean;
  /** Quantos caracteres de reserva seguem um \uN (\ucN). */
  uc: number;
}

type Alinhamento = Paragrafo['alinhamento'];

/** Comandos tratados (todo o resto entra em `ignorados`). */
const TRATADOS = new Set([
  'rtf',
  'ansi',
  'ansicpg',
  'deff',
  'deflang',
  'deflangfe',
  'uc',
  'u',
  'par',
  'pard',
  'line',
  'tab',
  'cell',
  'row',
  'b',
  'i',
  'ul',
  'ulnone',
  'cf',
  'li',
  'qc',
  'ql',
  'qr',
  'qj',
  'plain',
  'f',
  'fs',
  'lang',
  'viewkind',
  'red',
  'green',
  'blue',
  'nowidctlpar',
  'sa',
  'sb',
  'sl',
  'slmult',
  'fi',
  'ri',
]);

/** Destinos de metadado: pulados sem contar. */
const DESTINOS_PULADOS = new Set([
  'fonttbl',
  'stylesheet',
  'info',
  'generator',
  'listtable',
  'listoverridetable',
  'rsidtbl',
  'xmlnstbl',
  'themedata',
  'colorschememapping',
  'latentstyles',
  'datastore',
  'filetbl',
  'revtbl',
  'pgdsctbl',
]);

/** Conteúdo ativo: o grupo inteiro some e conta como neutralizado. */
const ATIVOS = new Set(['object', 'pict', 'shppict', 'nonshppict', 'fldinst', 'objdata', 'result']);

const TWIPS_POR_NIVEL = 283; // 0,5 cm

export class ErroRtf extends Error {
  override readonly name = 'ErroRtf';
}

function hex2(n: number): string {
  return Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
}

/** Converte o RTF em parágrafos e trechos (seguro: nada de marcação sai daqui). */
export function rtfParaTexto(rtf: string): TextoFormatado {
  if (rtf.length > TETO_RTF) throw new ErroRtf(`Texto formatado acima do teto (${rtf.length} caracteres).`);
  const paragrafos: Paragrafo[] = [];
  const ignorados: Record<string, number> = {};
  let conteudoAtivoRemovido = 0;
  const cores: string[] = [];
  let corAtual = { r: 0, g: 0, b: 0, tem: false };
  const pilha: Estado[] = [];
  let e: Estado = {
    negrito: false,
    italico: false,
    sublinhado: false,
    cor: 0,
    pular: false,
    cores: false,
    uc: 1,
  };
  let alinhamento: Alinhamento = 'esquerda';
  let recuo = 0;
  let trechos: Paragrafo['trechos'][number][] = [];
  let reservaPular = 0;
  let profundidadePulada = -1;
  let ativoAberto = false;

  const emitir = (texto: string) => {
    if (e.pular || texto === '') return;
    if (reservaPular > 0) {
      const corta = Math.min(reservaPular, texto.length);
      reservaPular -= corta;
      texto = texto.slice(corta);
      if (texto === '') return;
    }
    const ultimo = trechos[trechos.length - 1];
    if (
      ultimo &&
      ultimo.negrito === e.negrito &&
      ultimo.italico === e.italico &&
      ultimo.sublinhado === e.sublinhado &&
      ultimo.cor === e.cor
    ) {
      trechos[trechos.length - 1] = { ...ultimo, texto: ultimo.texto + texto };
    } else {
      trechos.push({
        texto,
        negrito: e.negrito,
        italico: e.italico,
        sublinhado: e.sublinhado,
        cor: Math.min(255, e.cor),
      });
    }
  };
  const fecharParagrafo = () => {
    paragrafos.push({
      alinhamento,
      recuo: Math.min(20, Math.max(0, Math.round(recuo / TWIPS_POR_NIVEL))),
      trechos,
    });
    trechos = [];
  };

  let i = 0;
  const n = rtf.length;
  let profundidade = 0;
  let inicioDeGrupo = false;
  while (i < n) {
    const c = rtf[i]!;
    if (c === '{') {
      pilha.push({ ...e });
      profundidade++;
      inicioDeGrupo = true;
      i++;
      continue;
    }
    if (c === '}') {
      if (profundidade === profundidadePulada) {
        profundidadePulada = -1;
        ativoAberto = false;
      }
      e = pilha.pop() ?? e;
      profundidade = Math.max(0, profundidade - 1);
      inicioDeGrupo = false;
      i++;
      continue;
    }
    if (c === '\\') {
      const prox = rtf[i + 1];
      if (prox === undefined) break;
      // Símbolos de controle.
      if (prox === '\\' || prox === '{' || prox === '}') {
        emitir(prox);
        i += 2;
        inicioDeGrupo = false;
        continue;
      }
      if (prox === "'") {
        const h = rtf.slice(i + 2, i + 4);
        const byte = /^[0-9a-fA-F]{2}$/.test(h) ? parseInt(h, 16) : NaN;
        if (!Number.isNaN(byte)) emitir(caractereDoByte(byte) ?? '\uFFFD');
        i += 4;
        inicioDeGrupo = false;
        continue;
      }
      if (prox === '~') {
        emitir('\u00A0');
        i += 2;
        continue;
      }
      if (prox === '-' || prox === '_') {
        i += 2;
        continue;
      }
      if (prox === '*') {
        // Destino opcional desconhecido: o grupo é pulado (salvo o que for tratado abaixo).
        if (inicioDeGrupo && !e.pular) {
          e.pular = true;
          ignorados['*'] = (ignorados['*'] ?? 0) + 1;
        }
        i += 2;
        continue;
      }
      if (prox === '\n' || prox === '\r') {
        if (!e.pular) fecharParagrafo();
        i += 2;
        continue;
      }
      const m = /^([a-zA-Z]{1,32})(-?\d{1,10})? ?/.exec(rtf.slice(i + 1, i + 1 + 48));
      if (!m) {
        i += 2;
        continue;
      }
      const palavra = m[1]!;
      const param = m[2] !== undefined ? Number(m[2]) : null;
      i += 1 + m[0].length;
      const eraInicio = inicioDeGrupo;
      inicioDeGrupo = false;
      if (eraInicio && DESTINOS_PULADOS.has(palavra)) {
        e.pular = true;
        continue;
      }
      if (eraInicio && ATIVOS.has(palavra)) {
        if (!ativoAberto) {
          conteudoAtivoRemovido++;
          ativoAberto = true;
          profundidadePulada = profundidade;
        }
        e.pular = true;
        continue;
      }
      if (eraInicio && palavra === 'colortbl') {
        e.cores = true;
        e.pular = true;
        continue;
      }
      if (e.cores) {
        if (palavra === 'red') corAtual = { ...corAtual, r: param ?? 0, tem: true };
        else if (palavra === 'green') corAtual = { ...corAtual, g: param ?? 0, tem: true };
        else if (palavra === 'blue') corAtual = { ...corAtual, b: param ?? 0, tem: true };
        continue;
      }
      if (e.pular) continue;
      switch (palavra) {
        case 'par':
          fecharParagrafo();
          break;
        case 'row':
          fecharParagrafo();
          break;
        case 'line':
          emitir('\n');
          break;
        case 'tab':
          emitir('\t');
          break;
        case 'cell':
          emitir(' | ');
          break;
        case 'pard':
          alinhamento = 'esquerda';
          recuo = 0;
          break;
        case 'plain':
          e.negrito = false;
          e.italico = false;
          e.sublinhado = false;
          e.cor = 0;
          break;
        case 'b':
          e.negrito = param !== 0;
          break;
        case 'i':
          e.italico = param !== 0;
          break;
        case 'ul':
          e.sublinhado = param !== 0;
          break;
        case 'ulnone':
          e.sublinhado = false;
          break;
        case 'cf':
          e.cor = Math.max(0, param ?? 0);
          break;
        case 'li':
          recuo = Math.max(0, param ?? 0);
          break;
        case 'qc':
          alinhamento = 'centro';
          break;
        case 'qr':
          alinhamento = 'direita';
          break;
        case 'qj':
          alinhamento = 'justificado';
          break;
        case 'ql':
          alinhamento = 'esquerda';
          break;
        case 'uc':
          e.uc = Math.max(0, param ?? 1);
          break;
        case 'u': {
          const cod = param === null ? 0x3f : param < 0 ? param + 65536 : param;
          emitir(String.fromCharCode(cod));
          reservaPular = e.uc;
          break;
        }
        default:
          if (!TRATADOS.has(palavra)) ignorados[palavra] = (ignorados[palavra] ?? 0) + 1;
      }
      continue;
    }
    inicioDeGrupo = false;
    if (c === '\r' || c === '\n') {
      i++;
      continue;
    }
    if (e.cores) {
      if (c === ';') {
        cores.push(corAtual.tem ? `#${hex2(corAtual.r)}${hex2(corAtual.g)}${hex2(corAtual.b)}` : '#000000');
        corAtual = { r: 0, g: 0, b: 0, tem: false };
      }
      i++;
      continue;
    }
    // Texto: até o próximo controle.
    let j = i;
    while (j < n && rtf[j] !== '\\' && rtf[j] !== '{' && rtf[j] !== '}' && rtf[j] !== '\r' && rtf[j] !== '\n')
      j++;
    emitir(rtf.slice(i, j));
    i = j;
  }
  if (trechos.length > 0) fecharParagrafo();

  // Parágrafos vazios no fim não contam.
  while (paragrafos.length > 0 && paragrafos[paragrafos.length - 1]!.trechos.every((t) => !t.texto.trim()))
    paragrafos.pop();
  return { paragrafos, cores, ignorados, conteudoAtivoRemovido };
}

/** Texto corrido (busca de palavra, conferência): os parágrafos separados por quebra de linha. */
export function textoCorrido(t: TextoFormatado): string {
  return t.paragrafos
    .map((p) => p.trechos.map((x) => x.texto).join(''))
    .join('\n')
    .replace(/[ \t\u00A0]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** O valor começa como RTF? (campos do formulário guardam texto rico dentro do valor.) */
export function pareceRtf(valor: string): boolean {
  return /^\s*\{\\rtf/.test(valor);
}
