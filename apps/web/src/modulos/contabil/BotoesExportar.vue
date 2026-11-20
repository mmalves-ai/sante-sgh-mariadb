<script setup lang="ts">
// Exportar a demonstração consultada em PDF/A ou XLSX (M54.3; ficha, seção 7). O arquivo é gerado no servidor com o
// mesmo filtro da tela (o diário sai inteiro, nunca cortado pela página) e a leitura fica registrada.
import { SanteBotao } from '@sgh/ui';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroContabil from './ErroContabil.vue';
import {
  exportarDemonstracao,
  type FiltroExportacao,
  type FormatoExportacao,
  salvarArquivo,
} from './api-demonstracoes.js';

const props = defineProps<{ filtro: FiltroExportacao }>();
const { t } = useI18n();
const ocupado = ref<FormatoExportacao | null>(null);
const erro = ref<unknown>(null);
async function exportar(formato: FormatoExportacao) {
  ocupado.value = formato;
  erro.value = null;
  try {
    salvarArquivo(await exportarDemonstracao(props.filtro, formato));
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = null;
  }
}
</script>

<template>
  <div class="acoes" :data-testid="`exportar-${filtro.tipo}`">
    <SanteBotao
      variante="secundario"
      :rotulo="
        ocupado === 'pdf' ? t('contabil.demonstracoes.exportando') : t('contabil.demonstracoes.exportarPdf')
      "
      :desabilitado="ocupado !== null"
      :data-testid="`exportar-${filtro.tipo}-pdf`"
      @acionar="exportar('pdf')"
    />
    <SanteBotao
      variante="secundario"
      :rotulo="
        ocupado === 'xlsx' ? t('contabil.demonstracoes.exportando') : t('contabil.demonstracoes.exportarXlsx')
      "
      :desabilitado="ocupado !== null"
      :data-testid="`exportar-${filtro.tipo}-xlsx`"
      @acionar="exportar('xlsx')"
    />
  </div>
  <ErroContabil v-if="erro" :erro="erro" />
</template>

<style scoped src="./estilo-contabil.css"></style>
