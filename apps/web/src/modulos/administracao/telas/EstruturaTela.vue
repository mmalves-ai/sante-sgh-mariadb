<script setup lang="ts">
// "Rede, empresa, hospital e unidades" (M10, ficha seção 7; cap-06a §6.1): a árvore empresa → hospital (CNES) →
// unidades, com a linha padrão "não informada" marcada (fica no banco, fora das listas de escolha), e os
// cadastros da estrutura (unidades, esfera administrativa) pelo cadastro genérico.
import { useQuery } from '@tanstack/vue-query';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import DominiosIndiceTela from '../../config/telas/DominiosIndiceTela.vue';
import { buscarEstrutura } from '../api.js';

const { t } = useI18n();
const consulta = useQuery({ queryKey: ['adm', 'estrutura'], queryFn: () => buscarEstrutura() });
</script>

<template>
  <section class="tela" aria-labelledby="estrutura-titulo">
    <h1 id="estrutura-titulo">{{ t('adm.estrutura.titulo') }}</h1>
    <p>{{ t('adm.estrutura.texto') }}</p>
    <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
    <p v-else-if="consulta.isPending.value">{{ t('adm.comum.carregando') }}</p>
    <template v-else-if="consulta.data.value">
      <p v-if="consulta.data.value.destino === 'memoria'">{{ t('adm.comum.memoria') }}</p>
      <ul class="arvore" data-testid="arvore-estrutura">
        <li v-if="consulta.data.value.empresa">
          <strong>{{ t('adm.estrutura.empresa') }}:</strong> {{ consulta.data.value.empresa.nome }}
          <ul>
            <li v-if="consulta.data.value.hospital">
              <strong>{{ t('adm.estrutura.hospital') }}:</strong> {{ consulta.data.value.hospital.nome }}
              <dl class="dados">
                <dt>{{ t('adm.estrutura.cnes') }}</dt>
                <dd>{{ consulta.data.value.hospital.cnes ?? '—' }}</dd>
                <dt>{{ t('adm.estrutura.esfera') }}</dt>
                <dd>{{ consulta.data.value.hospital.esfera ?? '—' }}</dd>
                <dt>{{ t('adm.estrutura.complexidade') }}</dt>
                <dd>{{ consulta.data.value.hospital.complexidade ?? '—' }}</dd>
                <dt>{{ t('adm.estrutura.fuso') }}</dt>
                <dd>{{ consulta.data.value.hospital.fusoHorario ?? '—' }}</dd>
              </dl>
              <h2>{{ t('adm.estrutura.unidades') }}</h2>
              <ul>
                <li
                  v-for="u in consulta.data.value.unidades"
                  :key="u.codigo"
                  :data-testid="`unidade-${u.codigo}`"
                >
                  {{ u.codigo }} — {{ u.nome }}
                  <span v-if="u.cnes"> ({{ t('adm.estrutura.cnes') }} {{ u.cnes }})</span>
                  <span v-if="!u.ativa"> · {{ t('adm.comum.inativo') }}</span>
                  <em v-if="u.sentinela"> · {{ t('adm.estrutura.naoInformada') }}</em>
                </li>
              </ul>
            </li>
          </ul>
        </li>
      </ul>
    </template>
    <h2>{{ t('adm.estrutura.cadastros') }}</h2>
    <DominiosIndiceTela subitem="estruturaUnidades" :embutido="true" />
  </section>
</template>

<style scoped>
.arvore ul {
  padding-left: var(--sgh-espaco-4);
}
.dados {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--sgh-espaco-1) var(--sgh-espaco-3);
}
dd {
  margin: 0;
}
</style>
