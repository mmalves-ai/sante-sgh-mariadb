<script setup lang="ts">
// Menu gerado dos 408 itens da árvore, filtrado por rota e permissão (regra 12), com o rótulo de produto do
// gerador (tools/matriz/src/rotulos-de-produto.ts). A fase e o selo são de planejamento: não aparecem.
// Hierárquico (pedido do dono, 22/10/2026): áreas e níveis recolhíveis, a área da tela atual aberta, o estado
// lembrado por usuário (localStorage) e o filtro "Buscar no menu" (o Ctrl+K continua sendo a paleta).
import { ARVORE_MENU } from '@sgh/contratos';
import { computed, provide, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { CONTEXTO_MENU, idDoNivel } from './menu/contexto-menu.js';
import {
  chavesAcima,
  filtrarItens,
  gravarAbertos,
  itemDaTela,
  itensVisiveis,
  lerAbertos,
  menuHierarquico,
  todasAsChaves,
} from './menu/filtro-menu.js';
import { iconeDaArea, SETA } from './menu/icones-area.js';
import MenuRamo from './menu/MenuRamo.vue';
import { usarSessao } from './sessao/sessao.js';

defineProps<{ aberto: boolean }>();
const emit = defineEmits<{ navegou: [] }>();
const { t } = useI18n();
const rota = useRoute();
const { sessao, permissoes } = usarSessao();

const visiveis = computed(() => itensVisiveis(ARVORE_MENU, permissoes.value));
const busca = ref('');
const buscando = computed(() => busca.value.trim() !== '');
const areas = computed(() => menuHierarquico(filtrarItens(visiveis.value, busca.value)));
const todas = computed(() => menuHierarquico(visiveis.value));
const ativo = computed(() => itemDaTela(visiveis.value, rota.fullPath)?.id ?? null);

// Estado aberto/fechado: o lembrado (por usuário) e, durante a busca, um à parte que começa todo aberto.
const usuario = computed(() => {
  const s = sessao.value;
  return s ? `${s.rede ?? ''}:${s.usuario.login ?? s.usuario.id}` : null;
});
const abertos = ref(new Set<string>());
const abertosNaBusca = ref(new Set<string>());

function abrirTelaAtual(): void {
  const item = visiveis.value.find((i) => i.id === ativo.value);
  if (!item) return;
  const faltam = chavesAcima(item, todas.value).filter((c) => !abertos.value.has(c));
  if (faltam.length > 0) abertos.value = new Set([...abertos.value, ...faltam]);
}

watch(
  usuario,
  (u) => {
    abertos.value = u ? lerAbertos(u) : new Set();
    abrirTelaAtual();
  },
  { immediate: true },
);
watch([ativo, todas], abrirTelaAtual);
watch(abertos, (a) => {
  if (usuario.value) gravarAbertos(usuario.value, a);
});
watch(busca, () => {
  abertosNaBusca.value = new Set(todasAsChaves(areas.value));
});

function conjunto() {
  return buscando.value ? abertosNaBusca : abertos;
}
function estaAberto(chave: string): boolean {
  return conjunto().value.has(chave);
}
function alternar(chave: string, abrir = !estaAberto(chave)): void {
  const alvo = conjunto();
  const novo = new Set(alvo.value);
  if (abrir) novo.add(chave);
  else novo.delete(chave);
  alvo.value = novo;
}
function recolherTudo(): void {
  conjunto().value = new Set();
}

provide(CONTEXTO_MENU, {
  aberto: estaAberto,
  alternar: (chave) => alternar(chave),
  ativo: () => ativo.value,
  navegou: () => emit('navegou'),
});

// Teclado: setas sobem e descem entre níveis e itens; à direita abre (ou entra), à esquerda fecha (ou volta ao
// nível de cima); Home e End vão ao primeiro e ao último. Enter e Espaço são do próprio botão.
const navegacao = ref<HTMLElement | null>(null);
function focaveis(): HTMLElement[] {
  return [...(navegacao.value?.querySelectorAll<HTMLElement>('[data-menu-foco]') ?? [])];
}
function nivelAcima(el: HTMLElement): HTMLElement | null {
  const contem = el.closest('li')?.parentElement?.parentElement;
  return (
    contem?.querySelector<HTMLElement>(':scope > [data-menu-foco], :scope > h2 > [data-menu-foco]') ?? null
  );
}
function teclar(e: KeyboardEvent): void {
  const el = e.target as HTMLElement;
  if (el.matches('input')) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focaveis()[0]?.focus();
    } else if (e.key === 'Escape' && busca.value) {
      e.preventDefault();
      busca.value = '';
    }
    return;
  }
  if (!el.matches('[data-menu-foco]')) return;
  const lista = focaveis();
  const i = lista.indexOf(el);
  const chave = el.dataset['chave'];
  const expandido = el.getAttribute('aria-expanded');
  let destino: HTMLElement | null | undefined;
  switch (e.key) {
    case 'ArrowDown':
      destino = lista[i + 1];
      break;
    case 'ArrowUp':
      destino = i === 0 ? navegacao.value?.querySelector<HTMLElement>('input') : lista[i - 1];
      break;
    case 'Home':
      destino = lista[0];
      break;
    case 'End':
      destino = lista.at(-1);
      break;
    case 'ArrowRight':
      if (chave && expandido === 'false') alternar(chave, true);
      else if (chave) destino = lista[i + 1];
      break;
    case 'ArrowLeft':
      if (chave && expandido === 'true') alternar(chave, false);
      else destino = nivelAcima(el);
      break;
    default:
      return;
  }
  e.preventDefault();
  destino?.focus();
}
</script>

<template>
  <nav
    id="menu-principal"
    ref="navegacao"
    class="menu"
    :class="{ 'menu--aberto': aberto }"
    :aria-label="t('casca.menu')"
    @keydown="teclar"
  >
    <div v-if="todas.length > 0" class="menu__topo">
      <label class="sgh-visualmente-oculto" for="menu-buscar">{{ t('casca.menuBuscar') }}</label>
      <input
        id="menu-buscar"
        v-model="busca"
        class="menu__busca"
        type="search"
        autocomplete="off"
        :placeholder="t('casca.menuBuscar')"
      />
      <button
        type="button"
        class="menu__recolher"
        data-testid="menu-recolher"
        :aria-label="t('casca.menuRecolherTudo')"
        :title="t('casca.menuRecolherTudo')"
        @click="recolherTudo"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M7 11l5-5 5 5M7 18l5-5 5 5" />
        </svg>
      </button>
    </div>
    <p v-if="todas.length === 0" class="menu__vazio">{{ t('casca.menuVazio') }}</p>
    <p v-else-if="areas.length === 0" class="menu__vazio" role="status">
      {{ t('casca.menuNada', { termo: busca.trim() }) }}
    </p>
    <section v-for="a in areas" :key="a.chave" class="menu__area">
      <h2 class="menu__titulo">
        <button
          type="button"
          class="menu__cabecalho"
          data-menu-foco
          :data-chave="a.chave"
          :data-area="a.area"
          :aria-expanded="estaAberto(a.chave)"
          :aria-controls="idDoNivel(a.chave)"
          @click="alternar(a.chave)"
        >
          <svg class="menu__icone" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path :d="iconeDaArea(a.area)" />
          </svg>
          <span class="menu__nome">{{ a.rotulo }}</span>
          <span class="menu__contagem" aria-hidden="true">{{ a.total }}</span>
          <span class="sgh-visualmente-oculto">{{ t('casca.menuItens', a.total) }}</span>
          <svg class="menu__seta" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path :d="SETA" />
          </svg>
        </button>
      </h2>
      <MenuRamo v-if="estaAberto(a.chave)" :id="idDoNivel(a.chave)" :nos="a.filhos" :nivel="1" />
    </section>
  </nav>
</template>

<style scoped>
.menu {
  background: var(--sgh-fundo-sutil);
  border-right: 1px solid var(--sgh-borda);
  padding: 0 var(--sgh-espaco-2) var(--sgh-espaco-3);
  overflow-y: auto;
}
/* Busca no topo, presa ao rolar o menu. */
.menu__topo {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  gap: var(--sgh-espaco-1);
  padding: var(--sgh-espaco-2) 0;
  background: var(--sgh-fundo-sutil);
}
.menu__busca {
  flex: 1;
  min-width: 0;
  min-height: var(--sgh-alvo-minimo);
  padding: 0 var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda-forte);
  border-radius: 4px;
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
  font: inherit;
}
.menu__busca::placeholder {
  color: var(--sgh-texto-secundario);
  opacity: 1;
}
.menu__recolher {
  flex: none;
  display: grid;
  place-items: center;
  width: var(--sgh-alvo-minimo);
  min-height: var(--sgh-alvo-minimo);
  border: 1px solid var(--sgh-borda-forte);
  border-radius: 4px;
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
  cursor: pointer;
}
.menu__recolher:hover {
  background: var(--sgh-primaria-suave);
}
.menu__recolher svg,
.menu__icone,
.menu__seta {
  flex: none;
  width: 1.25rem;
  height: 1.25rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
/* Áreas separadas por espaço e uma linha sutil. */
.menu__area {
  padding: var(--sgh-espaco-1) 0;
}
.menu__area + .menu__area {
  border-top: 1px solid var(--sgh-borda);
}
.menu__titulo {
  margin: 0;
  font-size: inherit;
}
.menu__cabecalho {
  display: flex;
  align-items: center;
  gap: var(--sgh-espaco-2);
  width: 100%;
  min-height: var(--sgh-alvo-minimo);
  padding: 0 var(--sgh-espaco-1);
  border: 0;
  border-radius: 4px;
  background: none;
  color: var(--sgh-texto);
  font: inherit;
  font-weight: 700;
  text-align: left;
  cursor: pointer;
}
.menu__cabecalho:hover {
  background: var(--sgh-primaria-suave);
}
.menu__icone {
  color: var(--sgh-primaria);
}
.menu__nome {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.menu__contagem {
  flex: none;
  font-size: var(--sgh-fonte-pequena);
  font-weight: 400;
  color: var(--sgh-texto-secundario);
}
.menu__seta {
  width: 1rem;
  height: 1rem;
  stroke-width: 2.5;
  color: var(--sgh-texto-secundario);
  transition: transform 0.15s ease;
}
.menu__cabecalho[aria-expanded='true'] .menu__seta {
  transform: rotate(90deg);
}
.menu__vazio {
  color: var(--sgh-texto-secundario);
  padding: 0 var(--sgh-espaco-1);
}
@media (prefers-reduced-motion: reduce) {
  .menu__seta {
    transition: none;
  }
}
@media (max-width: 63.99rem) {
  .menu {
    display: none;
  }
  .menu--aberto {
    display: block;
  }
}
</style>
