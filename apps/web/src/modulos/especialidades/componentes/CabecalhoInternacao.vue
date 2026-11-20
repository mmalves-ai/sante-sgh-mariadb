<script setup lang="ts">
// Cabeçalho do paciente nas telas das especialidades: os dois identificadores (nome e nascimento; prontuário), o leito e
// a admissão; a internação encerrada fica marcada (só consulta).
import type { InternacaoEspecialidade } from '@sgh/contratos';
import { useI18n } from 'vue-i18n';
import { dataLonga, instanteCurto, leitoTexto } from '../regras-especialidades.js';

defineProps<{ internacao: InternacaoEspecialidade; titulo: string }>();
const { t } = useI18n();
</script>

<template>
  <header class="cabecalho" data-testid="esp-cabecalho">
    <h1 id="esp-titulo">{{ titulo }}: {{ internacao.nome }}</h1>
    <p class="secundario">
      {{ t('especialidades.prontuario') }} {{ internacao.prontuario }}
      <span v-if="internacao.nascimento">
        · {{ t('especialidades.nascimento') }} {{ dataLonga(internacao.nascimento) }}</span
      >
      <span v-if="internacao.idade !== null">
        · {{ t('especialidades.idade', { n: internacao.idade }) }}</span
      >
      · {{ leitoTexto(internacao.leito) }} · {{ t('especialidades.admissao') }}
      {{ instanteCurto(internacao.admissao) }}
      <strong v-if="!internacao.aberta"> · {{ t('especialidades.encerrada') }}</strong>
    </p>
  </header>
</template>

<style scoped>
.cabecalho h1 {
  margin: 0;
}
.cabecalho p {
  margin: var(--sgh-espaco-1) 0 0;
}
</style>
