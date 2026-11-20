<script setup lang="ts">
// Resumo da ficha no topo das telas do atendimento: dois identificadores (nome e prontuário), o número, o tipo, o
// convênio, o profissional, a senha e o desfecho; os atalhos para as outras telas da mesma ficha.
import type { AtendimentoDetalhe } from '@sgh/contratos';
import { useI18n } from 'vue-i18n';
import { dataBr } from '../../agenda/formato.js';

defineProps<{ atendimento: AtendimentoDetalhe; atalhos?: boolean }>();
const { t } = useI18n();
</script>

<template>
  <section class="painel" aria-labelledby="resumo-atendimento" data-testid="resumo-atendimento">
    <h2 id="resumo-atendimento">
      {{ t('atendimento.resumo.titulo', { reg: atendimento.reg }) }}
    </h2>
    <dl class="resumo-atd">
      <div>
        <dt>{{ t('atendimento.paciente') }}</dt>
        <dd>
          <strong>{{ atendimento.paciente.nome }}</strong> ·
          {{ t('atendimento.prontuario', { n: atendimento.paciente.prontuario }) }}
        </dd>
      </div>
      <div>
        <dt>{{ t('atendimento.tipo') }}</dt>
        <dd>{{ atendimento.tipoRotulo }} · {{ dataBr(atendimento.data) }} {{ atendimento.hora }}</dd>
      </div>
      <div>
        <dt>{{ t('atendimento.convenio') }}</dt>
        <dd>{{ atendimento.convenio.nome }}</dd>
      </div>
      <div>
        <dt>{{ t('atendimento.profissional') }}</dt>
        <dd>{{ atendimento.profissional.nome }}</dd>
      </div>
      <div v-if="atendimento.senha">
        <dt>{{ t('atendimento.senha') }}</dt>
        <dd>{{ atendimento.senha.texto }}</dd>
      </div>
      <div>
        <dt>{{ t('atendimento.situacao') }}</dt>
        <dd data-testid="situacao-atendimento">
          {{ atendimento.desfecho ? atendimento.desfecho.rotulo : t('atendimento.aberto') }}
        </dd>
      </div>
    </dl>
    <nav v-if="atalhos" class="acoes" :aria-label="t('atendimento.resumo.atalhos')">
      <RouterLink :to="`/recepcao/atendimento/${atendimento.reg}/corrigir`" data-testid="atalho-corrigir">{{
        t('atendimento.corrigir.atalho')
      }}</RouterLink>
      <RouterLink :to="`/recepcao/atendimento/${atendimento.reg}/segurado`">{{
        t('atendimento.segurado.titulo')
      }}</RouterLink>
      <RouterLink :to="`/recepcao/atendimento/${atendimento.reg}/procedimentos`">{{
        t('atendimento.procedimentos.titulo')
      }}</RouterLink>
      <RouterLink :to="`/recepcao/atendimento/${atendimento.reg}/impressos`">{{
        t('atendimento.impressos.titulo')
      }}</RouterLink>
      <RouterLink :to="`/recepcao/atendimento/${atendimento.reg}/encerrar`">{{
        t('atendimento.encerrar.titulo')
      }}</RouterLink>
    </nav>
  </section>
</template>

<style scoped>
.resumo-atd {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
  gap: var(--sgh-espaco-2);
  margin: 0;
}
.resumo-atd dt {
  font-weight: 600;
}
.resumo-atd dd {
  margin: 0;
}
</style>
