<script setup lang="ts">
// W0-10: a resposta do prestador pelo portal, com texto e arquivos (o complemento pedido pelo auditor, até 5 arquivos, e
// a interação da operadora no protocolo, 1 arquivo). Nada é enviado antes do painel de confirmação; o arquivo vai em
// base64 com os bytes exatos e o servidor confere o tipo pelos primeiros bytes (PDF, PNG ou JPEG) e o teto de 2 MB. A
// recusa do servidor aparece com o texto dele. Cada resposta é registro novo: a anterior continua visível na ficha.
import { ANEXO_PORTAL_MAX_BYTES } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto } from '@sgh/ui';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import { arquivoEmBase64 } from '../../operadora/api-contas.js';
import type { AnexoEnviado } from '../api-portal-prestador.js';

const props = defineProps<{
  /** Prefixo dos ids e data-testid (dois formulários na mesma tela não colidem). */
  prefixo: string;
  maxArquivos: number;
  enviar: (texto: string, anexos: AnexoEnviado[]) => Promise<{ mensagem: string }>;
}>();
const emit = defineEmits<{ enviado: [mensagem: string]; cancelar: [] }>();
const { t } = useI18n();

const texto = ref('');
const arquivos = ref<File[]>([]);
const confirmando = ref(false);
const ocupado = ref(false);
const recusa = ref<string | null>(null);
const erro = ref<unknown>(null);
const entrada = ref<HTMLInputElement | null>(null);

const grandes = computed(() => arquivos.value.filter((f) => f.size > ANEXO_PORTAL_MAX_BYTES));
const demais = computed(() => arquivos.value.length > props.maxArquivos);
const valido = computed(
  () => texto.value.trim().length >= 3 && !grandes.value.length && !demais.value && !ocupado.value,
);
const tamanho = (n: number) =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

function escolher(ev: Event): void {
  const novos = Array.from((ev.target as HTMLInputElement).files ?? []);
  arquivos.value = props.maxArquivos === 1 ? novos.slice(0, 1) : [...arquivos.value, ...novos];
  if (entrada.value) entrada.value.value = '';
}
function tirar(i: number): void {
  arquivos.value = arquivos.value.filter((_, n) => n !== i);
}
function preparar(): void {
  recusa.value = null;
  erro.value = null;
  if (valido.value) confirmando.value = true;
}
async function confirmar(): Promise<void> {
  ocupado.value = true;
  recusa.value = null;
  erro.value = null;
  try {
    const anexos: AnexoEnviado[] = [];
    for (const f of arquivos.value) anexos.push({ nome: f.name, conteudo: await arquivoEmBase64(f) });
    const r = await props.enviar(texto.value.trim(), anexos);
    texto.value = '';
    arquivos.value = [];
    confirmando.value = false;
    emit('enviado', r.mensagem);
  } catch (e) {
    confirmando.value = false;
    if (e instanceof ErroApi && e.problema?.detail && [400, 403, 404, 409, 413, 422].includes(e.status))
      recusa.value = e.problema.detail;
    else erro.value = e;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <form class="resposta" :data-testid="`${prefixo}-form`" @submit.prevent>
    <SanteCampoTexto
      :id="`${prefixo}-texto`"
      v-model="texto"
      :rotulo="t('portalPrestador.resposta.texto')"
      :max-bytes="1000"
      multilinha
      obrigatorio
      :data-testid="`${prefixo}-texto`"
    />
    <label class="campo">
      <span>{{
        maxArquivos === 1
          ? t('portalPrestador.resposta.arquivo')
          : t('portalPrestador.resposta.arquivos', { max: maxArquivos })
      }}</span>
      <input
        ref="entrada"
        type="file"
        accept="application/pdf,image/png,image/jpeg"
        :multiple="maxArquivos > 1"
        :data-testid="`${prefixo}-arquivo`"
        @change="escolher"
      />
    </label>
    <ul v-if="arquivos.length" class="arquivos" :data-testid="`${prefixo}-arquivos`">
      <li v-for="(f, i) in arquivos" :key="`${f.name}-${i}`">
        {{ f.name }} · {{ tamanho(f.size) }}
        <SanteBotao
          variante="texto"
          :rotulo="t('portalPrestador.resposta.tirar')"
          :data-testid="`${prefixo}-tirar-${i}`"
          @acionar="tirar(i)"
        />
      </li>
    </ul>
    <p v-if="grandes.length" role="alert" class="aviso" :data-testid="`${prefixo}-grande`">
      {{ t('portalPrestador.resposta.grande', { nome: grandes[0]?.name ?? '' }) }}
    </p>
    <p v-if="demais" role="alert" class="aviso" :data-testid="`${prefixo}-demais`">
      {{ t('portalPrestador.resposta.demais', { max: maxArquivos }) }}
    </p>
    <div v-if="recusa" role="alert" :data-testid="`${prefixo}-recusa`">
      <SanteAlerta :texto="recusa" variante="alerta" />
    </div>
    <MensagemErro v-if="erro" :erro="erro" />
    <section
      v-if="confirmando"
      class="painel"
      role="dialog"
      aria-modal="false"
      :data-testid="`${prefixo}-confirmacao`"
    >
      <p>{{ t('portalPrestador.resposta.confirma', { n: arquivos.length }) }}</p>
      <div class="acoes">
        <SanteBotao
          :rotulo="t('portalPrestador.resposta.confirmar')"
          :desabilitado="ocupado"
          :data-testid="`${prefixo}-confirmar`"
          @acionar="confirmar"
        />
        <SanteBotao
          variante="texto"
          :rotulo="t('portalPrestador.resposta.voltar')"
          :data-testid="`${prefixo}-voltar`"
          @acionar="confirmando = false"
        />
      </div>
    </section>
    <div v-else class="acoes">
      <SanteBotao
        :rotulo="t('portalPrestador.resposta.enviar')"
        :desabilitado="!valido"
        :data-testid="`${prefixo}-enviar`"
        @acionar="preparar"
      />
      <SanteBotao
        variante="secundario"
        :rotulo="t('portalPrestador.resposta.voltar')"
        @acionar="emit('cancelar')"
      />
    </div>
  </form>
</template>

<style scoped>
.resposta {
  display: grid;
  gap: var(--sgh-espaco-2);
}
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
}
.arquivos {
  margin: 0;
  padding-left: 1.25rem;
}
.aviso {
  color: var(--sgh-alerta);
  margin: 0;
}
.painel {
  display: grid;
  gap: var(--sgh-espaco-2);
  padding: var(--sgh-espaco-3);
  border: 1px solid var(--sgh-borda);
  border-radius: var(--sgh-raio, 6px);
}
.acoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
}
</style>
