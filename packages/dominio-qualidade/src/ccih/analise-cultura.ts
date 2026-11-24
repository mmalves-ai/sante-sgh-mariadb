// Análise da cultura positiva pela comissão de controle de infecção (F7, 09-AREA linha 68): cada cultura com
// crescimento é classificada (infecção, colonização, contaminação ou indeterminada) e recebe a conduta do cadastro do
// cliente. A regra decide, na hora e sem banco, o que a análise pode gravar e o que ela pede a seguir.
// Melhoria: a conduta do cadastro carrega o efeito (abre caso, indica precaução, pede resposta do prescritor) e a análise
// herda esse efeito sem o analista marcar de novo (menos cliques); a conduta de outra classificação é recusada.
// Melhoria: germe multirresistente em infecção ou colonização indica a precaução de contato (orientação da Anvisa para
// microrganismo multirresistente), mesmo que a conduta não diga.
// Melhoria: a infecção sem ficha de IRAS ligada fica como pendência visível ("abrir a ficha"), nunca esquecida.

export const CLASSIFICACOES_CULTURA = ['infeccao', 'colonizacao', 'contaminacao', 'indeterminada'] as const;
export type ClassificacaoCultura = (typeof CLASSIFICACOES_CULTURA)[number];

/** A cultura como a comissão a vê: o crescimento, a situação do laudo e o isolado (quando houver). */
export interface CulturaParaAnalise {
  readonly crescimento:
    'em_andamento' | 'sem_crescimento' | 'com_crescimento' | 'contaminada' | 'flora_normal';
  readonly situacao: 'parcial' | 'final' | 'retificado';
  readonly isolados: readonly { readonly id: number; readonly multirresistente: boolean }[];
}

export interface CondutaCultura {
  readonly id: number;
  readonly ativo: boolean;
  readonly classificacaoAplicavel: ClassificacaoCultura | null;
  readonly abreCaso: boolean;
  readonly indicaPrecaucao: boolean;
  readonly exigeResposta: boolean;
}

export interface EntradaAnaliseCultura {
  readonly classificacao: string;
  readonly isolado: number | null;
  readonly conduta: number | null;
  readonly condutaDescricao: string | null;
  readonly precaucaoIndicada: boolean;
  readonly prescritorOrientado: boolean;
  readonly casoInfeccao: number | null;
}

export type RecusaAnaliseCultura =
  | 'classificacao-invalida'
  | 'cultura-sem-crescimento'
  | 'isolado-de-outra-cultura'
  | 'isolado-obrigatorio'
  | 'conduta-inativa'
  | 'conduta-de-outra-classificacao'
  | 'conduta-sem-descricao'
  | 'prescritor-nao-orientado'
  | 'caso-so-em-infeccao';

export const MENSAGENS_ANALISE_CULTURA: Record<RecusaAnaliseCultura, string> = {
  'classificacao-invalida':
    'Classifique a cultura como infecção, colonização, contaminação ou indeterminada.',
  'cultura-sem-crescimento': 'Só a cultura com crescimento é analisada pela comissão.',
  'isolado-de-outra-cultura': 'O germe escolhido não é desta cultura.',
  'isolado-obrigatorio': 'A cultura tem mais de um germe: escolha qual está sendo analisado.',
  'conduta-inativa': 'A conduta escolhida está inativa no cadastro.',
  'conduta-de-outra-classificacao': 'A conduta escolhida não se aplica a esta classificação.',
  'conduta-sem-descricao': 'Escolha uma conduta do cadastro ou descreva a conduta tomada.',
  'prescritor-nao-orientado': 'Esta conduta pede a orientação do prescritor: marque que ele foi orientado.',
  'caso-so-em-infeccao': 'Só a cultura classificada como infecção liga uma ficha de IRAS.',
};

export type PendenciaAnaliseCultura = 'abrir-ficha-iras' | 'aplicar-precaucao';

export interface AnaliseCulturaAvaliada {
  readonly classificacao: ClassificacaoCultura;
  readonly isolado: number | null;
  readonly precaucaoIndicada: boolean;
  readonly prescritorOrientado: boolean;
  /** O laudo já estava retificado quando a análise foi feita. */
  readonly laudoRetificado: boolean;
  readonly pendencias: readonly PendenciaAnaliseCultura[];
}

export type ResultadoAnaliseCultura =
  | { readonly ok: true; readonly analise: AnaliseCulturaAvaliada }
  | { readonly ok: false; readonly recusa: RecusaAnaliseCultura };

const ehClassificacao = (v: string): v is ClassificacaoCultura =>
  (CLASSIFICACOES_CULTURA as readonly string[]).includes(v);

/** Confere a análise contra a cultura e a conduta e devolve o que se grava (ou a recusa, com o código). */
export function avaliarAnaliseCultura(
  e: EntradaAnaliseCultura,
  cultura: CulturaParaAnalise,
  conduta: CondutaCultura | null,
): ResultadoAnaliseCultura {
  const recusa = (r: RecusaAnaliseCultura): ResultadoAnaliseCultura => ({ ok: false, recusa: r });
  if (!ehClassificacao(e.classificacao)) return recusa('classificacao-invalida');
  const classificacao = e.classificacao;
  if (cultura.crescimento !== 'com_crescimento') return recusa('cultura-sem-crescimento');
  let isolado = e.isolado;
  if (isolado !== null && !cultura.isolados.some((i) => i.id === isolado))
    return recusa('isolado-de-outra-cultura');
  if (isolado === null && cultura.isolados.length > 1) return recusa('isolado-obrigatorio');
  if (isolado === null && cultura.isolados.length === 1) isolado = cultura.isolados[0]!.id;
  if (conduta) {
    if (!conduta.ativo) return recusa('conduta-inativa');
    if (conduta.classificacaoAplicavel !== null && conduta.classificacaoAplicavel !== classificacao)
      return recusa('conduta-de-outra-classificacao');
  } else if (!e.condutaDescricao?.trim()) return recusa('conduta-sem-descricao');
  if (conduta?.exigeResposta && !e.prescritorOrientado) return recusa('prescritor-nao-orientado');
  if (e.casoInfeccao !== null && classificacao !== 'infeccao') return recusa('caso-so-em-infeccao');
  const multirresistente = cultura.isolados.some(
    (i) => (isolado === null || i.id === isolado) && i.multirresistente,
  );
  const precaucaoIndicada =
    e.precaucaoIndicada ||
    Boolean(conduta?.indicaPrecaucao) ||
    (multirresistente && (classificacao === 'infeccao' || classificacao === 'colonizacao'));
  const pendencias: PendenciaAnaliseCultura[] = [];
  if (classificacao === 'infeccao' && e.casoInfeccao === null && (conduta === null || conduta.abreCaso))
    pendencias.push('abrir-ficha-iras');
  if (precaucaoIndicada) pendencias.push('aplicar-precaucao');
  return {
    ok: true,
    analise: {
      classificacao,
      isolado,
      precaucaoIndicada,
      prescritorOrientado: e.prescritorOrientado,
      laudoRetificado: cultura.situacao === 'retificado',
      pendencias,
    },
  };
}
