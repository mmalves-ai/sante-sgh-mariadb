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
import ErroAtendimento from '../componentes/ErroAtendimento.vue';
import ResumoAtendimento from '../componentes/ResumoAtendimento.vue';
import { blobDoPdf } from '../regras-tela.js';

const props = defineProps<{ reg: string }>();
const { t } = useI18n();
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
        : { impresso, formato: f, copias: Number(copias.value[impresso] ?? '1') },
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
            <td>{{ i.rotulo }}</td>
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
                :rotulo="t('atendimento.impressos.emitir')"
                :desabilitado="ocupado"
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
            <SanteBotao
              variante="secundario"
              :rotulo="t('atendimento.impressos.emitirFicha', { nome: f.nome })"
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
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
