// W0-08, parte 9 (mercado M3: treinamento dos operadores e ciclo de vida; RDC 509/2021, arts. 8º, 15 e 16). Regras puras:
//   - aptos a operar o modelo: quem concluiu TODOS os cursos ativos exigidos para o modelo, cada um dentro da validade
//     (a conclusão mais nova de cada curso vale); quem tem parte, ou deixou vencer, é pendente (a lista do próximo
//     treinamento); curso inativado deixa de ser exigido (não há turma nova para ele);
//   - índice de obsolescência (0 a 100) com as três parcelas impressas: idade sobre a vida útil (peso 40), custo de
//     manutenção na janela de 12 meses sobre metade do valor do bem (peso 30; sem bem ligado, a parcela fica sem base e
//     vale 0) e OS corretivas na janela sobre o teto de 6 (peso 30); cada parcela é arredondada antes da soma, para a
//     soma impressa bater com o índice; 70 ou mais: substituir; 40 a 69: acompanhar; abaixo: manter;
//   - eventos do ciclo de vida (fatos novos): um de cada tipo por equipamento, na ordem incorporação ≤ desativação ≤
//     descarte; o descarte exige a desativação antes; nenhuma data no futuro; depois do descarte nada mais se registra.
import type {
  ConclusaoDeCurso,
  CursoDoModelo,
  FaixaObsolescencia,
  IndiceObsolescencia,
  OperadorApto,
  OperadoresDoModelo,
  OperadorPendente,
  RecusaCicloVida,
  TipoEventoCiclo,
} from '@sgh/contratos';

/** Sem acento, maiúsculas e espaços simples: a chave do modelo (fabricante + modelo). */
export function normalizarModelo(v: string): string {
  return v.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

export function operadoresDoModelo(
  cursos: readonly CursoDoModelo[],
  conclusoes: readonly ConclusaoDeCurso[],
  hoje: string,
): OperadoresDoModelo {
  const exigidos = [...new Set(cursos.filter((c) => c.cursoAtivo).map((c) => c.curso))];
  if (exigidos.length === 0) return { cursos, aptos: [], pendentes: [] };
  // A conclusão mais nova de cada pessoa em cada curso exigido.
  const porPessoa = new Map<
    number,
    { nome: string; matricula: string | null; cursos: Map<number, ConclusaoDeCurso> }
  >();
  for (const c of conclusoes) {
    if (!exigidos.includes(c.curso)) continue;
    const p = porPessoa.get(c.vinculo) ?? { nome: c.nome, matricula: c.matricula, cursos: new Map() };
    const anterior = p.cursos.get(c.curso);
    if (!anterior || anterior.conclusao < c.conclusao) p.cursos.set(c.curso, c);
    porPessoa.set(c.vinculo, p);
  }
  const aptos: OperadorApto[] = [];
  const pendentes: OperadorPendente[] = [];
  for (const [vinculo, p] of porPessoa) {
    const faltam = exigidos.filter((c) => !p.cursos.has(c));
    const vencidos = exigidos.filter((c) => {
      const v = p.cursos.get(c)?.validoAte;
      return v !== undefined && v !== null && v < hoje;
    });
    if (faltam.length === 0 && vencidos.length === 0) {
      const validades = [...p.cursos.values()].map((c) => c.validoAte).filter((v): v is string => v !== null);
      aptos.push({ vinculo, nome: p.nome, matricula: p.matricula, validoAte: validades.sort()[0] ?? null });
    } else pendentes.push({ vinculo, nome: p.nome, matricula: p.matricula, faltam, vencidos });
  }
  const porNome = (a: { nome: string }, b: { nome: string }) => a.nome.localeCompare(b.nome, 'pt-BR');
  return { cursos, aptos: aptos.sort(porNome), pendentes: pendentes.sort(porNome) };
}

/** Meses completos de `inicio` até `fim` (datas AAAA-MM-DD); negativo vira 0. */
export function mesesCompletos(inicio: string, fim: string): number {
  const [ai, mi, di] = inicio.split('-').map(Number) as [number, number, number];
  const [af, mf, df] = fim.split('-').map(Number) as [number, number, number];
  const m = (af - ai) * 12 + (mf - mi) - (df < di ? 1 : 0);
  return Math.max(0, m);
}

export const PESOS_OBSOLESCENCIA = { idade: 40, custo: 30, falhas: 30 } as const;
export const TETO_CORRETIVAS_ANO = 6;
export const JANELA_OBSOLESCENCIA_MESES = 12;

export interface BaseObsolescencia {
  /** Nula: sem data de instalação, incorporação nem aquisição (a parcela fica sem base). */
  readonly idadeMeses: number | null;
  readonly vidaUtilMeses: number;
  /** Peças + mão de obra + terceiros das OS do equipamento na janela. */
  readonly custoCent: number;
  /** O valor do bem patrimonial ligado (nulo: sem bem). */
  readonly valorCent: number | null;
  /** OS corretivas do equipamento abertas na janela. */
  readonly corretivas: number;
}

const limitar = (x: number) => Math.min(1, Math.max(0, x));
function parcela(razao: number | null, peso: number) {
  const r = razao === null ? null : Math.round(limitar(razao) * 1000) / 1000;
  return { razao: r, peso, pontos: r === null ? 0 : Math.round(r * peso) };
}

export function faixaDoIndice(indice: number): FaixaObsolescencia {
  return indice >= 70 ? 'substituir' : indice >= 40 ? 'acompanhar' : 'manter';
}

export function indiceObsolescencia(b: BaseObsolescencia): IndiceObsolescencia {
  const idade = parcela(
    b.idadeMeses === null || b.vidaUtilMeses <= 0 ? null : b.idadeMeses / b.vidaUtilMeses,
    PESOS_OBSOLESCENCIA.idade,
  );
  const custo = parcela(
    b.valorCent === null || b.valorCent <= 0 ? null : b.custoCent / (b.valorCent / 2),
    PESOS_OBSOLESCENCIA.custo,
  );
  const falhas = parcela(b.corretivas / TETO_CORRETIVAS_ANO, PESOS_OBSOLESCENCIA.falhas);
  const indice = idade.pontos + custo.pontos + falhas.pontos;
  return {
    indice,
    faixa: faixaDoIndice(indice),
    janelaMeses: JANELA_OBSOLESCENCIA_MESES,
    idade: { ...idade, idadeMeses: b.idadeMeses, vidaUtilMeses: b.vidaUtilMeses },
    custo: { ...custo, custoCent: b.custoCent, valorCent: b.valorCent },
    falhas: { ...falhas, corretivas: b.corretivas, teto: TETO_CORRETIVAS_ANO },
  };
}

const ORDEM: Readonly<Record<TipoEventoCiclo, number>> = { incorporacao: 0, desativacao: 1, descarte: 2 };

/** Confere o evento novo contra os já registrados do equipamento. */
export function conferirEventoCiclo(
  existentes: readonly { readonly tipo: TipoEventoCiclo; readonly data: string }[],
  novo: { readonly tipo: TipoEventoCiclo; readonly data: string },
  hoje: string,
): RecusaCicloVida | null {
  if (existentes.some((e) => e.tipo === 'descarte')) return 'equipamento-descartado';
  if (existentes.some((e) => e.tipo === novo.tipo)) return 'evento-repetido';
  if (novo.data > hoje) return 'data-futura';
  if (novo.tipo === 'descarte' && !existentes.some((e) => e.tipo === 'desativacao')) return 'sem-desativacao';
  for (const e of existentes) {
    const antes = ORDEM[e.tipo] < ORDEM[novo.tipo];
    if (antes ? e.data > novo.data : e.data < novo.data) return 'fora-de-ordem';
  }
  return null;
}
