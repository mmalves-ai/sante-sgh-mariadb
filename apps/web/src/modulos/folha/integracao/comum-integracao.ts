// Comuns da integração da folha com o financeiro e o contábil (M53.9, etapa F8): a chave da classificação gerencial, as
// linhas do de-para (da vigência em vigor ou da sugestão do perfil), a entrada da nova vigência e a do lançamento
// conferidas no contrato, os vencimentos ajustados na prévia e quando a prévia permite lançar. Valores em centavos.
import {
  type ApoioIntegracaoFolha,
  type ClassificacaoFolha,
  type DestinoTituloFolha,
  esquemaGravarIntegracaoFolha,
  esquemaLancarTitulosFolha,
  type GravarIntegracaoFolhaEntrada,
  type LancarTitulosFolhaEntrada,
  type PreviaTitulosFolha,
} from '@sgh/contratos';

type Classe = Pick<ClassificacaoFolha, 'grupo' | 'subgrupo' | 'item'>;

/** {210, 1, 1} → "210.1.1". */
export const chaveClassificacao = (c: Classe | null | undefined) =>
  c ? `${c.grupo}.${c.subgrupo}.${c.item}` : '';

/** "210.1.1" → {210, 1, 1}; outro texto → null. */
export function lerChaveClassificacao(s: string): Classe | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(s);
  return m ? { grupo: Number(m[1]), subgrupo: Number(m[2]), item: Number(m[3]) } : null;
}

/** As opções da classificação (com busca na tela: a lista é grande). */
export const opcoesClassificacao = (xs: readonly ClassificacaoFolha[]) =>
  xs.map((c) => ({ valor: chaveClassificacao(c), rotulo: `${chaveClassificacao(c)} — ${c.nome}` }));

/** Uma linha do de-para na tela (o credor e a classificação podem faltar enquanto se edita). */
export interface LinhaDePara {
  readonly destino: DestinoTituloFolha;
  readonly rotina: number;
  /** A rotina do destino integra ao financeiro no cadastro de rotinas (senão o destino não vira título). */
  readonly financeiro: boolean;
  credor: number | null;
  credorNome: string;
  classificacao: string;
  diaVencimento: number;
  mesesDepois: number;
  contaContabil: string;
  /** A classificação veio da sugestão do perfil (a tela avisa; o DP confere). */
  sugerida: boolean;
}

/** O líquido vence na data de pagamento da folha; os encargos, no dia do mês seguinte (o padrão é 20). */
export const DIA_PADRAO = 20;
export const ehLiquido = (d: DestinoTituloFolha) => d.startsWith('liquido-');

/** As linhas do de-para: as da vigência em vigor; sem ela, a sugestão do perfil (só a classificação). */
export function linhasDePara(a: ApoioIntegracaoFolha): LinhaDePara[] {
  const nomes = new Map(a.credores.map((c) => [c.codigo, c.nome]));
  return a.destinos.map(({ destino, rotina }) => {
    const v = a.vigente?.destinos.find((d) => d.destino === destino);
    const s = a.sugestao.find((d) => d.destino === destino);
    const financeiro = a.rotinas.find((r) => r.id === rotina)?.financeiro ?? false;
    return v
      ? {
          destino,
          rotina,
          financeiro,
          credor: v.credor,
          credorNome: nomes.get(v.credor) ?? '',
          classificacao: chaveClassificacao(v.classificacao),
          diaVencimento: v.diaVencimento,
          mesesDepois: v.mesesDepois,
          contaContabil: v.contaContabil,
          sugerida: false,
        }
      : {
          destino,
          rotina,
          financeiro,
          credor: null,
          credorNome: '',
          classificacao: chaveClassificacao(s?.classificacao),
          diaVencimento: DIA_PADRAO,
          mesesDepois: 1,
          contaContabil: '',
          sugerida: !!s,
        };
  });
}

/** A linha está completa (credor e classificação) e a rotina integra ao financeiro: entra na vigência. */
export const linhaCompleta = (l: LinhaDePara) =>
  l.financeiro && l.credor !== null && lerChaveClassificacao(l.classificacao) !== null;

/** A nova vigência (as linhas completas), conferida no contrato; nula se faltar empresa, início ou linha. */
export function entradaDePara(
  empresa: number | null,
  inicio: string | null,
  linhas: readonly LinhaDePara[],
): GravarIntegracaoFolhaEntrada | null {
  if (empresa === null || !inicio) return null;
  const r = esquemaGravarIntegracaoFolha.safeParse({
    empresa,
    inicio,
    destinos: linhas.filter(linhaCompleta).map((l) => ({
      destino: l.destino,
      credor: l.credor,
      classificacao: lerChaveClassificacao(l.classificacao),
      diaVencimento: l.diaVencimento,
      mesesDepois: l.mesesDepois,
      contaContabil: l.contaContabil.trim(),
    })),
  });
  return r.success ? r.data : null;
}

/** Os vencimentos que a pessoa mudou na prévia (só os diferentes do sugerido). */
export function vencimentosAjustados(
  p: PreviaTitulosFolha,
  ajustes: Readonly<Record<string, string | null>>,
): { chave: string; vencimento: string }[] {
  return p.titulos
    .map((t) => ({ chave: t.chave, vencimento: ajustes[t.chave] ?? t.vencimento }))
    .filter((x, i) => x.vencimento !== p.titulos[i]!.vencimento);
}

/** O vencimento que vale de cada título (o ajustado ou o sugerido). */
export const vencimentoDe = (
  t: PreviaTitulosFolha['titulos'][number],
  ajustes: Readonly<Record<string, string | null>>,
) => ajustes[t.chave] ?? t.vencimento;

/** Um título com vencimento antes da emissão (a tela barra antes do servidor recusar). */
export const vencimentosAntesDaEmissao = (
  p: PreviaTitulosFolha,
  emissao: string | null,
  ajustes: Readonly<Record<string, string | null>>,
) => (emissao ? p.titulos.filter((t) => vencimentoDe(t, ajustes) < emissao).map((t) => t.chave) : []);

/** A entrada do lançamento com o resumo da prévia conferida; nula se a prévia não permite lançar. */
export function entradaLancar(
  p: PreviaTitulosFolha | null,
  emissao: string | null,
  ajustes: Readonly<Record<string, string | null>>,
): LancarTitulosFolhaEntrada | null {
  if (!p || !p.podeLancar || !emissao) return null;
  if (vencimentosAntesDaEmissao(p, emissao, ajustes).length) return null;
  const r = esquemaLancarTitulosFolha.safeParse({
    empresa: p.empresa,
    origem: p.origem,
    id: p.id,
    resumo: p.resumo,
    emissao,
    vencimentos: vencimentosAjustados(p, ajustes),
  });
  return r.success ? r.data : null;
}

/** A soma dos títulos fecha com o líquido mais os encargos da origem. */
export const somaConfere = (p: PreviaTitulosFolha) => p.total === p.esperado;
