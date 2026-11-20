<script setup lang="ts" generic="V extends string | number | null">
// Seleção simples, igual em todo o sistema (Select do OpenVue, DP-51), com a busca embutida na lista.
// Regra dos combos (ADR 0027): lista grande (mais de LIMIAR_BUSCA opções) ganha a caixa de busca no topo da
// própria lista. A busca é a nossa (sem acento, sem caixa, por palavras em qualquer ordem): o filtro interno
// do OpenVue só compara o texto inteiro, então cada opção leva o termo atual num campo próprio (`__termo`) e o
// filtro interno sempre passa; quem filtra de fato é filtrarOpcoes.
// Para os testes: o invólucro leva `data-valor` (valor atual) e cada opção leva `data-valor` (ver e2e/combos.ts).
import Select from 'openvue/select';
import { computed, ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import { LIMIAR_BUSCA, filtrarOpcoes } from './selecao.js';

type Opcao = { readonly valor: V; readonly rotulo: string; readonly desabilitada?: boolean };

// `busca` sem valor fica undefined (o default explícito desliga a conversão booleana do Vue para false).
const props = withDefaults(
  defineProps<{
    rotulo: string;
    opcoes: readonly Opcao[];
    ocultarRotulo?: boolean;
    desabilitado?: boolean;
    /** Campo obrigatório: anunciado ao leitor de tela; a tela confere antes de gravar. */
    obrigatorio?: boolean;
    /** Força a busca ligada ou desligada; sem valor, ela aparece só em lista grande. */
    busca?: boolean | undefined;
  }>(),
  { busca: undefined },
);
const valor = defineModel<V>({ required: true });
const { t } = useI18n();
const id = `sgh-selecao-${useId()}`;
const termo = ref('');

/** Valor vazio (null ou ''): o OpenVue mostra o placeholder, então ele recebe o rótulo dessa opção. */
const vazio = (v: unknown) => v === null || v === '';
const comBusca = computed(() => props.busca ?? props.opcoes.length > LIMIAR_BUSCA);
const visiveis = computed(() =>
  (comBusca.value ? filtrarOpcoes(props.opcoes, termo.value) : props.opcoes).map((o) => ({
    ...o,
    __termo: termo.value,
  })),
);
const textoVazio = computed(() => props.opcoes.find((o) => vazio(o.valor))?.rotulo ?? '');
const valorDoTeste = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const aoFiltrar = (e: { value: string }) => {
  termo.value = e.value;
};
</script>

<template>
  <span class="sgh-selecao" :data-valor="valorDoTeste(valor)">
    <span
      :id="`${id}-rotulo`"
      :class="['sgh-selecao__rotulo', { 'sgh-visualmente-oculto': ocultarRotulo }]"
      >{{ rotulo }}</span
    >
    <Select
      v-model="valor"
      class="sgh-selecao__campo"
      :options="visiveis"
      option-label="rotulo"
      option-value="valor"
      option-disabled="desabilitada"
      :placeholder="textoVazio"
      :disabled="desabilitado"
      :aria-labelledby="`${id}-rotulo`"
      :filter="comBusca"
      :filter-fields="['__termo']"
      filter-match-mode="contains"
      :filter-placeholder="t('ui.selecao.buscar')"
      :empty-filter-message="t('ui.selecao.semResultado')"
      :empty-message="t('ui.selecao.semOpcoes')"
      reset-filter-on-hide
      auto-filter-focus
      :pt="{
        label: { 'aria-required': obrigatorio ? 'true' : undefined },
        pcFilter: { root: { 'aria-label': t('ui.selecao.buscar') } },
      }"
      @filter="aoFiltrar"
      @hide="termo = ''"
    >
      <template #option="{ option }">
        <span :data-valor="valorDoTeste(option.valor)">{{ option.rotulo }}</span>
      </template>
    </Select>
  </span>
</template>

<style scoped>
.sgh-selecao {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
}
.sgh-selecao__campo {
  min-height: var(--sgh-alvo-minimo);
  min-width: 10rem;
}
/* O valor escolhido na cor do texto; só o "Escolha…" (placeholder) fica no cinza do tema. */
.sgh-selecao__campo :deep(.p-select-label:not(.p-placeholder)) {
  color: var(--sgh-texto);
}
</style>
