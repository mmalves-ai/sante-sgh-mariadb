<script setup lang="ts">
// Registro de tempo de evento (consulta).
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../../casca/MensagemErro.vue';
import { lerTempos } from '../../api-documentos.js';
import { dataHoraBr } from '../../formato.js';

const props = defineProps<{ paciente: number }>();
const { t } = useI18n();
const dados = useQuery({
  queryKey: computed(() => ['pep', 'doc', 'tempos', props.paciente]),
  queryFn: () => lerTempos(props.paciente),
});
</script>

<template>
  <section class="aba" aria-labelledby="tempos-titulo" data-testid="aba-tempos-conteudo">
    <h2 id="tempos-titulo">{{ t('pep.doc.tempos.titulo') }}</h2>
    <MensagemErro v-if="dados.isError.value" :erro="dados.error.value" />
    <p v-else-if="!dados.data.value" role="status">{{ t('pep.doc.carregando') }}</p>
    <p v-else-if="dados.data.value.length === 0">{{ t('pep.doc.nenhum') }}</p>
    <table v-else class="tabela">
      <thead>
        <tr>
          <th scope="col">{{ t('pep.doc.tempos.quando') }}</th>
          <th scope="col">{{ t('pep.doc.tempos.situacao') }}</th>
          <th scope="col">{{ t('pep.doc.tempos.profissional') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="x in dados.data.value" :key="x.id">
          <td>{{ dataHoraBr(x.quando) }}</td>
          <td>{{ x.situacao ?? '-' }}</td>
          <td>{{ x.profissional ?? '-' }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped src="./abas.css"></style>
