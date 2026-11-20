<script setup lang="ts">
// M36: "Triggers vistos no rastreamento × catálogo" da tela de conferência de gravação — nas operações com cenário
// controlado capturado, os triggers do catálogo que o rastreamento do banco não viu e os vistos fora do catálogo.
// Só leitura do painel da homologação (config.coexistencia.ler).
import type { PainelHomologacao } from '@sgh/contratos';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { conferirTriggers } from '../api.js';

const props = defineProps<{ painel: PainelHomologacao; filtro: string }>();
const { t } = useI18n();
const comControlado = computed(() => {
  const f = props.filtro.trim().toLowerCase();
  return props.painel.operacoes
    .filter((o) => o.triggers.vistos !== null)
    .filter((o) => !f || o.nome.toLowerCase().includes(f))
    .map((o) => ({ ...o, conferencia: conferirTriggers(o.triggers) }));
});
const lista = (x: readonly string[]) => (x.length ? x.join(', ') : '—');
</script>

<template>
  <section aria-labelledby="titulo-triggers-vistos" data-testid="triggers-vistos">
    <h2 id="titulo-triggers-vistos">{{ t('config.homologacao.triggersTitulo') }}</h2>
    <p>{{ t('config.homologacao.triggersTexto') }}</p>
    <p v-if="comControlado.length === 0" data-testid="triggers-nenhum">
      {{ t('config.homologacao.triggersNenhum') }}
    </p>
    <table v-else>
      <caption>
        {{
          t('config.homologacao.triggersLegenda', { n: comControlado.length })
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">{{ t('config.gravacao.operacao') }}</th>
          <th scope="col">{{ t('config.homologacao.triggersCatalogo') }}</th>
          <th scope="col">{{ t('config.homologacao.triggersVistos') }}</th>
          <th scope="col">{{ t('config.homologacao.triggersAusentes') }}</th>
          <th scope="col">{{ t('config.homologacao.triggersAMais') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="o in comControlado" :key="o.nome">
          <th scope="row">
            <code>{{ o.nome }}</code>
          </th>
          <td>{{ lista(o.triggers.catalogo) }}</td>
          <td>{{ lista(o.triggers.vistos ?? []) }}</td>
          <td>{{ lista(o.conferencia.ausentes) }}</td>
          <td>{{ lista(o.conferencia.aMais) }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
