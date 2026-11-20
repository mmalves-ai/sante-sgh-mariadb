<script setup lang="ts">
import { computed } from 'vue';
import { HISTORIAS } from './historias.js';

const props = defineProps<{ historia: string | null }>();
const visiveis = computed(() =>
  props.historia ? HISTORIAS.filter((h) => h.id === props.historia) : HISTORIAS,
);
</script>

<template>
  <main class="cat">
    <h1>Catálogo de componentes do @sgh/ui</h1>
    <p class="cat-nota">Ferramenta interna (nunca publicada). Dados sintéticos.</p>
    <section v-for="h in visiveis" :key="h.id" class="cat-historia" :data-historia="h.id">
      <h2>
        {{ h.titulo }} <code>{{ h.componente }}</code>
      </h2>
      <div class="cat-palco"><component :is="{ render: h.render }" /></div>
    </section>
  </main>
</template>

<style>
.cat {
  padding: var(--sgh-espaco-4);
  max-width: 72rem;
}
.cat-nota {
  color: var(--sgh-texto-secundario);
}
.cat-historia {
  border-top: 1px solid var(--sgh-borda);
  padding: var(--sgh-espaco-3) 0;
}
.cat-palco {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-3);
  align-items: flex-start;
}
.cat-palco > .sgh-campo,
.cat-palco > .sgh-tabela,
.cat-palco > .sgh-paciente {
  flex: 1 1 100%;
}
.cat-icone {
  display: inline-flex;
  align-items: center;
  gap: var(--sgh-espaco-1);
  min-width: 9rem;
}
</style>
