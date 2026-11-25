<script setup lang="ts">
// Impressos e etiquetas (ficha do M20, seção 7): `/recepcao/atendimento/:reg/impressos`. A ficha de atendimento (PDF),
// as etiquetas (ZPL ou PDF) e a pulseira (ZPL, dois identificadores e o código 2D com os números do paciente e do
// atendimento: regra 10); o ZPL vai para a fila de impressão da estação (o mesmo pedido repetido não imprime duas
// vezes). As fichas a imprimir que a configuração manda para este atendimento saem cada uma com o seu título e as
// cópias calculadas. O PDF abre numa aba nova como arquivo do navegador (endereço blob:; a navegação para data: é
// bloqueada pelos navegadores), e o endereço é liberado depois.
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, onBeforeUnmount, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { emitirImpresso, lerAtendimento, lerImpressos, novaChave } from '../api-atendimento.js';
import { lerEmissoesImpresso } from '../api-regras-impressao.js';
import ErroAtendimento from '../componentes/ErroAtendimento.vue';
import IdentificacaoImpressa, { type PedidoIdentificacao } from '../componentes/IdentificacaoImpressa.vue';
import ResumoAtendimento from '../componentes/ResumoAtendimento.vue';
import { blobDoPdf } from '../regras-tela.js';

const props = defineProps<{ reg: string }>();
const { t, te } = useI18n();
const rota = useRoute();
const reg = computed(() => Number(props.reg));
const ficha = useQuery({
  queryKey: computed(() => ['atendimento', 'ficha', reg.value]),
  queryFn: () => lerAtendimento(reg.value),
});
const impressos = useQuery({
  queryKey: computed(() => ['atendimento', 'impressos', reg.value]),
  queryFn: () => lerImpressos(reg.value),
});
// 02-REC linha 35: o que já saiu para este atendimento (a reimpressão aparece com quem e quando). Sem o banco do
// estabelecimento a lista não existe e o bloco simplesmente não aparece.
const emitidos = useQuery({
  queryKey: computed(() => ['atendimento', 'impressos-emitidos', reg.value]),
  queryFn: () => lerEmissoesImpresso(reg.value),
  retry: false,
});
const vezesDoModelo = computed(() => {
  const m = new Map<number, number>();
  for (const e of emitidos.data.value ?? [])
    if (e.modelo !== null) m.set(e.modelo, (m.get(e.modelo) ?? 0) + 1);
  return m;
});
const nomeDaEmissao = (e: { impresso: string; titulo: string | null }): string =>
  e.titulo ??
  (te(`regrasImpressao.emissoes.padrao.${e.impresso}`)
    ? t(`regrasImpressao.emissoes.padrao.${e.impresso}`)
    : e.impresso);
const quando = (iso: string): string =>
  new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const copias = ref<Record<string, string>>({});
const formato = ref<Record<string, string>>({});
const ultimo = ref<{ impresso: string; texto: string; pdf: string | null; arquivo: string } | null>(null);
/** Libera o endereço do PDF anterior (o arquivo do navegador vive até a próxima emissão ou a saída da tela). */
function liberarPdf(): void {
  const u = ultimo.value?.pdf;
  if (u) URL.revokeObjectURL(u);
}
onBeforeUnmount(liberarPdf);
const erro = ref<unknown>(null);
// Pulseira e etiqueta (01-ADM L79): já impressa, só sai de novo com o motivo; a situação é relida a cada emissão.
const identificacao = ref<Record<string, PedidoIdentificacao>>({});
const emissoes = ref(0);
const deIdentificacao = (impresso: string): impresso is 'pulseira' | 'etiqueta' =>
  impresso === 'pulseira' || impresso === 'etiqueta';
const ocupado = ref(false);
const opcoesCopias = (impresso: string) =>
  Array.from({ length: impresso === 'etiqueta' ? 20 : 5 }, (_, i) => ({
    valor: String(i + 1),
    rotulo: String(i + 1),
  }));
async function emitir(
  impresso: string,
  formatos: readonly string[],
  ficha: { modelo: number; copias: number } | null = null,
): Promise<void> {
  erro.value = null;
  liberarPdf();
  ultimo.value = null;
  ocupado.value = true;
  try {
    const f = ficha ? 'pdf' : (formato.value[impresso] ?? formatos[0] ?? 'pdf');
    const r = await emitirImpresso(
      reg.value,
      ficha
        ? {
            impresso: 'ficha',
            formato: 'pdf',
            copias: Math.min(10, Math.max(1, ficha.copias)),
            modelo: ficha.modelo,
          }
        : {
            impresso,
            formato: f,
            copias: Number(copias.value[impresso] ?? '1'),
            ...(identificacao.value[impresso]?.corpo ?? {}),
          },
      novaChave(`impresso-${impresso}`),
    );
    const pdf = r.formato === 'pdf' ? URL.createObjectURL(blobDoPdf(r.conteudo)) : null;
    ultimo.value = {
      impresso,
      texto:
        r.formato === 'zpl'
          ? r.fila?.novo === false
            ? t('atendimento.impressos.jaNaFila')
            : t('atendimento.impressos.naFila')
          : t('atendimento.impressos.pdfPronto'),
      pdf,
      arquivo: r.nomeArquivo,
    };
    if (pdf) window.open(pdf, '_blank', 'noopener');
    if (deIdentificacao(impresso)) emissoes.value += 1;
    void emitidos.refetch();
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="impressos-titulo" data-testid="tela-impressos">
    <h1 id="impressos-titulo">{{ t('atendimento.impressos.titulo') }}</h1>
    <p>{{ t('atendimento.impressos.texto') }}</p>
    <SanteAlerta
      v-if="rota.query['novo'] === 'sim'"
      variante="info"
      :texto="t('atendimento.impressos.aberto')"
      data-testid="atendimento-aberto"
    />
    <ResumoAtendimento v-if="ficha.data.value" :atendimento="ficha.data.value" atalhos />
    <ErroAtendimento v-if="impressos.isError.value" :erro="impressos.error.value" />
    <p v-else-if="!impressos.data.value" role="status">{{ t('atendimento.carregando') }}</p>
    <template v-else>
      <table class="tabela" data-testid="tabela-impressos">
        <caption>
          {{
            t('atendimento.impressos.legenda')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('atendimento.impressos.impresso') }}</th>
            <th scope="col">{{ t('atendimento.impressos.formato') }}</th>
            <th scope="col">{{ t('atendimento.impressos.copias') }}</th>
            <th scope="col">{{ t('atendimento.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in impressos.data.value.impressos" :key="i.impresso">
            <td>
              {{ i.rotulo }}
              <IdentificacaoImpressa
                v-if="i.pode && deIdentificacao(i.impresso)"
                alvo="atendimento"
                :id="reg"
                :tipo="i.impresso"
                :recarregar="emissoes"
                @mudou="(p: PedidoIdentificacao) => (identificacao[i.impresso] = p)"
              />
            </td>
            <td>
              <SanteSelecao
                v-if="i.formatos.length > 1"
                :model-value="formato[i.impresso] ?? i.formatos[0] ?? ''"
                :rotulo="t('atendimento.impressos.formatoDe', { impresso: i.rotulo })"
                ocultar-rotulo
                :opcoes="i.formatos.map((f) => ({ valor: f, rotulo: f.toUpperCase() }))"
                @update:model-value="(v: string) => (formato[i.impresso] = v)"
              />
              <span v-else>{{ (i.formatos[0] ?? '').toUpperCase() }}</span>
            </td>
            <td>
              <SanteSelecao
                :model-value="copias[i.impresso] ?? '1'"
                :rotulo="t('atendimento.impressos.copiasDe', { impresso: i.rotulo })"
                ocultar-rotulo
                :opcoes="opcoesCopias(i.impresso)"
                @update:model-value="(v: string) => (copias[i.impresso] = v)"
              />
            </td>
            <td>
              <SanteBotao
                v-if="i.pode"
                :rotulo="identificacao[i.impresso]?.rotulo ?? t('atendimento.impressos.emitir')"
                :desabilitado="ocupado || identificacao[i.impresso]?.pronto === false"
                :data-testid="`emitir-${i.impresso}`"
                @acionar="emitir(i.impresso, i.formatos)"
              />
              <span v-else class="secundario">{{ i.motivo }}</span>
            </td>
          </tr>
        </tbody>
      </table>
      <section v-if="impressos.data.value.fichas.length" class="painel" aria-labelledby="impressos-fichas">
        <h2 id="impressos-fichas">{{ t('atendimento.impressos.fichas') }}</h2>
        <ul>
          <li v-for="f in impressos.data.value.fichas" :key="f.modelo" class="acoes">
            {{ t('atendimento.impressos.fichaCopias', { nome: f.nome, n: f.copias }) }}
            <span
              v-if="vezesDoModelo.get(f.modelo)"
              class="secundario"
              :data-testid="`ficha-emitida-${f.modelo}`"
              >({{ t('regrasImpressao.emissoes.jaEmitida', { n: vezesDoModelo.get(f.modelo) }) }})</span
            >
            <SanteBotao
              variante="secundario"
              :rotulo="
                vezesDoModelo.get(f.modelo)
                  ? t('regrasImpressao.emissoes.reimprimir', { nome: f.nome })
                  : t('atendimento.impressos.emitirFicha', { nome: f.nome })
              "
              :desabilitado="ocupado"
              :data-testid="`emitir-ficha-${f.modelo}`"
              @acionar="emitir(`ficha-${f.modelo}`, ['pdf'], { modelo: f.modelo, copias: f.copias })"
            />
          </li>
        </ul>
      </section>
      <p v-if="ultimo" role="status" data-testid="impresso-emitido">
        {{ ultimo.texto }}
        <a
          v-if="ultimo.pdf"
          :href="ultimo.pdf"
          :download="ultimo.arquivo"
          target="_blank"
          rel="noopener"
          data-testid="abrir-pdf"
          >{{ t('atendimento.impressos.abrirPdf') }}</a
        >
      </p>
      <ErroAtendimento v-if="erro" :erro="erro" />
      <section
        v-if="emitidos.data.value?.length"
        class="painel"
        aria-labelledby="impressos-emitidos"
        data-testid="impressos-emitidos"
      >
        <h2 id="impressos-emitidos">{{ t('regrasImpressao.emissoes.titulo') }}</h2>
        <table class="tabela">
          <caption>
            {{
              t('regrasImpressao.emissoes.legenda')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('regrasImpressao.emissoes.impresso') }}</th>
              <th scope="col">{{ t('regrasImpressao.emissoes.via') }}</th>
              <th scope="col">{{ t('regrasImpressao.emissoes.copias') }}</th>
              <th scope="col">{{ t('regrasImpressao.emissoes.quando') }}</th>
              <th scope="col">{{ t('regrasImpressao.emissoes.quem') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="e in emitidos.data.value" :key="e.id">
              <td>{{ nomeDaEmissao(e) }}</td>
              <td>
                {{
                  e.reimpressao
                    ? t('regrasImpressao.emissoes.reimpressao', { n: e.sequencia })
                    : t('regrasImpressao.emissoes.primeira')
                }}
              </td>
              <td>{{ e.copias }}</td>
              <td>{{ quando(e.emitidoEm) }}</td>
              <td>{{ e.emitidoPor ?? '' }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
