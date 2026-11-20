<script setup lang="ts">
// Dimensionamento de enfermagem (M52.3; item `Gestão de pessoas > Dimensionamento de enfermagem (COFEN 543/2017)`;
// rota `/pessoas/dimensionamento`; `pessoas.dimensionamento.ler` / `pessoas.dimensionamento.calcular`): a unidade, o
// dia e o turno da escala, a jornada semanal da equipe, o índice de segurança técnica e os pacientes por categoria de
// cuidado (informados pela coordenação ou da classificação de pacientes do turno). O cálculo mostra cada parcela da conta
// (regra 9) e a cobertura mínima sugerida para a escala; o registro fica no histórico (só inclusão). O servidor refaz a
// conta.
import {
  CATEGORIAS_SCP,
  CODIGOS_CATEGORIA_SCP,
  CODIGOS_FONTE_DIMENSIONAMENTO,
  CODIGOS_TURNO_ESCALA,
  type CalcularDimensionamentoEntrada,
  type CategoriaScp,
  type DimensionamentoLido,
  FONTES_DIMENSIONAMENTO,
  type FonteDimensionamento,
  type ResultadoEscala,
  TURNOS_ESCALA,
  type TurnoEscala,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import {
  lerApoioDimensionamento,
  lerDimensionamentos,
  previaDimensionamento,
  registrarDimensionamento,
} from '../api-plantao.js';
import ErroPessoas from '../componentes/ErroPessoas.vue';

const { t } = useI18n();
const qc = useQueryClient();
const apoio = useQuery({
  queryKey: ['pessoas', 'dimensionamento', 'apoio'],
  queryFn: lerApoioDimensionamento,
});
const a = computed(() => apoio.data.value ?? null);

const unidade = ref<number | null>(null);
const setor = ref('');
const dia = ref<string | null>(null);
const turno = ref<TurnoEscala>('manha');
const jornada = ref('36');
const ist = ref('15');
const fonte = ref<FonteDimensionamento>('informada');
const unidadeInternacao = ref<string | null>(null);
const pacientes = ref<Record<CategoriaScp, string>>({
  minimos: '0',
  intermediarios: '0',
  altaDependencia: '0',
  semiIntensivos: '0',
  intensivos: '0',
});
watch(
  a,
  (x) => {
    if (x && !dia.value) dia.value = x.hoje;
  },
  { immediate: true },
);
const historico = useQuery({
  queryKey: computed(() => ['pessoas', 'dimensionamentos', unidade.value]),
  queryFn: () => lerDimensionamentos(unidade.value),
});

const opcoesUnidade = computed(() =>
  (a.value?.unidades ?? []).map((u) => ({ valor: u.codigo, rotulo: u.rotulo })),
);
const opcoesTurno = CODIGOS_TURNO_ESCALA.map((c) => ({ valor: c, rotulo: TURNOS_ESCALA[c].rotulo }));
const opcoesFonte = CODIGOS_FONTE_DIMENSIONAMENTO.map((c) => ({
  valor: c,
  rotulo: FONTES_DIMENSIONAMENTO[c],
}));
const opcoesInternacao = computed(() =>
  (a.value?.unidadesInternacao ?? []).map((u) => ({
    valor: u.codigo,
    rotulo: `${u.rotulo} (${t('pessoas.dimensionamento.internados', { n: u.internados })})`,
  })),
);

const numero = (s: string) => {
  const x = Number(s.trim().replace(',', '.'));
  return Number.isFinite(x) && s.trim() !== '' ? x : null;
};
const aviso = ref<string | null>(null);
function entrada(): CalcularDimensionamentoEntrada | null {
  aviso.value = null;
  if (unidade.value === null || !dia.value) {
    aviso.value = t('pessoas.dimensionamento.escolhaUnidade');
    return null;
  }
  const j = numero(jornada.value);
  const i = numero(ist.value);
  const p = Object.fromEntries(CODIGOS_CATEGORIA_SCP.map((c) => [c, numero(pacientes.value[c])])) as Record<
    CategoriaScp,
    number | null
  >;
  if (j === null || i === null || (fonte.value === 'informada' && Object.values(p).some((x) => x === null))) {
    aviso.value = t('pessoas.dimensionamento.numeroInvalido');
    return null;
  }
  return {
    unidade: unidade.value,
    setor: setor.value.trim(),
    data: dia.value,
    turno: turno.value,
    jornadaSemanalHoras: j,
    ist: Math.round(i * 100) / 10_000,
    fonte: fonte.value,
    unidadeInternacao: fonte.value === 'classificacao' ? unidadeInternacao.value : null,
    pacientes: fonte.value === 'informada' ? (p as Record<CategoriaScp, number>) : null,
  };
}

const previa = ref<DimensionamentoLido | null>(null);
const calculo = useMutation({
  mutationFn: (e: CalcularDimensionamentoEntrada) => previaDimensionamento(e),
  onSuccess: (r) => {
    previa.value = r;
  },
});
const registro = useMutation({
  mutationFn: (e: CalcularDimensionamentoEntrada) => registrarDimensionamento(e),
  onSuccess: async () => {
    await qc.invalidateQueries({ queryKey: ['pessoas', 'dimensionamentos'] });
  },
});
const resultado = computed<ResultadoEscala | null>(() => registro.data.value ?? null);
function calcular(): void {
  const e = entrada();
  registro.reset();
  if (e) calculo.mutate(e);
}
function registrar(): void {
  const e = entrada();
  if (e) registro.mutate(e);
}
const pct = (x: number) => `${String(Math.round(x * 10_000) / 100).replace('.', ',')}%`;
const br = (x: number) => String(x).replace('.', ',');
const quando = (d: DimensionamentoLido) =>
  `${d.data.split('-').reverse().join('/')} · ${TURNOS_ESCALA[d.turno].rotulo}`;
</script>

<template>
  <section class="tela-pessoas" aria-labelledby="pes-dim-titulo" data-testid="tela-dimensionamento">
    <h1 id="pes-dim-titulo">{{ t('pessoas.dimensionamento.titulo') }}</h1>
    <p>{{ t('pessoas.dimensionamento.subtitulo') }}</p>
    <ErroPessoas v-if="apoio.isError.value" :erro="apoio.error.value" />
    <p v-else-if="!a" role="status">{{ t('pessoas.carregando') }}</p>
    <template v-else>
      <SanteAlerta
        v-if="!a.acoes.calcular"
        :texto="a.acoes.motivo ?? t('pessoas.dimensionamento.soConsulta')"
        variante="info"
        data-testid="dimensionamento-so-consulta"
      />
      <form
        class="bloco"
        aria-labelledby="pes-dim-form"
        data-testid="form-dimensionamento"
        @submit.prevent="calcular"
      >
        <h2 id="pes-dim-form">{{ t('pessoas.dimensionamento.calcular') }}</h2>
        <div class="campos">
          <SanteSelecao
            v-model="unidade"
            :rotulo="t('pessoas.dimensionamento.unidade')"
            :opcoes="opcoesUnidade"
            obrigatorio
            busca
            data-testid="dim-unidade"
          />
          <SanteCampoTexto
            v-model="setor"
            :rotulo="t('pessoas.dimensionamento.setor')"
            :max-bytes="60"
            data-testid="dim-setor"
          />
          <SanteData
            v-model="dia"
            :rotulo="t('pessoas.dimensionamento.data')"
            editavel
            data-testid="dim-dia"
          />
          <SanteSelecao
            v-model="turno"
            :rotulo="t('pessoas.dimensionamento.turno')"
            :opcoes="opcoesTurno"
            data-testid="dim-turno"
          />
          <SanteCampoTexto
            v-model="jornada"
            :rotulo="t('pessoas.dimensionamento.jornada')"
            :max-bytes="4"
            data-testid="dim-jornada"
          />
          <SanteCampoTexto
            v-model="ist"
            :rotulo="t('pessoas.dimensionamento.ist')"
            :max-bytes="5"
            data-testid="dim-ist"
          />
          <SanteSelecao
            v-model="fonte"
            :rotulo="t('pessoas.dimensionamento.fonte')"
            :opcoes="opcoesFonte"
            data-testid="dim-fonte"
          />
          <SanteSelecao
            v-if="fonte === 'classificacao'"
            v-model="unidadeInternacao"
            :rotulo="t('pessoas.dimensionamento.unidadeInternacao')"
            :opcoes="opcoesInternacao"
            busca
            data-testid="dim-internacao"
          />
        </div>
        <fieldset v-if="fonte === 'informada'" class="campos" data-testid="dim-pacientes">
          <legend>{{ t('pessoas.dimensionamento.pacientes') }}</legend>
          <SanteCampoTexto
            v-for="c in CODIGOS_CATEGORIA_SCP"
            :key="c"
            v-model="pacientes[c]"
            :rotulo="`${CATEGORIAS_SCP[c].rotulo} (${CATEGORIAS_SCP[c].horas} h)`"
            :max-bytes="3"
            :data-testid="`dim-p-${c}`"
          />
        </fieldset>
        <p class="secundario">{{ t('pessoas.dimensionamento.istAjuda') }}</p>
        <p class="secundario">{{ t('pessoas.dimensionamento.minimo', { n: a.minimoEnfermeiros }) }}</p>
        <SanteAlerta v-if="aviso" :texto="aviso" variante="aviso" anunciar />
        <ErroPessoas v-if="calculo.isError.value" :erro="calculo.error.value" />
        <div class="acoes">
          <SanteBotao
            :rotulo="t('pessoas.dimensionamento.calcular')"
            tipo="submit"
            :desabilitado="calculo.isPending.value"
            data-testid="calcular-dimensionamento"
          />
        </div>
      </form>

      <section v-if="previa" class="bloco" aria-labelledby="pes-dim-res" data-testid="dim-resultado">
        <h2 id="pes-dim-res">{{ t('pessoas.dimensionamento.resultado') }}</h2>
        <dl class="campos">
          <div>
            <dt>{{ t('pessoas.dimensionamento.total') }}</dt>
            <dd data-testid="dim-total">{{ previa.calculo.totalProfissionais }}</dd>
          </div>
          <div>
            <dt>{{ t('pessoas.dimensionamento.enfermeiros') }}</dt>
            <dd data-testid="dim-enfermeiros">
              {{ previa.calculo.enfermeiros }} ({{ pct(previa.calculo.percentualEnfermeiros) }})
            </dd>
          </div>
          <div>
            <dt>{{ t('pessoas.dimensionamento.tecnicos') }}</dt>
            <dd>{{ previa.calculo.tecnicos }}</dd>
          </div>
          <div>
            <dt>{{ t('pessoas.dimensionamento.cobertura') }}</dt>
            <dd data-testid="dim-cobertura">{{ previa.calculo.coberturaSugerida }}</dd>
          </div>
        </dl>
        <SanteAlerta
          v-if="previa.naoClassificados"
          :texto="t('pessoas.dimensionamento.naoClassificados', { n: previa.naoClassificados })"
          variante="aviso"
        />
        <h3>{{ t('pessoas.dimensionamento.parcelas') }}</h3>
        <ol data-testid="dim-parcelas">
          <li v-for="(p, i) in previa.calculo.parcelas" :key="i">{{ p }}</li>
        </ol>
        <SanteAlerta
          v-if="resultado"
          :texto="resultado.mensagem"
          variante="info"
          anunciar
          data-testid="dim-registrado"
        />
        <SanteAlerta v-for="(al, i) in resultado?.alertas ?? []" :key="i" :texto="al" variante="aviso" />
        <ErroPessoas v-if="registro.isError.value" :erro="registro.error.value" />
        <div class="acoes">
          <SanteBotao
            v-if="a.acoes.calcular"
            :rotulo="t('pessoas.dimensionamento.registrar')"
            :desabilitado="registro.isPending.value"
            data-testid="registrar-dimensionamento"
            @acionar="registrar"
          />
          <RouterLink v-if="a.acoes.aplicarNaEscala" to="/pessoas/escala" data-testid="dim-aplicar">{{
            t('pessoas.dimensionamento.aplicar')
          }}</RouterLink>
        </div>
        <p v-if="a.acoes.aplicarNaEscala" class="secundario">
          {{ t('pessoas.dimensionamento.aplicarAjuda') }}
        </p>
      </section>

      <section class="bloco" aria-labelledby="pes-dim-hist">
        <h2 id="pes-dim-hist">{{ t('pessoas.dimensionamento.historico') }}</h2>
        <ErroPessoas v-if="historico.isError.value" :erro="historico.error.value" />
        <p v-else-if="!historico.data.value" role="status">{{ t('pessoas.carregando') }}</p>
        <p v-else-if="historico.data.value.itens.length === 0">{{ t('pessoas.dimensionamento.vazio') }}</p>
        <table v-else class="tabela" data-testid="tabela-dimensionamentos">
          <thead>
            <tr>
              <th scope="col">{{ t('pessoas.dimensionamento.colunas.data') }}</th>
              <th scope="col">{{ t('pessoas.dimensionamento.colunas.onde') }}</th>
              <th scope="col">{{ t('pessoas.dimensionamento.colunas.fonte') }}</th>
              <th scope="col">{{ t('pessoas.dimensionamento.colunas.the') }}</th>
              <th scope="col">{{ t('pessoas.dimensionamento.colunas.equipe') }}</th>
              <th scope="col">{{ t('pessoas.dimensionamento.colunas.cobertura') }}</th>
              <th scope="col">{{ t('pessoas.dimensionamento.colunas.por') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in historico.data.value.itens" :key="d.id ?? 0">
              <th scope="row">{{ quando(d) }}</th>
              <td>{{ [d.unidadeNome ?? d.unidade, d.setor].filter(Boolean).join(' · ') }}</td>
              <td>{{ FONTES_DIMENSIONAMENTO[d.fonte] }}</td>
              <td>{{ br(d.calculo.totalHoras) }}</td>
              <td>
                {{ d.calculo.totalProfissionais }} ({{ d.calculo.enfermeiros }} + {{ d.calculo.tecnicos }})
              </td>
              <td>{{ d.calculo.coberturaSugerida }}</td>
              <td>{{ d.calculadoPor }} {{ (d.calculadoEm ?? '').replace('T', ' ') }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </section>
</template>

<style scoped src="../estilo-pessoas.css"></style>
