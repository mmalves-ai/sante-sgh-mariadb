<script setup lang="ts">
// Busca do médico das telas do repasse (regras, lançamentos e RPA): pelo nome ou pelo código, mostra o nome e o
// conselho e devolve o código do prestador e o registro do médico. Ninguém digita código interno; a escolha é pelo
// SanteSelecao (ADR 0027). `fixo`: o médico já definido (o estorno herda o do lançamento original), só exibido.
import type { PrestadorRepasseResposta } from '@sgh/contratos';
import { SanteSelecao } from '@sgh/ui';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { buscarPrestadores } from '../api-repasse.js';

const props = defineProps<{
  rotulo: string;
  testid: string;
  fixo?: boolean;
  /** Mostra "qualquer médico" como primeira opção (filtro e regra geral). */
  qualquer?: boolean;
}>();
const prestador = defineModel<string>({ required: true });
const registro = defineModel<string>('registro', { default: '' });
const { t } = useI18n();
const termo = ref('');
const achados = ref<PrestadorRepasseResposta[]>([]);
const buscou = ref(false);
const escolhido = ref('');
const erro = ref(false);

async function buscar(): Promise<void> {
  erro.value = false;
  try {
    achados.value = await buscarPrestadores(termo.value.trim());
  } catch {
    achados.value = [];
    erro.value = true;
  }
  buscou.value = true;
  escolhido.value = achados.value[0] ? String(achados.value[0].registro) : '';
}
const opcoesAchados = computed(() => [
  ...(props.qualquer ? [{ valor: '', rotulo: t('repasse.qualquer') }] : []),
  ...achados.value.map((p) => ({
    valor: String(p.registro),
    rotulo: `${p.nome} · ${t('repasse.busca.conselho')} ${p.conselho}`,
  })),
]);
watch(escolhido, (r) => {
  const p = achados.value.find((x) => String(x.registro) === r);
  prestador.value = p ? String(p.prestador) : '';
  registro.value = p ? String(p.registro) : '';
});
// Limpo por fora (novo formulário): a busca volta ao começo.
watch(prestador, (v) => {
  if (!v && escolhido.value) {
    escolhido.value = '';
    achados.value = [];
    buscou.value = false;
    termo.value = '';
  }
});
</script>

<template>
  <span class="campo busca-prestador">
    <template v-if="fixo">
      <span class="rotulo">{{ rotulo }}</span>
      <output :data-testid="testid" :data-valor="prestador">{{
        t('repasse.busca.fixo', { prestador })
      }}</output>
    </template>
    <template v-else>
      <label :for="`${testid}-termo`">{{ rotulo }}</label>
      <span class="busca-prestador__linha">
        <input
          :id="`${testid}-termo`"
          v-model="termo"
          type="search"
          :placeholder="t('repasse.busca.ajuda')"
          :data-testid="`${testid}-busca`"
          @keydown.enter.prevent="buscar"
        />
        <button type="button" :data-testid="`${testid}-buscar`" @click="buscar">
          {{ t('repasse.busca.buscar') }}
        </button>
      </span>
      <SanteSelecao
        v-if="achados.length || qualquer"
        v-model="escolhido"
        :rotulo="t('repasse.busca.medico')"
        :opcoes="opcoesAchados"
        :busca="true"
        :data-testid="testid"
      />
      <small v-else-if="buscou" role="status">{{
        erro ? t('repasse.busca.erro') : t('repasse.busca.nenhum')
      }}</small>
    </template>
  </span>
</template>
