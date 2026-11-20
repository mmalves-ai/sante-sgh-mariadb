<script setup lang="ts">
// Imagens do paciente no prontuário (ficha do M47, regra 8, etapa 3): os exames de imagem que viraram item da lista de
// trabalho DICOM, com o status na modalidade e o link do visualizador (estudo concluído e endereço configurado). A
// leitura é auditada no servidor, com o mesmo acesso dos resultados.
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { lerImagensDoPaciente } from '../api-pacs.js';
import { quando } from '../usar-sadt.js';

const props = defineProps<{ paciente: number }>();
const { t } = useI18n();
const dados = useQuery({
  queryKey: computed(() => ['pep', 'imagens', props.paciente]),
  queryFn: () => lerImagensDoPaciente(props.paciente),
});
</script>

<template>
  <section aria-labelledby="imagens-titulo" data-testid="imagens-paciente">
    <h3 id="imagens-titulo">{{ t('pacs.pep.titulo') }}</h3>
    <MensagemErro v-if="dados.isError.value" :erro="dados.error.value" />
    <p v-else-if="!dados.data.value" role="status">{{ t('pacs.carregando') }}</p>
    <p v-else-if="dados.data.value.estudos.length === 0" class="secundario">{{ t('pacs.pep.nenhum') }}</p>
    <ul v-else class="lista">
      <li v-for="e in dados.data.value.estudos" :key="e.exame" :data-testid="`imagem-${e.exame}`">
        {{
          t('pacs.pep.linha', {
            exame: e.nomeExame,
            setor: e.setor,
            modalidade: e.modalidade,
            acesso: e.accession,
            status: e.status ? t(`pacs.status.${e.status}`) : t('pacs.pep.semStatus'),
          })
        }}
        <span class="secundario"> · {{ quando(e.data) }}</span>
        <a
          v-if="e.link"
          :href="e.link"
          target="_blank"
          rel="noopener noreferrer"
          :data-testid="`imagem-link-${e.exame}`"
          >{{ t('pacs.pep.abrir', { visualizador: dados.data.value.visualizador.nome }) }}</a
        >
      </li>
    </ul>
  </section>
</template>
