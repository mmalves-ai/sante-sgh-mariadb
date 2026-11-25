<script setup lang="ts">
// Registrar o aviso de ressarcimento ao SUS (M56, etapa 7, F6; `operadora.ans.gerar`): a operadora, o número do aviso, a
// data do recebimento e os atendimentos colados da notificação da ANS (um por linha). A tela lê as linhas e mostra o que
// não tem os 7 campos; o servidor confere cada campo, analisa cada atendimento (a sugestão de impugnação) e conta o prazo.
import { type ApoioAns, PARAMETROS_ANS } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../../casca/erros/problem-details.js';
import { registrarAvisoRessarcimento, type ResultadoAns } from '../../api-ans.js';
import { hoje } from '../f1/comum.js';
import { lerAtendimentos } from './comum.js';

const props = defineProps<{ apoio: ApoioAns; operadora: number | null }>();
const emit = defineEmits<{ gravado: [r: ResultadoAns]; cancelar: [] }>();
const { t } = useI18n();

const operadora = ref<number | null>(props.operadora ?? props.apoio.operadoras[0]?.id ?? null);
const aviso = ref('');
const recebidoEm = ref<string | null>(hoje());
const texto = ref('');
const lidos = computed(() => lerAtendimentos(texto.value));
const completo = computed(
  () =>
    operadora.value !== null &&
    /^\d{1,20}$/.test(aviso.value.trim()) &&
    !!recebidoEm.value &&
    lidos.value.itens.length > 0 &&
    lidos.value.invalidas.length === 0,
);
const recusa = ref<string | null>(null);
const erro = ref<unknown>(null);
const enviando = ref(false);

async function registrar(): Promise<void> {
  if (!completo.value) return;
  recusa.value = null;
  erro.value = null;
  enviando.value = true;
  try {
    emit(
      'gravado',
      await registrarAvisoRessarcimento({
        operadora: operadora.value,
        aviso: aviso.value.trim(),
        recebidoEm: recebidoEm.value,
        atendimentos: lidos.value.itens,
      }),
    );
  } catch (x) {
    if (x instanceof ErroApi && x.problema?.detail && [400, 403, 404, 409, 422].includes(x.status))
      recusa.value = x.problema.detail;
    else erro.value = x;
  } finally {
    enviando.value = false;
  }
}
const opcoesOperadora = computed(() =>
  props.apoio.operadoras.map((o) => ({
    valor: o.id as number | null,
    rotulo: `${o.nome} · ${o.registroAns}`,
  })),
);
</script>

<template>
  <section class="bloco" aria-labelledby="ans-aviso-titulo" data-testid="ans-aviso">
    <div class="acoes cabeca">
      <h2 id="ans-aviso-titulo">{{ t('operadoraAns.aviso.titulo') }}</h2>
      <SanteBotao variante="texto" :rotulo="t('operadoraAns.acoes.fechar')" @acionar="emit('cancelar')" />
    </div>
    <p class="secundario">{{ t('operadoraAns.aviso.texto') }}</p>
    <form class="dialogo" @submit.prevent="registrar">
      <div class="campos">
        <SanteSelecao
          v-model="operadora"
          :rotulo="t('operadoraAns.aviso.operadora')"
          :opcoes="opcoesOperadora"
          :busca="true"
          obrigatorio
          data-testid="ans-aviso-operadora"
        />
        <SanteCampoTexto
          id="ans-aviso-numero"
          v-model="aviso"
          :rotulo="t('operadoraAns.aviso.numero')"
          :max-bytes="20"
          obrigatorio
        />
        <SanteData v-model="recebidoEm" :rotulo="t('operadoraAns.aviso.recebidoEm')" editavel />
      </div>
      <p class="secundario">
        {{ t('operadoraAns.aviso.prazo', { dias: PARAMETROS_ANS.diasImpugnacaoRessarcimento }) }}
      </p>
      <SanteCampoTexto
        id="ans-aviso-atendimentos"
        v-model="texto"
        :rotulo="t('operadoraAns.aviso.atendimentos')"
        :max-bytes="60000"
        multilinha
        obrigatorio
      />
      <p v-if="lidos.itens.length" class="secundario" data-testid="ans-aviso-lidos">
        {{ t('operadoraAns.aviso.lidos', { n: lidos.itens.length }) }}
      </p>
      <p v-if="lidos.invalidas.length" class="erro" role="alert" data-testid="ans-aviso-invalidas">
        {{ t('operadoraAns.aviso.invalidas', { linhas: lidos.invalidas.join(', ') }) }}
      </p>
      <SanteAlerta v-if="recusa" :texto="recusa" variante="alerta" data-testid="ans-aviso-recusa" />
      <MensagemErro v-if="erro" :erro="erro" />
      <div class="acoes">
        <SanteBotao
          tipo="submit"
          :rotulo="t('operadoraAns.aviso.registrar')"
          :desabilitado="!completo || enviando"
          data-testid="ans-aviso-registrar"
        />
        <SanteBotao variante="texto" :rotulo="t('operadoraAns.acoes.cancelar')" @acionar="emit('cancelar')" />
      </div>
    </form>
  </section>
</template>

<style scoped src="../../estilo-operadora.css"></style>
<style scoped>
.cabeca {
  justify-content: space-between;
}
.dialogo {
  display: grid;
  gap: 0.75rem;
}
.erro {
  color: var(--sgh-alerta);
}
</style>
