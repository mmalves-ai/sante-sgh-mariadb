// Painel gerencial montado pelo hospital (01-REL L112; F3): o gestor junta, num painel nomeado, os indicadores com
// ficha (a série apurada das competências, com numerador, denominador e meta) e textos de leitura, em ordem e com a
// largura de cada quadro, e diz quem pode abrir o painel (perfis de acesso ou pessoas, com vigência e se pode exportar).
// As regras puras ficam aqui; a porta própria grava e lê:
//   - o painel nasce em montagem (inativo) e só entra em uso com ao menos um quadro e uma permissão; nada é apagado
//     (o painel sai de uso como inativo; o quadro ou a permissão que sai fica marcado como excluído);
//   - quem abre: o dono do painel, quem tem permissão vigente pelo perfil ou pela pessoa, e o editor geral dos painéis;
//   - o período padrão vira um intervalo de competências (o primeiro dia de cada mês), contado a partir de hoje;
//   - a forma de exibição combina com o tipo do quadro (o texto só como texto; o indicador nunca como texto).

export const TIPOS_ITEM_PAINEL = ['indicador', 'texto'] as const;
export type TipoItemPainel = (typeof TIPOS_ITEM_PAINEL)[number];

export const FORMAS_EXIBICAO_PAINEL = [
  'numero',
  'barra',
  'linha',
  'area',
  'velocimetro',
  'tabela',
  'texto',
] as const;
export type FormaExibicaoPainel = (typeof FORMAS_EXIBICAO_PAINEL)[number];

export const PUBLICOS_PAINEL = [
  'diretoria',
  'gestor',
  'qualidade',
  'financeiro',
  'assistencial',
  'todos',
] as const;
export type PublicoPainel = (typeof PUBLICOS_PAINEL)[number];

export const PERIODOS_PAINEL = [
  'dia_atual',
  'mes_atual',
  'mes_anterior',
  'ultimos_3_meses',
  'ultimos_12_meses',
  'ano_atual',
] as const;
export type PeriodoPainel = (typeof PERIODOS_PAINEL)[number];

/** Teto de quadros num painel (o painel é para ler de relance). */
export const MAXIMO_ITENS_PAINEL = 30;
/** Teto de permissões de um painel. */
export const MAXIMO_PERMISSOES_PAINEL = 100;

export interface ItemPainelEntrada {
  readonly tipo: TipoItemPainel;
  readonly indicadorId: number | null;
  readonly titulo: string | null;
  readonly texto: string | null;
  readonly forma: FormaExibicaoPainel;
  /** Colunas da grade (1 a 3). */
  readonly largura: number;
  /** Casas decimais do número (0 a 6; nulo: as da ficha do indicador). */
  readonly casasDecimais: number | null;
  readonly exibirMeta: boolean;
}

export interface PermissaoPainelEntrada {
  readonly perfilId: number | null;
  readonly usuarioId: number | null;
  readonly podeExportar: boolean;
  /** AAAA-MM-DD ou nulo. */
  readonly vigenciaInicio: string | null;
  readonly vigenciaFim: string | null;
}

export interface ErroRegraPainel {
  readonly campo: string;
  readonly codigo: string;
  readonly mensagem: string;
}

const DIA = /^\d{4}-\d{2}-\d{2}$/;

/** O que falta ou sobra nos quadros (a tela confere na hora; o servidor confere de novo). */
export function conferirItensPainel(itens: readonly ItemPainelEntrada[]): ErroRegraPainel[] {
  const erros: ErroRegraPainel[] = [];
  if (itens.length > MAXIMO_ITENS_PAINEL)
    erros.push({
      campo: 'itens',
      codigo: 'itens-demais',
      mensagem: `O painel aceita até ${MAXIMO_ITENS_PAINEL} quadros.`,
    });
  const vistos = new Set<string>();
  for (const [i, it] of itens.entries()) {
    const campo = `itens[${i}]`;
    const erro = (codigo: string, mensagem: string) => erros.push({ campo, codigo, mensagem });
    if (!Number.isInteger(it.largura) || it.largura < 1 || it.largura > 3)
      erro('largura-invalida', 'A largura vai de 1 a 3 colunas.');
    if (
      it.casasDecimais !== null &&
      (!Number.isInteger(it.casasDecimais) || it.casasDecimais < 0 || it.casasDecimais > 6)
    )
      erro('casas-invalidas', 'As casas decimais vão de 0 a 6.');
    if (it.tipo === 'indicador') {
      if (it.indicadorId === null) erro('indicador-ausente', 'Escolha o indicador do quadro.');
      else {
        const chave = `${it.indicadorId}:${it.forma}`;
        if (vistos.has(chave))
          erro('indicador-repetido', 'O mesmo indicador já está no painel com esta forma de exibição.');
        vistos.add(chave);
      }
      if (it.forma === 'texto') erro('forma-invalida', 'O indicador não é exibido como texto.');
    } else {
      if (!it.texto || it.texto.trim().length === 0) erro('texto-ausente', 'Escreva o texto do quadro.');
      if (it.forma !== 'texto') erro('forma-invalida', 'O quadro de texto é exibido como texto.');
    }
  }
  return erros;
}

/** As permissões: perfil ou pessoa (um dos dois), sem repetir, com a vigência em ordem. */
export function conferirPermissoesPainel(permissoes: readonly PermissaoPainelEntrada[]): ErroRegraPainel[] {
  const erros: ErroRegraPainel[] = [];
  if (permissoes.length > MAXIMO_PERMISSOES_PAINEL)
    erros.push({
      campo: 'permissoes',
      codigo: 'permissoes-demais',
      mensagem: `O painel aceita até ${MAXIMO_PERMISSOES_PAINEL} permissões.`,
    });
  const vistos = new Set<string>();
  for (const [i, p] of permissoes.entries()) {
    const campo = `permissoes[${i}]`;
    const erro = (codigo: string, mensagem: string) => erros.push({ campo, codigo, mensagem });
    if ((p.perfilId === null) === (p.usuarioId === null)) {
      erro('alvo-invalido', 'A permissão é de um perfil ou de uma pessoa, um dos dois.');
      continue;
    }
    const chave = p.perfilId !== null ? `p:${p.perfilId}` : `u:${p.usuarioId}`;
    if (vistos.has(chave)) erro('permissao-repetida', 'Este perfil ou pessoa já tem permissão no painel.');
    vistos.add(chave);
    for (const [nome, v] of [
      ['inicio', p.vigenciaInicio],
      ['fim', p.vigenciaFim],
    ] as const)
      if (v !== null && !DIA.test(v)) erro('vigencia-invalida', `A data de ${nome} da vigência é inválida.`);
    if (p.vigenciaInicio && p.vigenciaFim && p.vigenciaFim < p.vigenciaInicio)
      erro('vigencia-invertida', 'O fim da vigência vem antes do início.');
  }
  return erros;
}

/** O painel só entra em uso com ao menos um quadro e uma permissão. */
export function conferirAtivacaoPainel(itens: number, permissoes: number): ErroRegraPainel[] {
  const erros: ErroRegraPainel[] = [];
  if (itens === 0)
    erros.push({ campo: 'itens', codigo: 'sem-itens', mensagem: 'Inclua ao menos um quadro no painel.' });
  if (permissoes === 0)
    erros.push({
      campo: 'permissoes',
      codigo: 'sem-permissoes',
      mensagem: 'Diga ao menos um perfil ou pessoa que pode abrir o painel.',
    });
  return erros;
}

export interface PermissaoPainelGravada {
  readonly perfilId: number | null;
  readonly usuarioId: number | null;
  readonly podeExportar: boolean;
  readonly vigenciaInicio: string | null;
  readonly vigenciaFim: string | null;
}

export interface AcessoPainel {
  readonly ver: boolean;
  readonly exportar: boolean;
}

/**
 * Quem abre o painel: o editor geral e o dono (com exportação), e quem tem permissão vigente hoje pelo perfil ou pela
 * pessoa. O painel inativo só abre para o editor geral e o dono (para conferir antes de pôr em uso).
 */
export function acessoAoPainel(
  painel: { readonly ativo: boolean; readonly donoId: number | null },
  permissoes: readonly PermissaoPainelGravada[],
  pessoa: {
    readonly usuarioId: number | null;
    readonly perfis: ReadonlySet<number>;
    readonly editorGeral: boolean;
  },
  hoje: string,
): AcessoPainel {
  if (pessoa.editorGeral || (pessoa.usuarioId !== null && painel.donoId === pessoa.usuarioId))
    return { ver: true, exportar: true };
  if (!painel.ativo) return { ver: false, exportar: false };
  const vigentes = permissoes.filter(
    (p) =>
      (p.vigenciaInicio === null || p.vigenciaInicio <= hoje) &&
      (p.vigenciaFim === null || p.vigenciaFim >= hoje) &&
      ((p.usuarioId !== null && p.usuarioId === pessoa.usuarioId) ||
        (p.perfilId !== null && pessoa.perfis.has(p.perfilId))),
  );
  return { ver: vigentes.length > 0, exportar: vigentes.some((p) => p.podeExportar) };
}

const mes = (ano: number, m: number): string => {
  const d = new Date(Date.UTC(ano, m, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
};

/** As competências (primeiro dia do mês, AAAA-MM-DD) que o período padrão cobre, contadas a partir de hoje. */
export function competenciasDoPeriodo(periodo: PeriodoPainel, hoje: string): { de: string; ate: string } {
  const ano = Number(hoje.slice(0, 4));
  const m = Number(hoje.slice(5, 7)) - 1;
  switch (periodo) {
    case 'dia_atual':
    case 'mes_atual':
      return { de: mes(ano, m), ate: mes(ano, m) };
    case 'mes_anterior':
      return { de: mes(ano, m - 1), ate: mes(ano, m - 1) };
    case 'ultimos_3_meses':
      return { de: mes(ano, m - 3), ate: mes(ano, m - 1) };
    case 'ultimos_12_meses':
      return { de: mes(ano, m - 12), ate: mes(ano, m - 1) };
    case 'ano_atual':
      return { de: mes(ano, 0), ate: mes(ano, m) };
  }
}

/** Variação da última competência sobre a anterior (nula sem as duas ou com a anterior zero), em percentual. */
export function variacaoDaSerie(valores: readonly (number | null)[]): number | null {
  const v = valores.filter((x): x is number => x !== null);
  if (v.length < 2) return null;
  const [antes, agora] = [v[v.length - 2]!, v[v.length - 1]!];
  if (antes === 0) return null;
  return Math.round(((agora - antes) / Math.abs(antes)) * 1000) / 10;
}
