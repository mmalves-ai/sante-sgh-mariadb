<script setup lang="ts">
// W0-06 (programa CRUD completo): o diálogo único das correções da gestão de pessoas que pedem o motivo (excluir o
// rascunho, cancelar a escala publicada, anular a vigência, desistir do ajuste, desativar a regra do banco). O motivo
// tem pelo menos 10 caracteres (o servidor confere de novo) e vai à trilha com o valor anterior. A recusa do servidor
// (o 409 com a contagem dos registros ligados) aparece no próprio diálogo, com a lista de bloqueios.
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteDialogo } from '@sgh/ui';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import ErroPessoas from './ErroPessoas.vue';

const props = withDefaults(
  defineProps<{
    titulo: string;
    texto: string;
    confirmar: string;
    /** destrutivo: excluir e cancelar; padrão: reativar. */
    variante?: 'destrutivo' | 'primario';
    acao: (motivo: string) => Promise<unknown>;
    testid: string;
    /** Os campos do slot padrão (ex.: o formulário da retificação) estão válidos; sem o slot, sempre. */
    pronto?: boolean;
    /** Largura do diálogo (o formulário da retificação pede mais). */
    largura?: string;
  }>(),
  { pronto: true, largura: '36rem' },
);
const visivel = defineModel<boolean>('visivel', { required: true });
const emit = defineEmits<{ feito: [r: unknown] }>();
const { t } = useI18n();
const motivo = ref('');
const erro = ref<unknown>(null);
const ocupado = ref(false);
watch(visivel, (v) => {
  if (v) {
    motivo.value = '';
    erro.value = null;
  }
});
const curto = computed(() => motivo.value.trim().length < 10);
const bloqueios = computed(() => {
  const e = erro.value;
  if (!(e instanceof ErroApi)) return [];
  const b = (e.problema as { bloqueios?: unknown } | null)?.bloqueios;
  return Array.isArray(b) ? b.map(String) : [];
});
const avisos = computed(() => {
  const e = erro.value;
  if (!(e instanceof ErroApi)) return [];
  const v = (e.problema as { avisos?: unknown } | null)?.avisos;
  return Array.isArray(v) ? v.map(String) : [];
});
/** O código da recusa (ex.: `inscricao-com-presenca`), para a tela oferecer o caminho certo no slot `recusa`. */
const codigoRecusa = computed(() => {
  const e = erro.value;
  if (!(e instanceof ErroApi)) return null;
  const c = (e.problema as { codigo?: unknown } | null)?.codigo;
  return typeof c === 'string' ? c : null;
});
async function confirmarAcao(): Promise<void> {
  if (curto.value || !props.pronto) return;
  erro.value = null;
  ocupado.value = true;
  try {
    const r = await props.acao(motivo.value.trim());
    emit('feito', r);
    visivel.value = false;
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <SanteDialogo v-model:visivel="visivel" :titulo="titulo" :largura="largura">
    <div class="bloco" :data-testid="testid">
      <p>{{ texto }}</p>
      <slot />
      <SanteCampoTexto
        v-model="motivo"
        :rotulo="t('pessoas.crud.motivo')"
        :max-bytes="400"
        multilinha
        :data-testid="`${testid}-motivo`"
      />
      <p v-if="curto" class="secundario">{{ t('pessoas.crud.motivoMinimo') }}</p>
      <ErroPessoas v-if="erro" :erro="erro" />
      <ul v-if="bloqueios.length > 0" :data-testid="`${testid}-bloqueios`">
        <li v-for="b in bloqueios" :key="b">{{ b }}</li>
      </ul>
      <ul v-if="avisos.length > 0" class="secundario" :data-testid="`${testid}-caminho`">
        <li v-for="a in avisos" :key="a">{{ t('pessoas.crud.caminho', { a }) }}</li>
      </ul>
      <SanteAlerta v-if="bloqueios.length > 0" :texto="t('pessoas.crud.bloqueiosAjuda')" variante="info" />
      <slot v-if="codigoRecusa" name="recusa" :codigo="codigoRecusa" />
      <div class="acoes">
        <SanteBotao
          :rotulo="confirmar"
          :variante="variante ?? 'destrutivo'"
          :confirmacao="(variante ?? 'destrutivo') === 'destrutivo' ? t('pessoas.crud.confirmar') : ''"
          :desabilitado="ocupado || curto || !pronto"
          :data-testid="`${testid}-confirmar`"
          @acionar="confirmarAcao"
        />
        <SanteBotao :rotulo="t('pessoas.plantao.fechar')" variante="texto" @acionar="visivel = false" />
      </div>
    </div>
  </SanteDialogo>
</template>

<style scoped src="../estilo-pessoas.css"></style>
