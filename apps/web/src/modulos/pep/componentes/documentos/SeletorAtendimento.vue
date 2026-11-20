<script setup lang="ts">
// Escolha do atendimento do documento (o aberto mais recente vem escolhido).
import type { AtendimentoPep } from '@sgh/contratos';
import { SanteSelecao } from '@sgh/ui';
import { computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { dataHoraBr } from '../../formato.js';

const props = defineProps<{ atendimentos: readonly AtendimentoPep[]; soAbertos?: boolean }>();
const valor = defineModel<number | null>({ required: true });
const { t } = useI18n();
const opcoes = computed(() =>
  props.atendimentos
    .filter((x) => !props.soAbertos || x.aberto)
    .map((a) => ({
      valor: a.id as number | null,
      rotulo: t('pep.doc.atendimentoItem', {
        tipo: t(`pep.doc.${a.tipo}`),
        numero: a.registro,
        entrada: dataHoraBr(a.entrada),
      }),
    })),
);
onMounted(() => {
  if (valor.value === null)
    valor.value = props.atendimentos.find((a) => a.aberto)?.id ?? props.atendimentos[0]?.id ?? null;
});
</script>

<template>
  <SanteSelecao
    v-model="valor"
    class="campo"
    :rotulo="t('pep.doc.atendimento')"
    :opcoes="opcoes"
    data-testid="seletor-atendimento"
  />
</template>

<style scoped>
.campo {
  flex-direction: column;
  align-items: stretch;
  gap: var(--sgh-espaco-1);
}
</style>
