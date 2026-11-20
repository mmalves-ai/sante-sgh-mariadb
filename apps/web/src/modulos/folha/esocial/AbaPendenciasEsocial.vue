<script setup lang="ts">
// Aba "Pendências acumuladas" (M53.6; regra 2): os eventos que ficaram pendentes em registros anteriores, só contados por
// evento e por ano. Nada aqui envia nem apaga: não há ação.
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroFolha from '../telas/ErroFolha.vue';
import { lerPendenciasEsocial } from './api-esocial.js';

const props = defineProps<{ empresa: number | null }>();
const { t } = useI18n();
const q = useQuery({
  queryKey: computed(() => ['folha', 'esocial', 'pendencias', props.empresa]),
  queryFn: () => lerPendenciasEsocial(props.empresa),
});
const p = computed(() => q.data.value ?? null);
</script>

<template>
  <section class="bloco" :aria-label="t('folha.esocial.pendencias.titulo')" data-testid="esocial-pendencias">
    <h2>{{ t('folha.esocial.pendencias.titulo') }}</h2>
    <p class="secundario">{{ t('folha.esocial.pendencias.ajuda') }}</p>
    <ErroFolha v-if="q.isError.value" :erro="q.error.value" />
    <p v-else-if="!p" role="status">{{ t('folha.esocial.carregando') }}</p>
    <p v-else-if="p.total === 0" data-testid="esocial-pendencias-vazio">
      {{ t('folha.esocial.pendencias.nenhuma') }}
    </p>
    <template v-else>
      <p data-testid="esocial-pendencias-total">{{ t('folha.esocial.pendencias.total', { n: p.total }) }}</p>
      <div class="rolagem" tabindex="0" role="region" :aria-label="t('folha.esocial.pendencias.titulo')">
        <table class="tabela">
          <thead>
            <tr>
              <th scope="col">{{ t('folha.esocial.pendencias.evento') }}</th>
              <th scope="col">{{ t('folha.esocial.pendencias.grupo') }}</th>
              <th scope="col">{{ t('folha.esocial.pendencias.quantidade') }}</th>
              <th scope="col">{{ t('folha.esocial.pendencias.porAno') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="x in p.porEvento" :key="x.evento" :data-testid="`esocial-pendencia-${x.evento}`">
              <th scope="row">{{ x.evento }} · {{ x.rotulo }}</th>
              <td>{{ x.grupo ? t(`folha.esocial.grupos.${x.grupo}`) : '—' }}</td>
              <td>{{ x.quantidade }}</td>
              <td>{{ x.porAno.map((y) => `${y.ano}: ${y.quantidade}`).join(' · ') }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>

<style scoped src="../../pessoas/estilo-pessoas.css"></style>
