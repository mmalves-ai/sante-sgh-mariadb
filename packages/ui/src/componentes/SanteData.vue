<script setup lang="ts">
// Data (regra 7): o contrato trafega vazio como null (quem grava 1899-12-30 é o adaptador). Data fora da
// faixa de sanidade aparece com alerta de dado inválido, nunca "corrigida". Com `editavel`, aceita
// dd/mm/aaaa e devolve AAAA-MM-DD ou null. Com `maximo` (AAAA-MM-DD), a data digitada depois dele é recusada no
// campo (o servidor confere de novo).
import { classificarData, formatarDataCalendario, lerDataDigitada } from '@sgh/contratos';
import InputText from 'openvue/inputtext';
import { computed, ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { traduzirErro } from '../validacao/traduzir.js';
import SanteAlerta from './SanteAlerta.vue';

const props = withDefaults(defineProps<{ rotulo?: string; editavel?: boolean; maximo?: string | null }>(), {
  rotulo: '',
  editavel: false,
  maximo: null,
});
const valor = defineModel<string | null>({ required: true });
const { t } = useI18n();
const id = `sgh-data-${useId()}`;
const situacao = computed(() => classificarData(valor.value));
const texto = ref('');
const erro = ref<string | null>(null);
/** Texto mostrado no campo na última carga do valor: só se grava quando o usuário mudou o texto. */
let textoCarregado = '';
const invalidaNaOrigem = computed(
  () => situacao.value.tipo === 'fora-da-faixa' || situacao.value.tipo === 'malformada',
);
const textoDoAlerta = computed(() => {
  const s = situacao.value;
  return t('ui.data.invalida', { valor: s.tipo === 'malformada' ? s.bruto : paraTexto() });
});

function paraTexto(): string {
  const s = situacao.value;
  return s.tipo === 'valida' || s.tipo === 'fora-da-faixa' ? formatarDataCalendario(s) : '';
}
watch(
  valor,
  () => {
    if (!props.editavel || erro.value === null) {
      texto.value = paraTexto();
      textoCarregado = texto.value;
    }
  },
  { immediate: true },
);

function confirmar(): void {
  // Regra 7: um valor do legado (mesmo malformado) nunca é apagado nem "corrigido" sem o usuário digitar.
  if (texto.value === textoCarregado && erro.value === null) return;
  try {
    const lida = lerDataDigitada(texto.value);
    if (lida && props.maximo && lida > props.maximo) {
      const [ano, mes, dia] = props.maximo.split('-').map(Number);
      erro.value = t('ui.data.depoisDoMaximo', {
        maximo: formatarDataCalendario({ ano: ano ?? 0, mes: mes ?? 0, dia: dia ?? 0 }),
      });
      return;
    }
    valor.value = lida;
    textoCarregado = texto.value;
    erro.value = null;
  } catch (e) {
    erro.value = traduzirErro(t, e);
  }
}
</script>

<template>
  <div v-if="editavel" class="sgh-data">
    <label :for="id" class="sgh-data__rotulo">{{ rotulo }}</label>
    <SanteAlerta
      v-if="invalidaNaOrigem"
      variante="aviso"
      :texto="textoDoAlerta"
      data-testid="data-invalida"
    />
    <InputText
      :id="id"
      v-model="texto"
      inputmode="numeric"
      :placeholder="t('ui.data.ajuda')"
      :invalid="erro !== null"
      :aria-invalid="erro !== null"
      :aria-describedby="`${id}-erro`"
      class="sgh-data__entrada"
      @blur="confirmar"
      @keydown.enter="confirmar"
    />
    <span :id="`${id}-erro`" class="sgh-data__erro" aria-live="polite">{{ erro ?? '' }}</span>
  </div>
  <span v-else-if="situacao.tipo === 'vazia'" class="sgh-data sgh-data--vazia">{{ t('ui.data.vazia') }}</span>
  <SanteAlerta
    v-else-if="invalidaNaOrigem"
    variante="aviso"
    :texto="textoDoAlerta"
    data-testid="data-invalida"
  />
  <time v-else class="sgh-data" :datetime="valor ?? undefined">{{ paraTexto() }}</time>
</template>

<style scoped>
.sgh-data {
  font-variant-numeric: tabular-nums;
}
div.sgh-data {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-1);
}
.sgh-data--vazia {
  color: var(--sgh-texto-secundario);
}
.sgh-data__rotulo {
  font-weight: 600;
}
.sgh-data__entrada {
  min-height: var(--sgh-alvo-minimo);
  max-width: 12em;
}
.sgh-data__erro {
  color: var(--sgh-alerta);
  font-size: var(--sgh-fonte-pequena);
}
</style>
