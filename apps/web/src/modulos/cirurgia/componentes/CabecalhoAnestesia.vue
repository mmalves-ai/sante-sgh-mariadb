<script setup lang="ts">
// Cabeçalho das telas da anestesia (M46): o paciente e a cirurgia (sala, início previsto, procedimento, anestesista do
// agendamento), as alergias em destaque e os exames recentes. O conteúdo vem da leitura auditada do servidor.
import type { ContextoAnestesiaResposta } from '@sgh/contratos';
import { SanteAlerta } from '@sgh/ui';
import { useI18n } from 'vue-i18n';

defineProps<{ contexto: ContextoAnestesiaResposta; exames?: boolean }>();
const { t } = useI18n();
const hora = (x: string) => x.replace('T', ' ').slice(0, 16);
</script>

<template>
  <section class="cartao" aria-labelledby="anest-cab" data-testid="cabecalho-anestesia">
    <h2 id="anest-cab">{{ contexto.nome ?? '—' }}</h2>
    <p>
      {{ t('anestesia.cabecalho.sala', { sala: contexto.sala }) }} ·
      {{ t('anestesia.cabecalho.inicioPrevisto') }} {{ hora(contexto.dataHora) }}
      <template v-if="contexto.procedimento"> · {{ contexto.procedimento }}</template>
    </p>
    <p class="secundario">
      {{ t('anestesia.cabecalho.anestesistaAgendado') }}:
      {{ contexto.anestesistaAgendadoNome ?? t('anestesia.cabecalho.semAnestesista') }}
    </p>
    <SanteAlerta
      v-if="contexto.alergias.length > 0"
      variante="alerta"
      :texto="`${t('anestesia.cabecalho.alergias')}: ${contexto.alergias.map((a) => a.nome).join(', ')}`"
      data-testid="anest-alergias"
    />
    <p v-else class="secundario" data-testid="anest-sem-alergias">
      {{ t('anestesia.cabecalho.semAlergias') }}
    </p>
    <SanteAlerta
      v-if="contexto.paciente === null"
      variante="aviso"
      :texto="t('anestesia.cabecalho.semPaciente')"
    />
    <details v-if="exames !== false && contexto.examesRecentes.length > 0">
      <summary>{{ t('anestesia.cabecalho.examesRecentes') }} ({{ contexto.examesRecentes.length }})</summary>
      <ul>
        <li v-for="x in contexto.examesRecentes" :key="x.id">
          {{ x.data ?? '—' }} · {{ x.exame }} ·
          {{ x.liberado ? t('anestesia.cabecalho.exameLiberado') : t('anestesia.cabecalho.exameAguardando') }}
        </li>
      </ul>
      <p v-if="contexto.truncado" class="secundario">{{ t('anestesia.cabecalho.examesTruncado') }}</p>
    </details>
  </section>
</template>
