<script setup lang="ts">
// NFS-e (ficha do M32, seção 7): `/financeiro/fiscal/nfse`. A nota de serviço sai sempre pelo ciclo no banco do
// cliente (F3.8, 07-FIN linha 113): uma ou muitas faturas num lote, deduções da base conferidas na hora, ISS, IBS e
// CBS calculados no servidor, cancelamento e substituição com motivo do catálogo, e o XML de cada nota guardado no
// armazém de arquivos. Fora de produção (e até a definição do fiscal) a emissão vai ao simulador.
import { RouterLink } from 'vue-router';
import { useI18n } from 'vue-i18n';
import AvisoFaturamento from '../../faturamento/componentes/AvisoFaturamento.vue';
import NotasServicoCiclo from '../componentes/NotasServicoCiclo.vue';
import { usarFinanceiro } from '../usar-financeiro.js';

const { t } = useI18n();
const { gravacao, pode, motivoFuncionalidade } = usarFinanceiro();
</script>

<template>
  <section class="tela-agenda" aria-labelledby="nf-titulo" data-testid="tela-fin-nfse">
    <h1 id="nf-titulo">{{ t('financeiro.nfse.titulo') }}</h1>
    <p>{{ t('financeiro.nfse.texto') }}</p>
    <p>
      <RouterLink to="/cadastros/dominios/grupo/financeiroNfse" data-testid="nfse-cadastros">
        {{ t('financeiro.tabelasDoItem') }}
      </RouterLink>
    </p>
    <p v-if="gravacao.data.value?.destinoExterno === 'simulador'" class="secundario">
      {{ t('financeiro.simulador') }}
    </p>
    <AvisoFaturamento :motivo="motivoFuncionalidade('fiscal')" />
    <!-- F3.8, 07-FIN linha 113: lote por faturas, cancelamento, substituição e histórico, no banco do cliente. -->
    <NotasServicoCiclo :pode="pode('emitirNfse')" />
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style src="../componentes/estilo-financeiro.css"></style>
