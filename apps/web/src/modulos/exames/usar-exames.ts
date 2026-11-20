// Dados comuns das telas da agenda de exames: opções (convênios, catálogo do SADT, motivos, canais, relógio do
// banco), o estado da gravação (liberação e permissão por operação) e a lista de agendas para escolher.
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { lerGravacaoExame, lerOpcoesExame, listarAgendasExame } from './api-exames.js';

export function usarExames() {
  const opcoes = useQuery({
    queryKey: ['exames', 'opcoes'],
    queryFn: () => lerOpcoesExame(),
    staleTime: 60_000,
  });
  const gravacao = useQuery({
    queryKey: ['exames', 'gravacao'],
    queryFn: () => lerGravacaoExame(),
    staleTime: 30_000,
  });
  const agendas = useQuery({
    queryKey: ['exames', 'agendas', 'todas'],
    queryFn: () => listarAgendasExame(),
    staleTime: 60_000,
  });
  const pode = (op: string) => computed(() => gravacao.data.value?.operacoes[op]?.pode ?? false);
  const motivoGravacao = computed(() => {
    const g = gravacao.data.value;
    return g && !g.ligada ? g.motivo : null;
  });
  const opcoesAgenda = computed(() =>
    (agendas.data.value?.itens ?? []).map((a) => ({
      valor: String(a.id),
      rotulo: a.ativa ? a.nome : `${a.nome} (inativa)`,
    })),
  );
  const convenios = computed(() =>
    (opcoes.data.value?.convenios ?? [])
      .filter((c) => c.ativo)
      .map((c) => ({ valor: String(c.codigo), rotulo: c.nome })),
  );
  return { opcoes, gravacao, agendas, pode, motivoGravacao, opcoesAgenda, convenios };
}
