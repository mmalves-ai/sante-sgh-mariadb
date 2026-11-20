// Dados comuns das telas do M21: o estado da gravação (as cinco liberações e cada ação, a alta médica como ato
// médico) e o apoio (convênios, especialidades, motivos de alta, acomodações, tipos de limpeza, setores…).
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { type AreaAdt, lerApoioInternacao, lerGravacaoInternacao } from './api-adt.js';

export function usarAdt(area: AreaAdt = 'internacoes') {
  const gravacao = useQuery({
    queryKey: ['adt', 'gravacao', area],
    queryFn: () => lerGravacaoInternacao(area),
    staleTime: 30_000,
  });
  const apoio = useQuery({
    queryKey: ['adt', 'apoio', area],
    queryFn: () => lerApoioInternacao(area),
    staleTime: 60_000,
  });
  /** A ação grava agora (permissão, liberação e passo 0 do executor)? */
  const pode = (op: string) => computed(() => gravacao.data.value?.operacoes[op]?.pode ?? false);
  const motivo = (op: string) => computed(() => gravacao.data.value?.operacoes[op]?.motivo ?? null);
  /** O motivo de "só consulta" da funcionalidade da ação (a primeira recusada), para o aviso da tela. */
  const motivoDe = (...ops: string[]) =>
    computed(() => {
      const g = gravacao.data.value;
      if (!g) return null;
      for (const op of ops) {
        const o = g.operacoes[op];
        if (o && !o.pode) return o.motivo;
      }
      return null;
    });
  const nomeConvenio = (cod: number) =>
    apoio.data.value?.convenios.find((c) => c.codigo === cod)?.nome ?? String(cod);
  return { gravacao, apoio, pode, motivo, motivoDe, nomeConvenio };
}
