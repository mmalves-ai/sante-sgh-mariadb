<script setup lang="ts">
// Demonstração (só no servidor de desenvolvimento) da decisão em passos e da quebra de vidro (M06): abrir o
// "prontuário" de um paciente SINTÉTICO de recurso novo (vínculo sempre exigido). Sem vínculo, a pessoa com
// acesso.emergencia.solicitar vê o diálogo; quem não tem, só a negativa. Some com o PEP (M15).
import { type EmergenciaAberta } from '@sgh/contratos';
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import { abrirProntuarioDemonstracao, type ProntuarioDemonstracao } from '../api-acesso.js';
import QuebraVidroDialogo from '../componentes/QuebraVidroDialogo.vue';

const ID_SINTETICO = 999_000_001;
const { t } = useI18n();
const prontuario = ref<ProntuarioDemonstracao | null>(null);
const erro = ref<unknown>(null);
const oferecer = ref(false);
const dialogo = ref(false);
const aberta = ref<EmergenciaAberta | null>(null);

async function abrir(): Promise<void> {
  erro.value = null;
  oferecer.value = false;
  try {
    prontuario.value = await abrirProntuarioDemonstracao(ID_SINTETICO);
  } catch (e) {
    prontuario.value = null;
    const quebra = e instanceof ErroApi && e.problema?.['quebraDeVidro'] === true;
    if (quebra) oferecer.value = true;
    else erro.value = e;
  }
}

async function aposAbrir(r: EmergenciaAberta): Promise<void> {
  aberta.value = r;
  await abrir();
}
</script>

<template>
  <section class="tela" aria-labelledby="qv-titulo">
    <h1 id="qv-titulo">{{ t('acesso.emergencia.demonstracao.titulo') }}</h1>
    <p>{{ t('acesso.emergencia.demonstracao.texto') }}</p>
    <SanteBotao :rotulo="t('acesso.emergencia.demonstracao.abrir')" @acionar="abrir" />
    <MensagemErro v-if="erro" :erro="erro" />
    <div v-if="oferecer" data-testid="oferta-quebra-vidro">
      <SanteAlerta variante="aviso" :texto="t('acesso.emergencia.demonstracao.semVinculo')" />
      <SanteBotao :rotulo="t('acesso.emergencia.demonstracao.quebrar')" @acionar="dialogo = true" />
    </div>
    <p v-if="aberta" data-testid="emergencia-aberta">
      {{ t('acesso.emergencia.demonstracao.aberta', { id: aberta.id, alerta: aberta.alerta }) }}
    </p>
    <dl v-if="prontuario" data-testid="prontuario-sintetico">
      <dt>{{ t('acesso.emergencia.demonstracao.paciente') }}</dt>
      <dd>{{ prontuario.paciente.nome }}</dd>
      <dt>{{ t('acesso.emergencia.demonstracao.prontuario') }}</dt>
      <dd>{{ prontuario.paciente.prontuario }}</dd>
    </dl>
    <QuebraVidroDialogo v-model:visivel="dialogo" :id-paciente="ID_SINTETICO" @aberta="aposAbrir" />
  </section>
</template>
