<script setup lang="ts">
// A reunião realizada da comissão: tipo, data e hora, pauta, ata, a presença marcada na composição lida (o quórum de
// maioria simples aparece com as parcelas), convidados e deliberações.
import { TIPOS_REUNIAO_COMISSAO } from '@sgh/contratos';
import { SanteBotao, SanteCampoTexto, SanteData, SanteHora, SanteSelecao } from '@sgh/ui';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { type ComissaoTela, novaChaveGestao, registrarReuniao } from '../api-gestao.js';
import { montarReuniao, previaQuorum } from '../regras-gestao.js';
import ErroGestao from './ErroGestao.vue';
import ErrosFormulario from './ErrosFormulario.vue';

const props = defineProps<{ comissao: ComissaoTela; agora: string }>();
const emit = defineEmits<{ gravado: []; cancelar: [] }>();
const { t } = useI18n();

const f = reactive({
  tipo: 'ordinaria',
  data: props.agora.slice(0, 10) as string | null,
  hora: props.agora.slice(11, 16) as string | null,
  pauta: '',
  ata: '',
  presentes: [] as number[],
  convidados: '',
  deliberacoes: '',
});
const opTipo = TIPOS_REUNIAO_COMISSAO.map((x) => ({ valor: x.codigo as string, rotulo: x.rotulo }));
const quorum = computed(() => previaQuorum(props.comissao.membros.length, f.presentes.length));
const erros = ref<Record<string, string>>({});
const erro = ref<unknown>(null);
const gravando = ref(false);
let chave = novaChaveGestao('reuniao');
async function gravar(): Promise<void> {
  erro.value = null;
  const m = montarReuniao(f, props.comissao);
  if (!m.ok) {
    erros.value = { ...m.erros };
    return;
  }
  erros.value = {};
  gravando.value = true;
  try {
    await registrarReuniao(props.comissao.id, m.entrada, chave);
    chave = novaChaveGestao('reuniao');
    emit('gravado');
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
</script>

<template>
  <form class="painel-ccih" data-testid="form-reuniao" @submit.prevent="gravar">
    <h3>{{ t('gestaoQualidade.comissoes.reuniao.titulo', { nome: comissao.nome }) }}</h3>
    <div class="linha-ccih">
      <SanteSelecao
        v-model="f.tipo"
        :rotulo="t('gestaoQualidade.comissoes.reuniao.tipo')"
        :opcoes="opTipo"
        data-testid="reu-tipo"
      />
      <SanteData v-model="f.data" :rotulo="t('gestaoQualidade.data')" editavel data-testid="reu-data" />
      <SanteHora v-model="f.hora" :rotulo="t('gestaoQualidade.hora')" editavel data-testid="reu-hora" />
    </div>
    <SanteCampoTexto
      v-model="f.pauta"
      :rotulo="t('gestaoQualidade.comissoes.pauta')"
      :max-bytes="2000"
      multilinha
      obrigatorio
      data-testid="reu-pauta"
    />
    <fieldset class="painel-ccih">
      <legend>{{ t('gestaoQualidade.comissoes.reuniao.presenca') }}</legend>
      <label v-for="(m, k) in comissao.membros" :key="k" class="marcar-gestao"
        ><input v-model="f.presentes" type="checkbox" :value="k" :data-testid="`reu-presente-${k}`" />
        {{ m.nome }} ({{ m.funcao }})</label
      >
      <p :class="quorum.quorum ? 'prazo prazo--cumprido' : 'prazo prazo--vencido'" data-testid="reu-quorum">
        {{ t('gestaoQualidade.comissoes.reuniao.previa', { conta: quorum.conta }) }}:
        {{ quorum.quorum ? t('gestaoQualidade.comissoes.quorum') : t('gestaoQualidade.comissoes.semQuorum') }}
      </p>
    </fieldset>
    <SanteCampoTexto
      v-model="f.ata"
      :rotulo="t('gestaoQualidade.comissoes.ata')"
      :max-bytes="8000"
      multilinha
      obrigatorio
      data-testid="reu-ata"
    />
    <SanteCampoTexto
      v-model="f.convidados"
      :rotulo="t('gestaoQualidade.comissoes.convidados')"
      :max-bytes="400"
      data-testid="reu-convidados"
    />
    <SanteCampoTexto
      v-model="f.deliberacoes"
      :rotulo="t('gestaoQualidade.comissoes.deliberacoes')"
      :max-bytes="2000"
      multilinha
      data-testid="reu-deliberacoes"
    />
    <ErrosFormulario :erros="erros" />
    <ErroGestao v-if="erro" :erro="erro" />
    <div class="linha-ccih">
      <SanteBotao
        tipo="submit"
        :rotulo="t('gestaoQualidade.gravar')"
        :desabilitado="gravando"
        data-testid="reu-gravar"
      />
      <SanteBotao :rotulo="t('gestaoQualidade.cancelar')" variante="texto" @acionar="emit('cancelar')" />
    </div>
  </form>
</template>
