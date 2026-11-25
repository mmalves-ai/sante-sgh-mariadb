<script setup lang="ts">
// Atalho para a equipe assistencial do atendimento em uso (03-PEP L94) no cabeçalho do prontuário: um clique leva a
// quem cuida do paciente agora (incluir, aplicar a equipe padrão do setor, saída com motivo).
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { pode } from '../../../casca/sessao/pode.js';

const props = defineProps<{ atendimento?: number | null }>();
const { t } = useI18n();
const visivel = computed(
  () => !!props.atendimento && (pode('pep.painel.ler') || pode('pep.equipe.gerenciar')),
);
</script>

<template>
  <RouterLink v-if="visivel" :to="`/pep/equipe/${atendimento}`" data-testid="atalho-equipe-assistencial">{{
    t('pep.equipe.atalho')
  }}</RouterLink>
</template>
