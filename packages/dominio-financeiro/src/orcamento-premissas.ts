// Premissas e cenários do orçamento empresarial (C1-125): as regras puras da premissa da versão (inflação, reajustes,
// ocupação, volume, câmbio, tributo) e do cenário (pessimista, conservador, base, otimista, personalizado), e a
// projeção do resultado da versão no cenário escolhido.
// Desenho próprio: a premissa nasce validada na hora (o tipo diz qual valor é obrigatório), a premissa fora da faixa
// usual pede justificativa (o aprovador entende por que o número saiu do comum), e o cenário é coerente com a
// tendência (otimista não reduz, pessimista não aumenta). A projeção aplica o ajuste do cenário à receita (o volume
// esperado) e mantém despesa e consumo orçados, mostrando as parcelas da conta.
// Percentuais em centésimos de ponto percentual (450 = 4,50%); valores em centavos.

export const TIPOS_PREMISSA_ORCAMENTO = [
  'inflacao',
  'reajuste_salarial',
  'reajuste_contrato',
  'reajuste_tabela',
  'ocupacao',
  'volume',
  'cambio',
  'tributo',
  'outro',
] as const;
export type TipoPremissaOrcamento = (typeof TIPOS_PREMISSA_ORCAMENTO)[number];

export const TENDENCIAS_CENARIO_ORCAMENTO = [
  'pessimista',
  'conservador',
  'base',
  'otimista',
  'personalizado',
] as const;
export type TendenciaCenarioOrcamento = (typeof TENDENCIAS_CENARIO_ORCAMENTO)[number];

/** Tipos cuja premissa é um percentual (obrigatório). */
const PERCENTUAIS: ReadonlySet<TipoPremissaOrcamento> = new Set([
  'inflacao',
  'reajuste_salarial',
  'reajuste_contrato',
  'reajuste_tabela',
  'ocupacao',
  'cambio',
  'tributo',
]);
/** Acima deste módulo (20,00%) a premissa pede justificativa. */
export const LIMITE_PREMISSA_SEM_JUSTIFICATIVA = 2000;
/** O que cabe em DECIMAL(7,4) com folga: ±999,99%. */
const TETO_PERCENTUAL = 99_999;
/** O ajuste de cenário vai de -100% a +100%. */
export const TETO_AJUSTE_CENARIO = 10_000;

export interface PremissaOrcamentoEntrada {
  readonly tipo: TipoPremissaOrcamento;
  readonly descricao: string;
  readonly percentualCentesimos: number | null;
  readonly valorNumerico: number | null;
  readonly valorTexto: string | null;
  readonly unidade: string | null;
  readonly justificativa: string | null;
}

export interface CenarioOrcamentoEntrada {
  readonly codigo: string;
  readonly descricao: string;
  readonly tendencia: TendenciaCenarioOrcamento;
  readonly ajusteCentesimos: number;
}

export interface FalhaCampoOrcamento {
  readonly campo: string;
  readonly mensagem: string;
}

const vazio = (v: string | null | undefined): boolean => v === null || v === undefined || v.trim() === '';

/** As falhas da premissa (lista vazia: pode gravar). */
export function validarPremissaOrcamento(p: PremissaOrcamentoEntrada): FalhaCampoOrcamento[] {
  const f: FalhaCampoOrcamento[] = [];
  const d = p.descricao.trim();
  if (d.length < 3 || d.length > 150)
    f.push({ campo: 'descricao', mensagem: 'Descreva a premissa (de 3 a 150 caracteres).' });
  if (!TIPOS_PREMISSA_ORCAMENTO.includes(p.tipo)) {
    f.push({ campo: 'tipo', mensagem: 'Escolha o tipo da premissa.' });
    return f;
  }
  const pc = p.percentualCentesimos;
  if (pc !== null && (!Number.isInteger(pc) || Math.abs(pc) > TETO_PERCENTUAL))
    f.push({ campo: 'percentual', mensagem: 'O percentual vai de -999,99% a 999,99%.' });
  if (PERCENTUAIS.has(p.tipo) && pc === null)
    f.push({ campo: 'percentual', mensagem: 'Esta premissa é um percentual: informe-o.' });
  if (pc !== null) {
    if (p.tipo === 'reajuste_salarial' && pc < 0)
      f.push({ campo: 'percentual', mensagem: 'O reajuste salarial não pode ser negativo.' });
    if ((p.tipo === 'ocupacao' || p.tipo === 'tributo') && (pc < 0 || pc > 10_000))
      f.push({ campo: 'percentual', mensagem: 'A ocupação e o tributo vão de 0% a 100%.' });
  }
  if (p.valorNumerico !== null && (!Number.isFinite(p.valorNumerico) || Math.abs(p.valorNumerico) >= 1e11))
    f.push({ campo: 'valorNumerico', mensagem: 'O valor está fora da faixa aceita.' });
  if (p.tipo === 'volume') {
    if (p.valorNumerico === null || p.valorNumerico < 0)
      f.push({ campo: 'valorNumerico', mensagem: 'Informe o volume esperado (zero ou mais).' });
    if (vazio(p.unidade))
      f.push({ campo: 'unidade', mensagem: 'Informe a unidade do volume (diárias, exames, consultas).' });
  }
  if (p.tipo === 'outro' && pc === null && p.valorNumerico === null && vazio(p.valorTexto))
    f.push({ campo: 'valorTexto', mensagem: 'Informe o valor da premissa (percentual, número ou texto).' });
  if (!vazio(p.unidade) && (p.unidade ?? '').trim().length > 20)
    f.push({ campo: 'unidade', mensagem: 'A unidade tem até 20 caracteres.' });
  if (!vazio(p.valorTexto) && (p.valorTexto ?? '').trim().length > 100)
    f.push({ campo: 'valorTexto', mensagem: 'O texto do valor tem até 100 caracteres.' });
  const j = (p.justificativa ?? '').trim();
  if (j.length > 2000)
    f.push({ campo: 'justificativa', mensagem: 'A justificativa tem até 2.000 caracteres.' });
  if (pc !== null && Math.abs(pc) > LIMITE_PREMISSA_SEM_JUSTIFICATIVA && j.length < 10)
    f.push({
      campo: 'justificativa',
      mensagem: 'Premissa acima de 20%: justifique (ao menos 10 caracteres) para quem vai aprovar.',
    });
  return f;
}

/** As falhas do cenário (lista vazia: pode gravar). */
export function validarCenarioOrcamento(c: CenarioOrcamentoEntrada): FalhaCampoOrcamento[] {
  const f: FalhaCampoOrcamento[] = [];
  if (!/^[A-Z0-9_-]{1,30}$/.test(c.codigo.trim().toUpperCase()))
    f.push({ campo: 'codigo', mensagem: 'O código tem até 30 letras, números, hífen ou sublinhado.' });
  const d = c.descricao.trim();
  if (d.length < 3 || d.length > 150)
    f.push({ campo: 'descricao', mensagem: 'Descreva o cenário (de 3 a 150 caracteres).' });
  if (!TENDENCIAS_CENARIO_ORCAMENTO.includes(c.tendencia)) {
    f.push({ campo: 'tendencia', mensagem: 'Escolha a tendência do cenário.' });
    return f;
  }
  const a = c.ajusteCentesimos;
  if (!Number.isInteger(a) || Math.abs(a) > TETO_AJUSTE_CENARIO) {
    f.push({ campo: 'ajuste', mensagem: 'O ajuste do cenário vai de -100% a +100%.' });
    return f;
  }
  const incoerente =
    (c.tendencia === 'pessimista' && a >= 0) ||
    (c.tendencia === 'conservador' && a > 0) ||
    (c.tendencia === 'base' && a !== 0) ||
    (c.tendencia === 'otimista' && a <= 0);
  if (incoerente)
    f.push({
      campo: 'ajuste',
      mensagem:
        'O ajuste não combina com a tendência: pessimista reduz, conservador não aumenta, base é zero, otimista aumenta.',
    });
  return f;
}

/** Só a versão em elaboração recebe premissas e cenário; a aprovada ou descartada fica como foi decidida. */
export const premissaEditavel = (situacao: string): boolean => situacao === 'rascunho';

export interface TotaisOrcamento {
  readonly despesa: number;
  readonly receita: number;
  readonly consumo: number;
}

export interface ProjecaoCenarioOrcamento {
  readonly ajusteCentesimos: number;
  readonly receitaBase: number;
  readonly receitaProjetada: number;
  readonly despesa: number;
  readonly consumo: number;
  readonly resultadoBase: number;
  readonly resultadoProjetado: number;
  /** A conta impressa (parcelas), para a tela mostrar de onde veio o número. */
  readonly conta: string;
}

/** Arredonda a razão inteira a/b pela metade para longe do zero (centavos exatos, sem ponto flutuante). */
function dividirArredondando(a: bigint, b: bigint): bigint {
  const q = a / b;
  const r = a % b;
  const dobro = (r < 0n ? -r : r) * 2n;
  if (dobro >= b) return a < 0n ? q - 1n : q + 1n;
  return q;
}

/** O resultado da versão no cenário: a receita com o ajuste; despesa e consumo como orçados. */
export function projetarCenarioOrcamento(
  t: TotaisOrcamento,
  ajusteCentesimos: number,
): ProjecaoCenarioOrcamento {
  const receitaProjetada = Number(
    dividirArredondando(BigInt(t.receita) * BigInt(10_000 + ajusteCentesimos), 10_000n),
  );
  const resultadoBase = t.receita - t.despesa - t.consumo;
  const resultadoProjetado = receitaProjetada - t.despesa - t.consumo;
  const pct = `${ajusteCentesimos >= 0 ? '+' : '-'}${(Math.abs(ajusteCentesimos) / 100).toFixed(2)}%`;
  return {
    ajusteCentesimos,
    receitaBase: t.receita,
    receitaProjetada,
    despesa: t.despesa,
    consumo: t.consumo,
    resultadoBase,
    resultadoProjetado,
    conta: `receita ${t.receita} ${pct} = ${receitaProjetada}; ${receitaProjetada} - despesa ${t.despesa} - consumo ${t.consumo} = ${resultadoProjetado}`,
  };
}
