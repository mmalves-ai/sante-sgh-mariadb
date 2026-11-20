<script setup lang="ts">
// Acompanhamento do notificador (M48, etapa 1; regra 1): pelo número e o código, mesmo anônimo, a situação e o retorno
// do NSP. Consultar não liga quem consulta à notificação (o servidor não grava trilha); o número ou o código errados
// têm a mesma resposta, e há limite de tentativas por minuto.
import { type AcompanhamentoNotificacao, SITUACOES_NOTIFICACAO } from '@sgh/contratos';
import { SanteBotao, SanteCampoTexto } from '@sgh/ui';
import { reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { acompanharNotificacao } from '../api.js';
import { dataHora } from '../regras-qualidade.js';
import ErroQualidade from './ErroQualidade.vue';

const { t } = useI18n();
const form = reactive({ protocolo: '', codigo: '' });
const erro = ref<unknown>(null);
const resultado = ref<AcompanhamentoNotificacao | null>(null);
const rotuloSituacao = (s: string) => SITUACOES_NOTIFICACAO.find((x) => x.codigo === s)?.rotulo ?? s;

async function consultar(): Promise<void> {
  erro.value = null;
  resultado.value = null;
  try {
    resultado.value = await acompanharNotificacao(form.protocolo.trim(), form.codigo.trim());
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <form class="acompanhar" data-testid="form-acompanhar" @submit.prevent="consultar">
    <SanteCampoTexto
      v-model="form.protocolo"
      :rotulo="t('qualidade.acompanhar.protocolo')"
      :max-bytes="20"
      obrigatorio
      data-testid="acompanhar-protocolo"
    />
    <SanteCampoTexto
      v-model="form.codigo"
      :rotulo="t('qualidade.acompanhar.codigo')"
      :max-bytes="20"
      obrigatorio
      data-testid="acompanhar-codigo"
    />
    <SanteBotao
      :rotulo="t('qualidade.acompanhar.consultar')"
      variante="primario"
      tipo="submit"
      data-testid="acompanhar-consultar"
    />
    <ErroQualidade v-if="erro" :erro="erro" />
    <div v-if="resultado" class="acompanhar__resultado" data-testid="acompanhamento" aria-live="polite">
      <p>
        <strong>{{ resultado.protocolo }}</strong> · {{ dataHora(resultado.notificadaEm) }} ·
        {{ t('qualidade.acompanhar.situacao') }}: {{ rotuloSituacao(resultado.situacao) }}
      </p>
      <h2>{{ t('qualidade.acompanhar.devolutivas') }}</h2>
      <p v-if="resultado.devolutivas.length === 0">{{ t('qualidade.acompanhar.semDevolutiva') }}</p>
      <ul v-else>
        <li v-for="(d, i) in resultado.devolutivas" :key="i" data-testid="acompanhar-devolutiva">
          <span class="acompanhar__quando">{{ dataHora(d.em) }}</span>
          <span class="acompanhar__texto">{{ d.texto }}</span>
        </li>
      </ul>
    </div>
  </form>
</template>

<style scoped>
.acompanhar {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-3);
  max-width: 32rem;
}
.acompanhar__resultado h2 {
  font-size: 1rem;
}
.acompanhar__quando {
  display: block;
  color: var(--sgh-texto-secundario);
  font-size: var(--sgh-fonte-pequena);
}
.acompanhar__texto {
  white-space: pre-wrap;
}
</style>
