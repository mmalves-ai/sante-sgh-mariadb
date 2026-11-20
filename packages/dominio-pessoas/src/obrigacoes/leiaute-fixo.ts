// Motor dos arquivos de posição fixa das obrigações legais (M53-F7; SEFIP, CAGED e RAIS): cada registro é uma lista
// de campos com tamanho e tipo, declarada como dado (o leiaute é parâmetro, DP-47: a versão vem do regime gravado e
// a tabela de campos fica em um arquivo por leiaute, conferível campo a campo com o manual oficial). O motor monta a
// linha, confere o tamanho total e recusa valor que não cabe (nunca corta número em silêncio).
//
// Tipos dos campos:
// - N: numérico, alinhado à direita com zeros (vazio: zeros);
// - A: alfanumérico, alinhado à esquerda com brancos, em maiúsculas e sem acento (o que os validadores oficiais
//   aceitam); texto maior que o campo é cortado (nome, endereço), o que os manuais admitem;
// - B: brancos fixos (o valor é ignorado);
// - F: valor fixo do leiaute (o tipo do registro, o marcador de fim de linha).

export type TipoCampoFixo = 'N' | 'A' | 'B' | 'F';

export interface CampoFixo {
  readonly nome: string;
  readonly tamanho: number;
  readonly tipo: TipoCampoFixo;
  /** O valor fixo (tipo F) ou o padrão quando a entrada não traz o campo. */
  readonly fixo?: string;
}

export interface LeiauteRegistro {
  readonly registro: string;
  /** O tamanho total da linha (sem a quebra). */
  readonly tamanho: number;
  readonly campos: readonly CampoFixo[];
}

// Sem "parameter property" no construtor: as ferramentas rodam o TypeScript direto no Node (só remoção de tipos).
export class ErroLeiauteFixo extends Error {
  readonly registro: string;
  readonly campo: string;
  constructor(registro: string, campo: string, mensagem: string) {
    super(`${registro}.${campo}: ${mensagem}`);
    this.registro = registro;
    this.campo = campo;
  }
}

/** Maiúsculas, sem acento nem caractere fora de A-Z 0-9 e a pontuação simples (o que os validadores aceitam). */
export function textoLeiaute(v: string): string {
  return v
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 .,/\-&@_()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A soma dos tamanhos dos campos (o leiaute confere com o tamanho declarado). */
export const tamanhoDoLeiaute = (l: LeiauteRegistro): number => l.campos.reduce((s, c) => s + c.tamanho, 0);

export type ValoresRegistro = Readonly<Record<string, string | number | null | undefined>>;

/** Monta uma linha do registro. Campo numérico maior que o tamanho, ou com caractere não numérico, é recusado. */
export function montarRegistro(l: LeiauteRegistro, valores: ValoresRegistro): string {
  if (tamanhoDoLeiaute(l) !== l.tamanho)
    throw new ErroLeiauteFixo(
      l.registro,
      '*',
      `leiaute com ${tamanhoDoLeiaute(l)} posições, esperado ${l.tamanho}.`,
    );
  const partes: string[] = [];
  for (const c of l.campos) {
    const bruto = c.tipo === 'F' ? c.fixo : (valores[c.nome] ?? c.fixo);
    if (c.tipo === 'B') {
      partes.push(' '.repeat(c.tamanho));
      continue;
    }
    if (c.tipo === 'F') {
      const f = bruto ?? '';
      if (String(f).length !== c.tamanho)
        throw new ErroLeiauteFixo(l.registro, c.nome, `valor fixo com tamanho diferente de ${c.tamanho}.`);
      partes.push(String(f));
      continue;
    }
    if (c.tipo === 'N') {
      const t = bruto === null || bruto === undefined || bruto === '' ? '' : String(bruto);
      if (t && !/^\d+$/.test(t))
        throw new ErroLeiauteFixo(l.registro, c.nome, 'campo numérico com caractere não numérico.');
      if (t.length > c.tamanho)
        throw new ErroLeiauteFixo(l.registro, c.nome, `número com ${t.length} posições, cabe ${c.tamanho}.`);
      partes.push(t.padStart(c.tamanho, '0'));
      continue;
    }
    const t = bruto === null || bruto === undefined ? '' : textoLeiaute(String(bruto));
    partes.push(t.slice(0, c.tamanho).padEnd(c.tamanho, ' '));
  }
  const linha = partes.join('');
  if (linha.length !== l.tamanho)
    throw new ErroLeiauteFixo(l.registro, '*', `linha com ${linha.length} posições, esperado ${l.tamanho}.`);
  return linha;
}

/** Lê de volta o campo de uma linha montada (os testes e a conferência usam). */
export function campoDaLinha(l: LeiauteRegistro, linha: string, nome: string): string {
  let pos = 0;
  for (const c of l.campos) {
    if (c.nome === nome) return linha.slice(pos, pos + c.tamanho);
    pos += c.tamanho;
  }
  throw new ErroLeiauteFixo(l.registro, nome, 'campo inexistente no leiaute.');
}

/** AAAA-MM-DD → DDMMAAAA (o formato de data dos três leiautes). */
export const dataDDMMAAAA = (d: string | null | undefined): string =>
  d ? `${d.slice(8, 10)}${d.slice(5, 7)}${d.slice(0, 4)}` : '';

/** AAAA-MM → AAAAMM. */
export const competenciaAAAAMM = (c: string): string => c.replace('-', '');

/** AAAA-MM → MMAAAA (o CAGED). */
export const competenciaMMAAAA = (c: string): string => `${c.slice(5, 7)}${c.slice(0, 4)}`;

/** Junta as linhas do arquivo com CRLF (os três programas oficiais são do Windows) e a quebra final. */
export const arquivoDeLinhas = (linhas: readonly string[]): string => `${linhas.join('\r\n')}\r\n`;
