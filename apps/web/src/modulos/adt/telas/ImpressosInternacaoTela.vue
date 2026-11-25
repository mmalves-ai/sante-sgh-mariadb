<script setup lang="ts">
// Fichas e impressos da internação (ficha do M21, seção 7): `/internacao/:reg/impressos`. A ficha de internação em PDF
// (abre por endereço blob:) e a pulseira e a etiqueta do prontuário em ZPL na fila da impressora da estação (o mesmo
// pedido repetido não imprime duas vezes). Os documentos da internação (F3.4, 04-INT linha 69) saem pelo momento
// (admissão, prorrogação, transferência ou alta) conforme as regras de convênio, especialidade e modalidade: os
// marcados e os obrigatórios num só clique, cada um com as cópias da regra; os sob demanda podem ser marcados; o
// obrigatório ainda não emitido fica em aviso. O já emitido vem da trilha da internação (qualquer estação ou sessão),
// com a data da última emissão; a emissão desta tela soma na hora.
import { MOMENTOS_DOCUMENTO_INTERNACAO, obrigatoriosPendentes } from '@sgh/dominio-internacao';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { rotaDoSubitem } from '@sgh/contratos';
import IdentificacaoImpressa, {
  type PedidoIdentificacao,
} from '../../atendimento/componentes/IdentificacaoImpressa.vue';
import { blobDoPdf } from '../../atendimento/regras-tela.js';
import { emitirImpresso, novaChave } from '../api-adt.js';
import { emitirDocumento, lerFichasDoMomento } from '../api-documentos-internacao.js';
import ErroAdt from '../componentes/ErroAdt.vue';
import ResumoInternacao from '../componentes/ResumoInternacao.vue';
import { usarInternacao } from '../usar-internacao.js';

const props = defineProps<{ reg: string }>();
const { t } = useI18n();
const reg = computed(() => Number(props.reg));
const { ficha } = usarInternacao(reg);
const IMPRESSOS = [
  { codigo: 'ficha', formato: 'pdf' },
  { codigo: 'pulseira', formato: 'zpl' },
  { codigo: 'etiqueta', formato: 'zpl' },
] as const;
const copias = ref<Record<string, number>>({ ficha: 1, pulseira: 1, etiqueta: 1 });
// Pulseira e etiqueta (01-ADM L79): já impressa, só sai de novo com o motivo; a situação é relida a cada emissão.
const identificacao = ref<Record<string, PedidoIdentificacao>>({});
const emissoes = ref(0);
const momento = ref<string>('admissao');
const opMomentos = computed(() =>
  MOMENTOS_DOCUMENTO_INTERNACAO.map((m) => ({
    valor: m as string,
    rotulo: t(`adt.documentos.momentos.${m}`),
  })),
);
const fichas = useQuery({
  queryKey: computed(() => ['adt', 'fichas', reg.value, momento.value]),
  queryFn: () => lerFichasDoMomento(reg.value, momento.value),
});
// Marcados: os que a regra traz marcados; o obrigatório não se desmarca.
const marcados = ref<Set<number>>(new Set());
const emitidos = ref<Set<number>>(new Set());
const emitidosAgora = ref<Set<number>>(new Set());
watch(
  () => fichas.data.value,
  (d) => {
    marcados.value = new Set(
      (d?.fichas ?? []).filter((f) => f.selecionado || f.obrigatorio).map((f) => f.modelo),
    );
    emitidos.value = new Set((d?.fichas ?? []).filter((f) => f.emitidoEm).map((f) => f.modelo));
    emitidosAgora.value = new Set();
  },
  { immediate: true },
);
const documentos = computed(() =>
  (fichas.data.value?.fichas ?? []).map((f) => ({
    modelo: f.modelo,
    titulo: f.nome,
    regra: 0,
    copias: f.copias,
    obrigatorio: f.obrigatorio === true,
    selecionado: marcados.value.has(f.modelo),
    sobDemanda: f.sobDemanda === true,
    emitidoEm: f.emitidoEm ?? null,
  })),
);
const quando = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const pendentes = computed(() => obrigatoriosPendentes(documentos.value, emitidos.value));
function alternar(modelo: number, obrigatorio: boolean): void {
  if (obrigatorio) return;
  const s = new Set(marcados.value);
  if (s.has(modelo)) s.delete(modelo);
  else s.add(modelo);
  marcados.value = s;
}
const emitirMarcados = () => emitirDocumentos(documentos.value.filter((x) => x.obrigatorio || x.selecionado));
const pdfs = ref<{ nome: string; url: string; copias: number }[]>([]);
async function emitirDocumentos(
  lista: readonly { modelo: number; titulo: string; copias: number }[],
): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    for (const d of lista) {
      const r = await emitirDocumento(reg.value, momento.value, d.modelo, novaChave(`doc-${d.modelo}`));
      pdfs.value.push({ nome: d.titulo, url: URL.createObjectURL(blobDoPdf(r.conteudo)), copias: d.copias });
      emitidos.value = new Set([...emitidos.value, d.modelo]);
      emitidosAgora.value = new Set([...emitidosAgora.value, d.modelo]);
    }
    mensagem.value = t('adt.impressos.emitidos', { n: pdfs.value.length });
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const pdf = ref<string | null>(null);
const ocupado = ref(false);
async function emitir(
  codigo: string,
  formato: string,
  modelo?: { modelo: number; copias: number },
): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const r = await emitirImpresso(
      reg.value,
      modelo
        ? { impresso: 'ficha', formato: 'pdf', copias: modelo.copias, modelo: modelo.modelo }
        : {
            impresso: codigo,
            formato,
            copias: copias.value[codigo] ?? 1,
            ...(identificacao.value[codigo]?.corpo ?? {}),
          },
      novaChave(`imp-${codigo}`),
    );
    if (r.formato === 'pdf') {
      if (pdf.value) URL.revokeObjectURL(pdf.value);
      pdf.value = URL.createObjectURL(blobDoPdf(r.conteudo));
      mensagem.value = t('adt.impressos.pdfPronto');
      window.open(pdf.value, '_blank', 'noopener');
    } else mensagem.value = t('adt.impressos.enviado');
    if (!modelo && codigo !== 'ficha') emissoes.value += 1;
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
onBeforeUnmount(() => {
  if (pdf.value) URL.revokeObjectURL(pdf.value);
  for (const p of pdfs.value) URL.revokeObjectURL(p.url);
});
const configuracao = rotaDoSubitem('internacao');
</script>

<template>
  <section class="tela-agenda" aria-labelledby="imp-int-titulo" data-testid="tela-impressos-internacao">
    <h1 id="imp-int-titulo">{{ t('adt.impressos.titulo') }}</h1>
    <p>{{ t('adt.impressos.texto') }}</p>
    <ErroAdt v-if="ficha.isError.value" :erro="ficha.error.value" />
    <p v-else-if="!ficha.data.value" role="status">{{ t('adt.carregando') }}</p>
    <template v-else>
      <ResumoInternacao :internacao="ficha.data.value" atalhos />
      <ul class="lista-simples">
        <li v-for="i in IMPRESSOS" :key="i.codigo" class="acoes">
          <strong>{{ t(`adt.impressos.${i.codigo}`) }}</strong>
          <label :for="`imp-copias-${i.codigo}`">{{ t('adt.impressos.copias') }}</label>
          <input
            :id="`imp-copias-${i.codigo}`"
            v-model.number="copias[i.codigo]"
            type="number"
            min="1"
            max="10"
          />
          <SanteBotao
            :rotulo="identificacao[i.codigo]?.rotulo ?? t('adt.impressos.emitir')"
            :desabilitado="ocupado || identificacao[i.codigo]?.pronto === false"
            :data-testid="`imp-${i.codigo}`"
            @acionar="emitir(i.codigo, i.formato)"
          />
          <IdentificacaoImpressa
            v-if="i.codigo !== 'ficha'"
            alvo="internacao"
            :id="reg"
            :tipo="i.codigo"
            :recarregar="emissoes"
            @mudou="(p: PedidoIdentificacao) => (identificacao[i.codigo] = p)"
          />
        </li>
      </ul>
      <section class="painel" aria-labelledby="imp-fichas">
        <h2 id="imp-fichas">{{ t('adt.impressos.configuradas') }}</h2>
        <SanteSelecao
          v-model="momento"
          :rotulo="t('adt.impressos.momento')"
          :opcoes="opMomentos"
          data-testid="imp-momento"
        />
        <ErroAdt v-if="fichas.isError.value" :erro="fichas.error.value" />
        <p v-else-if="fichas.data.value && fichas.data.value.fichas.length === 0">{{ t('adt.nenhum') }}</p>
        <ul v-else-if="fichas.data.value" class="lista-simples" data-testid="imp-fichas">
          <li v-for="d in documentos" :key="d.modelo" class="acoes">
            <label>
              <input
                type="checkbox"
                :checked="d.selecionado || d.obrigatorio"
                :disabled="d.obrigatorio"
                :data-testid="`imp-marcar-${d.modelo}`"
                @change="alternar(d.modelo, d.obrigatorio)"
              />
              {{ d.titulo }} ({{ t('adt.impressos.copias') }}: {{ d.copias }})
            </label>
            <strong v-if="d.obrigatorio">{{ t('adt.documentos.obrigatorioDoc') }}</strong>
            <em v-if="d.sobDemanda">{{ t('adt.impressos.sobDemanda') }}</em>
            <span
              v-if="d.emitidoEm || emitidosAgora.has(d.modelo)"
              class="secundario"
              :data-testid="`imp-emitido-${d.modelo}`"
              >{{
                t('adt.impressos.emitidoEm', {
                  quando:
                    d.emitidoEm && !emitidosAgora.has(d.modelo)
                      ? quando(d.emitidoEm)
                      : t('adt.impressos.agora'),
                })
              }}</span
            >
            <SanteBotao
              variante="secundario"
              :rotulo="t('adt.impressos.emitir')"
              :desabilitado="ocupado"
              :data-testid="`imp-ficha-${d.modelo}`"
              @acionar="emitirDocumentos([d])"
            />
          </li>
        </ul>
        <SanteBotao
          v-if="documentos.length"
          :rotulo="t('adt.impressos.emitirSelecionados')"
          :desabilitado="ocupado"
          data-testid="imp-emitir-marcados"
          @acionar="emitirMarcados"
        />
        <p v-if="pendentes.length" role="alert" data-testid="imp-obrigatorios-pendentes">
          {{ t('adt.impressos.obrigatoriosPendentes') }} {{ pendentes.map((p) => p.titulo).join(', ') }}
        </p>
        <ul v-if="pdfs.length" class="lista-simples" data-testid="imp-pdfs">
          <li v-for="p in pdfs" :key="p.url">
            <a :href="p.url" target="_blank" rel="noopener">{{ p.nome }}</a>
            <template v-if="p.copias > 1">
              · {{ t('adt.impressos.imprimaCopias', { n: p.copias }) }}</template
            >
          </li>
        </ul>
      </section>
      <p v-if="mensagem" role="status" data-testid="imp-mensagem">{{ mensagem }}</p>
      <a v-if="pdf" :href="pdf" target="_blank" rel="noopener">{{ t('adt.impressos.abrirPdf') }}</a>
      <ErroAdt v-if="erro" :erro="erro" />
      <p class="secundario">
        <RouterLink :to="configuracao">{{ t('dominios.subitens.internacao') }}</RouterLink>
        ·
        <RouterLink
          :to="{ path: '/internacao/documentos', query: { reg: String(reg) } }"
          data-testid="imp-configurar-documentos"
          >{{ t('adt.impressos.configurar') }}</RouterLink
        >
      </p>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
