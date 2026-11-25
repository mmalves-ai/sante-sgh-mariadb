// Projeto como centro de resultado (C2-107, 07-FIN linha 128, F8): o cadastro do projeto com a verba, as etapas, os
// centros de custo participantes e os produtos ou serviços previstos; a apropriação de despesas e receitas ao projeto
// (título a pagar, título a receber, lançamento contábil, consumo de estoque ou contrato), com rateio pelo percentual
// do documento; e o resultado do projeto (orçado contra realizado, receita menos despesa, por etapa e por centro).
// Regras puras: sem banco nem relógio. A porta própria lê o que precisa e grava o que estas funções aprovam.

export interface ProblemaProjeto {
  readonly campo: string;
  readonly mensagem: string;
}

export const TIPOS_PROJETO = ['obra', 'pesquisa', 'convenio', 'investimento', 'melhoria', 'outro'] as const;
export type TipoProjeto = (typeof TIPOS_PROJETO)[number];
export const SITUACOES_PROJETO = ['planejado', 'em_andamento', 'concluido', 'suspenso', 'cancelado'] as const;
export type SituacaoProjeto = (typeof SITUACOES_PROJETO)[number];
export const SITUACOES_ETAPA = ['planejada', 'em_andamento', 'concluida', 'cancelada'] as const;
export type SituacaoEtapa = (typeof SITUACOES_ETAPA)[number];
export const ORIGENS_APROPRIACAO = ['titulo', 'titulo_receber', 'lancamento', 'consumo', 'contrato'] as const;
export type OrigemApropriacao = (typeof ORIGENS_APROPRIACAO)[number];
export type NaturezaApropriacao = 'receita' | 'despesa';

const centavos = (v: number): number => Math.round(v * 100) / 100;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const dataValida = (d: string | null | undefined): boolean => d == null || DATA.test(d);

/** As passagens de situação do projeto: concluído e cancelado são finais. */
const PASSAGENS: Readonly<Record<SituacaoProjeto, readonly SituacaoProjeto[]>> = {
  planejado: ['em_andamento', 'cancelado'],
  em_andamento: ['concluido', 'suspenso', 'cancelado'],
  suspenso: ['em_andamento', 'cancelado'],
  concluido: [],
  cancelado: [],
};

export function passagemProjetoPermitida(de: SituacaoProjeto, para: SituacaoProjeto): boolean {
  return de === para || PASSAGENS[de].includes(para);
}

export interface EtapaProposta {
  readonly sequencia: number;
  readonly descricao: string;
  readonly centroCusto: number | null;
  readonly inicioPrevisto: string | null;
  readonly fimPrevisto: string | null;
  readonly valorPrevisto: number;
  readonly percentualConcluido: number;
  readonly situacao: SituacaoEtapa;
}

export interface CentroProposto {
  readonly centroCusto: number;
  readonly percentual: number | null;
}

export interface ProdutoProposto {
  readonly insumo: number | null;
  readonly servico: string | null;
  readonly quantidade: number;
  readonly valorPrevisto: number | null;
}

export interface ProjetoProposto {
  readonly codigo: string;
  readonly descricao: string;
  readonly tipo: string;
  readonly verba: number;
  readonly inicioPrevisto: string | null;
  readonly fimPrevisto: string | null;
  readonly situacao: SituacaoProjeto;
  /** A situação gravada (nulo no cadastro novo). */
  readonly situacaoAnterior: SituacaoProjeto | null;
  readonly etapas: readonly EtapaProposta[];
  readonly centros: readonly CentroProposto[];
  readonly produtos: readonly ProdutoProposto[];
  /** As sequências de etapa já gravadas que têm apropriação (não podem sair nem ser canceladas). */
  readonly etapasComApropriacao?: readonly number[];
  /** As sequências de etapa já gravadas (a etapa não sai: cancela-se). */
  readonly etapasGravadas?: readonly number[];
}

const dentro = (d: string | null, ini: string | null, fim: string | null): boolean =>
  d === null || ((ini === null || d >= ini) && (fim === null || d <= fim));

/** Confere o cadastro do projeto inteiro (cabeçalho, etapas, centros e produtos); devolve os problemas. */
export function conferirProjeto(p: ProjetoProposto): ProblemaProjeto[] {
  const r: ProblemaProjeto[] = [];
  const codigo = p.codigo.trim();
  if (!codigo || codigo.length > 20)
    r.push({ campo: 'codigo', mensagem: 'Informe o código do projeto (até 20 caracteres).' });
  if (!p.descricao.trim() || p.descricao.trim().length > 150)
    r.push({ campo: 'descricao', mensagem: 'Informe a descrição do projeto (até 150 caracteres).' });
  if (!(TIPOS_PROJETO as readonly string[]).includes(p.tipo))
    r.push({ campo: 'tipo', mensagem: 'Escolha o tipo do projeto.' });
  if (!Number.isFinite(p.verba) || p.verba < 0)
    r.push({ campo: 'verba', mensagem: 'A verba do projeto não pode ser negativa.' });
  if (!dataValida(p.inicioPrevisto) || !dataValida(p.fimPrevisto))
    r.push({ campo: 'inicioPrevisto', mensagem: 'Datas no formato AAAA-MM-DD.' });
  else if (p.inicioPrevisto && p.fimPrevisto && p.fimPrevisto < p.inicioPrevisto)
    r.push({ campo: 'fimPrevisto', mensagem: 'O fim previsto não pode ser antes do início previsto.' });
  if (p.situacaoAnterior === null && !['planejado', 'em_andamento'].includes(p.situacao))
    r.push({ campo: 'situacao', mensagem: 'O projeto novo começa planejado ou em andamento.' });
  if (p.situacaoAnterior !== null && !passagemProjetoPermitida(p.situacaoAnterior, p.situacao))
    r.push({
      campo: 'situacao',
      mensagem: `O projeto ${p.situacaoAnterior.replace('_', ' ')} não pode passar a ${p.situacao.replace('_', ' ')}.`,
    });

  // Etapas: sequência única, datas dentro do projeto, soma prevista dentro da verba.
  const seqs = new Set<number>();
  let somaEtapas = 0;
  const comApropriacao = new Set(p.etapasComApropriacao ?? []);
  p.etapas.forEach((e, i) => {
    const c = (campo: string) => `etapas.${i}.${campo}`;
    if (!Number.isInteger(e.sequencia) || e.sequencia < 1 || e.sequencia > 999)
      r.push({ campo: c('sequencia'), mensagem: `Etapa ${i + 1}: sequência de 1 a 999.` });
    else if (seqs.has(e.sequencia))
      r.push({ campo: c('sequencia'), mensagem: `Etapa ${e.sequencia} repetida.` });
    seqs.add(e.sequencia);
    if (!e.descricao.trim())
      r.push({ campo: c('descricao'), mensagem: `Etapa ${e.sequencia}: informe a descrição.` });
    if (!dataValida(e.inicioPrevisto) || !dataValida(e.fimPrevisto))
      r.push({ campo: c('inicioPrevisto'), mensagem: `Etapa ${e.sequencia}: datas no formato AAAA-MM-DD.` });
    else {
      if (e.inicioPrevisto && e.fimPrevisto && e.fimPrevisto < e.inicioPrevisto)
        r.push({ campo: c('fimPrevisto'), mensagem: `Etapa ${e.sequencia}: o fim é antes do início.` });
      if (
        !dentro(e.inicioPrevisto, p.inicioPrevisto, p.fimPrevisto) ||
        !dentro(e.fimPrevisto, p.inicioPrevisto, p.fimPrevisto)
      )
        r.push({
          campo: c('inicioPrevisto'),
          mensagem: `Etapa ${e.sequencia}: as datas ficam dentro do prazo do projeto.`,
        });
    }
    if (!Number.isFinite(e.valorPrevisto) || e.valorPrevisto < 0)
      r.push({ campo: c('valorPrevisto'), mensagem: `Etapa ${e.sequencia}: valor previsto não negativo.` });
    if (!(e.percentualConcluido >= 0 && e.percentualConcluido <= 100))
      r.push({ campo: c('percentualConcluido'), mensagem: `Etapa ${e.sequencia}: concluído de 0 a 100%.` });
    if (e.situacao === 'concluida' && e.percentualConcluido !== 100)
      r.push({
        campo: c('percentualConcluido'),
        mensagem: `Etapa ${e.sequencia}: a concluída fica em 100%.`,
      });
    if (e.situacao === 'cancelada' && comApropriacao.has(e.sequencia))
      r.push({
        campo: c('situacao'),
        mensagem: `Etapa ${e.sequencia}: tem valores apropriados; estorne-os antes de cancelar.`,
      });
    if (e.situacao !== 'cancelada') somaEtapas += e.valorPrevisto;
  });
  for (const s of p.etapasGravadas ?? [])
    if (!seqs.has(s))
      r.push({ campo: 'etapas', mensagem: `A etapa ${s} já gravada não sai do projeto: cancele-a.` });
  if (centavos(somaEtapas) > centavos(p.verba))
    r.push({
      campo: 'etapas',
      mensagem: `A soma prevista das etapas (${centavos(somaEtapas).toFixed(2)}) passa da verba do projeto (${centavos(p.verba).toFixed(2)}).`,
    });

  // Centros participantes: sem repetição; soma das participações até 100%.
  const centros = new Set<number>();
  let somaPct = 0;
  p.centros.forEach((c, i) => {
    if (centros.has(c.centroCusto))
      r.push({ campo: `centros.${i}.centroCusto`, mensagem: 'Centro de custo repetido no projeto.' });
    centros.add(c.centroCusto);
    if (c.percentual !== null && !(c.percentual > 0 && c.percentual <= 100))
      r.push({ campo: `centros.${i}.percentual`, mensagem: 'Participação de 0 a 100%.' });
    somaPct += c.percentual ?? 0;
  });
  if (Math.round(somaPct * 10000) > 100 * 10000)
    r.push({ campo: 'centros', mensagem: 'A soma das participações dos centros passa de 100%.' });

  // Produtos ou serviços previstos: um ou outro, sem repetição.
  const produtos = new Set<string>();
  p.produtos.forEach((x, i) => {
    const servico = x.servico?.trim() || null;
    if ((x.insumo === null) === (servico === null))
      r.push({
        campo: `produtos.${i}.insumo`,
        mensagem: 'Informe o produto de estoque ou o serviço, um dos dois.',
      });
    const chave = x.insumo !== null ? `i${x.insumo}` : `s${(servico ?? '').toLowerCase()}`;
    if (produtos.has(chave))
      r.push({ campo: `produtos.${i}.insumo`, mensagem: 'Produto ou serviço repetido.' });
    produtos.add(chave);
    if (!(x.quantidade > 0))
      r.push({ campo: `produtos.${i}.quantidade`, mensagem: 'Quantidade maior que zero.' });
    if (x.valorPrevisto !== null && !(x.valorPrevisto >= 0))
      r.push({ campo: `produtos.${i}.valorPrevisto`, mensagem: 'Valor previsto não negativo.' });
  });
  return r;
}

/** A natureza que a origem impõe (o lançamento contábil é o único em que se escolhe). */
export function naturezaDaOrigem(origem: OrigemApropriacao): NaturezaApropriacao | null {
  if (origem === 'titulo_receber') return 'receita';
  if (origem === 'lancamento') return null;
  return 'despesa';
}

export interface ApropriacaoProposta {
  readonly origem: OrigemApropriacao;
  readonly natureza: NaturezaApropriacao | null;
  readonly situacaoProjeto: SituacaoProjeto;
  /** O valor do documento de origem. */
  readonly valorOrigem: number;
  /** O que o documento já tem apropriado a projetos (este e outros), sem estornos. */
  readonly jaApropriado: number;
  /** Percentual do documento (rateio) ou valor direto: um dos dois. */
  readonly percentual: number | null;
  readonly valor: number | null;
  readonly data: string;
  /** Situação da etapa escolhida (nulo sem etapa; 'inexistente' quando não é do projeto). */
  readonly etapa: SituacaoEtapa | 'inexistente' | null;
  /** O documento de origem está cancelado ou estornado. */
  readonly origemCancelada: boolean;
}

export interface ApropriacaoAprovada {
  readonly natureza: NaturezaApropriacao;
  readonly valor: number;
  readonly percentual: number | null;
}

/** Confere a apropriação ao projeto e calcula o valor (pelo percentual do documento ou o valor direto). */
export function conferirApropriacao(a: ApropriacaoProposta): {
  problemas: ProblemaProjeto[];
  aprovada: ApropriacaoAprovada | null;
} {
  const r: ProblemaProjeto[] = [];
  if (!['planejado', 'em_andamento'].includes(a.situacaoProjeto))
    r.push({
      campo: 'projeto',
      mensagem: `O projeto ${a.situacaoProjeto.replace('_', ' ')} não recebe apropriação.`,
    });
  const imposta = naturezaDaOrigem(a.origem);
  if (imposta === null && a.natureza === null)
    r.push({ campo: 'natureza', mensagem: 'Diga se o lançamento é receita ou despesa do projeto.' });
  if (imposta !== null && a.natureza !== null && a.natureza !== imposta)
    r.push({
      campo: 'natureza',
      mensagem:
        imposta === 'receita'
          ? 'O título a receber entra como receita do projeto.'
          : 'Título a pagar, consumo e contrato entram como despesa do projeto.',
    });
  if (!DATA.test(a.data)) r.push({ campo: 'data', mensagem: 'Data da apropriação no formato AAAA-MM-DD.' });
  if (a.origemCancelada)
    r.push({ campo: 'documento', mensagem: 'O documento de origem está cancelado ou estornado.' });
  if (a.etapa === 'inexistente') r.push({ campo: 'etapa', mensagem: 'A etapa não é deste projeto.' });
  else if (a.etapa === 'cancelada') r.push({ campo: 'etapa', mensagem: 'A etapa está cancelada.' });
  if ((a.percentual === null) === (a.valor === null))
    r.push({ campo: 'valor', mensagem: 'Informe o percentual do documento ou o valor, um dos dois.' });
  if (a.percentual !== null && !(a.percentual > 0 && a.percentual <= 100))
    r.push({ campo: 'percentual', mensagem: 'Percentual do documento de 0 a 100%.' });
  if (a.valor !== null && !(a.valor > 0)) r.push({ campo: 'valor', mensagem: 'Valor maior que zero.' });
  const valor = centavos(a.percentual !== null ? (a.valorOrigem * a.percentual) / 100 : (a.valor ?? 0));
  const livre = centavos(a.valorOrigem - a.jaApropriado);
  if (r.length === 0 && valor <= 0) r.push({ campo: 'valor', mensagem: 'O valor apropriado ficou zero.' });
  if (r.length === 0 && valor > livre)
    r.push({
      campo: 'valor',
      mensagem: `O documento tem ${Math.max(livre, 0).toFixed(2)} livre para apropriar; pediu ${valor.toFixed(2)}.`,
    });
  if (r.length) return { problemas: r, aprovada: null };
  return {
    problemas: [],
    aprovada: { natureza: (imposta ?? a.natureza)!, valor, percentual: a.percentual },
  };
}

export interface ApropriacaoDoResultado {
  readonly natureza: NaturezaApropriacao;
  readonly valor: number;
  readonly etapa: number | null;
}
export interface EtapaDoResultado {
  readonly sequencia: number;
  readonly descricao: string;
  readonly valorPrevisto: number;
  readonly situacao: SituacaoEtapa;
}
export interface CentroDoResultado {
  readonly centroCusto: number;
  readonly percentual: number | null;
}

export interface ResultadoProjeto {
  readonly orcado: number;
  readonly despesa: number;
  readonly receita: number;
  readonly resultado: number;
  readonly saldoVerba: number;
  readonly percentualConsumido: number | null;
  readonly estourado: boolean;
  readonly etapas: readonly {
    readonly sequencia: number;
    readonly descricao: string;
    readonly previsto: number;
    readonly realizado: number;
    readonly diferenca: number;
    readonly estourada: boolean;
  }[];
  readonly semEtapa: number;
  readonly centros: readonly {
    readonly centroCusto: number;
    readonly percentual: number;
    readonly despesa: number;
  }[];
}

/**
 * O resultado do projeto: verba contra despesa realizada (saldo, % consumido, estouro), receita menos despesa, as
 * etapas (previsto contra realizado de despesa) e a despesa repartida pelos centros pela participação (sem participação
 * informada, em partes iguais; a sobra do arredondamento vai ao último).
 */
export function resultadoDoProjeto(
  verba: number,
  apropriacoes: readonly ApropriacaoDoResultado[],
  etapas: readonly EtapaDoResultado[],
  centros: readonly CentroDoResultado[],
): ResultadoProjeto {
  const despesa = centavos(
    apropriacoes.filter((a) => a.natureza === 'despesa').reduce((s, a) => s + a.valor, 0),
  );
  const receita = centavos(
    apropriacoes.filter((a) => a.natureza === 'receita').reduce((s, a) => s + a.valor, 0),
  );
  const porEtapa = new Map<number, number>();
  let semEtapa = 0;
  for (const a of apropriacoes)
    if (a.natureza === 'despesa') {
      if (a.etapa === null) semEtapa += a.valor;
      else porEtapa.set(a.etapa, (porEtapa.get(a.etapa) ?? 0) + a.valor);
    }
  const comPct = centros.some((c) => c.percentual !== null);
  const pesos = centros.map((c) => (comPct ? (c.percentual ?? 0) : 100 / centros.length));
  let repartido = 0;
  const totalPeso = pesos.reduce((s, p) => s + p, 0);
  const listaCentros = centros.map((c, i) => {
    const pct = centavos(pesos[i]!);
    let v = centavos((despesa * pesos[i]!) / 100);
    if (!comPct && i === centros.length - 1) v = centavos(despesa - repartido);
    else if (comPct && Math.round(totalPeso * 100) === 10000 && i === centros.length - 1)
      v = centavos(despesa - repartido);
    repartido = centavos(repartido + v);
    return { centroCusto: c.centroCusto, percentual: pct, despesa: v };
  });
  return {
    orcado: centavos(verba),
    despesa,
    receita,
    resultado: centavos(receita - despesa),
    saldoVerba: centavos(verba - despesa),
    percentualConsumido: verba > 0 ? Math.round((despesa / verba) * 10000) / 100 : null,
    estourado: despesa > centavos(verba),
    etapas: etapas.map((e) => {
      const realizado = centavos(porEtapa.get(e.sequencia) ?? 0);
      return {
        sequencia: e.sequencia,
        descricao: e.descricao,
        previsto: centavos(e.valorPrevisto),
        realizado,
        diferenca: centavos(e.valorPrevisto - realizado),
        estourada: e.situacao !== 'cancelada' && realizado > centavos(e.valorPrevisto),
      };
    }),
    semEtapa: centavos(semEtapa),
    centros: listaCentros,
  };
}
