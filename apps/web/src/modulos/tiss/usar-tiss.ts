// Dados comuns das telas do pós-fechamento: o estado da gravação (cada funcionalidade e ação), o apoio (o dia do banco,
// os convênios do escopo, as situações do protocolo, os tipos de guia e a versão) e os formatos.
import { useQuery } from '@tanstack/vue-query';
import { lerApoio, lerGravacao } from './api-tiss.js';

export function usarTiss(de: 'lote' | 'glosa' | 'integracao' = 'lote') {
  const gravacao = useQuery({
    queryKey: ['tiss', 'gravacao', de],
    queryFn: () => lerGravacao(de),
    staleTime: 30_000,
  });
  const apoio = useQuery({
    queryKey: ['tiss', 'apoio'],
    queryFn: () => lerApoio(),
    staleTime: 60_000,
    enabled: de !== 'integracao',
  });
  const pode = (op: string) => gravacao.data.value?.operacoes[op]?.ligada ?? false;
  const motivo = (op: string) => gravacao.data.value?.operacoes[op]?.motivo ?? null;
  const motivoFuncionalidade = (f: string) => {
    const x = gravacao.data.value?.funcionalidades[f];
    return x && !x.ligada ? (x.motivo ?? null) : null;
  };
  return { gravacao, apoio, pode, motivo, motivoFuncionalidade };
}

export const opcoesConvenio = (
  lista: readonly { codigo: number; nome: string }[] | undefined,
  todos?: string,
) => [
  ...(todos ? [{ valor: '', rotulo: todos }] : []),
  ...(lista ?? []).map((x) => ({ valor: String(x.codigo), rotulo: `${x.codigo} — ${x.nome}` })),
];

export { competenciaAtual, data, num, numero, quando, reais } from '../faturamento/usar-faturamento.js';
