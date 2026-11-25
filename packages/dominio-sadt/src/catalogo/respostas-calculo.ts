// Respostas, textos padrão e cálculo dos analitos por fórmula (F3.5, análise 05-SADT linha 3). Regras puras, usadas
// pela API (antes de gravar) e pelas telas (na hora, enquanto se digita):
//   - o grupo de respostas fechadas do analito qualitativo (positivo e negativo, reagente e não reagente, cruzes), com
//     as respostas na ordem de exibição, no máximo uma sugerida e a crítica sempre anormal;
//   - o texto padrão do resultado (observação pronta, com atalho de digitação);
//   - a ligação do grupo ao analito do exame (só o analito de texto leva grupo; o de resposta padronizada exige);
//   - o cálculo de todos os analitos calculados do exame pela fórmula vigente, na ordem das dependências (um calculado
//     pode usar outro), sem eval (calcularFormula). O que não dá para calcular volta com o motivo, nunca com zero.
import { calcularFormula, type CalculoFormula } from './analito-pop.js';
import type { FalhaCatalogo } from './regras.js';

export const TIPOS_GRUPO_RESPOSTA = ['qualitativo', 'semiquantitativo', 'descritivo'] as const;
export const APLICACOES_TEXTO_PADRAO = ['resultado', 'cultura', 'laudo', 'analito'] as const;

export interface RespostaDoGrupo {
  readonly sequencia: number;
  readonly codigo: string;
  readonly descricao: string;
  readonly mnemonico: string | null;
  readonly anormal: boolean;
  readonly critico: boolean;
  readonly padrao: boolean;
  readonly ativo: boolean;
}

export interface GrupoRespostaCatalogo {
  readonly codigo: string;
  readonly descricao: string;
  readonly tipo: string;
  readonly ativo: boolean;
  readonly respostas: readonly RespostaDoGrupo[];
}

const chave = (s: string) => s.trim().toLowerCase();
const repetidos = <T>(xs: readonly T[]): T[] => [...new Set(xs.filter((x, i) => xs.indexOf(x) !== i))];

/** O grupo como fica depois da gravação (o do banco com o que mudou): as falhas por campo. */
export function validarGrupoResposta(g: GrupoRespostaCatalogo): FalhaCatalogo[] {
  const f: FalhaCatalogo[] = [];
  if (!g.codigo.trim()) f.push({ campo: 'codigo', mensagem: 'Informe o código do grupo.' });
  else if (g.codigo.trim().length > 30)
    f.push({ campo: 'codigo', mensagem: 'O código tem até 30 caracteres.' });
  if (g.descricao.trim().length < 2)
    f.push({ campo: 'descricao', mensagem: 'Informe a descrição do grupo.' });
  if (!(TIPOS_GRUPO_RESPOSTA as readonly string[]).includes(g.tipo))
    f.push({ campo: 'tipo', mensagem: 'Tipo de grupo desconhecido.' });
  const ativas = g.respostas.filter((r) => r.ativo);
  if (g.ativo && !ativas.length)
    f.push({ campo: 'respostas', mensagem: 'O grupo ativo precisa de ao menos uma resposta ativa.' });
  for (const r of g.respostas) {
    const rot = `A resposta ${r.codigo.trim() || r.sequencia}`;
    if (!r.codigo.trim() || r.codigo.trim().length > 30)
      f.push({ campo: 'respostas', mensagem: `${rot}: informe o código (até 30 caracteres).` });
    if (!r.descricao.trim() || r.descricao.trim().length > 300)
      f.push({ campo: 'respostas', mensagem: `${rot}: informe a descrição (até 300 caracteres).` });
    if (!Number.isInteger(r.sequencia) || r.sequencia < 1 || r.sequencia > 9999)
      f.push({ campo: 'respostas', mensagem: `${rot}: a ordem vai de 1 a 9999.` });
    if (r.mnemonico !== null && !/^\S{1,10}$/.test(r.mnemonico))
      f.push({ campo: 'respostas', mensagem: `${rot}: o atalho tem até 10 caracteres, sem espaço.` });
    if (r.critico && !r.anormal)
      f.push({ campo: 'respostas', mensagem: `${rot}: a resposta crítica é sempre anormal.` });
    if (r.padrao && !r.ativo)
      f.push({ campo: 'respostas', mensagem: `${rot}: a resposta sugerida precisa estar ativa.` });
  }
  for (const c of repetidos(g.respostas.map((r) => chave(r.codigo)).filter(Boolean)))
    f.push({ campo: 'respostas', mensagem: `Código de resposta repetido: ${c}.` });
  for (const s of repetidos(g.respostas.map((r) => r.sequencia)))
    f.push({ campo: 'respostas', mensagem: `Ordem repetida: ${s}.` });
  for (const m of repetidos(ativas.map((r) => (r.mnemonico ? chave(r.mnemonico) : '')).filter(Boolean)))
    f.push({ campo: 'respostas', mensagem: `Atalho repetido entre as respostas ativas: ${m}.` });
  if (g.respostas.filter((r) => r.padrao).length > 1)
    f.push({ campo: 'respostas', mensagem: 'Só uma resposta pode ser a sugerida.' });
  return f;
}

export interface TextoPadraoCatalogo {
  readonly codigo: string;
  readonly descricao: string;
  readonly texto: string;
  readonly mnemonico: string | null;
  readonly aplicacao: string;
}

export function validarTextoPadrao(t: TextoPadraoCatalogo): FalhaCatalogo[] {
  const f: FalhaCatalogo[] = [];
  if (!t.codigo.trim() || t.codigo.trim().length > 30)
    f.push({ campo: 'codigo', mensagem: 'Informe o código (até 30 caracteres).' });
  if (t.descricao.trim().length < 2 || t.descricao.trim().length > 150)
    f.push({ campo: 'descricao', mensagem: 'Informe o título do texto (2 a 150 caracteres).' });
  if (!t.texto.trim()) f.push({ campo: 'texto', mensagem: 'Informe o texto.' });
  if (t.mnemonico !== null && !/^\S{1,10}$/.test(t.mnemonico))
    f.push({ campo: 'mnemonico', mensagem: 'O atalho tem até 10 caracteres, sem espaço.' });
  if (!(APLICACOES_TEXTO_PADRAO as readonly string[]).includes(t.aplicacao))
    f.push({ campo: 'aplicacao', mensagem: 'Aplicação desconhecida.' });
  return f;
}

/** Tipos de resultado do analito que aceitam grupo de respostas fechadas. */
export const TIPOS_COM_GRUPO_RESPOSTA = ['texto', 'texto_padrao'] as const;

/**
 * A ligação do grupo de respostas ao analito do exame: só o analito de texto leva grupo; o calculado nunca; o de
 * resposta padronizada (texto_padrao) não fica ativo no exame sem grupo; o grupo ligado tem de estar ativo.
 */
export function conferirGrupoDoAnalito(a: {
  readonly tipoResultado: string;
  readonly calculado: boolean;
  readonly ativo: boolean;
  readonly grupoRespostaId: number | null;
  readonly grupoAtivo: boolean | null;
}): FalhaCatalogo[] {
  const f: FalhaCatalogo[] = [];
  const campo = 'grupoRespostaId';
  if (a.grupoRespostaId !== null) {
    if (a.calculado) f.push({ campo, mensagem: 'O analito calculado não leva grupo de respostas.' });
    else if (!(TIPOS_COM_GRUPO_RESPOSTA as readonly string[]).includes(a.tipoResultado))
      f.push({ campo, mensagem: 'Só o analito de texto leva grupo de respostas.' });
    if (a.grupoAtivo === null) f.push({ campo, mensagem: 'O grupo de respostas não existe.' });
    else if (!a.grupoAtivo && a.ativo) f.push({ campo, mensagem: 'O grupo de respostas está inativo.' });
  } else if (a.ativo && a.tipoResultado === 'texto_padrao')
    f.push({ campo, mensagem: 'O analito de resposta padronizada precisa do grupo de respostas.' });
  return f;
}

// ── Cálculo dos analitos do exame ────────────────────────────────────────────────────────────────────────────────

export const FONTES_VARIAVEL_CALCULO = ['analito', 'grandeza', 'dado_paciente', 'digitado'] as const;
export type FonteVariavelCalculo = (typeof FONTES_VARIAVEL_CALCULO)[number];

export interface VariavelDaFormula {
  /** O id da variável no cadastro (a chave do valor digitado). */
  readonly id: number;
  readonly identificador: string;
  readonly descricao: string;
  readonly fonte: FonteVariavelCalculo;
  readonly analito: number | null;
  readonly dadoPaciente: string | null;
}

export interface FormulaDoAnalito {
  /** O analito calculado. */
  readonly analito: number;
  readonly expressao: string;
  readonly casas: number | null;
  readonly variaveis: readonly VariavelDaFormula[];
}

/** A idade em anos completos a partir dos dias de vida na data do exame (sem data de nascimento, sem idade). */
export function idadeEmAnos(dias: number | null | undefined): number | null {
  return dias === null || dias === undefined || !Number.isFinite(dias) || dias < 0
    ? null
    : Math.floor(dias / 365.25);
}

/**
 * As variáveis que alguém precisa digitar no resultado: as de fonte "digitado" e "grandeza" e os dados do paciente
 * que o cadastro não dá sozinho (peso, altura, superfície corporal...). A idade vem da data de nascimento.
 */
export function variaveisADigitar(formulas: readonly FormulaDoAnalito[]): VariavelDaFormula[] {
  const vistas = new Set<number>();
  const r: VariavelDaFormula[] = [];
  for (const f of formulas)
    for (const v of f.variaveis) {
      if (v.fonte === 'analito' || (v.fonte === 'dado_paciente' && v.dadoPaciente === 'idade')) continue;
      if (vistas.has(v.id)) continue;
      vistas.add(v.id);
      r.push(v);
    }
  return r;
}

export interface EntradaCalculoAnalitos {
  readonly formulas: readonly FormulaDoAnalito[];
  /** O valor numérico digitado de cada analito do exame (o do calculado é ignorado: vale a fórmula). */
  readonly valores: ReadonlyMap<number, number | null>;
  /** O valor digitado de cada variável, pelo id da variável. */
  readonly digitadas: Readonly<Record<number, number | null | undefined>>;
  readonly paciente: { readonly idade: number | null };
}

/**
 * Calcula cada analito com fórmula. A variável de analito usa o valor digitado, ou o calculado se o analito também tem
 * fórmula (na ordem das dependências; ciclo não calcula). A idade vem do paciente, a não ser que tenha sido digitada.
 */
export function calcularAnalitos(e: EntradaCalculoAnalitos): Map<number, CalculoFormula> {
  const porAnalito = new Map(e.formulas.map((f) => [f.analito, f]));
  const pronto = new Map<number, CalculoFormula>();
  const abertos = new Set<number>();
  const calcular = (analito: number): CalculoFormula => {
    const ja = pronto.get(analito);
    if (ja) return ja;
    const f = porAnalito.get(analito) as FormulaDoAnalito;
    if (abertos.has(analito)) return { ok: false, motivo: 'As fórmulas do exame dependem uma da outra.' };
    abertos.add(analito);
    const valores: Record<string, number | null> = {};
    let motivo: string | null = null;
    for (const v of f.variaveis) {
      let valor: number | null = null;
      if (v.fonte === 'analito' && v.analito !== null) {
        if (porAnalito.has(v.analito)) {
          const c = calcular(v.analito);
          if (c.ok) valor = c.valor;
          else motivo ??= `${v.identificador}: ${c.motivo}`;
        } else valor = e.valores.get(v.analito) ?? null;
      } else {
        valor = e.digitadas[v.id] ?? null;
        if (valor === null && v.fonte === 'dado_paciente' && v.dadoPaciente === 'idade')
          valor = e.paciente.idade;
      }
      valores[v.identificador] = valor;
    }
    abertos.delete(analito);
    const r: CalculoFormula = motivo ? { ok: false, motivo } : calcularFormula(f.expressao, valores, f.casas);
    pronto.set(analito, r);
    return r;
  };
  for (const f of e.formulas) calcular(f.analito);
  return pronto;
}
