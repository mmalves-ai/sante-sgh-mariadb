<script setup lang="ts">
// Portal do paciente, lado interno (M50, etapa 1; item "Resultados, receitas e documentos assinados" da árvore): o
// endereço do portal do estabelecimento para orientar o paciente, o caminho do convite (na ficha do paciente) e a
// conferência dos responsáveis legais e (W0-10, M2) a fila da cópia do prontuário no balcão. O paciente vê só o que foi liberado (resultados de setor publicado e documentos
// assinados); a equipe não entra no portal com a conta do paciente.
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { pode } from '../../../casca/sessao/pode.js';
import { estabelecimentoPortal } from '../api-portal-paciente.js';

const { t } = useI18n();
const e = useQuery({
  queryKey: ['portal-paciente', 'estabelecimento'],
  queryFn: () => estabelecimentoPortal(),
});
const endereco = computed(() =>
  e.data.value?.estabelecimento
    ? `${window.location.origin}/paciente/${e.data.value.estabelecimento}`
    : `${window.location.origin}/paciente`,
);
</script>

<template>
  <section class="tela" aria-labelledby="portal-interno-titulo" data-testid="tela-portal-interno">
    <h1 id="portal-interno-titulo">{{ t('portal.interno.inicio.titulo') }}</h1>
    <p>{{ t('portal.interno.inicio.ajuda') }}</p>
    <p>
      {{ t('portal.interno.inicio.endereco') }}: <code data-testid="portal-endereco">{{ endereco }}</code>
    </p>
    <ul>
      <li>
        <RouterLink to="/cadastros/pacientes">{{ t('portal.interno.inicio.buscarPaciente') }}</RouterLink>
      </li>
      <li v-if="pode('portal.vinculo.conferir')">
        <RouterLink :to="{ name: 'portal.conferenciaVinculos' }">{{
          t('portal.interno.vinculos.titulo')
        }}</RouterLink>
      </li>
      <li v-if="pode('portal.copia.conferir')" data-testid="portal-link-copias">
        <RouterLink :to="{ name: 'portal.copias' }">{{ t('portal.interno.copias.titulo') }}</RouterLink>
      </li>
    </ul>
  </section>
</template>
