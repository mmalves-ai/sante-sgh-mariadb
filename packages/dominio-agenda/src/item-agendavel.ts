// Itens agendáveis (02-AGE linha 45): o cadastro do que se marca (consulta, exame, procedimento, sessão ou pacote) com
// as regras que valem na marcação: composição do pacote, conflito entre itens, pré-requisito, recurso ou equipamento
// exigido e orientação de preparo por fonte pagadora. Aqui ficam só as regras puras: a validação do cadastro, a crítica
// da marcação (pré-requisito, conflito, repetição mínima e equipamento livre) e o preparo entregue ao paciente. A
// leitura do histórico do paciente e da ocupação dos recursos é da porta; o domínio decide.

export const TIPOS_ITEM_AGENDAVEL = ['consulta', 'exame', 'procedimento', 'sessao', 'composto'] as const;
export type TipoItemAgendavel = (typeof TIPOS_ITEM_AGENDAVEL)[number];
export const TIPOS_REQUISITO = [
  'item_realizado',
  'item_marcado',
  'autorizacao',
  'documento',
  'condicao',
] as const;
export type TipoRequisito = (typeof TIPOS_REQUISITO)[number];
export const DIRECOES_CONFLITO = ['antes', 'depois', 'ambos'] as const;
export type DirecaoConflito = (typeof DIRECOES_CONFLITO)[number];
export const PAPEIS_RECURSO = ['realiza', 'exigido'] as const;
export type PapelRecurso = (typeof PAPEIS_RECURSO)[number];

export interface ComponenteItem {
  readonly componente: number;
  readonly quantidade: number;
}
export interface ConflitoItem {
  /** O outro item, que não pode ficar a menos de `intervaloMinimoHoras` deste. */
  readonly item: number;
  readonly intervaloMinimoHoras: number;
  /** antes: vale quando o outro item fica antes deste; depois: quando fica depois; ambos: nos dois sentidos. */
  readonly direcao: DirecaoConflito;
}
export interface RequisitoItem {
  readonly tipo: TipoRequisito;
  /** Item exigido (item_realizado, item_marcado); null nos demais. */
  readonly item: number | null;
  /** Condição exigida (autorizacao, documento, condicao); null quando o requisito é outro item. */
  readonly descricao: string | null;
  /** Validade: o item exigido vale até este número de dias antes da marcação; null = sem prazo. */
  readonly prazoMaximoDias: number | null;
  /** Falso: só alerta. */
  readonly bloqueia: boolean;
}
export interface RecursoItem {
  readonly recurso: number;
  readonly papel: PapelRecurso;
  readonly quantidade: number;
}
export interface OrientacaoFonte {
  readonly fontePagadora: number;
  readonly orientacao: string;
}

export interface ItemAgendavelEntrada {
  readonly codigo: string;
  readonly descricao: string;
  readonly tipoItem: string;
  readonly duracaoMinutos: number;
  readonly diasPreparo: number | null;
  readonly orientacaoPreparo: string | null;
  readonly intervaloRepeticaoMinutos: number | null;
  readonly composicao: readonly ComponenteItem[];
  readonly conflitos: readonly ConflitoItem[];
  readonly requisitos: readonly RequisitoItem[];
  readonly recursos: readonly RecursoItem[];
  readonly orientacoes: readonly OrientacaoFonte[];
}

export interface RecusaItem {
  readonly codigo: string;
  readonly mensagem: string;
  readonly campo?: string;
}

const repetido = (xs: readonly (string | number)[]): boolean => new Set(xs).size !== xs.length;
const vazio = (s: string | null | undefined): boolean => s == null || s.trim() === '';

/**
 * Confere o cadastro do item na hora (a tela) e de novo no servidor. `id` é o do item em edição (null no novo): nenhuma
 * regra aponta para o próprio item. Devolve a primeira recusa ou null.
 */
export function validarItemAgendavel(e: ItemAgendavelEntrada, id: number | null): RecusaItem | null {
  if (vazio(e.codigo))
    return { codigo: 'codigo-obrigatorio', mensagem: 'Informe o código do item.', campo: 'codigo' };
  if (e.codigo.trim().length > 30)
    return { codigo: 'codigo-longo', mensagem: 'O código tem no máximo 30 caracteres.', campo: 'codigo' };
  if (vazio(e.descricao))
    return { codigo: 'descricao-obrigatoria', mensagem: 'Informe a descrição do item.', campo: 'descricao' };
  if (e.descricao.trim().length > 150)
    return {
      codigo: 'descricao-longa',
      mensagem: 'A descrição tem no máximo 150 caracteres.',
      campo: 'descricao',
    };
  if (!(TIPOS_ITEM_AGENDAVEL as readonly string[]).includes(e.tipoItem))
    return { codigo: 'tipo-invalido', mensagem: 'Escolha o tipo do item.', campo: 'tipoItem' };
  if (!Number.isInteger(e.duracaoMinutos) || e.duracaoMinutos < 1 || e.duracaoMinutos > 1440)
    return {
      codigo: 'duracao-invalida',
      mensagem: 'A duração vai de 1 a 1440 minutos.',
      campo: 'duracaoMinutos',
    };
  if (
    e.diasPreparo !== null &&
    (!Number.isInteger(e.diasPreparo) || e.diasPreparo < 0 || e.diasPreparo > 365)
  )
    return {
      codigo: 'dias-preparo-invalido',
      mensagem: 'Os dias de preparo vão de 0 a 365.',
      campo: 'diasPreparo',
    };
  if (e.diasPreparo !== null && e.diasPreparo > 0 && vazio(e.orientacaoPreparo))
    return {
      codigo: 'preparo-sem-orientacao',
      mensagem: 'Com dias de preparo, escreva a orientação que o paciente recebe.',
      campo: 'orientacaoPreparo',
    };
  if (
    e.intervaloRepeticaoMinutos !== null &&
    (!Number.isInteger(e.intervaloRepeticaoMinutos) || e.intervaloRepeticaoMinutos < 1)
  )
    return {
      codigo: 'intervalo-invalido',
      mensagem: 'O intervalo mínimo entre duas realizações é um número inteiro de minutos maior que zero.',
      campo: 'intervaloRepeticaoMinutos',
    };
  // Composição: só o pacote tem, e o pacote não fica vazio.
  if (e.tipoItem === 'composto' && e.composicao.length === 0)
    return {
      codigo: 'pacote-vazio',
      mensagem: 'O item composto (pacote) precisa de pelo menos um item na composição.',
      campo: 'composicao',
    };
  if (e.tipoItem !== 'composto' && e.composicao.length > 0)
    return {
      codigo: 'composicao-fora-de-pacote',
      mensagem: 'Só o item do tipo composto (pacote) tem composição.',
      campo: 'composicao',
    };
  if (e.composicao.some((c) => c.componente === id))
    return { codigo: 'composicao-propria', mensagem: 'O pacote não contém a si mesmo.', campo: 'composicao' };
  if (repetido(e.composicao.map((c) => c.componente)))
    return {
      codigo: 'composicao-repetida',
      mensagem: 'O mesmo item aparece duas vezes no pacote.',
      campo: 'composicao',
    };
  if (e.composicao.some((c) => !(c.quantidade > 0)))
    return {
      codigo: 'quantidade-invalida',
      mensagem: 'A quantidade do item no pacote é maior que zero.',
      campo: 'composicao',
    };
  // Conflitos.
  if (e.conflitos.some((c) => c.item === id))
    return {
      codigo: 'conflito-proprio',
      mensagem: 'O item não conflita consigo mesmo: use o intervalo mínimo entre realizações.',
      campo: 'conflitos',
    };
  if (repetido(e.conflitos.map((c) => c.item)))
    return {
      codigo: 'conflito-repetido',
      mensagem: 'O mesmo item aparece duas vezes nos conflitos.',
      campo: 'conflitos',
    };
  if (e.conflitos.some((c) => !(c.intervaloMinimoHoras > 0)))
    return {
      codigo: 'conflito-sem-intervalo',
      mensagem: 'O intervalo mínimo do conflito é maior que zero.',
      campo: 'conflitos',
    };
  if (e.conflitos.some((c) => !(DIRECOES_CONFLITO as readonly string[]).includes(c.direcao)))
    return { codigo: 'conflito-direcao', mensagem: 'Escolha o sentido do conflito.', campo: 'conflitos' };
  // Pré-requisitos.
  for (const r of e.requisitos) {
    if (!(TIPOS_REQUISITO as readonly string[]).includes(r.tipo))
      return { codigo: 'requisito-tipo', mensagem: 'Escolha o tipo do pré-requisito.', campo: 'requisitos' };
    const porItem = r.tipo === 'item_realizado' || r.tipo === 'item_marcado';
    if (porItem && r.item === null)
      return { codigo: 'requisito-sem-item', mensagem: 'Escolha o item exigido antes.', campo: 'requisitos' };
    if (!porItem && vazio(r.descricao))
      return {
        codigo: 'requisito-sem-condicao',
        mensagem: 'Descreva a condição exigida.',
        campo: 'requisitos',
      };
    if (porItem && r.item === id)
      return {
        codigo: 'requisito-proprio',
        mensagem: 'O item não é pré-requisito de si mesmo.',
        campo: 'requisitos',
      };
    if (r.prazoMaximoDias !== null && (!Number.isInteger(r.prazoMaximoDias) || r.prazoMaximoDias < 1))
      return {
        codigo: 'requisito-prazo',
        mensagem: 'A validade do pré-requisito é de pelo menos 1 dia.',
        campo: 'requisitos',
      };
  }
  const itensExigidos = e.requisitos.filter((r) => r.item !== null).map((r) => r.item as number);
  if (repetido(itensExigidos))
    return {
      codigo: 'requisito-repetido',
      mensagem: 'O mesmo item exigido aparece duas vezes.',
      campo: 'requisitos',
    };
  if (itensExigidos.some((x) => e.conflitos.some((c) => c.item === x)))
    return {
      codigo: 'requisito-em-conflito',
      mensagem: 'Um item não pode ser ao mesmo tempo pré-requisito e conflito deste.',
      campo: 'requisitos',
    };
  // Recursos e orientações.
  if (repetido(e.recursos.map((r) => r.recurso)))
    return { codigo: 'recurso-repetido', mensagem: 'O mesmo recurso aparece duas vezes.', campo: 'recursos' };
  if (e.recursos.some((r) => !(PAPEIS_RECURSO as readonly string[]).includes(r.papel) || !(r.quantidade > 0)))
    return {
      codigo: 'recurso-invalido',
      mensagem: 'Escolha o papel do recurso e a quantidade maior que zero.',
      campo: 'recursos',
    };
  if (repetido(e.orientacoes.map((o) => o.fontePagadora)))
    return {
      codigo: 'orientacao-repetida',
      mensagem: 'O mesmo convênio aparece duas vezes nas orientações.',
      campo: 'orientacoes',
    };
  if (e.orientacoes.some((o) => vazio(o.orientacao)))
    return {
      codigo: 'orientacao-vazia',
      mensagem: 'Escreva a orientação do convênio.',
      campo: 'orientacoes',
    };
  return null;
}

/**
 * Ciclo de pré-requisito: `arestas` são os pares (item, exigido) já gravados; `item` passa a exigir `exigidos`. Devolve
 * true quando algum exigido já depende (direta ou indiretamente) do próprio item, o que tornaria a marcação impossível.
 */
export function formaCicloDeRequisito(
  item: number,
  exigidos: readonly number[],
  arestas: readonly { readonly item: number; readonly exigido: number }[],
): boolean {
  const grafo = new Map<number, number[]>();
  for (const a of arestas) {
    if (a.item === item) continue; // as do próprio item serão trocadas pelas novas
    grafo.set(a.item, [...(grafo.get(a.item) ?? []), a.exigido]);
  }
  grafo.set(item, [...exigidos]);
  const visto = new Set<number>();
  const pilha = [...exigidos];
  while (pilha.length > 0) {
    const x = pilha.pop() as number;
    if (x === item) return true;
    if (visto.has(x)) continue;
    visto.add(x);
    pilha.push(...(grafo.get(x) ?? []));
  }
  return false;
}

// ── Crítica da marcação ──────────────────────────────────────────────────────────────────────────────

/** Regras do item marcado, como a porta lê do banco (só as ativas). */
export interface RegrasDoItem {
  readonly id: number;
  readonly descricao: string;
  readonly ativo: boolean;
  readonly duracaoMinutos: number;
  readonly intervaloRepeticaoMinutos: number | null;
  readonly requisitos: readonly RequisitoItem[];
  readonly conflitos: readonly ConflitoItem[];
  readonly recursos: readonly RecursoItem[];
}

/** Item do paciente já marcado ou realizado (sem os cancelados), com o instante de início em milissegundos. */
export interface ItemDoHistorico {
  readonly item: number;
  readonly inicio: number;
  readonly realizado: boolean;
  /** Marcação a que o item pertence: a própria marcação em crítica não conta como histórico. */
  readonly marcacao: number;
}

/** Ocupação do recurso no intervalo da marcação, já somadas as outras marcações. */
export interface OcupacaoRecurso {
  readonly recurso: number;
  readonly descricao: string;
  readonly ativo: boolean;
  readonly capacidade: number;
  readonly ocupado: number;
}

export interface AchadoCritica {
  readonly codigo: string;
  readonly item: number;
  readonly mensagem: string;
}

export interface EntradaCritica {
  readonly marcacao: number;
  readonly inicio: number;
  readonly itens: readonly RegrasDoItem[];
  /** Descrição dos itens citados nas regras (exigidos e conflitantes), para a mensagem. */
  readonly nomes: ReadonlyMap<number, string>;
  readonly historico: readonly ItemDoHistorico[];
  readonly recursos: readonly OcupacaoRecurso[];
}

export interface ResultadoCritica {
  readonly bloqueios: readonly AchadoCritica[];
  readonly alertas: readonly AchadoCritica[];
}

const HORA = 3_600_000;
const DIA = 86_400_000;

/**
 * Crítica dos itens numa marcação: pré-requisito (feito ou marcado antes, dentro da validade), conflito entre itens
 * (no histórico do paciente e entre os itens da mesma marcação, nos dois sentidos da regra), intervalo mínimo de
 * repetição do mesmo item e recurso livre (capacidade contra a ocupação no intervalo). Regra que "só alerta" vai para
 * os alertas; condição que o sistema não confere (autorização, documento) vira alerta para a recepção conferir.
 */
export function criticarItensDaMarcacao(e: EntradaCritica): ResultadoCritica {
  const bloqueios: AchadoCritica[] = [];
  const alertas: AchadoCritica[] = [];
  const nome = (id: number) => e.nomes.get(id) ?? `item ${id}`;
  const outros = e.historico.filter((h) => h.marcacao !== e.marcacao);
  const doMesmo = new Set(e.itens.map((i) => i.id));
  for (const it of e.itens) {
    if (!it.ativo)
      bloqueios.push({
        codigo: 'item-inativo',
        item: it.id,
        mensagem: `${it.descricao}: o item está inativo.`,
      });
    // Pré-requisitos.
    for (const r of it.requisitos) {
      const destino = r.bloqueia ? bloqueios : alertas;
      if (r.item === null) {
        alertas.push({
          codigo: `requisito-${r.tipo}`,
          item: it.id,
          mensagem: `${it.descricao}: conferir antes da realização — ${r.descricao ?? r.tipo}.`,
        });
        continue;
      }
      const exigido = r.item;
      const valeAte = r.prazoMaximoDias === null ? -Infinity : e.inicio - r.prazoMaximoDias * DIA;
      const cumpre = outros.some(
        (h) =>
          h.item === exigido &&
          h.inicio <= e.inicio &&
          h.inicio >= valeAte &&
          (r.tipo === 'item_marcado' || h.realizado),
      );
      if (!cumpre)
        destino.push({
          codigo: r.tipo === 'item_realizado' ? 'requisito-nao-realizado' : 'requisito-nao-marcado',
          item: it.id,
          mensagem:
            `${it.descricao}: exige ${nome(exigido)} ${r.tipo === 'item_realizado' ? 'realizado' : 'marcado'} antes` +
            (r.prazoMaximoDias === null ? '.' : ` (nos últimos ${r.prazoMaximoDias} dias).`),
        });
    }
    // Conflitos, nos dois sentidos da regra: a regra de A sobre B vale quando se marca A ou quando se marca B.
    for (const c of it.conflitos) {
      const limite = c.intervaloMinimoHoras * HORA;
      if (doMesmo.has(c.item) && c.item !== it.id) {
        bloqueios.push({
          codigo: 'conflito-na-marcacao',
          item: it.id,
          mensagem: `${it.descricao} e ${nome(c.item)} não podem ficar na mesma marcação: intervalo mínimo de ${c.intervaloMinimoHoras} h.`,
        });
        continue;
      }
      const choque = outros.find((h) => {
        if (h.item !== c.item) return false;
        const d = e.inicio - h.inicio; // > 0: o outro item fica antes deste
        if (Math.abs(d) >= limite) return false;
        if (c.direcao === 'antes') return d >= 0;
        if (c.direcao === 'depois') return d <= 0;
        return true;
      });
      if (choque)
        bloqueios.push({
          codigo: 'conflito-entre-itens',
          item: it.id,
          mensagem: `${it.descricao}: ${nome(c.item)} ${choque.inicio <= e.inicio ? 'antes' : 'depois'} a menos de ${c.intervaloMinimoHoras} h.`,
        });
    }
    // Intervalo mínimo entre duas realizações do mesmo item.
    if (it.intervaloRepeticaoMinutos !== null) {
      const limite = it.intervaloRepeticaoMinutos * 60_000;
      if (outros.some((h) => h.item === it.id && Math.abs(e.inicio - h.inicio) < limite))
        bloqueios.push({
          codigo: 'repeticao-antes-do-intervalo',
          item: it.id,
          mensagem: `${it.descricao}: o paciente já tem este item a menos de ${it.intervaloRepeticaoMinutos} minutos.`,
        });
    }
  }
  // Recursos: a soma do que os itens desta marcação pedem contra o que sobra no intervalo.
  const pedido = new Map<number, { item: number; quantidade: number }>();
  for (const it of e.itens)
    for (const r of it.recursos) {
      const x = pedido.get(r.recurso);
      pedido.set(r.recurso, { item: x?.item ?? it.id, quantidade: (x?.quantidade ?? 0) + r.quantidade });
    }
  for (const [recurso, p] of pedido) {
    const o = e.recursos.find((x) => x.recurso === recurso);
    if (!o || !o.ativo) {
      bloqueios.push({
        codigo: 'recurso-inativo',
        item: p.item,
        mensagem: `${o?.descricao ?? `Recurso ${recurso}`}: o recurso exigido está inativo.`,
      });
      continue;
    }
    if (o.ocupado + p.quantidade > o.capacidade)
      bloqueios.push({
        codigo: 'equipamento-ocupado',
        item: p.item,
        mensagem: `${o.descricao}: ocupado no horário (${o.ocupado} de ${o.capacidade} em uso).`,
      });
  }
  return { bloqueios, alertas };
}

// ── Preparo entregue ao paciente ─────────────────────────────────────────────────────────────────────

export interface PreparoDoItem {
  readonly item: number;
  readonly texto: string | null;
  /** Data (AAAA-MM-DD) em que o preparo começa; null sem dias de preparo. */
  readonly inicioPreparo: string | null;
  /** O preparo começaria antes de hoje: o paciente não tem tempo de cumpri-lo. */
  readonly tempoInsuficiente: boolean;
}

const somarDias = (dataIso: string, dias: number): string => {
  const d = new Date(`${dataIso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
};

/**
 * Texto do preparo entregue na marcação: a orientação padrão do item e, quando a fonte pagadora tem a sua, a do
 * convênio logo depois; com dias de preparo, a data de início. `data` e `hoje` em AAAA-MM-DD, no fuso da unidade.
 */
export function montarPreparo(p: {
  item: number;
  data: string;
  hoje: string;
  diasPreparo: number | null;
  orientacaoPadrao: string | null;
  orientacaoFonte: string | null;
}): PreparoDoItem {
  const partes: string[] = [];
  const dias = p.diasPreparo ?? 0;
  const inicioPreparo = dias > 0 ? somarDias(p.data, dias) : null;
  if (inicioPreparo) {
    const [a, m, d] = inicioPreparo.split('-');
    partes.push(`Começar o preparo ${dias} dia(s) antes: a partir de ${d}/${m}/${a}.`);
  }
  if (!vazio(p.orientacaoPadrao)) partes.push((p.orientacaoPadrao as string).trim());
  if (!vazio(p.orientacaoFonte))
    partes.push(`Orientação do convênio: ${(p.orientacaoFonte as string).trim()}`);
  return {
    item: p.item,
    texto: partes.length === 0 ? null : partes.join('\n'),
    inicioPreparo,
    tempoInsuficiente: inicioPreparo !== null && inicioPreparo < p.hoje,
  };
}

/** Desdobra o pacote nos itens que o compõem (um nível: o componente não é pacote). Mantém a ordem e tira repetidos. */
export function desdobrarItens(
  pedidos: readonly number[],
  composicao: ReadonlyMap<number, readonly number[]>,
): number[] {
  const saida: number[] = [];
  for (const x of pedidos) for (const y of composicao.get(x) ?? [x]) if (!saida.includes(y)) saida.push(y);
  return saida;
}
