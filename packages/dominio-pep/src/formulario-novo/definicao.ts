// Definição do formulário novo (M45, etapa 1; cap-11 §11.1): percorrer a árvore, numerar a ordem no formato do
// formulário de origem (2 dígitos por nível, até 6 níveis: medido na cópia, 2.832 vínculos com 2 a 12 dígitos) e
// conferir a definição antes de salvar, enviar à revisão e publicar. Puro: a mesma conferência na tela e no servidor.
import {
  type DefinicaoFormularioNovo,
  LIMITES_FORMULARIO_NOVO,
  type PerguntaFormularioNovo,
  TIPOS_COM_OPCOES,
} from '@sgh/contratos';
import { OPERACOES_REGRA, type RegraLogica, variaveisDaRegra } from '../regras/json-logic.js';

export interface PerguntaComCaminho {
  readonly pergunta: PerguntaFormularioNovo;
  /** Ordem no formato do formulário de origem: "01", "0102", "010203"… */
  readonly ordem: string;
  readonly nivel: number;
  readonly pai: string | null;
}

/** Pré-ordem (pai antes dos filhos), na ordem da tela. */
export function percorrerPerguntas(def: Pick<DefinicaoFormularioNovo, 'perguntas'>): PerguntaComCaminho[] {
  const saida: PerguntaComCaminho[] = [];
  const visitar = (
    ps: readonly PerguntaFormularioNovo[],
    prefixo: string,
    nivel: number,
    pai: string | null,
  ) => {
    ps.forEach((p, i) => {
      const ordem = `${prefixo}${String(i + 1).padStart(2, '0')}`;
      saida.push({ pergunta: p, ordem, nivel, pai });
      visitar(p.itens, ordem, nivel + 1, p.linkId);
    });
  };
  visitar(def.perguntas, '', 1, null);
  return saida;
}

export type CodigoProblemaDefinicao =
  | 'link-repetido'
  | 'itens-fora-de-secao'
  | 'secao-vazia'
  | 'secao-obrigatoria'
  | 'niveis-demais'
  | 'perguntas-demais'
  | 'ordem-estourada'
  | 'opcoes-ausentes'
  | 'opcoes-indevidas'
  | 'opcao-repetida'
  | 'faixa-invalida'
  | 'regra-invalida'
  | 'regra-variavel-inexistente'
  | 'regra-circular'
  | 'calculo-em-tipo-invalido'
  | 'sem-pergunta-respondivel';

export interface ProblemaDefinicao {
  readonly codigo: CodigoProblemaDefinicao;
  readonly linkId: string | null;
  readonly detalhe: string;
}

/** Tipos que aceitam valor calculado (o total de escala é número). */
const TIPOS_CALCULAVEIS = new Set(['decimal', 'inteiro', 'texto']);

function conferirRegra(regra: unknown): string | null {
  const visitar = (r: unknown): string | null => {
    if (r === null || typeof r !== 'object') return null;
    if (Array.isArray(r)) {
      for (const x of r) {
        const e = visitar(x);
        if (e) return e;
      }
      return null;
    }
    const chaves = Object.keys(r);
    if (chaves.length !== 1) return 'nó com mais de uma operação';
    const op = chaves[0]!;
    if (!OPERACOES_REGRA.has(op)) return `operação não aceita: ${op}`;
    return visitar((r as Record<string, unknown>)[op]);
  };
  return visitar(regra);
}

/** Ordem de cálculo das perguntas calculadas (topológica); nulo quando há ciclo. */
export function ordemDeCalculo(def: Pick<DefinicaoFormularioNovo, 'perguntas'>): string[] | null {
  const calculadas = new Map(
    percorrerPerguntas(def)
      .filter((x) => x.pergunta.calcular !== null)
      .map((x) => [x.pergunta.linkId, variaveisDaRegra(x.pergunta.calcular as RegraLogica)]),
  );
  const ordem: string[] = [];
  const estado = new Map<string, 'visitando' | 'feito'>();
  const visitar = (id: string): boolean => {
    const e = estado.get(id);
    if (e === 'feito') return true;
    if (e === 'visitando') return false;
    estado.set(id, 'visitando');
    for (const dep of calculadas.get(id) ?? []) if (calculadas.has(dep) && !visitar(dep)) return false;
    estado.set(id, 'feito');
    ordem.push(id);
    return true;
  };
  for (const id of calculadas.keys()) if (!visitar(id)) return null;
  return ordem;
}

export function conferirDefinicao(def: DefinicaoFormularioNovo): ProblemaDefinicao[] {
  const problemas: ProblemaDefinicao[] = [];
  const add = (codigo: CodigoProblemaDefinicao, linkId: string | null, detalhe: string) =>
    problemas.push({ codigo, linkId, detalhe });
  const todas = percorrerPerguntas(def);
  const ids = new Set<string>();
  for (const { pergunta: p } of todas) {
    if (ids.has(p.linkId)) add('link-repetido', p.linkId, 'Identificador repetido na definição.');
    ids.add(p.linkId);
  }
  if (todas.length > LIMITES_FORMULARIO_NOVO.perguntas)
    add('perguntas-demais', null, `Máximo de ${LIMITES_FORMULARIO_NOVO.perguntas} perguntas.`);
  if (!todas.some((x) => x.pergunta.tipo !== 'secao'))
    add('sem-pergunta-respondivel', null, 'O formulário precisa de ao menos uma pergunta além das seções.');
  const irmaos = new Map<string, number>();
  for (const { pergunta: p, nivel, pai } of todas) {
    const chavePai = pai ?? '';
    irmaos.set(chavePai, (irmaos.get(chavePai) ?? 0) + 1);
    if (nivel > LIMITES_FORMULARIO_NOVO.niveis)
      add('niveis-demais', p.linkId, `Máximo de ${LIMITES_FORMULARIO_NOVO.niveis} níveis.`);
    if (p.tipo === 'secao') {
      if (p.itens.length === 0) add('secao-vazia', p.linkId, 'Seção sem perguntas.');
      if (p.obrigatorio)
        add('secao-obrigatoria', p.linkId, 'Seção não é respondida; não pode ser obrigatória.');
    } else if (p.itens.length > 0) {
      add('itens-fora-de-secao', p.linkId, 'Só a seção agrupa perguntas.');
    }
    const comOpcoes = TIPOS_COM_OPCOES.has(p.tipo);
    if (comOpcoes && p.opcoes.length === 0)
      add('opcoes-ausentes', p.linkId, 'Pergunta de escolha sem opções.');
    if (!comOpcoes && p.opcoes.length > 0)
      add('opcoes-indevidas', p.linkId, 'Só as perguntas de escolha têm opções.');
    const codigos = new Set<string>();
    const textos = new Set<string>();
    for (const o of p.opcoes) {
      const t = o.texto.trim().toUpperCase();
      if (codigos.has(o.codigo) || textos.has(t))
        add('opcao-repetida', p.linkId, `Opção repetida: ${o.codigo}.`);
      codigos.add(o.codigo);
      textos.add(t);
    }
    if (p.minimo !== null && p.maximo !== null && p.minimo > p.maximo)
      add('faixa-invalida', p.linkId, 'Mínimo maior que o máximo.');
    if ((p.minimo !== null || p.maximo !== null) && p.tipo !== 'decimal' && p.tipo !== 'inteiro')
      add('faixa-invalida', p.linkId, 'Faixa só em pergunta numérica.');
    for (const [nome, regra] of [
      ['habilitar', p.habilitar],
      ['calcular', p.calcular],
    ] as const) {
      if (regra === null) continue;
      const erro = conferirRegra(regra);
      if (erro) {
        add('regra-invalida', p.linkId, `${nome}: ${erro}.`);
        continue;
      }
      for (const v of variaveisDaRegra(regra as RegraLogica)) {
        if (!ids.has(v)) add('regra-variavel-inexistente', p.linkId, `${nome} cita "${v}", que não existe.`);
        if (v === p.linkId) add('regra-circular', p.linkId, `${nome} cita a própria pergunta.`);
      }
    }
    if (p.calcular !== null && !TIPOS_CALCULAVEIS.has(p.tipo))
      add(
        'calculo-em-tipo-invalido',
        p.linkId,
        'Só pergunta de número ou texto curto recebe valor calculado.',
      );
  }
  for (const n of irmaos.values())
    if (n > 99) add('ordem-estourada', null, 'Máximo de 99 perguntas no mesmo nível.');
  if (ordemDeCalculo(def) === null)
    add('regra-circular', null, 'Os cálculos dependem uns dos outros em ciclo.');
  return problemas;
}
