<script setup lang="ts">
// Uma limpeza em aberto (painel, aplicativo do profissional e inspeção): o leito, a etapa, o prazo (o que falta ou
// quanto passou), o cronômetro em execução sem as pausas, o profissional e a precaução; o histórico mostra quem,
// quando e de qual aparelho registrou cada etapa.
import type { SolicitacaoLimpeza } from '@sgh/contratos';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { leitoTexto, minutosAtePrazo } from '../regras-tela.js';

const props = defineProps<{ item: SolicitacaoLimpeza; agora: number; historico?: boolean }>();
const { t } = useI18n();
const falta = computed(() => minutosAtePrazo(props.item.prazo, props.agora));
</script>

<template>
  <article
    :class="['cartao-limpeza', { atrasada: item.atrasada }]"
    :data-testid="`limpeza-${item.solicitacao}`"
    :data-etapa="item.etapa"
  >
    <h3>{{ leitoTexto(item.leito) }}</h3>
    <p>
      <strong>{{ t(`adt.hig.etapas.${item.etapa}`) }}</strong>
      <span v-if="item.tipoLimpeza"> · {{ item.tipoLimpeza.nome }}</span>
      <span v-if="item.origem"> · {{ t(`adt.hig.origem.${item.origem}`) }}</span>
    </p>
    <p v-if="item.precaucao" class="precaucao">{{ t('adt.hig.precaucao') }}: {{ item.precaucao }}</p>
    <p>
      <span v-if="falta === null">{{ t('adt.hig.semPrazo') }}</span>
      <strong v-else-if="item.atrasada">{{ t('adt.hig.passou', { n: -falta }) }}</strong>
      <span v-else>{{ t('adt.hig.faltam', { n: falta }) }}</span>
      · {{ t('adt.hig.desde', { n: item.minutosDesdeSolicitacao }) }}
      <span v-if="item.minutosExecucao > 0"> · {{ t('adt.hig.execucao', { n: item.minutosExecucao }) }}</span>
    </p>
    <p v-if="item.profissional" class="secundario">
      {{ t('adt.hig.profissional') }}: {{ item.profissional.nome }}
    </p>
    <ol v-if="historico" class="secundario">
      <li v-for="(h, i) in item.historico" :key="i">
        {{
          t('adt.hig.porQuem', {
            etapa: t(`adt.hig.etapas.${h.etapa}`),
            em: h.em.replace('T', ' ').slice(0, 16),
            por: h.por,
          })
        }}
        <span v-if="h.aparelho"> ({{ h.aparelho }})</span>
      </li>
    </ol>
    <slot />
  </article>
</template>

<style scoped>
.cartao-limpeza {
  border: 1px solid var(--sgh-borda);
  border-left: 6px solid var(--sgh-aviso);
  border-radius: 4px;
  padding: var(--sgh-espaco-2);
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-1);
}
.cartao-limpeza h3,
.cartao-limpeza p {
  margin: 0;
}
.atrasada {
  border-left-color: var(--sgh-alerta);
  border-left-width: 10px;
}
.precaucao {
  font-weight: 600;
}
</style>
