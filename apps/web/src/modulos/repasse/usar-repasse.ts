// Dados comuns das telas do repasse: o apoio (o dia do banco, eventos, convênios, parâmetros e o estado da gravação de
// cada ação no estabelecimento), a permissão da sessão e os formatos.
import { useQuery } from '@tanstack/vue-query';
import { usarSessao } from '../../casca/sessao/sessao.js';
import { lerApoio } from './api-repasse.js';

export function usarRepasse() {
  const { permissoes } = usarSessao();
  const apoio = useQuery({ queryKey: ['repasse', 'apoio'], queryFn: () => lerApoio(), staleTime: 30_000 });
  const tem = (permissao: string) => permissoes.value.has(permissao);
  /** Pode agir: a permissão na sessão e a ação liberada no estabelecimento (o servidor confere de novo). */
  const pode = (acao: string, permissao: string) =>
    tem(permissao) && (apoio.data.value?.gravacao.operacoes[acao]?.ligada ?? false);
  const motivo = (acao: string) => apoio.data.value?.gravacao.operacoes[acao]?.motivo ?? null;
  return { apoio, pode, tem, motivo };
}

export const opcoes = (lista: readonly { codigo: number; rotulo: string }[] | undefined, vazio?: string) => [
  ...(vazio !== undefined ? [{ valor: '', rotulo: vazio }] : []),
  ...(lista ?? []).map((o) => ({ valor: String(o.codigo), rotulo: `${o.codigo} — ${o.rotulo}` })),
];

export { data, reais } from '../faturamento/usar-faturamento.js';
