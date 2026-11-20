// Leitura estruturada das respostas de um registro (regra 5 da ficha do M15; cap-11 §11.1 "Leitura
// estruturada"): o caminho de cada valor é modelo + ORDEM → vínculo do modelo (inclusive os inativos) → tipo da
// pergunta → coluna. A escolha grava o índice do combo (RESPSNAO) e o ID da resposta: a leitura resolve pelo ID
// da resposta (100% dos casos válidos na cópia) e, sem ele, pelo índice na lista do formulário (DFM) ou pela
// ordem das respostas cadastradas; SEQ é a linha da grade; o CID vem do retrato; a sentinela 1899-12-30 vira
// vazio e a hora HHMM vira HH:MM. O que não se resolve com certeza fica marcado "a confirmar" (DP-28), nunca
// adivinhado. Puras: a API monta a entrada com o que o adaptador leu.
import type { ItemResposta, Respostas } from '@sgh/contratos';
import type { EntradaModelo, ItemFormulario, RepresentacaoFormulario } from '../formulario/dfm/mapeamento.js';
import { apresentarData, apresentarHora } from '../formulario/dfm/layout.js';
import { rtfParaTexto, pareceRtf, textoCorrido } from './rtf.js';

/** Os 24 tipos de pergunta do legado (cadastro de tipos de pergunta, medido na cópia em 2026-10-20). */
export const TIPOS_PERGUNTA: Readonly<Record<string, string>> = {
  '1': 'Título',
  '2': 'Data',
  '3': 'Hora',
  '4': 'Sim/Não',
  '5': 'Texto',
  '6': 'Valor decimal',
  '7': 'Valor inteiro',
  '8': 'Resposta com texto',
  '9': 'Colunas',
  '10': 'CID-10',
  '11': 'Alfanumérico',
  '12': 'Seleção múltipla',
  '13': 'Resposta sem texto',
  '14': 'Procedimento',
  '15': 'Data parcial',
  '16': 'Alfanumérico com pesquisa',
  '17': 'Telefone',
  '18': 'Múltiplos CID-10',
  '19': 'Alergias',
  '20': 'CPF',
  '21': 'Lista de diagnósticos',
  '22': 'Lista de problemas',
  '23': 'Alergias (CBARA)',
  '24': 'Lista de medicamentos',
};

export interface LinhaResposta {
  readonly ordem: string;
  readonly seq: number;
  readonly idResposta: number | null;
  /** AAAA-MM-DD (a sentinela chega como veio e vira vazio aqui). */
  readonly data: string | null;
  readonly hora: string | null;
  readonly indice: string | null;
  readonly valor: number | null;
  readonly alfa: string | null;
  /** Texto livre do campo (RTF ou texto), já decodificado pelo adaptador. */
  readonly texto: string | null;
  readonly unidade: string | null;
  /** CID do retrato (código e nome), quando a resposta aponta um. */
  readonly cid: string | null;
  readonly procedimento: string | null;
  readonly observacao: string | null;
  readonly autopreenchido: boolean;
}

export interface VinculoDefinicao {
  readonly ordem: string;
  /** Pergunta do vínculo: a mesma ORDEM pode ter vínculos de perguntas diferentes (um ativo e outro inativo). */
  readonly idPergunta?: number | null;
  readonly tipo: string | null;
  readonly titulo: string | null;
  readonly ativo: boolean;
  readonly unidade: string | null;
}

export interface RespostaCadastrada {
  readonly id: number;
  /** A pergunta da resposta cadastrada: identifica o vínculo quando a ORDEM se repete no modelo. */
  readonly idPergunta?: number | null;
  readonly ordem: number;
  readonly descricao: string | null;
}

export interface EntradaRespostas {
  readonly linhas: readonly LinhaResposta[];
  /** Vínculos do modelo por ORDEM (o primeiro ativo vence; inativo só quando não há ativo). */
  readonly vinculos: readonly VinculoDefinicao[];
  /** Respostas cadastradas das perguntas do modelo, por ID da resposta. */
  readonly respostas: ReadonlyMap<number, RespostaCadastrada>;
  readonly representacao: RepresentacaoFormulario | null;
}

const vazio = (s: string | null | undefined): boolean => s === null || s === undefined || s.trim() === '';

/** Número do legado em pt-BR (até 3 casas, sem zeros à direita). */
export function numeroBr(v: number): string {
  return v.toLocaleString('pt-BR', { maximumFractionDigits: 3, useGrouping: false });
}

/** Índice do item da representação pela ORDEM do vínculo (os itens de mesma ordem: o primeiro mapeado). */
function itensPorOrdem(rep: RepresentacaoFormulario | null): Map<string, ItemFormulario> {
  const m = new Map<string, ItemFormulario>();
  const visitar = (itens: readonly ItemFormulario[]) => {
    for (const it of itens) {
      const o = it['x-legacy'].ordem;
      const atual = m.get(o);
      if (!atual || (atual.tipo === 'sem-componente' && it.tipo !== 'sem-componente')) m.set(o, it);
      visitar(it.itens);
    }
  };
  if (rep) visitar(rep.itens);
  return m;
}

interface Resolucao {
  readonly valores: string[];
  readonly aConfirmar: string | null;
}

function textoLivre(t: string | null): string {
  if (vazio(t)) return '';
  const s = t as string;
  return pareceRtf(s) ? textoCorrido(rtfParaTexto(s)) : s.trim();
}

function escolha(
  l: LinhaResposta,
  item: ItemFormulario | undefined,
  respostas: ReadonlyMap<number, RespostaCadastrada>,
  tipo: string | null,
): Resolucao {
  const opcoes = item?.opcoes ?? [];
  // Sim/Não: o ID da resposta é o da pergunta (o mesmo nos dois casos); quem decide é o índice (conferência
  // cruzada na cópia, 2026-10-21: pelo ID, todo "Sim" saía "Não").
  if (l.idResposta !== null && tipo !== '4') {
    const op = opcoes.find((o) => o.idResposta === l.idResposta);
    if (op) return { valores: [op.texto], aConfirmar: null };
  }
  const idx = vazio(l.indice) ? null : Number(l.indice);
  if (idx !== null && Number.isInteger(idx)) {
    if (tipo === '4') {
      // Sim/Não: o índice 1 é "Não" e o 2 é "Sim" (conferido pelo rótulo de cada pergunta no M09).
      const op = opcoes.find((o) => o.indice === idx);
      if (op) return { valores: [op.texto], aConfirmar: null };
      if (idx === 1) return { valores: ['Não'], aConfirmar: null };
      if (idx === 2) return { valores: ['Sim'], aConfirmar: null };
    }
    const op = opcoes.find((o) => o.indice === idx);
    if (op) return { valores: [op.texto], aConfirmar: null };
  }
  if (l.idResposta !== null) {
    const r = respostas.get(l.idResposta);
    if (r && !vazio(r.descricao)) return { valores: [(r.descricao as string).trim()], aConfirmar: null };
  }
  if (!vazio(l.alfa)) return { valores: [(l.alfa as string).trim()], aConfirmar: null };
  if (idx !== null) return { valores: [`opção ${idx}`], aConfirmar: 'índice da escolha sem rótulo na lista' };
  return { valores: [], aConfirmar: null };
}

function comUnidade(v: string, l: LinhaResposta, def: VinculoDefinicao | undefined): string {
  const u = (l.unidade ?? def?.unidade ?? '').trim();
  return u && v ? `${v} ${u}` : v;
}

/** Primeiro valor preenchido, na ordem das colunas (o tipo sem coluna conhecida). */
function generico(l: LinhaResposta): string {
  if (!vazio(l.alfa)) return (l.alfa as string).trim();
  const t = textoLivre(l.texto);
  if (t) return t;
  if (l.valor !== null) return numeroBr(l.valor);
  const d = apresentarData(l.data);
  if (d) return d;
  return apresentarHora(l.hora);
}

function resolverLinha(
  l: LinhaResposta,
  tipo: string | null,
  def: VinculoDefinicao | undefined,
  item: ItemFormulario | undefined,
  respostas: ReadonlyMap<number, RespostaCadastrada>,
): Resolucao {
  switch (tipo) {
    case '2': {
      const d = apresentarData(l.data);
      return { valores: d ? [d] : vazio(l.hora) ? [] : [apresentarHora(l.hora)], aConfirmar: null };
    }
    case '3':
      return { valores: vazio(l.hora) ? [] : [apresentarHora(l.hora)], aConfirmar: null };
    case '4':
    case '13':
    case '12':
      return escolha(l, item, respostas, tipo);
    case '8': {
      // Resposta com texto: o texto digitado é o que o formulário mostra; sem ele, a opção escolhida.
      const extra = textoLivre(l.texto);
      return extra ? { valores: [extra], aConfirmar: null } : escolha(l, item, respostas, tipo);
    }
    case '5': {
      const t = textoLivre(l.texto) || (l.alfa ?? '').trim();
      return { valores: t ? [t] : [], aConfirmar: null };
    }
    case '6':
    case '7': {
      if (l.valor !== null) return { valores: [comUnidade(numeroBr(l.valor), l, def)], aConfirmar: null };
      return {
        valores: vazio(l.alfa) ? [] : [comUnidade((l.alfa as string).trim(), l, def)],
        aConfirmar: null,
      };
    }
    case '10':
    case '18': {
      const v = l.cid ?? (vazio(l.alfa) ? null : (l.alfa as string).trim());
      return { valores: v ? [v] : [], aConfirmar: null };
    }
    case '14': {
      const v = l.procedimento ?? (vazio(l.alfa) ? null : (l.alfa as string).trim());
      return { valores: v ? [v] : [], aConfirmar: null };
    }
    case '11':
    case '15':
    case '16':
    case '17':
    case '20':
      return {
        valores: vazio(l.alfa) ? [] : [comUnidade((l.alfa as string).trim(), l, def)],
        aConfirmar: null,
      };
    case '1':
      return { valores: vazio(l.alfa) ? [] : [(l.alfa as string).trim()], aConfirmar: null };
    default: {
      const v = generico(l);
      return {
        valores: v ? [v] : [],
        aConfirmar: v ? 'tipo de pergunta sem coluna conhecida: lido pelo primeiro valor preenchido' : null,
      };
    }
  }
}

/** Grade (tipo 9): uma linha por SEQ; a coluna é a resposta cadastrada (ID da resposta). */
function grade(
  todas: readonly LinhaResposta[],
  item: ItemFormulario | undefined,
  respostas: ReadonlyMap<number, RespostaCadastrada>,
): ItemResposta['grade'] {
  let linhas = todas;
  const colunasIds: number[] = [];
  // M22: a linha da própria pergunta da grade (todas as colunas vazias) não é coluna.
  const cheia = (l: LinhaResposta) =>
    l.data !== null ||
    !vazio(l.hora) ||
    l.valor !== null ||
    !vazio(l.alfa) ||
    !vazio(l.texto) ||
    !vazio(l.indice);
  linhas = linhas.filter(cheia);
  for (const l of linhas)
    if (l.idResposta !== null && !colunasIds.includes(l.idResposta)) colunasIds.push(l.idResposta);
  colunasIds.sort((a, b) => (respostas.get(a)?.ordem ?? 0) - (respostas.get(b)?.ordem ?? 0) || a - b);
  const rotuloColuna = (id: number) =>
    item?.opcoes?.find((o) => o.idResposta === id)?.texto ??
    respostas.get(id)?.descricao?.trim() ??
    `coluna ${id}`;
  const seqs = [...new Set(linhas.map((l) => l.seq))].sort((a, b) => a - b);
  return {
    colunas: colunasIds.map(rotuloColuna),
    linhas: seqs.map((s) =>
      colunasIds.map((id) => {
        const l = linhas.find((x) => x.seq === s && x.idResposta === id);
        return l ? generico(l) : '';
      }),
    ),
  };
}

interface NoMutavel {
  ordem: string;
  titulo: string;
  tipo: string;
  valores: string[];
  grade: ItemResposta['grade'];
  autopreenchido: boolean;
  aConfirmar: string | null;
  itens: NoMutavel[];
}

/** Monta a árvore das respostas do registro (só as perguntas respondidas e os títulos acima delas). */
export function lerRespostas(e: EntradaRespostas): Omit<Respostas, 'representacao'> {
  const porOrdemItem = itensPorOrdem(e.representacao);
  const porChaveItem = new Map<string, ItemFormulario>();
  const visitar = (itens: readonly ItemFormulario[]) => {
    for (const it of itens) {
      const k = `${it['x-legacy'].ordem}|${it['x-legacy'].pergunta}`;
      if (!porChaveItem.has(k) || porChaveItem.get(k)!.tipo === 'sem-componente') porChaveItem.set(k, it);
      visitar(it.itens);
    }
  };
  if (e.representacao) visitar(e.representacao.itens);
  const vinculos = new Map<string, VinculoDefinicao>();
  const porChaveVinculo = new Map<string, VinculoDefinicao>();
  for (const v of e.vinculos) {
    const atual = vinculos.get(v.ordem);
    if (!atual || (!atual.ativo && v.ativo)) vinculos.set(v.ordem, v);
    if (v.idPergunta !== undefined && v.idPergunta !== null)
      porChaveVinculo.set(`${v.ordem}|${v.idPergunta}`, v);
  }
  // A pergunta de cada linha pelo ID da resposta (a ORDEM sozinha não separa os vínculos repetidos).
  const grupos = new Map<string, { ordem: string; pergunta: number | null; linhas: LinhaResposta[] }>();
  for (const l of e.linhas) {
    const ordem = l.ordem.trim();
    const pergunta = (l.idResposta !== null ? e.respostas.get(l.idResposta)?.idPergunta : null) ?? null;
    const k = `${ordem}|${pergunta ?? ''}`;
    const g = grupos.get(k) ?? { ordem, pergunta, linhas: [] };
    g.linhas.push(l);
    grupos.set(k, g);
  }
  const nos = new Map<string, NoMutavel>();
  const principal = new Map<string, string>();
  const tituloDe = (ordem: string, pergunta: number | null) => {
    const k = `${ordem}|${pergunta ?? ''}`;
    const it = (pergunta !== null ? porChaveItem.get(k) : undefined) ?? porOrdemItem.get(ordem);
    const def = (pergunta !== null ? porChaveVinculo.get(k) : undefined) ?? vinculos.get(ordem);
    return (it && it.texto.trim()) || def?.titulo?.trim() || `Pergunta ${ordem}`;
  };
  let total = 0;
  let aConfirmar = 0;
  for (const [chave, g] of [...grupos.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    const { ordem, pergunta, linhas } = g;
    const kp = `${ordem}|${pergunta ?? ''}`;
    const def = (pergunta !== null ? porChaveVinculo.get(kp) : undefined) ?? vinculos.get(ordem);
    const item = (pergunta !== null ? porChaveItem.get(kp) : undefined) ?? porOrdemItem.get(ordem);
    const tipo = def?.tipo?.trim() ?? item?.['x-legacy'].tipo ?? null;
    const valores: string[] = [];
    const vistos = new Set<string>();
    const juntar = (v: string) => {
      const n = v.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
      if (v && !vistos.has(n)) {
        vistos.add(n);
        valores.push(v);
      }
    };
    let nota: string | null = null;
    let tabela: ItemResposta['grade'] = null;
    if (tipo === '9') tabela = grade(linhas, item, e.respostas);
    else {
      for (const l of [...linhas].sort((a, b) => a.seq - b.seq)) {
        const r = resolverLinha(l, tipo, def, item, e.respostas);
        for (const v of r.valores) juntar(v);
        nota ??= r.aConfirmar;
        if (!vazio(l.observacao)) juntar(`Observação: ${(l.observacao as string).trim()}`);
      }
    }
    if (!def) nota = 'pergunta sem vínculo no modelo';
    else if (!def.ativo) nota ??= 'vínculo inativo no modelo';
    const temGrade = tabela !== null && tabela.linhas.length > 0;
    if (valores.length === 0 && !temGrade) {
      // Pergunta sem valor: só o título (tipo 1) fica, como cabeçalho de seção.
      if (tipo !== '1') continue;
      nota = null;
    } else {
      total++;
      if (nota) aConfirmar++;
    }
    nos.set(chave, {
      ordem,
      titulo: tituloDe(ordem, pergunta),
      tipo: TIPOS_PERGUNTA[tipo ?? ''] ?? 'Desconhecido',
      valores,
      grade: tabela,
      autopreenchido: linhas.some((l) => l.autopreenchido),
      aConfirmar: nota,
      itens: [],
    });
    if (!principal.has(ordem)) principal.set(ordem, chave);
  }
  // Títulos acima das respostas (2 dígitos por nível) e a árvore.
  const garantir = (ordem: string): NoMutavel => {
    const k = principal.get(ordem);
    if (k) return nos.get(k)!;
    const no: NoMutavel = {
      ordem,
      titulo: tituloDe(ordem, null),
      tipo: 'Título',
      valores: [],
      grade: null,
      autopreenchido: false,
      aConfirmar: null,
      itens: [],
    };
    const chave = `${ordem}|#`;
    nos.set(chave, no);
    principal.set(ordem, chave);
    return no;
  };
  const ehRaiz = (ordem: string) => ordem.length <= 2 || ordem.length % 2 !== 0;
  const ligados = new Set<NoMutavel>();
  const ligar = (no: NoMutavel) => {
    if (ehRaiz(no.ordem) || ligados.has(no)) return;
    ligados.add(no);
    const pai = garantir(no.ordem.slice(0, -2));
    if (!pai.itens.includes(no)) pai.itens.push(no);
    ligar(pai);
  };
  for (const no of [...nos.values()]) ligar(no);
  const raizes = [...nos.values()].filter((n) => ehRaiz(n.ordem));
  const ordenar = (l: NoMutavel[]) => {
    l.sort((a, b) => (a.ordem < b.ordem ? -1 : a.ordem > b.ordem ? 1 : 0));
    for (const x of l) ordenar(x.itens);
  };
  ordenar(raizes);
  return { itens: raizes, total, aConfirmar };
}

/** Lista plana (título e valores) para a conferência cruzada. */
export function respostasPlanas(itens: readonly ItemResposta[]): { titulo: string; valor: string }[] {
  const saida: { titulo: string; valor: string }[] = [];
  const visitar = (l: readonly ItemResposta[]) => {
    for (const i of l) {
      if (i.valores.length > 0) saida.push({ titulo: i.titulo, valor: i.valores.join('; ') });
      if (i.grade)
        saida.push({
          titulo: i.titulo,
          valor: [i.grade.colunas.join(' '), ...i.grade.linhas.map((x) => x.join(' '))].join('; '),
        });
      visitar(i.itens);
    }
  };
  visitar(itens);
  return saida;
}

/** Vínculos e respostas cadastradas a partir da definição do modelo (a mesma entrada do parser DFM do M09). */
export function definicaoParaLeitura(
  d: Pick<EntradaModelo, 'vinculos' | 'perguntas' | 'respostas' | 'colunasGrade'>,
): {
  vinculos: VinculoDefinicao[];
  respostas: Map<number, RespostaCadastrada>;
} {
  const perguntas = new Map(d.perguntas.map((p) => [p.id, p]));
  return {
    vinculos: d.vinculos.map((v) => {
      const p = perguntas.get(v.idPergunta);
      return {
        ordem: v.ordem,
        idPergunta: v.idPergunta,
        tipo: p?.tipo?.trim() ?? null,
        titulo: p?.descricao?.trim() ?? null,
        ativo: (v.ativo ?? 'T').trim().toUpperCase() !== 'F',
        unidade: p?.unidade?.trim() || null,
      };
    }),
    respostas: new Map([
      ...d.respostas.map(
        (r) =>
          [r.id, { id: r.id, idPergunta: r.idPergunta, ordem: r.ordem, descricao: r.descricao }] as const,
      ),
      // M22: as colunas da grade contam como respostas da pergunta da grade (o título da coluna é o rótulo).
      ...(d.colunasGrade ?? [])
        .filter((c) => c.idResposta !== null)
        .map(
          (c) =>
            [
              c.idResposta as number,
              {
                id: c.idResposta as number,
                idPergunta: c.idPerguntaGrade,
                ordem: c.coluna,
                descricao: c.descricao,
              },
            ] as const,
        ),
    ]),
  };
}

/** Vínculos e respostas a partir da representação gravada (x-legacy e opções resolvidas). */
export function representacaoParaLeitura(r: RepresentacaoFormulario): {
  vinculos: VinculoDefinicao[];
  respostas: Map<number, RespostaCadastrada>;
} {
  const vinculos: VinculoDefinicao[] = [];
  const respostas = new Map<number, RespostaCadastrada>();
  const visitar = (itens: readonly ItemFormulario[]) => {
    for (const it of itens) {
      const x = it['x-legacy'];
      vinculos.push({
        ordem: x.ordem,
        idPergunta: x.pergunta,
        tipo: x.tipo,
        titulo: it.texto,
        ativo: it.ativo,
        unidade: it.unidade,
      });
      for (const o of it.opcoes ?? [])
        if (o.idResposta !== null)
          respostas.set(o.idResposta, {
            id: o.idResposta,
            idPergunta: x.pergunta,
            ordem: o.indice,
            descricao: o.texto,
          });
      // M22: a resposta da própria pergunta (texto, número, data…) e as colunas da grade (na pergunta da grade,
      // na ordem da coluna, com o título dela): a linha acha o vínculo certo quando a ORDEM se repete.
      if (x.idResposta !== null && !respostas.has(x.idResposta))
        respostas.set(x.idResposta, { id: x.idResposta, idPergunta: x.pergunta, ordem: 0, descricao: null });
      for (const c of it.colunasGrade ?? [])
        if (c.idResposta !== null)
          respostas.set(c.idResposta, {
            id: c.idResposta,
            idPergunta: x.pergunta,
            ordem: c.coluna,
            descricao: c.titulo,
          });
      visitar(it.itens);
    }
  };
  visitar(r.itens);
  return { vinculos, respostas };
}
