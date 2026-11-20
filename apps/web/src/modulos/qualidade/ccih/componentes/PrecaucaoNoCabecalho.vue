<script setup lang="ts">
// A precaução no cabeçalho do prontuário (regra 7): as precauções abertas da internação do paciente, definidas pela
// CCIH (ou vindas da microbiologia), com o tipo e o motivo. Sem precaução, fora de internação, com a CCIH desligada ou
// sem acesso, não aparece nada.
import { PRECAUCOES, rotuloMotivoPrecaucao } from '@sgh/contratos';
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { lerPrecaucoesDoPaciente } from '../api-ccih.js';

const props = defineProps<{ paciente: number }>();
const { t } = useI18n();
const q = useQuery({
  queryKey: computed(() => ['ccih', 'precaucoes-do-paciente', props.paciente]),
  queryFn: () => lerPrecaucoesDoPaciente(props.paciente),
  refetchInterval: 300_000,
  retry: false,
});
const itens = computed(() => (q.isError.value ? [] : (q.data.value?.itens ?? [])));
const rotuloTipo = (c: string) => PRECAUCOES.find((p) => p.codigo === c)?.rotulo ?? c;
</script>

<template>
  <div v-if="itens.length" role="status" class="precaucao-cabecalho" data-testid="precaucao-cabecalho">
    <strong>{{ t('ccih.cabecalho.titulo') }}</strong>
    <span v-for="(i, k) in itens" :key="k" class="precaucao-cabecalho__item">
      {{
        t('ccih.cabecalho.item', {
          tipo: rotuloTipo(i.tipo),
          motivo: i.motivoOutro ?? rotuloMotivoPrecaucao(i.motivo as never),
        })
      }}
      <template v-if="i.multirresistente"> ({{ t('ccih.cabecalho.multirresistente') }})</template>
    </span>
  </div>
</template>

<style scoped>
.precaucao-cabecalho {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: center;
  padding: var(--sgh-espaco-2) var(--sgh-espaco-3);
  border: 1px solid var(--sgh-aviso);
  border-radius: var(--sgh-raio, 6px);
  background: var(--sgh-aviso-suave);
}
.precaucao-cabecalho__item {
  font-weight: 600;
}
</style>
