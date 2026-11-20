<script setup lang="ts">
// Documentos do processo de compra em PDF/A (M55, etapa 4, regra 10): o termo de referência, o registro da etapa e a
// ata do julgamento, emitidos pelo serviço de documentos (guardados imutáveis, com código de validação). Cada clique
// gera um documento novo; o link abre o PDF recebido. Quem lê o processo pode emitir (consulta com a chave desligada).
// Com a chave ligada, cada emissão fica ligada ao processo (o evento `documento`): a lista dos emitidos, com o número
// da emissão, o SHA-256 e o código de validação, sai do detalhe e continua aí depois de recarregar a tela.
import type { EventoLicitacao } from '@sgh/contratos';
import { SanteBotao } from '@sgh/ui';
import { computed, onBeforeUnmount, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { type DocumentoLicitacaoTela, emitirDocumentoLicitacaoTela } from '../api-licitacao.js';
import ErroSuprimentos from './ErroSuprimentos.vue';

type Tipo = DocumentoLicitacaoTela['tipo'];
const props = defineProps<{ id: number; etapa: string; eventos?: readonly EventoLicitacao[] }>();
const emit = defineEmits<{ emitido: [] }>();
const emitidos = computed(() =>
  (props.eventos ?? []).filter((e) => e.tipo === 'documento').sort((a, b) => b.id - a.id),
);
const quando = (x: string) => `${x.slice(0, 10).split('-').reverse().join('/')} ${x.slice(11, 16)}`;
const { t } = useI18n();
const k = (s: string, p?: Record<string, unknown>) => t(`licitacao.documentos.${s}`, p ?? {});
const COM_ATA = ['julgado', 'recurso', 'homologado', 'fracassado', 'deserto'];
const temAta = computed(() => COM_ATA.includes(props.etapa));
const tipos: readonly Tipo[] = ['termo', 'etapa', 'ata'];
const enviando = ref<Tipo | null>(null);
const erro = ref<unknown>(null);
const feito = ref<{
  tipo: Tipo;
  nome: string;
  arquivo: string;
  url: string;
  codigo: string;
  ligado: boolean;
} | null>(null);

function liberar(): void {
  if (feito.value) URL.revokeObjectURL(feito.value.url);
}
onBeforeUnmount(liberar);

async function emitir(tipo: Tipo): Promise<void> {
  erro.value = null;
  enviando.value = tipo;
  try {
    const r = await emitirDocumentoLicitacaoTela(props.id, tipo);
    const bytes = Uint8Array.from(atob(r.conteudo), (c) => c.charCodeAt(0));
    liberar();
    feito.value = {
      tipo,
      nome: k(`nomes.${tipo}`),
      arquivo: r.nomeArquivo,
      url: URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })),
      codigo: r.identificadorQr,
      ligado: r.ligadoAoProcesso,
    };
    if (r.ligadoAoProcesso) emit('emitido');
  } catch (x) {
    erro.value = x;
  } finally {
    enviando.value = null;
  }
}
</script>

<template>
  <section class="documentos-licitacao" aria-labelledby="lic-doc-titulo" data-testid="lic-doc-painel">
    <h3 id="lic-doc-titulo">{{ k('titulo') }}</h3>
    <p class="secundario">{{ k('explicacao') }}</p>
    <ErroSuprimentos v-if="erro" :erro="erro" />
    <div class="acoes">
      <SanteBotao
        v-for="tp in tipos"
        :key="tp"
        variante="secundario"
        :rotulo="k(tp)"
        :desabilitado="enviando !== null || (tp === 'ata' && !temAta)"
        :data-testid="`lic-doc-${tp}`"
        @acionar="emitir(tp)"
      />
    </div>
    <p v-if="!temAta" class="secundario" data-testid="lic-doc-ata-motivo">{{ k('ataSoDepois') }}</p>
    <p v-if="feito" role="status" data-testid="lic-doc-emitido">
      {{ k('emitido', { nome: feito.nome, codigo: feito.codigo }) }}
      <a
        :href="feito.url"
        :download="feito.arquivo"
        target="_blank"
        rel="noopener"
        data-testid="lic-doc-abrir"
        >{{ k('abrir', { nome: feito.nome }) }}</a
      >
      <span v-if="!feito.ligado" class="secundario" data-testid="lic-doc-nao-ligado">
        {{ k('naoLigado') }}</span
      >
    </p>
    <h4>{{ k('emitidos') }}</h4>
    <p v-if="emitidos.length === 0" class="secundario" data-testid="lic-doc-nenhum">
      {{ k('nenhumEmitido') }}
    </p>
    <div v-else class="rolagem">
      <table class="grade" data-testid="lic-doc-emitidos">
        <thead>
          <tr>
            <th scope="col">{{ k('colQuando') }}</th>
            <th scope="col">{{ k('colQuem') }}</th>
            <th scope="col">{{ k('colDocumento') }}</th>
            <th scope="col">{{ k('colEmissao') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in emitidos" :key="e.id" :data-testid="`lic-doc-emitido-${e.id}`">
            <td>{{ quando(e.criadoEm) }}</td>
            <td>{{ e.usuario }}</td>
            <td>{{ e.descricao }}</td>
            <td>{{ e.referencia ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
