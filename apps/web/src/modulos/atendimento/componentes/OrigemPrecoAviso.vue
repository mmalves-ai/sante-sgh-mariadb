<script setup lang="ts">
// ADR 0009, no lançamento do atendimento: o alerta de profissional não credenciado (ou o bloqueio, quando o convênio
// liga a opção) e a origem do preço (regra particular do profissional ou da agenda, tabela da conta, do plano ou do
// convênio), com a explicação curta do cálculo e o aviso quando a regra é estimada (extraída do texto da agenda).
import type { ResultadoCalculoPreco } from '@sgh/contratos';
import { SanteAlerta } from '@sgh/ui';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { reais } from '../../agenda/estruturada-tela.js';

const props = defineProps<{ resultado: ResultadoCalculoPreco }>();
const { t } = useI18n();
const efeito = computed(() => props.resultado.credenciamento?.efeito ?? 'nenhum');
</script>

<template>
  <div class="origem-preco" data-testid="origem-preco">
    <div v-if="efeito === 'bloqueio'" role="alert" data-testid="credenciamento-bloqueio">
      <SanteAlerta variante="alerta" :texto="t('estruturada.lancamento.bloqueado')" />
    </div>
    <div v-else-if="efeito === 'alerta'" role="alert" data-testid="credenciamento-alerta">
      <SanteAlerta variante="aviso" :texto="t('estruturada.lancamento.naoCredenciado')" />
    </div>
    <p v-if="resultado.valor === null" data-testid="preco-ausente">
      {{ t('estruturada.lancamento.semPreco') }}
    </p>
    <dl v-else>
      <dt>{{ t('estruturada.lancamento.valor', { valor: reais(resultado.valor) }) }}</dt>
      <dd v-if="resultado.origem" data-testid="preco-origem">
        {{ t('estruturada.lancamento.origem') }}:
        {{ t(`estruturada.lancamento.origens.${resultado.origem}`) }}
      </dd>
      <dd v-if="resultado.explicacao" data-testid="preco-explicacao">{{ resultado.explicacao }}</dd>
      <dd v-if="resultado.estimada" data-testid="preco-estimada">
        {{ t('estruturada.lancamento.estimada') }}
      </dd>
    </dl>
  </div>
</template>

<style scoped>
dl {
  margin: var(--sgh-espaco-1) 0;
}
dd {
  margin-left: 0;
}
</style>
