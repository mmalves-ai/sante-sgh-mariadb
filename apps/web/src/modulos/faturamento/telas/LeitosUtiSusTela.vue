<script setup lang="ts">
// Leitos de UTI habilitados (M51, etapa 4; ficha, seções 5 e 7) — `Faturamento > Faturamento SUS > AIH (internação,
// SIH)`: a quantidade de leitos de UTI habilitados no CNES por tipo de UTI do SIH e unidade, pelo CRUD genérico (lista com
// busca, inclusão e alteração da quantidade; o par tipo e unidade é único). As diárias de UTI da AIH só passam com leito
// habilitado do tipo (regra 6). O resumo por tipo vem da mesma leitura da AIH.
import { useQuery } from '@tanstack/vue-query';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import DominiosIndiceTela from '../../config/telas/DominiosIndiceTela.vue';
import { lerPainelAih } from '../api-sus-aih.js';

const { t } = useI18n();
const painel = useQuery({ queryKey: ['sus', 'aih', 'painel'], queryFn: () => lerPainelAih() });
</script>

<template>
  <section class="tela" aria-labelledby="leitos-uti-titulo" data-testid="tela-leitos-uti">
    <h1 id="leitos-uti-titulo">{{ t('faturamentoSus.aih.leitosUti') }}</h1>
    <p>{{ t('faturamentoSus.aih.leitosUtiExplicacao') }}</p>
    <RouterLink to="/faturamento/sus/aih">{{ t('faturamentoSus.retorno.irAih') }}</RouterLink>
    ·
    <RouterLink to="/faturamento/sus/cadastros/dominios">{{ t('faturamentoSus.aih.irDominios') }}</RouterLink>
    <MensagemErro v-if="painel.isError.value" :erro="painel.error.value" />
    <table v-else-if="painel.data.value" data-testid="tabela-leitos-por-tipo">
      <caption>
        {{
          t('faturamentoSus.aih.leitosPorTipo')
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">{{ t('faturamentoSus.aih.tipoUti') }}</th>
          <th scope="col">{{ t('faturamentoSus.aih.leitosHabilitados') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="x in painel.data.value.leitosUti" :key="x.tipo">
          <td>{{ x.tipo }} — {{ x.nome }}</td>
          <td>{{ x.leitos }}</td>
        </tr>
      </tbody>
    </table>
    <DominiosIndiceTela subitem="susLeitosUti" :embutido="true" />
  </section>
</template>

<style scoped>
table {
  border-collapse: collapse;
  margin: var(--sgh-espaco-2) 0;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
caption {
  text-align: left;
  font-weight: 600;
}
</style>
