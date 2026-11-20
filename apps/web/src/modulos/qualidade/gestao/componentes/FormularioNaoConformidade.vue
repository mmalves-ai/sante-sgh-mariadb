<script setup lang="ts">
// A não conformidade aberta (a origem pode vir da auditoria, do risco ou da manifestação que a abriu) ou o andamento
// dela com a versão lida: o tratamento (causa, plano, responsável e prazo), a verificação e o encerramento com a
// eficácia. O servidor confere a passagem entre as situações e que o registro de origem existe.
import {
  CLASSIFICACOES_NAO_CONFORMIDADE,
  EFICACIAS_NAO_CONFORMIDADE,
  ORIGENS_NAO_CONFORMIDADE,
  SITUACOES_NAO_CONFORMIDADE,
} from '@sgh/contratos';
import { SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { type NaoConformidadeTela, novaChaveGestao, registrarNaoConformidade } from '../api-gestao.js';
import {
  formularioDaNaoConformidade,
  montarNaoConformidade,
  ORIGENS_COM_REGISTRO,
} from '../regras-gestao.js';
import ErroGestao from './ErroGestao.vue';
import ErrosFormulario from './ErrosFormulario.vue';

const props = defineProps<{
  naoConformidade: NaoConformidadeTela | null;
  origem?: { origem: string; id: number | null } | undefined;
}>();
const emit = defineEmits<{ gravado: [id: number]; cancelar: [] }>();
const { t } = useI18n();

const f = reactive(formularioDaNaoConformidade(props.naoConformidade, props.origem));
const op = (l: readonly { codigo: string; rotulo: string }[], vazia = true) => [
  ...(vazia ? [{ valor: '', rotulo: '' }] : []),
  ...l.map((x) => ({ valor: x.codigo, rotulo: x.rotulo })),
];
const opOrigem = op(ORIGENS_NAO_CONFORMIDADE);
const opClassificacao = op(CLASSIFICACOES_NAO_CONFORMIDADE);
const opSituacao = op(SITUACOES_NAO_CONFORMIDADE, false);
const opEficacia = op(EFICACIAS_NAO_CONFORMIDADE);
const comRegistro = computed(() => (ORIGENS_COM_REGISTRO as readonly string[]).includes(f.origem));
const novo = props.naoConformidade === null;

const erros = ref<Record<string, string>>({});
const erro = ref<unknown>(null);
const gravando = ref(false);
let chave = novaChaveGestao('nc');
async function gravar(): Promise<void> {
  erro.value = null;
  const m = montarNaoConformidade(f, props.naoConformidade);
  if (!m.ok) {
    erros.value = { ...m.erros };
    return;
  }
  erros.value = {};
  gravando.value = true;
  try {
    const r = await registrarNaoConformidade(m.entrada, chave);
    chave = novaChaveGestao('nc');
    emit('gravado', r.id);
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
</script>

<template>
  <form class="painel-ccih" data-testid="form-nc" @submit.prevent="gravar">
    <h2>
      {{
        naoConformidade
          ? t('gestaoQualidade.nc.form.tituloAndamento', { id: naoConformidade.id })
          : t('gestaoQualidade.nc.form.tituloNova')
      }}
    </h2>
    <div class="linha-ccih">
      <SanteSelecao
        v-model="f.origem"
        :rotulo="t('gestaoQualidade.nc.form.origem')"
        :opcoes="opOrigem"
        :desabilitado="!novo"
        obrigatorio
        data-testid="nc-origem"
      />
      <SanteCampoTexto
        v-if="comRegistro"
        v-model="f.idOrigem"
        :rotulo="t('gestaoQualidade.nc.form.idOrigem')"
        :max-bytes="10"
        data-testid="nc-id-origem"
      />
      <SanteSelecao
        v-model="f.classificacao"
        :rotulo="t('gestaoQualidade.nc.form.classificacao')"
        :opcoes="opClassificacao"
        obrigatorio
        data-testid="nc-classificacao"
      />
      <SanteCampoTexto
        v-model="f.area"
        :rotulo="t('gestaoQualidade.area')"
        :max-bytes="80"
        obrigatorio
        data-testid="nc-area"
      />
    </div>
    <SanteCampoTexto
      v-model="f.descricao"
      :rotulo="t('gestaoQualidade.nc.form.descricao')"
      :max-bytes="2000"
      multilinha
      obrigatorio
      data-testid="nc-descricao"
    />
    <SanteCampoTexto
      v-model="f.acaoImediata"
      :rotulo="t('gestaoQualidade.nc.form.acaoImediata')"
      :max-bytes="1000"
      multilinha
      data-testid="nc-acao-imediata"
    />
    <SanteSelecao
      v-model="f.situacao"
      :rotulo="t('gestaoQualidade.situacao')"
      :opcoes="opSituacao"
      data-testid="nc-situacao"
    />
    <template v-if="f.situacao !== 'aberta'">
      <SanteCampoTexto
        v-model="f.causa"
        :rotulo="t('gestaoQualidade.nc.form.causa')"
        :max-bytes="2000"
        multilinha
        obrigatorio
        data-testid="nc-causa"
      />
      <SanteCampoTexto
        v-model="f.plano"
        :rotulo="t('gestaoQualidade.nc.form.plano')"
        :max-bytes="2000"
        multilinha
        obrigatorio
        data-testid="nc-plano"
      />
      <div class="linha-ccih">
        <SanteCampoTexto
          v-model="f.responsavel"
          :rotulo="t('gestaoQualidade.responsavel')"
          :max-bytes="80"
          obrigatorio
          data-testid="nc-responsavel"
        />
        <SanteData v-model="f.prazo" :rotulo="t('gestaoQualidade.prazo')" editavel data-testid="nc-prazo" />
      </div>
    </template>
    <p v-else class="secundario">{{ t('gestaoQualidade.nc.form.prazoPadrao') }}</p>
    <template v-if="f.situacao === 'verificacao' || f.situacao === 'encerrada'">
      <SanteSelecao
        v-model="f.eficacia"
        :rotulo="t('gestaoQualidade.nc.form.eficacia')"
        :opcoes="opEficacia"
        :obrigatorio="f.situacao === 'encerrada'"
        data-testid="nc-eficacia"
      />
      <SanteCampoTexto
        v-model="f.eficaciaTexto"
        :rotulo="t('gestaoQualidade.nc.form.eficaciaTexto')"
        :max-bytes="1000"
        multilinha
        data-testid="nc-eficacia-texto"
      />
    </template>
    <ErrosFormulario :erros="erros" />
    <ErroGestao v-if="erro" :erro="erro" />
    <div class="linha-ccih">
      <SanteBotao
        tipo="submit"
        :rotulo="t('gestaoQualidade.gravar')"
        :desabilitado="gravando"
        data-testid="nc-gravar"
      />
      <SanteBotao :rotulo="t('gestaoQualidade.cancelar')" variante="texto" @acionar="emit('cancelar')" />
    </div>
  </form>
</template>
