<script setup lang="ts">
// Indicadores do painel do plano de segurança: cada linha com o numerador e o denominador impressos, o resultado, a
// meta (quando o hospital definiu) e a fonte do dado. A comparação com a meta vai em texto, não só em cor.
import type { IndicadorPainel } from '@sgh/contratos';
import { useI18n } from 'vue-i18n';
import { comparacaoComMeta, textoDaMeta, textoDoIndicador } from '../regras-seguranca.js';

defineProps<{ titulo: string; indicadores: readonly IndicadorPainel[]; testid: string }>();
const { t } = useI18n();
</script>

<template>
  <table class="tabela" :data-testid="testid">
    <caption>
      {{
        titulo
      }}
    </caption>
    <thead>
      <tr>
        <th scope="col">{{ t('qualidade.painel.indicador') }}</th>
        <th scope="col">{{ t('qualidade.painel.resultado') }}</th>
        <th scope="col">{{ t('qualidade.painel.meta') }}</th>
        <th scope="col">{{ t('qualidade.painel.fonte') }}</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="i in indicadores" :key="i.codigo" :data-testid="`indicador-${i.codigo}`">
        <th scope="row">{{ i.titulo }}</th>
        <td>{{ textoDoIndicador(i) }}</td>
        <td>
          {{ textoDaMeta(i) }}
          <span
            v-if="comparacaoComMeta(i)"
            :class="['selo', comparacaoComMeta(i) === 'abaixo' ? 'selo--grave' : '']"
            >{{
              comparacaoComMeta(i) === 'atingida'
                ? t('qualidade.painel.metaAtingida')
                : t('qualidade.painel.abaixoDaMeta')
            }}</span
          >
        </td>
        <td>{{ i.fonte }}</td>
      </tr>
    </tbody>
  </table>
</template>

<style>
@import './estilo-qualidade.css';
</style>
