// Dados comuns das telas da agenda: opções (convênios, especialidades, motivos, canais, relógio do banco),
// o estado da gravação (liberação e permissão por operação) e a lista de agendas para escolher.
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { lerGravacao, lerOpcoes, listarAgendas } from './api-agenda.js';

export function usarAgenda() {
  const opcoes = useQuery({ queryKey: ['agenda', 'opcoes'], queryFn: () => lerOpcoes(), staleTime: 60_000 });
  const gravacao = useQuery({
    queryKey: ['agenda', 'gravacao'],
    queryFn: () => lerGravacao(),
    staleTime: 30_000,
  });
  const agendas = useQuery({
    queryKey: ['agenda', 'agendas', 'todas'],
    queryFn: () => listarAgendas(),
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
  return { opcoes, gravacao, agendas, pode, motivoGravacao, opcoesAgenda };
}
