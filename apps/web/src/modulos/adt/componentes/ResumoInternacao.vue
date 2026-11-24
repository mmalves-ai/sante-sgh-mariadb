<script setup lang="ts">
// Cabeçalho da internação nas telas de uma internação (guias, trocas, procedimentos, alta, impressos): o paciente, o
// leito atual, o convênio, a entrada e os dias, com os atalhos para as outras telas da mesma internação.
import type { InternacaoDetalhe } from '@sgh/contratos';
import { useI18n } from 'vue-i18n';
import { dataBr } from '../../agenda/formato.js';
import { hhmm, leitoTexto } from '../regras-tela.js';

defineProps<{ internacao: InternacaoDetalhe; atalhos?: boolean }>();
const { t } = useI18n();
const ACOES = ['guias', 'registros', 'trocas', 'procedimentos', 'alta', 'impressos'] as const;
</script>

<template>
  <section
    class="painel resumo-int"
    :aria-label="t('adt.resumo.titulo', { reg: internacao.reg })"
    data-testid="resumo-internacao"
  >
    <h2>{{ t('adt.resumo.titulo', { reg: internacao.reg }) }}</h2>
    <p>
      <strong>{{ internacao.nome }}</strong>
      <span class="secundario"> · {{ t('adt.prontuario', { n: internacao.prontuario }) }}</span>
    </p>
    <ul class="cartoes">
      <li>{{ t('adt.leito') }}: {{ leitoTexto(internacao.leito) }} ({{ internacao.tipoAcomodacao }})</li>
      <li>{{ t('adt.convenio') }}: {{ internacao.convenio.nome }}</li>
      <li>{{ t('adt.entrada') }}: {{ dataBr(internacao.entrada) }} {{ hhmm(internacao.horaEntrada) }}</li>
      <li>{{ t('adt.dias', { n: internacao.diasInternacao }) }}</li>
      <li v-if="internacao.isolamento">{{ t('adt.isolamento') }}</li>
      <li v-if="internacao.alta">{{ t('adt.altaEm', { data: dataBr(internacao.alta) }) }}</li>
    </ul>
    <p v-if="atalhos" class="acoes">
      <span class="secundario">{{ t('adt.resumo.atalhos') }}:</span>
      <RouterLink v-for="a in ACOES" :key="a" :to="`/internacao/${internacao.reg}/${a}`">{{
        t(`adt.acoes.${a}`)
      }}</RouterLink>
    </p>
  </section>
</template>
