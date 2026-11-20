<script setup lang="ts">
// POL-3: a situação de cada gravação neste estabelecimento; a desligada aparece com o motivo (nunca escondida).
import { useI18n } from 'vue-i18n';

defineProps<{
  operacoes: readonly { operacao: string; rotulo: string; ligada: boolean; motivo: string | null }[];
}>();
const { t } = useI18n();
</script>

<template>
  <ul class="estados" data-testid="estados-gravacao">
    <li v-for="o in operacoes.filter((x) => !x.ligada)" :key="o.operacao">
      <strong>{{ o.rotulo }}</strong
      >: {{ t('adm.comum.desligada', { motivo: o.motivo ?? '' }) }}
    </li>
  </ul>
</template>

<style scoped>
.estados {
  margin: 0;
  padding-left: var(--sgh-espaco-4);
  color: var(--sgh-texto-secundario);
}
</style>
