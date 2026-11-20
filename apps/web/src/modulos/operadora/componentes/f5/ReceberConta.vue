<script setup lang="ts">
// Recebimento do lote de contas médicas em XML TISS (M56, etapa 6, F5; `operadora.conta.receber`): o arquivo vai em
// base64 com os bytes exatos (o XML é ISO-8859-1 e o hash do epílogo depende deles); o servidor confere o XSD, o hash, a
// versão, a operadora de destino, o prestador e o lote repetido e devolve o protocolo, ou a recusa com o que o XSD
// apontou.
import type { ResultadoConta } from '@sgh/contratos';
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../../casca/erros/problem-details.js';
import { arquivoEmBase64, receberConta } from '../../api-contas.js';

const props = defineProps<{ maximoKilobytes: number }>();
const emit = defineEmits<{ gravado: [r: ResultadoConta]; cancelar: [] }>();
const { t } = useI18n();

const arquivo = ref<File | null>(null);
const recusa = ref<string | null>(null);
const errosXsd = ref<string[]>([]);
const erro = ref<unknown>(null);
const enviando = ref(false);
const kb = (n: number) => Math.ceil(n / 1000);
const grande = computed(() => (arquivo.value ? arquivo.value.size > props.maximoKilobytes * 1000 : false));

function escolher(ev: Event): void {
  recusa.value = null;
  errosXsd.value = [];
  arquivo.value = (ev.target as HTMLInputElement).files?.[0] ?? null;
}

async function receber(): Promise<void> {
  const f = arquivo.value;
  if (!f || grande.value) return;
  recusa.value = null;
  errosXsd.value = [];
  erro.value = null;
  enviando.value = true;
  try {
    emit('gravado', await receberConta({ arquivo: await arquivoEmBase64(f), nome: f.name.slice(0, 120) }));
  } catch (e) {
    if (e instanceof ErroApi && e.problema?.detail && [400, 403, 404, 409].includes(e.status)) {
      recusa.value = e.problema.detail;
      const avisos = (e.problema as { avisos?: unknown }).avisos;
      errosXsd.value = Array.isArray(avisos) ? avisos.map(String) : [];
    } else erro.value = e;
  } finally {
    enviando.value = false;
  }
}
</script>

<template>
  <div class="formulario" data-testid="form-receber-conta">
    <p class="secundario">{{ t('operadoraContas.receber.texto', { kb: maximoKilobytes }) }}</p>
    <span class="campo">
      <label for="conta-arquivo">{{ t('operadoraContas.receber.arquivo') }}</label>
      <input
        id="conta-arquivo"
        type="file"
        accept=".xml,text/xml,application/xml"
        data-testid="conta-arquivo"
        @change="escolher"
      />
    </span>
    <p v-if="arquivo" class="secundario" data-testid="conta-arquivo-escolhido">
      {{ t('operadoraContas.receber.escolhido', { nome: arquivo.name, kb: kb(arquivo.size) }) }}
    </p>
    <SanteAlerta
      v-if="grande"
      :texto="t('operadoraContas.receber.grande', { kb: maximoKilobytes })"
      variante="alerta"
    />
    <div v-if="recusa" data-testid="conta-receber-recusa">
      <SanteAlerta :texto="recusa" variante="alerta" />
      <template v-if="errosXsd.length">
        <p class="secundario">{{ t('operadoraContas.receber.errosXsd') }}</p>
        <ul class="secundario" data-testid="conta-erros-xsd">
          <li v-for="(x, i) in errosXsd" :key="i">{{ x }}</li>
        </ul>
      </template>
    </div>
    <MensagemErro v-if="erro" :erro="erro" />
    <div class="acoes">
      <SanteBotao
        variante="secundario"
        :rotulo="t('operadoraContas.acoes.voltar')"
        @acionar="emit('cancelar')"
      />
      <SanteBotao
        :rotulo="t('operadoraContas.receber.confirmar')"
        :desabilitado="!arquivo || grande || enviando"
        data-testid="conta-receber-confirmar"
        @acionar="receber"
      />
    </div>
  </div>
</template>

<style scoped src="../../estilo-operadora.css"></style>
<style scoped>
.formulario {
  display: grid;
  gap: 0.75rem;
}
.campo {
  display: grid;
  gap: 0.25rem;
}
.campo input {
  min-height: 24px;
}
</style>
