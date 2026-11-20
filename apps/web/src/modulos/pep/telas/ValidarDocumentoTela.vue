<script setup lang="ts">
// Validação pública do documento pelo QR (ficha do M23, seção 7): `/validar/:documento`. Só a existência, a data,
// a via e o hash; nenhum conteúdo clínico.
import { SanteAlerta } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { validarDocumento } from '../api-documentos.js';
import { dataHoraBr } from '../formato.js';

const props = defineProps<{ documento: string }>();
const { t } = useI18n();
const v = useQuery({
  queryKey: computed(() => ['validar', props.documento]),
  queryFn: async () => {
    const r = (await validarDocumento(props.documento)) as {
      existe: boolean;
      emitidoEm?: string;
      via?: number;
      sha256?: string;
    };
    if (!r.existe) throw new Error('inexistente');
    return r;
  },
  retry: false,
});
</script>

<template>
  <main class="aba" aria-labelledby="validar-titulo" data-testid="tela-validar">
    <h1 id="validar-titulo">{{ t('pep.doc.validar.titulo') }}</h1>
    <p>{{ t('pep.doc.validar.texto') }}</p>
    <SanteAlerta v-if="v.isError.value" variante="aviso" :texto="t('pep.doc.validar.invalido')" />
    <p v-else-if="!v.data.value" role="status">{{ t('pep.doc.carregando') }}</p>
    <template v-else>
      <SanteAlerta
        variante="info"
        :texto="
          t('pep.doc.validar.valido', {
            data: dataHoraBr(v.data.value.emitidoEm ?? ''),
            via: v.data.value.via ?? 1,
          })
        "
      />
      <p v-if="v.data.value.sha256">{{ t('pep.doc.documento.prova', { hash: v.data.value.sha256 }) }}</p>
    </template>
  </main>
</template>

<style scoped src="./abas/abas.css"></style>
