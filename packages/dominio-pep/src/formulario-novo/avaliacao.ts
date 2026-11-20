// Avaliação do formulário novo (M45, etapa 1; regras 3, 14 e 15): das respostas aos valores que as regras leem, os
// calculados em ordem topológica, a habilitação de cada pergunta e a execução dos casos de teste. O total de escala é
// sempre calculado (regra 3). Valor nunca visto (opção que não existe na pergunta) é recusado, nunca adivinhado
// (regra 15). Puro: o mesmo resultado na tela, no servidor e na execução dos casos antes de publicar.
import type {
  CasoFormularioNovo,
  DefinicaoFormularioNovo,
  DiferencaCasoFormularioNovo,
  PerguntaFormularioNovo,
  ResultadoCasoFormularioNovo,
  ValorCasoFormularioNovo,
} from '@sgh/contratos';
import { avaliarRegra, ErroRegra, type RegraLogica } from '../regras/json-logic.js';
import { verdadeiro, type Valor } from '../regras/valores.js';
import { ordemDeCalculo, percorrerPerguntas } from './definicao.js';

export class ErroRespostaFormularioNovo extends Error {
  override readonly name = 'ErroRespostaFormularioNovo';
  readonly linkId: string;
  readonly motivo: 'opcao-inexistente' | 'tipo-incompativel' | 'fora-da-faixa' | 'pergunta-inexistente';
  constructor(
    linkId: string,
    motivo: 'opcao-inexistente' | 'tipo-incompativel' | 'fora-da-faixa' | 'pergunta-inexistente',
    mensagem: string,
  ) {
    super(mensagem);
    this.linkId = linkId;
    this.motivo = motivo;
  }
}

const opcaoPorCodigo = (p: PerguntaFormularioNovo, codigo: string) =>
  p.opcoes.find((o) => o.codigo === codigo);

/**
 * Valor que as regras leem para a resposta: número como número; escolha pelos pontos da opção (ou pela posição
 * na lista quando a opção não pontua: é o índice gravado no formulário de origem); múltipla pela soma dos pontos;
 * texto, data (AAAA-MM-DD) e hora (HH:MM) como texto.
 */
export function valorParaRegra(p: PerguntaFormularioNovo, v: ValorCasoFormularioNovo): Valor {
  if (v === null) return null;
  const erro = (m: 'opcao-inexistente' | 'tipo-incompativel' | 'fora-da-faixa', msg: string) =>
    new ErroRespostaFormularioNovo(p.linkId, m, msg);
  switch (p.tipo) {
    case 'secao':
      throw erro('tipo-incompativel', 'Seção não é respondida.');
    case 'decimal':
    case 'inteiro': {
      if (typeof v !== 'number') throw erro('tipo-incompativel', 'Resposta numérica esperada.');
      if (p.tipo === 'inteiro' && !Number.isInteger(v)) throw erro('tipo-incompativel', 'Valor inteiro.');
      if ((p.minimo !== null && v < p.minimo) || (p.maximo !== null && v > p.maximo))
        throw erro('fora-da-faixa', 'Valor fora da faixa da pergunta.');
      return v;
    }
    case 'escolha':
    case 'escolha-com-texto': {
      if (typeof v !== 'string') throw erro('tipo-incompativel', 'Código da opção esperado.');
      const o = opcaoPorCodigo(p, v);
      if (!o) throw erro('opcao-inexistente', `Opção "${v}" não existe nesta pergunta.`);
      return o.pontos ?? p.opcoes.indexOf(o);
    }
    case 'multipla': {
      if (!Array.isArray(v)) throw erro('tipo-incompativel', 'Lista de opções esperada.');
      let soma = 0;
      for (const c of v) {
        const o = opcaoPorCodigo(p, c);
        if (!o) throw erro('opcao-inexistente', `Opção "${c}" não existe nesta pergunta.`);
        soma += o.pontos ?? 0;
      }
      return soma;
    }
    case 'data':
      if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v))
        throw erro('tipo-incompativel', 'Data AAAA-MM-DD.');
      return v;
    case 'hora':
      if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v))
        throw erro('tipo-incompativel', 'Hora HH:MM.');
      return v;
    case 'texto':
    case 'texto-formatado':
      if (typeof v !== 'string') throw erro('tipo-incompativel', 'Texto esperado.');
      return v;
  }
}

export interface EstadoFormularioNovoAvaliado {
  /** Valores lidos pelas regras (respostas convertidas + calculados), por linkId. */
  readonly valores: Readonly<Record<string, Valor>>;
  readonly habilitadas: ReadonlySet<string>;
  /** Obrigatórias habilitadas e sem resposta. */
  readonly pendentes: readonly string[];
}

export function avaliarFormularioNovo(
  def: DefinicaoFormularioNovo,
  respostas: Readonly<Record<string, ValorCasoFormularioNovo>>,
  hoje: string,
): EstadoFormularioNovoAvaliado {
  const todas = percorrerPerguntas(def);
  const porId = new Map(todas.map((x) => [x.pergunta.linkId, x.pergunta]));
  for (const id of Object.keys(respostas))
    if (!porId.has(id))
      throw new ErroRespostaFormularioNovo(id, 'pergunta-inexistente', `Pergunta "${id}" não existe.`);
  const valores: Record<string, Valor> = {};
  for (const [id, v] of Object.entries(respostas)) {
    const p = porId.get(id)!;
    if (p.calcular !== null) continue; // o calculado nunca vem digitado (regra 3)
    valores[id] = valorParaRegra(p, v);
  }
  const ordem = ordemDeCalculo(def);
  if (ordem === null) throw new ErroRegra('cálculos em ciclo');
  for (const id of ordem) {
    const p = porId.get(id)!;
    valores[id] = avaliarRegra(p.calcular as RegraLogica, { valores, hoje });
  }
  const habilitadas = new Set<string>();
  const paiHabilitado = new Map<string, boolean>();
  for (const { pergunta: p, pai } of todas) {
    const doPai = pai === null ? true : (paiHabilitado.get(pai) ?? true);
    const propria =
      p.habilitar === null ? true : verdadeiro(avaliarRegra(p.habilitar as RegraLogica, { valores, hoje }));
    const h = doPai && propria;
    paiHabilitado.set(p.linkId, h);
    if (h) habilitadas.add(p.linkId);
  }
  const pendentes = todas
    .map((x) => x.pergunta)
    .filter((p) => p.obrigatorio && habilitadas.has(p.linkId) && p.calcular === null)
    .filter((p) => {
      const v = respostas[p.linkId];
      return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
    })
    .map((p) => p.linkId);
  return { valores, habilitadas, pendentes };
}

const igual = (a: ValorCasoFormularioNovo, b: Valor): boolean => {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9;
  return a === b;
};

/** Executa um caso de teste: respostas → valores esperados (e habilitação esperada, quando o caso a declara). */
export function executarCaso(
  def: DefinicaoFormularioNovo,
  caso: CasoFormularioNovo,
  hoje = '2026-01-01',
): ResultadoCasoFormularioNovo {
  const diferencas: DiferencaCasoFormularioNovo[] = [];
  let estado: EstadoFormularioNovoAvaliado;
  try {
    estado = avaliarFormularioNovo(def, caso.respostas, hoje);
  } catch (e) {
    const linkId = e instanceof ErroRespostaFormularioNovo ? e.linkId : '';
    const motivo = e instanceof ErroRespostaFormularioNovo ? 'resposta-invalida' : 'erro-regra';
    return { caso: caso.nome, passou: false, diferencas: [{ linkId, esperado: null, obtido: null, motivo }] };
  }
  for (const [id, esperado] of Object.entries(caso.esperado)) {
    const obtido = estado.valores[id] ?? null;
    if (!igual(esperado, obtido)) diferencas.push({ linkId: id, esperado, obtido, motivo: 'valor' });
  }
  if (caso.habilitadasEsperadas !== null) {
    const esperadas = new Set(caso.habilitadasEsperadas);
    for (const { pergunta: p } of percorrerPerguntas(def)) {
      const h = estado.habilitadas.has(p.linkId);
      if (h !== esperadas.has(p.linkId))
        diferencas.push({ linkId: p.linkId, esperado: !h, obtido: h, motivo: 'habilitacao' });
    }
  }
  return { caso: caso.nome, passou: diferencas.length === 0, diferencas };
}

export function executarCasos(
  def: DefinicaoFormularioNovo,
  casos: readonly CasoFormularioNovo[],
  hoje?: string,
): ResultadoCasoFormularioNovo[] {
  return casos.map((c) => executarCaso(def, c, hoje));
}

/** Todos os casos verdes e ao menos um caso (regra 14: não se publica sem casos de teste passando). */
export function casosVerdes(resultados: readonly ResultadoCasoFormularioNovo[]): boolean {
  return resultados.length > 0 && resultados.every((r) => r.passou);
}
