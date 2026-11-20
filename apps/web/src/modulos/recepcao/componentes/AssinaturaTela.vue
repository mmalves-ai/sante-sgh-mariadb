<script setup lang="ts">
// W1-04: assinatura em tela (tablet do guichê, caneta ou mouse). O traço vira PNG em base64 SEM o prefixo data:
// (o esquema esquemaAssinarTermo recusa o prefixo); vazio devolve null. O servidor calcula o hash da imagem e do
// conteúdo canônico: a tela não guarda nada depois de gravar.
import { resolverMarca, SanteBotao, tokensDoTema } from '@sgh/ui';
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

// O traço guardado é papel claro com tinta escura em qualquer tema (a imagem vai ao prontuário e à impressão): as cores
// vêm do tema claro dos tokens, nunca de hexadecimal solto.
const PAPEL = tokensDoTema(resolverMarca(null).pacote).claro;

const imagem = defineModel<string | null>({ required: true });
const { t } = useI18n();
const tela = ref<HTMLCanvasElement | null>(null);
let desenhando = false;
let tracou = false;

function contexto(): CanvasRenderingContext2D | null {
  return tela.value?.getContext('2d') ?? null;
}
function ponto(e: PointerEvent): { x: number; y: number } {
  const r = tela.value!.getBoundingClientRect();
  return {
    x: ((e.clientX - r.left) * tela.value!.width) / r.width,
    y: ((e.clientY - r.top) * tela.value!.height) / r.height,
  };
}
function comecar(e: PointerEvent): void {
  const c = contexto();
  if (!c) return;
  desenhando = true;
  tela.value!.setPointerCapture?.(e.pointerId);
  const p = ponto(e);
  c.beginPath();
  c.moveTo(p.x, p.y);
}
function mover(e: PointerEvent): void {
  if (!desenhando) return;
  const c = contexto();
  if (!c) return;
  const p = ponto(e);
  c.lineTo(p.x, p.y);
  c.stroke();
  tracou = true;
}
function terminar(): void {
  if (!desenhando) return;
  desenhando = false;
  if (tracou) imagem.value = tela.value!.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
}
function preparar(): void {
  const c = contexto();
  if (!c || !tela.value) return;
  c.fillStyle = PAPEL.fundo;
  c.fillRect(0, 0, tela.value.width, tela.value.height);
  c.lineWidth = 3;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.strokeStyle = PAPEL.texto;
}
function limpar(): void {
  tracou = false;
  imagem.value = null;
  preparar();
}
onMounted(preparar);
</script>

<template>
  <div class="assinatura-tela">
    <canvas
      ref="tela"
      width="600"
      height="180"
      role="img"
      :aria-label="t('recepcao.termos.tracoRotulo')"
      data-testid="assinatura-canvas"
      @pointerdown.prevent="comecar"
      @pointermove.prevent="mover"
      @pointerup="terminar"
      @pointerleave="terminar"
      @pointercancel="terminar"
    ></canvas>
    <div class="assinatura-acoes">
      <span v-if="!imagem" class="assinatura-dica">{{ t('recepcao.termos.tracoVazio') }}</span>
      <SanteBotao
        variante="texto"
        :rotulo="t('recepcao.termos.limpar')"
        data-testid="assinatura-limpar"
        @acionar="limpar"
      />
    </div>
  </div>
</template>

<style scoped>
.assinatura-tela {
  display: grid;
  gap: var(--sgh-espaco-1);
}
canvas {
  width: 100%;
  max-width: 600px;
  aspect-ratio: 600 / 180;
  border: 1px dashed var(--sgh-borda-forte);
  border-radius: var(--sgh-raio, 4px);
  /* O traço é desenhado sobre o branco pintado no próprio canvas (fillRect). */
  background: var(--sgh-fundo);
  touch-action: none;
  cursor: crosshair;
}
.assinatura-acoes {
  display: flex;
  align-items: center;
  gap: var(--sgh-espaco-2);
}
.assinatura-dica {
  color: var(--sgh-texto-secundario);
}
</style>
