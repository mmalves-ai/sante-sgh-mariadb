<script setup lang="ts">
// Minhas pendências de prontuário (W0-04, M5): o que a comissão de revisão de prontuários apontou nos prontuários dos
// pacientes do profissional da sessão (só as dele: o servidor filtra pelo login e recusa responder a de outro). Cada
// pendência aberta se responde num diálogo, com o que foi completado (10 a 500 caracteres).
import '../../componentes/estilo-qualidade.css';
import '../../ccih/componentes/estilo-ccih.css';
import '../componentes/estilo-gestao.css';
import { SanteBotao, SanteCampoTexto, SanteDialogo } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { novaChaveCorrecao } from '../../api-correcao.js';
import { lerMinhasPendencias, type PendenciaRevisaoTela, responderPendencia } from '../api-revisao.js';
import ErroGestao from '../componentes/ErroGestao.vue';
import { dataBr } from '../regras-gestao.js';

const { t } = useI18n();
const R = (k: string, p?: Record<string, unknown>) => t(`gestaoQualidade.revisao.${k}`, p ?? {});
const cliente = useQueryClient();
const lista = useQuery({ queryKey: ['revisaoProntuario', 'minhas'], queryFn: lerMinhasPendencias });
const aviso = ref<string | null>(null);
const aberta = ref<PendenciaRevisaoTela | null>(null);
const visivel = ref(false);
const resposta = ref('');
const erro = ref<unknown>(null);
const enviando = ref(false);
const valida = computed(() => resposta.value.trim().length >= 10);
let chave = novaChaveCorrecao('resposta-pendencia');
function abrir(p: PendenciaRevisaoTela): void {
  aberta.value = p;
  resposta.value = '';
  erro.value = null;
  visivel.value = true;
}
async function enviar(): Promise<void> {
  const p = aberta.value;
  if (!p || !valida.value) return;
  enviando.value = true;
  erro.value = null;
  try {
    await responderPendencia(p.id, p.versao, resposta.value.trim(), chave);
    chave = novaChaveCorrecao('resposta-pendencia');
    visivel.value = false;
    aviso.value = R('minhas.respondida');
    await cliente.invalidateQueries({ queryKey: ['revisaoProntuario'] });
  } catch (e) {
    erro.value = e;
  } finally {
    enviando.value = false;
  }
}
</script>

<template>
  <section class="tela-gestao" aria-labelledby="minhas-titulo" data-testid="tela-minhas-pendencias">
    <h1 id="minhas-titulo">{{ R('minhas.titulo') }}</h1>
    <p class="secundario">{{ R('minhas.explicacao') }}</p>
    <div v-if="aviso" role="status" data-testid="minhas-aviso">{{ aviso }}</div>
    <ErroGestao v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!lista.data.value" role="status">{{ t('gestaoQualidade.carregando') }}</p>
    <p v-else-if="!lista.data.value.itens.length" data-testid="minhas-vazio">{{ R('minhas.nenhuma') }}</p>
    <ul v-else class="lista-ccih" data-testid="minhas-lista">
      <li v-for="p in lista.data.value.itens" :key="p.id" :data-testid="`minha-${p.id}`">
        <strong>{{ R('colInternacao') }} {{ p.reg }}</strong
        >: {{ p.descricao }}
        <span class="selo selo--neutro">{{ R(`situacaoPendencia.${p.situacao}`) }}</span>
        <span v-if="p.vencida" class="prazo prazo--vencido">{{ R('vencida') }}</span>
        <div class="secundario">{{ R('minhas.prazo', { d: dataBr(p.prazo) }) }}</div>
        <div v-if="p.resposta" class="secundario">{{ p.resposta }}</div>
        <SanteBotao
          v-if="p.situacao === 'aberta'"
          variante="secundario"
          :rotulo="R('minhas.responder')"
          :data-testid="`responder-${p.id}`"
          @acionar="abrir(p)"
        />
      </li>
    </ul>
    <SanteDialogo
      v-model:visivel="visivel"
      :titulo="aberta ? R('minhas.responderTitulo', { reg: aberta.reg }) : ''"
      largura="36rem"
    >
      <form v-if="aberta" class="painel-ccih" data-testid="form-resposta" @submit.prevent="enviar">
        <p>{{ aberta.descricao }}</p>
        <SanteCampoTexto
          v-model="resposta"
          :rotulo="R('minhas.resposta')"
          :max-bytes="500"
          multilinha
          obrigatorio
          data-testid="resposta-texto"
        />
        <p class="secundario">{{ R('minhas.respostaAjuda') }}</p>
        <ErroGestao v-if="erro" :erro="erro" />
        <div class="linha-ccih">
          <SanteBotao :rotulo="t('gestaoQualidade.fechar')" variante="texto" @acionar="visivel = false" />
          <SanteBotao
            tipo="submit"
            :rotulo="R('minhas.enviar')"
            :desabilitado="enviando || !valida"
            data-testid="resposta-enviar"
          />
        </div>
      </form>
    </SanteDialogo>
  </section>
</template>
