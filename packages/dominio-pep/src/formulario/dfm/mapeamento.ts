// Conversão de um modelo de formulário do legado (PREVOLUCAO + vínculos PRPADEVOL + perguntas + respostas +
// componentes DFM de PRFORMULCOMP) para a representação do novo (inspirada no FHIR Questionnaire; regras 2 a 6
// da ficha do M09; cap-11 §11.1). O legado continua dono da definição: a representação é derivada, guarda a
// impressão digital do layout de origem e em `x-legacy` tudo o que o gravador do M22 precisa para gravar
// como o Delphi grava (pergunta, vínculo, ordem, tipo). Vínculo inativo é preservado como inativo.
import { classeDfm, type TipoItem } from './classes.js';
import {
  type OpcaoResolvida,
  type PendenciaEscolha,
  resolverEscolhas,
  type RespostaLegado,
} from './escolhas.js';
import { classificarExpressao, type ExpressaoInventariada } from './expressoes.js';
import { colunasDaLargura, compararLinkId, linkIdDaOrdem, linkIdPai } from './layout.js';
import { ErroDfm, logicoDe, lerDfm, numeroDe, type ObjetoDfm, textoDe } from './leitor.js';

export const FORMATO_REPRESENTACAO = 'sgh-formulario/1';

export interface ModeloLegado {
  readonly id: number;
  readonly codigo: string | null;
  readonly descricao: string | null;
  readonly fase: number | null;
}

export interface VinculoLegado {
  readonly id: number;
  readonly idPergunta: number;
  readonly ordem: string;
  readonly obrigatorio: string | null;
  readonly ativo: string | null;
}

export interface PerguntaLegado {
  readonly id: number;
  readonly codPergunta: number;
  readonly descricao: string | null;
  readonly tipo: string | null;
  readonly unidade: string | null;
  readonly ativo: string | null;
  readonly manterHist: number | null;
}

export interface ComponenteLegado {
  readonly id: number;
  readonly idVinculo: number;
  readonly classe: string;
  readonly pai: string;
  readonly ordemCriacao: number | null;
  /** Texto DFM já decodificado do CP1252 pelo adaptador. */
  readonly dfm: string;
}

export interface VersaoLayoutLegado {
  readonly versao: number;
  readonly componentes: number;
}

/** M22: coluna de grade (pergunta com o mesmo código da pergunta da grade e COLUNA > 0). */
export interface ColunaGradeLegado {
  /** Pergunta da grade (tipo 9) a que a coluna pertence. */
  readonly idPerguntaGrade: number;
  readonly coluna: number;
  readonly idPergunta: number;
  readonly descricao: string | null;
  readonly tipo: string | null;
  readonly unidade: string | null;
  /** Resposta cadastrada da coluna (vai em cada célula gravada). */
  readonly idResposta: number | null;
}

export interface EntradaModelo {
  readonly modelo: ModeloLegado;
  readonly vinculos: readonly VinculoLegado[];
  readonly perguntas: readonly PerguntaLegado[];
  readonly respostas: readonly (RespostaLegado & { readonly idPergunta: number })[];
  readonly componentes: readonly ComponenteLegado[];
  readonly versoes: readonly VersaoLayoutLegado[];
  /** M22: colunas das grades do modelo (opcional: as representações do M09 não as têm). */
  readonly colunasGrade?: readonly ColunaGradeLegado[];
}

/** M22: coluna da grade na representação (o gravador põe cada célula na resposta da coluna, com SEQ). */
export interface ColunaGradeItem {
  readonly coluna: number;
  readonly pergunta: number;
  readonly idResposta: number | null;
  readonly titulo: string;
  readonly tipo: string | null;
  readonly unidade: string | null;
}

export interface XLegacy {
  readonly vinculo: number;
  readonly pergunta: number;
  readonly codPergunta: number | null;
  readonly ordem: string;
  /** PRPERGUNTA.TIPOPERG original. */
  readonly tipo: string | null;
  readonly classe: string | null;
  readonly componente: string | null;
  readonly componentePai: string | null;
  readonly idResposta: number | null;
  readonly obrigatorio: string | null;
  readonly ativo: string | null;
  /** PRPERGUNTA.MANTERHIST original (DP-28: nada é decidido aqui). */
  readonly manterHist: number | null;
}

export interface ItemFormulario {
  readonly linkId: string;
  readonly tipo: TipoItem | 'nao-mapeado' | 'sem-componente';
  readonly widget: string | null;
  readonly texto: string;
  readonly ativo: boolean;
  readonly obrigatorio: boolean;
  readonly unidade: string | null;
  readonly tamanhoMaximo: number | null;
  readonly layout: {
    readonly colunas: number;
    readonly largura: number | null;
    readonly altura: number | null;
    /** M22: posição no formulário de origem (vai ao XML do formulário gravado com o registro). */
    readonly topo?: number | null;
    readonly esquerda?: number | null;
    /** M22: fonte do vínculo (negrito e tamanho), que o texto formatado do registro reproduz. */
    readonly negrito?: boolean;
    readonly tamanhoFonte?: number | null;
  } | null;
  readonly opcoes?: readonly OpcaoResolvida[];
  readonly expressoes?: readonly ExpressaoInventariada[];
  /** M22: colunas da grade (tipo 9). */
  readonly colunasGrade?: readonly ColunaGradeItem[];
  readonly 'x-legacy': XLegacy;
  readonly itens: readonly ItemFormulario[];
}

export interface PendenciaModelo {
  readonly linkId: string | null;
  readonly tipo:
    'escolha' | 'classe-desconhecida' | 'dfm-invalido' | 'ordem-invalida' | 'tipo-inesperado' | 'pai-ausente';
  readonly detalhe: string;
  readonly indice?: number | null;
  readonly opcao?: string | null;
  readonly sugestaoIdResposta?: number;
}

export interface ResumoModelo {
  readonly vinculos: number;
  readonly vinculosAtivos: number;
  readonly vinculosInativos: number;
  readonly componentes: number;
  readonly componentesMapeados: number;
  readonly classesDesconhecidas: number;
  readonly caracteresSubstituicao: number;
  readonly vinculosSemComponente: number;
  readonly opcoesResolvidas: number;
  readonly escolhasPendentes: number;
  readonly expressoesHabilitar: number;
  readonly expressoesCalcular: number;
  readonly porClasse: Readonly<Record<string, number>>;
}

export interface RepresentacaoFormulario {
  readonly formato: typeof FORMATO_REPRESENTACAO;
  readonly modelo: ModeloLegado;
  /** SHA-256 do layout de origem (componentes ordenados): mudou no Delphi, muda a representação. */
  readonly impressaoLayout: string;
  readonly versoesLayout: readonly VersaoLayoutLegado[];
  readonly resumo: ResumoModelo;
  readonly itens: readonly ItemFormulario[];
  readonly pendencias: readonly PendenciaModelo[];
}

/**
 * Caractere que não veio de um byte CP1252 definido: U+FFFD (troca do decodificador) e os controles C1 que a
 * tabela CP1252 sem perda do adaptador (sghcp1252) usa para os 5 bytes indefinidos 0x81, 0x8D, 0x8F, 0x90 e
 * 0x9D. Só U+FFFD seria 0 por construção; contando os C1, um byte indefinido no DFM aparece no relatório.
 */
export const BYTES_INDEFINIDOS_CP1252 = ['\u0081', '\u008D', '\u008F', '\u0090', '\u009D'] as const;
const SUBSTITUICAO = /[\uFFFD\u0081\u008D\u008F\u0090\u009D]/g;

async function sha256Hex(texto: string): Promise<string> {
  const bytes = new TextEncoder().encode(texto);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Impressão digital do layout de origem: componentes ordenados por ID, com classe, pai, ordem e DFM. */
export function impressaoLayout(componentes: readonly ComponenteLegado[]): Promise<string> {
  const base = [...componentes]
    .sort((a, b) => a.id - b.id)
    .map((c) => [c.id, c.idVinculo, c.classe, c.pai, c.ordemCriacao ?? '', c.dfm].join('\u0001'))
    .join('\u0002');
  return sha256Hex(base);
}

interface ItemMutavel extends Omit<ItemFormulario, 'itens'> {
  itens: ItemMutavel[];
}

function expressoesDo(raiz: ObjetoDfm): ExpressaoInventariada[] {
  const lista: ExpressaoInventariada[] = [];
  const hab = textoDe(raiz.propriedades['ExpressionEnabled']);
  const calc = textoDe(raiz.propriedades['ExpressionValue']);
  if (hab !== undefined) lista.push(classificarExpressao('habilitar', hab));
  if (calc !== undefined) lista.push(classificarExpressao('calcular', calc));
  return lista;
}

function tamanhoMaximo(raiz: ObjetoDfm): number | null {
  const m = numeroDe(raiz.propriedades['MaxLength']);
  return m && m > 0 ? m : null;
}

/** Converte um modelo. Nunca lança por componente ruim: o problema vira pendência no relatório. */
export async function converterModelo(entrada: EntradaModelo): Promise<RepresentacaoFormulario> {
  const pendencias: PendenciaModelo[] = [];
  const perguntas = new Map(entrada.perguntas.map((p) => [p.id, p]));
  const respostasPorPergunta = new Map<number, RespostaLegado[]>();
  for (const r of entrada.respostas) {
    const l = respostasPorPergunta.get(r.idPergunta) ?? [];
    l.push(r);
    respostasPorPergunta.set(r.idPergunta, l);
  }
  const componentePorVinculo = new Map(entrada.componentes.map((c) => [c.idVinculo, c]));
  const porClasse: Record<string, number> = {};
  let mapeados = 0;
  let desconhecidas = 0;
  let substituicoes = 0;
  let opcoesResolvidas = 0;
  let escolhasPendentes = 0;
  let habilitar = 0;
  let calcular = 0;
  const itens: ItemMutavel[] = [];

  for (const c of entrada.componentes) substituicoes += (c.dfm.match(SUBSTITUICAO) ?? []).length;

  for (const v of entrada.vinculos) {
    let linkId: string;
    try {
      linkId = linkIdDaOrdem(v.ordem);
    } catch (e) {
      pendencias.push({
        linkId: null,
        tipo: 'ordem-invalida',
        detalhe: `vínculo ${v.id}: ${(e as Error).message}`,
      });
      continue;
    }
    const pergunta = perguntas.get(v.idPergunta);
    const comp = componentePorVinculo.get(v.id);
    const ativo = (v.ativo ?? 'T').trim().toUpperCase() !== 'F';
    const xLegacy: XLegacy = {
      vinculo: v.id,
      pergunta: v.idPergunta,
      codPergunta: pergunta?.codPergunta ?? null,
      ordem: v.ordem.trim(),
      tipo: pergunta?.tipo?.trim() ?? null,
      classe: comp?.classe ?? null,
      componente: null,
      componentePai: comp?.pai ?? null,
      idResposta: null,
      obrigatorio: v.obrigatorio,
      ativo: v.ativo,
      manterHist: pergunta?.manterHist ?? null,
    };
    const base = {
      linkId,
      texto: pergunta?.descricao?.trim() ?? '',
      ativo,
      obrigatorio: (v.obrigatorio ?? 'F').trim().toUpperCase() === 'T',
      unidade: pergunta?.unidade?.trim() || null,
      itens: [] as ItemMutavel[],
    };
    if (!comp) {
      itens.push({
        ...base,
        tipo: 'sem-componente',
        widget: null,
        tamanhoMaximo: null,
        layout: null,
        'x-legacy': xLegacy,
      });
      continue;
    }
    porClasse[comp.classe] = (porClasse[comp.classe] ?? 0) + 1;
    const classe = classeDfm(comp.classe);
    let raiz: ObjetoDfm | null = null;
    try {
      raiz = lerDfm(comp.dfm);
    } catch (e) {
      pendencias.push({
        linkId,
        tipo: 'dfm-invalido',
        detalhe: `componente ${comp.id}: ${e instanceof ErroDfm ? e.message : 'DFM ilegível'}`,
      });
    }
    if (!classe || !raiz) {
      if (!classe) {
        desconhecidas++;
        pendencias.push({
          linkId,
          tipo: 'classe-desconhecida',
          detalhe: `classe ${comp.classe} (componente ${comp.id})`,
        });
      }
      itens.push({
        ...base,
        tipo: 'nao-mapeado',
        widget: null,
        tamanhoMaximo: null,
        layout: null,
        'x-legacy': xLegacy,
      });
      continue;
    }
    mapeados++;
    const tipoPergunta = pergunta?.tipo?.trim() ?? '';
    if (tipoPergunta && !classe.tiposPergunta.includes(tipoPergunta)) {
      pendencias.push({
        linkId,
        tipo: 'tipo-inesperado',
        detalhe: `${comp.classe} com TIPOPERG ${tipoPergunta} (esperado ${classe.tiposPergunta.join(' ou ')})`,
      });
    }
    const descricao = textoDe(raiz.propriedades['Description']) ?? textoDe(raiz.propriedades['Caption']);
    const largura = numeroDe(raiz.propriedades['Width']) ?? null;
    const altura = numeroDe(raiz.propriedades['Height']) ?? null;
    const topo = numeroDe(raiz.propriedades['Top']) ?? null;
    const esquerda = numeroDe(raiz.propriedades['Left']) ?? null;
    const fonte = textoDe(raiz.propriedades['Fonte']) ?? '';
    const negrito = /style=[^\r\n]*fsBold/i.test(fonte);
    const tamanhoFonte = Number(/size=(\d+)/i.exec(fonte)?.[1] ?? NaN);
    const expressoes = expressoesDo(raiz);
    for (const e of expressoes) {
      if (e.tipo === 'habilitar') habilitar++;
      else calcular++;
    }
    let opcoes: readonly OpcaoResolvida[] | undefined;
    if (classe.listaRotulos) {
      const r = resolverEscolhas(
        raiz,
        classe.listaRotulos,
        tipoPergunta,
        respostasPorPergunta.get(v.idPergunta) ?? [],
      );
      opcoes = r.opcoes;
      opcoesResolvidas += r.opcoes.length;
      escolhasPendentes += r.pendencias.length;
      for (const p of r.pendencias as PendenciaEscolha[]) {
        pendencias.push({
          linkId,
          tipo: 'escolha',
          detalhe: p.motivo,
          indice: p.indice,
          opcao: p.texto,
          ...(p.sugestaoIdResposta !== undefined ? { sugestaoIdResposta: p.sugestaoIdResposta } : {}),
        });
      }
    }
    const colunasGrade =
      classe.tipo === 'grid'
        ? (entrada.colunasGrade ?? [])
            .filter((g) => g.idPerguntaGrade === v.idPergunta)
            .sort((a, b) => a.coluna - b.coluna)
            .map((g) => ({
              coluna: g.coluna,
              pergunta: g.idPergunta,
              idResposta: g.idResposta,
              titulo: g.descricao?.trim() ?? '',
              tipo: g.tipo?.trim() ?? null,
              unidade: g.unidade?.trim() || null,
            }))
        : [];
    const obrigatorioDfm = logicoDe(raiz.propriedades['CampoObrigatorio']);
    itens.push({
      ...base,
      texto: base.texto || descricao?.trim() || '',
      obrigatorio: base.obrigatorio || obrigatorioDfm === true,
      tipo: classe.tipo,
      widget: classe.widget,
      tamanhoMaximo: tamanhoMaximo(raiz),
      layout: {
        colunas: colunasDaLargura(largura ?? undefined),
        largura,
        altura,
        topo,
        esquerda,
        negrito,
        tamanhoFonte: Number.isFinite(tamanhoFonte) ? tamanhoFonte : null,
      },
      ...(opcoes ? { opcoes } : {}),
      ...(expressoes.length ? { expressoes } : {}),
      ...(colunasGrade.length ? { colunasGrade } : {}),
      'x-legacy': {
        ...xLegacy,
        componente: raiz.nome || null,
        idResposta: numeroDe(raiz.propriedades['Id_resposta']) ?? null,
      },
    });
  }

  // Árvore pela ordem do legado (pai = prefixo da ordem); sem pai, fica na raiz e vai ao relatório.
  itens.sort((a, b) => compararLinkId(a.linkId, b.linkId) || a['x-legacy'].vinculo - b['x-legacy'].vinculo);
  // M22: com vínculos repetidos na mesma ordem (um inativo e outro ativo), o pai é o ATIVO (de preferência a
  // seção): antes, o primeiro pela ordem do ID levava os filhos e o ativo ficava vazio.
  const peso = (i: ItemMutavel) => (i.ativo ? 2 : 0) + (i.tipo === 'group' ? 1 : 0);
  const melhor = new Map<string, ItemMutavel>();
  for (const i of itens) {
    const atual = melhor.get(i.linkId);
    if (!atual || peso(i) > peso(atual)) melhor.set(i.linkId, i);
  }
  const porLink = new Map<string, ItemMutavel>();
  const raizes: ItemMutavel[] = [];
  for (const item of itens) {
    let pai = linkIdPai(item.linkId);
    let alvo: ItemMutavel | undefined;
    while (pai && !(alvo = porLink.get(pai))) pai = linkIdPai(pai);
    if (alvo) alvo.itens.push(item);
    else {
      if (linkIdPai(item.linkId)) {
        pendencias.push({
          linkId: item.linkId,
          tipo: 'pai-ausente',
          detalhe: 'ordem sem item de nível acima; ficou na raiz',
        });
      }
      raizes.push(item);
    }
    if (melhor.get(item.linkId) === item) porLink.set(item.linkId, item);
  }

  const ativos = entrada.vinculos.filter((v) => (v.ativo ?? 'T').trim().toUpperCase() !== 'F').length;
  return {
    formato: FORMATO_REPRESENTACAO,
    modelo: entrada.modelo,
    impressaoLayout: await impressaoLayout(entrada.componentes),
    versoesLayout: [...entrada.versoes].sort((a, b) => a.versao - b.versao),
    resumo: {
      vinculos: entrada.vinculos.length,
      vinculosAtivos: ativos,
      vinculosInativos: entrada.vinculos.length - ativos,
      componentes: entrada.componentes.length,
      componentesMapeados: mapeados,
      classesDesconhecidas: desconhecidas,
      caracteresSubstituicao: substituicoes,
      vinculosSemComponente: entrada.vinculos.filter((v) => !componentePorVinculo.has(v.id)).length,
      opcoesResolvidas,
      escolhasPendentes,
      expressoesHabilitar: habilitar,
      expressoesCalcular: calcular,
      porClasse: Object.fromEntries(Object.entries(porClasse).sort(([a], [b]) => a.localeCompare(b))),
    },
    itens: raizes,
    pendencias,
  };
}
