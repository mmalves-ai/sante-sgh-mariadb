<script setup lang="ts">
// Exportação para o Notivisa (M48, etapa 1; regra 3): o Notivisa não recebe envio automático, então o NSP gera os
// campos (o paciente só com iniciais, sexo e idade), copia e digita no portal da Anvisa; depois registra o número
// devolvido e o instante, e o relógio do prazo para. Gerar os campos grava o evento uma vez (a primeira).
import type { CamposNotivisa } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteHora } from '@sgh/ui';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { gerarCamposNotivisa, novaChaveQualidade, registrarTranscricao } from '../api.js';
import { mensagensQualidade } from '../i18n.js';
import { instanteDosCampos, linhasDosCampos, textoParaCopiar } from '../regras-qualidade.js';
import ErroQualidade from './ErroQualidade.vue';

const props = defineProps<{
  id: number;
  protocolo: string;
  versao: number;
  agora: string;
  transcrita: boolean;
  podeExportar: boolean;
}>();
const emit = defineEmits<{ mudou: [] }>();
const { t } = useI18n();

const campos = ref<CamposNotivisa | null>(null);
const erro = ref<unknown>(null);
const copiado = ref(false);
const linhas = computed(() =>
  campos.value
    ? linhasDosCampos(
        campos.value,
        mensagensQualidade.prazos.campos,
        mensagensQualidade.prazos.periodos,
        (b) => (b ? t('qualidade.sim') : t('qualidade.nao')),
      )
    : [],
);
let chaveCampos = novaChaveQualidade('notivisa-campos');
async function gerar(): Promise<void> {
  erro.value = null;
  copiado.value = false;
  try {
    campos.value = await gerarCamposNotivisa(props.id, chaveCampos);
    chaveCampos = novaChaveQualidade('notivisa-campos');
    emit('mudou');
  } catch (e) {
    erro.value = e;
  }
}
async function copiar(): Promise<void> {
  try {
    await navigator.clipboard.writeText(textoParaCopiar(linhas.value));
    copiado.value = true;
  } catch {
    copiado.value = false;
  }
}

const transcricao = reactive({
  numero: '',
  data: props.agora.slice(0, 10) as string | null,
  hora: props.agora.slice(11, 16) as string | null,
});
const feito = ref<string | null>(null);
const falta = ref<string | null>(null);
let chaveTranscricao = novaChaveQualidade('notivisa-transcricao');
async function registrar(): Promise<void> {
  erro.value = null;
  falta.value = null;
  feito.value = null;
  const em = instanteDosCampos(transcricao.data, transcricao.hora);
  if (!em || !/^[A-Za-z0-9./-]{3,30}$/.test(transcricao.numero.trim())) {
    falta.value = t('qualidade.prazos.transcricaoFalta');
    return;
  }
  try {
    await registrarTranscricao(
      props.id,
      { versao: props.versao, numeroNotivisa: transcricao.numero.trim(), transcritaEm: em },
      chaveTranscricao,
    );
    chaveTranscricao = novaChaveQualidade('notivisa-transcricao');
    feito.value = t('qualidade.prazos.transcricaoFeita');
    emit('mudou');
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <section
    class="painel-nsp"
    :aria-label="t('qualidade.prazos.notivisa')"
    :data-testid="`painel-notivisa-${protocolo}`"
  >
    <h2>{{ t('qualidade.prazos.notivisa') }} · {{ protocolo }}</h2>
    <SanteAlerta variante="info" :texto="t('qualidade.prazos.semApi')" />
    <div class="linha-nsp">
      <SanteBotao
        :rotulo="t('qualidade.prazos.gerarCampos')"
        variante="secundario"
        :desabilitado="!podeExportar"
        data-testid="gerar-campos"
        @acionar="gerar"
      />
      <SanteBotao
        v-if="campos"
        :rotulo="t('qualidade.prazos.copiar')"
        variante="secundario"
        data-testid="copiar-campos"
        @acionar="copiar"
      />
      <span v-if="copiado" role="status">{{ t('qualidade.prazos.copiado') }}</span>
    </div>
    <dl v-if="campos" class="campos" data-testid="campos-notivisa">
      <template v-for="l in linhas" :key="l.chave">
        <dt>{{ l.rotulo }}</dt>
        <dd :data-campo="l.chave">{{ l.valor }}</dd>
      </template>
    </dl>
    <p v-if="transcrita" data-testid="ja-transcrita">{{ t('qualidade.prazos.jaTranscrita') }}</p>
    <form
      v-else-if="podeExportar"
      class="linha-nsp"
      data-testid="form-transcricao"
      @submit.prevent="registrar"
    >
      <SanteCampoTexto
        v-model="transcricao.numero"
        :rotulo="t('qualidade.prazos.numeroNotivisa')"
        :max-bytes="30"
        obrigatorio
        data-testid="numero-notivisa"
      />
      <SanteData v-model="transcricao.data" :rotulo="t('qualidade.prazos.transcritaEm')" editavel />
      <SanteHora v-model="transcricao.hora" :rotulo="t('qualidade.notificar.hora')" editavel />
      <SanteBotao
        :rotulo="t('qualidade.prazos.registrarTranscricao')"
        variante="primario"
        tipo="submit"
        data-testid="registrar-transcricao"
      />
    </form>
    <SanteAlerta v-if="falta" variante="aviso" :texto="falta" anunciar />
    <SanteAlerta v-if="feito" variante="info" :texto="feito" anunciar data-testid="transcricao-feita" />
    <ErroQualidade v-if="erro" :erro="erro" />
  </section>
</template>

<style>
@import './estilo-qualidade.css';
</style>
<style scoped>
.campos {
  display: grid;
  grid-template-columns: minmax(10rem, max-content) 1fr;
  gap: var(--sgh-espaco-1) var(--sgh-espaco-3);
  margin: 0;
}
.campos dt {
  font-weight: 600;
}
.campos dd {
  margin: 0;
  white-space: pre-wrap;
}
</style>
