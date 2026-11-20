<script setup lang="ts">
// A ficha de IRAS de um internado (regra 5; Anvisa, critérios diagnósticos): o sítio mostra só os critérios dele e diz
// quando os marcados fecham o diagnóstico; a ISC pede a cirurgia (das do paciente) e a profundidade; a cultura ligada
// vem das culturas do paciente. O servidor confere de novo (3º dia, janela da ISC, associação ao dispositivo).
import './estilo-ccih.css';
import {
  NIVEIS_ISC,
  rotuloCriterioIras,
  rotuloDispositivoInvasivo,
  type SitioIras,
  SITIOS_IRAS,
} from '@sgh/contratos';
import { conferirCriterios } from '@sgh/dominio-qualidade';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteMarcadores, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { dataHora } from '../../regras-qualidade.js';
import { lerInternacaoCcih, novaChaveCcih, registrarIras } from '../api-ccih.js';
import {
  criteriosDoSitio,
  dispositivoDoSitio,
  formularioIrasVazio,
  montarIras,
  type ProblemaIras,
} from '../regras-ccih.js';
import { RECUSAS_CCIH } from '../i18n-ccih.js';
import ErroCcih from './ErroCcih.vue';

const props = defineProps<{ internacao: number }>();
const emit = defineEmits<{ gravado: [id: number]; cancelar: [] }>();
const { t } = useI18n();

const detalhe = useQuery({
  queryKey: computed(() => ['ccih', 'internacao', props.internacao]),
  queryFn: () => lerInternacaoCcih(props.internacao),
});
const f = reactive(formularioIrasVazio(props.internacao));
watch(
  () => props.internacao,
  (r) => Object.assign(f, formularioIrasVazio(r)),
);
// Trocar o sítio limpa os critérios que não são dele.
watch(
  () => f.sitio,
  (s) => {
    if (s) f.criterios = f.criterios.filter((c) => criteriosDoSitio(s).includes(c));
  },
);

const opSitio = [
  { valor: '' as SitioIras | '', rotulo: '' },
  ...SITIOS_IRAS.map((s) => ({ valor: s.codigo as SitioIras | '', rotulo: s.rotulo })),
];
const opCriterios = computed(() =>
  f.sitio ? criteriosDoSitio(f.sitio).map((c) => ({ valor: c, rotulo: rotuloCriterioIras(c) })) : [],
);
const opNivel = [
  { valor: '', rotulo: '' },
  ...NIVEIS_ISC.map((n) => ({ valor: n.codigo as string, rotulo: n.rotulo })),
];
const opCirurgia = computed(() => [
  { valor: null as number | null, rotulo: '' },
  ...(detalhe.data.value?.cirurgias ?? []).map((c) => ({
    valor: c.id as number | null,
    rotulo: t('ccih.ficha.cirurgia', { data: dataHora(c.data) }),
  })),
]);
const opExame = computed(() => [
  { valor: null as number | null, rotulo: t('ccih.iras.semExame') },
  ...(detalhe.data.value?.culturas ?? []).map((c) => ({
    valor: c.id as number | null,
    rotulo: `${c.exame} · ${dataHora(c.data)}`,
  })),
]);
const fecha = computed(() => !!f.sitio && conferirCriterios(f.sitio, f.criterios) === null);
const dispositivo = computed(() => (f.sitio ? dispositivoDoSitio(f.sitio) : null));

const problema = ref<ProblemaIras | null>(null);
const erro = ref<unknown>(null);
const gravando = ref(false);
const chave = ref(novaChaveCcih('iras'));
const textoProblema = computed(() => {
  const p = problema.value;
  if (!p) return null;
  if (p === 'criterio-de-outro-sitio' || p === 'criterios-insuficientes') return RECUSAS_CCIH[p];
  return t(`ccih.iras.problemas.${p}`);
});

async function gravar(): Promise<void> {
  erro.value = null;
  const m = montarIras(f);
  problema.value = m.problema;
  if (!m.entrada) return;
  gravando.value = true;
  try {
    const r = await registrarIras(m.entrada, chave.value);
    chave.value = novaChaveCcih('iras');
    emit('gravado', r.id);
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
</script>

<template>
  <form class="painel-ccih" data-testid="formulario-iras" @submit.prevent>
    <h3>{{ t('ccih.iras.formulario') }}</h3>
    <p v-if="detalhe.data.value" class="secundario">
      {{ detalhe.data.value.internacao.nome }} · {{ detalhe.data.value.internacao.leito }}
    </p>
    <div class="linha-ccih">
      <SanteSelecao
        v-model="f.sitio"
        :rotulo="t('ccih.iras.sitio')"
        :opcoes="opSitio"
        obrigatorio
        data-testid="iras-sitio"
      />
      <SanteData
        v-model="f.dataInfeccao"
        :rotulo="t('ccih.iras.dataInfeccao')"
        editavel
        data-testid="iras-data"
      />
    </div>
    <template v-if="f.sitio">
      <SanteMarcadores
        v-model="f.criterios"
        :legenda="t('ccih.iras.criterios')"
        :opcoes="opCriterios"
        data-testid="iras-criterios"
      />
      <p v-if="fecha" role="status" class="secundario" data-testid="iras-fecha">
        {{ t('ccih.iras.criteriosFecham') }}
      </p>
      <p v-if="dispositivo" class="secundario">
        {{ t('ccih.iras.associacao', { dispositivo: rotuloDispositivoInvasivo(dispositivo as never) }) }}
      </p>
      <div v-if="f.sitio === 'isc'" class="linha-ccih">
        <SanteSelecao
          v-model="f.cirurgia"
          :rotulo="t('ccih.iras.cirurgia')"
          :opcoes="opCirurgia"
          obrigatorio
          data-testid="iras-cirurgia"
        />
        <SanteSelecao v-model="f.nivelIsc" :rotulo="t('ccih.iras.nivelIsc')" :opcoes="opNivel" obrigatorio />
        <label
          ><input v-model="f.implante" type="checkbox" data-testid="iras-implante" />
          {{ t('ccih.iras.implante') }}</label
        >
      </div>
      <div class="linha-ccih">
        <SanteSelecao
          v-model="f.exame"
          :rotulo="t('ccih.iras.exame')"
          :opcoes="opExame"
          busca
          data-testid="iras-exame"
        />
        <SanteCampoTexto v-model="f.microrganismo" :rotulo="t('ccih.iras.microrganismo')" :max-bytes="80" />
        <label
          ><input v-model="f.multirresistente" type="checkbox" data-testid="iras-mr" />
          {{ t('ccih.iras.multirresistente') }}</label
        >
      </div>
      <SanteCampoTexto
        v-model="f.descricao"
        :rotulo="t('ccih.iras.descricao')"
        :max-bytes="1000"
        multilinha
        :obrigatorio="f.sitio === 'outra'"
      />
    </template>
    <div v-if="textoProblema" role="alert" data-testid="iras-problema">
      <SanteAlerta variante="aviso" :texto="textoProblema" />
    </div>
    <ErroCcih v-if="erro" :erro="erro" />
    <p class="linha-ccih">
      <SanteBotao
        :rotulo="t('ccih.gravar')"
        variante="primario"
        :desabilitado="gravando"
        data-testid="iras-gravar"
        @acionar="gravar"
      />
      <SanteBotao :rotulo="t('ccih.cancelar')" variante="texto" @acionar="emit('cancelar')" />
    </p>
  </form>
</template>
