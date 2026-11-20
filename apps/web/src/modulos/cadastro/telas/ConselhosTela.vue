<script setup lang="ts">
// Conselhos profissionais e siglas (M11): o CRUD genérico do M08 para os conselhos (incluir e alterar pelo
// executor; os conselhos do sistema ficam protegidos) e, em consulta, as siglas válidas de cada conselho.
import { useQuery } from '@tanstack/vue-query';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import DominioTela from '../../config/telas/DominioTela.vue';
import { lerSiglas } from '../api-cadastro.js';

const { t } = useI18n();
const siglas = useQuery({ queryKey: ['cadastro', 'siglas'], queryFn: () => lerSiglas() });
</script>

<template>
  <div data-testid="tela-conselhos">
    <DominioTela modulo="cadastro" recurso="conselho" />
    <section class="tela" aria-labelledby="siglas-titulo">
      <h2 id="siglas-titulo">{{ t('cadastro.conselhos.siglas') }}</h2>
      <MensagemErro v-if="siglas.isError.value" :erro="siglas.error.value" />
      <p v-else-if="!siglas.data.value">{{ t('cadastro.carregando') }}</p>
      <table v-else data-testid="tabela-siglas">
        <thead>
          <tr>
            <th scope="col">{{ t('cadastro.conselhos.conselho') }}</th>
            <th scope="col">{{ t('cadastro.profissionais.sigla') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in siglas.data.value.itens" :key="`${s.conselho}-${s.sigla}`">
            <td>{{ s.nome ?? s.conselho }}</td>
            <td>{{ s.sigla }}</td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<style scoped>
table {
  border-collapse: collapse;
  width: 100%;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
</style>
