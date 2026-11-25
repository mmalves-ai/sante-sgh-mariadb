<script setup lang="ts">
// Fila de pendências pela equipe assistencial (03-PEP L94): os pacientes de atendimento aberto em que a conta é
// destinatária das pendências (marcada para recebê-las ou responsável principal), com o atalho para o prontuário e
// para a equipe. Some quando a lista está vazia e a conta não tem a leitura do painel.
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { pode } from '../../../casca/sessao/pode.js';
import { lerMinhaFilaEquipe } from '../api-equipe-painel.js';

const { t } = useI18n();
const visivel = computed(() => pode('pep.painel.ler'));
const fila = useQuery({
  queryKey: ['pep', 'equipe', 'minha-fila'],
  queryFn: () => lerMinhaFilaEquipe(),
  enabled: visivel,
  staleTime: 30_000,
});
const itens = computed(() => fila.data.value?.itens ?? []);
</script>

<template>
  <section v-if="visivel" class="fila-equipe" data-testid="fila-equipe">
    <h2>{{ t('pep.equipe.filaTitulo') }}</h2>
    <p v-if="!itens.length" data-testid="fila-equipe-vazia">{{ t('pep.equipe.filaVazia') }}</p>
    <ul v-else>
      <li v-for="i in itens" :key="i.equipe" :data-testid="`fila-equipe-${i.atendimento}`">
        <RouterLink :to="`/pep/paciente/${i.paciente}`">{{ i.pacienteNome }}</RouterLink>
        — {{ i.numero }} —
        {{ i.responsavel ? t('pep.equipe.filaResponsavel') : t('pep.equipe.filaNotificado') }}
        —
        <RouterLink :to="`/pep/equipe/${i.atendimento}`">{{ t('pep.equipe.atalho') }}</RouterLink>
      </li>
    </ul>
  </section>
</template>
