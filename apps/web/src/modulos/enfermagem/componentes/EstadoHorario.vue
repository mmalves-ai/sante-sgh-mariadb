<script setup lang="ts">
// O estado do horário na linha do tempo (a cor nunca é a única pista: o texto vai junto). Atrasada e omitida em
// vermelho; administrada em verde; suspensa riscada.
import { useI18n } from 'vue-i18n';

defineProps<{ estado: string }>();
const { t } = useI18n();
</script>

<template>
  <span class="estado-horario" :data-estado="estado">{{ t(`enfermagem.estados.${estado}`) }}</span>
</template>

<style scoped>
.estado-horario {
  display: inline-block;
  padding: 0 var(--sgh-espaco-2);
  border-radius: 999px;
  border: 1px solid var(--sgh-borda-forte);
  font-size: var(--sgh-fonte-pequena);
  font-weight: 600;
  line-height: 1.8;
  color: var(--sgh-texto);
  background: var(--sgh-fundo);
}
.estado-horario[data-estado='atrasada'],
.estado-horario[data-estado='omitida'] {
  border-color: var(--sgh-alerta);
  color: var(--sgh-alerta);
}
.estado-horario[data-estado='administrada'] {
  border-color: var(--sgh-sucesso);
  color: var(--sgh-sucesso);
}
.estado-horario[data-estado='suspensa'] {
  text-decoration: line-through;
  color: var(--sgh-texto-secundario);
}
</style>
