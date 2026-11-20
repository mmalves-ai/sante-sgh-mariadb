<script setup lang="ts">
// Sobre o sistema (SBIS-01): nome do produto (configuração), versões da tela e do servidor, base.
import type { PacoteMarca } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { inject } from 'vue';
import { useI18n } from 'vue-i18n';
import { buscarVersao } from '../../../api.js';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import { CHAVE_MARCA, VERSAO_WEB } from '../../../configuracao.js';

const { t } = useI18n();
const marca = inject(CHAVE_MARCA) as { produto: string; pacote: PacoteMarca };
const { sessao, estabelecimentoAtivo } = usarSessao();
const versao = useQuery({ queryKey: ['versao'], queryFn: () => buscarVersao() });
</script>

<template>
  <section class="tela" aria-labelledby="sobre-titulo">
    <h1 id="sobre-titulo">{{ t('sobre.titulo') }}</h1>
    <dl class="sobre">
      <dt>{{ t('sobre.produto') }}</dt>
      <dd data-testid="sobre-produto">{{ marca.produto }}</dd>
      <dt>{{ t('sobre.versaoWeb') }}</dt>
      <dd data-testid="sobre-web">{{ VERSAO_WEB.identificacao }}</dd>
      <dt>{{ t('sobre.versaoApi') }}</dt>
      <dd data-testid="sobre-api">
        <span v-if="versao.data.value">{{ versao.data.value.identificacao }}</span>
        <MensagemErro v-else-if="versao.isError.value" :erro="versao.error.value" />
        <span v-else>{{ t('sobre.carregando') }}</span>
      </dd>
      <dt>{{ t('sobre.rede') }}</dt>
      <dd>{{ sessao?.rede ?? '—' }}</dd>
      <dt>{{ t('sobre.estabelecimento') }}</dt>
      <dd>{{ estabelecimentoAtivo?.nome ?? '—' }}</dd>
      <dt>{{ t('sobre.componentes') }}</dt>
      <dd>{{ t('sobre.base', { versao: VERSAO_WEB.openvue, vue: VERSAO_WEB.vue }) }}</dd>
    </dl>
    <p v-if="marca.pacote.provisoria">{{ t('sobre.marcaProvisoria') }}</p>
  </section>
</template>

<style scoped>
.sobre {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--sgh-espaco-1) var(--sgh-espaco-4);
}
.sobre dt {
  font-weight: 600;
  color: var(--sgh-texto-secundario);
}
.sobre dd {
  margin: 0;
  font-family: var(--sgh-fonte-codigo);
}
</style>
