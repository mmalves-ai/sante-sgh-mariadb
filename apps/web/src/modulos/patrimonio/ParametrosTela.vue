<script setup lang="ts">
// Parâmetros do patrimônio (M54, etapa 6; item `Controladoria > Patrimônio > Parâmetros do patrimônio`): os parâmetros
// gerais da empresa (deprecia, coeficiente por turno, valor residual: o que a depreciação obedece, D-PARAM-DEPREC-546)
// e os parâmetros por usuário (consulta), pelo CRUD genérico do M54.1. A lista dos que o perfil consulta vem do apoio
// dos bens, ou, sem ele, dos dois cadastros (a tela gerada recusa o que o perfil não lê).
import { CADASTROS_PATRIMONIO_PARAMETROS } from '@sgh/contratos';
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { lerApoioPatrimonio } from './api-patrimonio.js';
import CadastrosPatrimonio from './CadastrosPatrimonio.vue';

const { t } = useI18n();
const apoio = useQuery({
  queryKey: ['patrimonio', 'apoio', 'bens'],
  queryFn: () => lerApoioPatrimonio('bens'),
});
const cadastros = computed<readonly string[]>(() => {
  const a = apoio.data.value;
  if (!a) return CADASTROS_PATRIMONIO_PARAMETROS;
  return CADASTROS_PATRIMONIO_PARAMETROS.filter((c) => a.cadastros.includes(c));
});
</script>

<template>
  <section
    class="tela-patrimonio"
    aria-labelledby="parametros-pat-titulo"
    data-testid="tela-parametros-patrimonio"
  >
    <h1 id="parametros-pat-titulo">{{ t('patrimonio.parametros.titulo') }}</h1>
    <p>{{ t('patrimonio.parametros.descricao') }}</p>
    <p v-if="apoio.isPending.value" role="status">{{ t('patrimonio.carregando') }}</p>
    <p v-else-if="cadastros.length === 0" data-testid="parametros-nenhum">
      {{ t('patrimonio.parametros.nenhum') }}
    </p>
    <CadastrosPatrimonio
      v-else
      :cadastros="cadastros"
      :titulo="t('patrimonio.parametros.escolher')"
      :ajuda="t('patrimonio.parametros.descricao')"
      testid="parametros-cadastros"
    />
  </section>
</template>

<style scoped src="./estilo-patrimonio.css"></style>
