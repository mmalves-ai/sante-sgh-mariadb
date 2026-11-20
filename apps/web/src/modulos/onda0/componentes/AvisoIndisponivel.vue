<script setup lang="ts">
// Contingência da onda 0 (ficha do M38, regra 7): se o Sante SGH não responde (rede, 502, 503, 504), os painéis
// dizem que nesta etapa ele é só de consulta e que nenhum registro do hospital depende dele. Texto de produto
// (ADR 0023): não aponta para outro sistema. A consulta recusada por estar fora do escopo da onda (regra 3) ganha o
// aviso próprio.
import { SanteAlerta } from '@sgh/ui';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { foraDoEscopo, indisponivel } from '../indisponivel.js';

const props = defineProps<{ erro: unknown }>();
const { t } = useI18n();
const mostrar = computed(() => indisponivel(props.erro));
const fora = computed(() => foraDoEscopo(props.erro));
</script>

<template>
  <SanteAlerta
    v-if="mostrar"
    :texto="t('liberacao.onda0.indisponivel')"
    variante="aviso"
    data-testid="aviso-indisponivel-onda0"
  />
  <SanteAlerta
    v-else-if="fora"
    :texto="t('liberacao.onda0.foraDoEscopo')"
    variante="info"
    icone="info"
    data-testid="aviso-fora-do-escopo-onda0"
  />
</template>
