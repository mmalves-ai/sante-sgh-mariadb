<script setup lang="ts">
// W0-05 (revisão): as abas das fichas da nutrição e das especialidades, no padrão da ficha de Usuários e Acessos e da
// ficha do profissional (ARIA tablist; setas, Home e End movem a aba; a lista rola no celular com a borda em degradê).
// Os painéis ficam na tela-mãe (role="tabpanel", `v-show`), para a impressão sair com todas as abas (estilo-correcao.css).
import { nextTick, ref, watch } from 'vue';

export interface AbaFicha {
  readonly id: string;
  readonly rotulo: string;
  /** O número da aba (itens), quando faz sentido. */
  readonly n?: number | null;
}

const props = defineProps<{
  abas: readonly AbaFicha[];
  /** O prefixo dos ids: a aba é `${prefixo}-aba-${id}` e o painel, `${prefixo}-painel-${id}`. */
  prefixo: string;
  rotulo: string;
}>();
const aba = defineModel<string>({ required: true });
const lista = ref<HTMLElement | null>(null);
const botoes = ref<HTMLButtonElement[]>([]);
const antes = ref(false);
const depois = ref(false);
function medir(): void {
  const el = lista.value;
  antes.value = !!el && el.scrollLeft > 2;
  depois.value = !!el && el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
}
watch(
  lista,
  (el, _a, aoLimpar) => {
    medir();
    if (!el) return;
    el.addEventListener('scroll', medir, { passive: true });
    const obs = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(medir);
    obs?.observe(el);
    aoLimpar(() => {
      el.removeEventListener('scroll', medir);
      obs?.disconnect();
    });
  },
  { immediate: true, flush: 'post' },
);
watch(aba, () =>
  nextTick(() =>
    lista.value
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }),
  ),
);
function tecla(e: KeyboardEvent, i: number): void {
  const n = props.abas.length;
  const destino =
    e.key === 'ArrowRight'
      ? (i + 1) % n
      : e.key === 'ArrowLeft'
        ? (i - 1 + n) % n
        : e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? n - 1
            : -1;
  if (destino < 0) return;
  e.preventDefault();
  aba.value = props.abas[destino]!.id;
  void nextTick(() => botoes.value[destino]?.focus());
}
</script>

<template>
  <div
    ref="lista"
    :class="['abas', 'nao-imprimir', { 'abas--antes': antes, 'abas--depois': depois }]"
    role="tablist"
    :aria-label="rotulo"
  >
    <button
      v-for="(a, i) in abas"
      :id="`${prefixo}-aba-${a.id}`"
      :key="a.id"
      ref="botoes"
      type="button"
      role="tab"
      class="aba"
      :aria-selected="aba === a.id ? 'true' : 'false'"
      :aria-controls="`${prefixo}-painel-${a.id}`"
      :tabindex="aba === a.id ? 0 : -1"
      :data-testid="`${prefixo}-aba-${a.id}`"
      @click="aba = a.id"
      @keydown="tecla($event, i)"
    >
      {{ a.rotulo }}
      <span v-if="a.n !== undefined && a.n !== null" class="aba__n">{{ a.n }}</span>
    </button>
  </div>
</template>

<style scoped>
.abas {
  position: relative;
  display: flex;
  gap: var(--sgh-espaco-1);
  border-bottom: 1px solid var(--sgh-borda);
  overflow-x: auto;
  scrollbar-width: none;
  margin-block: var(--sgh-espaco-2);
}
.abas--depois {
  mask-image: linear-gradient(to right, var(--sgh-texto) calc(100% - 3rem), transparent);
}
.abas--antes {
  mask-image: linear-gradient(to left, var(--sgh-texto) calc(100% - 3rem), transparent);
}
.abas--antes.abas--depois {
  mask-image: linear-gradient(
    to right,
    transparent,
    var(--sgh-texto) 3rem,
    var(--sgh-texto) calc(100% - 3rem),
    transparent
  );
}
.aba {
  font: inherit;
  display: inline-flex;
  align-items: center;
  gap: var(--sgh-espaco-1);
  padding: var(--sgh-espaco-2) var(--sgh-espaco-3);
  min-height: var(--sgh-alvo-minimo);
  border: 0;
  border-bottom: 3px solid transparent;
  background: transparent;
  color: var(--sgh-texto-secundario);
  cursor: pointer;
  white-space: nowrap;
  margin-bottom: -1px;
}
.aba:hover {
  color: var(--sgh-texto);
}
.aba[aria-selected='true'] {
  color: var(--sgh-texto);
  border-bottom-color: var(--sgh-primaria);
  font-weight: 600;
}
.aba:focus-visible {
  outline: 3px solid var(--sgh-foco);
  outline-offset: -3px;
}
.aba__n {
  display: inline-grid;
  place-items: center;
  min-width: 1.5em;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--sgh-fundo-sutil);
  border: 1px solid var(--sgh-borda);
  font-size: var(--sgh-fonte-pequena);
  font-weight: 600;
  color: var(--sgh-texto);
}
@media print {
  .abas {
    display: none;
  }
}
</style>
