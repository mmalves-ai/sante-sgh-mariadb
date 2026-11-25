// Regras de impressão da recepção (02-REC linha 35): quais fichas, guias e comprovantes saem para um atendimento,
// pela regra cadastrada por fonte pagadora, especialidade, grupo de faturamento, unidade assistencial e tipo de
// atendimento. Regras puras, sem banco:
//   - a regra vale quando TODA dimensão preenchida coincide com o atendimento; dimensão em branco vale para todos;
//   - se mais de uma regra do mesmo modelo vale, ganha a mais específica (mais dimensões preenchidas; no empate, a
//     mais antiga), e é dela que vêm as cópias e a marca "já vem selecionada";
//   - o modelo tem os seus próprios limites (só no retorno, faixa de idade, ativo), que nenhuma regra afrouxa;
//   - duas regras ativas do mesmo modelo com o mesmo alcance são recusadas (uma esconderia a outra);
//   - toda emissão é numerada: a primeira é a emissão, as seguintes são reimpressões.

export interface ModeloFichaImpressa {
  readonly id: number;
  readonly titulo: string;
  readonly copias: number;
  /** Posição na impressão (menor antes); nulo: depois dos posicionados, pelo título. */
  readonly ordem: number | null;
  readonly somenteRetorno: boolean;
  readonly idadeMinima: number | null;
  readonly idadeMaxima: number | null;
  readonly ativo: boolean;
}

/** O alcance da regra: cada dimensão em branco (null) vale para todos. */
export interface AlcanceRegraImpressao {
  /** Nulo: todas as unidades hospitalares do cliente. */
  readonly estabelecimento: number | null;
  readonly categoria: number | null;
  readonly fontePagadora: number | null;
  readonly especialidade: number | null;
  readonly grupo: number | null;
  readonly unidade: number | null;
  readonly clinica: number | null;
}

export interface RegraImpressaoFicha extends AlcanceRegraImpressao {
  readonly id: number;
  readonly modelo: number;
  /** Cópias desta regra; nulo: as do modelo. */
  readonly copias: number | null;
  /** A ficha já vem marcada para imprimir na tela da recepção. */
  readonly selecionada: boolean;
  readonly ativo: boolean;
}

/** O que o atendimento tem em cada dimensão da regra. */
export interface FatosImpressao {
  readonly estabelecimento: number;
  readonly categoria: number | null;
  readonly fontePagadora: number | null;
  readonly especialidade: number | null;
  readonly unidade: number | null;
  readonly clinica: number | null;
  /** Grupos de faturamento dos procedimentos do atendimento. */
  readonly grupos: readonly number[];
  readonly retorno: boolean;
  /** Idade em anos na entrada (null: sem data de nascimento). */
  readonly idade: number | null;
}

export interface FichaPelaRegra {
  readonly modelo: number;
  readonly nome: string;
  readonly copias: number;
  readonly ordem: number;
  readonly selecionada: boolean;
  /** A regra que decidiu. */
  readonly regra: number;
}

export interface RecusaImpressao {
  readonly codigo: string;
  readonly mensagem: string;
}

export const COPIAS_MAXIMAS_FICHA = 9;
const DIMENSOES = [
  'estabelecimento',
  'categoria',
  'fontePagadora',
  'especialidade',
  'grupo',
  'unidade',
  'clinica',
] as const satisfies readonly (keyof AlcanceRegraImpressao)[];

/** Quantas dimensões a regra preenche (0: vale para todo atendimento). */
export function especificidadeDaRegra(r: AlcanceRegraImpressao): number {
  return DIMENSOES.filter((d) => r[d] !== null).length;
}

/** A regra vale para o atendimento: toda dimensão preenchida coincide. */
export function regraValePara(r: AlcanceRegraImpressao, f: FatosImpressao): boolean {
  return (
    (r.estabelecimento === null || r.estabelecimento === f.estabelecimento) &&
    (r.categoria === null || r.categoria === f.categoria) &&
    (r.fontePagadora === null || r.fontePagadora === f.fontePagadora) &&
    (r.especialidade === null || r.especialidade === f.especialidade) &&
    (r.unidade === null || r.unidade === f.unidade) &&
    (r.clinica === null || r.clinica === f.clinica) &&
    (r.grupo === null || f.grupos.includes(r.grupo))
  );
}

function modeloValePara(m: ModeloFichaImpressa, f: FatosImpressao): boolean {
  if (!m.ativo) return false;
  if (m.somenteRetorno && !f.retorno) return false;
  if (m.idadeMinima === null && m.idadeMaxima === null) return true;
  if (f.idade === null) return false;
  if (m.idadeMinima !== null && f.idade < m.idadeMinima) return false;
  if (m.idadeMaxima !== null && f.idade > m.idadeMaxima) return false;
  return true;
}

/** As fichas que a configuração manda imprimir para o atendimento, na ordem de impressão. */
export function fichasPelasRegras(
  modelos: readonly ModeloFichaImpressa[],
  regras: readonly RegraImpressaoFicha[],
  f: FatosImpressao,
): FichaPelaRegra[] {
  const saida: FichaPelaRegra[] = [];
  for (const m of modelos) {
    if (!modeloValePara(m, f)) continue;
    const [melhor] = regras
      .filter((r) => r.ativo && r.modelo === m.id && regraValePara(r, f))
      .sort((a, b) => especificidadeDaRegra(b) - especificidadeDaRegra(a) || a.id - b.id);
    if (!melhor) continue;
    saida.push({
      modelo: m.id,
      nome: m.titulo,
      copias: melhor.copias ?? m.copias,
      ordem: m.ordem ?? 0,
      selecionada: melhor.selecionada,
      regra: melhor.id,
    });
  }
  const posicao = new Map(modelos.map((m) => [m.id, m.ordem]));
  return saida.sort((a, b) => {
    const oa = posicao.get(a.modelo) ?? null;
    const ob = posicao.get(b.modelo) ?? null;
    if (oa !== ob) return oa === null ? 1 : ob === null ? -1 : oa - ob;
    return a.nome.localeCompare(b.nome, 'pt-BR') || a.modelo - b.modelo;
  });
}

const mesmoAlcance = (a: AlcanceRegraImpressao, b: AlcanceRegraImpressao): boolean =>
  DIMENSOES.every((d) => a[d] === b[d]);

/**
 * Confere a regra antes de gravar. `outras` são as demais regras do cliente (a própria regra em alteração fica de
 * fora pelo id). Regra inativa não conflita: fica guardada como histórico da configuração.
 */
export function validarRegraImpressao(
  nova: AlcanceRegraImpressao & {
    readonly id?: number | null;
    readonly modelo: number;
    readonly copias: number | null;
    readonly ativo: boolean;
  },
  outras: readonly RegraImpressaoFicha[],
): RecusaImpressao | null {
  if (
    nova.copias !== null &&
    (!Number.isInteger(nova.copias) || nova.copias < 1 || nova.copias > COPIAS_MAXIMAS_FICHA)
  )
    return {
      codigo: 'regra-impressao-copias',
      mensagem: `As cópias da regra vão de 1 a ${COPIAS_MAXIMAS_FICHA}; em branco valem as do modelo.`,
    };
  if (
    nova.ativo &&
    outras.some(
      (o) => o.ativo && o.id !== (nova.id ?? null) && o.modelo === nova.modelo && mesmoAlcance(o, nova),
    )
  )
    return {
      codigo: 'regra-impressao-repetida',
      mensagem: 'Já existe uma regra ativa deste modelo com o mesmo alcance: altere a que existe.',
    };
  return null;
}

/** Confere o modelo de ficha antes de gravar. */
export function validarModeloFicha(m: {
  readonly titulo: string;
  readonly copias: number;
  readonly idadeMinima: number | null;
  readonly idadeMaxima: number | null;
}): RecusaImpressao | null {
  if (!m.titulo.trim())
    return { codigo: 'modelo-ficha-titulo', mensagem: 'Informe o título que sai impresso na ficha.' };
  if (!Number.isInteger(m.copias) || m.copias < 1 || m.copias > COPIAS_MAXIMAS_FICHA)
    return {
      codigo: 'modelo-ficha-copias',
      mensagem: `As cópias do modelo vão de 1 a ${COPIAS_MAXIMAS_FICHA}.`,
    };
  for (const i of [m.idadeMinima, m.idadeMaxima])
    if (i !== null && (!Number.isInteger(i) || i < 0 || i > 130))
      return { codigo: 'modelo-ficha-idade', mensagem: 'A idade vai de 0 a 130 anos.' };
  if (m.idadeMinima !== null && m.idadeMaxima !== null && m.idadeMaxima < m.idadeMinima)
    return {
      codigo: 'modelo-ficha-idade',
      mensagem: 'A idade máxima não pode ser menor que a mínima.',
    };
  return null;
}

/** A numeração da emissão: a primeira é a emissão, as seguintes são reimpressões. */
export function classificarEmissao(emissoesAnteriores: number): { sequencia: number; reimpressao: boolean } {
  const n = Math.max(0, Math.trunc(emissoesAnteriores));
  return { sequencia: n + 1, reimpressao: n > 0 };
}

/** Cópias aceitas na emissão de um modelo configurado (as da regra ou as do modelo). */
export function copiasValidasDoModelo(copias: number): boolean {
  return Number.isInteger(copias) && copias >= 1 && copias <= COPIAS_MAXIMAS_FICHA;
}
