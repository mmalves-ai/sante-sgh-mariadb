<script setup lang="ts">
// Minha competência de trabalho (06-FAT linha 32): o faturista escolhe o mês em que está trabalhando (e, se quiser, um
// período dentro dele) e as telas passam a abrir os filtros nesse mês, não no do relógio. Validação na hora, a mesma
// regra do servidor (@sgh/dominio-faturamento): até o mês corrente, no máximo 5 anos atrás, período dentro do mês.
import { conferirCompetenciaTrabalho } from '@sgh/dominio-faturamento';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import { gravarCompetenciaTrabalho, lerCompetenciaTrabalho } from '../api-competencia-trabalho.js';
import { novaChave } from '../api-tiss.js';

const props = withDefaults(defineProps<{ modulo?: string; hoje?: string }>(), {
  modulo: 'fonte_pagadora',
  hoje: '',
});
const emit = defineEmits<{ (e: 'escolhida', competencia: string): void }>();
const { t } = useI18n();
const qc = useQueryClient();
const chave = computed(() => ['tiss', 'competencia-trabalho', props.modulo]);
const atual = useQuery({ queryKey: chave, queryFn: () => lerCompetenciaTrabalho(props.modulo) });
const competencia = ref('');
const inicio = ref('');
const fim = ref('');
const erro = ref<unknown>(null);
const gravando = ref(false);
const gravada = ref(false);

watch(
  () => atual.data.value,
  (d) => {
    if (!d) return;
    competencia.value = d.competencia ?? d.padrao;
    inicio.value = d.periodoInicio ?? '';
    fim.value = d.periodoFim ?? '';
    emit('escolhida', d.padrao);
  },
  { immediate: true },
);

const hoje = computed(() => props.hoje || new Date().toLocaleDateString('sv-SE'));
const recusa = computed(() =>
  competencia.value
    ? conferirCompetenciaTrabalho({
        modulo: props.modulo,
        competencia: competencia.value,
        periodoInicio: inicio.value || null,
        periodoFim: fim.value || null,
        hoje: hoje.value,
      })
    : null,
);
const mudou = computed(() => {
  const d = atual.data.value;
  if (!d) return false;
  return (
    competencia.value !== (d.competencia ?? '') ||
    inicio.value !== (d.periodoInicio ?? '') ||
    fim.value !== (d.periodoFim ?? '')
  );
});

async function gravar() {
  if (!competencia.value || recusa.value || !atual.data.value) return;
  erro.value = null;
  gravada.value = false;
  gravando.value = true;
  try {
    await gravarCompetenciaTrabalho(
      {
        modulo: props.modulo,
        competencia: competencia.value,
        periodoInicio: inicio.value || null,
        periodoFim: fim.value || null,
        versao: atual.data.value.versao,
      },
      novaChave('competencia-trabalho'),
    );
    gravada.value = true;
    await qc.invalidateQueries({ queryKey: chave.value });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
</script>

<template>
  <section class="minha-competencia" aria-labelledby="ct-titulo" data-testid="ct-minha-competencia">
    <h2 id="ct-titulo">{{ t('tiss.competencias.trabalho.titulo') }}</h2>
    <p>
      {{
        atual.data.value?.competencia
          ? t('tiss.competencias.trabalho.atual', { competencia: atual.data.value.competencia })
          : t('tiss.competencias.trabalho.semEscolha')
      }}
    </p>
    <form class="filtros" @submit.prevent="gravar">
      <span class="campo">
        <label for="ct-competencia">{{ t('tiss.competencia') }}</label>
        <input
          id="ct-competencia"
          v-model="competencia"
          type="month"
          :max="hoje.slice(0, 7)"
          :aria-invalid="recusa?.campos.includes('competencia') ? 'true' : undefined"
          data-testid="ct-competencia"
        />
      </span>
      <span class="campo">
        <label for="ct-inicio">{{ t('tiss.competencias.trabalho.inicio') }}</label>
        <input
          id="ct-inicio"
          v-model="inicio"
          type="date"
          :aria-invalid="recusa?.campos.includes('periodoInicio') ? 'true' : undefined"
          data-testid="ct-inicio"
        />
      </span>
      <span class="campo">
        <label for="ct-fim">{{ t('tiss.competencias.trabalho.fim') }}</label>
        <input
          id="ct-fim"
          v-model="fim"
          type="date"
          :aria-invalid="recusa?.campos.includes('periodoFim') ? 'true' : undefined"
          data-testid="ct-fim"
        />
      </span>
      <button
        type="submit"
        :disabled="!competencia || !!recusa || !mudou || gravando"
        data-testid="ct-gravar"
      >
        {{ t('tiss.competencias.trabalho.gravar') }}
      </button>
    </form>
    <p v-if="recusa" role="alert" data-testid="ct-recusa">{{ recusa.mensagem }}</p>
    <p v-if="gravada" role="status" data-testid="ct-gravada">
      {{ t('tiss.competencias.trabalho.gravada') }}
    </p>
    <ErroFaturamento v-if="erro" :erro="erro" />
  </section>
</template>
