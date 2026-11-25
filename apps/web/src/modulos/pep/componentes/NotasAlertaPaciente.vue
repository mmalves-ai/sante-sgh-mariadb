<script setup lang="ts">
// Faixa no topo do prontuário com as notas do paciente em vigor cujo tipo é marcado como alerta (03-PEP L102). Só
// aparece para quem lê o prontuário e quando há alerta; sem banco próprio ou sem permissão, fica oculta.
import { SanteAlerta } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { pode } from '../../../casca/sessao/pode.js';
import { lerNotasPaciente } from '../api-notas-paciente.js';

const props = defineProps<{ paciente: number }>();
const { t } = useI18n();
const ativo = computed(() => pode('pep.prontuario.ler'));
const dados = useQuery({
  queryKey: computed(() => ['pep', 'notas', props.paciente]),
  queryFn: () => lerNotasPaciente(props.paciente),
  enabled: ativo,
  retry: false,
});
const alertas = computed(() => dados.data.value?.alertas ?? []);
</script>

<template>
  <div v-if="alertas.length" class="notas-alerta" data-testid="notas-alerta">
    <SanteAlerta
      variante="aviso"
      :texto="`${t('pep.notas.alertas')}: ${alertas.map((n) => `${n.tipo.descricao}: ${n.texto}`).join(' · ')}`"
    />
    <RouterLink :to="`/pep/paciente/${paciente}/notas`">{{ t('pep.notas.atalho') }}</RouterLink>
  </div>
</template>

<style scoped>
.notas-alerta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-3);
  align-items: center;
}
</style>
