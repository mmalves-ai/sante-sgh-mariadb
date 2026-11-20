<script setup lang="ts">
// "Dados fiscais da empresa" (M10, ficha seção 7): só consulta nesta fase; as tabelas oficiais dos dados fiscais
// (tipo de empresa, cooperativa, construtora, ministério certificador) pelo cadastro genérico, só consulta.
import { useQuery } from '@tanstack/vue-query';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import DominiosIndiceTela from '../../config/telas/DominiosIndiceTela.vue';
import { buscarEmpresa } from '../api.js';

const { t } = useI18n();
const consulta = useQuery({ queryKey: ['adm', 'empresa'], queryFn: () => buscarEmpresa() });
const e = () => consulta.data.value?.empresa ?? null;
</script>

<template>
  <section class="tela" aria-labelledby="empresa-titulo">
    <h1 id="empresa-titulo">{{ t('adm.empresa.titulo') }}</h1>
    <p>{{ t('adm.empresa.texto') }}</p>
    <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
    <p v-else-if="consulta.isPending.value">{{ t('adm.comum.carregando') }}</p>
    <dl v-else-if="e()" class="dados" data-testid="dados-fiscais">
      <dt>{{ t('adm.comum.nome') }}</dt>
      <dd>{{ e()?.nome }}</dd>
      <dt>{{ t('adm.empresa.cnpj') }}</dt>
      <dd>{{ e()?.cnpj ?? '—' }}</dd>
      <dt>{{ t('adm.empresa.ie') }}</dt>
      <dd>{{ e()?.inscricaoEstadual ?? '—' }}</dd>
      <dt>{{ t('adm.empresa.im') }}</dt>
      <dd>{{ e()?.inscricaoMunicipal ?? '—' }}</dd>
      <dt>{{ t('adm.empresa.cnae') }}</dt>
      <dd>{{ e()?.cnae ?? '—' }}</dd>
      <dt>{{ t('adm.empresa.municipio') }}</dt>
      <dd>{{ e()?.municipio ?? '—' }} {{ e()?.uf ?? '' }}</dd>
      <dt>{{ t('adm.empresa.simples') }}</dt>
      <dd>{{ e()?.optanteSimples ? t('adm.comum.sim') : t('adm.comum.nao') }}</dd>
      <dt>{{ t('adm.empresa.ans') }}</dt>
      <dd>{{ e()?.registroAns ?? '—' }}</dd>
      <dt>{{ t('adm.empresa.tipo') }}</dt>
      <dd>{{ e()?.tipoEmpresa ?? '—' }}</dd>
      <dt>{{ t('adm.empresa.cooperativa') }}</dt>
      <dd>{{ e()?.cooperativa ?? '—' }}</dd>
      <dt>{{ t('adm.empresa.construtora') }}</dt>
      <dd>{{ e()?.construtora ?? '—' }}</dd>
    </dl>
    <DominiosIndiceTela subitem="dadosFiscais" :embutido="true" />
  </section>
</template>

<style scoped>
.dados {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--sgh-espaco-1) var(--sgh-espaco-3);
}
dt {
  font-weight: 600;
}
dd {
  margin: 0;
}
</style>
