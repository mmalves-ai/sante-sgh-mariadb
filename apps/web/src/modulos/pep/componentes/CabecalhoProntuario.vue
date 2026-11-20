<script setup lang="ts">
// Cabeçalho do prontuário: os dois identificadores sempre visíveis (nome, com o social antes do civil, e
// nascimento; prontuário), sexo e óbito. Localização, alergias e medidas são do atendimento (chegam com ele).
import type { CabecalhoProntuario } from '@sgh/contratos';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { dataBr } from '../../cadastro/formato.js';
import { idade } from '../formato.js';

const props = defineProps<{ cabecalho: CabecalhoProntuario }>();
const { t } = useI18n();
const anos = computed(() => idade(props.cabecalho.nascimento));
</script>

<template>
  <section class="cabecalho" :aria-label="t('pep.cabecalho.regiao')" data-testid="cabecalho-prontuario">
    <h2 class="nome">{{ cabecalho.nomeSocial ?? cabecalho.nome }}</h2>
    <p v-if="cabecalho.nomeSocial" class="civil">{{ t('pep.cabecalho.civil', { nome: cabecalho.nome }) }}</p>
    <p class="ids">
      <span>{{
        t('pep.cabecalho.nascimento', { data: dataBr(cabecalho.nascimento) || t('pep.cabecalho.semData') })
      }}</span>
      <span v-if="anos !== null">{{ t('pep.cabecalho.idade', { anos }) }}</span>
      <span>{{ t('pep.cabecalho.prontuario', { n: cabecalho.prontuario }) }}</span>
      <span v-if="cabecalho.sexo">{{ t(`pep.cabecalho.sexo.${cabecalho.sexo}`) }}</span>
      <span v-if="cabecalho.obito" class="marca">{{ t('pep.cabecalho.obito') }}</span>
    </p>
  </section>
</template>

<style scoped>
.cabecalho {
  border: 1px solid var(--sgh-borda);
  padding: var(--sgh-espaco-2);
  margin: var(--sgh-espaco-2) 0;
}
.nome {
  margin: 0;
  font-size: 1.25rem;
}
.civil {
  margin: 0;
}
.ids {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  margin: var(--sgh-espaco-1) 0 0;
}
.marca {
  font-weight: 600;
  outline: 1px solid var(--sgh-borda-forte);
  padding: 0 var(--sgh-espaco-1);
}
</style>
