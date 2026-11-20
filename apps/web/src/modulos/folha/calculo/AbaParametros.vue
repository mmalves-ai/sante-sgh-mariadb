<script setup lang="ts">
// Aba "Parâmetros" (M53.3, etapa F2; leitura com `pessoas.folha.ler`, gravação com `pessoas.parametroFolha.editar`): os
// parâmetros da folha da empresa com vigência (percentuais legais e de convenção, alíquotas da empresa, divisor de horas
// e a rubrica de cada item do cálculo). A nova vigência parte dos valores em vigor (ou dos da lei, na primeira); a rubrica
// de cada item é escolhida com busca (ADR 0027) entre as rubricas da empresa do tipo do item (a mesma regra que o servidor
// confere). D-PARAM-533: parâmetros próprios, nunca os do cadastro geral da organização.
import {
  type ApoioCalculoFolha,
  esquemaRegistrarParametrosFolha,
  type EncargosFolha,
  type PapelCalculoFolha,
  type ParametrosFolhaLidos,
  type PercentuaisFolha,
  type RubricaFolha,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import { dataBr } from '../../pessoas/comum.js';
import { lerRubricasDaCompetencia } from '../rubricas/api-rubricas.js';
import { instanteBr } from '../comum-folha.js';
import ErroFolha from '../telas/ErroFolha.vue';
import { lerParametros, registrarParametros } from './api-calculo.js';
import {
  lerCentesimos,
  percentualBr,
  rascunhoParametros,
  rubricasDoPapel,
  textoCentesimos,
  ultimoDia,
  vigenteEm,
} from './comum-calculo.js';

const props = defineProps<{ apoio: ApoioCalculoFolha; empresa: number | null; competencia: string | null }>();
const { t } = useI18n();
const cliente = useQueryClient();
const { permissoes } = usarSessao();
const veRubricas = computed(() => permissoes.value.has('pessoas.rubrica.ler'));
const pode = computed(() => props.apoio.gravacao.ligada && props.apoio.acoes.parametros);
const aviso = ref<string | null>(null);
const erro = ref<unknown>(null);
const competenciaRef = computed(() => props.competencia ?? props.apoio.competenciaSugerida);

const lista = useQuery({
  queryKey: computed(() => ['folha', 'parametros', props.empresa]),
  queryFn: () => lerParametros(props.empresa!),
  enabled: computed(() => props.empresa !== null),
});
const itens = computed(() =>
  lista.data.value ? [...lista.data.value.itens].sort((a, b) => b.inicio.localeCompare(a.inicio)) : null,
);
const emVigor = computed<ParametrosFolhaLidos | null>(() =>
  itens.value ? vigenteEm(itens.value, ultimoDia(competenciaRef.value)) : null,
);
const rubricas = useQuery({
  queryKey: computed(() => ['folha', 'rubricas-calculo', props.empresa, competenciaRef.value]),
  queryFn: () =>
    lerRubricasDaCompetencia({ competencia: competenciaRef.value, empresa: props.empresa, todas: true }),
  enabled: computed(() => props.empresa !== null && veRubricas.value),
});
const daEmpresa = computed<readonly RubricaFolha[]>(() =>
  (rubricas.data.value?.rubricas ?? []).filter((r) => r.empresa === props.empresa),
);
const rotuloRubrica = (id: number | null) => {
  if (id === null) return t('folha.calculo.parametro.semRubrica');
  const r = daEmpresa.value.find((x) => x.id === id);
  return r ? `${r.codigo} · ${r.descricao}` : t('folha.calculo.parametro.rubricaCodigo', { codigo: id });
};
const opcoesDoPapel = (papel: PapelCalculoFolha, tipo: Parameters<typeof rubricasDoPapel>[1]) => {
  const base = rubricasDoPapel(daEmpresa.value, tipo).map((r) => ({
    valor: r.id as number | null,
    rotulo: `${r.codigo} · ${r.descricao}`,
  }));
  const atual = form.rubricas[papel];
  if (atual !== null && !base.some((o) => o.valor === atual))
    base.unshift({ valor: atual, rotulo: rotuloRubrica(atual) });
  return [{ valor: null, rotulo: t('folha.calculo.parametro.semRubrica') }, ...base];
};

// ── Nova vigência ───────────────────────────────────────────────────────────────────────────────────────────
const CAMPOS_PCT: readonly (keyof PercentuaisFolha)[] = [
  'horaExtra50',
  'horaExtra100',
  'adicionalNoturno',
  'sobreaviso',
  'periculosidade',
];
const CAMPOS_ENC: readonly (keyof EncargosFolha)[] = ['inssPatronal', 'ratAjustado', 'terceiros', 'fgts'];
const registrando = ref(false);
const inicio = ref<string | null>(null);
const divisor = ref('');
const form = reactive({
  pct: {} as Record<string, string>,
  rubricas: {} as Record<PapelCalculoFolha, number | null>,
});
watch(
  () => props.empresa,
  () => {
    registrando.value = false;
    aviso.value = null;
    erro.value = null;
  },
);
function novo(): void {
  if (props.empresa === null) return;
  const r = rascunhoParametros(props.empresa, '', emVigor.value);
  for (const k of CAMPOS_PCT) form.pct[k] = textoCentesimos(r.percentuais[k]);
  for (const k of CAMPOS_ENC) form.pct[k] = textoCentesimos(r.encargos[k]);
  form.rubricas = { ...r.rubricas };
  divisor.value = r.divisorHoras === null ? '' : String(r.divisorHoras);
  inicio.value = null;
  erro.value = null;
  aviso.value = null;
  registrando.value = true;
}
const entrada = computed(() => {
  const n = (k: string) => lerCentesimos(form.pct[k] ?? '') ?? -1;
  const d = divisor.value.trim();
  return esquemaRegistrarParametrosFolha.safeParse({
    empresa: props.empresa ?? -1,
    inicio: inicio.value ?? '',
    percentuais: Object.fromEntries(CAMPOS_PCT.map((k) => [k, n(k)])),
    encargos: Object.fromEntries(CAMPOS_ENC.map((k) => [k, n(k)])),
    divisorHoras: d === '' ? null : /^\d+$/.test(d) ? Number(d) : -1,
    rubricas: { ...form.rubricas },
  });
});
async function gravar(): Promise<void> {
  if (!entrada.value.success) return;
  erro.value = null;
  try {
    const r = await registrarParametros(entrada.value.data);
    registrando.value = false;
    aviso.value = r.mensagem || t('folha.calculo.parametro.gravado');
    await cliente.invalidateQueries({ queryKey: ['folha', 'parametros'] });
  } catch (x) {
    erro.value = x;
  }
}
const papel = (p: string) => t(`folha.calculo.papeis.${p}`);
</script>

<template>
  <section class="bloco" :aria-label="t('folha.calculo.parametro.titulo')" data-testid="folha-parametros">
    <h2>{{ t('folha.calculo.parametro.titulo') }}</h2>
    <p class="secundario">{{ t('folha.calculo.parametro.descricao') }}</p>
    <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="folha-parametro-aviso" />
    <ErroFolha v-if="erro" :erro="erro" />
    <p v-if="empresa === null">{{ t('folha.calculo.escolhaEmpresa') }}</p>
    <template v-else>
      <ErroFolha v-if="lista.isError.value" :erro="lista.error.value" />
      <p v-else-if="!itens" role="status">{{ t('folha.carregando') }}</p>
      <p v-else-if="!emVigor" data-testid="folha-parametro-nenhum">
        {{ t('folha.calculo.parametro.nenhum') }}
      </p>
      <section v-else class="bloco" data-testid="folha-parametro-vigente">
        <h3>{{ t('folha.calculo.parametro.emVigor', { inicio: dataBr(emVigor.inicio) }) }}</h3>
        <p class="secundario">
          {{
            t('folha.calculo.parametro.registradoPor', {
              por: emVigor.registradoPor,
              em: instanteBr(emVigor.registradoEm),
            })
          }}
        </p>
        <dl class="totais">
          <div v-for="k in CAMPOS_PCT" :key="k">
            <dt>{{ t(`folha.calculo.parametro.campos.${k}`) }}</dt>
            <dd :data-testid="`folha-parametro-${k}`">{{ percentualBr(emVigor.percentuais[k]) }}</dd>
          </div>
          <div v-for="k in CAMPOS_ENC" :key="k">
            <dt>{{ t(`folha.calculo.parametro.campos.${k}`) }}</dt>
            <dd :data-testid="`folha-parametro-${k}`">{{ percentualBr(emVigor.encargos[k]) }}</dd>
          </div>
          <div>
            <dt>{{ t('folha.calculo.parametro.divisor') }}</dt>
            <dd data-testid="folha-parametro-divisor">
              {{ emVigor.divisorHoras ?? t('folha.calculo.parametro.divisorVinculo') }}
            </dd>
          </div>
        </dl>
        <table class="tabela" data-testid="folha-parametro-rubricas">
          <caption class="secundario">
            {{
              t('folha.calculo.parametro.rubricas')
            }}
          </caption>
          <tbody>
            <tr v-for="p in apoio.papeis" :key="p.papel">
              <th scope="row">{{ papel(p.papel) }}</th>
              <td :data-testid="`folha-parametro-rubrica-${p.papel}`">
                {{ rotuloRubrica(emVigor.rubricas[p.papel]) }}
              </td>
            </tr>
          </tbody>
        </table>
      </section>
      <table v-if="itens && itens.length > 1" class="tabela" data-testid="folha-parametro-historico">
        <caption class="secundario">
          {{
            t('folha.calculo.parametro.historico')
          }}
        </caption>
        <tbody>
          <tr v-for="x in itens" :key="x.id">
            <th scope="row">{{ dataBr(x.inicio) }}</th>
            <td>{{ x.registradoPor }}</td>
            <td>{{ instanteBr(x.registradoEm) }}</td>
          </tr>
        </tbody>
      </table>
      <div class="acoes">
        <SanteBotao
          v-if="pode && !registrando && itens"
          :rotulo="t('folha.calculo.parametro.registrar')"
          data-testid="folha-parametro-novo"
          @acionar="novo"
        />
      </div>
      <form
        v-if="registrando"
        class="bloco"
        :aria-label="t('folha.calculo.parametro.registrar')"
        data-testid="folha-parametro-form"
        @submit.prevent="gravar"
      >
        <h3>{{ t('folha.calculo.parametro.registrar') }}</h3>
        <SanteData
          v-model="inicio"
          :rotulo="t('folha.calculo.parametro.inicio')"
          editavel
          data-testid="folha-parametro-inicio"
        />
        <fieldset class="campos">
          <legend>{{ t('folha.calculo.parametro.percentuais') }}</legend>
          <SanteCampoTexto
            v-for="k in CAMPOS_PCT"
            :key="k"
            v-model="form.pct[k]!"
            :rotulo="t(`folha.calculo.parametro.campos.${k}`)"
            :max-bytes="8"
            :data-testid="`folha-parametro-campo-${k}`"
          />
        </fieldset>
        <fieldset class="campos">
          <legend>{{ t('folha.calculo.parametro.encargos') }}</legend>
          <SanteCampoTexto
            v-for="k in CAMPOS_ENC"
            :key="k"
            v-model="form.pct[k]!"
            :rotulo="t(`folha.calculo.parametro.campos.${k}`)"
            :max-bytes="8"
            :data-testid="`folha-parametro-campo-${k}`"
          />
        </fieldset>
        <SanteCampoTexto
          v-model="divisor"
          :rotulo="t('folha.calculo.parametro.divisor')"
          :max-bytes="3"
          data-testid="folha-parametro-campo-divisor"
        />
        <p class="secundario">{{ t('folha.calculo.parametro.divisorAjuda') }}</p>
        <fieldset class="campos">
          <legend>{{ t('folha.calculo.parametro.rubricas') }}</legend>
          <p class="secundario">
            {{
              veRubricas
                ? t('folha.calculo.parametro.rubricasAjuda')
                : t('folha.calculo.parametro.semRubricas')
            }}
          </p>
          <ErroFolha v-if="rubricas.isError.value" :erro="rubricas.error.value" />
          <SanteSelecao
            v-for="p in apoio.papeis"
            :key="p.papel"
            v-model="form.rubricas[p.papel]"
            :rotulo="`${papel(p.papel)} (${t(`folha.calculo.tiposPapel.${p.tipo}`)})`"
            :opcoes="opcoesDoPapel(p.papel, p.tipo)"
            busca
            :data-testid="`folha-parametro-rubrica-campo-${p.papel}`"
          />
        </fieldset>
        <p v-if="!entrada.success" class="secundario">{{ t('folha.calculo.parametro.invalido') }}</p>
        <div class="acoes">
          <SanteBotao :rotulo="t('folha.cancelar')" variante="texto" @acionar="registrando = false" />
          <SanteBotao
            :rotulo="t('folha.gravar')"
            tipo="submit"
            :desabilitado="!entrada.success"
            data-testid="folha-parametro-gravar"
          />
        </div>
      </form>
    </template>
  </section>
</template>

<style scoped src="../../pessoas/estilo-pessoas.css"></style>
<style scoped>
.totais {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
  gap: 0.5rem 1rem;
  margin: 0 0 1rem;
}
.totais dd {
  margin: 0;
  font-weight: 600;
}
fieldset {
  border: 0;
  padding: 0;
  margin: 0.5rem 0;
}
legend {
  font-weight: 600;
  margin-bottom: 0.25rem;
}
</style>
