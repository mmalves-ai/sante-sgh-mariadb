<script setup lang="ts">
// Rateio do repasse por setor e custos do prestador (F8, 06-FAT linha 49): `/repasse/rateio-custos`, aberta pelas
// regras do repasse. Visão por médico: a busca escolhe o médico e a tela mostra, de uma vez, os custos que ele paga
// ao hospital e as regras de rateio dele (e as do grupo dele), com a inclusão no mesmo lugar: a forma escolhe o campo
// (valor ou percentual), o setor traz o centro de custo sozinho e a soma dos percentuais aparece na hora (o botão só
// libera com 100%). Abaixo, o rateio da apuração (total por setor, o gravado, o que a regra vigente daria e os médicos
// pendentes) e os tipos de desconto. Encerrar só antecipa o fim; nada é apagado. Ações só com a permissão de propor
// regra (custos, regras, tipos) e de criar lançamento (gravar o rateio).
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../../faturamento/componentes/MensagemFaturamento.vue';
import BuscaPrestador from '../componentes/BuscaPrestador.vue';
import {
  encerrarRateioCusto,
  incluirCustoPrestador,
  incluirRegraRateio,
  incluirTipoDesconto,
  lerPainelRateioCusto,
  lerRateioApuracao,
  ratearApuracao,
  situacaoTipoDesconto,
} from '../api-rateio-custo.js';
import { data, reais, usarRepasse } from '../usar-repasse.js';

const { t } = useI18n();
const qc = useQueryClient();
const { apoio, tem } = usarRepasse();
const podeEditar = computed(() => tem('repasse.regra.propor'));
const podeRatear = computed(() => tem('repasse.lancamento.criar'));
const hoje = computed(() => apoio.data.value?.hoje ?? new Date().toISOString().slice(0, 10));
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);

const medico = ref('');
const registro = ref('');
const profissional = computed(() => Number(medico.value) || 0);
const painel = useQuery({
  queryKey: computed(() => ['repasse', 'rateio-custos', profissional.value]),
  queryFn: () => lerPainelRateioCusto(profissional.value || null),
});
const dados = computed(() => painel.data.value);
const vigente = (x: { inicio: string; fim: string | null }) =>
  x.inicio <= hoje.value && (x.fim === null || x.fim >= hoje.value);
const fimEncerrar = reactive<Record<string, string>>({});
const recarregar = () => qc.invalidateQueries({ queryKey: ['repasse', 'rateio-custos'] });

async function agir(fn: () => Promise<unknown>, ok: string) {
  erro.value = null;
  mensagem.value = null;
  try {
    await fn();
    mensagem.value = ok;
    await recarregar();
    return true;
  } catch (e) {
    erro.value = e;
    return false;
  }
}
const encerrar = (tipo: 'custo' | 'rateio', id: number, versao: number) =>
  agir(
    () => encerrarRateioCusto(tipo, id, versao, fimEncerrar[`${tipo}-${id}`] || hoje.value),
    t('repasse.rateioCusto.encerrado'),
  );

// ── Custos do prestador ──
const custo = reactive({
  tipo: 0,
  descricao: '',
  centro: 0,
  forma: 'valor' as 'valor' | 'percentual',
  valor: '' as string | number,
  percentual: '' as string | number,
  faixaInicial: '' as string | number,
  faixaFinal: '' as string | number,
  frequencia: 'mensal' as 'mensal' | 'por_apuracao' | 'unica',
  inicio: '',
  fim: '',
});
const nOuNulo = (v: string | number) => (v === '' ? null : Number(v));
const custoValido = computed(() => {
  const v = custo.forma === 'valor' ? Number(custo.valor) : Number(custo.percentual);
  const fi = nOuNulo(custo.faixaInicial);
  const ff = nOuNulo(custo.faixaFinal);
  return (
    profissional.value > 0 &&
    custo.tipo > 0 &&
    custo.descricao.trim() !== '' &&
    v > 0 &&
    (custo.forma === 'valor' || v <= 100) &&
    (fi === null || ff === null || ff >= fi) &&
    custo.inicio !== '' &&
    (custo.fim === '' || custo.fim >= custo.inicio)
  );
});
async function incluirCusto() {
  const ok = await agir(
    () =>
      incluirCustoPrestador({
        profissional: profissional.value,
        tipo: custo.tipo,
        centroCusto: custo.centro || null,
        descricao: custo.descricao.trim(),
        forma: custo.forma,
        valor: custo.forma === 'valor' ? Number(custo.valor) : null,
        percentual: custo.forma === 'percentual' ? Number(custo.percentual) : null,
        faixaInicial: nOuNulo(custo.faixaInicial),
        faixaFinal: nOuNulo(custo.faixaFinal),
        frequencia: custo.frequencia,
        inicio: custo.inicio,
        fim: custo.fim || null,
      }),
    t('repasse.rateioCusto.custoIncluido'),
  );
  if (ok)
    Object.assign(custo, { descricao: '', valor: '', percentual: '', faixaInicial: '', faixaFinal: '' });
}
const opcoesTipos = computed(() => [
  { valor: 0, rotulo: '—' },
  ...(dados.value?.tipos ?? [])
    .filter((x) => x.ativo)
    .map((x) => ({ valor: x.id, rotulo: `${x.codigo} · ${x.descricao}` })),
]);
const opcoesCentros = computed(() => [
  { valor: 0, rotulo: t('repasse.rateioCusto.semCentro') },
  ...(dados.value?.centros ?? []).map((x) => ({ valor: x.id, rotulo: x.nome })),
]);

// ── Regras de rateio ──
const regra = reactive({
  dono: 'medico' as 'medico' | 'grupo',
  grupo: 0,
  descricao: '',
  base: 'repasse' as 'repasse' | 'custo',
  inicio: '',
  fim: '',
  setores: [{ setor: 0, percentual: 100 as string | number }],
});
watch(hoje, (h) => ((custo.inicio ||= h), (regra.inicio ||= h)), { immediate: true });
const soma = computed(
  () => Math.round(regra.setores.reduce((s, x) => s + Number(x.percentual || 0), 0) * 10000) / 10000,
);
const setoresRepetidos = computed(() => {
  const ids = regra.setores.map((x) => x.setor).filter((x) => x > 0);
  return new Set(ids).size !== ids.length;
});
const centroDoSetor = (id: number) => dados.value?.setores.find((s) => s.id === id)?.centroNome ?? null;
const regraValida = computed(
  () =>
    regra.descricao.trim() !== '' &&
    (regra.dono === 'medico' ? profissional.value > 0 : regra.grupo > 0) &&
    regra.setores.every((s) => s.setor > 0 && Number(s.percentual) > 0) &&
    !setoresRepetidos.value &&
    soma.value === 100 &&
    regra.inicio !== '' &&
    (regra.fim === '' || regra.fim >= regra.inicio),
);
async function incluirRegra() {
  const ok = await agir(
    () =>
      incluirRegraRateio({
        descricao: regra.descricao.trim(),
        profissional: regra.dono === 'medico' ? profissional.value : null,
        grupoRepasse: regra.dono === 'grupo' ? regra.grupo : null,
        base: regra.base,
        inicio: regra.inicio,
        fim: regra.fim || null,
        setores: regra.setores.map((s) => ({ setor: s.setor, percentual: Number(s.percentual) })),
      }),
    t('repasse.rateioCusto.regraIncluida'),
  );
  if (ok) Object.assign(regra, { descricao: '', setores: [{ setor: 0, percentual: 100 }] });
}
const opcoesSetores = computed(() => [
  { valor: 0, rotulo: '—' },
  ...(dados.value?.setores ?? []).map((x) => ({ valor: x.id, rotulo: x.nome })),
]);

// ── Rateio da apuração ──
const apuracao = ref(0);
const rateio = useQuery({
  queryKey: computed(() => ['repasse', 'rateio-custos', 'apuracao', apuracao.value]),
  queryFn: () => lerRateioApuracao(apuracao.value),
  enabled: computed(() => apuracao.value > 0),
});
const nomeDoMedico = (id: number) =>
  rateio.data.value?.gravado.find((g) => g.profissional === id)?.profissionalNome ?? `#${id}`;
const nomeDoSetor = (id: number) => dados.value?.setores.find((s) => s.id === id)?.nome ?? `#${id}`;
async function ratear() {
  erro.value = null;
  mensagem.value = null;
  try {
    const r = await ratearApuracao(apuracao.value);
    mensagem.value = t('repasse.rateioCusto.rateado', { gravadas: r.gravadas, excluidas: r.excluidas });
    await recarregar();
  } catch (e) {
    erro.value = e;
  }
}

// ── Tipos de desconto ──
const tipo = reactive({
  codigo: '',
  descricao: '',
  natureza: 'custo',
  forma: 'informado' as 'informado' | 'valor_fixo' | 'percentual',
  padrao: '' as string | number,
});
const tipoValido = computed(
  () =>
    /^[A-Za-z0-9_.-]{1,30}$/.test(tipo.codigo) &&
    tipo.descricao.trim() !== '' &&
    (tipo.forma === 'informado' || (tipo.padrao !== '' && Number(tipo.padrao) >= 0)) &&
    (tipo.forma !== 'percentual' || Number(tipo.padrao) <= 100),
);
async function incluirTipo() {
  const ok = await agir(
    () =>
      incluirTipoDesconto({
        codigo: tipo.codigo,
        descricao: tipo.descricao.trim(),
        natureza: tipo.natureza,
        forma: tipo.forma,
        valorPadrao: tipo.forma === 'valor_fixo' ? Number(tipo.padrao) : null,
        percentualPadrao: tipo.forma === 'percentual' ? Number(tipo.padrao) : null,
      }),
    t('repasse.rateioCusto.tipoIncluido'),
  );
  if (ok) Object.assign(tipo, { codigo: '', descricao: '', padrao: '' });
}
const naturezas = ['adiantamento', 'taxa', 'multa', 'custo', 'glosa', 'outro'] as const;
</script>

<template>
  <section class="tela-agenda tela-repasse" aria-labelledby="rc-titulo" data-testid="tela-rep-rateio-custos">
    <h1 id="rc-titulo">{{ t('repasse.rateioCusto.titulo') }}</h1>
    <p class="secundario">{{ t('repasse.rateioCusto.resumo') }}</p>
    <ErroFaturamento v-if="painel.error.value" :erro="painel.error.value" />
    <ErroFaturamento v-if="erro" :erro="erro" />
    <MensagemFaturamento :texto="mensagem" testid="rc-mensagem" />
    <div class="filtros acoes">
      <BuscaPrestador
        v-model="medico"
        v-model:registro="registro"
        :rotulo="t('repasse.rateioCusto.medico')"
        testid="rc-medico"
      />
    </div>
    <p v-if="!profissional" class="secundario">{{ t('repasse.rateioCusto.todos') }}</p>

    <!-- Custos do prestador -->
    <h2>{{ t('repasse.rateioCusto.custos') }}</h2>
    <table v-if="dados?.custos.length" class="tabela" data-testid="rc-custos">
      <thead>
        <tr>
          <th scope="col">{{ t('repasse.rateioCusto.medico') }}</th>
          <th scope="col">{{ t('repasse.rateioCusto.descricao') }}</th>
          <th scope="col">{{ t('repasse.rateioCusto.forma') }}</th>
          <th scope="col">{{ t('repasse.rateioCusto.frequencia') }}</th>
          <th scope="col">{{ t('repasse.rateioCusto.centro') }}</th>
          <th scope="col">{{ t('repasse.rateioCusto.inicio') }}</th>
          <th scope="col">{{ t('repasse.rateioCusto.fim') }}</th>
          <th scope="col">{{ t('repasse.acoes') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="c in dados.custos"
          :key="c.id"
          :class="{ secundario: !vigente(c) }"
          :data-testid="`rc-custo-${c.id}`"
        >
          <td>{{ c.profissionalNome }}</td>
          <td>{{ c.descricao }} · {{ c.tipoDescricao }}</td>
          <td>{{ c.forma === 'valor' ? reais(c.valor ?? 0) : `${c.percentual}%` }}</td>
          <td>{{ t(`repasse.rateioCusto.frequencias.${c.frequencia}`) }}</td>
          <td>{{ c.centroNome ?? '—' }}</td>
          <td>{{ data(c.inicio) }}</td>
          <td>{{ c.fim ? data(c.fim) : t('repasse.rateioCusto.vigente') }}</td>
          <td>
            <template v-if="podeEditar && (c.fim === null || c.fim >= hoje)">
              <input
                v-model="fimEncerrar[`custo-${c.id}`]"
                type="date"
                :min="c.inicio"
                :max="c.fim ?? undefined"
                :aria-label="t('repasse.rateioCusto.dataEncerrar')"
                :data-testid="`rc-custo-fim-${c.id}`"
              />
              <button
                type="button"
                :data-testid="`rc-custo-encerrar-${c.id}`"
                @click="encerrar('custo', c.id, c.versao)"
              >
                {{ t('repasse.rateioCusto.encerrar') }}
              </button>
            </template>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else>{{ t('repasse.nenhum') }}</p>

    <fieldset v-if="podeEditar && profissional" data-testid="rc-novo-custo">
      <legend>{{ t('repasse.rateioCusto.incluirCusto') }}</legend>
      <div class="filtros acoes">
        <span class="campo">
          <SanteSelecao
            v-model="custo.tipo"
            :rotulo="t('repasse.rateioCusto.tipo')"
            :opcoes="opcoesTipos"
            data-testid="rc-custo-tipo"
          />
        </span>
        <span class="campo">
          <label for="rc-custo-descricao">{{ t('repasse.rateioCusto.descricao') }}</label>
          <input
            id="rc-custo-descricao"
            v-model="custo.descricao"
            maxlength="150"
            data-testid="rc-custo-descricao"
          />
        </span>
        <span class="campo">
          <SanteSelecao
            v-model="custo.forma"
            :rotulo="t('repasse.rateioCusto.forma')"
            :opcoes="
              (['valor', 'percentual'] as const).map((x) => ({
                valor: x,
                rotulo: t(`repasse.rateioCusto.formas.${x}`),
              }))
            "
            data-testid="rc-custo-forma"
          />
        </span>
        <span v-if="custo.forma === 'valor'" class="campo">
          <label for="rc-custo-valor">{{ t('repasse.rateioCusto.valor') }}</label>
          <input
            id="rc-custo-valor"
            v-model="custo.valor"
            type="number"
            min="0.01"
            step="0.01"
            data-testid="rc-custo-valor"
          />
        </span>
        <span v-else class="campo">
          <label for="rc-custo-percentual">{{ t('repasse.rateioCusto.percentual') }}</label>
          <input
            id="rc-custo-percentual"
            v-model="custo.percentual"
            type="number"
            min="0.0001"
            max="100"
            step="0.0001"
            data-testid="rc-custo-percentual"
          />
        </span>
        <span class="campo">
          <SanteSelecao
            v-model="custo.frequencia"
            :rotulo="t('repasse.rateioCusto.frequencia')"
            :opcoes="
              (['mensal', 'por_apuracao', 'unica'] as const).map((x) => ({
                valor: x,
                rotulo: t(`repasse.rateioCusto.frequencias.${x}`),
              }))
            "
            data-testid="rc-custo-frequencia"
          />
        </span>
        <span class="campo">
          <SanteSelecao
            v-model="custo.centro"
            :rotulo="t('repasse.rateioCusto.centro')"
            :opcoes="opcoesCentros"
            data-testid="rc-custo-centro"
          />
        </span>
        <span class="campo">
          <label for="rc-custo-faixa-ini">{{ t('repasse.rateioCusto.faixaInicial') }}</label>
          <input id="rc-custo-faixa-ini" v-model="custo.faixaInicial" type="number" min="0" step="0.01" />
        </span>
        <span class="campo">
          <label for="rc-custo-faixa-fim">{{ t('repasse.rateioCusto.faixaFinal') }}</label>
          <input id="rc-custo-faixa-fim" v-model="custo.faixaFinal" type="number" min="0" step="0.01" />
        </span>
        <span class="campo">
          <label for="rc-custo-inicio">{{ t('repasse.rateioCusto.inicio') }}</label>
          <input id="rc-custo-inicio" v-model="custo.inicio" type="date" data-testid="rc-custo-inicio" />
        </span>
        <span class="campo">
          <label for="rc-custo-fim">{{ t('repasse.rateioCusto.fim') }}</label>
          <input id="rc-custo-fim" v-model="custo.fim" type="date" :min="custo.inicio" />
        </span>
        <button type="button" :disabled="!custoValido" data-testid="rc-custo-incluir" @click="incluirCusto">
          {{ t('repasse.rateioCusto.incluirCusto') }}
        </button>
      </div>
    </fieldset>

    <!-- Regras de rateio por setor -->
    <h2>{{ t('repasse.rateioCusto.regras') }}</h2>
    <table v-if="dados?.regras.length" class="tabela" data-testid="rc-regras">
      <thead>
        <tr>
          <th scope="col">{{ t('repasse.rateioCusto.descricao') }}</th>
          <th scope="col">{{ t('repasse.rateioCusto.dono') }}</th>
          <th scope="col">{{ t('repasse.rateioCusto.base') }}</th>
          <th scope="col">{{ t('repasse.rateioCusto.setores') }}</th>
          <th scope="col">{{ t('repasse.rateioCusto.inicio') }}</th>
          <th scope="col">{{ t('repasse.rateioCusto.fim') }}</th>
          <th scope="col">{{ t('repasse.acoes') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="r in dados.regras"
          :key="r.id"
          :class="{ secundario: !vigente(r) }"
          :data-testid="`rc-regra-${r.id}`"
        >
          <td>{{ r.descricao }}</td>
          <td>
            {{ r.profissionalNome ?? t('repasse.rateioCusto.doGrupo', { grupo: r.grupoDescricao ?? '' }) }}
          </td>
          <td>{{ t(`repasse.rateioCusto.bases.${r.base}`) }}</td>
          <td>
            <span v-for="s in r.setores" :key="s.setor" class="bloco">{{
              `${s.setorNome} ${s.percentual}%${s.centroNome ? ` (${s.centroNome})` : ''}; `
            }}</span>
          </td>
          <td>{{ data(r.inicio) }}</td>
          <td>{{ r.fim ? data(r.fim) : t('repasse.rateioCusto.vigente') }}</td>
          <td>
            <template v-if="podeEditar && (r.fim === null || r.fim >= hoje)">
              <input
                v-model="fimEncerrar[`rateio-${r.id}`]"
                type="date"
                :min="r.inicio"
                :max="r.fim ?? undefined"
                :aria-label="t('repasse.rateioCusto.dataEncerrar')"
                :data-testid="`rc-regra-fim-${r.id}`"
              />
              <button
                type="button"
                :data-testid="`rc-regra-encerrar-${r.id}`"
                @click="encerrar('rateio', r.id, r.versao)"
              >
                {{ t('repasse.rateioCusto.encerrar') }}
              </button>
            </template>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else>{{ t('repasse.nenhum') }}</p>

    <fieldset v-if="podeEditar" data-testid="rc-nova-regra">
      <legend>{{ t('repasse.rateioCusto.incluirRegra') }}</legend>
      <div class="filtros acoes">
        <span class="campo">
          <SanteSelecao
            v-model="regra.dono"
            :rotulo="t('repasse.rateioCusto.dono')"
            :opcoes="
              (['medico', 'grupo'] as const).map((x) => ({
                valor: x,
                rotulo: t(`repasse.rateioCusto.donos.${x}`),
              }))
            "
            data-testid="rc-regra-dono"
          />
        </span>
        <span v-if="regra.dono === 'grupo'" class="campo">
          <SanteSelecao
            v-model="regra.grupo"
            :rotulo="t('repasse.rateioCusto.grupo')"
            :opcoes="[
              { valor: 0, rotulo: '—' },
              ...(dados?.grupos ?? []).map((g) => ({ valor: g.id, rotulo: g.descricao })),
            ]"
            data-testid="rc-regra-grupo"
          />
        </span>
        <span class="campo">
          <label for="rc-regra-descricao">{{ t('repasse.rateioCusto.descricao') }}</label>
          <input
            id="rc-regra-descricao"
            v-model="regra.descricao"
            maxlength="150"
            data-testid="rc-regra-descricao"
          />
        </span>
        <span class="campo">
          <SanteSelecao
            v-model="regra.base"
            :rotulo="t('repasse.rateioCusto.base')"
            :opcoes="
              (['repasse', 'custo'] as const).map((x) => ({
                valor: x,
                rotulo: t(`repasse.rateioCusto.bases.${x}`),
              }))
            "
            data-testid="rc-regra-base"
          />
        </span>
        <span class="campo">
          <label for="rc-regra-inicio">{{ t('repasse.rateioCusto.inicio') }}</label>
          <input id="rc-regra-inicio" v-model="regra.inicio" type="date" data-testid="rc-regra-inicio" />
        </span>
        <span class="campo">
          <label for="rc-regra-fim">{{ t('repasse.rateioCusto.fim') }}</label>
          <input id="rc-regra-fim" v-model="regra.fim" type="date" :min="regra.inicio" />
        </span>
      </div>
      <div
        v-for="(s, i) in regra.setores"
        :key="i"
        class="filtros acoes"
        :data-testid="`rc-regra-linha-${i}`"
      >
        <span class="campo">
          <SanteSelecao
            v-model="s.setor"
            :rotulo="t('repasse.rateioCusto.setor')"
            :opcoes="opcoesSetores"
            :busca="true"
            :data-testid="`rc-regra-setor-${i}`"
          />
        </span>
        <small v-if="centroDoSetor(s.setor)" class="secundario">{{ centroDoSetor(s.setor) }}</small>
        <span class="campo">
          <label :for="`rc-regra-pct-${i}`">{{ t('repasse.rateioCusto.percentual') }}</label>
          <input
            :id="`rc-regra-pct-${i}`"
            v-model="s.percentual"
            type="number"
            min="0.0001"
            max="100"
            step="0.0001"
            :data-testid="`rc-regra-pct-${i}`"
          />
        </span>
        <button
          v-if="regra.setores.length > 1"
          type="button"
          :data-testid="`rc-regra-tirar-${i}`"
          @click="regra.setores.splice(i, 1)"
        >
          {{ t('repasse.rateioCusto.removerSetor') }}
        </button>
      </div>
      <div class="filtros acoes">
        <button
          type="button"
          data-testid="rc-regra-mais-setor"
          @click="regra.setores.push({ setor: 0, percentual: Math.max(0, 100 - soma) })"
        >
          {{ t('repasse.rateioCusto.incluirSetor') }}
        </button>
        <output data-testid="rc-regra-soma" role="status">
          {{ soma === 100 ? t('repasse.rateioCusto.somaOk') : t('repasse.rateioCusto.soma', { soma }) }}
        </output>
        <button type="button" :disabled="!regraValida" data-testid="rc-regra-incluir" @click="incluirRegra">
          {{ t('repasse.rateioCusto.incluirRegra') }}
        </button>
      </div>
    </fieldset>

    <!-- Rateio da apuração -->
    <h2>{{ t('repasse.rateioCusto.apuracao') }}</h2>
    <div class="filtros acoes">
      <span class="campo">
        <SanteSelecao
          v-model="apuracao"
          :rotulo="t('repasse.rateioCusto.escolhaApuracao')"
          :opcoes="[
            { valor: 0, rotulo: t('repasse.rateioCusto.nenhumaApuracao') },
            ...(dados?.apuracoes ?? []).map((a) => ({
              valor: a.id,
              rotulo: `${a.numero} · ${data(a.competencia).slice(3)} · ${a.situacao}`,
            })),
          ]"
          data-testid="rc-apuracao"
        />
      </span>
      <button
        v-if="podeRatear && rateio.data.value?.rateavel"
        type="button"
        data-testid="rc-ratear"
        @click="ratear"
      >
        {{ t('repasse.rateioCusto.ratear') }}
      </button>
    </div>
    <template v-if="rateio.data.value">
      <ErroFaturamento v-if="rateio.error.value" :erro="rateio.error.value" />
      <p v-if="!rateio.data.value.rateavel" class="secundario">{{ t('repasse.rateioCusto.naoRateavel') }}</p>
      <h3>{{ t('repasse.rateioCusto.totaisSetor') }}</h3>
      <table v-if="rateio.data.value.totaisPorSetor.length" class="tabela" data-testid="rc-totais">
        <tbody>
          <tr
            v-for="s in rateio.data.value.totaisPorSetor"
            :key="s.setor"
            :data-testid="`rc-total-${s.setor}`"
          >
            <th scope="row">{{ s.setorNome }}</th>
            <td>{{ reais(s.valor) }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else>{{ t('repasse.rateioCusto.semRateio') }}</p>
      <h3>{{ t('repasse.rateioCusto.gravado') }}</h3>
      <ul data-testid="rc-gravado">
        <li v-for="g in rateio.data.value.gravado" :key="`${g.profissional}-${g.setor}`">
          {{ g.profissionalNome }} · {{ g.setorNome }} · {{ reais(g.valor) }}
        </li>
      </ul>
      <h3>{{ t('repasse.rateioCusto.previsto') }}</h3>
      <ul data-testid="rc-previsto">
        <li v-for="p in rateio.data.value.simulado" :key="`${p.profissional}-${p.setor}`">
          {{ nomeDoMedico(p.profissional) }} · {{ nomeDoSetor(p.setor) }} ·
          {{ t(`repasse.rateioCusto.bases.${p.base}`) }} · {{ reais(p.valor) }}
        </li>
      </ul>
      <template v-if="rateio.data.value.pendencias.length">
        <h3>{{ t('repasse.rateioCusto.pendencias') }}</h3>
        <ul data-testid="rc-pendencias">
          <li v-for="p in rateio.data.value.pendencias" :key="p.profissional">
            {{ nomeDoMedico(p.profissional) }}: {{ t(`repasse.rateioCusto.motivos.${p.motivo}`) }}
          </li>
        </ul>
      </template>
    </template>

    <!-- Tipos de desconto -->
    <h2>{{ t('repasse.rateioCusto.tipos') }}</h2>
    <table v-if="dados?.tipos.length" class="tabela" data-testid="rc-tipos">
      <thead>
        <tr>
          <th scope="col">{{ t('repasse.rateioCusto.codigo') }}</th>
          <th scope="col">{{ t('repasse.rateioCusto.descricao') }}</th>
          <th scope="col">{{ t('repasse.rateioCusto.natureza') }}</th>
          <th scope="col">{{ t('repasse.rateioCusto.formaTipo') }}</th>
          <th scope="col">{{ t('repasse.acoes') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="x in dados.tipos"
          :key="x.id"
          :class="{ secundario: !x.ativo }"
          :data-testid="`rc-tipo-${x.id}`"
        >
          <td>{{ x.codigo }}</td>
          <td>{{ x.descricao }}</td>
          <td>{{ t(`repasse.rateioCusto.naturezas.${x.natureza}`, x.natureza) }}</td>
          <td>
            {{ t(`repasse.rateioCusto.formasTipo.${x.forma}`) }}
            <template v-if="x.forma === 'valor_fixo'"> · {{ reais(x.valorPadrao ?? 0) }}</template>
            <template v-if="x.forma === 'percentual'"> · {{ x.percentualPadrao }}%</template>
          </td>
          <td>
            <button
              v-if="podeEditar"
              type="button"
              :data-testid="`rc-tipo-situacao-${x.id}`"
              @click="
                agir(
                  () => situacaoTipoDesconto(x.id, x.versao, !x.ativo),
                  x.ativo ? t('repasse.rateioCusto.inativo') : t('repasse.rateioCusto.ativo'),
                )
              "
            >
              {{ x.ativo ? t('repasse.rateioCusto.inativar') : t('repasse.rateioCusto.ativar') }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <fieldset v-if="podeEditar" data-testid="rc-novo-tipo">
      <legend>{{ t('repasse.rateioCusto.incluirTipo') }}</legend>
      <div class="filtros acoes">
        <span class="campo">
          <label for="rc-tipo-codigo">{{ t('repasse.rateioCusto.codigo') }}</label>
          <input id="rc-tipo-codigo" v-model="tipo.codigo" maxlength="30" data-testid="rc-tipo-codigo" />
        </span>
        <span class="campo">
          <label for="rc-tipo-descricao">{{ t('repasse.rateioCusto.descricao') }}</label>
          <input
            id="rc-tipo-descricao"
            v-model="tipo.descricao"
            maxlength="150"
            data-testid="rc-tipo-descricao"
          />
        </span>
        <span class="campo">
          <SanteSelecao
            v-model="tipo.natureza"
            :rotulo="t('repasse.rateioCusto.natureza')"
            :opcoes="naturezas.map((x) => ({ valor: x, rotulo: t(`repasse.rateioCusto.naturezas.${x}`) }))"
            data-testid="rc-tipo-natureza"
          />
        </span>
        <span class="campo">
          <SanteSelecao
            v-model="tipo.forma"
            :rotulo="t('repasse.rateioCusto.formaTipo')"
            :opcoes="
              (['informado', 'valor_fixo', 'percentual'] as const).map((x) => ({
                valor: x,
                rotulo: t(`repasse.rateioCusto.formasTipo.${x}`),
              }))
            "
            data-testid="rc-tipo-forma"
          />
        </span>
        <span v-if="tipo.forma !== 'informado'" class="campo">
          <label for="rc-tipo-padrao">{{ t('repasse.rateioCusto.padrao') }}</label>
          <input
            id="rc-tipo-padrao"
            v-model="tipo.padrao"
            type="number"
            min="0"
            step="0.01"
            data-testid="rc-tipo-padrao"
          />
        </span>
        <button type="button" :disabled="!tipoValido" data-testid="rc-tipo-incluir" @click="incluirTipo">
          {{ t('repasse.rateioCusto.incluirTipo') }}
        </button>
      </div>
    </fieldset>
  </section>
</template>
