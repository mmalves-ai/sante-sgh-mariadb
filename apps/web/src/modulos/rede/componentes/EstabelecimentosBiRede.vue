<script setup lang="ts">
// Quem entrou no consolidado da Rede (M57, etapa 3): cada estabelecimento com a situação (incluído, fora por não estar
// liberado, fora por não responder), o motivo e a data dos dados.
import type { EstabelecimentoBiRede } from '@sgh/contratos';
import { useI18n } from 'vue-i18n';
import { formatarDataHora } from '../../internacao/formato.js';

defineProps<{ estabelecimentos: readonly EstabelecimentoBiRede[] }>();
const { t } = useI18n();
</script>

<template>
  <section aria-labelledby="bi-rede-ests" data-testid="bi-rede-estabelecimentos">
    <h2 id="bi-rede-ests">{{ t('biRede.estabelecimentos.titulo') }}</h2>
    <ul>
      <li v-for="e in estabelecimentos" :key="e.codigo" :data-testid="`bi-rede-est-${e.codigo}`">
        <strong>{{ e.nome }}</strong
        >: {{ t(`biRede.estabelecimentos.situacoes.${e.situacao}`) }}
        <span v-if="e.dadosAte" class="secundario">
          ({{ t('biRede.estabelecimentos.dadosAte', { quando: formatarDataHora(e.dadosAte) }) }})</span
        >
        <span v-if="e.motivo" class="bloco">{{ e.motivo }}</span>
      </li>
    </ul>
  </section>
</template>

<style scoped>
ul {
  margin: 0;
  padding-left: var(--sgh-espaco-4);
}
.secundario {
  color: var(--sgh-texto-secundario);
}
.bloco {
  display: block;
  font-size: var(--sgh-fonte-pequena);
}
</style>
