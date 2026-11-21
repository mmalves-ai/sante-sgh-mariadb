// Estrutura de custos (M54-F4; ficha, seção 8, regra 7 em preparação): a classe de cada centro, a sequência do rateio
// (auxiliares e administrativos pela ordem; os produtivos só recebem) e as pendências que impedem a apuração do mês
// (F5). Puro: recebe os centros lidos (o cadastro com a classificação do custeio) e devolve o diagnóstico.
import {
  type ClasseCentroCusto,
  CLASSES_CENTRO_CUSTO,
  definicaoEstatistica,
  type ListaEstruturaCustos,
  type PendenciaEstrutura,
} from '@sgh/contratos';

export interface ClassificacaoParaEstrutura {
  readonly classe: ClasseCentroCusto;
  readonly ordemRateio: number | null;
  readonly criterio: string | null;
  readonly unidadeMensuracao: number | null;
}

export interface CentroParaEstrutura {
  readonly id: number;
  readonly codigo: number;
  readonly nome: string;
  readonly ativo: boolean;
  readonly produtivoCadastro: boolean | null;
  readonly classificacao: ClassificacaoParaEstrutura | null;
}

/** Palavras do nome que indicam centro administrativo (sugestão; quem decide é o analista de custos). */
const ADMINISTRATIVO =
  /\b(ADM|ADMINISTRA\w*|DIRETORIA|DIRE[CÇ][AÃ]O|FINANCEIR\w*|FATURAMENTO|CONTAB\w*|CONTROLADORIA|RECURSOS HUMANOS|RH|PESSOAL|COMPRAS|JUR[IÍ]DIC\w*|TESOURARIA|SUPERINTEND\w*|INFORM[AÁ]TICA|TI|RECEP[CÇ][AÃ]O|SECRETARIA|AUDITORIA|QUALIDADE|MARKETING|OUVIDORIA|CUSTOS)\b/i;

/**
 * A classe sugerida para um centro ainda não classificado: a marca de produtivo do cadastro decide entre produtivo e os
 * demais; entre auxiliar e administrativo, o nome do centro. Sem a marca, nenhuma sugestão.
 */
export function sugerirClasse(produtivoCadastro: boolean | null, nome: string): ClasseCentroCusto | null {
  if (produtivoCadastro === null) return null;
  if (produtivoCadastro) return 'produtivo';
  return ADMINISTRATIVO.test(nome) ? 'administrativo' : 'auxiliar';
}

/** A sequência do rateio: os centros ativos que repartem custo (auxiliar e administrativo), pela ordem e pelo ID. */
export function sequenciaDoRateio(
  centros: readonly CentroParaEstrutura[],
): { id: number; ordem: number; criterio: string }[] {
  return centros
    .filter(
      (c) =>
        c.ativo &&
        c.classificacao !== null &&
        c.classificacao.classe !== 'produtivo' &&
        c.classificacao.ordemRateio !== null &&
        c.classificacao.criterio !== null,
    )
    .map((c) => ({ id: c.id, ordem: c.classificacao!.ordemRateio!, criterio: c.classificacao!.criterio! }))
    .sort((a, b) => a.ordem - b.ordem || a.id - b.id);
}

/** Ativos por classe e os sem classe, com o total (a soma das parcelas). */
export function contarEstrutura(centros: readonly CentroParaEstrutura[]): ListaEstruturaCustos['contagem'] {
  const c: Record<ClasseCentroCusto | 'semClasse', number> = {
    produtivo: 0,
    auxiliar: 0,
    administrativo: 0,
    semClasse: 0,
  };
  for (const x of centros) {
    if (!x.ativo) continue;
    c[x.classificacao?.classe ?? 'semClasse'] += 1;
  }
  return { ...c, total: c.produtivo + c.auxiliar + c.administrativo + c.semClasse };
}

const nomes = (cs: readonly CentroParaEstrutura[], max = 5): string => {
  const ls = cs.slice(0, max).map((c) => `${c.codigo} ${c.nome}`);
  return cs.length > max ? `${ls.join(', ')} e mais ${cs.length - max}` : ls.join(', ');
};

/**
 * As pendências da estrutura. Bloqueiam a apuração: centro ativo sem classe, nenhum produtivo, ordem repetida e
 * critério fora do catálogo. Só avisam: unidade de mensuração que não está no cadastro e centro inativo classificado
 * (fica fora do rateio).
 */
export function pendenciasDaEstrutura(
  centros: readonly CentroParaEstrutura[],
  unidadesConhecidas: ReadonlySet<number>,
): PendenciaEstrutura[] {
  const r: PendenciaEstrutura[] = [];
  const ativos = centros.filter((c) => c.ativo);
  const semClasse = ativos.filter((c) => c.classificacao === null);
  if (semClasse.length > 0)
    r.push({
      tipo: 'sem-classe',
      bloqueia: true,
      centros: semClasse.map((c) => c.id),
      mensagem: `${semClasse.length} centro(s) ativo(s) sem classe: ${nomes(semClasse)}.`,
    });
  if (!ativos.some((c) => c.classificacao?.classe === 'produtivo'))
    r.push({
      tipo: 'sem-produtivo',
      bloqueia: true,
      centros: [],
      mensagem:
        'Nenhum centro ativo está classificado como produtivo: o rateio não teria quem recebesse o custo.',
    });
  const porOrdem = new Map<number, CentroParaEstrutura[]>();
  for (const c of ativos) {
    const o = c.classificacao?.classe === 'produtivo' ? null : (c.classificacao?.ordemRateio ?? null);
    if (o === null) continue;
    porOrdem.set(o, [...(porOrdem.get(o) ?? []), c]);
  }
  for (const [ordem, cs] of [...porOrdem].sort((a, b) => a[0] - b[0]))
    if (cs.length > 1)
      r.push({
        tipo: 'ordem-repetida',
        bloqueia: true,
        centros: cs.map((c) => c.id),
        mensagem: `A ordem ${ordem} do rateio está em ${cs.length} centros: ${nomes(cs)}. Cada centro rateia numa posição só.`,
      });
  const criterioRuim = ativos.filter(
    (c) => c.classificacao?.criterio != null && definicaoEstatistica(c.classificacao.criterio) === undefined,
  );
  if (criterioRuim.length > 0)
    r.push({
      tipo: 'criterio-desconhecido',
      bloqueia: true,
      centros: criterioRuim.map((c) => c.id),
      mensagem: `Critério de rateio fora do catálogo de estatísticas em: ${nomes(criterioRuim)}.`,
    });
  const unidadeRuim = ativos.filter(
    (c) =>
      c.classificacao?.unidadeMensuracao != null &&
      !unidadesConhecidas.has(c.classificacao.unidadeMensuracao),
  );
  if (unidadeRuim.length > 0)
    r.push({
      tipo: 'unidade-desconhecida',
      bloqueia: false,
      centros: unidadeRuim.map((c) => c.id),
      mensagem: `Unidade de mensuração que não está no cadastro em: ${nomes(unidadeRuim)}.`,
    });
  const inativos = centros.filter((c) => !c.ativo && c.classificacao !== null);
  if (inativos.length > 0)
    r.push({
      tipo: 'inativo-classificado',
      bloqueia: false,
      centros: inativos.map((c) => c.id),
      mensagem: `${inativos.length} centro(s) inativo(s) com classificação ficam fora do rateio: ${nomes(inativos)}.`,
    });
  return r;
}

/** Confere que a classe é do catálogo (entrada lida do banco). */
export function classeValida(v: string): v is ClasseCentroCusto {
  return (CLASSES_CENTRO_CUSTO as readonly string[]).includes(v);
}
