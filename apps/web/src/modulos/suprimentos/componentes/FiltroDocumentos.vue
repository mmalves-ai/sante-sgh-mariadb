<script setup lang="ts">
// Filtros das listas de documentos (local, início e fim) e a navegação entre as páginas de 200.
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { usarSuprimentos } from '../usar-suprimentos.js';
import type { FiltroLista } from './usar-lista-documentos.js';

const props = defineProps<{ prefixo: string; haSeguinte: boolean }>();
const filtro = defineModel<FiltroLista>('filtro', { required: true });
const pagina = defineModel<number>('pagina', { required: true });
const { t } = useI18n();
const { locais } = usarSuprimentos();
const opcoes = computed(() => [
  { valor: '', rotulo: t('suprimentos.todos') },
  ...locais.value.map((l) => ({ valor: String(l.codigo), rotulo: l.nome })),
]);
const id = (c: string) => `${props.prefixo}-filtro-${c}`;
</script>

<template>
  <div class="filtros" :data-testid="`${prefixo}-filtros`">
    <SanteSelecao
      :model-value="filtro.local"
      :rotulo="t('suprimentos.local')"
      :opcoes="opcoes"
      :data-testid="id('local')"
      @update:model-value="(v: string) => (filtro = { ...filtro, local: v })"
    />
    <span class="campo">
      <label :for="id('inicio')">{{ t('suprimentos.listaDocumentos.inicio') }}</label>
      <input
        :id="id('inicio')"
        :value="filtro.inicio"
        type="date"
        :data-testid="id('inicio')"
        @change="filtro = { ...filtro, inicio: ($event.target as HTMLInputElement).value }"
      />
    </span>
    <span class="campo">
      <label :for="id('fim')">{{ t('suprimentos.listaDocumentos.fim') }}</label>
      <input
        :id="id('fim')"
        :value="filtro.fim"
        type="date"
        :data-testid="id('fim')"
        @change="filtro = { ...filtro, fim: ($event.target as HTMLInputElement).value }"
      />
    </span>
  </div>
  <p class="acoes">
    <SanteBotao
      variante="texto"
      :rotulo="t('suprimentos.listaDocumentos.anterior')"
      :desabilitado="pagina <= 1"
      :data-testid="id('anterior')"
      @acionar="pagina = pagina - 1"
    />
    <span role="status">{{ t('suprimentos.listaDocumentos.pagina', { n: pagina }) }}</span>
    <SanteBotao
      variante="texto"
      :rotulo="t('suprimentos.listaDocumentos.seguinte')"
      :desabilitado="!haSeguinte"
      :data-testid="id('seguinte')"
      @acionar="pagina = pagina + 1"
    />
  </p>
</template>
