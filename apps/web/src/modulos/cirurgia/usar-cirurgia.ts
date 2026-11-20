// Dados comuns das telas do centro cirúrgico: opções (salas com a permissão da pessoa, anestesias, caráter,
// convênios, especialidades, profissionais do bloco, motivos, pendências, recursos e o preparo mínimo), o estado da
// gravação da agenda cirúrgica e do registro do ato (liberação e permissão por operação).
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { lerGravacaoCirurgia, lerOpcoesCirurgia } from './api-cirurgia.js';

export function usarCirurgia() {
  const opcoes = useQuery({
    queryKey: ['cirurgia', 'opcoes'],
    queryFn: () => lerOpcoesCirurgia(),
    staleTime: 60_000,
  });
  const gravacao = useQuery({
    queryKey: ['cirurgia', 'gravacao'],
    queryFn: () => lerGravacaoCirurgia(),
    staleTime: 30_000,
  });
  const pode = (op: string) =>
    computed(() => {
      const g = gravacao.data.value;
      return (g?.agenda.operacoes[op]?.pode ?? false) || (g?.registro.operacoes[op]?.pode ?? false);
    });
  const motivoAgenda = computed(() => {
    const g = gravacao.data.value?.agenda;
    return g && !g.ligada ? g.motivo : null;
  });
  const motivoRegistro = computed(() => {
    const g = gravacao.data.value?.registro;
    return g && !g.ligada ? g.motivo : null;
  });
  const salas = computed(() =>
    (opcoes.data.value?.salas ?? []).map((s) => ({ valor: String(s.codigo), rotulo: s.nome })),
  );
  const salasPermitidas = computed(() =>
    (opcoes.data.value?.salas ?? [])
      .filter((s) => s.permitida)
      .map((s) => ({ valor: String(s.codigo), rotulo: s.nome })),
  );
  const profissionais = computed(() =>
    (opcoes.data.value?.profissionais ?? []).map((p) => ({ valor: `${p.id}:${p.cod}`, rotulo: p.nome })),
  );
  const convenios = computed(() =>
    (opcoes.data.value?.convenios ?? [])
      .filter((c) => c.ativo)
      .map((c) => ({ valor: String(c.codigo), rotulo: c.nome })),
  );
  return {
    opcoes,
    gravacao,
    pode,
    motivoAgenda,
    motivoRegistro,
    salas,
    salasPermitidas,
    profissionais,
    convenios,
  };
}

/** "ID:COD" da escolha do profissional → o par do contrato (ou null). */
export function profissionalDaEscolha(v: string): { id: number; cod: number } | null {
  const m = /^(\d+):(\d+)$/.exec(v);
  return m ? { id: Number(m[1]), cod: Number(m[2]) } : null;
}
