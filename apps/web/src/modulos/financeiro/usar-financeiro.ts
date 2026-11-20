// Dados comuns das telas do financeiro: o estado da gravação (cada funcionalidade e ação liberada no estabelecimento),
// o apoio (o dia do banco, as contas bancárias do escopo, a classificação gerencial, as retenções, as formas de
// pagamento e os tipos de credor), a permissão da sessão e os formatos.
import { useQuery } from '@tanstack/vue-query';
import { usarSessao } from '../../casca/sessao/sessao.js';
import { lerApoio, lerGravacao } from './api-financeiro.js';

export type FuncionalidadeFinanceiro = 'contasPagar' | 'contasReceber' | 'tesouraria' | 'fiscal';

export function usarFinanceiro() {
  const { permissoes } = usarSessao();
  const gravacao = useQuery({
    queryKey: ['financeiro', 'gravacao'],
    queryFn: () => lerGravacao(),
    staleTime: 30_000,
  });
  const apoio = useQuery({ queryKey: ['financeiro', 'apoio'], queryFn: () => lerApoio(), staleTime: 60_000 });
  /** Pode agir: a permissão na sessão e a ação liberada no estabelecimento (o servidor confere de novo). */
  const pode = (acao: string, permissao?: string) =>
    (permissao === undefined || permissoes.value.has(permissao)) &&
    (gravacao.data.value?.operacoes[acao]?.ligada ?? false);
  const tem = (permissao: string) => permissoes.value.has(permissao);
  const motivo = (acao: string) => gravacao.data.value?.operacoes[acao]?.motivo ?? null;
  const motivoFuncionalidade = (f: FuncionalidadeFinanceiro) => {
    const x = gravacao.data.value?.funcionalidades[f];
    return x && !x.ligada ? (x.motivo ?? null) : null;
  };
  return { gravacao, apoio, pode, tem, motivo, motivoFuncionalidade };
}

export const opcoesContas = (
  contas:
    readonly { id: number; banco: number; agencia: number; codigo: number; descricao: string }[] | undefined,
  vazio?: string,
) => [
  ...(vazio ? [{ valor: '', rotulo: vazio }] : []),
  ...(contas ?? []).map((c) => ({
    valor: String(c.id),
    rotulo: `${c.descricao} (${c.banco} · ${c.agencia} · ${c.codigo})`,
  })),
];

export const opcoesClassificacao = (
  lista: readonly { grupo: number; subgrupo: number; item: number; nome: string }[] | undefined,
  vazio: string,
) => [
  { valor: '', rotulo: vazio },
  ...(lista ?? []).map((c) => ({
    valor: `${c.grupo}.${c.subgrupo}.${c.item}`,
    rotulo: `${c.grupo}.${c.subgrupo}.${c.item} — ${c.nome}`,
  })),
];

export const lerClassificacao = (v: string) => {
  const [grupo, subgrupo, item] = v.split('.').map(Number);
  return { grupo: grupo ?? 0, subgrupo: subgrupo ?? 0, item: item ?? 0 };
};

export { dividirParcelas, paraCsv, somarDias, somarMeses } from './regras-tela.js';
export { data, num, numero, quando, reais } from '../faturamento/usar-faturamento.js';
