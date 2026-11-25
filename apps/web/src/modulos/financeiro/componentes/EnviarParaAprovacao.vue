<script setup lang="ts">
// Botão "Enviar para aprovação" (F8, 07-FIN linha 65): envia o título a pagar, o pedido de compra ou o contrato ao
// fluxo de aprovação configurável que o atende. Aparece só com a permissão financeiro.fluxoAprovacao.submeter; a
// mensagem do servidor diz a etapa aberta (ou, no título sem fluxo, que segue a alçada simples). Um clique, sem tela.
import type { DocumentoAprovavel } from '@sgh/dominio-financeiro';
import { useQueryClient } from '@tanstack/vue-query';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import { submeterParaAprovacao } from '../api-fluxo-aprovacao.js';
import { novaChave } from '../api-financeiro.js';

const props = defineProps<{ tipo: DocumentoAprovavel; documento: number }>();
const { t } = useI18n();
const qc = useQueryClient();
const { permissoes } = usarSessao();
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const enviando = ref(false);
let chave = novaChave('fluxo-aprov-env');

async function enviar() {
  if (enviando.value) return;
  erro.value = null;
  mensagem.value = null;
  enviando.value = true;
  try {
    mensagem.value =
      (await submeterParaAprovacao(props.tipo, props.documento, chave)).mensagem ||
      t('financeiro.fluxoAprovacao.enviado');
    chave = novaChave('fluxo-aprov-env');
    await qc.invalidateQueries();
  } catch (e) {
    erro.value = e;
  } finally {
    enviando.value = false;
  }
}
</script>

<template>
  <span v-if="permissoes.has('financeiro.fluxoAprovacao.submeter')" class="enviar-aprovacao">
    <button
      type="button"
      class="secundario"
      :disabled="enviando"
      :data-testid="`enviar-aprovacao-${tipo}-${documento}`"
      @click="enviar"
    >
      {{ t('financeiro.fluxoAprovacao.enviar') }}
    </button>
    <span v-if="mensagem" role="status">{{ mensagem }}</span>
    <ErroFaturamento v-if="erro" :erro="erro" />
  </span>
</template>
