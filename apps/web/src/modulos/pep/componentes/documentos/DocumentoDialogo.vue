<script setup lang="ts">
// Documento aberto (leitura auditada): texto em parágrafos, situação, suspensão e a prova do documento do novo;
// imprime o PDF/A com a justificativa (01-ADM L82: a 1ª via pede a justificativa, com as razões comuns à mão; a
// 2ª via, o motivo). O botão só libera com o texto no tamanho mínimo.
import type { TipoDocumentoAberto } from '@sgh/contratos';
import {
  JUSTIFICATIVA_MINIMA_IMPRESSAO,
  MOTIVO_MINIMO_SEGUNDA_VIA,
  RAZOES_IMPRESSAO,
} from '@sgh/dominio-pep';
import { SanteAlerta, SanteBotao, SanteDialogo } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../../casca/MensagemErro.vue';
import { abrirArquivo, abrirDocumento, imprimirDocumento } from '../../api-documentos.js';
import { dataHoraBr } from '../../formato.js';

const props = defineProps<{ paciente: number; tipo: TipoDocumentoAberto; id: number }>();
const visivel = defineModel<boolean>('visivel', { required: true });
const { t } = useI18n();
const doc = useQuery({
  queryKey: computed(() => ['pep', 'doc', 'aberto', props.paciente, props.tipo, props.id]),
  queryFn: () => abrirDocumento(props.paciente, props.tipo, props.id),
  enabled: computed(() => visivel.value),
});
const impressoes = ref(0);
const motivo = ref('');
const erro = ref<unknown>(null);
const minimo = computed(() =>
  impressoes.value > 0 ? MOTIVO_MINIMO_SEGUNDA_VIA : JUSTIFICATIVA_MINIMA_IMPRESSAO,
);
const textoValido = computed(() => motivo.value.trim().length >= minimo.value);
async function imprimir(): Promise<void> {
  erro.value = null;
  if (!textoValido.value) return;
  const texto = motivo.value.trim();
  try {
    abrirArquivo(
      await imprimirDocumento(
        props.paciente,
        props.tipo,
        props.id,
        impressoes.value > 0 ? { motivo: texto } : { justificativa: texto },
      ),
    );
    impressoes.value++;
    motivo.value = '';
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
        <label>
          <span>{{
            impressoes > 0 ? t('pep.doc.documento.segundaVia') : t('pep.doc.documento.justificativaImpressao')
          }}</span>
          <input
            v-model="motivo"
            data-testid="justificativa-impressao"
            maxlength="255"
            :minlength="minimo"
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
          :desabilitado="!textoValido"
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
