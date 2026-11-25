<script setup lang="ts">
// Modelos de impressão e cabeçalhos (ficha do M22, seção 7): consulta das fichas e dos modelos de relatório usados
// na impressão dos registros. Sem dado de paciente.
import { useQuery } from '@tanstack/vue-query';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { listarImpressao } from '../api-registro.js';

const { t } = useI18n();
const q = useQuery({ queryKey: ['pep', 'admin', 'impressao'], queryFn: () => listarImpressao() });
</script>

<template>
  <section class="tela" aria-labelledby="adm-impressao-titulo" data-testid="tela-admin-impressao">
    <h1 id="adm-impressao-titulo">{{ t('pep.reg.admin.impressao.titulo') }}</h1>
    <p>{{ t('pep.reg.admin.impressao.texto') }}</p>
    <p>
      <RouterLink :to="{ name: 'pep.admin.impressao.cabecalhos' }" data-testid="link-cabecalhos-impressao">{{
        t('pep.copias.cab.titulo')
      }}</RouterLink>
    </p>
    <MensagemErro v-if="q.isError.value" :erro="q.error.value" />
    <p v-else-if="!q.data.value" role="status">{{ t('pep.reg.carregando') }}</p>
    <template v-else>
      <table
        v-for="(grupo, chave) in { fichas: q.data.value.fichas, relatorios: q.data.value.relatorios }"
        :key="chave"
        class="tabela"
        :data-testid="`tabela-${chave}`"
      >
        <caption>
          {{
            t(`pep.reg.admin.impressao.${chave}`, { n: grupo.length })
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('pep.reg.admin.impressao.colunas.id') }}</th>
            <th scope="col">{{ t('pep.reg.admin.impressao.colunas.nome') }}</th>
            <th scope="col">{{ t('pep.reg.admin.impressao.colunas.tipo') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in grupo" :key="x.id">
            <td>{{ x.id }}</td>
            <td>{{ x.nome }}</td>
            <td>{{ x.tipo }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<style scoped>
.tela {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-4);
}
.tabela {
  border-collapse: collapse;
  width: 100%;
}
.tabela caption {
  text-align: start;
  font-weight: 600;
}
.tabela th,
.tabela td {
  border-bottom: 1px solid var(--sgh-borda);
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  text-align: start;
}
</style>
