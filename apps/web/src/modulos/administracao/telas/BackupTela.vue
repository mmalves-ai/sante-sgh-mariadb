<script setup lang="ts">
// "Backup e restauração" (M10, ficha seção 7): situações e procedimentos (só consulta); o backup verificado do
// M59-F5 (restaurações diária e mensal) é ligado daqui.
import { useQuery } from '@tanstack/vue-query';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { buscarBackup } from '../api.js';

const { t } = useI18n();
const consulta = useQuery({ queryKey: ['adm', 'backup'], queryFn: () => buscarBackup() });
</script>

<template>
  <section class="tela" aria-labelledby="backup-titulo">
    <h1 id="backup-titulo">{{ t('adm.backup.titulo') }}</h1>
    <p>{{ t('adm.backup.texto') }}</p>
    <p>
      <RouterLink to="/administracao/auditoria/backup" data-testid="backup-verificado">
        {{ t('sbis.backup.verificado') }}
      </RouterLink>
    </p>
    <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
    <p v-else-if="consulta.isPending.value">{{ t('adm.comum.carregando') }}</p>
    <template v-else-if="consulta.data.value">
      <h2>{{ t('adm.backup.situacoes') }}</h2>
      <ul data-testid="backup-situacoes">
        <li v-for="s in consulta.data.value.situacoes" :key="s.id">{{ s.descricao }}</li>
      </ul>
      <h2>{{ t('adm.backup.procedimentos') }}</h2>
      <ul>
        <li v-for="s in consulta.data.value.procedimentos" :key="s.id">{{ s.descricao }}</li>
      </ul>
    </template>
  </section>
</template>
