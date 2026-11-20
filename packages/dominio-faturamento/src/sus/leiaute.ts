// Leiaute de largura fixa dos aplicativos do Ministério (CIHA01, BPA-Mag, APAC-Mag, SISAIH01; cap-12 §12.4): cada linha
// é uma sequência de campos com tamanho fixo; numérico alinhado à direita com zeros, alfanumérico à esquerda com
// espaços, em maiúsculas e sem acento (os aplicativos leem ASCII). O descritor de cada leiaute é dado (versionado por
// competência); este módulo só formata e confere. Fim de linha CR LF, como os aplicativos Windows do DATASUS geram.

export type TipoCampo = 'N' | 'A';

export interface CampoLeiaute {
  readonly nome: string;
  readonly tamanho: number;
  readonly tipo: TipoCampo;
  readonly obrigatorio: boolean;
  /** Valor fixo do campo (identificador do tipo de registro, versão). */
  readonly fixo?: string;
  /** Numérico opcional vazio sai em branco (espaços), não em zeros (o CIHA01 lê zero como valor informado). */
  readonly branco?: boolean;
}

export interface RegistroLeiaute {
  readonly tipo: string;
  readonly campos: readonly CampoLeiaute[];
}

export interface Leiaute {
  readonly nome: string;
  readonly versao: string;
  /** false enquanto o descritor não foi conferido campo a campo contra o documento oficial vigente. */
  readonly conferidoContraOficial: boolean;
  readonly fonte: string;
  readonly registros: Readonly<Record<string, RegistroLeiaute>>;
}

export const FIM_DE_LINHA = '\r\n';

export type ProblemaCampo = 'obrigatorio-vazio' | 'tamanho-excedido' | 'nao-numerico';

export class ErroLeiaute extends Error {
  readonly registro: string;
  readonly campo: string;
  readonly problema: ProblemaCampo;
  constructor(registro: string, campo: string, problema: ProblemaCampo) {
    super(`${registro}.${campo}: ${problema}`);
    this.registro = registro;
    this.campo = campo;
    this.problema = problema;
  }
}

/** Maiúsculas, sem acento e só ASCII imprimível (o que não for vira espaço). */
export function textoAscii(v: string): string {
  return v
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^\x20-\x7E]/g, ' ');
}

/** Formata um campo; recusa (ErroLeiaute) o obrigatório vazio, o numérico com letra e o que não cabe. */
export function formatarCampo(
  registro: string,
  c: CampoLeiaute,
  valor: string | number | null | undefined,
): string {
  const bruto = c.fixo ?? (valor === null || valor === undefined ? '' : String(valor));
  const v = c.tipo === 'N' ? bruto.trim() : textoAscii(bruto).trimEnd();
  if (v.length === 0) {
    if (c.obrigatorio) throw new ErroLeiaute(registro, c.nome, 'obrigatorio-vazio');
    return c.tipo === 'N' && !c.branco ? '0'.repeat(c.tamanho) : ' '.repeat(c.tamanho);
  }
  if (c.tipo === 'N' && !/^\d+$/.test(v)) throw new ErroLeiaute(registro, c.nome, 'nao-numerico');
  if (v.length > c.tamanho) throw new ErroLeiaute(registro, c.nome, 'tamanho-excedido');
  return c.tipo === 'N' ? v.padStart(c.tamanho, '0') : v.padEnd(c.tamanho, ' ');
}

export function tamanhoDoRegistro(r: RegistroLeiaute): number {
  return r.campos.reduce((s, c) => s + c.tamanho, 0);
}

/** Monta uma linha do registro com os valores por nome de campo. */
export function montarLinha(
  l: Leiaute,
  tipo: string,
  valores: Readonly<Record<string, string | number | null | undefined>>,
): string {
  const r = l.registros[tipo];
  if (!r) throw new Error(`leiaute ${l.nome}: registro ${tipo} inexistente`);
  return r.campos.map((c) => formatarCampo(tipo, c, valores[c.nome])).join('');
}

/** Lê uma linha de volta em campos (para o teste de ida e volta e para conferir o arquivo do outro sistema). */
export function lerLinha(l: Leiaute, tipo: string, linha: string): Record<string, string> {
  const r = l.registros[tipo];
  if (!r) throw new Error(`leiaute ${l.nome}: registro ${tipo} inexistente`);
  const out: Record<string, string> = {};
  let i = 0;
  for (const c of r.campos) {
    out[c.nome] = linha.slice(i, i + c.tamanho);
    i += c.tamanho;
  }
  return out;
}

export interface ProblemaEstrutura {
  readonly linha: number;
  readonly problema: 'tipo-desconhecido' | 'tamanho-errado' | 'fixo-diferente';
}

/**
 * Conferência de estrutura do arquivo (o critério de aceite "0 erro de estrutura"): cada linha tem um tipo conhecido
 * (pelo campo fixo do início), o tamanho do registro e os campos fixos certos.
 */
export function conferirEstrutura(l: Leiaute, conteudo: string): ProblemaEstrutura[] {
  const problemas: ProblemaEstrutura[] = [];
  const linhas = conteudo.split(FIM_DE_LINHA);
  if (linhas[linhas.length - 1] === '') linhas.pop();
  linhas.forEach((linha, k) => {
    const r = Object.values(l.registros).find((x) => {
      const f = x.campos[0];
      return f?.fixo !== undefined && linha.startsWith(f.fixo);
    });
    if (!r) {
      problemas.push({ linha: k + 1, problema: 'tipo-desconhecido' });
      return;
    }
    if (linha.length !== tamanhoDoRegistro(r)) {
      problemas.push({ linha: k + 1, problema: 'tamanho-errado' });
      return;
    }
    const lido = lerLinha(l, r.tipo, linha);
    if (r.campos.some((c) => c.fixo !== undefined && lido[c.nome] !== formatarCampo(r.tipo, c, c.fixo)))
      problemas.push({ linha: k + 1, problema: 'fixo-diferente' });
  });
  return problemas;
}
