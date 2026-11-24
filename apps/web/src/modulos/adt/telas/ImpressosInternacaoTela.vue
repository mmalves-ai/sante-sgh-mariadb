<script setup lang="ts">
// Fichas e impressos da internação (ficha do M21, seção 7): `/internacao/:reg/impressos`. A ficha de internação em PDF
// (abre por endereço blob:) e a pulseira e a etiqueta do prontuário em ZPL na fila da impressora da estação (o mesmo
// pedido repetido não imprime duas vezes). A configuração das fichas a imprimir fica no cadastro genérico.
import { SanteBotao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, onBeforeUnmount, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { rotaDoSubitem } from '@sgh/contratos';
import { blobDoPdf } from '../../atendimento/regras-tela.js';
import { emitirImpresso, lerFichas, novaChave } from '../api-adt.js';
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
const fichas = useQuery({
  queryKey: computed(() => ['adt', 'fichas', reg.value]),
  queryFn: () => lerFichas(reg.value),
});
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
        : { impresso: codigo, formato, copias: copias.value[codigo] ?? 1 },
      novaChave(`imp-${codigo}`),
    );
    if (r.formato === 'pdf') {
      if (pdf.value) URL.revokeObjectURL(pdf.value);
      pdf.value = URL.createObjectURL(blobDoPdf(r.conteudo));
      mensagem.value = t('adt.impressos.pdfPronto');
      window.open(pdf.value, '_blank', 'noopener');
    } else mensagem.value = t('adt.impressos.enviado');
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
onBeforeUnmount(() => {
  if (pdf.value) URL.revokeObjectURL(pdf.value);
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
            :rotulo="t('adt.impressos.emitir')"
            :desabilitado="ocupado"
            :data-testid="`imp-${i.codigo}`"
            @acionar="emitir(i.codigo, i.formato)"
          />
        </li>
      </ul>
      <section class="painel" aria-labelledby="imp-fichas">
        <h2 id="imp-fichas">{{ t('adt.impressos.configuradas') }}</h2>
        <p v-if="fichas.data.value && fichas.data.value.fichas.length === 0">{{ t('adt.nenhum') }}</p>
        <ul v-else-if="fichas.data.value" class="lista-simples" data-testid="imp-fichas">
          <li v-for="f in fichas.data.value.fichas" :key="`${f.modelo}-${f.grafica}`" class="acoes">
            <span>{{ f.nome }} ({{ t('adt.impressos.copias') }}: {{ f.copias }})</span>
            <SanteBotao
              variante="secundario"
              :rotulo="t('adt.impressos.emitir')"
              :desabilitado="ocupado"
              :data-testid="`imp-ficha-${f.modelo}`"
              @acionar="emitir(`ficha-${f.modelo}`, 'pdf', { modelo: f.modelo, copias: f.copias })"
            />
          </li>
        </ul>
      </section>
      <p v-if="mensagem" role="status" data-testid="imp-mensagem">{{ mensagem }}</p>
      <a v-if="pdf" :href="pdf" target="_blank" rel="noopener">{{ t('adt.impressos.abrirPdf') }}</a>
      <ErroAdt v-if="erro" :erro="erro" />
      <p class="secundario">
        <RouterLink :to="configuracao">{{ t('dominios.subitens.internacao') }}</RouterLink>
        ·
        <RouterLink to="/internacao/documentos" data-testid="imp-configurar-documentos">{{
          t('adt.impressos.configurar')
        }}</RouterLink>
      </p>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
