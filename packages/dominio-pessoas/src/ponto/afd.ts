// Validação do AFD (Arquivo-Fonte de Dados) do relógio de ponto, regra 12 do M52 (cap-07 §7.1.3, inclusive a Atenção;
// Portaria MTP 671/2021, Anexo V, leiaute "003"): arquivo com sequência quebrada, registro duplicado ou falha de
// integridade vai INTEIRO para a quarentena, com o relatório das falhas (motivo e número da linha, nunca o conteúdo da
// linha: ela tem o CPF do empregado). O leiaute é o confirmado com o jurídico trabalhista e o fornecedor do relógio:
// a versão aceita e a conferência do CRC são parâmetros (D-AFD-524). O Sante SGH não é REP-P (regra 11): só lê o AFD.
//
// Registros (posições 1-based, tamanho fixo):
//   cabeçalho "000000000" + "1" (302)  · 2 empresa (331) · 3 marcação do REP-C/REP-A (50) · 4 ajuste do relógio (73)
//   5 empregado (118) · 6 evento sensível (36) · 7 marcação do REP-P (137, com o hash SHA-256)
//   trailer "999999999" + as contagens dos tipos 2 a 7 + "9" (64) · opcional, a linha da assinatura em arquivo .p7s.
// Data e hora: `AAAA-MM-DDThh:mm:00-0300` (24); o instante vira hora local de Brasília (America/Sao_Paulo sem horário de
// verão; D-FUSO-52).
import { cpfValido, type FalhaAfd, LEIAUTE_AFD_PADRAO, type TipoRep } from '@sgh/contratos';

export interface CabecalhoAfd {
  readonly tipoEmpregador: 'cnpj' | 'cpf';
  /** CNPJ do empregador (14 dígitos); o CPF de empregador pessoa física não sai daqui (null). */
  readonly cnpjEmpregador: string | null;
  readonly razaoSocial: string;
  readonly numeroRep: string;
  readonly dataInicial: string;
  readonly dataFinal: string;
  /** Instante local da geração (`AAAA-MM-DDTHH:MM`). */
  readonly geradoEm: string;
  readonly leiaute: string;
  readonly modeloRep: string;
}

export interface MarcacaoAfd {
  readonly nsr: number;
  readonly linha: number;
  readonly tipoRegistro: 3 | 7;
  /** Instante local de Brasília (`AAAA-MM-DDTHH:MM`). */
  readonly instante: string;
  /** Deslocamento original do relógio (`-0300`). */
  readonly fuso: string;
  /** CPF do empregado (11 dígitos): quem chama transforma em HMAC na hora e nunca grava o número. */
  readonly cpf: string;
}

export interface FalhaLinhaAfd {
  readonly codigo: FalhaAfd;
  /** Número da linha (1 = primeira); null quando a falha é do arquivo inteiro. */
  readonly linha: number | null;
}

export interface ResultadoAfd {
  readonly situacao: 'valido' | 'quarentena';
  readonly cabecalho: CabecalhoAfd | null;
  readonly marcacoes: readonly MarcacaoAfd[];
  /** As primeiras falhas (teto: `TETO_FALHAS_LISTADAS`); `totalFalhas` conta todas. */
  readonly falhas: readonly FalhaLinhaAfd[];
  readonly totalFalhas: number;
  readonly linhas: number;
  readonly porTipo: Readonly<Record<string, number>>;
  readonly nsrInicial: number | null;
  readonly nsrFinal: number | null;
}

export interface OpcoesAfd {
  /** Versão do leiaute aceita (parâmetro `pessoas.ponto.leiauteAfd`; padrão "003"). */
  readonly leiaute?: string;
  /** Confere o CRC-16 das linhas que o têm (parâmetro `pessoas.ponto.afdConferirCrc`; padrão: confere). */
  readonly conferirCrc?: boolean;
  /** Tipo do relógio declarado na importação (REP-P exige marcação do tipo 7 com hash). */
  readonly tipoRep?: TipoRep;
}

export const TETO_FALHAS_LISTADAS = 50;
export const ASSINATURA_EM_ARQUIVO = 'ASSINATURA_DIGITAL_EM_ARQUIVO_P7S';

/** Tamanho de cada registro pelo tipo (Anexo V). */
export const TAMANHOS_AFD: Readonly<Record<string, number>> = {
  '1': 302,
  '2': 331,
  '3': 50,
  '4': 73,
  '5': 118,
  '6': 36,
  '7': 137,
};
const TAMANHO_TRAILER = 64;
/** Tipos com o CRC-16 nas 4 últimas posições (o 6 não tem; o 7 é íntegro pelo hash). */
const COM_CRC = new Set(['1', '2', '3', '4', '5']);

/**
 * Byte original de cada caractere: o arquivo do relógio é CP1252, e a tela o decodifica como `windows-1252` (0x96 vira
 * U+2013, o travessão), enquanto a linha de comando o lê como `latin1` (0x96 vira U+0096). O CRC é dos bytes, então os
 * 27 caracteres que o CP1252 põe em 0x80–0x9F voltam ao byte deles; o resto (até U+00FF) já é o próprio byte.
 */
let BYTE_CP1252: Map<number, number> | null = null;
function byteCp1252(c: number): number {
  if (c <= 0xff) return c;
  if (!BYTE_CP1252) {
    BYTE_CP1252 = new Map();
    const faixa = new TextDecoder('windows-1252').decode(Uint8Array.from({ length: 32 }, (_, i) => 0x80 + i));
    for (let i = 0; i < faixa.length; i++) BYTE_CP1252.set(faixa.charCodeAt(i), 0x80 + i);
  }
  return BYTE_CP1252.get(c) ?? 0x3f; // fora do CP1252: '?', como o codificador grava
}

/** CRC-16/KERMIT (polinômio 0x1021 refletido, início 0) dos bytes CP1252, em 4 dígitos hexadecimais maiúsculos. */
export function crc16(texto: string): string {
  let crc = 0;
  for (let i = 0; i < texto.length; i++) {
    crc ^= byteCp1252(texto.charCodeAt(i));
    for (let b = 0; b < 8; b++) crc = crc & 1 ? (crc >>> 1) ^ 0x8408 : crc >>> 1;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

const DATA_HORA = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)([+-])(\d{2})(\d{2})$/;
const DATA = /^(\d{4})-(\d{2})-(\d{2})$/;
const p2 = (x: number) => String(x).padStart(2, '0');

function dataValida(a: number, m: number, d: number): boolean {
  const t = new Date(Date.UTC(a, m - 1, d));
  return t.getUTCFullYear() === a && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** `AAAA-MM-DD` válida, ou null. */
export function dataDoAfd(v: string): string | null {
  const m = DATA.exec(v);
  if (!m) return null;
  return dataValida(Number(m[1]), Number(m[2]), Number(m[3])) ? v : null;
}

/** Data e hora do AFD em hora local de Brasília (UTC-3), com o deslocamento original; null se inválida. */
export function instanteDoAfd(v: string): { instante: string; fuso: string; dia: string } | null {
  const m = DATA_HORA.exec(v);
  if (!m) return null;
  const [a, mes, d, h, min] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])];
  if (!dataValida(a, mes, d)) return null;
  const desloc = (m[7] === '-' ? -1 : 1) * (Number(m[8]) * 60 + Number(m[9]));
  if (Math.abs(desloc) > 14 * 60) return null;
  const utc = Date.UTC(a, mes - 1, d, h, min) - desloc * 60_000;
  const local = new Date(utc - 180 * 60_000);
  const instante = `${local.getUTCFullYear()}-${p2(local.getUTCMonth() + 1)}-${p2(local.getUTCDate())}T${p2(local.getUTCHours())}:${p2(local.getUTCMinutes())}`;
  return { instante, fuso: `${m[7]}${m[8]}${m[9]}`, dia: `${m[1]}-${m[2]}-${m[3]}` };
}

/** CPF do campo de 12 posições do AFD (o primeiro dígito é 0); null se inválido. */
export function cpfDoAfd(campo: string): string | null {
  if (!/^\d{12}$/.test(campo) || campo[0] !== '0') return null;
  const cpf = campo.slice(1);
  return cpfValido(cpf) ? cpf : null;
}

const so = (linha: string, de: number, ate: number) => linha.slice(de - 1, ate);

/**
 * Valida o AFD inteiro e devolve as marcações (tipos 3 e 7) só quando nada falhou (regra 12: falha em qualquer linha
 * põe o arquivo inteiro em quarentena; nenhuma marcação entra).
 */
export function validarAfd(conteudo: string, opcoes: OpcoesAfd = {}): ResultadoAfd {
  const leiaute = opcoes.leiaute ?? LEIAUTE_AFD_PADRAO;
  const conferirCrc = opcoes.conferirCrc ?? true;
  const falhas: FalhaLinhaAfd[] = [];
  let totalFalhas = 0;
  const falhar = (codigo: FalhaAfd, linha: number | null) => {
    totalFalhas++;
    if (falhas.length < TETO_FALHAS_LISTADAS) falhas.push({ codigo, linha });
  };
  const linhas = conteudo.replace(/\r\n?/g, '\n').split('\n');
  while (linhas.length > 0 && linhas[linhas.length - 1]!.trim() === '') linhas.pop();
  const porTipo: Record<string, number> = {};
  const vazio = (): ResultadoAfd => ({
    situacao: 'quarentena',
    cabecalho: null,
    marcacoes: [],
    falhas,
    totalFalhas,
    linhas: linhas.length,
    porTipo,
    nsrInicial: null,
    nsrFinal: null,
  });
  if (linhas.length === 0) {
    falhar('vazio', null);
    return vazio();
  }

  // Cabeçalho.
  const c = linhas[0]!;
  let cabecalho: CabecalhoAfd | null = null;
  if (!c.startsWith('000000000') || c[9] !== '1') falhar('sem-cabecalho', 1);
  else if (c.length !== TAMANHOS_AFD['1']) falhar('tamanho', 1);
  else {
    if (conferirCrc && crc16(c.slice(0, -4)) !== c.slice(-4)) falhar('crc', 1);
    const tipoEmp = c[10];
    const doc = so(c, 12, 25);
    const di = dataDoAfd(so(c, 207, 216));
    const df = dataDoAfd(so(c, 217, 226));
    const ger = instanteDoAfd(so(c, 227, 250));
    const versao = so(c, 251, 253);
    if ((tipoEmp !== '1' && tipoEmp !== '2') || !/^\d{14}$/.test(doc) || !di || !df || !ger || di > df)
      falhar('cabecalho-invalido', 1);
    else if (versao !== leiaute) falhar('leiaute-nao-suportado', 1);
    else
      cabecalho = {
        tipoEmpregador: tipoEmp === '1' ? 'cnpj' : 'cpf',
        cnpjEmpregador: tipoEmp === '1' ? doc : null,
        razaoSocial: so(c, 40, 189).trim(),
        numeroRep: so(c, 190, 206).trim(),
        dataInicial: di,
        dataFinal: df,
        geradoEm: ger.instante,
        leiaute: versao,
        modeloRep: so(c, 269, 298).trim(),
      };
  }

  const marcacoes: MarcacaoAfd[] = [];
  const nsrs = new Set<number>();
  const marcadas = new Set<string>();
  let anterior: number | null = null;
  let nsrInicial: number | null = null;
  let trailer: string | null = null;
  let linhaTrailer = 0;
  for (let i = 1; i < linhas.length; i++) {
    const l = linhas[i]!;
    const n = i + 1;
    if (trailer !== null) {
      if (!(l === ASSINATURA_EM_ARQUIVO && i === linhas.length - 1)) falhar('depois-do-trailer', n);
      continue;
    }
    if (l.startsWith('999999999')) {
      trailer = l;
      linhaTrailer = n;
      continue;
    }
    const tipo = l[9] ?? '';
    const tamanho = TAMANHOS_AFD[tipo];
    if (tamanho === undefined || tipo === '1') {
      falhar('tipo-desconhecido', n);
      continue;
    }
    porTipo[tipo] = (porTipo[tipo] ?? 0) + 1;
    if (l.length !== tamanho) {
      falhar('tamanho', n);
      continue;
    }
    if (conferirCrc && COM_CRC.has(tipo) && crc16(l.slice(0, -4)) !== l.slice(-4)) falhar('crc', n);
    const campoNsr = so(l, 1, 9);
    if (!/^\d{9}$/.test(campoNsr)) {
      falhar('sequencia-quebrada', n);
      continue;
    }
    const nsr = Number(campoNsr);
    if (nsrs.has(nsr)) falhar('nsr-duplicado', n);
    else if (anterior !== null && nsr !== anterior + 1) falhar('sequencia-quebrada', n);
    nsrs.add(nsr);
    anterior = Math.max(anterior ?? nsr, nsr);
    nsrInicial ??= nsr;
    const quando = instanteDoAfd(so(l, 11, 34));
    if (!quando) {
      falhar('data-invalida', n);
      continue;
    }
    if (tipo !== '3' && tipo !== '7') continue;
    const cpf = cpfDoAfd(so(l, 35, 46));
    if (!cpf) {
      falhar('cpf-invalido', n);
      continue;
    }
    if (tipo === '7') {
      if (!instanteDoAfd(so(l, 47, 70))) falhar('data-invalida', n);
      if (!/^[0-9a-fA-F]{64}$/.test(so(l, 74, 137))) falhar('hash-invalido', n);
    }
    if (cabecalho && (quando.dia < cabecalho.dataInicial || quando.dia > cabecalho.dataFinal))
      falhar('fora-do-periodo', n);
    const chave = `${cpf}|${quando.instante}`;
    if (marcadas.has(chave)) falhar('marcacao-duplicada', n);
    marcadas.add(chave);
    marcacoes.push({
      nsr,
      linha: n,
      tipoRegistro: tipo === '3' ? 3 : 7,
      instante: quando.instante,
      fuso: quando.fuso,
      cpf,
    });
  }

  if (trailer === null) falhar('sem-trailer', null);
  else if (trailer.length !== TAMANHO_TRAILER || trailer[63] !== '9') falhar('tamanho', linhaTrailer);
  else {
    const conta = (de: number) => Number(so(trailer!, de, de + 8));
    const esperado = ['2', '3', '4', '5', '6', '7'].map((t) => porTipo[t] ?? 0);
    const declarado = [10, 19, 28, 37, 46, 55].map(conta);
    if (esperado.some((v, k) => v !== declarado[k])) falhar('trailer-divergente', linhaTrailer);
  }
  if (opcoes.tipoRep === 'REP-P' && (porTipo['3'] ?? 0) > 0) falhar('tipo-desconhecido', null);

  if (totalFalhas > 0) return { ...vazio(), cabecalho };
  return {
    situacao: 'valido',
    cabecalho,
    marcacoes,
    falhas,
    totalFalhas,
    linhas: linhas.length,
    porTipo,
    nsrInicial,
    nsrFinal: anterior,
  };
}

// ── Montagem (arquivos sintéticos dos testes e do `pnpm ponto:afd-validar`) ─────────────────────────────────────

const pad = (v: string, n: number) => v.slice(0, n).padEnd(n, ' ');
const num = (v: number, n: number) => String(v).padStart(n, '0');
const comCrc = (corpo: string) => `${corpo}${crc16(corpo)}`;

export interface DadosCabecalhoAfd {
  readonly cnpj: string;
  readonly razaoSocial: string;
  readonly numeroRep: string;
  readonly dataInicial: string;
  readonly dataFinal: string;
  /** `AAAA-MM-DDThh:mm:00-0300`. */
  readonly geradoEm: string;
  readonly leiaute?: string;
  readonly cnpjFabricante?: string;
  readonly modelo?: string;
}

/** Linha do cabeçalho (tipo 1) com o CRC. */
export function linhaCabecalhoAfd(d: DadosCabecalhoAfd): string {
  return comCrc(
    [
      '000000000',
      '1',
      '1',
      pad(d.cnpj, 14),
      pad('', 14),
      pad(d.razaoSocial, 150),
      pad(d.numeroRep, 17),
      d.dataInicial,
      d.dataFinal,
      d.geradoEm,
      d.leiaute ?? LEIAUTE_AFD_PADRAO,
      '1',
      pad(d.cnpjFabricante ?? '00000000000191', 14),
      pad(d.modelo ?? 'RELOGIO SINTETICO', 30),
    ].join(''),
  );
}

/** Linha de marcação do REP-C (tipo 3) com o CRC: `quando` em `AAAA-MM-DDThh:mm:00-0300`. */
export function linhaMarcacaoAfd(nsr: number, quando: string, cpf: string): string {
  return comCrc(`${num(nsr, 9)}3${quando}${num(Number(cpf), 12)}`);
}

/** Linha de evento sensível (tipo 6, sem CRC). */
export function linhaEventoAfd(nsr: number, quando: string, evento: number): string {
  return `${num(nsr, 9)}6${quando}${num(evento, 2)}`;
}

/** Trailer com as contagens dos tipos 2 a 7. */
export function linhaTrailerAfd(
  contagens: Partial<Record<'2' | '3' | '4' | '5' | '6' | '7', number>>,
): string {
  return `999999999${(['2', '3', '4', '5', '6', '7'] as const).map((t) => num(contagens[t] ?? 0, 9)).join('')}9`;
}
