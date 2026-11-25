// Catálogo do diagnóstico, segunda parte (F3.5, linhas 1 e 3 da análise 05-SADT): o cadastro do próprio analito (o
// campo de resultado), o procedimento operacional do exame (documento da qualidade com versão, revisão e aprovação) e o
// cálculo da fórmula na digitação. Regras puras: a porta só grava o que passa aqui.
// Desenho próprio:
//   - o analito sai por inativação, nunca apagado (o resultado antigo continua apontando para ele); o limite aceito
//     (implausível) é conferido na hora: mínimo não passa do máximo, casas decimais só no numérico e no calculado;
//   - o procedimento operacional anda rascunho → em revisão → aprovado → obsoleto; o aprovado não se altera (muda por
//     nova versão do documento, em rascunho), e ao aprovar a nova versão a anterior aprovada vira obsoleta com a
//     vigência encerrada na véspera; a aprovação exige quem aprova, a data e o início da vigência;
//   - a fórmula é calculada por um leitor próprio (sem eval): números, + - * / ^, parênteses, as funções conhecidas e
//     as variáveis com valor; variável sem valor ou conta impossível (divisão por zero, raiz de negativo) não calcula.

import { FUNCOES_FORMULA, type FalhaCatalogo, vespera } from './regras.js';

export const TIPOS_RESULTADO_ANALITO = [
  'numerico',
  'texto',
  'texto_padrao',
  'calculado',
  'cultura',
  'antibiograma',
  'titulo',
  'imagem',
] as const;
export type TipoResultadoAnalito = (typeof TIPOS_RESULTADO_ANALITO)[number];

export interface AnalitoCatalogo {
  readonly codigo: string;
  readonly nome: string;
  readonly sigla: string | null;
  readonly tipoResultado: string;
  readonly casasDecimais: number | null;
  readonly unidadeResultadoId: number | null;
  readonly limiteMinimoAceito: number | null;
  readonly limiteMaximoAceito: number | null;
  readonly pulaNaDigitacao: boolean;
}

/** O analito que pode ser gravado: código, nome, tipo, casas decimais, unidade e limites aceitos. */
export function validarAnalito(a: AnalitoCatalogo): FalhaCatalogo[] {
  const f: FalhaCatalogo[] = [];
  if (!/^[A-Za-z0-9._-]{1,30}$/.test(a.codigo.trim()))
    f.push({ campo: 'codigo', mensagem: 'Código de 1 a 30 letras, números, ponto, hífen ou sublinhado.' });
  if (a.nome.trim().length < 2 || a.nome.trim().length > 150)
    f.push({ campo: 'nome', mensagem: 'Nome de 2 a 150 caracteres.' });
  if (a.sigla !== null && !/^[A-Za-z0-9.%#/-]{1,20}$/.test(a.sigla.trim()))
    f.push({ campo: 'sigla', mensagem: 'Sigla de 1 a 20 caracteres, sem espaço.' });
  if (!(TIPOS_RESULTADO_ANALITO as readonly string[]).includes(a.tipoResultado))
    f.push({ campo: 'tipoResultado', mensagem: 'Tipo de resultado desconhecido.' });
  const numerico = a.tipoResultado === 'numerico' || a.tipoResultado === 'calculado';
  if (a.casasDecimais !== null && (a.casasDecimais < 0 || a.casasDecimais > 6))
    f.push({ campo: 'casasDecimais', mensagem: 'Casas decimais de 0 a 6.' });
  if (!numerico && a.casasDecimais !== null)
    f.push({ campo: 'casasDecimais', mensagem: 'Casas decimais só no resultado numérico ou calculado.' });
  if (!numerico && (a.limiteMinimoAceito !== null || a.limiteMaximoAceito !== null))
    f.push({ campo: 'limiteMinimoAceito', mensagem: 'Limite aceito só no resultado numérico ou calculado.' });
  if (
    a.limiteMinimoAceito !== null &&
    a.limiteMaximoAceito !== null &&
    a.limiteMinimoAceito > a.limiteMaximoAceito
  )
    f.push({ campo: 'limiteMaximoAceito', mensagem: 'O limite máximo aceito é menor que o mínimo.' });
  if (a.tipoResultado === 'calculado' && !a.pulaNaDigitacao)
    f.push({ campo: 'pulaNaDigitacao', mensagem: 'O analito calculado não para na digitação.' });
  return f;
}

// ── Procedimento operacional do exame ────────────────────────────────────────────────────────────────────────────

export const SITUACOES_PROCEDIMENTO = ['rascunho', 'em_revisao', 'aprovado', 'obsoleto'] as const;
export type SituacaoProcedimento = (typeof SITUACOES_PROCEDIMENTO)[number];

const PASSOS: Readonly<Record<SituacaoProcedimento, readonly SituacaoProcedimento[]>> = {
  rascunho: ['rascunho', 'em_revisao'],
  em_revisao: ['em_revisao', 'rascunho', 'aprovado'],
  aprovado: ['aprovado', 'obsoleto'],
  obsoleto: ['obsoleto'],
};

export interface ProcedimentoOperacional {
  readonly id: number | null;
  readonly codigoDocumento: string;
  readonly titulo: string;
  readonly versaoDocumento: number;
  readonly situacao: SituacaoProcedimento;
  readonly aprovadoPorProfissionalId: number | null;
  readonly aprovadoEm: string | null;
  readonly vigenciaInicio: string | null;
  readonly vigenciaFim: string | null;
  readonly proximaRevisaoEm: string | null;
}

/** As versões do mesmo documento já gravadas (para a numeração e para tornar obsoleta a aprovada anterior). */
export interface VersaoProcedimento {
  readonly id: number;
  readonly versaoDocumento: number;
  readonly situacao: SituacaoProcedimento;
  readonly vigenciaInicio: string | null;
  readonly vigenciaFim: string | null;
}

export interface PlanoProcedimento {
  /** As versões anteriores aprovadas que viram obsoletas, com a vigência encerrada na véspera da nova. */
  readonly obsoletar: readonly { readonly id: number; readonly vigenciaFim: string }[];
}

/**
 * Confere o procedimento como fica (o atual com o que mudou) e planeja o efeito nas outras versões do documento.
 * `atual` é nulo na inclusão; `conteudoMudou` diz se a gravação mexe no texto do documento (o aprovado não muda).
 */
export function planejarProcedimentoOperacional(
  fica: ProcedimentoOperacional,
  atual: ProcedimentoOperacional | null,
  outras: readonly VersaoProcedimento[],
  conteudoMudou: boolean,
  hoje: string,
): { falhas: FalhaCatalogo[]; plano: PlanoProcedimento } {
  const f: FalhaCatalogo[] = [];
  if (!/^[A-Za-z0-9._/-]{1,60}$/.test(fica.codigoDocumento.trim()))
    f.push({ campo: 'codigoDocumento', mensagem: 'Código do documento de 1 a 60 caracteres, sem espaço.' });
  if (fica.titulo.trim().length < 3 || fica.titulo.trim().length > 200)
    f.push({ campo: 'titulo', mensagem: 'Título de 3 a 200 caracteres.' });
  if (!atual && fica.situacao !== 'rascunho')
    f.push({ campo: 'situacao', mensagem: 'O documento nasce em rascunho.' });
  if (atual && !PASSOS[atual.situacao].includes(fica.situacao))
    f.push({
      campo: 'situacao',
      mensagem: `De ${atual.situacao.replace('_', ' ')} não se passa a ${fica.situacao.replace('_', ' ')}.`,
    });
  if (atual && (atual.situacao === 'aprovado' || atual.situacao === 'obsoleto') && conteudoMudou)
    f.push({
      campo: 'situacao',
      mensagem: 'O documento aprovado não se altera: crie uma nova versão.',
    });
  if (!atual) {
    const maior = outras.reduce((m, o) => Math.max(m, o.versaoDocumento), 0);
    if (fica.versaoDocumento !== maior + 1)
      f.push({ campo: 'versaoDocumento', mensagem: `A próxima versão do documento é a ${maior + 1}.` });
    if (outras.some((o) => o.situacao === 'rascunho' || o.situacao === 'em_revisao'))
      f.push({
        campo: 'versaoDocumento',
        mensagem: 'Já há uma versão deste documento em rascunho ou em revisão.',
      });
  }
  const aprovando = fica.situacao === 'aprovado' && atual?.situacao !== 'aprovado';
  if (fica.situacao === 'aprovado' || fica.situacao === 'obsoleto') {
    if (fica.aprovadoPorProfissionalId === null)
      f.push({
        campo: 'aprovadoPorProfissionalId',
        mensagem: 'A aprovação exige o profissional que aprova.',
      });
    if (!fica.aprovadoEm) f.push({ campo: 'aprovadoEm', mensagem: 'A aprovação exige a data.' });
    if (!fica.vigenciaInicio)
      f.push({ campo: 'vigenciaInicio', mensagem: 'A aprovação exige o início da vigência.' });
  }
  if (aprovando && fica.vigenciaInicio && fica.vigenciaInicio < hoje)
    f.push({ campo: 'vigenciaInicio', mensagem: 'A vigência do documento aprovado não começa no passado.' });
  if (fica.vigenciaInicio && fica.vigenciaFim && fica.vigenciaFim < fica.vigenciaInicio)
    f.push({ campo: 'vigenciaFim', mensagem: 'O fim da vigência é anterior ao início.' });
  if (fica.vigenciaInicio && fica.proximaRevisaoEm && fica.proximaRevisaoEm <= fica.vigenciaInicio)
    f.push({ campo: 'proximaRevisaoEm', mensagem: 'A próxima revisão é posterior ao início da vigência.' });
  const obsoletar =
    aprovando && fica.vigenciaInicio && !f.length
      ? outras
          .filter((o) => o.situacao === 'aprovado' && o.versaoDocumento < fica.versaoDocumento)
          .map((o) => ({ id: o.id, vigenciaFim: vespera(fica.vigenciaInicio as string) }))
      : [];
  return { falhas: f, plano: { obsoletar } };
}

// ── Cálculo da fórmula ───────────────────────────────────────────────────────────────────────────────────────────

/** O resultado do cálculo: o valor, ou o motivo de não calcular (para a digitação mostrar). */
export type CalculoFormula =
  { readonly ok: true; readonly valor: number } | { readonly ok: false; readonly motivo: string };

/**
 * Calcula a expressão com os valores das variáveis (leitor próprio, sem eval). `^` é potência (associativa à direita);
 * a vírgula separa os argumentos das funções; `casas` arredonda o resultado.
 */
export function calcularFormula(
  expressao: string,
  valores: Readonly<Record<string, number | null | undefined>>,
  casas: number | null = null,
): CalculoFormula {
  const fichas = expressao.match(/\d+(?:\.\d+)?|[A-Za-z_][A-Za-z0-9_]*|[+\-*/^(),]|\S/g) ?? [];
  let i = 0;
  class Falha extends Error {}
  const ver = () => fichas[i];
  const tomar = (esperado?: string) => {
    const t = fichas[i++];
    if (t === undefined || (esperado !== undefined && t !== esperado))
      throw new Falha(esperado ? `Esperado "${esperado}".` : 'Expressão incompleta.');
    return t;
  };
  const conferir = (v: number, oque: string) => {
    if (!Number.isFinite(v)) throw new Falha(`Conta impossível em ${oque}.`);
    return v;
  };
  const funcao = (nome: string, args: number[]): number => {
    const n = (k: number) => {
      if (args.length !== k) throw new Falha(`${nome} recebe ${k} argumento(s).`);
    };
    switch (nome) {
      case 'raiz':
        n(1);
        if ((args[0] as number) < 0) throw new Falha('Raiz de número negativo.');
        return Math.sqrt(args[0] as number);
      case 'log':
        n(1);
        if ((args[0] as number) <= 0) throw new Falha('Logaritmo de número não positivo.');
        return Math.log10(args[0] as number);
      case 'ln':
        n(1);
        if ((args[0] as number) <= 0) throw new Falha('Logaritmo de número não positivo.');
        return Math.log(args[0] as number);
      case 'abs':
        n(1);
        return Math.abs(args[0] as number);
      case 'min':
        if (!args.length) throw new Falha('min sem argumento.');
        return Math.min(...args);
      case 'max':
        if (!args.length) throw new Falha('max sem argumento.');
        return Math.max(...args);
      case 'arred': {
        if (args.length !== 1 && args.length !== 2) throw new Falha('arred recebe 1 ou 2 argumentos.');
        const k = 10 ** (args[1] ?? 0);
        return Math.round((args[0] as number) * k) / k;
      }
      case 'pot':
        n(2);
        return conferir((args[0] as number) ** (args[1] as number), 'pot');
      default:
        throw new Falha(`Função desconhecida: ${nome}.`);
    }
  };
  const primario = (): number => {
    const t = tomar();
    if (t === '(') {
      const v = soma();
      tomar(')');
      return v;
    }
    if (t === '-') return -potencia();
    if (t === '+') return potencia();
    if (/^\d/.test(t)) return Number(t);
    if (/^[A-Za-z_]/.test(t)) {
      if ((FUNCOES_FORMULA as readonly string[]).includes(t.toLowerCase()) && ver() === '(') {
        tomar('(');
        const args: number[] = [];
        if (ver() !== ')') {
          args.push(soma());
          while (ver() === ',') {
            tomar(',');
            args.push(soma());
          }
        }
        tomar(')');
        return conferir(funcao(t.toLowerCase(), args), t);
      }
      const v = valores[t];
      if (v === null || v === undefined || !Number.isFinite(v)) throw new Falha(`Falta o valor de ${t}.`);
      return v;
    }
    throw new Falha(`Símbolo inesperado: ${t}.`);
  };
  const potencia = (): number => {
    const base = primario();
    if (ver() === '^') {
      tomar('^');
      return conferir(base ** potencia(), '^');
    }
    return base;
  };
  const produto = (): number => {
    let v = potencia();
    while (ver() === '*' || ver() === '/') {
      const op = tomar();
      const d = potencia();
      if (op === '/' && d === 0) throw new Falha('Divisão por zero.');
      v = op === '*' ? v * d : v / d;
    }
    return v;
  };
  const soma = (): number => {
    let v = produto();
    while (ver() === '+' || ver() === '-') v = tomar() === '+' ? v + produto() : v - produto();
    return v;
  };
  try {
    if (!fichas.length) return { ok: false, motivo: 'Expressão vazia.' };
    const v = soma();
    if (i < fichas.length) return { ok: false, motivo: `Símbolo inesperado: ${fichas[i]}.` };
    if (!Number.isFinite(v)) return { ok: false, motivo: 'Conta impossível.' };
    if (casas === null) return { ok: true, valor: v };
    const k = 10 ** casas;
    return { ok: true, valor: Math.round(v * k) / k };
  } catch (e) {
    if (e instanceof Falha) return { ok: false, motivo: e.message };
    throw e;
  }
}
