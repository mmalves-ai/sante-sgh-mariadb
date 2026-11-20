<script setup lang="ts">
// Minhas férias (M53.4, etapa F3; `pessoas.autoatendimento.ler`, só o próprio; leve para o celular): os períodos
// aquisitivos do próprio vínculo com o direito, o saldo e a situação, e as férias programadas e calculadas com as datas
// de gozo e de pagamento. Sem valores (o recibo fica com o RH). Desligada a folha, só a frase de onde consultar. O
// vínculo vem da rota (o "Meu espaço" passa o escolhido); o servidor recusa vínculo que não é do login.
import { SanteAlerta } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRoute } from 'vue-router';
import ErroPessoas from '../../pessoas/componentes/ErroPessoas.vue';
import { dataBr } from '../../pessoas/comum.js';
import { lerMinhasFerias } from './api-ferias.js';
import { faixa, saldoTotal } from './comum-ferias.js';

const { t } = useI18n();
const rota = useRoute();
const vinculo = computed(() => {
  const v = Number(rota?.query?.vinculo);
  return Number.isInteger(v) && v > 0 ? v : null;
});
const consulta = useQuery({
  queryKey: computed(() => ['folha', 'minhas-ferias', vinculo.value]),
  queryFn: () => lerMinhasFerias(vinculo.value),
});
const m = computed(() => consulta.data.value ?? null);
const saldo = computed(() => m.value?.saldo ?? null);
</script>

<template>
  <section class="tela-pessoas" aria-labelledby="minhas-ferias-titulo" data-testid="tela-minhas-ferias">
    <h1 id="minhas-ferias-titulo">{{ t('folha.ferias.meu.titulo') }}</h1>
    <p>
      <RouterLink to="/pessoas/meu">{{ t('folha.ferias.meu.voltar') }}</RouterLink>
    </p>
    <ErroPessoas v-if="consulta.isError.value" :erro="consulta.error.value" />
    <p v-else-if="!m" role="status">{{ t('folha.carregando') }}</p>
    <SanteAlerta
      v-else-if="!m.disponivel || !saldo"
      :texto="m.mensagem ?? t('folha.calculo.holerite.semVinculo')"
      variante="info"
      data-testid="minhas-ferias-indisponivel"
    />
    <SanteAlerta
      v-else-if="!saldo.temDireito"
      :texto="t('folha.ferias.meu.semDireito')"
      variante="info"
      data-testid="minhas-ferias-sem-direito"
    />
    <template v-else>
      <p data-testid="minhas-ferias-saldo">
        <strong>{{ t('folha.ferias.meu.saldoTotal', { n: saldoTotal(saldo.periodos) }) }}</strong>
      </p>
      <h2>{{ t('folha.ferias.periodos.titulo') }}</h2>
      <p v-if="saldo.periodos.length === 0">{{ t('folha.ferias.periodos.nenhum') }}</p>
      <ul v-else class="lista" data-testid="minhas-ferias-periodos">
        <li v-for="p in saldo.periodos" :key="p.inicio" :data-testid="`minhas-ferias-periodo-${p.inicio}`">
          <strong>{{ faixa(p.inicio, p.fim) }}</strong>
          · {{ t(`folha.ferias.situacaoPeriodo.${p.situacao}`) }}
          <br />
          <span class="secundario">
            {{ t('folha.ferias.periodos.direito') }} {{ t('folha.ferias.periodos.dias', { n: p.direito }) }} ·
            {{ t('folha.ferias.periodos.saldo') }} {{ t('folha.ferias.periodos.dias', { n: p.saldo }) }} ·
            {{ t('folha.ferias.periodos.concessivo') }} {{ dataBr(p.concessivoFim) }}
          </span>
        </li>
      </ul>
      <h2>{{ t('folha.ferias.fracoes.titulo') }}</h2>
      <p v-if="saldo.ferias.length === 0">{{ t('folha.ferias.fracoes.nenhuma') }}</p>
      <ul v-else class="lista" data-testid="minhas-ferias-fracoes">
        <li v-for="f in saldo.ferias" :key="f.id" :data-testid="`minhas-ferias-fracao-${f.id}`">
          <strong>{{ faixa(f.inicio, f.fim) }}</strong>
          · {{ t(`folha.ferias.situacoes.${f.situacao}`) }}
          <br />
          <span class="secundario">
            {{ t('folha.ferias.fracoes.dias') }} {{ f.dias }} · {{ t('folha.ferias.fracoes.abono') }}
            {{ f.abono }} · {{ t('folha.ferias.fracoes.pagamento') }} {{ dataBr(f.pagamento) }}
          </span>
        </li>
      </ul>
    </template>
  </section>
</template>

<style scoped src="../../pessoas/estilo-pessoas.css"></style>
