<script setup lang="ts">
// Painel "?": só os atalhos com ação disponível na tela atual.
import { SanteDialogo } from '@sgh/ui';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { atalhos } from './atalhos.js';

const aberto = defineModel<boolean>('aberto', { required: true });
const { t } = useI18n();
const lista = computed(() => (aberto.value ? atalhos.disponiveis() : []));
</script>

<template>
  <SanteDialogo v-model:visivel="aberto" :titulo="t('atalhos.titulo')">
    <table v-if="lista.length > 0" class="painel" data-testid="painel-atalhos">
      <thead>
        <tr>
          <th scope="col">{{ t('atalhos.tecla') }}</th>
          <th scope="col">{{ t('atalhos.acao') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="a in lista" :key="a.id" :data-atalho="a.id">
          <td>
            <kbd>{{ a.teclas }}</kbd>
          </td>
          <td>{{ t(`atalhos.${a.id}`) }}</td>
        </tr>
      </tbody>
    </table>
    <p v-else>{{ t('atalhos.nenhum') }}</p>
  </SanteDialogo>
</template>

<style scoped>
.painel {
  border-collapse: collapse;
  width: 100%;
}
.painel th,
.painel td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
kbd {
  border: 1px solid var(--sgh-borda-forte);
  border-radius: 4px;
  padding: 0 var(--sgh-espaco-1);
}
</style>
