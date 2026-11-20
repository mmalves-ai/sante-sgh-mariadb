<script setup lang="ts">
// Uma obrigação gerada (M53.8): o período, a geração, a situação, o leiaute (conferido ou não), o arquivo com a soma de
// verificação (SHA-256) que se confere no programa oficial, os totais e a entrega. As ações vêm da situação e da
// permissão `pessoas.obrigacao.gerar`: baixar o arquivo (leitura auditada no servidor), registrar a entrega (só com o
// leiaute conferido; no FGTS Digital, a guia tem de ser o apurado mais os acréscimos) e cancelar a gerada com motivo.
import { esquemaCancelarObrigacao, type ObrigacaoLegal } from '@sgh/contratos';
import { totalDaGuiaFgts } from '@sgh/dominio-pessoas';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteDialogo } from '@sgh/ui';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { dataBr } from '../../pessoas/comum.js';
import { instanteBr, reais } from '../comum-folha.js';
import ErroFolha from '../telas/ErroFolha.vue';
import {
  baixarArquivoObrigacao,
  cancelarObrigacao,
  registrarEntregaObrigacao,
  salvarArquivo,
} from './api-obrigacoes.js';
import {
  acoesDaObrigacao,
  entradaEntrega,
  type FormEntrega,
  rotuloPeriodoObrigacao,
} from './comum-obrigacoes.js';
import ResumoObrigacao from './ResumoObrigacao.vue';

const props = defineProps<{ obrigacao: ObrigacaoLegal; pode: boolean; hoje: string }>();
const emit = defineEmits<{ mudou: [o: ObrigacaoLegal, aviso: string] }>();
const { t, te } = useI18n();
const o = computed(() => props.obrigacao);
const acoes = computed(() => acoesDaObrigacao(o.value, props.pode));
const fgts = computed(() => o.value.tipo === 'fgts-digital');
const rotuloTipo = computed(() => t(`folha.obrigacoes.tipos.${o.value.tipo}`));
const rotuloPer = computed(() => rotuloPeriodoObrigacao(o.value.tipo, o.value.periodo));
const prefixo = computed(() => `obrigacao-${o.value.id}`);
const B = 'folha.obrigacoes.recusa';

const erro = ref<unknown>(null);
const aviso = ref<string | null>(null);
const ocupado = ref(false);
async function baixar(): Promise<void> {
  erro.value = null;
  ocupado.value = true;
  try {
    const a = await baixarArquivoObrigacao(o.value.id);
    salvarArquivo(a);
    aviso.value = t('folha.obrigacoes.baixado', { nome: a.nome });
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}

// ── Entrega ───────────────────────────────────────────────────────────────────────────────────────────────────
const entregaAberta = ref(false);
const fe = ref<FormEntrega>({ protocolo: '', data: null, valorGuia: '', acrescimos: '' });
const tentouEntrega = ref(false);
const erroEntrega = ref<unknown>(null);
function abrirEntrega(): void {
  fe.value = { protocolo: '', data: props.hoje, valorGuia: '', acrescimos: '' };
  tentouEntrega.value = false;
  erroEntrega.value = null;
  entregaAberta.value = true;
}
const entrada = computed(() => entradaEntrega(o.value, fe.value));
const camposEntrega = computed(() =>
  entrada.value.ok
    ? ''
    : entrada.value.campos
        .map((c) => {
          const k = c === 'protocolo' && fgts.value ? 'protocoloFgts' : c;
          return te(`folha.obrigacoes.entrega.${k}`) ? t(`folha.obrigacoes.entrega.${k}`) : c;
        })
        .join(', '),
);
async function entregar(): Promise<void> {
  tentouEntrega.value = true;
  if (!entrada.value.ok) return;
  erroEntrega.value = null;
  ocupado.value = true;
  try {
    const r = await registrarEntregaObrigacao(o.value.id, entrada.value.dados);
    entregaAberta.value = false;
    emit('mudou', r, t('folha.obrigacoes.entregue', { tipo: rotuloTipo.value, periodo: rotuloPer.value }));
  } catch (e) {
    erroEntrega.value = e;
  } finally {
    ocupado.value = false;
  }
}

// ── Cancelamento ──────────────────────────────────────────────────────────────────────────────────────────────
const cancelamentoAberto = ref(false);
const motivo = ref('');
const erroCancelamento = ref<unknown>(null);
const entradaCancelamento = computed(() =>
  esquemaCancelarObrigacao.safeParse({ versao: o.value.versao, motivo: motivo.value }),
);
function abrirCancelamento(): void {
  motivo.value = '';
  erroCancelamento.value = null;
  cancelamentoAberto.value = true;
}
async function cancelar(): Promise<void> {
  if (!entradaCancelamento.value.success) return;
  erroCancelamento.value = null;
  ocupado.value = true;
  try {
    const r = await cancelarObrigacao(o.value.id, entradaCancelamento.value.data);
    cancelamentoAberto.value = false;
    emit('mudou', r, t('folha.obrigacoes.cancelada', { tipo: rotuloTipo.value, periodo: rotuloPer.value }));
  } catch (e) {
    erroCancelamento.value = e;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <article class="bloco" :data-testid="prefixo">
    <h3>
      {{ rotuloTipo }} · {{ rotuloPer }} · {{ t('folha.obrigacoes.numero') }} {{ o.numero }} ·
      <span :data-testid="`${prefixo}-situacao`">{{ t(`folha.obrigacoes.situacoes.${o.situacao}`) }}</span>
    </h3>
    <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar :data-testid="`${prefixo}-aviso`" />
    <ErroFolha v-if="erro" :erro="erro" :base="B" />
    <p>
      {{ t('folha.obrigacoes.leiaute') }}: {{ o.leiaute }} ·
      <strong :data-testid="`${prefixo}-leiaute`">{{
        o.leiauteConferido
          ? t('folha.obrigacoes.leiauteConferido')
          : t('folha.obrigacoes.leiauteNaoConferido')
      }}</strong>
    </p>
    <p>
      {{ t('folha.obrigacoes.arquivo') }}: {{ o.nomeArquivo }} ·
      {{ t('folha.obrigacoes.tamanho', { n: o.tamanho }) }}
    </p>
    <p class="secundario">
      {{ t('folha.obrigacoes.resumo') }}: <code :data-testid="`${prefixo}-sha`">{{ o.resumo }}</code>
    </p>
    <p class="secundario">
      {{ t('folha.obrigacoes.registro') }}: {{ o.geradoPor }} · {{ instanteBr(o.geradoEm) }}
      <template v-if="o.motivo"> · {{ o.motivo }}</template>
    </p>
    <ResumoObrigacao
      :tipo="o.tipo"
      :totais="o.totais"
      :trabalhadores="o.trabalhadores"
      :conferencia="null"
      :pendencias="[]"
      :avisos="o.situacao === 'gerada' && !o.leiauteConferido ? ['leiaute-nao-conferido'] : []"
      :prefixo="prefixo"
      :previa="false"
    />
    <p v-if="o.entrega" :data-testid="`${prefixo}-entrega`">
      {{
        t('folha.obrigacoes.entrega.registrada', {
          data: dataBr(o.entrega.data),
          protocolo: o.entrega.protocolo,
          por: o.entrega.por,
        })
      }}
      <template v-if="o.entrega.valorGuia !== null">
        ·
        {{
          t('folha.obrigacoes.entrega.guia', {
            valor: reais(o.entrega.valorGuia),
            acrescimos: reais(o.entrega.acrescimos ?? 0),
          })
        }}
      </template>
    </p>
    <div v-if="acoes.baixar || acoes.entregar || acoes.cancelar" class="acoes">
      <SanteBotao
        v-if="acoes.baixar"
        :rotulo="t('folha.obrigacoes.baixar')"
        variante="secundario"
        :desabilitado="ocupado"
        :data-testid="`${prefixo}-baixar`"
        @acionar="baixar"
      />
      <SanteBotao
        v-if="acoes.entregar"
        :rotulo="t('folha.obrigacoes.entregar')"
        :desabilitado="ocupado"
        :data-testid="`${prefixo}-entregar`"
        @acionar="abrirEntrega"
      />
      <SanteBotao
        v-if="acoes.cancelar"
        :rotulo="t('folha.obrigacoes.cancelar')"
        variante="secundario"
        :desabilitado="ocupado"
        :data-testid="`${prefixo}-cancelar`"
        @acionar="abrirCancelamento"
      />
    </div>

    <SanteDialogo
      v-model:visivel="entregaAberta"
      :titulo="t('folha.obrigacoes.entrega.titulo')"
      largura="36rem"
    >
      <form :data-testid="`${prefixo}-form-entrega`" @submit.prevent="entregar">
        <p class="secundario">{{ t('folha.obrigacoes.entrega.ajuda') }}</p>
        <ErroFolha v-if="erroEntrega" :erro="erroEntrega" :base="B" />
        <div class="campos">
          <SanteCampoTexto
            v-model="fe.protocolo"
            :rotulo="
              fgts ? t('folha.obrigacoes.entrega.protocoloFgts') : t('folha.obrigacoes.entrega.protocolo')
            "
            :max-bytes="40"
            data-testid="obrigacao-entrega-protocolo"
          />
          <SanteData
            v-model="fe.data"
            :rotulo="t('folha.obrigacoes.entrega.data')"
            editavel
            data-testid="obrigacao-entrega-data"
          />
        </div>
        <template v-if="fgts">
          <p v-if="o.totais" class="secundario" data-testid="obrigacao-entrega-esperado">
            {{ t('folha.obrigacoes.entrega.esperado', { valor: reais(totalDaGuiaFgts(o.totais)) }) }}
          </p>
          <div class="campos">
            <SanteCampoTexto
              v-model="fe.valorGuia"
              :rotulo="t('folha.obrigacoes.entrega.valorGuia')"
              :max-bytes="16"
              data-testid="obrigacao-entrega-guia"
            />
            <SanteCampoTexto
              v-model="fe.acrescimos"
              :rotulo="t('folha.obrigacoes.entrega.acrescimos')"
              :max-bytes="16"
              data-testid="obrigacao-entrega-acrescimos"
            />
          </div>
        </template>
        <p v-if="tentouEntrega && !entrada.ok" role="alert" data-testid="obrigacao-entrega-invalida">
          {{ t('folha.obrigacoes.entrega.invalida', { campos: camposEntrega }) }}
        </p>
        <div class="acoes">
          <SanteBotao
            :rotulo="t('folha.obrigacoes.gravar')"
            tipo="submit"
            :desabilitado="ocupado"
            data-testid="obrigacao-entrega-gravar"
          />
          <SanteBotao
            :rotulo="t('folha.obrigacoes.fechar')"
            variante="secundario"
            @acionar="entregaAberta = false"
          />
        </div>
      </form>
    </SanteDialogo>

    <SanteDialogo
      v-model:visivel="cancelamentoAberto"
      :titulo="t('folha.obrigacoes.cancelamento.titulo')"
      largura="36rem"
    >
      <form :data-testid="`${prefixo}-form-cancelamento`" @submit.prevent="cancelar">
        <p class="secundario">{{ t('folha.obrigacoes.cancelamento.ajuda') }}</p>
        <ErroFolha v-if="erroCancelamento" :erro="erroCancelamento" :base="B" />
        <SanteCampoTexto
          v-model="motivo"
          :rotulo="t('folha.obrigacoes.cancelamento.motivo')"
          :max-bytes="200"
          data-testid="obrigacao-cancelamento-motivo"
        />
        <div class="acoes">
          <SanteBotao
            :rotulo="t('folha.obrigacoes.confirmar')"
            tipo="submit"
            :desabilitado="ocupado || !entradaCancelamento.success"
            data-testid="obrigacao-cancelamento-confirmar"
          />
          <SanteBotao
            :rotulo="t('folha.obrigacoes.fechar')"
            variante="secundario"
            @acionar="cancelamentoAberto = false"
          />
        </div>
      </form>
    </SanteDialogo>
  </article>
</template>

<style scoped src="../../pessoas/estilo-pessoas.css"></style>
