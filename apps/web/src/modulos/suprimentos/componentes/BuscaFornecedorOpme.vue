<script setup lang="ts">
// A busca do fornecedor no cadastro (nome ou código) para o OPME, e a escolha numa SanteSelecao com busca (ADR 0027): o
// código só chega ao formulário depois de achado no cadastro; o servidor confere de novo que o fornecedor existe.
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { computed, ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import { buscarFornecedoresOpme } from '../api-opme.js';

const props = defineProps<{ rotulo: string; testid: string }>();
const valor = defineModel<number | null>({ required: true });
const { t } = useI18n();
const id = useId();
const termo = ref('');
const achados = ref<{ codigo: number; nome: string }[] | null>(null);
const cortada = ref(false);
const erro = ref(false);

async function buscar(): Promise<void> {
  erro.value = false;
  try {
    const r = await buscarFornecedoresOpme(termo.value.trim());
    achados.value = r.itens;
    cortada.value = r.cortada;
    if (valor.value !== null && !r.itens.some((f) => f.codigo === valor.value)) valor.value = null;
  } catch {
    erro.value = true;
  }
}
const opcoes = computed(() => [
  { valor: null as number | null, rotulo: t('opme.solicitacoes.semFornecedor') },
  ...(achados.value ?? []).map((f) => ({
    valor: f.codigo as number | null,
    rotulo: `${f.codigo} · ${f.nome}`,
  })),
]);
const tid = (s: string) => `${props.testid}-${s}`;
</script>

<template>
  <span class="campo">
    <label :for="`forn-${id}`">{{ rotulo }}</label>
    <input
      :id="`forn-${id}`"
      v-model="termo"
      type="search"
      maxlength="60"
      :data-testid="tid('termo')"
      @keyup.enter="buscar"
    />
  </span>
  <SanteBotao
    variante="secundario"
    :rotulo="t('opme.solicitacoes.buscarFornecedor')"
    :data-testid="tid('buscar')"
    @acionar="buscar"
  />
  <SanteSelecao
    v-if="achados"
    v-model="valor"
    :rotulo="t('opme.solicitacoes.fornecedorEscolhido')"
    :opcoes="opcoes"
    :busca="true"
    :data-testid="testid"
  />
  <p v-if="achados && achados.length === 0" role="status">{{ t('opme.solicitacoes.fornecedorNenhum') }}</p>
  <p v-if="cortada" class="secundario">{{ t('opme.solicitacoes.fornecedorCortada') }}</p>
  <p v-if="erro" role="alert">{{ t('opme.solicitacoes.fornecedorErro') }}</p>
</template>
