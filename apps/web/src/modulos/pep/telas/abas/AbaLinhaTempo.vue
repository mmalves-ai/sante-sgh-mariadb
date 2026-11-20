<script setup lang="ts">
// Linha do tempo (ficha do M23, regra 15): atendimentos, registros, pareceres, exames, documentos e alergias, do
// mais recente; o conteúdo sob sigilo da categoria mostra só que houve atendimento.
import { type TipoDocumentoAberto, TIPOS_EVENTO_LINHA } from '@sgh/contratos';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../../casca/MensagemErro.vue';
import { lerLinhaTempo } from '../../api-documentos.js';
import DocumentoDialogo from '../../componentes/documentos/DocumentoDialogo.vue';
import { dataHoraBr } from '../../formato.js';

const props = defineProps<{ paciente: number }>();
const { t } = useI18n();
const de = ref('');
const ate = ref('');
const tipo = ref('');
const pagina = ref(1);
const opcoesTipo = computed(() => [
  { valor: '', rotulo: t('pep.doc.linha.todos') },
  ...TIPOS_EVENTO_LINHA.map((x) => ({ valor: x as string, rotulo: t(`pep.doc.linha.tipo.${x}`) })),
]);
const filtro = ref<{ de?: string; ate?: string; tipos?: string }>({});
const linha = useQuery({
  queryKey: computed(() => ['pep', 'doc', 'linha', props.paciente, filtro.value, pagina.value]),
  queryFn: () => lerLinhaTempo(props.paciente, { ...filtro.value, pagina: pagina.value }),
});
function aplicar(): void {
  pagina.value = 1;
  filtro.value = {
    ...(de.value ? { de: de.value } : {}),
    ...(ate.value ? { ate: ate.value } : {}),
    ...(tipo.value ? { tipos: tipo.value } : {}),
  };
}
const aberto = ref<{ tipo: TipoDocumentoAberto; id: number } | null>(null);
const visivel = computed({
  get: () => aberto.value !== null,
  set: (v) => (aberto.value = v ? aberto.value : null),
});
</script>

<template>
  <section class="aba" aria-labelledby="linha-titulo" data-testid="aba-linha-do-tempo-conteudo">
    <h2 id="linha-titulo">{{ t('pep.doc.prontuario.aba.linha-do-tempo') }}</h2>
    <form class="linha" @submit.prevent="aplicar">
      <label class="campo"
        ><span>{{ t('pep.doc.linha.de') }}</span
        ><input v-model="de" type="date"
      /></label>
      <label class="campo"
        ><span>{{ t('pep.doc.linha.ate') }}</span
        ><input v-model="ate" type="date"
      /></label>
      <SanteSelecao v-model="tipo" class="campo" :rotulo="t('pep.doc.linha.tipos')" :opcoes="opcoesTipo" />
      <SanteBotao tipo="submit" variante="secundario" :rotulo="t('pep.doc.linha.filtrar')" />
    </form>
    <MensagemErro v-if="linha.isError.value" :erro="linha.error.value" />
    <p v-else-if="!linha.data.value" role="status">{{ t('pep.doc.carregando') }}</p>
    <p v-else-if="linha.data.value.eventos.length === 0">{{ t('pep.doc.nenhum') }}</p>
    <ol v-else class="lista" data-testid="linha-do-tempo">
      <li
        v-for="e in linha.data.value.eventos"
        :key="e.chave"
        class="cartao"
        :data-testid="`evento-${e.chave}`"
      >
        <p>
          <strong>{{ dataHoraBr(e.quando) }}</strong> · {{ t(`pep.doc.linha.tipo.${e.tipo}`) }}
          <span v-if="e.categoria"> · {{ t(`pep.doc.categorias.${e.categoria}`) }}</span>
          <span v-if="e.suspenso" class="marcador">{{ t('pep.doc.linha.suspenso') }}</span>
          <span v-if="e.sigilo" class="marcador" data-testid="marca-sigilo">{{
            t('pep.doc.linha.sigilo')
          }}</span>
        </p>
        <p>
          {{ e.titulo }}<span v-if="e.profissional"> · {{ e.profissional }}</span>
        </p>
        <p v-if="e.detalhe">{{ e.detalhe }}</p>
        <SanteBotao
          v-if="e.documento"
          variante="texto"
          :rotulo="t('pep.doc.abrir')"
          @acionar="aberto = e.documento"
        />
      </li>
    </ol>
    <SanteBotao
      v-if="linha.data.value?.temMais"
      variante="secundario"
      :rotulo="t('pep.doc.linha.mais')"
      @acionar="pagina++"
    />
    <DocumentoDialogo
      v-if="aberto"
      v-model:visivel="visivel"
      :paciente="paciente"
      :tipo="aberto.tipo"
      :id="aberto.id"
    />
  </section>
</template>

<style scoped src="./abas.css"></style>
