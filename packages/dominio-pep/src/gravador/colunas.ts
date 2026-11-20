// Gravador das respostas no formato do formulário de origem (regras 1 a 4 e 7 da ficha do M22; cap-11 §11.1,
// tabela das 13 classes): o tipo da pergunta decide a coluna. Medido na cópia `pc` (últimos 3.000 registros,
// 2026-10-21; só contagens e padrões mascarados): uma linha por pergunta respondida e uma por título de seção
// que tem resposta embaixo (todas as colunas vazias); UNIDRESP nunca nulo (texto em branco sem unidade);
// AUTOPREENCHIDO sempre T ou F; RESPSNAO é o índice da lista do formulário (99% das linhas: o índice resolvido
// pelo parser do M09); escolha grava o ID da resposta escolhida e o texto em RESPALFA; seleção múltipla grava UMA
// LINHA POR ITEM MARCADO (mesma ordem, SEQ 0), com o texto formatado da lista inteira em CONTEVOL; resposta com
// texto grava índice, texto da opção e o texto formatado (o digitado, ou a opção); Sim/Não grava o ID da resposta
// da pergunta e, havendo complemento, uma segunda linha (SEQ 1) com o texto; data em RESPDATA; hora em RESPHORA
// (HHMM); número em RESPVALOR; grade = uma linha da pergunta da grade (vazia) e uma por célula preenchida, na
// resposta da coluna, com SEQ = linha da grade. O adaptador converte cada valor para a coluna (codec CP1252,
// sentinela, carimbo) e resolve o CID pelo retrato do catálogo.
import type { Paragrafo, RespostaRegistro, ValorResposta } from '@sgh/contratos';
import type { ItemFormulario, RepresentacaoFormulario } from '../formulario/dfm/mapeamento.js';
import { paragrafosDoTexto, rtfDoCampo } from './rtf.js';

export interface LinhaGravada {
  readonly ordem: string;
  readonly seq: number;
  readonly idResposta: number;
  /** AAAA-MM-DD. */
  readonly data: string | null;
  /** HHMM. */
  readonly hora: string | null;
  readonly indice: string | null;
  readonly valor: number | null;
  readonly alfa: string | null;
  /** Texto formatado (RTF) da resposta. */
  readonly texto: string | null;
  /** Unidade (texto em branco quando a pergunta não tem). */
  readonly unidade: string;
  /** CID-10 (código com ponto) a resolver pelo retrato do catálogo. */
  readonly cid: string | null;
  readonly autopreenchido: boolean;
}

export type CodigoRecusaGravacao =
  | 'vinculo-inexistente'
  | 'vinculo-inativo'
  | 'tipo-incompativel'
  | 'opcao-inexistente'
  | 'tipo-nao-gravado'
  | 'pergunta-ambigua'
  | 'sem-resposta-cadastrada'
  | 'texto-longo'
  | 'pre-preenchido-sem-confirmacao'
  | 'resposta-repetida';

export class ErroGravacao extends Error {
  override readonly name = 'ErroGravacao';
  readonly codigo: CodigoRecusaGravacao;
  readonly vinculo: number | null;
  constructor(codigo: CodigoRecusaGravacao, mensagem: string, vinculo: number | null = null) {
    super(mensagem);
    this.codigo = codigo;
    this.vinculo = vinculo;
  }
}

export interface ItemComCaminho {
  readonly item: ItemFormulario;
  /** Ancestrais (do mais alto ao pai). */
  readonly ancestrais: readonly ItemFormulario[];
}

/** Índice dos itens da representação pelo vínculo (o mesmo vínculo não se repete). */
export function itensPorVinculo(rep: Pick<RepresentacaoFormulario, 'itens'>): Map<number, ItemComCaminho> {
  const m = new Map<number, ItemComCaminho>();
  const visitar = (itens: readonly ItemFormulario[], anc: readonly ItemFormulario[]) => {
    for (const i of itens) {
      m.set(i['x-legacy'].vinculo, { item: i, ancestrais: anc });
      visitar(i.itens, [...anc, i]);
    }
  };
  visitar(rep.itens, []);
  return m;
}

/** Os tipos de pergunta que o gravador sabe gravar (os demais ficam no outro sistema: alergias, CID múltiplo…). */
export const TIPOS_GRAVADOS: ReadonlySet<string> = new Set([
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  '11',
  '12',
  '13',
  '15',
  '16',
  '17',
  '20',
]);

/** Pergunta de escolha sem lista resolvida (DP-28): fica fora do modelo liberado. */
export function perguntaAmbigua(item: ItemFormulario): boolean {
  const t = item['x-legacy'].tipo;
  return (t === '4' || t === '8' || t === '12' || t === '13') && (item.opcoes?.length ?? 0) === 0;
}

/**
 * A pergunta pode ser gravada? Tipo gravado, lista resolvida e as respostas cadastradas que as linhas exigem
 * (a da pergunta, a de cada opção ou de cada coluna da grade). A que não pode fica "a confirmar" na tela.
 */
export function podeGravar(item: ItemFormulario): boolean {
  const x = item['x-legacy'];
  const t = x.tipo ?? '';
  if (t === '1' || !TIPOS_GRAVADOS.has(t) || perguntaAmbigua(item)) return false;
  const id = (n: number | null | undefined) => n !== null && n !== undefined && n > 0;
  if (t === '13' || t === '8' || t === '12') return (item.opcoes ?? []).every((o) => id(o.idResposta));
  if (t === '4') return id(x.idResposta) || (item.opcoes ?? []).every((o) => id(o.idResposta));
  if (t === '9')
    return (
      id(x.idResposta) &&
      (item.colunasGrade ?? []).length > 0 &&
      (item.colunasGrade ?? []).every((c) => id(c.idResposta))
    );
  return id(x.idResposta);
}

const unidade = (i: ItemFormulario) => (i.unidade ?? '').trim();
/** O formulário mostra o valor com a unidade (medido: 202 de 202 campos com unidade na cópia). */
const comUnidade = (v: string, i: ItemFormulario) => (unidade(i) ? `${v} ${unidade(i)}` : v);

function exigir(cond: unknown, codigo: CodigoRecusaGravacao, msg: string, vinculo: number): asserts cond {
  if (!cond) throw new ErroGravacao(codigo, msg, vinculo);
}

/** Número como o formulário mostra (pt-BR, até 3 casas, sem separador de milhar). */
export function numeroFormulario(v: number): string {
  return v.toLocaleString('pt-BR', { maximumFractionDigits: 3, useGrouping: false });
}

/** "HH:MM" → "HHMM". */
export function horaLegado(hora: string): string {
  return hora.replace(':', '');
}

/** Parágrafos do valor de texto (formatado ou digitado). */
export function paragrafosDoValor(v: ValorResposta): Paragrafo[] {
  if (v.tipo === 'formatado') return [...v.paragrafos];
  if (v.tipo === 'texto') return paragrafosDoTexto(v.texto);
  return [];
}

function textoDosParagrafos(ps: readonly Paragrafo[]): string {
  return ps.map((p) => p.trechos.map((t) => t.texto).join('')).join('\n');
}

/** O que o formulário mostra para a resposta (valor do componente no formulário gravado e no texto do registro). */
export interface Apresentacao {
  /** Valor em uma linha (escolha simples, número, data, hora). */
  readonly linha: string | null;
  /** Valor em parágrafos (texto, lista marcada, grade). */
  readonly paragrafos: readonly Paragrafo[] | null;
  /** Itens marcados da lista (documento emitido: value_texto/Item0..n). */
  readonly itens: readonly string[] | null;
}

function opcao(item: ItemFormulario, indice: number) {
  return item.opcoes?.find((o) => o.indice === indice) ?? null;
}

export interface ResultadoGravador {
  readonly linhas: LinhaGravada[];
  /** Vínculos respondidos (na ordem da árvore), com a apresentação de cada um. */
  readonly respondidos: Map<number, Apresentacao>;
  /** Seções com resposta embaixo (gravadas como título). */
  readonly secoes: Set<number>;
}

function linha(
  base: Pick<LinhaGravada, 'ordem' | 'seq' | 'idResposta'> & Partial<LinhaGravada>,
): LinhaGravada {
  return {
    data: null,
    hora: null,
    indice: null,
    valor: null,
    alfa: null,
    texto: null,
    unidade: '',
    cid: null,
    autopreenchido: false,
    ...base,
  };
}

/** Linhas e apresentação de UMA resposta. */
function gravarResposta(
  item: ItemFormulario,
  r: RespostaRegistro,
): { linhas: LinhaGravada[]; ap: Apresentacao } {
  const x = item['x-legacy'];
  const tipo = x.tipo ?? '';
  const v = r.valor;
  const vinc = x.vinculo;
  const ordem = x.ordem;
  const auto = r.autopreenchido;
  const idPergunta = x.idResposta;
  const incompativel = () =>
    new ErroGravacao('tipo-incompativel', `Valor do tipo ${v.tipo} não cabe nesta pergunta.`, vinc);
  exigir(
    TIPOS_GRAVADOS.has(tipo),
    'tipo-nao-gravado',
    'Este tipo de pergunta ainda não é gravado aqui.',
    vinc,
  );
  exigir(
    !perguntaAmbigua(item),
    'pergunta-ambigua',
    'Pergunta com lista de escolhas a confirmar (DP-28).',
    vinc,
  );
  const comId = (id: number | null | undefined): number => {
    exigir(
      id !== null && id !== undefined && id > 0,
      'sem-resposta-cadastrada',
      'Pergunta sem resposta cadastrada.',
      vinc,
    );
    return id;
  };
  const max = item.tamanhoMaximo;
  const conferirTamanho = (s: string) =>
    exigir(max === null || s.length <= max, 'texto-longo', `Máximo de ${max} caracteres.`, vinc);
  switch (tipo) {
    case '1':
      throw new ErroGravacao('tipo-incompativel', 'Título de seção não tem resposta.', vinc);
    case '5': {
      if (v.tipo !== 'formatado' && v.tipo !== 'texto') throw incompativel();
      const ps = paragrafosDoValor(v);
      return {
        linhas: [
          linha({
            ordem,
            seq: 0,
            idResposta: comId(idPergunta),
            texto: rtfDoCampo(ps),
            autopreenchido: auto,
          }),
        ],
        ap: { linha: null, paragrafos: ps, itens: textoDosParagrafos(ps).split('\n') },
      };
    }
    case '2': {
      if (v.tipo !== 'data') throw incompativel();
      const [a, m, d] = v.data.split('-');
      return {
        linhas: [linha({ ordem, seq: 0, idResposta: comId(idPergunta), data: v.data, autopreenchido: auto })],
        ap: { linha: `${d}/${m}/${a}`, paragrafos: null, itens: null },
      };
    }
    case '3': {
      if (v.tipo !== 'hora') throw incompativel();
      return {
        linhas: [
          linha({
            ordem,
            seq: 0,
            idResposta: comId(idPergunta),
            hora: horaLegado(v.hora),
            autopreenchido: auto,
          }),
        ],
        ap: { linha: v.hora, paragrafos: null, itens: null },
      };
    }
    case '6':
    case '7': {
      if (v.tipo !== 'numero') throw incompativel();
      exigir(tipo === '6' || Number.isInteger(v.valor), 'tipo-incompativel', 'Valor inteiro.', vinc);
      return {
        linhas: [
          linha({
            ordem,
            seq: 0,
            idResposta: comId(idPergunta),
            valor: v.valor,
            unidade: unidade(item),
            autopreenchido: auto,
          }),
        ],
        ap: { linha: comUnidade(numeroFormulario(v.valor), item), paragrafos: null, itens: null },
      };
    }
    case '11':
    case '15':
    case '16':
    case '17':
    case '20': {
      if (v.tipo !== 'texto') throw incompativel();
      const t = v.texto.trim();
      conferirTamanho(t);
      return {
        linhas: [
          linha({
            ordem,
            seq: 0,
            idResposta: comId(idPergunta),
            alfa: t,
            unidade: unidade(item),
            autopreenchido: auto,
          }),
        ],
        ap: { linha: comUnidade(t, item), paragrafos: null, itens: null },
      };
    }
    case '4':
    case '13': {
      if (v.tipo !== 'escolha') throw incompativel();
      const o = opcao(item, v.indice);
      exigir(o, 'opcao-inexistente', 'Opção fora da lista desta pergunta.', vinc);
      const id = tipo === '4' ? comId(o.idResposta ?? idPergunta) : comId(o.idResposta);
      const l = [
        linha({
          ordem,
          seq: 0,
          idResposta: id,
          indice: String(o.indice),
          alfa: o.texto,
          autopreenchido: auto,
        }),
      ];
      const comp = v.complemento?.trim();
      if (comp) {
        conferirTamanho(comp);
        l.push(linha({ ordem, seq: 1, idResposta: id, alfa: comp, autopreenchido: auto }));
      }
      return {
        linhas: l,
        ap: { linha: comp ? `${o.texto} - ${comp}` : o.texto, paragrafos: null, itens: null },
      };
    }
    case '8': {
      if (v.tipo !== 'escolha') throw incompativel();
      const o = opcao(item, v.indice);
      exigir(o, 'opcao-inexistente', 'Opção fora da lista desta pergunta.', vinc);
      const comp = v.complemento?.trim();
      const ps = paragrafosDoTexto(comp || o.texto);
      return {
        linhas: [
          linha({
            ordem,
            seq: 0,
            idResposta: comId(o.idResposta),
            indice: String(o.indice),
            alfa: o.texto,
            texto: rtfDoCampo(ps),
            autopreenchido: auto,
          }),
        ],
        ap: { linha: null, paragrafos: ps, itens: [comp || o.texto] },
      };
    }
    case '12': {
      if (v.tipo !== 'multipla') throw incompativel();
      const marcadas = [...new Set(v.indices)]
        .sort((a, b) => a - b)
        .map((i) => {
          const o = opcao(item, i);
          exigir(o, 'opcao-inexistente', 'Opção fora da lista desta pergunta.', vinc);
          return o;
        });
      exigir(marcadas.length > 0, 'tipo-incompativel', 'Marque ao menos uma opção.', vinc);
      const ps = paragrafosDoTexto(marcadas.map((o) => o.texto).join('\n'));
      const rtf = rtfDoCampo(ps);
      return {
        linhas: marcadas.map((o) =>
          linha({
            ordem,
            seq: 0,
            idResposta: comId(o.idResposta),
            indice: String(o.indice),
            alfa: o.texto,
            texto: rtf,
            autopreenchido: auto,
          }),
        ),
        ap: { linha: null, paragrafos: ps, itens: marcadas.map((o) => o.texto) },
      };
    }
    case '9': {
      if (v.tipo !== 'grade') throw incompativel();
      const cols = item.colunasGrade ?? [];
      exigir(cols.length > 0, 'sem-resposta-cadastrada', 'Grade sem colunas cadastradas.', vinc);
      const l: LinhaGravada[] = [linha({ ordem, seq: 0, idResposta: comId(idPergunta) })];
      const linhasVisiveis: string[] = [cols.map((c) => c.titulo).join('\t')];
      v.linhas.forEach((cells, seq) => {
        const vis: string[] = [];
        cols.forEach((c, k) => {
          const cel = cells[k]?.trim() ?? '';
          vis.push(cel);
          if (!cel) return;
          const id = comId(c.idResposta);
          if (c.tipo === '2' || c.tipo === '3') {
            exigir(
              /^([01]\d|2[0-3]):[0-5]\d$/.test(cel),
              'tipo-incompativel',
              `Hora inválida em ${c.titulo}.`,
              vinc,
            );
            l.push(linha({ ordem, seq, idResposta: id, hora: horaLegado(cel) }));
          } else if (c.tipo === '5' || c.tipo === '6' || c.tipo === '7') {
            const n = Number(cel.replace(',', '.'));
            exigir(Number.isFinite(n), 'tipo-incompativel', `Número inválido em ${c.titulo}.`, vinc);
            l.push(linha({ ordem, seq, idResposta: id, valor: n }));
          } else l.push(linha({ ordem, seq, idResposta: id, alfa: cel }));
        });
        linhasVisiveis.push(vis.join('\t'));
      });
      return {
        linhas: l,
        ap: { linha: null, paragrafos: paragrafosDoTexto(linhasVisiveis.join('\n')), itens: linhasVisiveis },
      };
    }
    case '10': {
      if (v.tipo !== 'cid' || v.codigos.length !== 1) throw incompativel();
      const cid = v.codigos[0]!;
      return {
        linhas: [linha({ ordem, seq: 0, idResposta: comId(idPergunta), cid, autopreenchido: auto })],
        ap: { linha: cid, paragrafos: null, itens: null },
      };
    }
    default:
      throw new ErroGravacao('tipo-nao-gravado', 'Este tipo de pergunta ainda não é gravado aqui.', vinc);
  }
}

/** Valor vazio (não grava linha): texto em branco, lista sem marca, grade sem célula. */
export function valorVazio(v: ValorResposta): boolean {
  switch (v.tipo) {
    case 'texto':
      return v.texto.trim() === '';
    case 'formatado':
      return v.paragrafos.every((p) => p.trechos.every((t) => t.texto.trim() === ''));
    case 'multipla':
      return v.indices.length === 0;
    case 'grade':
      return v.linhas.every((l) => l.every((c) => !c || c.trim() === ''));
    default:
      return false;
  }
}

/**
 * Respostas → linhas do formulário de origem, na ordem da árvore. Regra 4: pergunta de vínculo inativo não é
 * gravada (recusa). Regra 7: valor pré-preenchido só grava confirmado (`exigirConfirmacao`, na finalização).
 */
export function linhasDasRespostas(
  rep: Pick<RepresentacaoFormulario, 'itens'>,
  respostas: readonly RespostaRegistro[],
  opcoes: { readonly exigirConfirmacao?: boolean } = {},
): ResultadoGravador {
  const indice = itensPorVinculo(rep);
  const porVinculo = new Map<number, RespostaRegistro>();
  for (const r of respostas) {
    if (porVinculo.has(r.vinculo))
      throw new ErroGravacao('resposta-repetida', 'Duas respostas para a mesma pergunta.', r.vinculo);
    const it = indice.get(r.vinculo);
    if (!it) throw new ErroGravacao('vinculo-inexistente', 'Pergunta fora deste modelo.', r.vinculo);
    if (!it.item.ativo || it.ancestrais.some((a) => !a.ativo))
      throw new ErroGravacao('vinculo-inativo', 'Pergunta desligada neste modelo: não é gravada.', r.vinculo);
    if (opcoes.exigirConfirmacao && r.autopreenchido && !r.confirmado)
      throw new ErroGravacao(
        'pre-preenchido-sem-confirmacao',
        'Confirme o valor trazido do registro anterior antes de finalizar.',
        r.vinculo,
      );
    if (valorVazio(r.valor)) continue;
    porVinculo.set(r.vinculo, r);
  }
  const linhas: LinhaGravada[] = [];
  const respondidos = new Map<number, Apresentacao>();
  const secoes = new Set<number>();
  const gravadas = new Map<number, LinhaGravada[]>();
  for (const [vinc, r] of porVinculo) {
    const { item, ancestrais } = indice.get(vinc)!;
    const g = gravarResposta(item, r);
    gravadas.set(vinc, g.linhas);
    respondidos.set(vinc, g.ap);
    for (const a of ancestrais) if (a['x-legacy'].tipo === '1') secoes.add(a['x-legacy'].vinculo);
  }
  // Ordem da árvore: a seção antes dos filhos.
  const visitar = (itens: readonly ItemFormulario[]) => {
    for (const i of itens) {
      const v = i['x-legacy'].vinculo;
      if (secoes.has(v)) {
        const id = i['x-legacy'].idResposta;
        if (id === null || id <= 0)
          throw new ErroGravacao('sem-resposta-cadastrada', 'Seção sem resposta cadastrada.', v);
        linhas.push(linha({ ordem: i['x-legacy'].ordem, seq: 0, idResposta: id }));
      }
      linhas.push(...(gravadas.get(v) ?? []));
      visitar(i.itens);
    }
  };
  visitar(rep.itens);
  return { linhas, respondidos, secoes };
}
