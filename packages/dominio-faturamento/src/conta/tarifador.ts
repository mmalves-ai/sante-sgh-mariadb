// Importação do arquivo do tarifador telefônico (F8, 06-FAT linha 23). Regra pura, sem banco nem I/O.
// O arquivo de bilhetes (CDR) que a central telefônica exporta em texto separado varia de fabricante para fabricante:
// o faturista descreve uma vez o layout (separador, cabeçalho, posição de cada coluna, formato da data, da duração e do
// valor, DDD do hospital) e o sistema lê cada linha, classifica o número discado (local, interurbano, celular,
// internacional ou gratuito, pela numeração brasileira) e devolve as ligações prontas para registrar. A linha que não
// se lê volta com o número da linha e o motivo, nunca com o conteúdo (o número discado é dado pessoal).

export const SEPARADORES_TARIFADOR = ['ponto_virgula', 'virgula', 'tabulacao', 'barra'] as const;
export type SeparadorTarifador = (typeof SEPARADORES_TARIFADOR)[number];
export const FORMATOS_DATA_TARIFADOR = ['dia_mes_ano', 'ano_mes_dia'] as const;
export type FormatoDataTarifador = (typeof FORMATOS_DATA_TARIFADOR)[number];
export const FORMATOS_DURACAO_TARIFADOR = ['segundos', 'minutos', 'horas_minutos_segundos'] as const;
export type FormatoDuracaoTarifador = (typeof FORMATOS_DURACAO_TARIFADOR)[number];

/** Layout do arquivo; as colunas são posições a partir de 1. */
export interface LayoutTarifador {
  readonly separador: SeparadorTarifador;
  readonly cabecalho: boolean;
  readonly formatoData: FormatoDataTarifador;
  readonly formatoDuracao: FormatoDuracaoTarifador;
  readonly decimal: ',' | '.';
  /** DDD do hospital: ligação para outro DDD é interurbana. */
  readonly dddLocal: string | null;
  readonly colunaRamal: number | null;
  readonly colunaDataHora: number;
  /** Quando a hora vem numa coluna separada da data. */
  readonly colunaHora: number | null;
  readonly colunaDuracao: number;
  readonly colunaNumero: number;
  readonly colunaValor: number | null;
  /** Número do atendimento, quando a central já o grava; sem ele, a importação é feita a partir da conta. */
  readonly colunaAtendimento: number | null;
}

export const MAX_COLUNA_TARIFADOR = 60;
export const MAX_LINHAS_TARIFADOR = 5000;
const COLUNAS = [
  'colunaRamal',
  'colunaDataHora',
  'colunaHora',
  'colunaDuracao',
  'colunaNumero',
  'colunaValor',
  'colunaAtendimento',
] as const;
const OBRIGATORIAS = new Set<string>(['colunaDataHora', 'colunaDuracao', 'colunaNumero']);

/** Confere o layout enquanto se digita (a mesma regra roda no servidor). */
export function validarLayoutTarifador(l: Partial<LayoutTarifador>): Record<string, string> {
  const erros: Record<string, string> = {};
  if (!l.separador || !SEPARADORES_TARIFADOR.includes(l.separador))
    erros['separador'] = 'Escolha o separador.';
  if (!l.formatoData || !FORMATOS_DATA_TARIFADOR.includes(l.formatoData))
    erros['formatoData'] = 'Escolha o formato da data.';
  if (!l.formatoDuracao || !FORMATOS_DURACAO_TARIFADOR.includes(l.formatoDuracao))
    erros['formatoDuracao'] = 'Escolha o formato da duração.';
  if (l.decimal !== ',' && l.decimal !== '.') erros['decimal'] = 'Escolha o separador decimal.';
  if (l.dddLocal !== null && l.dddLocal !== undefined && !/^[1-9]\d$/.test(l.dddLocal))
    erros['dddLocal'] = 'O DDD tem dois dígitos (11 a 99).';
  const usadas = new Map<number, string>();
  for (const c of COLUNAS) {
    const v = l[c];
    if (v === null || v === undefined) {
      if (OBRIGATORIAS.has(c)) erros[c] = 'Informe a posição da coluna.';
      continue;
    }
    if (!Number.isInteger(v) || v < 1 || v > MAX_COLUNA_TARIFADOR) {
      erros[c] = `A posição vai de 1 a ${MAX_COLUNA_TARIFADOR}.`;
      continue;
    }
    if (usadas.has(v)) erros[c] = 'Duas informações na mesma coluna.';
    else usadas.set(v, c);
  }
  return erros;
}

export type AbrangenciaNumero =
  'local' | 'interurbano' | 'internacional' | 'celular_local' | 'celular_interurbano' | 'gratuita';
export interface NumeroClassificado {
  readonly abrangencia: AbrangenciaNumero;
  readonly ddi: string | null;
  readonly ddd: string | null;
  readonly telefone: string;
}

/**
 * Classifica o número discado pela numeração brasileira (plano da Anatel): 00 ou + é internacional; 0800 é gratuito;
 * serviço de utilidade pública de três dígitos (1xx) é gratuito; 0 + operadora + DDD ou só DDD + número é
 * interurbano quando o DDD não é o do hospital; número de 9 dígitos começando por 9 é celular. Nulo: não é número.
 */
export function classificarNumero(bruto: string, dddLocal: string | null): NumeroClassificado | null {
  const s = bruto.trim();
  const d = s.replace(/\D/g, '');
  if (d.length === 0) return null;
  if (s.startsWith('+') || d.startsWith('00')) {
    const resto = s.startsWith('+') ? d : d.slice(2);
    if (resto.length < 7 || resto.length > 20) return null;
    // +55 é o Brasil: depois do país vem sempre o DDD (10 ou 11 dígitos).
    if (resto.startsWith('55'))
      return /^\d{10,11}$/.test(resto.slice(2)) ? classificarNumero(resto.slice(2), dddLocal) : null;
    return { abrangencia: 'internacional', ddi: null, ddd: null, telefone: resto };
  }
  if (/^1\d{2}$/.test(d)) return { abrangencia: 'gratuita', ddi: null, ddd: null, telefone: d };
  if (/^0?800\d{6,8}$/.test(d)) return { abrangencia: 'gratuita', ddi: null, ddd: null, telefone: d };
  let ddd: string | null = null;
  let numero: string;
  if (d.startsWith('0')) {
    const r = d.slice(1);
    if (r.length === 12 || r.length === 13) {
      ddd = r.slice(2, 4);
      numero = r.slice(4);
    } else if (r.length === 10 || r.length === 11) {
      ddd = r.slice(0, 2);
      numero = r.slice(2);
    } else return null;
  } else if (d.length === 10 || d.length === 11) {
    ddd = d.slice(0, 2);
    numero = d.slice(2);
  } else if (d.length === 8 || d.length === 9) numero = d;
  else return null;
  if (ddd !== null && !/^[1-9]\d$/.test(ddd)) return null;
  const celular = numero.length === 9 && numero.startsWith('9');
  if (!celular && !(numero.length === 8 && /^[2-5]/.test(numero))) return null;
  const fora = ddd !== null && ddd !== dddLocal;
  const abrangencia: AbrangenciaNumero = celular
    ? fora
      ? 'celular_interurbano'
      : 'celular_local'
    : fora
      ? 'interurbano'
      : 'local';
  return { abrangencia, ddi: null, ddd, telefone: numero };
}

export type MotivoLinhaTarifador =
  | 'colunas_faltando'
  | 'data_invalida'
  | 'duracao_invalida'
  | 'numero_invalido'
  | 'valor_invalido'
  | 'limite_de_linhas';

export interface LigacaoDoArquivo extends NumeroClassificado {
  /** Número da linha no arquivo (1 = primeira linha, contando o cabeçalho). */
  readonly linha: number;
  readonly ramal: string | null;
  readonly atendimento: string | null;
  /** AAAA-MM-DD HH:MM:SS, no relógio do hospital. */
  readonly iniciadaEm: string;
  readonly duracaoSegundos: number;
  readonly valor: number | null;
}
export interface LeituraTarifador {
  readonly lidas: number;
  readonly ligacoes: readonly LigacaoDoArquivo[];
  readonly recusadas: readonly { readonly linha: number; readonly motivo: MotivoLinhaTarifador }[];
}

const CARACTERE: Record<SeparadorTarifador, string> = {
  ponto_virgula: ';',
  virgula: ',',
  tabulacao: '\t',
  barra: '|',
};

/** Divide a linha pelo separador, respeitando campos entre aspas duplas (com "" como aspa literal). */
export function dividirLinhaTarifador(linha: string, sep: string): string[] {
  const campos: string[] = [];
  let atual = '';
  let aspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i] as string;
    if (aspas) {
      if (c === '"' && linha[i + 1] === '"') {
        atual += '"';
        i++;
      } else if (c === '"') aspas = false;
      else atual += c;
    } else if (c === '"' && atual.trim() === '') {
      aspas = true;
      atual = '';
    } else if (c === sep) {
      campos.push(atual.trim());
      atual = '';
    } else atual += c;
  }
  campos.push(atual.trim());
  return campos;
}

const p2 = (n: number) => String(n).padStart(2, '0');
function dataValida(a: number, m: number, d: number, h: number, mi: number, s: number): boolean {
  if (m < 1 || m > 12 || d < 1 || h > 23 || mi > 59 || s > 59) return false;
  const dt = new Date(Date.UTC(a, m - 1, d));
  return dt.getUTCFullYear() === a && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d && a >= 1900;
}

/** Data e hora do bilhete em AAAA-MM-DD HH:MM:SS; nulo quando não é uma data real. */
export function lerDataHoraTarifador(
  data: string,
  hora: string | null,
  f: FormatoDataTarifador,
): string | null {
  const texto = hora === null ? data.trim() : `${data.trim()} ${hora.trim()}`;
  const re =
    f === 'dia_mes_ano'
      ? /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?$/
      : /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
  const m = re.exec(texto);
  if (!m) return null;
  const v = m.slice(1).map((x) => (x === undefined ? 0 : Number(x)));
  const [a, me, d] = f === 'dia_mes_ano' ? [v[2], v[1], v[0]] : [v[0], v[1], v[2]];
  const [h, mi, s] = [v[3], v[4], v[5]] as [number, number, number];
  if (!dataValida(a as number, me as number, d as number, h, mi, s)) return null;
  return `${a}-${p2(me as number)}-${p2(d as number)} ${p2(h)}:${p2(mi)}:${p2(s)}`;
}

/** Duração em segundos inteiros (minutos fracionados arredondam para cima); nulo quando inválida. */
export function lerDuracaoTarifador(
  texto: string,
  f: FormatoDuracaoTarifador,
  decimal: ',' | '.',
): number | null {
  const t = texto.trim();
  let seg: number;
  if (f === 'horas_minutos_segundos') {
    const m = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/.exec(t);
    if (!m) return null;
    const [h, mi, s] = [Number(m[1] ?? 0), Number(m[2]), Number(m[3])];
    if (s > 59 || (m[1] !== undefined && mi > 59)) return null;
    seg = h * 3600 + mi * 60 + s;
  } else {
    const n = numeroDecimal(t, decimal);
    if (n === null) return null;
    seg = f === 'minutos' ? Math.ceil(Math.round(n * 60 * 1000) / 1000) : n;
    if (!Number.isInteger(seg)) return null;
  }
  return seg >= 0 && seg <= 86400 ? seg : null;
}

function numeroDecimal(t: string, decimal: ',' | '.'): number | null {
  let s = t.replace(/R\$/gi, '').replace(/\s/g, '');
  if (s === '') return null;
  s = decimal === ',' ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

/** Valor cobrado pelo tarifador em reais, com duas casas; nulo quando inválido. */
export function lerValorTarifador(texto: string, decimal: ',' | '.'): number | null {
  const n = numeroDecimal(texto, decimal);
  return n === null ? null : Math.round(n * 100) / 100;
}

/** Lê o arquivo inteiro pelo layout: ligações prontas para registrar e as linhas recusadas com o motivo. */
export function lerArquivoTarifador(conteudo: string, l: LayoutTarifador): LeituraTarifador {
  const sep = CARACTERE[l.separador];
  const brutas = (conteudo.charCodeAt(0) === 0xfeff ? conteudo.slice(1) : conteudo).split(/\r?\n/);
  const ligacoes: LigacaoDoArquivo[] = [];
  const recusadas: { linha: number; motivo: MotivoLinhaTarifador }[] = [];
  let lidas = 0;
  const maior = Math.max(...COLUNAS.map((c) => l[c] ?? 0));
  brutas.forEach((bruta, i) => {
    const linha = i + 1;
    if ((l.cabecalho && i === 0) || bruta.trim() === '') return;
    lidas++;
    if (lidas > MAX_LINHAS_TARIFADOR) {
      if (lidas === MAX_LINHAS_TARIFADOR + 1) recusadas.push({ linha, motivo: 'limite_de_linhas' });
      return;
    }
    const c = dividirLinhaTarifador(bruta, sep);
    if (c.length < maior) return void recusadas.push({ linha, motivo: 'colunas_faltando' });
    const col = (p: number | null) => (p === null ? null : (c[p - 1] ?? ''));
    const iniciadaEm = lerDataHoraTarifador(col(l.colunaDataHora) ?? '', col(l.colunaHora), l.formatoData);
    if (!iniciadaEm) return void recusadas.push({ linha, motivo: 'data_invalida' });
    const duracaoSegundos = lerDuracaoTarifador(col(l.colunaDuracao) ?? '', l.formatoDuracao, l.decimal);
    if (duracaoSegundos === null) return void recusadas.push({ linha, motivo: 'duracao_invalida' });
    const numero = classificarNumero(col(l.colunaNumero) ?? '', l.dddLocal);
    if (!numero) return void recusadas.push({ linha, motivo: 'numero_invalido' });
    const textoValor = col(l.colunaValor);
    let valor: number | null = null;
    if (textoValor !== null && textoValor !== '') {
      valor = lerValorTarifador(textoValor, l.decimal);
      if (valor === null) return void recusadas.push({ linha, motivo: 'valor_invalido' });
    }
    const ramal = col(l.colunaRamal);
    const atendimento = col(l.colunaAtendimento);
    ligacoes.push({
      linha,
      ramal: ramal ? ramal : null,
      atendimento: atendimento ? atendimento : null,
      iniciadaEm,
      duracaoSegundos,
      valor,
      ...numero,
    });
  });
  return { lidas, ligacoes, recusadas };
}
