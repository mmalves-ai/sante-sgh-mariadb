<script setup lang="ts">
// W0-03: o diálogo único das correções da enfermagem (cancelar a passagem, excluir o aparelho, estornar ou invalidar
// escore, classificação e índice, suspender ou cancelar a receita, estornar ou retificar a vacina, corrigir na agência).
// O motivo é obrigatório (10 a 300 caracteres); o tipo (estorno ou invalidação) quando a operação tem os dois; a senha
// de novo (reautenticação, SBIS-07) só nas operações críticas, enviada com o pedido e nunca guardada. O que mais a
// operação pede vai no slot. A recusa do servidor aparece aqui mesmo, sem fechar o diálogo.
import { SanteBotao, SanteDialogo, SanteOpcoes } from '@sgh/ui';
import { computed, ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import SenhaConfirmacao from '../../administracao/componentes/SenhaConfirmacao.vue';
import ErroEnfermagem from './ErroEnfermagem.vue';

export interface DadosCorrecao {
  readonly tipo: 'estorno' | 'invalidacao';
  readonly motivo: string;
  readonly senha: string;
}

const props = withDefaults(
  defineProps<{
    titulo: string;
    texto?: string;
    testid: string;
    comTipo?: boolean;
    comSenha?: boolean;
    /** Motivo opcional (ex.: a alteração do cadastro do aparelho, que só guarda quem e quando). */
    semMotivo?: boolean;
    rotuloConfirmar?: string;
    /** Condição extra do slot para confirmar. */
    podeConfirmar?: boolean;
    executar: (d: DadosCorrecao) => Promise<void>;
  }>(),
  { texto: '', comTipo: false, comSenha: false, semMotivo: false, rotuloConfirmar: '', podeConfirmar: true },
);
const visivel = defineModel<boolean>('visivel', { required: true });
const { t } = useI18n();
const id = `corr-${useId()}`;
const tipo = ref<'estorno' | 'invalidacao'>('estorno');
const motivo = ref('');
const senha = ref('');
const erro = ref<unknown>(null);
const ocupado = ref(false);
watch(visivel, (v) => {
  if (v) {
    tipo.value = 'estorno';
    motivo.value = '';
    senha.value = '';
    erro.value = null;
  }
});
const opcoesTipo = computed(() =>
  (['estorno', 'invalidacao'] as const).map((v) => ({
    valor: v,
    rotulo: t(`enfermagem.correcao.tipos.${v}`),
  })),
);
const valido = computed(
  () =>
    props.podeConfirmar &&
    (props.semMotivo || motivo.value.trim().length >= 10) &&
    (!props.comSenha || senha.value.length > 0),
);
async function confirmar(): Promise<void> {
  if (!valido.value) return;
  erro.value = null;
  ocupado.value = true;
  try {
    await props.executar({ tipo: tipo.value, motivo: motivo.value.trim(), senha: senha.value });
    senha.value = '';
    visivel.value = false;
  } catch (x) {
    senha.value = '';
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <SanteDialogo v-model:visivel="visivel" :titulo="titulo">
    <form class="corr" :data-testid="testid" @submit.prevent="confirmar">
      <p v-if="texto">{{ texto }}</p>
      <slot />
      <SanteOpcoes
        v-if="comTipo"
        v-model="tipo"
        :legenda="t('enfermagem.correcao.tipo')"
        :opcoes="opcoesTipo"
        :nome="`${id}-tipo`"
      />
      <span v-if="!semMotivo" class="campo">
        <label :for="`${id}-motivo`">{{ t('enfermagem.correcao.motivo') }}</label>
        <textarea
          :id="`${id}-motivo`"
          v-model="motivo"
          maxlength="300"
          rows="3"
          required
          :aria-describedby="`${id}-ajuda`"
          :data-testid="`${testid}-motivo`"
        ></textarea>
        <small :id="`${id}-ajuda`">{{ t('enfermagem.correcao.motivoAjuda') }}</small>
      </span>
      <SenhaConfirmacao v-if="comSenha" v-model="senha" :testid="`${testid}-senha`" />
      <ErroEnfermagem v-if="erro" :erro="erro" />
      <div class="acoes">
        <SanteBotao
          tipo="submit"
          :rotulo="rotuloConfirmar || t('enfermagem.correcao.confirmar')"
          :desabilitado="!valido || ocupado"
          :data-testid="`${testid}-confirmar`"
        />
        <SanteBotao
          variante="secundario"
          :rotulo="t('enfermagem.correcao.cancelar')"
          @acionar="visivel = false"
        />
      </div>
    </form>
  </SanteDialogo>
</template>

<style scoped>
.corr {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
}
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
}
textarea {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
small {
  color: var(--sgh-texto-secundario);
}
.acoes {
  display: flex;
  gap: var(--sgh-espaco-2);
}
</style>
