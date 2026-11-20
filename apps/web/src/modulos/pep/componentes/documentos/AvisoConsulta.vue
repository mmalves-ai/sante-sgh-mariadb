<script setup lang="ts">
// A ação fica em consulta (permissão, liberação do estabelecimento ou categoria): o motivo, em texto.
import type { AcaoLiberada } from '@sgh/contratos';
import { SanteAlerta } from '@sgh/ui';
import { useI18n } from 'vue-i18n';

defineProps<{ acao: AcaoLiberada }>();
const { t } = useI18n();
</script>

<template>
  <SanteAlerta
    v-if="!acao.pode"
    variante="info"
    :texto="t('pep.doc.consulta', { motivo: acao.motivo ?? '' })"
    data-testid="aviso-consulta"
  />
</template>
