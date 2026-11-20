// Visão do formulário para o renderizador (FormRenderer; ficha do M22, seção 7 e regra 4): a representação do
// parser DFM vira a lista de campos da tela, na ordem da árvore do formulário de origem, em grade de 12 colunas.
// Regra 4: vínculo inativo não aparece nem é gravado no registro NOVO; no registro antigo (visualização), aparece
// o que ele tem. As expressões viram regras em JSON Logic (habilitar, calcular); a que não converteu fica pendente.
import type { CampoRegistro, TipoCampoRegistro } from '@sgh/contratos';
import type { ItemFormulario, RepresentacaoFormulario } from '../formulario/dfm/mapeamento.js';
import { podeGravar } from '../gravador/colunas.js';

const TIPO_DO_ITEM: Readonly<Record<string, TipoCampoRegistro>> = {
  group: 'secao',
  text: 'texto-formatado',
  date: 'data',
  time: 'hora',
  choice: 'escolha',
  'open-choice': 'escolha-com-texto',
  'multi-choice': 'multipla',
  string: 'texto',
  quantity: 'quantidade',
  grid: 'grade',
  coding: 'cid',
  'multi-coding': 'cid-multiplo',
  reference: 'alergias',
};

function tipoDoCampo(i: ItemFormulario): TipoCampoRegistro {
  // Número sem unidade (TfRespEdit com tipo 6 ou 7) é quantidade (o valor vai em RESPVALOR).
  const t = i['x-legacy'].tipo;
  if (i.tipo === 'string' && (t === '6' || t === '7')) return 'quantidade';
  if (i.tipo === 'quantity' && t === '11') return 'texto';
  return TIPO_DO_ITEM[i.tipo] ?? 'sem-campo';
}

function campo(i: ItemFormulario, soAtivos: boolean): CampoRegistro {
  const hab = i.expressoes?.find((e) => e.tipo === 'habilitar');
  const calc = i.expressoes?.find((e) => e.tipo === 'calcular');
  const pendente = (i.expressoes ?? []).some((e) => e.convertida === false);
  const filhos = soAtivos ? i.itens.filter((f) => f.ativo) : i.itens;
  return {
    linkId: i.linkId,
    vinculo: i['x-legacy'].vinculo,
    componente: i['x-legacy'].componente,
    tipo: tipoDoCampo(i),
    titulo: i.texto,
    obrigatorio: i.obrigatorio,
    unidade: i.unidade,
    tamanhoMaximo: i.tamanhoMaximo,
    colunas: i.layout?.colunas ?? 12,
    opcoes: (i.opcoes ?? []).map((o) => ({ indice: o.indice, texto: o.texto })),
    colunasGrade: (i.colunasGrade ?? []).map((c) => ({
      coluna: c.coluna,
      titulo: c.titulo,
      tipo:
        c.tipo === '2' || c.tipo === '3'
          ? 'hora'
          : c.tipo === '5' || c.tipo === '6' || c.tipo === '7'
            ? 'numero'
            : 'texto',
      unidade: c.unidade,
    })),
    habilitar: hab?.convertida && hab.regra !== undefined ? hab.regra : null,
    calcular: calc?.convertida && calc.regra !== undefined ? calc.regra : null,
    regraPendente: pendente,
    manterHistorico: i['x-legacy'].manterHist ?? 0,
    // Pergunta que responde mas não pode ser gravada (lista ou resposta cadastrada a confirmar, tipo não gravado).
    ambiguo:
      i.tipo !== 'group' &&
      i.tipo !== 'reference' &&
      i.tipo !== 'sem-componente' &&
      i.tipo !== 'nao-mapeado' &&
      !podeGravar(i),
    itens: filhos.map((f) => campo(f, soAtivos)),
  };
}

/** Campos do registro NOVO: só os vínculos ativos (e os filhos ativos de seções ativas). */
export function camposParaRegistro(rep: Pick<RepresentacaoFormulario, 'itens'>): CampoRegistro[] {
  return rep.itens.filter((i) => i.ativo).map((i) => campo(i, true));
}

/** Campos para mostrar um registro gravado: todos, inclusive os desligados depois (o registro mostra o que tem). */
export function camposParaVisualizar(rep: Pick<RepresentacaoFormulario, 'itens'>): CampoRegistro[] {
  return rep.itens.map((i) => campo(i, false));
}

/** Lista plana dos campos (ordem da árvore). */
export function planos(campos: readonly CampoRegistro[]): CampoRegistro[] {
  return campos.flatMap((c) => [c, ...planos(c.itens)]);
}

/** O modelo tem pergunta ativa ambígua ou de tipo que não se grava? (fica só em consulta; DP-28.) */
export function bloqueiosDoModelo(campos: readonly CampoRegistro[]): {
  ambiguas: number;
  naoGravados: number;
} {
  const l = planos(campos);
  return {
    ambiguas: l.filter((c) => c.ambiguo).length,
    // Campo sem componente (vínculo sem desenho no formulário) não se responde: não conta.
    naoGravados: l.filter((c) => c.tipo === 'cid-multiplo').length,
  };
}
