<script setup lang="ts">
// Documento aberto (leitura auditada): texto em parágrafos, situação, suspensão e a prova do documento do novo;
// imprime o PDF/A dizendo por quê (01-ADM L82): a 1ª via pede a justificativa, com as razões comuns à mão. Da 2ª via
// em diante (01-ADM L79, um só caminho de motivo) a tela já sabe, pela rota das vias, que o documento saiu antes e
// pede o motivo do catálogo de reimpressão, com o complemento só quando o motivo exige. O botão só libera com a
// entrada válida (validação na hora); a nova via entra no registro de reimpressões.
import type { TipoDocumentoAberto } from '@sgh/contratos';
import { JUSTIFICATIVA_MINIMA_IMPRESSAO, RAZOES_IMPRESSAO } from '@sgh/dominio-pep';
import { SanteAlerta, SanteBotao, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../../casca/MensagemErro.vue';
import { abrirArquivo, abrirDocumento, imprimirDocumento, lerViasDocumento } from '../../api-documentos.js';
import { dataHoraBr } from '../../formato.js';

const props = defineProps<{ paciente: number; tipo: TipoDocumentoAberto; id: number }>();
const visivel = defineModel<boolean>('visivel', { required: true });
const { t } = useI18n();
const doc = useQuery({
  queryKey: computed(() => ['pep', 'doc', 'aberto', props.paciente, props.tipo, props.id]),
  queryFn: () => abrirDocumento(props.paciente, props.tipo, props.id),
  enabled: computed(() => visivel.value),
});
const vias = useQuery({
  queryKey: computed(() => ['pep', 'doc', 'vias', props.paciente, props.tipo, props.id]),
  queryFn: () => lerViasDocumento(props.paciente, props.tipo, props.id),
  enabled: computed(() => visivel.value && !!doc.data.value?.pdf),
});
const impressoes = ref(0);
const justificativa = ref('');
const motivo = ref<number | null>(null);
const complemento = ref('');
const erro = ref<unknown>(null);
const novaVia = computed(() => impressoes.value > 0 || !!vias.data.value?.impresso);
const motivos = computed(() => vias.data.value?.motivos ?? []);
const opcoesMotivo = computed(() => [
  { valor: null, rotulo: t('pep.doc.documento.escolhaMotivo') },
  ...motivos.value.map((m) => ({ valor: m.id, rotulo: m.descricao })),
]);
const minimoComplemento = computed(() => vias.data.value?.complementoMinimo ?? 1);
const pedeComplemento = computed(
  () => motivos.value.find((m) => m.id === motivo.value)?.exigeComplemento ?? false,
);
const entradaValida = computed(() =>
  novaVia.value
    ? motivo.value !== null &&
      (!pedeComplemento.value || complemento.value.trim().length >= minimoComplemento.value)
    : justificativa.value.trim().length >= JUSTIFICATIVA_MINIMA_IMPRESSAO,
);
async function imprimir(): Promise<void> {
  erro.value = null;
  if (!entradaValida.value) return;
  const comp = complemento.value.trim();
  try {
    abrirArquivo(
      await imprimirDocumento(
        props.paciente,
        props.tipo,
        props.id,
        novaVia.value && motivo.value !== null
          ? { motivoReimpressao: motivo.value, ...(comp ? { complemento: comp } : {}) }
          : { justificativa: justificativa.value.trim() },
      ),
    );
    impressoes.value++;
    justificativa.value = '';
    motivo.value = null;
    complemento.value = '';
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <SanteDialogo
    v-model:visivel="visivel"
    :titulo="doc.data.value?.titulo ?? t('pep.doc.documento.titulo')"
    largura="48rem"
  >
    <MensagemErro v-if="doc.isError.value" :erro="doc.error.value" />
    <p v-else-if="!doc.data.value" role="status">{{ t('pep.doc.carregando') }}</p>
    <article v-else class="documento" data-testid="documento-aberto">
      <p>
        <span class="marcador">{{ t(`pep.doc.documento.situacao.${doc.data.value.situacao}`) }}</span>
        {{
          t('pep.doc.documento.emitido', {
            data: dataHoraBr(doc.data.value.emitidoEm),
            profissional: doc.data.value.profissional ?? '-',
          })
        }}
      </p>
      <SanteAlerta
        v-if="doc.data.value.suspensao"
        variante="aviso"
        :texto="
          t('pep.doc.documento.suspenso', {
            data: dataHoraBr(doc.data.value.suspensao.em),
            justificativa: doc.data.value.suspensao.justificativa ?? '-',
          })
        "
      />
      <SanteAlerta v-if="doc.data.value.marcaSuporte" variante="info" :texto="doc.data.value.marcaSuporte" />
      <div class="texto">
        <p v-for="(p, i) in doc.data.value.paragrafos" :key="i">{{ p || ' ' }}</p>
      </div>
      <p v-if="doc.data.value.prova" class="prova">
        {{ t('pep.doc.documento.prova', { hash: doc.data.value.prova.hash.slice(0, 16) }) }} ·
        {{
          doc.data.value.prova.assinadoEm
            ? t('pep.doc.documento.assinadoEm', { data: dataHoraBr(doc.data.value.prova.assinadoEm) })
            : t('pep.doc.documento.semAssinatura')
        }}
      </p>
      <form v-if="doc.data.value.pdf" class="imprimir" @submit.prevent="imprimir">
        <template v-if="novaVia">
          <p data-testid="aviso-nova-via">{{ t('pep.doc.documento.jaImpresso') }}</p>
          <SanteSelecao
            v-model="motivo"
            data-testid="motivo-reimpressao"
            :rotulo="t('pep.doc.documento.motivoReimpressao')"
            :opcoes="opcoesMotivo"
            obrigatorio
          />
          <label v-if="pedeComplemento">
            <span>{{ t('pep.doc.documento.complemento', { minimo: minimoComplemento }) }}</span>
            <input
              v-model="complemento"
              data-testid="complemento-reimpressao"
              maxlength="500"
              :minlength="minimoComplemento"
              required
            />
          </label>
        </template>
        <label v-else>
          <span>{{ t('pep.doc.documento.justificativaImpressao') }}</span>
          <input
            v-model="justificativa"
            data-testid="justificativa-impressao"
            maxlength="200"
            :minlength="JUSTIFICATIVA_MINIMA_IMPRESSAO"
            list="razoes-impressao"
            required
          />
          <datalist id="razoes-impressao">
            <option v-for="r in RAZOES_IMPRESSAO" :key="r" :value="r" />
          </datalist>
        </label>
        <SanteBotao
          tipo="submit"
          variante="secundario"
          :rotulo="t('pep.doc.imprimir')"
          :desabilitado="!entradaValida"
        />
      </form>
      <MensagemErro v-if="erro" :erro="erro" />
    </article>
  </SanteDialogo>
</template>

<style scoped>
.documento {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
}
.texto p {
  margin: 0;
  white-space: pre-wrap;
}
.prova {
  font-size: 0.875rem;
}
.marcador {
  font-weight: 600;
  outline: 1px solid var(--sgh-borda-forte);
  padding: 0 var(--sgh-espaco-1);
}
.imprimir {
  display: flex;
  gap: var(--sgh-espaco-2);
  align-items: flex-end;
}
.imprimir label {
  display: flex;
  flex-direction: column;
}
.imprimir input {
  font: inherit;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda);
  border-radius: 6px;
}
</style>
