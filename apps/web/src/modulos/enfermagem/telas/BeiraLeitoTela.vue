<script setup lang="ts">
// Checagem por código de barras à beira do leito (ficha do M25, seção 7; DP-26: checagem em tela com a leitura da
// pulseira pela câmera do tablet enquanto a política não sai). Lê a pulseira (leitor que funciona como teclado,
// câmera quando o aparelho lê códigos, ou digitação) e abre os horários do paciente; a pulseira lida vai junto da
// checagem e o servidor confere de novo. Sem rede, os horários guardados neste aparelho continuam na tela e a
// checagem vai para a fila.
import { SanteBotao } from '@sgh/ui';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { lerPulseira, type PacienteDaPulseira } from '../api-enfermagem.js';
import ErroEnfermagem from '../componentes/ErroEnfermagem.vue';
import PainelHorarios from '../componentes/PainelHorarios.vue';

const { t } = useI18n();
const rota = useRoute();
const codigo = ref('');
const lido = ref<string | null>(null);
const paciente = ref<PacienteDaPulseira | null>(null);
const atendimentoDaRota = computed(() => Number(rota.query['atendimento'] ?? 0) || null);
const atendimento = computed(() => paciente.value?.atendimento ?? atendimentoDaRota.value);
const erro = ref<unknown>(null);
const ocupado = ref(false);

async function ler(): Promise<void> {
  const c = codigo.value.trim().toUpperCase();
  if (!c) return;
  erro.value = null;
  ocupado.value = true;
  try {
    paciente.value = await lerPulseira(c);
    lido.value = c;
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
function outro(): void {
  paciente.value = null;
  lido.value = null;
  codigo.value = '';
}

// Câmera: só onde o navegador tem o leitor de códigos (BarcodeDetector).
interface Detector {
  detect(fonte: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
const temCamera = typeof (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector === 'function';
const video = ref<HTMLVideoElement | null>(null);
const lendo = ref(false);
let fluxo: MediaStream | null = null;
let laco: ReturnType<typeof setInterval> | null = null;
async function camera(): Promise<void> {
  if (!temCamera || lendo.value) return;
  try {
    fluxo = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    lendo.value = true;
    await Promise.resolve();
    if (video.value) {
      video.value.srcObject = fluxo;
      await video.value.play();
    }
    const D = (globalThis as unknown as { BarcodeDetector: new (o: unknown) => Detector }).BarcodeDetector;
    const detector = new D({ formats: ['qr_code', 'code_128', 'data_matrix'] });
    laco = setInterval(async () => {
      if (!video.value) return;
      const r = await detector.detect(video.value).catch(() => []);
      if (r[0]?.rawValue) {
        codigo.value = r[0].rawValue;
        parar();
        await ler();
      }
    }, 400);
  } catch (x) {
    erro.value = x;
    parar();
  }
}
function parar(): void {
  if (laco) clearInterval(laco);
  laco = null;
  fluxo?.getTracks().forEach((k) => k.stop());
  fluxo = null;
  lendo.value = false;
}
onBeforeUnmount(parar);
watch(atendimentoDaRota, () => {
  if (atendimentoDaRota.value) paciente.value = null;
});
</script>

<template>
  <section class="tela-enf" aria-labelledby="beira-titulo" data-testid="tela-beira-leito">
    <h1 id="beira-titulo">{{ t('enfermagem.beira.titulo') }}</h1>
    <p>{{ t('enfermagem.beira.texto') }}</p>
    <form class="barra" data-testid="form-pulseira" @submit.prevent="ler">
      <span class="campo">
        <label for="beira-codigo">{{ t('enfermagem.checagem.codigoPulseira') }}</label>
        <input id="beira-codigo" v-model="codigo" autocomplete="off" autofocus data-testid="beira-codigo" />
      </span>
      <SanteBotao
        tipo="submit"
        :rotulo="t('enfermagem.checagem.lerPulseira')"
        :desabilitado="ocupado"
        data-testid="beira-ler"
      />
      <SanteBotao
        v-if="temCamera && !lendo"
        variante="secundario"
        :rotulo="t('enfermagem.beira.lerCamera')"
        @acionar="camera"
      />
      <SanteBotao
        v-if="lendo"
        variante="secundario"
        :rotulo="t('enfermagem.beira.pararCamera')"
        @acionar="parar"
      />
      <SanteBotao
        v-if="paciente"
        variante="texto"
        :rotulo="t('enfermagem.beira.outroPaciente')"
        @acionar="outro"
      />
    </form>
    <p v-if="!temCamera" class="secundario">{{ t('enfermagem.beira.semCamera') }}</p>
    <video v-if="lendo" ref="video" class="camera" muted playsinline></video>
    <ErroEnfermagem v-if="erro" :erro="erro" />
    <p v-if="paciente" role="status" data-testid="beira-paciente">
      {{ t('enfermagem.checagem.pulseiraConfere', { nome: paciente.nome }) }}
    </p>
    <PainelHorarios v-if="atendimento" :atendimento="atendimento" :pulseira-lida="lido" />
  </section>
</template>

<style src="./estilo-enfermagem.css"></style>
<style scoped>
.camera {
  width: 100%;
  max-width: 28rem;
  border-radius: 6px;
}
</style>
