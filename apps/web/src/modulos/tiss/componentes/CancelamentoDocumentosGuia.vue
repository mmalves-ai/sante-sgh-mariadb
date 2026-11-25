<script setup lang="ts">
// Cancelamento de guia enviada e envio de documentos anexos pelo TISS 04.03.00 (06-FAT linha 28), aberto pela ação da
// linha na lista de guias. Visão pela conta: cada guia com o pedido de cancelamento (motivo validado na hora, envio com
// o XML baixado, descarte do rascunho, recibo com o status do padrão) e os documentos anexos (arquivo e tipo no padrão,
// envio, cancelamento do rascunho, recibo com protocolo ou recusa por documento). Nada é apagado: descartado e
// cancelado ficam no histórico.
import {
  FORMATO_DOCUMENTO_POR_MIME,
  DESCRICAO_STATUS_CANCELAMENTO,
  MINIMO_MOTIVO_CANCELAMENTO,
  SITUACOES_GUIA_CANCELAVEIS,
  TAMANHO_MAXIMO_DOCUMENTO,
  TIPOS_DOCUMENTO_TISS,
} from '@sgh/dominio-faturamento';
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../../faturamento/componentes/MensagemFaturamento.vue';
import {
  arquivoEmBase64,
  baixarXml,
  cancelarEnvioDocumentos,
  type CancelamentoGuiaLido,
  descartarCancelamento,
  type DocumentoParaEnviar,
  enviarCancelamento,
  enviarDocumentos,
  type EnvioDocumentosLido,
  lerCancelamentoDaConta,
  pedirCancelamento,
  registrarDocumentos,
  registrarReciboCancelamento,
  registrarReciboDocumentos,
} from '../api-cancelamento-documentos.js';

const props = defineProps<{ conta: number }>();
const emit = defineEmits<{ fechar: [] }>();
const { t } = useI18n();
const cliente = useQueryClient();
const chave = computed(() => ['tiss', 'cancelamento-documentos', props.conta]);
const visao = useQuery({ queryKey: chave, queryFn: () => lerCancelamentoDaConta(props.conta) });

const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);
async function agir(fn: () => Promise<string>): Promise<void> {
  if (ocupado.value) return;
  ocupado.value = true;
  erro.value = null;
  mensagem.value = null;
  try {
    mensagem.value = await fn();
    await cliente.invalidateQueries({ queryKey: chave.value });
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}
const situacao = (s: string) => t(`cancelamentoDocumentos.situacoes.${s}`, s);
const cancelavel = (s: string) => (SITUACOES_GUIA_CANCELAVEIS as readonly string[]).includes(s);

// ------------------------------------------------------------------ cancelamento
const motivos = reactive<Record<number, string>>({});
const motivoValido = (guia: number) => (motivos[guia] ?? '').trim().length >= MINIMO_MOTIVO_CANCELAMENTO;
const pedir = (guia: number) =>
  agir(async () => {
    await pedirCancelamento({ guias: [guia], motivo: (motivos[guia] ?? '').trim() });
    motivos[guia] = '';
    return t('cancelamentoDocumentos.cancelamento.pedido');
  });
const enviarPedido = (p: CancelamentoGuiaLido) =>
  agir(async () => {
    const r = await enviarCancelamento(p.id, p.versao);
    baixarXml(`cancelamento-guia-${p.id}.xml`, r.xml);
    return t('cancelamentoDocumentos.cancelamento.enviado');
  });
const descartar = (p: CancelamentoGuiaLido) =>
  agir(async () => {
    await descartarCancelamento(p.id, p.versao);
    return t('cancelamentoDocumentos.cancelamento.descartado');
  });
const statusOpcoes = computed(() => [
  { valor: '', rotulo: t('cancelamentoDocumentos.cancelamento.status') },
  ...Object.entries(DESCRICAO_STATUS_CANCELAMENTO).map(([valor, rotulo]) => ({
    valor,
    rotulo: `${valor} · ${rotulo}`,
  })),
]);
const recibos = reactive<Record<number, { protocolo: string; status: string }>>({});
const recibo = (id: number) => (recibos[id] ??= { protocolo: '', status: '' });
const registrarRecibo = (p: CancelamentoGuiaLido) =>
  agir(async () => {
    const r = recibo(p.id);
    const feito = await registrarReciboCancelamento(p.id, {
      versao: p.versao,
      protocolo: r.protocolo.trim() || null,
      observacao: null,
      erro: null,
      guias: [{ item: p.item, status: r.status }],
    });
    return t('cancelamentoDocumentos.cancelamento.reciboRegistrado', { canceladas: feito.canceladas });
  });

// ------------------------------------------------------------------ documentos
const tipoOpcoes = computed(() => [
  { valor: '', rotulo: t('cancelamentoDocumentos.documentos.escolhaTipo') },
  ...Object.entries(TIPOS_DOCUMENTO_TISS).map(([valor, rotulo]) => ({
    valor,
    rotulo: `${valor} · ${rotulo}`,
  })),
]);
interface Rascunho {
  tipo: string;
  arquivo: File | null;
  problema: string | null;
  lista: { arquivo: File; tipo: string }[];
}
const rascunhos = reactive<Record<number, Rascunho>>({});
const rascunho = (guia: number): Rascunho =>
  (rascunhos[guia] ??= { tipo: '', arquivo: null, problema: null, lista: [] });
function escolherArquivo(guia: number, ev: Event): void {
  const r = rascunho(guia);
  const arquivo = (ev.target as HTMLInputElement).files?.[0] ?? null;
  r.arquivo = arquivo;
  r.problema = !arquivo
    ? null
    : !FORMATO_DOCUMENTO_POR_MIME[arquivo.type]
      ? t('cancelamentoDocumentos.documentos.formatoInvalido')
      : arquivo.size > TAMANHO_MAXIMO_DOCUMENTO
        ? t('cancelamentoDocumentos.documentos.grande')
        : null;
}
function acrescentar(guia: number): void {
  const r = rascunho(guia);
  if (!r.arquivo || r.problema || !r.tipo) return;
  r.lista.push({ arquivo: r.arquivo, tipo: r.tipo });
  r.arquivo = null;
  r.tipo = '';
}
const registrar = (guia: number) =>
  agir(async () => {
    const r = rascunho(guia);
    const documentos: DocumentoParaEnviar[] = [];
    for (const d of r.lista)
      documentos.push({
        nome: d.arquivo.name,
        tipoMime: d.arquivo.type,
        conteudoBase64: await arquivoEmBase64(d.arquivo),
        tipoDocumento: d.tipo,
        observacao: null,
      });
    const feito = await registrarDocumentos({ guia, observacao: null, documentos });
    r.lista = [];
    return t('cancelamentoDocumentos.documentos.registrado', {
      numero: feito.numero,
      documentos: feito.documentos,
    });
  });
const enviarEnvio = (e: EnvioDocumentosLido) =>
  agir(async () => {
    const r = await enviarDocumentos(e.id, e.versao);
    for (const m of r.mensagens) baixarXml(`documento-${e.numero}-${m.item}.xml`, m.xml);
    return t('cancelamentoDocumentos.documentos.enviado');
  });
const cancelarEnvio = (e: EnvioDocumentosLido) =>
  agir(async () => {
    await cancelarEnvioDocumentos(e.id, e.versao);
    return t('cancelamentoDocumentos.documentos.cancelado');
  });
const respostas = reactive<Record<number, { protocolo: string; erro: string }>>({});
const resposta = (item: number) => (respostas[item] ??= { protocolo: '', erro: '' });
const registrarReciboEnvio = (e: EnvioDocumentosLido) =>
  agir(async () => {
    const r = await registrarReciboDocumentos(e.id, {
      versao: e.versao,
      protocolo: null,
      documentos: e.documentos
        .map((d) => ({ item: d.item, ...resposta(d.item) }))
        .filter((d) => d.protocolo.trim() || d.erro.trim())
        .map((d) => ({ item: d.item, protocolo: d.protocolo.trim() || null, erro: d.erro.trim() || null })),
    });
    return t('cancelamentoDocumentos.documentos.reciboRegistrado', { situacao: situacao(r.situacao) });
  });
const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR') : '—');
</script>

<template>
  <section class="painel" :aria-label="t('cancelamentoDocumentos.titulo', { conta })" data-testid="cd-painel">
    <header class="filtros">
      <h2>{{ t('cancelamentoDocumentos.titulo', { conta }) }}</h2>
      <button type="button" data-testid="cd-fechar" @click="emit('fechar')">
        {{ t('cancelamentoDocumentos.fechar') }}
      </button>
    </header>
    <MensagemFaturamento :texto="mensagem" testid="cd-mensagem" />
    <ErroFaturamento v-if="erro" :erro="erro" />
    <ErroFaturamento v-if="visao.error.value" :erro="visao.error.value" />
    <p v-else-if="!visao.data.value" role="status">{{ t('cancelamentoDocumentos.carregando') }}</p>
    <article
      v-for="v in visao.data.value?.guias ?? []"
      :key="v.guia.id"
      :data-testid="`cd-guia-${v.guia.id}`"
    >
      <h3>
        {{
          t('cancelamentoDocumentos.guia', { numero: v.guia.numeroGuiaPrestador, situacao: v.guia.situacao })
        }}
      </h3>

      <h4>{{ t('cancelamentoDocumentos.cancelamento.titulo') }}</h4>
      <form v-if="cancelavel(v.guia.situacao)" class="filtros" @submit.prevent="pedir(v.guia.id)">
        <span class="campo">
          <label :for="`cd-motivo-${v.guia.id}`">{{ t('cancelamentoDocumentos.cancelamento.motivo') }}</label>
          <textarea
            :id="`cd-motivo-${v.guia.id}`"
            v-model="motivos[v.guia.id]"
            rows="2"
            maxlength="1000"
            :aria-invalid="!!motivos[v.guia.id] && !motivoValido(v.guia.id)"
            :data-testid="`cd-motivo-${v.guia.id}`"
          />
          <small
            v-if="!!motivos[v.guia.id] && !motivoValido(v.guia.id)"
            :data-testid="`cd-motivo-aviso-${v.guia.id}`"
          >
            {{ t('cancelamentoDocumentos.cancelamento.motivoCurto', { minimo: MINIMO_MOTIVO_CANCELAMENTO }) }}
          </small>
        </span>
        <button
          type="submit"
          :disabled="ocupado || !motivoValido(v.guia.id)"
          :data-testid="`cd-pedir-${v.guia.id}`"
        >
          {{ t('cancelamentoDocumentos.cancelamento.pedir') }}
        </button>
      </form>
      <p v-else class="secundario">{{ t('cancelamentoDocumentos.cancelamento.naoCancelavel') }}</p>
      <p v-if="v.cancelamentos.length === 0" class="secundario">
        {{ t('cancelamentoDocumentos.cancelamento.nenhum') }}
      </p>
      <ul>
        <li v-for="p in v.cancelamentos" :key="p.id" :data-testid="`cd-cancelamento-${p.id}`">
          {{
            t('cancelamentoDocumentos.cancelamento.linha', {
              situacao: situacao(p.situacao),
              quando: quando(p.solicitadoEm),
              motivo: p.motivo,
            })
          }}
          <span v-if="p.status">
            ·
            {{ t('cancelamentoDocumentos.cancelamento.retorno', { status: p.statusDescricao ?? p.status }) }}
          </span>
          <span v-if="p.situacao === 'rascunho'">
            <button
              type="button"
              :disabled="ocupado"
              :data-testid="`cd-enviar-${p.id}`"
              @click="enviarPedido(p)"
            >
              {{ t('cancelamentoDocumentos.cancelamento.enviar') }}
            </button>
            <button
              type="button"
              :disabled="ocupado"
              :data-testid="`cd-descartar-${p.id}`"
              @click="descartar(p)"
            >
              {{ t('cancelamentoDocumentos.cancelamento.descartar') }}
            </button>
          </span>
          <form
            v-if="p.situacao === 'enviado' || p.situacaoGuia === 'em_analise'"
            class="filtros"
            @submit.prevent="registrarRecibo(p)"
          >
            <span class="campo">
              <label :for="`cd-protocolo-${p.id}`">{{
                t('cancelamentoDocumentos.cancelamento.protocolo')
              }}</label>
              <input
                :id="`cd-protocolo-${p.id}`"
                v-model="recibo(p.id).protocolo"
                maxlength="40"
                :data-testid="`cd-protocolo-${p.id}`"
              />
            </span>
            <span class="campo">
              <SanteSelecao
                v-model="recibo(p.id).status"
                :rotulo="t('cancelamentoDocumentos.cancelamento.status')"
                :opcoes="statusOpcoes"
                obrigatorio
                :data-testid="`cd-status-${p.id}`"
              />
            </span>
            <button
              type="submit"
              :disabled="ocupado || !recibo(p.id).status"
              :data-testid="`cd-recibo-${p.id}`"
            >
              {{ t('cancelamentoDocumentos.cancelamento.registrarRecibo') }}
            </button>
          </form>
        </li>
      </ul>

      <h4>{{ t('cancelamentoDocumentos.documentos.titulo') }}</h4>
      <div class="filtros">
        <span class="campo">
          <label :for="`cd-arquivo-${v.guia.id}`">{{ t('cancelamentoDocumentos.documentos.arquivo') }}</label>
          <input
            :id="`cd-arquivo-${v.guia.id}`"
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/tiff"
            :data-testid="`cd-arquivo-${v.guia.id}`"
            @change="escolherArquivo(v.guia.id, $event)"
          />
          <small
            v-if="rascunho(v.guia.id).problema"
            role="alert"
            :data-testid="`cd-arquivo-aviso-${v.guia.id}`"
          >
            {{ rascunho(v.guia.id).problema }}
          </small>
        </span>
        <span class="campo">
          <SanteSelecao
            v-model="rascunho(v.guia.id).tipo"
            :rotulo="t('cancelamentoDocumentos.documentos.tipo')"
            :opcoes="tipoOpcoes"
            obrigatorio
            :data-testid="`cd-tipo-${v.guia.id}`"
          />
        </span>
        <button
          type="button"
          :disabled="
            !rascunho(v.guia.id).arquivo || !!rascunho(v.guia.id).problema || !rascunho(v.guia.id).tipo
          "
          :data-testid="`cd-acrescentar-${v.guia.id}`"
          @click="acrescentar(v.guia.id)"
        >
          {{ t('cancelamentoDocumentos.documentos.acrescentar') }}
        </button>
      </div>
      <ul v-if="rascunho(v.guia.id).lista.length">
        <li v-for="(d, i) in rascunho(v.guia.id).lista" :key="i" :data-testid="`cd-lista-${v.guia.id}-${i}`">
          {{ d.arquivo.name }} · {{ TIPOS_DOCUMENTO_TISS[d.tipo] }}
          <button type="button" @click="rascunho(v.guia.id).lista.splice(i, 1)">
            {{ t('cancelamentoDocumentos.documentos.retirar') }}
          </button>
        </li>
      </ul>
      <button
        v-if="rascunho(v.guia.id).lista.length"
        type="button"
        :disabled="ocupado"
        :data-testid="`cd-registrar-${v.guia.id}`"
        @click="registrar(v.guia.id)"
      >
        {{ t('cancelamentoDocumentos.documentos.registrar') }}
      </button>
      <p v-if="v.envios.length === 0" class="secundario">
        {{ t('cancelamentoDocumentos.documentos.nenhum') }}
      </p>
      <ul>
        <li v-for="e in v.envios" :key="e.id" :data-testid="`cd-envio-${e.id}`">
          {{
            t('cancelamentoDocumentos.documentos.linha', { numero: e.numero, situacao: situacao(e.situacao) })
          }}
          <span v-if="e.situacao === 'rascunho'">
            <button
              type="button"
              :disabled="ocupado"
              :data-testid="`cd-enviar-docs-${e.id}`"
              @click="enviarEnvio(e)"
            >
              {{ t('cancelamentoDocumentos.documentos.enviar') }}
            </button>
            <button
              type="button"
              :disabled="ocupado"
              :data-testid="`cd-cancelar-docs-${e.id}`"
              @click="cancelarEnvio(e)"
            >
              {{ t('cancelamentoDocumentos.documentos.cancelar') }}
            </button>
          </span>
          <ul>
            <li v-for="d in e.documentos" :key="d.item">
              {{ d.nome }} · {{ TIPOS_DOCUMENTO_TISS[d.tipoDocumento ?? ''] ?? d.tipoDocumento }} ·
              {{ situacao(d.situacao) }}<span v-if="d.protocolo"> · {{ d.protocolo }}</span
              ><span v-if="d.observacao"> · {{ d.observacao }}</span>
              <span v-if="e.situacao === 'enviado' && d.situacao === 'enviado'" class="filtros">
                <input
                  v-model="resposta(d.item).protocolo"
                  maxlength="20"
                  :aria-label="t('cancelamentoDocumentos.documentos.protocoloDocumento')"
                  :placeholder="t('cancelamentoDocumentos.documentos.protocoloDocumento')"
                  :data-testid="`cd-doc-protocolo-${d.item}`"
                />
                <input
                  v-model="resposta(d.item).erro"
                  maxlength="500"
                  :aria-label="t('cancelamentoDocumentos.documentos.erroDocumento')"
                  :placeholder="t('cancelamentoDocumentos.documentos.erroDocumento')"
                  :data-testid="`cd-doc-erro-${d.item}`"
                />
              </span>
            </li>
          </ul>
          <button
            v-if="e.situacao === 'enviado'"
            type="button"
            :disabled="ocupado"
            :data-testid="`cd-recibo-docs-${e.id}`"
            @click="registrarReciboEnvio(e)"
          >
            {{ t('cancelamentoDocumentos.documentos.registrarRecibo') }}
          </button>
        </li>
      </ul>
    </article>
  </section>
</template>
