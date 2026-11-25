// Cardápio do serviço de nutrição e dietética (F8, 04-HOT linha 141): preparações com a ficha técnica, o planejamento
// do cardápio por refeição e por dieta aprovado por nutricionista, a previsão da produção a partir do mapa de dietas e
// a escolha do paciente entre as opções do cardápio publicado.
//
// Referências públicas: RDC ANVISA 216/2004 (boas práticas; preparação padronizada) e Resolução CFN 600/2018 (o
// cardápio é planejado, aprovado e supervisionado pelo nutricionista).
//
// Regras (funções puras, nada de banco):
//   - ficha técnica: ao menos um ingrediente, sem gênero repetido; per capita bruto positivo; fator de correção
//     (bruto ÷ líquido) de 1 a 10; o líquido sai do bruto e do fator (ou o fator do líquido informado), nunca acima do
//     bruto; fator de cocção, quando houver, entre 0,1 e 10; custo per capita = bruto × custo da unidade; a ficha
//     devolve o custo da porção (soma) e o peso líquido cru da porção;
//   - planejamento: período de até 31 dias com fim não anterior ao início; as preparações dentro do período, com
//     porções positivas e sem repetir a mesma preparação na mesma opção do mesmo dia; enviar pede ao menos uma
//     preparação; só o rascunho é editado;
//   - situação: rascunho → em aprovação (enviar) → aprovado (aprovar: só nutricionista, CBO 2237) → publicado
//     (publicar); devolver volta ao rascunho com motivo; cancelar pede motivo e nunca apaga; cancelado é final;
//   - produção: as porções de cada preparação saem da escolha do paciente quando a opção tem escolhas no dia; senão
//     dos comensais do mapa de dietas (com a margem de segurança); senão das porções planejadas; os gêneros somam
//     porções × per capita bruto e o custo porções × custo per capita;
//   - escolha: só no cardápio publicado, para o dia de hoje em diante, numa opção ofertada naquele dia; de 1 a 3
//     porções; a escolha anterior do mesmo comensal na mesma refeição e dia é substituída (cancelada, nunca apagada).

export interface ProblemaCardapio {
  readonly campo: string;
  readonly mensagem: string;
}

export type ResultadoCardapio<T> = { ok: true; valor: T } | { ok: false; problemas: ProblemaCardapio[] };

const arred = (v: number, casas: number): number => {
  const f = 10 ** casas;
  return Math.round((v + Number.EPSILON) * f) / f;
};

export const FATOR_CORRECAO_MAXIMO = 10;
export const DIAS_MAXIMOS_PLANEJAMENTO = 31;
export const PORCOES_MAXIMAS_ESCOLHA = 3;
/** Família CBO 2237: nutricionista (223705 a 223710). */
export const CBO_NUTRICIONISTA = /^2237\d{2}$/;

// ---------------------------------------------------------------- ficha técnica

export interface IngredienteFichaEntrada {
  readonly insumo: number;
  readonly perCapitaBruto: number;
  /** Bruto ÷ líquido; sem ele, sai do líquido informado; sem os dois, 1. */
  readonly fatorCorrecao?: number | null;
  readonly perCapitaLiquido?: number | null;
  readonly fatorCoccao?: number | null;
  /** Custo de uma unidade de medida do gênero (R$). */
  readonly custoUnidade?: number | null;
}

export interface IngredienteFichaCalculado {
  readonly insumo: number;
  readonly sequencia: number;
  readonly perCapitaBruto: number;
  readonly fatorCorrecao: number;
  readonly perCapitaLiquido: number;
  readonly fatorCoccao: number | null;
  readonly custoPerCapita: number | null;
}

export interface FichaTecnicaCalculada {
  readonly itens: IngredienteFichaCalculado[];
  /** Soma dos custos per capita (R$); nulo se nenhum gênero tem custo. */
  readonly custoPorcao: number | null;
  /** Soma dos per capita líquidos (peso cru limpo da porção). */
  readonly liquidoPorcao: number;
  /** Gêneros sem custo (o custo da porção fica parcial). */
  readonly semCusto: number;
}

export function calcularFichaTecnica(
  itens: readonly IngredienteFichaEntrada[],
): ResultadoCardapio<FichaTecnicaCalculada> {
  const problemas: ProblemaCardapio[] = [];
  if (!itens.length)
    problemas.push({ campo: 'ficha', mensagem: 'A ficha técnica precisa de ao menos um ingrediente.' });
  const vistos = new Set<number>();
  const calculados: IngredienteFichaCalculado[] = [];
  itens.forEach((i, k) => {
    const campo = `ficha.${k}`;
    if (vistos.has(i.insumo))
      problemas.push({ campo, mensagem: 'O gênero já está na ficha: some as quantidades numa linha só.' });
    vistos.add(i.insumo);
    if (!(i.perCapitaBruto > 0)) {
      problemas.push({
        campo: `${campo}.perCapitaBruto`,
        mensagem: 'O per capita bruto tem de ser maior que zero.',
      });
      return;
    }
    let fc = i.fatorCorrecao ?? null;
    let liquido = i.perCapitaLiquido ?? null;
    if (fc === null && liquido !== null) {
      if (!(liquido > 0) || liquido > i.perCapitaBruto) {
        problemas.push({
          campo: `${campo}.perCapitaLiquido`,
          mensagem: 'O per capita líquido fica entre zero e o bruto (o pré-preparo só tira peso).',
        });
        return;
      }
      fc = arred(i.perCapitaBruto / liquido, 4);
    }
    fc ??= 1;
    if (fc < 1 || fc > FATOR_CORRECAO_MAXIMO) {
      problemas.push({
        campo: `${campo}.fatorCorrecao`,
        mensagem: `O fator de correção (bruto ÷ líquido) fica entre 1 e ${FATOR_CORRECAO_MAXIMO}.`,
      });
      return;
    }
    liquido = liquido ?? arred(i.perCapitaBruto / fc, 4);
    const coccao = i.fatorCoccao ?? null;
    if (coccao !== null && (coccao < 0.1 || coccao > 10))
      problemas.push({ campo: `${campo}.fatorCoccao`, mensagem: 'O fator de cocção fica entre 0,1 e 10.' });
    const custo = i.custoUnidade ?? null;
    if (custo !== null && custo < 0)
      problemas.push({ campo: `${campo}.custoUnidade`, mensagem: 'O custo não pode ser negativo.' });
    calculados.push({
      insumo: i.insumo,
      sequencia: k + 1,
      perCapitaBruto: arred(i.perCapitaBruto, 4),
      fatorCorrecao: arred(fc, 4),
      perCapitaLiquido: liquido,
      fatorCoccao: coccao,
      custoPerCapita: custo === null ? null : arred(i.perCapitaBruto * custo, 2),
    });
  });
  if (problemas.length) return { ok: false, problemas };
  const comCusto = calculados.filter((c) => c.custoPerCapita !== null);
  return {
    ok: true,
    valor: {
      itens: calculados,
      custoPorcao: comCusto.length
        ? arred(
            comCusto.reduce((s, c) => s + (c.custoPerCapita ?? 0), 0),
            2,
          )
        : null,
      liquidoPorcao: arred(
        calculados.reduce((s, c) => s + c.perCapitaLiquido, 0),
        4,
      ),
      semCusto: calculados.length - comCusto.length,
    },
  };
}

// ---------------------------------------------------------------- planejamento

export type SituacaoPlanejamento = 'rascunho' | 'em_aprovacao' | 'aprovado' | 'publicado' | 'cancelado';
export type AcaoPlanejamento = 'enviar' | 'aprovar' | 'devolver' | 'publicar' | 'cancelar';

export interface ItemPlanejamentoEntrada {
  /** AAAA-MM-DD. */
  readonly data: string;
  readonly alternativa: number | null;
  readonly preparacao: number;
  readonly porcoes: number;
}

const DIA_MS = 86_400_000;
const diaUtc = (d: string): number => Date.parse(`${d}T00:00:00Z`);

export function validarPlanejamento(e: {
  readonly periodoInicio: string;
  readonly periodoFim: string;
  readonly itens: readonly ItemPlanejamentoEntrada[];
}): ResultadoCardapio<{ itens: (ItemPlanejamentoEntrada & { sequencia: number })[] }> {
  const problemas: ProblemaCardapio[] = [];
  const ini = diaUtc(e.periodoInicio);
  const fim = diaUtc(e.periodoFim);
  if (Number.isNaN(ini) || Number.isNaN(fim) || fim < ini)
    problemas.push({ campo: 'periodoFim', mensagem: 'O fim do período não pode ser antes do início.' });
  else if ((fim - ini) / DIA_MS + 1 > DIAS_MAXIMOS_PLANEJAMENTO)
    problemas.push({
      campo: 'periodoFim',
      mensagem: `O planejamento cobre até ${DIAS_MAXIMOS_PLANEJAMENTO} dias: divida em ciclos.`,
    });
  const chaves = new Set<string>();
  e.itens.forEach((i, k) => {
    const d = diaUtc(i.data);
    if (Number.isNaN(d) || d < ini || d > fim)
      problemas.push({ campo: `itens.${k}.data`, mensagem: 'O dia da preparação fica dentro do período.' });
    if (!(i.porcoes > 0))
      problemas.push({
        campo: `itens.${k}.porcoes`,
        mensagem: 'As porções planejadas têm de ser maiores que zero.',
      });
    const chave = `${i.data}|${i.alternativa ?? 0}|${i.preparacao}`;
    if (chaves.has(chave))
      problemas.push({
        campo: `itens.${k}.preparacao`,
        mensagem: 'A preparação já está nesta opção deste dia: ajuste as porções na linha existente.',
      });
    chaves.add(chave);
  });
  if (problemas.length) return { ok: false, problemas };
  const ordenados = [...e.itens].sort(
    (a, b) => a.data.localeCompare(b.data) || (a.alternativa ?? 0) - (b.alternativa ?? 0),
  );
  return { ok: true, valor: { itens: ordenados.map((i, k) => ({ ...i, sequencia: k + 1 })) } };
}

export function transicaoPlanejamento(e: {
  readonly situacao: SituacaoPlanejamento;
  readonly acao: AcaoPlanejamento;
  readonly itens: number;
  /** CBOs ativos de quem age (aprovar exige nutricionista). */
  readonly cbosDoUsuario: readonly string[];
  readonly motivo?: string | null;
}): ResultadoCardapio<{ situacao: SituacaoPlanejamento; aprova: boolean }> {
  const recusa = (campo: string, mensagem: string): ResultadoCardapio<never> => ({
    ok: false,
    problemas: [{ campo, mensagem }],
  });
  const motivo = (e.motivo ?? '').trim();
  switch (e.acao) {
    case 'enviar':
      if (e.situacao !== 'rascunho') return recusa('acao', 'Só o rascunho é enviado para aprovação.');
      if (e.itens < 1) return recusa('itens', 'Inclua ao menos uma preparação antes de enviar.');
      return { ok: true, valor: { situacao: 'em_aprovacao', aprova: false } };
    case 'aprovar':
      if (e.situacao !== 'em_aprovacao') return recusa('acao', 'Só o cardápio em aprovação é aprovado.');
      if (!e.cbosDoUsuario.some((c) => CBO_NUTRICIONISTA.test(c)))
        return recusa('aprovador', 'O cardápio é aprovado por nutricionista (Resolução CFN 600/2018).');
      return { ok: true, valor: { situacao: 'aprovado', aprova: true } };
    case 'devolver':
      if (e.situacao !== 'em_aprovacao') return recusa('acao', 'Só o cardápio em aprovação é devolvido.');
      if (motivo.length < 5) return recusa('motivo', 'Diga o que ajustar (mínimo de 5 caracteres).');
      return { ok: true, valor: { situacao: 'rascunho', aprova: false } };
    case 'publicar':
      if (e.situacao !== 'aprovado') return recusa('acao', 'Só o cardápio aprovado é publicado.');
      return { ok: true, valor: { situacao: 'publicado', aprova: false } };
    case 'cancelar':
      if (e.situacao === 'cancelado') return recusa('acao', 'O cardápio já está cancelado.');
      if (motivo.length < 5)
        return recusa('motivo', 'Informe o motivo do cancelamento (mínimo de 5 caracteres).');
      return { ok: true, valor: { situacao: 'cancelado', aprova: false } };
    default:
      return recusa('acao', 'Ação desconhecida.');
  }
}

// ---------------------------------------------------------------- previsão de produção

export interface PreparacaoParaProducao {
  readonly preparacao: number;
  readonly alternativa: number | null;
  readonly porcoesPlanejadas: number;
  readonly ficha: readonly { insumo: number; perCapitaBruto: number; custoPerCapita: number | null }[];
}

export interface PrevisaoProducao {
  readonly preparacoes: {
    preparacao: number;
    alternativa: number | null;
    porcoes: number;
    base: 'escolha' | 'mapa' | 'planejado';
  }[];
  readonly generos: { insumo: number; quantidade: number; custo: number | null }[];
  readonly custoTotal: number | null;
}

export function preverProducao(e: {
  readonly preparacoes: readonly PreparacaoParaProducao[];
  /** Comensais do mapa de dietas para a refeição e o dia (pacientes sem jejum + acompanhantes). */
  readonly comensaisMapa: number;
  /** Porções escolhidas por opção (alternativa) no dia. */
  readonly escolhas: ReadonlyMap<number, number>;
  /** Margem de segurança sobre o mapa, em %, de 0 a 30. */
  readonly margemPercentual: number;
}): PrevisaoProducao {
  const margem = Math.min(30, Math.max(0, e.margemPercentual)) / 100;
  const generos = new Map<number, { quantidade: number; custo: number | null }>();
  const preparacoes = e.preparacoes.map((p) => {
    const escolhidas = p.alternativa !== null ? (e.escolhas.get(p.alternativa) ?? 0) : 0;
    let porcoes: number;
    let base: 'escolha' | 'mapa' | 'planejado';
    if (escolhidas > 0) {
      porcoes = escolhidas;
      base = 'escolha';
    } else if (e.comensaisMapa > 0 && p.alternativa === null) {
      porcoes = Math.ceil(arred(e.comensaisMapa * (1 + margem), 6));
      base = 'mapa';
    } else {
      porcoes = p.porcoesPlanejadas;
      base = 'planejado';
    }
    for (const f of p.ficha) {
      const g = generos.get(f.insumo) ?? { quantidade: 0, custo: null };
      g.quantidade += porcoes * f.perCapitaBruto;
      if (f.custoPerCapita !== null) g.custo = (g.custo ?? 0) + porcoes * f.custoPerCapita;
      generos.set(f.insumo, g);
    }
    return { preparacao: p.preparacao, alternativa: p.alternativa, porcoes, base };
  });
  const lista = [...generos.entries()]
    .map(([insumo, g]) => ({
      insumo,
      quantidade: arred(g.quantidade, 4),
      custo: g.custo === null ? null : arred(g.custo, 2),
    }))
    .sort((a, b) => a.insumo - b.insumo);
  const comCusto = lista.filter((g) => g.custo !== null);
  return {
    preparacoes,
    generos: lista,
    custoTotal: comCusto.length
      ? arred(
          comCusto.reduce((s, g) => s + (g.custo ?? 0), 0),
          2,
        )
      : null,
  };
}

// ---------------------------------------------------------------- escolha do paciente

export function validarEscolhaCardapio(e: {
  readonly situacaoPlano: SituacaoPlanejamento | null;
  /** AAAA-MM-DD. */
  readonly data: string;
  readonly hoje: string;
  readonly alternativaOfertada: boolean;
  readonly quantidade: number;
}): ProblemaCardapio[] {
  const problemas: ProblemaCardapio[] = [];
  if (e.situacaoPlano !== 'publicado')
    problemas.push({ campo: 'data', mensagem: 'Não há cardápio publicado para esta refeição e dia.' });
  if (e.data < e.hoje)
    problemas.push({
      campo: 'data',
      mensagem: 'A escolha é para hoje em diante: refeição passada não muda.',
    });
  if (!e.alternativaOfertada)
    problemas.push({ campo: 'alternativa', mensagem: 'Esta opção não está no cardápio do dia.' });
  if (!Number.isInteger(e.quantidade) || e.quantidade < 1 || e.quantidade > PORCOES_MAXIMAS_ESCOLHA)
    problemas.push({
      campo: 'quantidade',
      mensagem: `A quantidade fica entre 1 e ${PORCOES_MAXIMAS_ESCOLHA} porções.`,
    });
  return problemas;
}
