<script setup lang="ts">
// Relatório de saneamento das regras de preço datadas (M12, regra 9): as datas inválidas em TBPERMEM,
// TBINDICE e TBPERTHM, por origem. O sistema novo não corrige sozinho (a correção entra no saneamento da onda 4).
import { useQuery } from '@tanstack/vue-query';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { buscarSaneamento } from '../api-precos.js';

const { t } = useI18n();
const consulta = useQuery({ queryKey: ['saneamento'], queryFn: () => buscarSaneamento() });
</script>

<template>
  <section class="tela" aria-labelledby="saneamento-titulo">
    <h1 id="saneamento-titulo">{{ t('precos.saneamento.titulo') }}</h1>
    <p>{{ t('precos.saneamento.texto') }}</p>
    <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
    <template v-else-if="consulta.data.value">
      <ul data-testid="saneamento-resumo">
        <li v-for="(n, o) in consulta.data.value.porOrigem" :key="o">
          {{ t(`precos.saneamento.origens.${o}`) }}: {{ n }}
        </li>
      </ul>
      <table data-testid="tabela-saneamento">
        <caption>
          {{
            t('precos.saneamento.titulo')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('precos.saneamento.origem') }}</th>
            <th scope="col">{{ t('precos.saneamento.chave') }}</th>
            <th scope="col">{{ t('precos.comum.data') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in consulta.data.value.achados" :key="a.origem + a.chave + a.data">
            <td>{{ t(`precos.saneamento.origens.${a.origem}`) }}</td>
            <th scope="row">{{ a.chave }}</th>
            <td>{{ a.data ?? '' }} ({{ t(`precos.saneamento.motivos.${a.motivo}`) }})</td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<style scoped>
table {
  border-collapse: collapse;
  width: 100%;
}
caption {
  text-align: left;
  font-weight: 600;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
</style>
