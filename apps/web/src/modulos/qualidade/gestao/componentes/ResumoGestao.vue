<script setup lang="ts">
// O resumo da gestão da qualidade no topo das telas (só os números que a sessão pode ver; o servidor zera os demais) e o
// aviso da funcionalidade desligada (tudo em consulta).
import { SanteAlerta } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { lerResumoGestao } from '../api-gestao.js';
import ErroGestao from './ErroGestao.vue';

const props = defineProps<{ partes: readonly ('documentos' | 'gestao' | 'ouvidoria')[] }>();
const { t } = useI18n();
const resumo = useQuery({
  queryKey: ['gestaoQualidade', 'resumo'],
  queryFn: lerResumoGestao,
  staleTime: 60_000,
});
const itens = computed(() => {
  const r = resumo.data.value;
  if (!r) return [];
  const todos = [
    { parte: 'documentos', chave: 'documentosVigentes', valor: r.documentosVigentes, alerta: false },
    { parte: 'documentos', chave: 'cienciasPendentes', valor: r.cienciasPendentesSessao, alerta: true },
    { parte: 'documentos', chave: 'revisaoVencida', valor: r.documentosRevisaoVencida, alerta: true },
    { parte: 'gestao', chave: 'riscosCriticos', valor: r.riscosCriticos, alerta: true },
    { parte: 'gestao', chave: 'ncAbertas', valor: r.naoConformidadesAbertas, alerta: false },
    { parte: 'gestao', chave: 'ncVencidas', valor: r.naoConformidadesVencidas, alerta: true },
    { parte: 'gestao', chave: 'comissoesAtrasadas', valor: r.comissoesAtrasadas, alerta: true },
    { parte: 'ouvidoria', chave: 'manifestacoesAbertas', valor: r.manifestacoesAbertas, alerta: false },
    { parte: 'ouvidoria', chave: 'manifestacoesVencidas', valor: r.manifestacoesVencidas, alerta: true },
  ] as const;
  return todos.filter((x) => (props.partes as readonly string[]).includes(x.parte));
});
</script>

<template>
  <SanteAlerta
    v-if="resumo.data.value && !resumo.data.value.ligada"
    variante="info"
    :texto="resumo.data.value.motivo ?? t('gestaoQualidade.desligado')"
    data-testid="gestao-desligada"
  />
  <ErroGestao v-if="resumo.isError.value" :erro="resumo.error.value" />
  <dl
    v-if="itens.length"
    class="resumo-gestao"
    :aria-label="t('gestaoQualidade.resumo.legenda')"
    data-testid="gestao-resumo"
  >
    <div v-for="x in itens" :key="x.chave" :class="x.alerta && x.valor ? 'prazo prazo--vencido' : ''">
      <dt>{{ t(`gestaoQualidade.resumo.${x.chave}`) }}</dt>
      <dd :data-testid="`resumo-${x.chave}`">{{ x.valor }}</dd>
    </div>
  </dl>
</template>
