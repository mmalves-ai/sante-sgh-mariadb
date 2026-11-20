<script setup lang="ts">
// Definir a precaução de um internado (regra 7): o motivo sugere o tipo (a CCIH pode trocar); aerossóis em quarto com
// outros leitos exige bloquear os vizinhos e o multirresistente ou gotículas recomenda; a precaução da microbiologia
// exige a cultura do paciente. Ao gravar, o leito aparece no mapa (M21); os vizinhos ocupados voltam como alerta.
import './estilo-ccih.css';
import {
  type MotivoPrecaucao,
  MOTIVOS_PRECAUCAO,
  type Precaucao,
  PRECAUCOES,
  tipoSugeridoDaPrecaucao,
} from '@sgh/contratos';
import { bloqueioDoVizinho } from '@sgh/dominio-qualidade';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteOpcoes, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { dataHora } from '../../regras-qualidade.js';
import { definirPrecaucao, lerInternacaoCcih, novaChaveCcih, type PrecaucaoDefinida } from '../api-ccih.js';
import { type FormularioPrecaucao, montarPrecaucao, type ProblemaPrecaucao } from '../regras-ccih.js';
import { RECUSAS_CCIH } from '../i18n-ccih.js';
import ErroCcih from './ErroCcih.vue';

const props = defineProps<{ internacao: number }>();
const emit = defineEmits<{ gravado: [r: PrecaucaoDefinida]; cancelar: [] }>();
const { t } = useI18n();

const detalhe = useQuery({
  queryKey: computed(() => ['ccih', 'internacao', props.internacao]),
  queryFn: () => lerInternacaoCcih(props.internacao),
});
const vazio = (internacao: number): FormularioPrecaucao => ({
  internacao,
  motivo: '',
  motivoOutro: '',
  tipo: '',
  origem: 'manual',
  exame: null,
  bloquearVizinhos: false,
  observacao: '',
});
const f = reactive(vazio(props.internacao));
watch(
  () => props.internacao,
  (r) => Object.assign(f, vazio(r)),
);
const outrosLeitos = computed(() => detalhe.data.value?.vizinhos.length ?? 0);
// O motivo sugere o tipo; o bloqueio exigido ou sugerido já vem marcado.
watch(
  () => f.motivo,
  (m) => {
    if (!m) return;
    f.tipo = tipoSugeridoDaPrecaucao(m);
    f.bloquearVizinhos = bloqueioDoVizinho(f.tipo, m, outrosLeitos.value) !== 'naoSeAplica';
  },
);
const bloqueio = computed(() =>
  f.motivo && f.tipo ? bloqueioDoVizinho(f.tipo, f.motivo, outrosLeitos.value) : 'naoSeAplica',
);

const opMotivo = [
  { valor: '' as MotivoPrecaucao | '', rotulo: '' },
  ...MOTIVOS_PRECAUCAO.map((m) => ({ valor: m.codigo as MotivoPrecaucao | '', rotulo: m.rotulo })),
];
const opTipo = PRECAUCOES.map((p) => ({ valor: p.codigo as Precaucao | '', rotulo: p.rotulo }));
const opOrigem = computed(() => [
  { valor: 'manual' as const, rotulo: t('ccih.precaucoes.origens.manual') },
  { valor: 'microbiologia' as const, rotulo: t('ccih.precaucoes.origens.microbiologia') },
]);
const opExame = computed(() => [
  { valor: null as number | null, rotulo: '' },
  ...(detalhe.data.value?.culturas ?? []).map((c) => ({
    valor: c.id as number | null,
    rotulo: `${c.exame} · ${dataHora(c.data)}`,
  })),
]);
const textoVizinhos = computed(() =>
  (detalhe.data.value?.vizinhos ?? [])
    .map((v) => `${v.leito} (${v.ocupado ? t('ccih.ficha.ocupado') : t('ccih.ficha.livre')})`)
    .join(', '),
);

const problema = ref<ProblemaPrecaucao | null>(null);
const erro = ref<unknown>(null);
const gravando = ref(false);
const chave = ref(novaChaveCcih('precaucao'));
const textoProblema = computed(() => {
  const p = problema.value;
  if (!p) return null;
  return p === 'bloqueio-vizinho-exigido' ? RECUSAS_CCIH[p] : t(`ccih.precaucoes.problemas.${p}`);
});

async function gravar(): Promise<void> {
  erro.value = null;
  const m = montarPrecaucao(f, outrosLeitos.value);
  problema.value = m.problema;
  if (!m.entrada) return;
  gravando.value = true;
  try {
    const r = await definirPrecaucao(m.entrada, chave.value);
    chave.value = novaChaveCcih('precaucao');
    emit('gravado', r);
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
</script>

<template>
  <form class="painel-ccih" data-testid="formulario-precaucao" @submit.prevent>
    <h3>{{ t('ccih.precaucoes.nova') }}</h3>
    <p v-if="detalhe.data.value" class="secundario">
      {{ detalhe.data.value.internacao.nome }} · {{ detalhe.data.value.internacao.leito }}
    </p>
    <div class="linha-ccih">
      <SanteSelecao
        v-model="f.motivo"
        :rotulo="t('ccih.precaucoes.motivo')"
        :opcoes="opMotivo"
        busca
        obrigatorio
        data-testid="precaucao-motivo"
      />
      <SanteCampoTexto
        v-if="f.motivo === 'outro'"
        v-model="f.motivoOutro"
        :rotulo="t('ccih.precaucoes.motivoOutro')"
        :max-bytes="60"
        obrigatorio
      />
    </div>
    <SanteOpcoes
      v-model="f.tipo"
      :legenda="t('ccih.precaucoes.tipo')"
      :opcoes="opTipo"
      nome="precaucao-tipo"
    />
    <SanteOpcoes
      v-model="f.origem"
      :legenda="t('ccih.precaucoes.origem')"
      :opcoes="opOrigem"
      nome="precaucao-origem"
    />
    <SanteSelecao
      v-if="f.origem === 'microbiologia'"
      v-model="f.exame"
      :rotulo="t('ccih.precaucoes.exame')"
      :opcoes="opExame"
      busca
      obrigatorio
      data-testid="precaucao-exame"
    />
    <template v-if="outrosLeitos > 0">
      <p class="secundario">{{ t('ccih.ficha.vizinhos') }}: {{ textoVizinhos }}</p>
      <label
        ><input v-model="f.bloquearVizinhos" type="checkbox" data-testid="precaucao-bloquear" />
        {{ t('ccih.precaucoes.bloquearVizinhos') }}</label
      >
      <SanteAlerta
        v-if="bloqueio === 'exigido'"
        variante="aviso"
        :texto="t('ccih.precaucoes.bloqueioExigido')"
      />
      <SanteAlerta
        v-else-if="bloqueio === 'sugerido'"
        variante="info"
        :texto="t('ccih.precaucoes.bloqueioSugerido')"
      />
    </template>
    <SanteCampoTexto v-model="f.observacao" :rotulo="t('ccih.observacao')" :max-bytes="200" />
    <div v-if="textoProblema" role="alert" data-testid="precaucao-problema">
      <SanteAlerta variante="aviso" :texto="textoProblema" />
    </div>
    <ErroCcih v-if="erro" :erro="erro" />
    <p class="linha-ccih">
      <SanteBotao
        :rotulo="t('ccih.gravar')"
        variante="primario"
        :desabilitado="gravando"
        data-testid="precaucao-gravar"
        @acionar="gravar"
      />
      <SanteBotao :rotulo="t('ccih.cancelar')" variante="texto" @acionar="emit('cancelar')" />
    </p>
  </form>
</template>
