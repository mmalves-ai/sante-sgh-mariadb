<script setup lang="ts">
// A publicação do documento da qualidade (novo ou nova revisão). Quem publica é o aprovador da sessão; o elaborador é
// outra pessoa (o servidor confere). Na revisão, o código, o tipo e a área vêm da vigente e o resumo da alteração é
// obrigatório; a vigente fica obsoleta na mesma gravação.
import { MESES_REVISAO_DOCUMENTO_PADRAO, TIPOS_DOCUMENTO_QUALIDADE } from '@sgh/contratos';
import { SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { somarMeses } from '@sgh/dominio-qualidade';
import { reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { type DocumentoCompletoTela, novaChaveGestao, publicarDocumento } from '../api-gestao.js';
import { type FormularioDocumento, formularioDaRevisao, montarPublicacao } from '../regras-gestao.js';
import ErroGestao from './ErroGestao.vue';
import ErrosFormulario from './ErrosFormulario.vue';

const props = defineProps<{ vigente: DocumentoCompletoTela | null; hoje: string }>();
const emit = defineEmits<{ gravado: [r: { id: number; revisao: number }]; cancelar: [] }>();
const { t } = useI18n();

const vazio: FormularioDocumento = {
  codigo: '',
  tipo: '',
  titulo: '',
  area: '',
  conteudo: '',
  resumoAlteracao: '',
  elaboradoPor: '',
  revisadoPor: '',
  vigenciaAte: null,
  exigeCiencia: true,
};
const f = reactive({
  ...(props.vigente ? formularioDaRevisao(props.vigente) : vazio),
  vigenciaAte: somarMeses(props.hoje, MESES_REVISAO_DOCUMENTO_PADRAO) as string | null,
});
const opTipos = [
  { valor: '', rotulo: '' },
  ...TIPOS_DOCUMENTO_QUALIDADE.map((x) => ({ valor: x.codigo as string, rotulo: x.rotulo })),
];
const erros = ref<Record<string, string>>({});
const erro = ref<unknown>(null);
const gravando = ref(false);
let chave = novaChaveGestao('documento');

async function gravar(): Promise<void> {
  erro.value = null;
  const m = montarPublicacao(
    f,
    props.vigente ? { id: props.vigente.id, versao: props.vigente.versao } : null,
  );
  if (!m.ok) {
    erros.value = { ...m.erros };
    return;
  }
  erros.value = {};
  gravando.value = true;
  try {
    const r = await publicarDocumento(m.entrada, chave);
    chave = novaChaveGestao('documento');
    emit('gravado', r);
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
</script>

<template>
  <form class="painel-ccih" data-testid="form-documento" @submit.prevent="gravar">
    <h2>
      {{
        vigente
          ? t('gestaoQualidade.documentos.form.tituloRevisao', { codigo: vigente.codigo })
          : t('gestaoQualidade.documentos.form.tituloNovo')
      }}
    </h2>
    <p class="secundario">{{ t('gestaoQualidade.documentos.form.explicacao') }}</p>
    <div class="linha-ccih">
      <SanteCampoTexto
        v-if="!vigente"
        v-model="f.codigo"
        :rotulo="t('gestaoQualidade.documentos.form.codigo')"
        :max-bytes="20"
        obrigatorio
        data-testid="doc-codigo"
      />
      <SanteSelecao
        v-if="!vigente"
        v-model="f.tipo"
        :rotulo="t('gestaoQualidade.documentos.tipo')"
        :opcoes="opTipos"
        obrigatorio
        data-testid="doc-tipo"
      />
      <SanteCampoTexto
        v-if="!vigente"
        v-model="f.area"
        :rotulo="t('gestaoQualidade.area')"
        :max-bytes="80"
        obrigatorio
        data-testid="doc-area"
      />
    </div>
    <SanteCampoTexto
      v-model="f.titulo"
      :rotulo="t('gestaoQualidade.documentos.form.titulo')"
      :max-bytes="200"
      obrigatorio
      data-testid="doc-titulo"
    />
    <SanteCampoTexto
      v-model="f.conteudo"
      :rotulo="t('gestaoQualidade.documentos.form.conteudo')"
      :max-bytes="16000"
      multilinha
      obrigatorio
      data-testid="doc-conteudo"
    />
    <SanteCampoTexto
      v-if="vigente"
      v-model="f.resumoAlteracao"
      :rotulo="t('gestaoQualidade.documentos.form.resumoAlteracao')"
      :max-bytes="500"
      multilinha
      obrigatorio
      data-testid="doc-resumo"
    />
    <div class="linha-ccih">
      <SanteCampoTexto
        v-model="f.elaboradoPor"
        :rotulo="t('gestaoQualidade.documentos.form.elaboradoPor')"
        :max-bytes="31"
        obrigatorio
        data-testid="doc-elaborado"
      />
      <SanteCampoTexto
        v-model="f.revisadoPor"
        :rotulo="t('gestaoQualidade.documentos.form.revisadoPor')"
        :max-bytes="31"
        data-testid="doc-revisado"
      />
      <SanteData
        v-model="f.vigenciaAte"
        :rotulo="t('gestaoQualidade.documentos.form.vigenciaAte')"
        editavel
        data-testid="doc-vigencia"
      />
    </div>
    <label class="marcar-gestao"
      ><input v-model="f.exigeCiencia" type="checkbox" data-testid="doc-exige-ciencia" />
      {{ t('gestaoQualidade.documentos.form.exigeCiencia') }}</label
    >
    <ErrosFormulario :erros="erros" />
    <ErroGestao v-if="erro" :erro="erro" />
    <div class="linha-ccih">
      <SanteBotao
        tipo="submit"
        :rotulo="t('gestaoQualidade.documentos.form.publicar')"
        :desabilitado="gravando"
        data-testid="doc-publicar"
      />
      <SanteBotao :rotulo="t('gestaoQualidade.cancelar')" variante="texto" @acionar="emit('cancelar')" />
    </div>
  </form>
</template>
