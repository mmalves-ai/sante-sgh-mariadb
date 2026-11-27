<script setup lang="ts">
// O risco na matriz GUT (inclusão ou reavaliação com a versão lida): os três eixos de 1 a 5 com o texto de cada grau
// da escala da qualidade, a pontuação G × U × T e a prioridade com a conta, os controles, a situação e a reavaliação;
// o aceito e o encerrado levam a justificativa. C2-060: os controles estruturados (catálogo do hospital, tipo e
// eficácia) com a eficácia do conjunto calculada enquanto se preenche.
import {
  CATEGORIAS_RISCO,
  EFICACIAS_CONTROLE_RISCO,
  ESCALA_GUT,
  type EixoGut,
  rotuloEficaciaControleRisco,
  rotuloPrioridadeRisco,
  SITUACOES_RISCO,
  TIPOS_CONTROLE_RISCO,
} from '@sgh/contratos';
import { SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { novaChaveGestao, registrarRisco, type RiscoTela } from '../api-gestao.js';
import {
  classeDaPrioridade,
  formularioDoRisco,
  montarRisco,
  novoControleRisco,
  previaEficaciaControles,
  previaGut,
} from '../regras-gestao.js';
import ErroGestao from './ErroGestao.vue';
import ErrosFormulario from './ErrosFormulario.vue';

const props = defineProps<{ risco: RiscoTela | null }>();
const emit = defineEmits<{ gravado: [id: number]; cancelar: [] }>();
const { t } = useI18n();

const f = reactive(formularioDoRisco(props.risco));
const eixos: EixoGut[] = ['gravidade', 'urgencia', 'tendencia'];
const opEixo = (e: EixoGut) => [
  { valor: 0, rotulo: '' },
  ...ESCALA_GUT[e].map((texto, k) => ({ valor: k + 1, rotulo: `${k + 1}: ${texto}` })),
];
const opCategoria = [
  { valor: '', rotulo: '' },
  ...CATEGORIAS_RISCO.map((x) => ({ valor: x.codigo as string, rotulo: x.rotulo })),
];
const opSituacao = SITUACOES_RISCO.map((x) => ({ valor: x.codigo as string, rotulo: x.rotulo }));
const previa = computed(() => previaGut(f.gravidade, f.urgencia, f.tendencia));
const opTipoControle = TIPOS_CONTROLE_RISCO.map((x) => ({ valor: x.codigo as string, rotulo: x.rotulo }));
const opEficaciaControle = EFICACIAS_CONTROLE_RISCO.map((x) => ({
  valor: x.codigo as string,
  rotulo: x.rotulo,
}));
const conjunto = computed(() => {
  const e = previaEficaciaControles(f.controlesLista);
  return e === 'semControle'
    ? t('gestaoQualidade.riscos.form.semControle')
    : t('gestaoQualidade.riscos.form.controlesConjunto', { eficacia: rotuloEficaciaControleRisco(e) });
});

const erros = ref<Record<string, string>>({});
const erro = ref<unknown>(null);
const gravando = ref(false);
let chave = novaChaveGestao('risco');
async function gravar(): Promise<void> {
  erro.value = null;
  const m = montarRisco(f, props.risco);
  if (!m.ok) {
    erros.value = { ...m.erros };
    return;
  }
  erros.value = {};
  gravando.value = true;
  try {
    const r = await registrarRisco(m.entrada, chave);
    chave = novaChaveGestao('risco');
    emit('gravado', r.id);
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
</script>

<template>
  <form class="painel-ccih" data-testid="form-risco" novalidate @submit.prevent="gravar">
    <!-- novalidate: a conferência é a do montarRisco, que diz na hora o que falta (o "obrigatório" nativo do nome do
         controle barrava o envio sem mensagem; achado pelo E2E c2-060-controles-risco). -->
    <h2>
      {{
        risco
          ? t('gestaoQualidade.riscos.form.tituloReavaliar', { titulo: risco.titulo })
          : t('gestaoQualidade.riscos.form.tituloNovo')
      }}
    </h2>
    <SanteCampoTexto
      v-model="f.titulo"
      :rotulo="t('gestaoQualidade.riscos.form.titulo')"
      :max-bytes="200"
      obrigatorio
      data-testid="risco-titulo"
    />
    <SanteCampoTexto
      v-model="f.descricao"
      :rotulo="t('gestaoQualidade.riscos.form.descricao')"
      :max-bytes="2000"
      multilinha
      obrigatorio
      data-testid="risco-descricao"
    />
    <div class="linha-ccih">
      <SanteCampoTexto
        v-model="f.area"
        :rotulo="t('gestaoQualidade.area')"
        :max-bytes="80"
        obrigatorio
        data-testid="risco-area"
      />
      <SanteSelecao
        v-model="f.categoria"
        :rotulo="t('gestaoQualidade.riscos.form.categoria')"
        :opcoes="opCategoria"
        obrigatorio
        data-testid="risco-categoria"
      />
    </div>
    <div class="linha-ccih">
      <SanteSelecao
        v-for="e in eixos"
        :key="e"
        v-model="f[e]"
        :rotulo="t(`gestaoQualidade.riscos.form.${e}`)"
        :opcoes="opEixo(e)"
        obrigatorio
        :data-testid="`risco-${e}`"
      />
    </div>
    <p v-if="previa" :class="classeDaPrioridade(previa.prioridade)" data-testid="risco-previa">
      {{
        t('gestaoQualidade.riscos.form.previa', {
          conta: previa.conta,
          prioridade: rotuloPrioridadeRisco(previa.prioridade),
        })
      }}
    </p>
    <p v-else class="secundario">{{ t('gestaoQualidade.riscos.form.semPrevia') }}</p>
    <SanteCampoTexto
      v-model="f.controles"
      :rotulo="t('gestaoQualidade.riscos.form.controles')"
      :max-bytes="2000"
      multilinha
      data-testid="risco-controles"
    />
    <fieldset class="painel-ccih" data-testid="risco-controles-lista">
      <legend>{{ t('gestaoQualidade.riscos.form.controlesLista') }}</legend>
      <p class="secundario">{{ t('gestaoQualidade.riscos.form.controlesAjuda') }}</p>
      <div
        v-for="(c, i) in f.controlesLista"
        :key="i"
        class="linha-ccih"
        :data-testid="`risco-controle-${i}`"
      >
        <SanteCampoTexto
          v-model="c.nome"
          :rotulo="t('gestaoQualidade.riscos.form.controleNome')"
          :max-bytes="150"
          obrigatorio
          :data-testid="`risco-controle-nome-${i}`"
        />
        <SanteSelecao
          v-model="c.tipo"
          :rotulo="t('gestaoQualidade.riscos.form.controleTipo')"
          :opcoes="opTipoControle"
          :data-testid="`risco-controle-tipo-${i}`"
        />
        <SanteSelecao
          v-model="c.eficacia"
          :rotulo="t('gestaoQualidade.riscos.form.controleEficacia')"
          :opcoes="opEficaciaControle"
          :data-testid="`risco-controle-eficacia-${i}`"
        />
        <SanteBotao
          :rotulo="t('gestaoQualidade.riscos.form.controleRetirar')"
          variante="texto"
          :data-testid="`risco-controle-retirar-${i}`"
          @acionar="f.controlesLista.splice(i, 1)"
        />
      </div>
      <p class="secundario" data-testid="risco-controles-conjunto">{{ conjunto }}</p>
      <SanteBotao
        :rotulo="t('gestaoQualidade.riscos.form.controleAdicionar')"
        variante="texto"
        :desabilitado="f.controlesLista.length >= 20"
        data-testid="risco-controle-adicionar"
        @acionar="f.controlesLista.push(novoControleRisco())"
      />
    </fieldset>
    <div class="linha-ccih">
      <SanteCampoTexto
        v-model="f.responsavel"
        :rotulo="t('gestaoQualidade.riscos.form.responsavel')"
        :max-bytes="80"
        obrigatorio
        data-testid="risco-responsavel"
      />
      <SanteSelecao
        v-model="f.situacao"
        :rotulo="t('gestaoQualidade.riscos.form.situacao')"
        :opcoes="opSituacao"
        data-testid="risco-situacao"
      />
      <SanteData
        v-model="f.reavaliarEm"
        :rotulo="t('gestaoQualidade.riscos.form.reavaliarEm')"
        editavel
        data-testid="risco-reavaliar"
      />
    </div>
    <SanteCampoTexto
      v-if="f.situacao === 'aceito' || f.situacao === 'encerrado'"
      v-model="f.justificativa"
      :rotulo="t('gestaoQualidade.riscos.form.justificativa')"
      :max-bytes="1000"
      multilinha
      obrigatorio
      data-testid="risco-justificativa"
    />
    <ErrosFormulario :erros="erros" />
    <ErroGestao v-if="erro" :erro="erro" />
    <div class="linha-ccih">
      <SanteBotao
        tipo="submit"
        :rotulo="t('gestaoQualidade.gravar')"
        :desabilitado="gravando"
        data-testid="risco-gravar"
      />
      <SanteBotao :rotulo="t('gestaoQualidade.cancelar')" variante="texto" @acionar="emit('cancelar')" />
    </div>
  </form>
</template>
