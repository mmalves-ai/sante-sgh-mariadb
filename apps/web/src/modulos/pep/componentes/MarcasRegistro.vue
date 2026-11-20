<script setup lang="ts">
// Marcas legais do registro (M15, regra 8) e exceções (regra 9): sempre com texto (cor nunca é a única
// informação). Suspenso e correção ligam ao original; o aviso de registro eletrônico sem assinatura digital
// qualificada vale para todo registro lançado sem ela.
import type { Marcas } from '@sgh/contratos';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { dataHoraBr } from '../formato.js';

const props = defineProps<{ marcas: Marcas; paciente: number; detalhe?: boolean }>();
const { t } = useI18n();
const lista = computed(() => {
  const m = props.marcas;
  return [
    m.suspenso ? { id: 'suspenso', texto: t('pep.marcas.suspenso') } : null,
    m.corrigeRegistro ? { id: 'correcao', texto: t('pep.marcas.correcao') } : null,
    m.retroativo ? { id: 'retroativo', texto: t('pep.marcas.retroativo') } : null,
    m.supervisao ? { id: 'supervisao', texto: t('pep.marcas.supervisao') } : null,
    m.semConteudo ? { id: 'sem-conteudo', texto: t('pep.marcas.semConteudo') } : null,
    m.dataImpossivel ? { id: 'data-impossivel', texto: t('pep.marcas.dataImpossivel') } : null,
  ].filter((x): x is { id: string; texto: string } => x !== null);
});
</script>

<template>
  <span class="marcas">
    <span
      v-for="m in lista"
      :key="m.id"
      class="marca"
      :class="`marca-${m.id}`"
      :data-testid="`marca-${m.id}`"
      >{{ m.texto }}</span
    >
  </span>
  <div v-if="detalhe" class="detalhe">
    <p v-if="marcas.suspenso" data-testid="detalhe-suspenso">
      {{
        t('pep.marcas.suspensoEm', {
          em: dataHoraBr(marcas.suspensoEm) || t('pep.marcas.semData'),
          motivo: marcas.justificativaSuspensao ?? t('pep.marcas.semJustificativa'),
        })
      }}
    </p>
    <p v-if="marcas.corrigeRegistro">
      {{ t('pep.marcas.corrige') }}
      <RouterLink :to="`/pep/prontuario/${paciente}/registro/${marcas.corrigeRegistro}`">{{
        t('pep.marcas.original', { id: marcas.corrigeRegistro })
      }}</RouterLink>
    </p>
    <p v-if="marcas.retroativo">
      {{ t('pep.marcas.retroativoPorque', { motivo: marcas.justificativaRetroativo }) }}
    </p>
    <p v-if="marcas.semAssinaturaIcp" class="aviso-icp" data-testid="aviso-icp">
      {{ t('pep.marcas.semIcp') }}
    </p>
  </div>
</template>

<style scoped>
.marcas {
  display: inline-flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-1);
}
.marca {
  font-size: var(--sgh-fonte-pequena);
  font-weight: 600;
  outline: 1px solid var(--sgh-borda-forte);
  padding: 0 var(--sgh-espaco-1);
}
.marca-suspenso {
  outline-width: 2px;
}
.detalhe p {
  margin: var(--sgh-espaco-1) 0;
}
.aviso-icp {
  font-size: var(--sgh-fonte-pequena);
  color: var(--sgh-texto-secundario);
}
a {
  display: inline-flex;
  align-items: center;
  min-height: var(--sgh-alvo-minimo);
}
</style>
