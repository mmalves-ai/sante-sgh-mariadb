<script setup lang="ts">
// A auditoria interna realizada, pelo checklist configurável (DP-47.9: o conteúdo do manual de acreditação é do
// estabelecimento): o checklist pode partir de uma auditoria anterior; cada requisito com o resultado e, no não
// conforme e no parcial, a evidência do achado. A conformidade aparece com as parcelas enquanto se preenche.
import { REFERENCIAIS_AUDITORIA, RESULTADOS_ITEM_AUDITORIA } from '@sgh/contratos';
import { SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { type AuditoriaTela, novaChaveGestao, registrarAuditoria } from '../api-gestao.js';
import {
  checklistDoModelo,
  dataBr,
  type ItemChecklistForm,
  itemVazio,
  montarAuditoria,
  previaChecklist,
} from '../regras-gestao.js';
import ErroGestao from './ErroGestao.vue';
import ErrosFormulario from './ErrosFormulario.vue';

const props = defineProps<{ hoje: string; modelos: readonly AuditoriaTela[] }>();
const emit = defineEmits<{ gravado: [id: number]; cancelar: [] }>();
const { t } = useI18n();

const f = reactive({
  titulo: '',
  area: '',
  referencial: '',
  realizadaEm: props.hoje as string | null,
  auditores: '',
  conclusao: '',
  itens: [itemVazio()] as ItemChecklistForm[],
});
const opReferencial = [
  { valor: '', rotulo: '' },
  ...REFERENCIAIS_AUDITORIA.map((r) => ({ valor: r.codigo as string, rotulo: r.rotulo })),
];
const opResultado = [
  { valor: '', rotulo: '' },
  ...RESULTADOS_ITEM_AUDITORIA.map((r) => ({ valor: r.codigo as string, rotulo: r.rotulo })),
];
const modelo = ref<number | ''>('');
const opModelos = computed(() => [
  { valor: '' as number | '', rotulo: t('gestaoQualidade.auditorias.form.semModelo') },
  ...props.modelos.map((a) => ({
    valor: a.id as number | '',
    rotulo: `${dataBr(a.realizadaEm)} ${a.titulo}`,
  })),
]);
function usarModelo(): void {
  const a = props.modelos.find((x) => x.id === modelo.value);
  if (!a) return;
  f.itens = checklistDoModelo(a.itens);
  f.referencial = a.referencial;
  if (!f.area) f.area = a.area;
}
const previa = computed(() => previaChecklist(f.itens));

const erros = ref<Record<string, string>>({});
const erro = ref<unknown>(null);
const gravando = ref(false);
let chave = novaChaveGestao('auditoria');
async function gravar(): Promise<void> {
  erro.value = null;
  const m = montarAuditoria(f);
  if (!m.ok) {
    erros.value = { ...m.erros };
    return;
  }
  erros.value = {};
  gravando.value = true;
  try {
    const r = await registrarAuditoria(m.entrada, chave);
    chave = novaChaveGestao('auditoria');
    emit('gravado', r.id);
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
</script>

<template>
  <form class="painel-ccih" data-testid="form-auditoria" @submit.prevent="gravar">
    <h2>{{ t('gestaoQualidade.auditorias.nova') }}</h2>
    <p class="secundario">{{ t('gestaoQualidade.auditorias.form.manual') }}</p>
    <div v-if="modelos.length" class="linha-ccih">
      <SanteSelecao
        v-model="modelo"
        :rotulo="t('gestaoQualidade.auditorias.form.modelo')"
        :opcoes="opModelos"
        busca
        data-testid="aud-modelo"
      />
      <SanteBotao
        variante="secundario"
        :rotulo="t('gestaoQualidade.auditorias.form.usarModelo')"
        :desabilitado="modelo === ''"
        data-testid="aud-usar-modelo"
        @acionar="usarModelo"
      />
    </div>
    <SanteCampoTexto
      v-model="f.titulo"
      :rotulo="t('gestaoQualidade.auditorias.form.titulo')"
      :max-bytes="200"
      obrigatorio
      data-testid="aud-titulo"
    />
    <div class="linha-ccih">
      <SanteCampoTexto
        v-model="f.area"
        :rotulo="t('gestaoQualidade.area')"
        :max-bytes="80"
        obrigatorio
        data-testid="aud-area"
      />
      <SanteSelecao
        v-model="f.referencial"
        :rotulo="t('gestaoQualidade.auditorias.form.referencial')"
        :opcoes="opReferencial"
        obrigatorio
        data-testid="aud-referencial"
      />
      <SanteData
        v-model="f.realizadaEm"
        :rotulo="t('gestaoQualidade.auditorias.form.realizadaEm')"
        editavel
        data-testid="aud-data"
      />
    </div>
    <SanteCampoTexto
      v-model="f.auditores"
      :rotulo="t('gestaoQualidade.auditorias.form.auditores')"
      :max-bytes="400"
      obrigatorio
      data-testid="aud-auditores"
    />
    <fieldset class="painel-ccih">
      <legend>{{ t('gestaoQualidade.auditorias.form.itens') }}</legend>
      <div v-for="(item, k) in f.itens" :key="k" class="painel-ccih" :data-testid="`aud-item-${k}`">
        <div class="linha-ccih">
          <SanteCampoTexto
            v-model="item.secao"
            :rotulo="t('gestaoQualidade.auditorias.form.secao')"
            :max-bytes="80"
            :data-testid="`aud-item-secao-${k}`"
          />
          <SanteSelecao
            v-model="item.resultado"
            :rotulo="t('gestaoQualidade.auditorias.form.resultado')"
            :opcoes="opResultado"
            obrigatorio
            :data-testid="`aud-item-resultado-${k}`"
          />
          <SanteBotao
            v-if="f.itens.length > 1"
            variante="texto"
            :rotulo="t('gestaoQualidade.auditorias.form.removerItem', { n: k + 1 })"
            @acionar="f.itens.splice(k, 1)"
          />
        </div>
        <SanteCampoTexto
          v-model="item.requisito"
          :rotulo="t('gestaoQualidade.auditorias.form.requisito', { n: k + 1 })"
          :max-bytes="400"
          obrigatorio
          :data-testid="`aud-item-requisito-${k}`"
        />
        <SanteCampoTexto
          v-if="item.resultado === 'naoConforme' || item.resultado === 'parcial'"
          v-model="item.evidencia"
          :rotulo="t('gestaoQualidade.auditorias.form.evidencia')"
          :max-bytes="600"
          multilinha
          obrigatorio
          :data-testid="`aud-item-evidencia-${k}`"
        />
      </div>
      <SanteBotao
        v-if="f.itens.length < 150"
        variante="secundario"
        :rotulo="t('gestaoQualidade.auditorias.form.incluirItem')"
        data-testid="aud-incluir-item"
        @acionar="f.itens.push(itemVazio(f.itens.at(-1)?.secao ?? ''))"
      />
    </fieldset>
    <p data-testid="aud-previa">
      {{ t('gestaoQualidade.auditorias.form.previa') }}:
      {{ previa.conta ?? t('gestaoQualidade.auditorias.form.semPrevia') }}
    </p>
    <SanteCampoTexto
      v-model="f.conclusao"
      :rotulo="t('gestaoQualidade.auditorias.form.conclusao')"
      :max-bytes="2000"
      multilinha
      obrigatorio
      data-testid="aud-conclusao"
    />
    <ErrosFormulario :erros="erros" />
    <ErroGestao v-if="erro" :erro="erro" />
    <div class="linha-ccih">
      <SanteBotao
        tipo="submit"
        :rotulo="t('gestaoQualidade.gravar')"
        :desabilitado="gravando"
        data-testid="aud-gravar"
      />
      <SanteBotao :rotulo="t('gestaoQualidade.cancelar')" variante="texto" @acionar="emit('cancelar')" />
    </div>
  </form>
</template>
