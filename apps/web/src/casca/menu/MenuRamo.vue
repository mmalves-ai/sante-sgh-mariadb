<script setup lang="ts">
// Um nível do menu (lista de itens e de níveis recolhíveis), recursivo. O estado aberto/fechado, o item da
// tela atual e a navegação vêm do MenuLateral (provide/inject), para a recursão não carregar props.
import { inject } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { CONTEXTO_MENU, idDoNivel, type ContextoMenu } from './contexto-menu.js';
import type { NoMenu } from './filtro-menu.js';
import { SETA } from './icones-area.js';

defineProps<{ nos: readonly NoMenu[]; nivel: number; id: string }>();
const { t } = useI18n();
const ctx = inject(CONTEXTO_MENU) as ContextoMenu;
</script>

<template>
  <ul :id="id" class="menu-ramo" :class="`menu-ramo--n${nivel}`">
    <li v-for="n in nos" :key="n.tipo === 'ramo' ? n.chave : n.item.id">
      <template v-if="n.tipo === 'ramo'">
        <button
          type="button"
          class="menu-ramo__nivel"
          data-menu-foco
          :data-chave="n.chave"
          :aria-expanded="ctx.aberto(n.chave)"
          :aria-controls="idDoNivel(n.chave)"
          :title="n.rotulo"
          @click="ctx.alternar(n.chave)"
        >
          <svg class="menu-ramo__seta" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path :d="SETA" />
          </svg>
          <span class="menu-ramo__texto">{{ n.rotulo }}</span>
          <span class="menu-ramo__contagem" aria-hidden="true">{{ n.total }}</span>
          <span class="sgh-visualmente-oculto">{{ t('casca.menuItens', n.total) }}</span>
        </button>
        <MenuRamo v-if="ctx.aberto(n.chave)" :id="idDoNivel(n.chave)" :nos="n.filhos" :nivel="nivel + 1" />
      </template>
      <RouterLink v-else v-slot="{ href, navigate }" :to="n.item.rota!" custom>
        <a
          :href="href"
          class="menu-ramo__item"
          :class="{ 'menu-ramo__item--ativo': ctx.ativo() === n.item.id }"
          :aria-current="ctx.ativo() === n.item.id ? 'page' : undefined"
          :title="n.item.caminho.join(' › ')"
          :data-item="n.item.id"
          data-menu-foco
          @click="
            navigate($event);
            ctx.navegou();
          "
        >
          <span class="menu-ramo__texto">{{ n.item.titulo }}</span>
        </a>
      </RouterLink>
    </li>
  </ul>
</template>

<style scoped>
/* Cada nível: recuo curto com uma linha-guia vertical sob a seta (ou o ícone da área) do nível de cima. */
.menu-ramo {
  list-style: none;
  margin: 0 0 0 calc(var(--sgh-espaco-1) + 0.5rem);
  padding: 0 0 0 2px;
  border-left: 1px solid var(--sgh-borda);
}
.menu-ramo__nivel,
.menu-ramo__item {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--sgh-espaco-1);
  width: 100%;
  min-height: var(--sgh-alvo-minimo);
  padding: 0 var(--sgh-espaco-2);
  border: 0;
  border-radius: 4px;
  background: none;
  color: var(--sgh-texto);
  font: inherit;
  text-align: left;
  text-decoration: none;
  cursor: pointer;
}
.menu-ramo__nivel {
  padding-left: var(--sgh-espaco-1);
  color: var(--sgh-texto-secundario);
  font-weight: 600;
}
.menu-ramo__nivel:hover,
.menu-ramo__item:hover {
  background: var(--sgh-primaria-suave);
  color: var(--sgh-texto);
}
.menu-ramo__item--ativo {
  background: var(--sgh-primaria-suave);
  font-weight: 700;
}
/* Barra lateral na cor da marca no item da tela atual. */
.menu-ramo__item--ativo::before {
  content: '';
  position: absolute;
  inset: 4px auto 4px 0;
  width: 3px;
  border-radius: 2px;
  background: var(--sgh-primaria);
}
.menu-ramo__texto {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.menu-ramo__seta {
  flex: none;
  width: 1rem;
  height: 1rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 2.5;
  stroke-linecap: round;
  stroke-linejoin: round;
  transition: transform 0.15s ease;
}
.menu-ramo__nivel[aria-expanded='true'] .menu-ramo__seta {
  transform: rotate(90deg);
}
.menu-ramo__contagem {
  flex: none;
  font-size: var(--sgh-fonte-pequena);
  font-weight: 400;
  color: var(--sgh-texto-secundario);
}
@media (prefers-reduced-motion: reduce) {
  .menu-ramo__seta {
    transition: none;
  }
}
</style>
