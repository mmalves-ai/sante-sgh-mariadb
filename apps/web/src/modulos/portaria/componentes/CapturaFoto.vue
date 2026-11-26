<script setup lang="ts">
// Foto do visitante (M50, etapa 5; regra 10: sem a biometria, o documento e a foto): a webcam da portaria (com a
// permissão do navegador) ou um arquivo de imagem. A imagem é reduzida a 480 px no maior lado, em JPEG, para ficar
// abaixo de 300 KB; o servidor confere de novo o tipo e o tamanho.
import { SanteBotao } from '@sgh/ui';
import { onBeforeUnmount, ref } from 'vue';
import { useI18n } from 'vue-i18n';

const foto = defineModel<{ tipo: 'image/jpeg'; base64: string } | null>({ required: true });
/** Título, ajuda e texto alternativo de quem reaproveita a captura (02-CAD linha 5: a foto do paciente na ficha). */
const props = defineProps<{ titulo?: string; ajuda?: string; previa?: string }>();
const { t } = useI18n();
const video = ref<HTMLVideoElement | null>(null);
const ligada = ref(false);
const erro = ref<string | null>(null);
let fluxo: MediaStream | null = null;

function parar(): void {
  for (const f of fluxo?.getTracks() ?? []) f.stop();
  fluxo = null;
  ligada.value = false;
}
onBeforeUnmount(parar);

async function ligar(): Promise<void> {
  erro.value = null;
  try {
    fluxo = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
    ligada.value = true;
    await Promise.resolve();
    if (video.value) {
      video.value.srcObject = fluxo;
      await video.value.play();
    }
  } catch {
    erro.value = t('portaria.foto.semCamera');
    parar();
  }
}

function reduzir(origem: CanvasImageSource, largura: number, altura: number): void {
  const escala = Math.min(1, 480 / Math.max(largura, altura));
  const c = document.createElement('canvas');
  c.width = Math.round(largura * escala);
  c.height = Math.round(altura * escala);
  c.getContext('2d')?.drawImage(origem, 0, 0, c.width, c.height);
  const url = c.toDataURL('image/jpeg', 0.8);
  foto.value = { tipo: 'image/jpeg', base64: url.slice(url.indexOf(',') + 1) };
}

function capturar(): void {
  const v = video.value;
  if (!v) return;
  reduzir(v, v.videoWidth || 640, v.videoHeight || 480);
  parar();
}

function arquivo(ev: Event): void {
  const f = (ev.target as HTMLInputElement).files?.[0];
  if (!f) return;
  const img = new Image();
  img.onload = () => {
    reduzir(img, img.naturalWidth, img.naturalHeight);
    URL.revokeObjectURL(img.src);
  };
  img.onerror = () => {
    erro.value = t('portaria.foto.arquivoInvalido');
  };
  img.src = URL.createObjectURL(f);
}
</script>

<template>
  <fieldset class="foto" data-testid="pt-foto">
    <legend>{{ props.titulo ?? t('portaria.foto.titulo') }}</legend>
    <p class="secundario">{{ props.ajuda ?? t('portaria.foto.ajuda') }}</p>
    <div class="barra">
      <SanteBotao
        v-if="!ligada"
        variante="secundario"
        :rotulo="t('portaria.foto.ligar')"
        data-testid="pt-foto-ligar"
        @acionar="ligar"
      />
      <SanteBotao
        v-else
        :rotulo="t('portaria.foto.capturar')"
        data-testid="pt-foto-capturar"
        @acionar="capturar"
      />
      <label class="arquivo">
        {{ t('portaria.foto.arquivo') }}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          data-testid="pt-foto-arquivo"
          @change="arquivo"
        />
      </label>
      <SanteBotao
        v-if="foto"
        variante="texto"
        :rotulo="t('portaria.foto.remover')"
        data-testid="pt-foto-remover"
        @acionar="foto = null"
      />
    </div>
    <video
      v-show="ligada"
      ref="video"
      class="previa"
      muted
      playsinline
      :aria-label="t('portaria.foto.camera')"
    />
    <img
      v-if="foto"
      class="previa"
      :src="`data:${foto.tipo};base64,${foto.base64}`"
      :alt="props.previa ?? t('portaria.foto.previa')"
      data-testid="pt-foto-previa"
    />
    <p v-if="erro" role="alert">{{ erro }}</p>
  </fieldset>
</template>

<style scoped>
.foto {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda);
  padding: var(--sgh-espaco-2);
}
.previa {
  max-width: 12rem;
  border: 1px solid var(--sgh-borda);
}
.arquivo {
  display: inline-flex;
  flex-direction: column;
  gap: var(--sgh-espaco-1);
}
</style>
