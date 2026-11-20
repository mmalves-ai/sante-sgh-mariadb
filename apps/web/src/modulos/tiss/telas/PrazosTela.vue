<script setup lang="ts">
// Prazos de envio (ficha do M31, seção 7, painel): `/faturamento/prazos`. Por operadora, o calendário de entrega do
// cadastro, os lotes sem protocolo e os parados (sem protocolo há mais dias que o parâmetro) e o prazo de recurso (sem
// prazo cadastrado, o alerta: DP-33.9).
import { useQuery } from '@tanstack/vue-query';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import { lerPrazos } from '../api-tiss.js';
import { data } from '../usar-tiss.js';

const { t } = useI18n();
const p = useQuery({ queryKey: ['tiss', 'prazos'], queryFn: () => lerPrazos() });
</script>

<template>
  <section class="tela-agenda" aria-labelledby="pz-titulo" data-testid="tela-tiss-prazos">
    <h1 id="pz-titulo">{{ t('tiss.prazos.titulo') }}</h1>
    <p>{{ t('tiss.prazos.texto') }}</p>
    <p>
      <RouterLink to="/faturamento/lotes">{{ t('tiss.voltarLotes') }}</RouterLink>
    </p>
    <ErroFaturamento v-if="p.error.value" :erro="p.error.value" />
    <p v-else-if="!p.data.value" role="status">{{ t('tiss.carregando') }}</p>
    <p v-else-if="p.data.value.length === 0">{{ t('tiss.nenhum') }}</p>
    <table v-else class="tabela" data-testid="pz-lista">
      <thead>
        <tr>
          <th scope="col">{{ t('tiss.convenio') }}</th>
          <th scope="col">{{ t('tiss.prazos.proximaEntrega') }}</th>
          <th scope="col">{{ t('tiss.prazos.semProtocolo') }}</th>
          <th scope="col">{{ t('tiss.prazos.parados') }}</th>
          <th scope="col">{{ t('tiss.prazos.maisAntigo') }}</th>
          <th scope="col">{{ t('tiss.prazos.prazoRecurso') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="x in p.data.value" :key="x.convenio" :data-testid="`pz-${x.convenio}`">
          <td>{{ x.convenioNome }}</td>
          <td>{{ data(x.proximaEntrega) }}</td>
          <td>{{ x.lotesSemProtocolo }}</td>
          <td :class="{ alerta: x.lotesParados > 0 }">{{ x.lotesParados }}</td>
          <td>{{ data(x.maisAntigoSemProtocolo) }}</td>
          <td>
            {{
              x.prazoRecursoDias === null
                ? t('tiss.prazoNaoCadastrado')
                : t('tiss.prazos.dias', { n: x.prazoRecursoDias })
            }}
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
