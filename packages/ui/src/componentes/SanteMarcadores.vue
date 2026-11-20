<script setup lang="ts" generic="V extends string | number">
// Seleção múltipla (caixas de marcar num fieldset), igual em todo o sistema. Regra dos combos (ADR 0027): lista grande
// (mais de LIMIAR_BUSCA opções) ganha a caixa de busca no topo, com a mesma busca da seleção simples (sem acento, sem
// caixa, por palavras em qualquer ordem). Os marcados ficam sempre visíveis, mesmo fora da busca, para a pessoa nunca
// perder de vista o que vai gravar; a lista rola dentro do próprio quadro (centenas de opções não esticam a tela).
// Para os testes: cada caixa leva `data-valor`.
import { computed, ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import { LIMIAR_BUSCA, filtrarOpcoes } from './selecao.js';

type Opcao = { readonly valor: V; readonly rotulo: string };

const props = withDefaults(
  defineProps<{
    legenda: string;
    opcoes: readonly Opcao[];
    desabilitado?: boolean;
    /** Força a busca ligada ou desligada; sem valor, ela aparece só em lista grande. */
    busca?: boolean | undefined;
  }>(),
  { busca: undefined },
);
const valor = defineModel<V[]>({ required: true });
const { t } = useI18n();
const id = `sgh-marcadores-${useId()}`;
const termo = ref('');
const comBusca = computed(() => props.busca ?? props.opcoes.length > LIMIAR_BUSCA);
const visiveis = computed(() => {
  if (!comBusca.value || !termo.value.trim()) return props.opcoes;
  const achadas = new Set(filtrarOpcoes(props.opcoes, termo.value).map((o) => o.valor));
  return props.opcoes.filter((o) => achadas.has(o.valor) || valor.value.includes(o.valor));
});
const semResultado = computed(
  () => comBusca.value && termo.value.trim() !== '' && visiveis.value.length === 0,
);

function alternar(v: V, marcado: boolean): void {
  const sem = valor.value.filter((x) => x !== v);
  valor.value = marcado ? [...sem, v] : sem;
}
</script>

<template>
  <fieldset class="sgh-marcadores" :disabled="desabilitado">
    <legend class="sgh-marcadores__legenda">{{ legenda }}</legend>
    <span v-if="comBusca" class="sgh-marcadores__busca">
      <label :for="`${id}-busca`" class="sgh-visualmente-oculto">{{ t('ui.selecao.buscar') }}</label>
      <input
        :id="`${id}-busca`"
        v-model="termo"
        type="search"
        role="searchbox"
        autocomplete="off"
        :placeholder="t('ui.selecao.buscar')"
        class="sgh-marcadores__caixa"
      />
      <span class="sgh-marcadores__contagem" aria-live="polite">{{
        t('ui.marcadores.marcados', { n: valor.length }, valor.length)
      }}</span>
    </span>
    <p v-if="opcoes.length === 0" class="sgh-marcadores__vazio">{{ t('ui.selecao.semOpcoes') }}</p>
    <p v-else-if="semResultado" class="sgh-marcadores__vazio">{{ t('ui.selecao.semResultado') }}</p>
    <div class="sgh-marcadores__lista">
      <label v-for="o in visiveis" :key="String(o.valor)" class="sgh-marcadores__opcao">
        <input
          type="checkbox"
          :checked="valor.includes(o.valor)"
          :data-valor="String(o.valor)"
          @change="alternar(o.valor, ($event.target as HTMLInputElement).checked)"
        />
        <span>{{ o.rotulo }}</span>
      </label>
    </div>
  </fieldset>
</template>

<style scoped>
.sgh-marcadores {
  border: 1px solid var(--sgh-borda);
  border-radius: 6px;
  padding: var(--sgh-espaco-2) var(--sgh-espaco-3);
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
}
.sgh-marcadores__legenda {
  font-weight: 600;
  padding: 0 var(--sgh-espaco-1);
}
.sgh-marcadores__busca {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sgh-espaco-2);
}
.sgh-marcadores__caixa {
  min-height: var(--sgh-alvo-minimo);
  min-width: 14rem;
  padding: 0 var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda);
  border-radius: 4px;
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
.sgh-marcadores__caixa:focus-visible,
.sgh-marcadores__opcao input:focus-visible {
  outline: 2px solid var(--sgh-foco);
  outline-offset: 2px;
}
.sgh-marcadores__lista {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-1) var(--sgh-espaco-4);
  max-height: 18rem;
  overflow-y: auto;
}
.sgh-marcadores__opcao {
  display: inline-flex;
  align-items: center;
  gap: var(--sgh-espaco-1);
  min-height: var(--sgh-alvo-minimo);
  cursor: pointer;
}
.sgh-marcadores__opcao input {
  width: 1.1em;
  height: 1.1em;
  accent-color: var(--sgh-primaria);
}
.sgh-marcadores__vazio {
  margin: 0;
}
</style>
