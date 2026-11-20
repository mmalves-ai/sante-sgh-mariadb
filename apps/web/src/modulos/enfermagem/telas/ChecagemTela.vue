<script setup lang="ts">
// Checagem em tela (ficha do M25, seção 7): os horários do paciente da internação da rota, com a checagem
// (administrado ou não administrado com motivo), o histórico do horário e o estorno justificado.
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { usarContextoClinico } from '../../../casca/notificar/contexto-clinico.js';
import PainelHorarios from '../componentes/PainelHorarios.vue';

const props = defineProps<{ atendimentoId: string }>();
const { t } = useI18n();
const atendimento = computed(() => Number(props.atendimentoId));
// M48 (etapa 2): o atendimento da checagem é o contexto do "Notificar incidente" (só o ID vai na notificação).
usarContextoClinico(() => ({
  atendimento: atendimento.value,
  rotulo: t('qualidade.sugestoes.atendimento', { n: atendimento.value }),
}));
</script>

<template>
  <section class="tela-enf" aria-labelledby="chk-titulo" data-testid="tela-checagem">
    <h1 id="chk-titulo">{{ t('enfermagem.checagem.titulo') }}</h1>
    <p>{{ t('enfermagem.checagem.texto') }}</p>
    <PainelHorarios v-if="Number.isInteger(atendimento) && atendimento > 0" :atendimento="atendimento" />
  </section>
</template>

<style src="./estilo-enfermagem.css"></style>
