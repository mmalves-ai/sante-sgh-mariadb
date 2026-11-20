<script setup lang="ts">
// Aba Rubricas (M53.2): as rubricas em vigor na competência (ou todas, com as fora de vigência), com o tipo, a
// referência, as incidências marcadas, os códigos de incidência do eSocial e a natureza; a conferência das incidências
// (regra pura do domínio, feita no servidor) com o texto de cada divergência; busca por código ou descrição e o filtro
// das divergentes; o detalhe com as 20 incidências. A alteração abre o cadastro genérico das rubricas.
import {
  type ApoioRubricas,
  INCIDENCIAS_RUBRICA_FOLHA,
  type RubricaFolha,
  TRIBUTOS_INCIDENCIA_ESOCIAL,
} from '@sgh/contratos';
import { fimDaCompetencia } from '@sgh/dominio-pessoas';
import { SanteBotao, SanteCampoTexto, SanteMarcadores, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { lerRubricasDaCompetencia } from './api-rubricas.js';
import { dataBr, empresasDasRubricas, filtrarRubricas, percentual, textoVigencia } from './comum-rubricas.js';

const props = defineProps<{ apoio: ApoioRubricas; competencia: string }>();
// M53.2: o detalhe leva a rubrica escolhida ao cadastro (que abre filtrado nela e, com a gravação ligada, na alteração).
const emit = defineEmits<{ alterar: [rubrica: RubricaFolha] }>();
const { t } = useI18n();

type Mostrar = 'todas' | 'divergentes';
const mostrar = ref<Mostrar[]>([]);
const todas = computed(() => mostrar.value.includes('todas'));
const lista = useQuery({
  queryKey: computed(() => ['folha', 'rubricas', props.competencia, todas.value]),
  queryFn: () => lerRubricasDaCompetencia({ competencia: props.competencia, todas: todas.value }),
});
const dados = computed(() => lista.data.value ?? null);

const empresa = ref<number | null>(null);
const opcoesEmpresa = computed(() => [
  { valor: null as number | null, rotulo: t('rubricasFolha.todasEmpresas') },
  ...empresasDasRubricas(dados.value?.rubricas ?? []).map((e) => ({
    valor: e as number | null,
    rotulo: t('rubricasFolha.empresaN', { n: e }),
  })),
]);
const termo = ref('');
const opcoesMostrar = computed(() => [
  { valor: 'todas' as Mostrar, rotulo: t('rubricasFolha.rubricas.mostrarForaDeVigencia') },
  { valor: 'divergentes' as Mostrar, rotulo: t('rubricasFolha.rubricas.soDivergentes') },
]);

const porId = computed(() => new Map((dados.value?.rubricas ?? []).map((r) => [r.id, r])));
const divergentes = computed(() => new Set((dados.value?.conferencia ?? []).map((c) => c.rubrica)));
const visiveis = computed(() =>
  filtrarRubricas(
    (dados.value?.rubricas ?? []).filter((r) => empresa.value === null || r.empresa === empresa.value),
    termo.value,
    mostrar.value.includes('divergentes') ? divergentes.value : null,
  ),
);
const conferencia = computed(() =>
  (dados.value?.conferencia ?? []).filter((c) => visiveis.value.some((r) => r.id === c.rubrica)),
);

const rotuloEsocial = (tributo: (typeof TRIBUTOS_INCIDENCIA_ESOCIAL)[number], codigo: string | null) => {
  if (codigo === null) return t('rubricasFolha.rubricas.semCodigo');
  const r = props.apoio.incidenciasEsocial[tributo]?.find((x) => x.codigo === codigo)?.rotulo;
  return r ? `${codigo} — ${r}` : codigo;
};
const rotuloNatureza = (id: number | null) => {
  if (id === null) return t('rubricasFolha.rubricas.semNatureza');
  const n = props.apoio.naturezas.find((x) => x.id === id);
  return n ? `${n.codigo} — ${n.rotulo}` : String(id);
};
const incide = (r: RubricaFolha) => INCIDENCIAS_RUBRICA_FOLHA.filter((i) => r.incidencias[i]);
const resumoIncide = (r: RubricaFolha) => {
  const l = incide(r);
  return l.length
    ? l.map((i) => t(`rubricasFolha.incidencias.${i}`)).join(', ')
    : t('rubricasFolha.rubricas.nenhumaIncidencia');
};
const vig = (r: RubricaFolha) => {
  const v = textoVigencia(r.vigencia);
  return t(`rubricasFolha.vigencia.${v.chave}`, { inicio: v.inicio, fim: v.fim });
};
function textoConferencia(c: { rubrica: number; codigo: string; tributo: string | null }) {
  const r = porId.value.get(c.rubrica);
  return t(`rubricasFolha.conferenciaRubrica.${c.codigo}`, {
    codigo: r ? `${r.codigo} (${r.descricao})` : c.rubrica,
    tributo: c.tributo ? t(`rubricasFolha.tributos.${c.tributo}`) : '',
  });
}

const aberta = ref<number | null>(null);
const detalhe = computed(() => (aberta.value === null ? null : (porId.value.get(aberta.value) ?? null)));
</script>

<template>
  <section class="bloco" aria-labelledby="aba-rubricas-titulo" data-testid="aba-rubricas">
    <h2 id="aba-rubricas-titulo">{{ t('rubricasFolha.abas.rubricas') }}</h2>
    <MensagemErro v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!dados" role="status">{{ t('rubricasFolha.carregando') }}</p>
    <template v-else>
      <p class="secundario" data-testid="rubricas-referencia">
        {{
          t('rubricasFolha.rubricas.referencia', {
            inicio: dataBr(dados.dataReferencia),
            fim: dataBr(fimDaCompetencia(dados.competencia)),
          })
        }}
      </p>
      <div class="campos">
        <SanteSelecao
          v-model="empresa"
          :rotulo="t('rubricasFolha.empresa')"
          :opcoes="opcoesEmpresa"
          busca
          data-testid="rubricas-empresa"
        />
        <SanteCampoTexto
          v-model="termo"
          :rotulo="t('rubricasFolha.rubricas.busca')"
          :max-bytes="60"
          data-testid="rubricas-busca"
        />
        <SanteMarcadores
          v-model="mostrar"
          :legenda="t('rubricasFolha.rubricas.colunas.situacao')"
          :opcoes="opcoesMostrar"
          data-testid="rubricas-mostrar"
        />
      </div>
      <p data-testid="rubricas-contagem">
        {{
          todas
            ? t('rubricasFolha.rubricas.contagemTodas', { n: dados.rubricas.length })
            : t('rubricasFolha.rubricas.contagem', { n: dados.rubricas.length, fora: dados.foraDeVigencia })
        }}
      </p>
      <div data-testid="rubricas-conferencia">
        <p v-if="conferencia.length === 0">{{ t('rubricasFolha.rubricas.semDivergencia') }}</p>
        <template v-else>
          <h3>{{ t('rubricasFolha.rubricas.divergencias', { n: conferencia.length }) }}</h3>
          <ul>
            <li
              v-for="(c, i) in conferencia"
              :key="`${c.rubrica}-${c.codigo}-${c.tributo}-${i}`"
              data-testid="rubricas-divergencia"
            >
              {{ textoConferencia(c) }}
            </li>
          </ul>
        </template>
      </div>
      <p v-if="visiveis.length === 0">{{ t('rubricasFolha.nenhum') }}</p>
      <div v-else class="rolagem">
        <table class="tabela" data-testid="tabela-rubricas">
          <thead>
            <tr>
              <th scope="col">{{ t('rubricasFolha.rubricas.colunas.codigo') }}</th>
              <th scope="col">{{ t('rubricasFolha.rubricas.colunas.descricao') }}</th>
              <th scope="col">{{ t('rubricasFolha.rubricas.colunas.tipo') }}</th>
              <th scope="col">{{ t('rubricasFolha.rubricas.colunas.referencia') }}</th>
              <th scope="col">{{ t('rubricasFolha.rubricas.colunas.percentual') }}</th>
              <th scope="col">{{ t('rubricasFolha.rubricas.colunas.vigencia') }}</th>
              <th scope="col">{{ t('rubricasFolha.rubricas.colunas.incide') }}</th>
              <th scope="col">{{ t('rubricasFolha.rubricas.colunas.esocial') }}</th>
              <th scope="col">{{ t('rubricasFolha.rubricas.colunas.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="r in visiveis"
              :key="r.id"
              :class="{ divergente: divergentes.has(r.id) }"
              :data-testid="`rubrica-${r.id}`"
            >
              <td>{{ r.codigo }}</td>
              <td>
                {{ r.descricao }}
                <span v-if="!r.ativa" class="secundario"> ({{ t('rubricasFolha.rubricas.inativa') }})</span>
              </td>
              <td>{{ r.tipo ? t(`rubricasFolha.tipos.${r.tipo}`) : '' }}</td>
              <td>{{ r.referencia ? t(`rubricasFolha.referencias.${r.referencia}`) : '' }}</td>
              <td>{{ r.percentual ? percentual(r.percentual) : '' }}</td>
              <td>{{ vig(r) }}</td>
              <td>{{ resumoIncide(r) }}</td>
              <td>
                <span v-for="x in TRIBUTOS_INCIDENCIA_ESOCIAL" :key="x" class="marca-tributo">
                  {{ t(`rubricasFolha.tributos.${x}`) }}: {{ r.esocial[x] ?? '—' }}
                </span>
              </td>
              <td>
                <SanteBotao
                  variante="secundario"
                  :rotulo="t('rubricasFolha.rubricas.detalhe')"
                  :data-testid="`rubrica-detalhe-${r.id}`"
                  @acionar="aberta = r.id"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <section
        v-if="detalhe"
        class="bloco"
        aria-labelledby="rubrica-detalhe-titulo"
        data-testid="rubrica-detalhe"
      >
        <h3 id="rubrica-detalhe-titulo">
          {{
            t('rubricasFolha.rubricas.detalheTitulo', {
              codigo: detalhe.codigo,
              descricao: detalhe.descricao,
            })
          }}
        </h3>
        <dl class="dados">
          <dt>{{ t('rubricasFolha.rubricas.colunas.situacao') }}</dt>
          <dd>
            {{ detalhe.ativa ? t('rubricasFolha.rubricas.ativa') : t('rubricasFolha.rubricas.inativa') }}
          </dd>
          <dt>{{ t('rubricasFolha.rubricas.colunas.vigencia') }}</dt>
          <dd>{{ vig(detalhe) }}</dd>
          <dt>{{ t('rubricasFolha.rubricas.prioridade') }}</dt>
          <dd>{{ detalhe.prioridade ?? '—' }}</dd>
          <dt>{{ t('rubricasFolha.rubricas.usos') }}</dt>
          <dd>{{ detalhe.usos.map((u) => t(`rubricasFolha.usos.${u}`)).join(', ') || '—' }}</dd>
          <dt>{{ t('rubricasFolha.rubricas.natureza') }}</dt>
          <dd data-testid="rubrica-natureza">{{ rotuloNatureza(detalhe.natureza) }}</dd>
        </dl>
        <h4>{{ t('rubricasFolha.rubricas.codigosEsocial') }}</h4>
        <dl class="dados" data-testid="rubrica-esocial">
          <template v-for="x in TRIBUTOS_INCIDENCIA_ESOCIAL" :key="x">
            <dt>{{ t(`rubricasFolha.tributos.${x}`) }}</dt>
            <dd>{{ rotuloEsocial(x, detalhe.esocial[x] ?? null) }}</dd>
          </template>
        </dl>
        <h4>{{ t('rubricasFolha.rubricas.incidencias') }}</h4>
        <dl class="dados" data-testid="rubrica-incidencias">
          <template v-for="i in INCIDENCIAS_RUBRICA_FOLHA" :key="i">
            <dt>{{ t(`rubricasFolha.incidencias.${i}`) }}</dt>
            <dd>{{ detalhe.incidencias[i] ? t('rubricasFolha.sim') : t('rubricasFolha.nao') }}</dd>
          </template>
        </dl>
        <div class="acoes">
          <SanteBotao
            :rotulo="
              props.apoio.gravacaoLigada
                ? t('rubricasFolha.rubricas.alterar')
                : t('rubricasFolha.rubricas.verNoCadastro')
            "
            data-testid="rubrica-alterar"
            @acionar="emit('alterar', detalhe)"
          />
          <SanteBotao
            variante="secundario"
            :rotulo="t('rubricasFolha.rubricas.fecharDetalhe')"
            @acionar="aberta = null"
          />
        </div>
      </section>
    </template>
  </section>
</template>

<style scoped src="../../pessoas/estilo-pessoas.css"></style>
<style scoped>
.rolagem {
  overflow-x: auto;
}
.divergente td:first-child {
  border-left: 3px solid var(--p-orange-500, currentColor);
}
.marca-tributo {
  display: block;
  white-space: nowrap;
}
h3,
h4 {
  font-size: 1rem;
  margin: 0;
}
</style>
