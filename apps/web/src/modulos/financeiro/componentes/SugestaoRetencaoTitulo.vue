<script setup lang="ts">
// F3.8, 07-FIN linha 109: no lançamento do título a pagar, a retenção vem da regra vigente (valor, data e
// participante), não de um valor digitado de cabeça. Um clique aplica a sugestão ao título; a dispensada pelo mínimo
// aparece com o motivo e não é aplicada.
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import { lerSugestaoRetencao, type SugestaoRetencao } from '../api-contabil-fiscal.js';

const props = defineProps<{ valor: number; data: string; participante: string }>();
const emit = defineEmits<{ aplicar: [{ tributo: number; valor: number }] }>();
const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      sugerir: 'Sugerir retenção pela regra vigente',
      nenhuma: 'Nenhuma regra de retenção vigente para este valor e data.',
      aplicar: 'Aplicar',
      dispensada: 'dispensada (igual ou abaixo do mínimo)',
      linha: '{tributo}: base {base}, alíquota {aliquota}%, retido {valor}',
    },
  },
});
const sugestoes = ref<readonly SugestaoRetencao[] | null>(null);
const erro = ref<unknown>(null);
const pronto = computed(() => props.valor > 0 && /^\d{4}-\d{2}-\d{2}$/.test(props.data));
const brl = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
async function sugerir() {
  erro.value = null;
  try {
    sugestoes.value = await lerSugestaoRetencao({
      valor: props.valor,
      data: props.data,
      participante: props.participante,
      momento: 'pagamento',
    });
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <span class="campo" data-testid="tp-sugestao-retencao">
    <button type="button" :disabled="!pronto" data-testid="tp-sugerir-retencao" @click="sugerir">
      {{ t('sugerir') }}
    </button>
    <ErroFaturamento v-if="erro" :erro="erro" />
    <small v-if="sugestoes && !sugestoes.length" class="secundario" role="status">{{ t('nenhuma') }}</small>
    <ul v-else-if="sugestoes" class="lista-simples" data-testid="tp-sugestoes">
      <li v-for="s in sugestoes" :key="s.regra">
        {{ t('linha', { tributo: s.tributo, base: brl(s.base), aliquota: s.aliquota, valor: brl(s.valor) }) }}
        <small v-if="s.dispensada" class="secundario">{{ t('dispensada') }}</small>
        <button
          v-else
          type="button"
          :data-testid="`tp-aplicar-${s.tributo}`"
          @click="emit('aplicar', { tributo: s.tributoId, valor: s.valor })"
        >
          {{ t('aplicar') }}
        </button>
      </li>
    </ul>
  </span>
</template>
