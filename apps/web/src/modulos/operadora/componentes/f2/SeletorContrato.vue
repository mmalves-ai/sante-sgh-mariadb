<script setup lang="ts">
// Escolha do contrato da operadora (M56, etapa 3, F2): os contratos da operadora (a primeira página, com a busca da
// seleção) e a busca pelo número no servidor quando a carteira passa da página. O documento do contratante sai
// mascarado (a lista de contratos da F1, leitura auditada).
import { SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { lerContratosOperadora } from '../../api-operadora.js';

const props = withDefaults(
  defineProps<{ operadora: number; rotulo: string; vazio?: string | null; testid?: string }>(),
  { vazio: null, testid: 'seletor-contrato' },
);
const contrato = defineModel<number | null>({ required: true });
const { t } = useI18n();
const busca = ref('');
const filtro = ref<string | null>(null);
const q = useQuery({
  queryKey: computed(() => ['operadora', 'contratos', 'seletor', props.operadora, filtro.value]),
  queryFn: () => lerContratosOperadora({ operadora: props.operadora, busca: filtro.value }),
});
const opcoes = computed(() => [
  ...(props.vazio !== null ? [{ valor: null as number | null, rotulo: props.vazio }] : []),
  ...(q.data.value?.itens ?? []).map((c) => ({
    valor: c.id as number | null,
    rotulo: `${c.numero} · ${c.contratanteNome} (${c.contratanteDocumento})`,
  })),
]);
</script>

<template>
  <div class="campos" :data-testid="testid">
    <SanteSelecao
      v-model="contrato"
      :rotulo="rotulo"
      :opcoes="opcoes"
      busca
      :data-testid="`${testid}-escolha`"
    />
    <SanteCampoTexto v-model="busca" :rotulo="t('operadoraCobranca.filtro.contrato')" :max-bytes="20" />
    <div class="acoes">
      <SanteBotao
        :rotulo="t('operadoraCobranca.filtro.buscar')"
        variante="texto"
        :data-testid="`${testid}-buscar`"
        @acionar="filtro = busca.trim() || null"
      />
    </div>
  </div>
</template>

<style scoped src="../../estilo-operadora.css"></style>
