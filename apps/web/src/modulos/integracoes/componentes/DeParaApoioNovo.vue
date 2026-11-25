<script setup lang="ts">
// Inclusão do de-para de analito e de material do laboratório de apoio (F3.5, 05-SADT linha 14). Desenho próprio: a
// tela só oferece o que ainda não tem de-para (o exame já ligado ao apoio, o analito que recebe valor, o material
// ativo), traz o código do exame no apoio já preenchido e diz na hora o que impede gravar, pela mesma regra do
// servidor (@sgh/dominio-sadt). Nada de digitar identificador: tudo por combo do tema.
import { pendenciasDeParaAnalito, pendenciasDeParaMaterial } from '@sgh/dominio-sadt';
import { SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import MensagemErro from '../../../casca/MensagemErro.vue';
import {
  lerOpcoesDeParaApoio,
  salvarDeParaAnalitoApoio,
  salvarDeParaMaterialApoio,
} from '../api-apoio-remessa.js';

const props = defineProps<{ laboratorio: number }>();
const cliente = useQueryClient();
const opcoes = useQuery({
  queryKey: computed(() => ['sadt', 'apoio', 'de-para-opcoes', props.laboratorio]),
  queryFn: () => lerOpcoesDeParaApoio(props.laboratorio),
});
const exame = ref<number | null>(null);
const analito = ref<number | null>(null);
const codigoExame = ref('');
const codigoAnalito = ref('');
const fator = ref('1');
const material = ref<number | null>(null);
const codigoMaterial = ref('');
const erro = ref<unknown>(null);
const feito = ref<string | null>(null);

// Só o exame que ainda tem analito sem de-para; só o analito e o material que ainda não têm.
const examesLivres = computed(() =>
  (opcoes.data.value?.exames ?? []).filter((e) => e.analitos.some((a) => !a.comDePara)),
);
const opcoesExame = computed(() => examesLivres.value.map((e) => ({ valor: e.exame, rotulo: e.nome })));
const opcoesAnalito = computed(() =>
  (examesLivres.value.find((e) => e.exame === exame.value)?.analitos ?? [])
    .filter((a) => !a.comDePara)
    .map((a) => ({ valor: a.analito, rotulo: a.nome })),
);
const opcoesMaterial = computed(() =>
  (opcoes.data.value?.materiais ?? [])
    .filter((m) => !m.comDePara)
    .map((m) => ({ valor: m.material, rotulo: m.nome })),
);
// Escolhido o exame, o código dele no apoio já vem do catálogo do apoio; com um analito só, ele já fica escolhido.
watch(exame, (id) => {
  const e = examesLivres.value.find((x) => x.exame === id);
  codigoExame.value = e?.codigoExameApoio ?? '';
  const livres = (e?.analitos ?? []).filter((a) => !a.comDePara);
  analito.value = livres.length === 1 ? livres[0]!.analito : null;
});
watch(
  () => props.laboratorio,
  () => {
    exame.value = null;
    material.value = null;
    codigoAnalito.value = '';
    codigoMaterial.value = '';
    feito.value = null;
    erro.value = null;
  },
);
const fatorNumero = computed(() => Number(fator.value.trim().replace(',', '.')));
const tocouAnalito = computed(() => exame.value !== null || codigoAnalito.value.trim() !== '');
const pendenciasAnalito = computed(() =>
  pendenciasDeParaAnalito({
    exame: exame.value,
    analito: analito.value,
    codigoExameApoio: codigoExame.value,
    codigoAnalitoApoio: codigoAnalito.value,
    fatorConversao: fatorNumero.value,
  }),
);
const tocouMaterial = computed(() => material.value !== null || codigoMaterial.value.trim() !== '');
const pendenciasMaterial = computed(() =>
  pendenciasDeParaMaterial({ material: material.value, codigoApoio: codigoMaterial.value }),
);

async function gravar(fn: () => Promise<unknown>, mensagem: string, limpar: () => void): Promise<void> {
  erro.value = null;
  feito.value = null;
  try {
    await fn();
    feito.value = mensagem;
    limpar();
    await cliente.invalidateQueries({ queryKey: ['sadt', 'apoio'] });
  } catch (e) {
    erro.value = e;
  }
}
const incluirAnalito = () =>
  gravar(
    () =>
      salvarDeParaAnalitoApoio({
        laboratorio: props.laboratorio,
        exame: exame.value,
        analito: analito.value,
        codigoExameApoio: codigoExame.value.trim(),
        codigoAnalitoApoio: codigoAnalito.value.trim(),
        fatorConversao: fatorNumero.value,
      }),
    T.s9,
    () => {
      exame.value = null;
      codigoAnalito.value = '';
      fator.value = '1';
    },
  );
const incluirMaterial = () =>
  gravar(
    () =>
      salvarDeParaMaterialApoio({
        laboratorio: props.laboratorio,
        material: material.value,
        codigoApoio: codigoMaterial.value.trim(),
      }),
    T.s10,
    () => {
      material.value = null;
      codigoMaterial.value = '';
    },
  );
/** Textos da tela (pt-BR). */
const T = {
  s1: 'Incluir de-para de analito',
  s2: 'Exame',
  s3: 'Analito',
  s4: 'Código do exame no apoio',
  s5: 'Código do analito no apoio',
  s6: 'Fator de conversão',
  s7: 'Incluir analito',
  s8: 'Incluir material',
  s9: 'De-para de analito incluído.',
  s10: 'De-para de material incluído.',
  s11: 'Incluir de-para de material',
  s12: 'Material',
  s13: 'Código do material no apoio',
  s14: 'Todos os analitos dos exames deste apoio já têm de-para.',
  s15: 'Todos os materiais ativos já têm de-para.',
} as const;
</script>

<template>
  <div data-testid="de-para-novo">
    <p v-if="feito" role="status" data-testid="de-para-novo-feito">{{ feito }}</p>
    <MensagemErro v-if="erro" :erro="erro" />
    <MensagemErro v-if="opcoes.isError.value" :erro="opcoes.error.value" />
    <form class="formulario" :aria-label="T.s1" @submit.prevent="incluirAnalito">
      <h4>{{ T.s1 }}</h4>
      <p v-if="opcoes.data.value && opcoesExame.length === 0" class="secundario">{{ T.s14 }}</p>
      <template v-else>
        <SanteSelecao v-model="exame" :rotulo="T.s2" :opcoes="opcoesExame" data-testid="de-para-exame" />
        <SanteSelecao
          v-model="analito"
          :rotulo="T.s3"
          :opcoes="opcoesAnalito"
          :desabilitado="exame === null"
          data-testid="de-para-analito"
        />
        <SanteCampoTexto
          v-model="codigoExame"
          :rotulo="T.s4"
          :max-bytes="30"
          data-testid="de-para-codigo-exame"
        />
        <SanteCampoTexto
          v-model="codigoAnalito"
          :rotulo="T.s5"
          :max-bytes="30"
          data-testid="de-para-codigo-analito"
        />
        <SanteCampoTexto v-model="fator" :rotulo="T.s6" :max-bytes="12" data-testid="de-para-fator" />
        <p
          v-if="tocouAnalito && pendenciasAnalito.length"
          role="alert"
          data-testid="de-para-analito-problema"
        >
          {{ pendenciasAnalito[0] }}
        </p>
        <SanteBotao
          tipo="submit"
          :rotulo="T.s7"
          :desabilitado="pendenciasAnalito.length > 0"
          data-testid="de-para-analito-incluir"
        />
      </template>
    </form>
    <form class="formulario" :aria-label="T.s11" @submit.prevent="incluirMaterial">
      <h4>{{ T.s11 }}</h4>
      <p v-if="opcoes.data.value && opcoesMaterial.length === 0" class="secundario">{{ T.s15 }}</p>
      <template v-else>
        <SanteSelecao
          v-model="material"
          :rotulo="T.s12"
          :opcoes="opcoesMaterial"
          data-testid="de-para-material"
        />
        <SanteCampoTexto
          v-model="codigoMaterial"
          :rotulo="T.s13"
          :max-bytes="30"
          data-testid="de-para-codigo-material"
        />
        <p
          v-if="tocouMaterial && pendenciasMaterial.length"
          role="alert"
          data-testid="de-para-material-problema"
        >
          {{ pendenciasMaterial[0] }}
        </p>
        <SanteBotao
          tipo="submit"
          :rotulo="T.s8"
          :desabilitado="pendenciasMaterial.length > 0"
          data-testid="de-para-material-incluir"
        />
      </template>
    </form>
  </div>
</template>
