<script setup lang="ts">
// Aba "Parâmetros do empregador" (M53.6; DP-47: o leiaute é parâmetro): as vigências dos dados dos eventos de tabela
// (transmissor, leiaute, classificação tributária, CNAE, RAT/FAP, lotação, FPAS, terceiros, tabela de rubricas,
// sindicato e o de-para dos motivos de afastamento), da mais nova para a mais antiga, e as versões do leiaute no catálogo
// oficial. A correção é uma vigência nova (com `pessoas.esocial.gerar`); o servidor recusa dois transmissores na mesma
// raiz de CNPJ (regra 1).
import { type ApoioEsocial, type EmpregadorEsocialLido, esquemaEmpregadorEsocial } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteDialogo, SanteOpcoes, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { dataBr } from '../../pessoas/comum.js';
import { competenciasAte, instanteBr, rotuloCompetencia } from '../comum-folha.js';
import ErroFolha from '../telas/ErroFolha.vue';
import { lerEmpregadores, registrarEmpregador } from './api-esocial.js';
import {
  entradaDoEmpregador,
  type FormEmpregador,
  formDoEmpregador,
  textoFap,
  vigenciaEm,
} from './comum-esocial.js';

const props = defineProps<{ apoio: ApoioEsocial; empresa: number }>();
const { t, te } = useI18n();
const cliente = useQueryClient();
const q = useQuery({
  queryKey: computed(() => ['folha', 'esocial', 'empregadores', props.empresa]),
  queryFn: () => lerEmpregadores(props.empresa),
});
const vigencias = computed<readonly EmpregadorEsocialLido[]>(() =>
  [...(q.data.value ?? [])].sort((a, b) => b.inicio.localeCompare(a.inicio)),
);
const hojeComp = props.apoio.hoje.slice(0, 7);
const pode = computed(() => props.apoio.acoes.gerar);

const aberto = ref(false);
const f = ref<FormEmpregador>(formDoEmpregador(null, props.apoio.leiautes[0] ?? '', hojeComp));
const aviso = ref<string | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);
const tentou = ref(false);
function nova(): void {
  f.value = formDoEmpregador(vigenciaEm(vigencias.value, hojeComp), props.apoio.leiautes[0] ?? '', hojeComp);
  erro.value = null;
  aviso.value = null;
  tentou.value = false;
  aberto.value = true;
}
const opcoesInicio = [
  ...competenciasAte(`${Number(hojeComp.slice(0, 4)) + 1}-12-01`, 24 + 12).map((c) => ({
    valor: c,
    rotulo: rotuloCompetencia(c),
  })),
];
const opcoesTransmissor = computed(() =>
  (['sante', 'externo'] as const).map((x) => ({ valor: x, rotulo: t(`folha.esocial.transmissores.${x}`) })),
);
const opcoesLeiaute = computed(() => props.apoio.leiautes.map((l) => ({ valor: l, rotulo: l })));
const opcoesDesoneracao = computed(() =>
  [0, 1, 2].map((n) => ({ valor: n, rotulo: t(`folha.esocial.parametros.desoneracao.${n}`) })),
);
const opcoesSimNao = computed(() => [
  { valor: 0, rotulo: t('folha.esocial.parametros.nao') },
  { valor: 1, rotulo: t('folha.esocial.parametros.sim') },
]);
const opcoesRat = [1, 2, 3].map((n) => ({ valor: n, rotulo: `${n}%` }));
const opcoesCoop = computed(() => [
  { valor: null, rotulo: t('folha.esocial.parametros.nao') },
  ...[0, 1, 2, 3].map((n) => ({ valor: n, rotulo: String(n) })),
]);
const opcoesConstr = computed(() => [
  { valor: null, rotulo: t('folha.esocial.parametros.nao') },
  ...[0, 1].map((n) => ({ valor: n, rotulo: String(n) })),
]);
const entrada = computed(() =>
  esquemaEmpregadorEsocial.safeParse(entradaDoEmpregador(props.empresa, f.value)),
);
const camposInvalidos = computed(() =>
  entrada.value.success
    ? ''
    : [...new Set(entrada.value.error.issues.map((i) => String(i.path[0] ?? '')))]
        .map((c) => (c === 'motivosAfastamento' ? t('folha.esocial.parametros.motivos') : rotuloCampo(c)))
        .join(', '),
);
function rotuloCampo(c: string): string {
  const k = `folha.esocial.parametros.${c}`;
  return te(k) ? t(k) : c;
}
async function gravar(): Promise<void> {
  tentou.value = true;
  if (!entrada.value.success) return;
  erro.value = null;
  ocupado.value = true;
  try {
    const r = await registrarEmpregador(entrada.value.data);
    aberto.value = false;
    aviso.value = t('folha.esocial.parametros.gravada', { inicio: rotuloCompetencia(r.inicio) });
    await cliente.invalidateQueries({ queryKey: ['folha', 'esocial'] });
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
const motivo = (codigo: string) => f.value.motivos[codigo] ?? '';
function definirMotivo(codigo: string, v: string): void {
  f.value = { ...f.value, motivos: { ...f.value.motivos, [codigo]: v } };
}
</script>

<template>
  <section class="bloco" :aria-label="t('folha.esocial.parametros.titulo')" data-testid="esocial-parametros">
    <h2>{{ t('folha.esocial.parametros.titulo') }}</h2>
    <p class="secundario">{{ t('folha.esocial.parametros.ajuda') }}</p>
    <SanteAlerta
      v-if="aviso"
      :texto="aviso"
      variante="info"
      anunciar
      data-testid="esocial-parametros-aviso"
    />
    <ErroFolha v-if="erro && !aberto" :erro="erro" />
    <div v-if="pode" class="acoes">
      <SanteBotao
        :rotulo="t('folha.esocial.parametros.nova')"
        variante="secundario"
        data-testid="esocial-parametros-nova"
        @acionar="nova"
      />
    </div>
    <ErroFolha v-if="q.isError.value" :erro="q.error.value" />
    <p v-else-if="!q.data.value" role="status">{{ t('folha.esocial.carregando') }}</p>
    <p v-else-if="vigencias.length === 0" data-testid="esocial-parametros-vazio">
      {{ t('folha.esocial.parametros.nenhum') }}
    </p>
    <div
      v-else
      class="rolagem"
      tabindex="0"
      role="region"
      :aria-label="t('folha.esocial.parametros.vigencias')"
    >
      <table class="tabela">
        <thead>
          <tr>
            <th scope="col">{{ t('folha.esocial.parametros.inicio') }}</th>
            <th scope="col">{{ t('folha.esocial.parametros.transmissor') }}</th>
            <th scope="col">{{ t('folha.esocial.parametros.leiaute') }}</th>
            <th scope="col">{{ t('folha.esocial.parametros.classTrib') }}</th>
            <th scope="col">{{ t('folha.esocial.parametros.cnaePrep') }}</th>
            <th scope="col">
              {{ t('folha.esocial.parametros.aliqRat') }} · {{ t('folha.esocial.parametros.fap') }}
            </th>
            <th scope="col">{{ t('folha.esocial.parametros.codLotacao') }}</th>
            <th scope="col">{{ t('folha.esocial.registro') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="v in vigencias" :key="v.id" :data-testid="`esocial-vigencia-${v.inicio}`">
            <th scope="row">{{ rotuloCompetencia(v.inicio) }}</th>
            <td>{{ t(`folha.esocial.transmissores.${v.transmissor}`) }}</td>
            <td>{{ v.leiaute }}</td>
            <td>{{ v.classTrib }}</td>
            <td>{{ v.cnaePrep }}</td>
            <td>{{ v.aliqRat }}% · {{ textoFap(v.fap) }}</td>
            <td>{{ v.codLotacao }}</td>
            <td class="secundario">{{ v.criadoPor }} · {{ instanteBr(v.criadoEm) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <section
      v-if="apoio.leiauteCatalogo.length"
      class="bloco"
      :aria-label="t('folha.esocial.parametros.catalogo')"
      data-testid="esocial-leiaute-catalogo"
    >
      <h3>{{ t('folha.esocial.parametros.catalogo') }}</h3>
      <ul class="lista">
        <li v-for="x in apoio.leiauteCatalogo" :key="x.evento">
          {{
            t(
              x.nome
                ? 'folha.esocial.parametros.catalogoEventoNome'
                : 'folha.esocial.parametros.catalogoEvento',
              {
                evento: x.evento,
                nome: x.nome ?? '',
                versao: x.versao,
                inicio: dataBr(x.inicio),
              },
            )
          }}
        </li>
      </ul>
    </section>

    <SanteDialogo v-model:visivel="aberto" :titulo="t('folha.esocial.parametros.nova')" largura="48rem">
      <form data-testid="esocial-parametros-form" @submit.prevent="gravar">
        <ErroFolha v-if="erro" :erro="erro" />
        <div class="campos">
          <SanteSelecao
            v-model="f.inicio"
            :rotulo="t('folha.esocial.parametros.inicio')"
            :opcoes="opcoesInicio"
            busca
            data-testid="esocial-param-inicio"
          />
          <SanteSelecao
            v-model="f.leiaute"
            :rotulo="t('folha.esocial.parametros.leiaute')"
            :opcoes="opcoesLeiaute"
            data-testid="esocial-param-leiaute"
          />
        </div>
        <SanteOpcoes
          v-model="f.transmissor"
          :legenda="t('folha.esocial.parametros.transmissor')"
          :opcoes="opcoesTransmissor"
          data-testid="esocial-param-transmissor"
        />
        <div class="campos">
          <SanteCampoTexto
            v-model="f.classTrib"
            :rotulo="t('folha.esocial.parametros.classTrib')"
            :max-bytes="2"
            data-testid="esocial-param-classTrib"
          />
          <SanteCampoTexto
            v-model="f.cnaePrep"
            :rotulo="t('folha.esocial.parametros.cnaePrep')"
            :max-bytes="9"
            data-testid="esocial-param-cnae"
          />
          <SanteSelecao
            v-model="f.aliqRat"
            :rotulo="t('folha.esocial.parametros.aliqRat')"
            :opcoes="opcoesRat"
            data-testid="esocial-param-rat"
          />
          <SanteCampoTexto
            v-model="f.fap"
            :rotulo="t('folha.esocial.parametros.fap')"
            :max-bytes="6"
            data-testid="esocial-param-fap"
          />
        </div>
        <div class="campos">
          <SanteSelecao
            v-model="f.indDesFolha"
            :rotulo="t('folha.esocial.parametros.indDesFolha')"
            :opcoes="opcoesDesoneracao"
            data-testid="esocial-param-desoneracao"
          />
          <SanteSelecao
            v-model="f.indOptRegEletron"
            :rotulo="t('folha.esocial.parametros.indOptRegEletron')"
            :opcoes="opcoesSimNao"
            data-testid="esocial-param-regeletron"
          />
          <SanteSelecao
            v-model="f.indCoop"
            :rotulo="t('folha.esocial.parametros.indCoop')"
            :opcoes="opcoesCoop"
            data-testid="esocial-param-coop"
          />
          <SanteSelecao
            v-model="f.indConstr"
            :rotulo="t('folha.esocial.parametros.indConstr')"
            :opcoes="opcoesConstr"
            data-testid="esocial-param-constr"
          />
        </div>
        <div class="campos">
          <SanteCampoTexto
            v-model="f.codLotacao"
            :rotulo="t('folha.esocial.parametros.codLotacao')"
            :max-bytes="30"
            data-testid="esocial-param-lotacao"
          />
          <SanteCampoTexto
            v-model="f.fpas"
            :rotulo="t('folha.esocial.parametros.fpas')"
            :max-bytes="3"
            data-testid="esocial-param-fpas"
          />
          <SanteCampoTexto
            v-model="f.codTercs"
            :rotulo="t('folha.esocial.parametros.codTercs')"
            :max-bytes="4"
            data-testid="esocial-param-tercs"
          />
          <SanteCampoTexto
            v-model="f.ideTabRubr"
            :rotulo="t('folha.esocial.parametros.ideTabRubr')"
            :max-bytes="8"
            data-testid="esocial-param-tabrubr"
          />
          <SanteCampoTexto
            v-model="f.cnpjSindicato"
            :rotulo="t('folha.esocial.parametros.cnpjSindicato')"
            :max-bytes="18"
            data-testid="esocial-param-sindicato"
          />
        </div>
        <fieldset v-if="apoio.motivosAfastamento.length" class="bloco" data-testid="esocial-param-motivos">
          <legend>{{ t('folha.esocial.parametros.motivos') }}</legend>
          <p class="secundario">{{ t('folha.esocial.parametros.motivosAjuda') }}</p>
          <div class="campos">
            <SanteCampoTexto
              v-for="m in apoio.motivosAfastamento"
              :key="m.codigo"
              :model-value="motivo(m.codigo)"
              :rotulo="m.rotulo"
              :max-bytes="2"
              :data-testid="`esocial-param-motivo-${m.codigo}`"
              @update:model-value="(v: string) => definirMotivo(m.codigo, v)"
            />
          </div>
        </fieldset>
        <p v-if="tentou && !entrada.success" role="alert" data-testid="esocial-param-invalido">
          {{ t('folha.esocial.parametros.invalido', { campos: camposInvalidos }) }}
        </p>
        <div class="acoes">
          <SanteBotao
            :rotulo="t('folha.esocial.gravar')"
            tipo="submit"
            :desabilitado="ocupado"
            data-testid="esocial-param-gravar"
          />
          <SanteBotao :rotulo="t('folha.esocial.fechar')" variante="secundario" @acionar="aberto = false" />
        </div>
      </form>
    </SanteDialogo>
  </section>
</template>

<style scoped src="../../pessoas/estilo-pessoas.css"></style>
