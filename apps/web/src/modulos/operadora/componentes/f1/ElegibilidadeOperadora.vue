<script setup lang="ts">
// Elegibilidade pela carteirinha (M56.2; ficha, seção 4: uma linha pela carteirinha, p95 < 300 ms): elegível ou não,
// com os motivos, o plano (registro, segmentação, acomodação) e as carências que ainda correm. A consulta é leitura
// auditada no servidor.
import {
  ABRANGENCIAS_PRODUTO,
  ACOMODACOES_PLANO_OPERADORA,
  type Elegibilidade,
  SEGMENTACOES_PRODUTO,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData } from '@sgh/ui';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { lerElegibilidade } from '../../api-operadora.js';
import { dataBr, hoje } from './comum.js';
import ErroOperadora from './ErroOperadora.vue';

const { t } = useI18n();
const carteirinha = ref('');
const data = ref<string | null>(hoje());
const r = ref<Elegibilidade | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);

async function consultar(): Promise<void> {
  ocupado.value = true;
  erro.value = null;
  try {
    r.value = await lerElegibilidade(carteirinha.value, data.value);
  } catch (x) {
    erro.value = x;
    r.value = null;
  } finally {
    ocupado.value = false;
  }
}
const segmentacao = (s: string | null) =>
  s ? ((SEGMENTACOES_PRODUTO as Record<string, string>)[s] ?? s) : '';
const abrangencia = (s: string | null) =>
  s ? ((ABRANGENCIAS_PRODUTO as Record<string, string>)[s] ?? s) : '';
const acomodacao = (a: number | null) =>
  a ? ((ACOMODACOES_PLANO_OPERADORA as Record<number, string>)[a] ?? '') : '';
</script>

<template>
  <section class="bloco" aria-labelledby="ope-eleg-titulo" data-testid="operadora-elegibilidade">
    <h2 id="ope-eleg-titulo">{{ t('operadora.f1.elegibilidade.titulo') }}</h2>
    <p class="secundario">{{ t('operadora.f1.elegibilidade.texto') }}</p>
    <form class="campos" @submit.prevent="consultar">
      <SanteCampoTexto
        v-model="carteirinha"
        :rotulo="t('operadora.f1.elegibilidade.carteirinha')"
        :max-bytes="30"
        obrigatorio
      />
      <SanteData v-model="data" :rotulo="t('operadora.f1.elegibilidade.data')" editavel />
      <div class="acoes">
        <SanteBotao
          :rotulo="t('operadora.f1.elegibilidade.consultar')"
          variante="primario"
          tipo="submit"
          :desabilitado="ocupado"
          data-testid="elegibilidade-consultar"
        />
      </div>
    </form>
    <ErroOperadora v-if="erro" :erro="erro" />
    <div v-if="r" class="bloco" data-testid="elegibilidade-resultado" :data-elegivel="r.elegivel">
      <SanteAlerta
        :texto="
          r.elegivel ? t('operadora.f1.elegibilidade.elegivel') : t('operadora.f1.elegibilidade.inelegivel')
        "
        :variante="r.elegivel ? 'info' : 'aviso'"
        anunciar
      />
      <ul v-if="r.motivos.length" data-testid="elegibilidade-motivos">
        <li v-for="m in r.motivos" :key="m">{{ t(`operadora.f1.motivos.${m}`) }}</li>
      </ul>
      <p v-if="r.beneficiario">{{ r.beneficiario.nome }}</p>
      <p v-if="r.plano">
        {{ r.plano.nome }}<template v-if="r.plano.registroAns"> · {{ r.plano.registroAns }}</template>
        <template v-if="r.plano.segmentacao"> · {{ segmentacao(r.plano.segmentacao) }}</template>
        <template v-if="r.plano.abrangencia"> · {{ abrangencia(r.plano.abrangencia) }}</template>
        <template v-if="r.plano.acomodacao"> · {{ acomodacao(r.plano.acomodacao) }}</template>
      </p>
      <ul v-if="r.carencias.length" data-testid="elegibilidade-carencias">
        <li v-for="c in r.carencias" :key="c.tipo" :data-cumprida="c.cumprida">
          {{ t(`operadora.f1.carencias.${c.tipo}`) }}:
          {{
            c.cumprida
              ? t('operadora.f1.elegibilidade.cumprida', { data: dataBr(c.cumpridaEm) })
              : t('operadora.f1.elegibilidade.emCurso', { data: dataBr(c.cumpridaEm) })
          }}
        </li>
      </ul>
      <p v-else-if="r.plano">{{ t('operadora.f1.elegibilidade.semCarencia') }}</p>
    </div>
  </section>
</template>

<style scoped src="../../estilo-operadora.css"></style>
