<script setup lang="ts">
// 02-CAD linha 24: a regra do plano na tela de abertura, na hora. Enquanto a recepção preenche o convênio, a carteira,
// a validade e a guia, a prévia (a mesma crítica que a abertura aplica no servidor, sem gravar) mostra o que bloqueia,
// o que só alerta, os documentos pedidos e a orientação. Depois de aberto, os alertas do servidor (o que vale) chegam
// por `aberto`. Sem regra vigente, nada aparece.
import { SanteAlerta } from '@sgh/ui';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { pode } from '../../../casca/sessao/pode.js';
import { type CriticaPlanoTela, previaRegraPlano } from '../api-regras-plano.js';

const props = defineProps<{
  fonte: number;
  paciente: number | null;
  carteira: string;
  validadeCarteira: string;
  guia: string;
  /** Avisos que o servidor devolveu na abertura (alertaPlanoMotivo e orientacaoPlano). */
  aberto?: { alerta: string | null; orientacao: string | null } | null;
}>();

const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      titulo: 'Regra do plano',
      bloqueia: 'A abertura será recusada: {lista}',
      alerta: 'Atenção: {lista}',
      documentos: 'Documentos pedidos: {lista}.',
      abertoAlerta: 'Atendimento aberto com aviso do plano: {texto}',
    },
  },
});

const critica = ref<CriticaPlanoTela | null>(null);
let espera: ReturnType<typeof setTimeout> | null = null;
let pedido = 0;
const nulo = (v: string) => (v.trim() === '' ? null : v.trim());

async function conferir(): Promise<void> {
  const n = ++pedido;
  if (props.fonte <= 0 || !pode('atendimento.atendimento.abrir')) {
    critica.value = null;
    return;
  }
  try {
    const r = await previaRegraPlano({
      fonteId: props.fonte,
      pacienteId: props.paciente,
      carteira: nulo(props.carteira),
      validadeCarteira: nulo(props.validadeCarteira),
      guia: nulo(props.guia),
    });
    if (n === pedido) critica.value = r.regraId === null ? null : r;
  } catch {
    // A prévia é ajuda: sem ela, a abertura confere do mesmo jeito no servidor.
    if (n === pedido) critica.value = null;
  }
}

watch(
  () => [props.fonte, props.paciente, props.carteira, props.validadeCarteira, props.guia],
  () => {
    if (espera) clearTimeout(espera);
    espera = setTimeout(() => void conferir(), 400);
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  if (espera) clearTimeout(espera);
});

const orientacao = computed(() => {
  const c = critica.value;
  if (!c) return null;
  return [c.documentos.length ? t('documentos', { lista: c.documentos.join(', ') }) : '', c.orientacao ?? '']
    .filter((x) => x !== '')
    .join(' ');
});
</script>

<template>
  <div v-if="aberto && (aberto.alerta || aberto.orientacao)" data-testid="abrir-atd-plano-aberto">
    <SanteAlerta
      v-if="aberto.alerta"
      variante="aviso"
      :texto="t('abertoAlerta', { texto: aberto.alerta })"
      anunciar
    />
    <SanteAlerta v-if="aberto.orientacao" variante="info" :texto="aberto.orientacao" />
  </div>
  <div v-else-if="critica" :aria-label="t('titulo')" data-testid="abrir-atd-plano">
    <SanteAlerta
      v-if="critica.bloqueios.length"
      variante="alerta"
      :texto="t('bloqueia', { lista: critica.bloqueios.map((b) => b.mensagem).join(' ') })"
      data-testid="abrir-atd-plano-bloqueio"
    />
    <SanteAlerta
      v-if="critica.alertas.length"
      variante="aviso"
      :texto="t('alerta', { lista: critica.alertas.map((a) => a.mensagem).join(' ') })"
      data-testid="abrir-atd-plano-alerta"
    />
    <SanteAlerta
      v-if="orientacao"
      variante="info"
      :texto="orientacao"
      data-testid="abrir-atd-plano-orientacao"
    />
  </div>
</template>
