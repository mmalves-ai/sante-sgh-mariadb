// Apoios puros da tela da licitação e do pregão (M55, etapa 4): os rótulos dos vocabulários, a permissão de cada
// operação (conduzir ou homologar), a abertura mínima prevista do aviso (art. 55, em dias úteis), os itens empatados do
// julgamento com os fornecedores em empate, o nome do fornecedor pelas propostas e o número digitado. Sem estado;
// testados em licitacao-telas.spec.ts.
import {
  CRITERIOS_JULGAMENTO,
  ETAPAS_FINAIS_LICITACAO,
  ETAPAS_LICITACAO,
  type EtapaLicitacao,
  FONTES_PRECO,
  type GravacaoAgenda,
  type JulgamentoLicitacao,
  MODALIDADES_LICITACAO,
  type ModalidadeLicitacao,
  NATUREZAS_OBJETO_LICITACAO,
  type ParametrosLicitacao,
  type PropostaLicitacao,
  REGIMES_LICITACAO,
  RESULTADOS_ITEM_LICITACAO,
  SITUACOES_PROPOSTA,
  TIPOS_EVENTO_LICITACAO,
  type TipoEventoLicitacao,
  VEICULOS_PUBLICACAO,
} from '@sgh/contratos';
import { prazoMinimoAviso, somarDiasUteis } from '@sgh/dominio-suprimentos';

type Vocab = readonly { readonly codigo: string; readonly rotulo: string }[];
const rotuloDe = (v: Vocab) => (codigo: string | null | undefined) =>
  (codigo && v.find((x) => x.codigo === codigo)?.rotulo) || '—';

export const rotuloEtapa = rotuloDe(ETAPAS_LICITACAO);
export const rotuloModalidade = rotuloDe(MODALIDADES_LICITACAO);
export const rotuloCriterio = rotuloDe(CRITERIOS_JULGAMENTO);
export const rotuloNatureza = rotuloDe(NATUREZAS_OBJETO_LICITACAO);
export const rotuloRegime = rotuloDe(REGIMES_LICITACAO);
export const rotuloFonte = rotuloDe(FONTES_PRECO);
export const rotuloVeiculo = rotuloDe(VEICULOS_PUBLICACAO);
export const rotuloEventoLicitacao = rotuloDe(TIPOS_EVENTO_LICITACAO);
export const rotuloSituacaoProposta = rotuloDe([
  ...SITUACOES_PROPOSTA,
  { codigo: 'acima-estimado', rotulo: 'Acima do estimado' },
]);
export const rotuloResultadoItem = rotuloDe(RESULTADOS_ITEM_LICITACAO);

/** Opções de uma SanteSelecao a partir de um vocabulário. */
export const opcoesDe = <T extends string>(v: readonly { readonly codigo: T; readonly rotulo: string }[]) =>
  v.map((x) => ({ valor: x.codigo as T, rotulo: x.rotulo }));

/** Contratação direta (dispensa e inexigibilidade): sem edital, aviso nem recurso. */
export const ehDireta = (m: ModalidadeLicitacao | string) =>
  MODALIDADES_LICITACAO.some((x) => x.codigo === m && x.direta);

export const etapaFinal = (e: EtapaLicitacao) => ETAPAS_FINAIS_LICITACAO.includes(e);

/** Pode gravar a operação agora (ligada no estabelecimento e com a permissão)? */
export const podeLicitacao = (g: GravacaoAgenda | null | undefined, op: 'conduzir' | 'homologar') =>
  !!g && g.ligada && g.operacoes[op]?.pode === true;

/** O critério julga por desconto (a proposta é um percentual) ou com nota técnica? */
export const porDesconto = (criterio: string) => criterio === 'maior-desconto';
export const comNotaTecnica = (criterio: string) =>
  criterio === 'tecnica-preco' || criterio === 'melhor-tecnica';

/**
 * A abertura mínima do aviso publicado hoje (o prazo do art. 55 em dias úteis, sem sábado, domingo e os feriados do
 * calendário do estabelecimento, que o detalhe traz) e o número de dias; nulo na contratação direta.
 */
export function aberturaMinima(
  p: {
    regime: string;
    modalidade: string;
    criterio: string;
    natureza: string;
  },
  dataPublicacao: string,
  parametros: Pick<ParametrosLicitacao, 'prazoAvisoRegulamentoDiasUteis'>,
  feriados: readonly string[] = [],
): { dias: number; data: string } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataPublicacao)) return null;
  const dias = prazoMinimoAviso(p as Parameters<typeof prazoMinimoAviso>[0], parametros);
  if (dias === null) return null;
  return { dias, data: somarDiasUteis(dataPublicacao, dias, feriados) };
}

/** Os itens empatados do julgamento, com os fornecedores em empate (para o desempate do art. 60). */
export function empatesDoJulgamento(
  j: JulgamentoLicitacao | null | undefined,
): { item: number; fornecedores: number[] }[] {
  return (j?.itens ?? [])
    .filter((x) => x.resultado === 'empate' && x.empatados.length > 1)
    .map((x) => ({ item: x.item, fornecedores: [...x.empatados] }));
}

/** O nome do fornecedor (pelas propostas do processo), ou o código. */
export function nomeFornecedor(propostas: readonly PropostaLicitacao[], codigo: number | null): string {
  if (codigo === null) return '—';
  const p = propostas.find((x) => x.fornecedor === codigo);
  return p ? `${codigo} · ${p.fornecedorNome}` : String(codigo);
}

/** O número digitado com vírgula decimal e ponto de milhar ("1.234,56") ou ponto decimal; nulo se vazio ou inválido. */
export function lerNumero(s: string): number | null {
  const x = s.trim().replace(/^R\$\s*/, '');
  if (!x) return null;
  const normal = x.includes(',') ? x.replace(/\./g, '').replace(',', '.') : x;
  if (!/^\d+(\.\d+)?$/.test(normal)) return null;
  const n = Number(normal);
  return Number.isFinite(n) ? n : null;
}

/** Os atos que quem conduz registra pela aba "Atos" (a decisão do recurso é da autoridade). */
export const EVENTOS_DE_QUEM_CONDUZ: readonly TipoEventoLicitacao[] = [
  'parecer',
  'esclarecimento',
  'recurso',
  'documento',
  'ata',
  'pedido',
];

/** Os atos que cabem na etapa (o servidor confere de novo; a tela só não oferece o que é recusado de certo). */
export function eventosNaEtapa(etapa: EtapaLicitacao, modalidade: string): TipoEventoLicitacao[] {
  const direta = ehDireta(modalidade);
  return EVENTOS_DE_QUEM_CONDUZ.filter((t) => {
    if (t === 'parecer') return ['planejamento', 'pesquisa', 'edital'].includes(etapa);
    if (t === 'esclarecimento') return ['edital', 'publicado'].includes(etapa);
    if (t === 'recurso') return !direta && etapa === 'julgado';
    if (t === 'ata') return ['julgado', 'homologado'].includes(etapa);
    if (t === 'pedido') return etapa === 'homologado';
    return true;
  });
}
