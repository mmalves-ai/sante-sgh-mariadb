// Cadastro editável dos protocolos de prescrição, dos kits de medicamentos e de soluções e das receitas padrão
// (03-PEP L107). Regra pura, a mesma na tela (validação na hora) e no servidor (antes de gravar):
// - protocolo: código e nome, faixas de idade e de peso em ordem, vigência em ordem, ao menos um item ativo; cada item
//   tem conteúdo (item do catálogo ou texto livre), o medicamento e a solução vêm do catálogo, dose e quantidade
//   positivas, sequência sem repetir;
// - kit: ao menos um item com quantidade positiva e unidade, um item principal no máximo, o kit de solução com o
//   diluente (a solução é diluída), faixa de dose e velocidade de infusão coerentes;
// - receita padrão: o dono conforme a abrangência (pessoal, da especialidade ou geral), o texto na receita livre e os
//   itens na estruturada, duração com a unidade.
// Os itens se acertam pela sequência (planoDosItens): o que sai da lista é retirado (marcado), nunca apagado, e a
// sequência reaproveitada volta a valer na mesma linha.

export interface ProblemaProtocolo {
  readonly codigo: string;
  readonly campo: string;
}

export const MENSAGENS_CADASTRO_PROTOCOLO: Readonly<Record<string, string>> = {
  'codigo-obrigatorio': 'Informe o código.',
  'nome-obrigatorio': 'Informe o nome.',
  'idade-invertida': 'A idade máxima tem de ser maior ou igual à mínima.',
  'peso-invertido': 'O peso máximo tem de ser maior ou igual ao mínimo.',
  'peso-invalido': 'O peso tem de ser maior que zero.',
  'vigencia-invertida': 'O fim da vigência tem de ser depois do início.',
  'sem-itens': 'Inclua ao menos um item.',
  'sequencia-repetida': 'Dois itens com a mesma sequência.',
  'item-sem-conteudo': 'O item precisa do item do catálogo ou de um texto.',
  'item-do-catalogo': 'Medicamento e solução vêm do catálogo da prescrição.',
  'valor-nao-positivo': 'Dose e quantidade têm de ser maiores que zero.',
  'unidade-obrigatoria': 'Informe a unidade do item.',
  'principal-repetido': 'O kit tem um item principal só.',
  'solucao-sem-diluente': 'O kit de solução precisa do diluente.',
  'faixa-dose-invertida': 'A dose final da faixa tem de ser maior ou igual à inicial.',
  'velocidade-sem-unidade': 'A velocidade de infusão precisa da unidade.',
  'abrangencia-sem-dono': 'A receita da especialidade precisa da especialidade; a pessoal, do profissional.',
  'texto-obrigatorio': 'A receita em texto livre precisa do texto.',
  'duracao-sem-unidade': 'A duração do tratamento precisa da unidade.',
};

export const TIPOS_ITEM_PROTOCOLO = [
  'medicamento',
  'solucao',
  'dieta',
  'cuidado',
  'exame',
  'procedimento',
  'oxigenio',
  'hemoderivado',
  'material',
  'orientacao',
  'outro',
] as const;
export const SEXOS_PROTOCOLO = ['todos', 'feminino', 'masculino'] as const;
export const TIPOS_KIT = ['medicamento', 'solucao', 'procedimento', 'misto'] as const;
export const PAPEIS_ITEM_KIT = ['principal', 'componente', 'diluente', 'reconstituinte', 'material'] as const;
export const ABRANGENCIAS_RECEITA = ['geral', 'especialidade', 'profissional'] as const;
export const FORMATOS_RECEITA = ['livre', 'estruturada'] as const;

export interface ItemProtocoloEntrada {
  readonly sequencia: number;
  readonly tipoItem: (typeof TIPOS_ITEM_PROTOCOLO)[number];
  readonly item: number | null;
  readonly descricao: string | null;
  readonly dose: number | null;
  readonly quantidade: number | null;
  readonly ativo?: boolean;
}
export interface ProtocoloEntrada {
  readonly codigo: string;
  readonly nome: string;
  readonly idadeMin: number | null;
  readonly idadeMax: number | null;
  readonly pesoMin: number | null;
  readonly pesoMax: number | null;
  readonly vigenciaInicio: string | null;
  readonly vigenciaFim: string | null;
  readonly itens: readonly ItemProtocoloEntrada[];
}
export interface ItemKitEntrada {
  readonly sequencia: number;
  readonly item: number | null;
  readonly papel: (typeof PAPEIS_ITEM_KIT)[number];
  readonly quantidade: number;
  readonly unidade: number | null;
}
export interface KitEntrada {
  readonly codigo: string;
  readonly nome: string;
  readonly tipoKit: (typeof TIPOS_KIT)[number];
  readonly doseInicial: number | null;
  readonly doseFinal: number | null;
  readonly velocidade: number | null;
  readonly unidadeInfusao: number | null;
  readonly itens: readonly ItemKitEntrada[];
}
export interface ItemReceitaEntrada {
  readonly sequencia: number;
  readonly item: number | null;
  readonly descricaoLivre: string | null;
  readonly dose: number | null;
  readonly quantidade: number | null;
  readonly duracao: number | null;
  readonly unidadeDuracao: number | null;
}
export interface ReceitaPadraoEntrada {
  readonly nome: string;
  readonly abrangencia: (typeof ABRANGENCIAS_RECEITA)[number];
  readonly especialidade: number | null;
  readonly profissional: number | null;
  readonly formato: (typeof FORMATOS_RECEITA)[number];
  readonly texto: string | null;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly itens: readonly ItemReceitaEntrada[];
}

const vazio = (s: string | null | undefined): boolean => !s || !s.trim();
const positivoOuNulo = (n: number | null | undefined): boolean => n === null || n === undefined || n > 0;

function sequenciasRepetidas(itens: readonly { sequencia: number }[], campo: string): ProblemaProtocolo[] {
  const vistas = new Set<number>();
  for (const i of itens) {
    if (vistas.has(i.sequencia)) return [{ codigo: 'sequencia-repetida', campo }];
    vistas.add(i.sequencia);
  }
  return [];
}

function vigencia(inicio: string | null, fim: string | null): ProblemaProtocolo[] {
  return inicio && fim && fim.slice(0, 10) < inicio.slice(0, 10)
    ? [{ codigo: 'vigencia-invertida', campo: 'vigenciaFim' }]
    : [];
}

/** Problemas do protocolo de prescrição (cabeçalho e itens). Vazio: pode gravar. */
export function problemasDoProtocolo(p: ProtocoloEntrada): ProblemaProtocolo[] {
  const ps: ProblemaProtocolo[] = [];
  if (vazio(p.codigo)) ps.push({ codigo: 'codigo-obrigatorio', campo: 'codigo' });
  if (vazio(p.nome)) ps.push({ codigo: 'nome-obrigatorio', campo: 'nome' });
  if (p.idadeMin !== null && p.idadeMax !== null && p.idadeMax < p.idadeMin)
    ps.push({ codigo: 'idade-invertida', campo: 'idadeMax' });
  if (!positivoOuNulo(p.pesoMin) || !positivoOuNulo(p.pesoMax))
    ps.push({ codigo: 'peso-invalido', campo: 'pesoMin' });
  else if (p.pesoMin !== null && p.pesoMax !== null && p.pesoMax < p.pesoMin)
    ps.push({ codigo: 'peso-invertido', campo: 'pesoMax' });
  ps.push(...vigencia(p.vigenciaInicio, p.vigenciaFim));
  const ativos = p.itens.filter((i) => i.ativo !== false);
  if (ativos.length === 0) ps.push({ codigo: 'sem-itens', campo: 'itens' });
  ps.push(...sequenciasRepetidas(p.itens, 'itens'));
  for (const i of ativos) {
    if (i.item === null && vazio(i.descricao))
      ps.push({ codigo: 'item-sem-conteudo', campo: `item-${i.sequencia}` });
    else if ((i.tipoItem === 'medicamento' || i.tipoItem === 'solucao') && i.item === null)
      ps.push({ codigo: 'item-do-catalogo', campo: `item-${i.sequencia}` });
    if (!positivoOuNulo(i.dose) || !positivoOuNulo(i.quantidade))
      ps.push({ codigo: 'valor-nao-positivo', campo: `item-${i.sequencia}` });
  }
  return ps;
}

/** Problemas do kit de medicamentos ou de soluções. Vazio: pode gravar. */
export function problemasDoKit(k: KitEntrada): ProblemaProtocolo[] {
  const ps: ProblemaProtocolo[] = [];
  if (vazio(k.codigo)) ps.push({ codigo: 'codigo-obrigatorio', campo: 'codigo' });
  if (vazio(k.nome)) ps.push({ codigo: 'nome-obrigatorio', campo: 'nome' });
  if (k.doseInicial !== null && k.doseFinal !== null && k.doseFinal < k.doseInicial)
    ps.push({ codigo: 'faixa-dose-invertida', campo: 'doseFinal' });
  if (k.velocidade !== null && (k.velocidade <= 0 || k.unidadeInfusao === null))
    ps.push({ codigo: 'velocidade-sem-unidade', campo: 'unidadeInfusao' });
  if (k.itens.length === 0) ps.push({ codigo: 'sem-itens', campo: 'itens' });
  ps.push(...sequenciasRepetidas(k.itens, 'itens'));
  for (const i of k.itens) {
    if (i.item === null) ps.push({ codigo: 'item-sem-conteudo', campo: `item-${i.sequencia}` });
    if (!(i.quantidade > 0)) ps.push({ codigo: 'valor-nao-positivo', campo: `item-${i.sequencia}` });
    if (i.unidade === null) ps.push({ codigo: 'unidade-obrigatoria', campo: `item-${i.sequencia}` });
  }
  if (k.itens.filter((i) => i.papel === 'principal').length > 1)
    ps.push({ codigo: 'principal-repetido', campo: 'itens' });
  if (k.tipoKit === 'solucao' && k.itens.length > 0 && !k.itens.some((i) => i.papel === 'diluente'))
    ps.push({ codigo: 'solucao-sem-diluente', campo: 'itens' });
  return ps;
}

/** Problemas da receita padrão. Vazio: pode gravar. */
export function problemasDaReceitaPadrao(r: ReceitaPadraoEntrada): ProblemaProtocolo[] {
  const ps: ProblemaProtocolo[] = [];
  if (vazio(r.nome)) ps.push({ codigo: 'nome-obrigatorio', campo: 'nome' });
  if (
    (r.abrangencia === 'especialidade' && r.especialidade === null) ||
    (r.abrangencia === 'profissional' && r.profissional === null)
  )
    ps.push({ codigo: 'abrangencia-sem-dono', campo: 'abrangencia' });
  if (r.vigenciaFim && r.vigenciaFim.slice(0, 10) <= r.vigenciaInicio.slice(0, 10))
    ps.push({ codigo: 'vigencia-invertida', campo: 'vigenciaFim' });
  if (r.formato === 'livre' && vazio(r.texto)) ps.push({ codigo: 'texto-obrigatorio', campo: 'texto' });
  if (r.formato === 'estruturada') {
    if (r.itens.length === 0) ps.push({ codigo: 'sem-itens', campo: 'itens' });
    ps.push(...sequenciasRepetidas(r.itens, 'itens'));
    for (const i of r.itens) {
      if (i.item === null && vazio(i.descricaoLivre))
        ps.push({ codigo: 'item-sem-conteudo', campo: `item-${i.sequencia}` });
      if (!positivoOuNulo(i.dose) || !positivoOuNulo(i.quantidade))
        ps.push({ codigo: 'valor-nao-positivo', campo: `item-${i.sequencia}` });
      if (i.duracao !== null && i.unidadeDuracao === null)
        ps.push({ codigo: 'duracao-sem-unidade', campo: `item-${i.sequencia}` });
    }
  }
  return ps;
}

export interface LinhaItemExistente {
  readonly id: number;
  readonly sequencia: number;
  readonly vivo: boolean;
}
export interface PlanoItens {
  /** Sequências sem linha: incluir. */
  readonly incluir: readonly number[];
  /** Linhas da mesma sequência: alterar (e voltar a valer, se estavam retiradas). */
  readonly alterar: readonly { readonly sequencia: number; readonly id: number }[];
  /** Linhas vivas que saíram da lista: retirar (marcar), nunca apagar. */
  readonly retirar: readonly number[];
}

/** Acerto dos itens pela sequência: inclui o novo, altera (e revive) o da mesma sequência, retira o que saiu. */
export function planoDosItens(
  existentes: readonly LinhaItemExistente[],
  sequencias: readonly number[],
): PlanoItens {
  const porSeq = new Map(existentes.map((e) => [e.sequencia, e]));
  const pedidas = new Set(sequencias);
  return {
    incluir: sequencias.filter((s) => !porSeq.has(s)),
    alterar: sequencias.filter((s) => porSeq.has(s)).map((s) => ({ sequencia: s, id: porSeq.get(s)!.id })),
    retirar: existentes.filter((e) => e.vivo && !pedidas.has(e.sequencia)).map((e) => e.id),
  };
}

/** Os protocolos aplicados numa prescrição, sem repetir, na ordem em que aparecem nos itens. */
export function protocolosAplicados(itens: readonly { readonly protocolo?: number | null }[]): number[] {
  const vistos: number[] = [];
  for (const i of itens)
    if (i.protocolo && i.protocolo > 0 && !vistos.includes(i.protocolo)) vistos.push(i.protocolo);
  return vistos;
}
