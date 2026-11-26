// Publicação do fato contábil pelo próprio módulo (ADR 0003): o documento que tem efeito contábil (cota de depreciação,
// perda por impairment, saída de estoque, nota de entrada, conta fechada, repasse) grava o fato na MESMA transação em
// que grava o documento; nenhuma leitura posterior de tabelas de outro módulo. O estorno do documento publica o fato de
// estorno (nada apagado: o fato original fica e o estorno aponta para ele). Regra pura: a persistência só grava a linha
// que sai daqui e calcula o resumo SHA-256 sobre `conteudo`.
import { CODIGOS_TIPO_FATO, TIPOS_FATO, type TipoFato, type ValorCampoFato } from '@sgh/contratos';

/** Tamanho da coluna `documento` do fato. */
export const TAMANHO_DOCUMENTO_FATO = 60;
/** Teto do valor de um fato (DECIMAL(15,2)). */
export const TETO_CENTAVOS_FATO = 9_999_999_999_999_99;

export interface FatoParaPublicar {
  readonly tipo: TipoFato;
  /** Tabela do documento que gera o fato (a linha da origem). */
  readonly entidade: string;
  readonly entidadeId: number;
  /** Data do fato (AAAA-MM-DD): define a competência contábil. */
  readonly data: string;
  readonly valorCentavos: number;
  readonly centroCusto: number | null;
  readonly documento: string;
  /** Campos que as condições e o de-para da regra de contabilização usam. */
  readonly campos: Readonly<Record<string, ValorCampoFato>>;
}

export interface LinhaFatoPublicado {
  readonly tipo: TipoFato;
  readonly rotuloTipo: string;
  readonly entidade: string;
  readonly entidadeId: number;
  readonly data: string;
  /** Primeiro dia do mês da data do fato. */
  readonly competencia: string;
  /** Valor em reais com duas casas, como o banco guarda. */
  readonly valor: string;
  readonly centroCusto: number | null;
  readonly documento: string;
  readonly campos: Readonly<Record<string, ValorCampoFato>>;
  /** Forma canônica do efeito contábil: o resumo dela é a impressão (mesmo efeito = mesmo fato). */
  readonly conteudo: string;
}

export type CodigoFatoInvalido = 'tipo-fato' | 'entidade-fato' | 'data-fato' | 'valor-fato' | 'centro-fato';

export class FatoInvalido extends Error {
  readonly codigo: CodigoFatoInvalido;
  constructor(codigo: CodigoFatoInvalido, mensagem: string) {
    super(mensagem);
    this.codigo = codigo;
    this.name = 'FatoInvalido';
  }
}

const ENTIDADE = /^[a-z][a-z0-9_]{1,63}$/;

function dataDoFato(d: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return null;
  const [a, me, di] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(a, me - 1, di));
  return dt.getUTCFullYear() === a && dt.getUTCMonth() === me - 1 && dt.getUTCDate() === di && a >= 1900
    ? d
    : null;
}

/** Centavos inteiros para o texto decimal do banco (sem ponto flutuante). */
export function reaisDoFato(centavos: number): string {
  const s = String(Math.abs(centavos)).padStart(3, '0');
  return `${centavos < 0 ? '-' : ''}${s.slice(0, -2)}.${s.slice(-2)}`;
}

function canonico(campos: Readonly<Record<string, ValorCampoFato>>): string {
  return JSON.stringify(
    Object.keys(campos)
      .sort()
      .map((k) => [k, campos[k] ?? null]),
  );
}

/**
 * A linha do fato a publicar, ou `null` quando o documento não tem efeito contábil (valor zero: a cota zerada do bem
 * já totalmente depreciado, a nota sem valor). Recusa o que não pode virar lançamento: tipo fora do catálogo, data
 * inválida, valor negativo ou fora do teto (o estorno é outro fato, nunca valor negativo), centro de custo inválido.
 */
export function fatoParaPublicar(f: FatoParaPublicar): LinhaFatoPublicado | null {
  if (!CODIGOS_TIPO_FATO.includes(f.tipo))
    throw new FatoInvalido('tipo-fato', `O tipo de fato ${String(f.tipo)} não está no catálogo.`);
  if (!ENTIDADE.test(f.entidade) || !Number.isSafeInteger(f.entidadeId) || f.entidadeId <= 0)
    throw new FatoInvalido('entidade-fato', 'O fato precisa da tabela e da linha do documento que o gerou.');
  const data = dataDoFato(f.data);
  if (!data) throw new FatoInvalido('data-fato', `A data do fato (${f.data}) não é uma data válida.`);
  if (!Number.isSafeInteger(f.valorCentavos) || f.valorCentavos < 0 || f.valorCentavos > TETO_CENTAVOS_FATO)
    throw new FatoInvalido(
      'valor-fato',
      'O valor do fato tem de ser em centavos inteiros e não negativo: o estorno é um fato próprio.',
    );
  if (f.centroCusto !== null && (!Number.isSafeInteger(f.centroCusto) || f.centroCusto <= 0))
    throw new FatoInvalido('centro-fato', 'O centro de custo do fato é inválido.');
  if (f.valorCentavos === 0) return null;
  const valor = reaisDoFato(f.valorCentavos);
  const documento = f.documento.trim().slice(0, TAMANHO_DOCUMENTO_FATO);
  return {
    tipo: f.tipo,
    rotuloTipo: TIPOS_FATO[f.tipo].rotulo,
    entidade: f.entidade,
    entidadeId: f.entidadeId,
    data,
    competencia: `${data.slice(0, 7)}-01`,
    valor,
    centroCusto: f.centroCusto,
    documento,
    campos: f.campos,
    conteudo: `${f.tipo}|${valor}|${data}|${f.centroCusto ?? '-'}|${canonico(f.campos)}`,
  };
}

/** O fato já publicado, como a persistência o lê para estornar. */
export interface FatoPublicadoLido {
  readonly id: number;
  readonly tipo: string;
  readonly data: string;
  readonly valor: string;
  readonly centroCusto: number | null;
  readonly campos: Readonly<Record<string, ValorCampoFato>>;
  readonly estorno: boolean;
  /** Já existe estorno vivo deste fato. */
  readonly estornado: boolean;
}

export interface EstornoDeFato {
  readonly fatoId: number;
  readonly data: string;
  readonly competencia: string;
  readonly valor: string;
  readonly centroCusto: number | null;
  readonly documento: string;
  readonly campos: Readonly<Record<string, ValorCampoFato>>;
  readonly conteudo: string;
}

/**
 * Os estornos a publicar quando o documento é estornado (ITG 2000, item 32: o lançamento errado não se apaga, se
 * estorna no período aberto). Só o fato original que ainda não tem estorno; o estorno leva a data do estorno do
 * documento, o mesmo valor, centro e campos do original, e o motivo no documento.
 */
export function estornosDosFatos(
  fatos: readonly FatoPublicadoLido[],
  dataEstorno: string,
  motivo: string,
): EstornoDeFato[] {
  const data = dataDoFato(dataEstorno);
  if (!data) throw new FatoInvalido('data-fato', `A data do estorno (${dataEstorno}) não é uma data válida.`);
  return fatos
    .filter((f) => !f.estorno && !f.estornado)
    .map((f) => ({
      fatoId: f.id,
      data,
      competencia: `${data.slice(0, 7)}-01`,
      valor: f.valor,
      centroCusto: f.centroCusto,
      documento: `estorno fato ${f.id}: ${motivo.trim()}`.slice(0, TAMANHO_DOCUMENTO_FATO),
      campos: f.campos,
      conteudo: `estorno|${f.id}|${f.tipo}|${f.valor}|${data}|${f.centroCusto ?? '-'}|${canonico(f.campos)}`,
    }));
}

/** Último dia do mês de uma competência AAAA-MM (a data contábil da cota mensal de depreciação). */
export function ultimoDiaDaCompetencia(competencia: string): string {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(competencia);
  if (!m) throw new FatoInvalido('data-fato', `A competência ${competencia} é inválida.`);
  const dia = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
  return `${m[1]}-${m[2]}-${String(dia).padStart(2, '0')}`;
}
