// A internação aberta pela rota (`/internacao/:reg/...`): a leitura auditada da ficha e o recarregar depois de gravar.
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, type Ref } from 'vue';
import { lerInternacao } from './api-adt.js';

export function usarInternacao(reg: Ref<number>) {
  const cliente = useQueryClient();
  const ficha = useQuery({
    queryKey: computed(() => ['adt', 'internacao', reg.value]),
    queryFn: () => lerInternacao(reg.value),
  });
  const recarregar = () => cliente.invalidateQueries({ queryKey: ['adt'] });
  return { ficha, recarregar };
}
