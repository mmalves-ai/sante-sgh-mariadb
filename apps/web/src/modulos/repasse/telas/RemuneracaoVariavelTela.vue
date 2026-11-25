<script setup lang="ts">
import { SanteSelecao } from '@sgh/ui';
// Remuneração variável do profissional (F8, 07-FIN linha 157): `/repasse/remuneracao-variavel`. Visão por médico: a
// busca escolhe o médico e a tela mostra, de uma vez, o mínimo garantido, o percentual do resultado do centro de custo
// (ou do estabelecimento), as metas de produtividade com faixas (conferidas na hora pela mesma regra do domínio) e o
// valor apurado por competência, o custo do prestador (só leitura, do cadastro) e, embaixo, o que cada apuração em
// aberto vai lançar, com a marcação lançado/a lançar e o botão de lançar. Encerrar vigência nunca apaga nada.
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../../faturamento/componentes/MensagemFaturamento.vue';
import BuscaPrestador from '../componentes/BuscaPrestador.vue';
import {
  encerrarRegraVariavel,
  type FaixaMeta,
  type FormaPremio,
  incluirMeta,
  incluirMinimo,
  incluirResultado,
  informarApurado,
  lancarVariavel,
  lerPainelVariavel,
  problemasDasFaixas,
  simularVariavel,
  type TipoRegraVariavel,
} from '../api-remuneracao-variavel.js';
import { data, reais, usarRepasse } from '../usar-repasse.js';

const { t } = useI18n();
const qc = useQueryClient();
const { apoio, tem } = usarRepasse();
const podeEditar = computed(() => tem('repasse.regra.propor'));
const podeLancar = computed(() => tem('repasse.lancamento.criar'));
const hoje = computed(() => apoio.data.value?.hoje ?? new Date().toISOString().slice(0, 10));
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);

const medico = ref('');
const registro = ref('');
const profissional = computed(() => Number(medico.value) || 0);
const painel = useQuery({
  queryKey: computed(() => ['repasse', 'remuneracao-variavel', profissional.value]),
  queryFn: () => lerPainelVariavel(profissional.value),
  enabled: computed(() => profissional.value > 0),
});
const p = computed(() => painel.data.value);
const opEventos = computed(() =>
  (p.value?.eventos ?? []).map((e) => ({ valor: String(e.id), rotulo: `${e.codigo} — ${e.nome}` })),
);
const opCentros = computed(() => [
  { valor: '', rotulo: t('repasse.remuneracaoVariavel.resultado.estabelecimento') },
  ...(p.value?.centros ?? []).map((c) => ({ valor: String(c.id), rotulo: `${c.codigo} — ${c.nome}` })),
]);
const opIndicadores = computed(() =>
  (p.value?.indicadores ?? []).map((i) => ({
    valor: String(i.id),
    rotulo: `${i.codigo} — ${i.descricao}${i.unidade ? ` (${i.unidade})` : ''}`,
  })),
);
const opFormas = computed(() =>
  (['percentual_producao', 'valor_fixo'] as const).map((f) => ({
    valor: f,
    rotulo: t(`repasse.remuneracaoVariavel.meta.formas.${f}`),
  })),
);
const vigencia = (r: { inicio: string; fim: string | null }) =>
  `${data(r.inicio)} – ${r.fim ? data(r.fim) : t('repasse.remuneracaoVariavel.semFim')}`;
const vigenciaOk = (f: { inicio: string; fim: string }) =>
  f.inicio !== '' && (f.fim === '' || f.fim >= f.inicio);

async function gravar(fn: () => Promise<unknown>, texto: string): Promise<boolean> {
  erro.value = null;
  mensagem.value = null;
  try {
    await fn();
    mensagem.value = texto;
    await qc.invalidateQueries({ queryKey: ['repasse', 'remuneracao-variavel'] });
    return true;
  } catch (e) {
    erro.value = e;
    return false;
  }
}
const base = (f: { evento: string; inicio: string; fim: string }) => ({
  profissional: profissional.value,
  evento: Number(f.evento),
  inicio: f.inicio,
  fim: f.fim || null,
});

// ── Mínimo garantido ──
const fMin = reactive({ valor: 0, evento: '', inicio: '', fim: '' });
const minValido = computed(() => fMin.valor > 0 && fMin.evento !== '' && vigenciaOk(fMin));
async function salvarMinimo() {
  const ok = await gravar(
    () => incluirMinimo({ ...base(fMin), valorMinimo: Number(fMin.valor), complementoAutomatico: true }),
    t('repasse.remuneracaoVariavel.gravado'),
  );
  if (ok) fMin.valor = 0;
}

// ── Percentual do resultado ──
const fRes = reactive({ centro: '', percentual: 0, evento: '', inicio: '', fim: '' });
const resValido = computed(
  () => fRes.percentual > 0 && fRes.percentual <= 100 && fRes.evento !== '' && vigenciaOk(fRes),
);
async function salvarResultado() {
  const ok = await gravar(
    () =>
      incluirResultado({
        ...base(fRes),
        centroCusto: Number(fRes.centro) || null,
        percentual: Number(fRes.percentual),
      }),
    t('repasse.remuneracaoVariavel.gravado'),
  );
  if (ok) fRes.percentual = 0;
}

// ── Metas de produtividade ──
const fMeta = reactive({
  indicador: '',
  centro: '',
  evento: '',
  forma: 'percentual_producao' as FormaPremio,
  peso: 100,
  inicio: '',
  fim: '',
  faixas: [{ de: 0, ate: null, premio: 0 }] as FaixaMeta[],
});
const faixasLimpas = computed<FaixaMeta[]>(() =>
  fMeta.faixas.map((f) => ({
    de: Number(f.de),
    ate: f.ate === null || String(f.ate) === '' ? null : Number(f.ate),
    premio: Number(f.premio),
  })),
);
const problemasMeta = computed(() => problemasDasFaixas(fMeta.forma, faixasLimpas.value));
const metaValida = computed(
  () =>
    fMeta.indicador !== '' &&
    fMeta.evento !== '' &&
    fMeta.peso > 0 &&
    fMeta.peso <= 100 &&
    vigenciaOk(fMeta) &&
    problemasMeta.value.length === 0,
);
function maisFaixa() {
  const ult = faixasLimpas.value[faixasLimpas.value.length - 1];
  fMeta.faixas.push({
    de: ult?.ate !== null && ult?.ate !== undefined ? ult.ate + 1 : 0,
    ate: null,
    premio: 0,
  });
}
async function salvarMeta() {
  const ok = await gravar(
    () =>
      incluirMeta({
        ...base(fMeta),
        indicador: Number(fMeta.indicador),
        centroCusto: Number(fMeta.centro) || null,
        forma: fMeta.forma,
        peso: Number(fMeta.peso),
        faixas: faixasLimpas.value,
      }),
    t('repasse.remuneracaoVariavel.gravado'),
  );
  if (ok) fMeta.faixas = [{ de: 0, ate: null, premio: 0 }];
}
const apurado = reactive<Record<number, { competencia: string; valor: number | '' }>>({});
async function salvarApurado(meta: number) {
  const a = apurado[meta];
  if (!a) return;
  const ok = await gravar(
    () => informarApurado(meta, { competencia: `${a.competencia}-01`, valor: Number(a.valor) }),
    t('repasse.remuneracaoVariavel.gravado'),
  );
  if (ok) a.valor = '';
}

// ── Encerrar vigência (nada apagado) ──
const fimEncerrar = reactive<Record<string, string>>({});
const chave = (tipo: TipoRegraVariavel, id: number) => `${tipo}-${id}`;
// Os campos de cada linha começam preenchidos (fim = hoje; competência = o mês corrente), fora do desenho da tela.
watch(
  [p, hoje],
  ([v, h]) => {
    for (const f of [fMin, fRes, fMeta]) f.inicio ||= h;
    if (!v) return;
    const linhas: [TipoRegraVariavel, { id: number }[]][] = [
      ['minimo', v.minimos],
      ['resultado', v.resultados],
      ['meta', v.metas],
    ];
    for (const [tipo, rs] of linhas) for (const r of rs) fimEncerrar[chave(tipo, r.id)] ??= h;
    for (const m of v.metas) apurado[m.id] ??= { competencia: h.slice(0, 7), valor: '' };
  },
  { immediate: true },
);
async function encerrar(tipo: TipoRegraVariavel, r: { id: number; versao: number; inicio: string }) {
  const fim = fimEncerrar[chave(tipo, r.id)] ?? hoje.value;
  if (fim < r.inicio) return;
  await gravar(
    () => encerrarRegraVariavel(tipo, r.id, r.versao, fim),
    t('repasse.remuneracaoVariavel.encerrado'),
  );
}

// ── Na apuração ──
const apuracao = ref('');
const opApuracoes = computed(() =>
  (p.value?.apuracoes ?? []).map((a) => ({ valor: String(a.id), rotulo: `${a.numero} — ${a.competencia}` })),
);
const simulacao = useQuery({
  queryKey: computed(() => [
    'repasse',
    'remuneracao-variavel',
    'simulacao',
    apuracao.value,
    profissional.value,
  ]),
  queryFn: () => simularVariavel(Number(apuracao.value), profissional.value),
  enabled: computed(() => Number(apuracao.value) > 0 && profissional.value > 0),
});
const doMedico = computed(() =>
  simulacao.data.value?.profissionais.find((x) => x.profissional === profissional.value),
);
const aLancar = computed(() => (doMedico.value?.itens ?? []).filter((i) => !i.lancado).length);
async function lancar() {
  erro.value = null;
  mensagem.value = null;
  try {
    const r = await lancarVariavel(Number(apuracao.value), profissional.value);
    mensagem.value = t('repasse.remuneracaoVariavel.apuracao.lancou', {
      lancamentos: r.lancamentos,
      descontos: r.descontos,
    });
    await qc.invalidateQueries({ queryKey: ['repasse', 'remuneracao-variavel'] });
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <section
    class="tela-agenda tela-repasse"
    aria-labelledby="rv-titulo"
    data-testid="tela-rep-remuneracao-variavel"
  >
    <h1 id="rv-titulo">{{ t('repasse.remuneracaoVariavel.titulo') }}</h1>
    <p class="secundario">{{ t('repasse.remuneracaoVariavel.resumo') }}</p>
    <div class="filtros acoes">
      <BuscaPrestador
        v-model="medico"
        v-model:registro="registro"
        :rotulo="t('repasse.remuneracaoVariavel.medico')"
        testid="rv-medico"
      />
    </div>
    <ErroFaturamento v-if="painel.error.value" :erro="painel.error.value" />

    <template v-if="profissional && p">
      <!-- Mínimo garantido -->
      <h2>{{ t('repasse.remuneracaoVariavel.minimo.titulo') }}</h2>
      <p class="secundario">{{ t('repasse.remuneracaoVariavel.minimo.explica') }}</p>
      <table v-if="p.minimos.length" class="tabela" data-testid="rv-minimos">
        <thead>
          <tr>
            <th scope="col">{{ t('repasse.remuneracaoVariavel.minimo.valor') }}</th>
            <th scope="col">{{ t('repasse.remuneracaoVariavel.evento') }}</th>
            <th scope="col">{{ t('repasse.remuneracaoVariavel.vigencia') }}</th>
            <th v-if="podeEditar" scope="col">{{ t('repasse.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in p.minimos" :key="m.id" :data-testid="`rv-minimo-${m.id}`">
            <td>{{ reais(m.valorMinimo) }}</td>
            <td>{{ m.eventoNome }}</td>
            <td>{{ vigencia(m) }}</td>
            <td v-if="podeEditar">
              <input
                v-model="fimEncerrar[chave('minimo', m.id)]"
                type="date"
                :min="m.inicio"
                :aria-label="t('repasse.remuneracaoVariavel.encerrarEm')"
              />
              <button
                type="button"
                :data-testid="`rv-encerrar-minimo-${m.id}`"
                @click="encerrar('minimo', m)"
              >
                {{ t('repasse.remuneracaoVariavel.encerrar') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="podeEditar" class="filtros acoes">
        <span class="campo">
          <label for="rv-min-valor">{{ t('repasse.remuneracaoVariavel.minimo.valor') }}</label>
          <input
            id="rv-min-valor"
            v-model.number="fMin.valor"
            type="number"
            min="0.01"
            step="0.01"
            data-testid="rv-min-valor"
          />
        </span>
        <span class="campo">
          <SanteSelecao
            v-model="fMin.evento"
            :rotulo="t('repasse.remuneracaoVariavel.evento')"
            :opcoes="opEventos"
            data-testid="rv-min-evento"
          />
        </span>
        <span class="campo">
          <label for="rv-min-inicio">{{ t('repasse.remuneracaoVariavel.inicio') }}</label>
          <input id="rv-min-inicio" v-model="fMin.inicio" type="date" data-testid="rv-min-inicio" />
        </span>
        <span class="campo">
          <label for="rv-min-fim">{{ t('repasse.remuneracaoVariavel.fimOpcional') }}</label>
          <input id="rv-min-fim" v-model="fMin.fim" type="date" :min="fMin.inicio" data-testid="rv-min-fim" />
        </span>
        <button type="button" :disabled="!minValido" data-testid="rv-min-incluir" @click="salvarMinimo">
          {{ t('repasse.remuneracaoVariavel.incluir') }}
        </button>
      </div>

      <!-- Percentual do resultado -->
      <h2>{{ t('repasse.remuneracaoVariavel.resultado.titulo') }}</h2>
      <p class="secundario">{{ t('repasse.remuneracaoVariavel.resultado.explica') }}</p>
      <table v-if="p.resultados.length" class="tabela" data-testid="rv-resultados">
        <thead>
          <tr>
            <th scope="col">{{ t('repasse.remuneracaoVariavel.resultado.centro') }}</th>
            <th scope="col">{{ t('repasse.remuneracaoVariavel.resultado.percentual') }}</th>
            <th scope="col">{{ t('repasse.remuneracaoVariavel.evento') }}</th>
            <th scope="col">{{ t('repasse.remuneracaoVariavel.vigencia') }}</th>
            <th v-if="podeEditar" scope="col">{{ t('repasse.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in p.resultados" :key="r.id" :data-testid="`rv-resultado-${r.id}`">
            <td>{{ r.centroNome ?? t('repasse.remuneracaoVariavel.resultado.estabelecimento') }}</td>
            <td>{{ r.percentual }}</td>
            <td>{{ r.eventoNome }}</td>
            <td>{{ vigencia(r) }}</td>
            <td v-if="podeEditar">
              <input
                v-model="fimEncerrar[chave('resultado', r.id)]"
                type="date"
                :min="r.inicio"
                :aria-label="t('repasse.remuneracaoVariavel.encerrarEm')"
              />
              <button
                type="button"
                :data-testid="`rv-encerrar-resultado-${r.id}`"
                @click="encerrar('resultado', r)"
              >
                {{ t('repasse.remuneracaoVariavel.encerrar') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="podeEditar" class="filtros acoes">
        <span class="campo">
          <SanteSelecao
            v-model="fRes.centro"
            :rotulo="t('repasse.remuneracaoVariavel.resultado.centro')"
            :opcoes="opCentros"
            data-testid="rv-res-centro"
          />
        </span>
        <span class="campo">
          <label for="rv-res-percentual">{{ t('repasse.remuneracaoVariavel.resultado.percentual') }}</label>
          <input
            id="rv-res-percentual"
            v-model.number="fRes.percentual"
            type="number"
            min="0.01"
            max="100"
            step="0.01"
            data-testid="rv-res-percentual"
          />
        </span>
        <span class="campo">
          <SanteSelecao
            v-model="fRes.evento"
            :rotulo="t('repasse.remuneracaoVariavel.evento')"
            :opcoes="opEventos"
            data-testid="rv-res-evento"
          />
        </span>
        <span class="campo">
          <label for="rv-res-inicio">{{ t('repasse.remuneracaoVariavel.inicio') }}</label>
          <input id="rv-res-inicio" v-model="fRes.inicio" type="date" data-testid="rv-res-inicio" />
        </span>
        <span class="campo">
          <label for="rv-res-fim">{{ t('repasse.remuneracaoVariavel.fimOpcional') }}</label>
          <input id="rv-res-fim" v-model="fRes.fim" type="date" :min="fRes.inicio" data-testid="rv-res-fim" />
        </span>
        <button type="button" :disabled="!resValido" data-testid="rv-res-incluir" @click="salvarResultado">
          {{ t('repasse.remuneracaoVariavel.incluir') }}
        </button>
      </div>

      <!-- Metas de produtividade -->
      <h2>{{ t('repasse.remuneracaoVariavel.meta.titulo') }}</h2>
      <table v-if="p.metas.length" class="tabela" data-testid="rv-metas">
        <thead>
          <tr>
            <th scope="col">{{ t('repasse.remuneracaoVariavel.meta.indicador') }}</th>
            <th scope="col">{{ t('repasse.remuneracaoVariavel.meta.forma') }}</th>
            <th scope="col">{{ t('repasse.remuneracaoVariavel.meta.faixas') }}</th>
            <th scope="col">{{ t('repasse.remuneracaoVariavel.meta.ultimos') }}</th>
            <th scope="col">{{ t('repasse.remuneracaoVariavel.vigencia') }}</th>
            <th v-if="podeEditar" scope="col">{{ t('repasse.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in p.metas" :key="m.id" :data-testid="`rv-meta-${m.id}`">
            <td>
              {{ m.indicadorCodigo }} — {{ m.indicadorDescricao }}
              <span v-if="m.centroNome" class="secundario"> · {{ m.centroNome }}</span>
            </td>
            <td>
              {{ t(`repasse.remuneracaoVariavel.meta.formas.${m.forma}`) }} ·
              {{ t('repasse.remuneracaoVariavel.meta.peso') }} {{ m.peso }}
            </td>
            <td>
              <span v-for="(f, i) in m.faixas" :key="i" class="secundario">
                {{ `${f.de}–${f.ate ?? '∞'}: ${f.premio}` }}<br />
              </span>
            </td>
            <td :data-testid="`rv-apurados-${m.id}`">
              <span v-for="a in m.apurados.slice(0, 3)" :key="a.competencia">
                {{ a.competencia.slice(0, 7) }}: {{ a.valor }} {{ m.unidade ?? '' }}<br />
              </span>
            </td>
            <td>{{ vigencia(m) }}</td>
            <td v-if="podeEditar && apurado[m.id]">
              <span class="campo">
                <label :for="`rv-apu-comp-${m.id}`">{{
                  t('repasse.remuneracaoVariavel.meta.competencia')
                }}</label>
                <input
                  :id="`rv-apu-comp-${m.id}`"
                  v-model="apurado[m.id]!.competencia"
                  type="month"
                  :data-testid="`rv-apu-comp-${m.id}`"
                />
              </span>
              <span class="campo">
                <label :for="`rv-apu-valor-${m.id}`">{{
                  t('repasse.remuneracaoVariavel.meta.apurado')
                }}</label>
                <input
                  :id="`rv-apu-valor-${m.id}`"
                  v-model.number="apurado[m.id]!.valor"
                  type="number"
                  step="any"
                  :data-testid="`rv-apu-valor-${m.id}`"
                />
              </span>
              <button
                type="button"
                :disabled="apurado[m.id]!.valor === '' || !apurado[m.id]!.competencia"
                :data-testid="`rv-apu-informar-${m.id}`"
                @click="salvarApurado(m.id)"
              >
                {{ t('repasse.remuneracaoVariavel.meta.informar') }}
              </button>
              <input
                v-model="fimEncerrar[chave('meta', m.id)]"
                type="date"
                :min="m.inicio"
                :aria-label="t('repasse.remuneracaoVariavel.encerrarEm')"
              />
              <button type="button" :data-testid="`rv-encerrar-meta-${m.id}`" @click="encerrar('meta', m)">
                {{ t('repasse.remuneracaoVariavel.encerrar') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <fieldset v-if="podeEditar">
        <legend>{{ t('repasse.remuneracaoVariavel.incluir') }}</legend>
        <div class="filtros acoes">
          <span class="campo">
            <SanteSelecao
              v-model="fMeta.indicador"
              :rotulo="t('repasse.remuneracaoVariavel.meta.indicador')"
              :opcoes="opIndicadores"
              data-testid="rv-meta-indicador"
            />
          </span>
          <span class="campo">
            <SanteSelecao
              v-model="fMeta.centro"
              :rotulo="t('repasse.remuneracaoVariavel.resultado.centro')"
              :opcoes="opCentros"
              data-testid="rv-meta-centro"
            />
          </span>
          <span class="campo">
            <SanteSelecao
              v-model="fMeta.forma"
              :rotulo="t('repasse.remuneracaoVariavel.meta.forma')"
              :opcoes="opFormas"
              data-testid="rv-meta-forma"
            />
          </span>
          <span class="campo">
            <label for="rv-meta-peso">{{ t('repasse.remuneracaoVariavel.meta.peso') }}</label>
            <input
              id="rv-meta-peso"
              v-model.number="fMeta.peso"
              type="number"
              min="1"
              max="100"
              data-testid="rv-meta-peso"
            />
          </span>
          <span class="campo">
            <SanteSelecao
              v-model="fMeta.evento"
              :rotulo="t('repasse.remuneracaoVariavel.evento')"
              :opcoes="opEventos"
              data-testid="rv-meta-evento"
            />
          </span>
          <span class="campo">
            <label for="rv-meta-inicio">{{ t('repasse.remuneracaoVariavel.inicio') }}</label>
            <input id="rv-meta-inicio" v-model="fMeta.inicio" type="date" data-testid="rv-meta-inicio" />
          </span>
          <span class="campo">
            <label for="rv-meta-fim">{{ t('repasse.remuneracaoVariavel.fimOpcional') }}</label>
            <input
              id="rv-meta-fim"
              v-model="fMeta.fim"
              type="date"
              :min="fMeta.inicio"
              data-testid="rv-meta-fim"
            />
          </span>
        </div>
        <table class="tabela" data-testid="rv-faixas">
          <caption>
            {{
              t('repasse.remuneracaoVariavel.meta.faixas')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('repasse.remuneracaoVariavel.meta.de') }}</th>
              <th scope="col">{{ t('repasse.remuneracaoVariavel.meta.ate') }}</th>
              <th scope="col">{{ t('repasse.remuneracaoVariavel.meta.premio') }}</th>
              <th scope="col">{{ t('repasse.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(f, i) in fMeta.faixas" :key="i">
              <td>
                <input
                  v-model.number="f.de"
                  type="number"
                  step="any"
                  :aria-label="t('repasse.remuneracaoVariavel.meta.de')"
                  :data-testid="`rv-faixa-de-${i}`"
                />
              </td>
              <td>
                <input
                  v-model.number="f.ate"
                  type="number"
                  step="any"
                  :aria-label="t('repasse.remuneracaoVariavel.meta.ate')"
                  :data-testid="`rv-faixa-ate-${i}`"
                />
              </td>
              <td>
                <input
                  v-model.number="f.premio"
                  type="number"
                  step="any"
                  min="0"
                  :aria-label="t('repasse.remuneracaoVariavel.meta.premio')"
                  :data-testid="`rv-faixa-premio-${i}`"
                />
              </td>
              <td>
                <button
                  type="button"
                  :disabled="fMeta.faixas.length < 2"
                  :data-testid="`rv-faixa-tirar-${i}`"
                  @click="fMeta.faixas.splice(i, 1)"
                >
                  {{ t('repasse.remuneracaoVariavel.meta.tirarFaixa') }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <ul v-if="problemasMeta.length" role="alert" data-testid="rv-faixas-problemas">
          <li v-for="x in problemasMeta" :key="x">{{ x }}</li>
        </ul>
        <div class="acoes">
          <button
            type="button"
            :disabled="fMeta.faixas.length >= 20"
            data-testid="rv-faixa-mais"
            @click="maisFaixa"
          >
            {{ t('repasse.remuneracaoVariavel.meta.maisFaixa') }}
          </button>
          <button type="button" :disabled="!metaValida" data-testid="rv-meta-incluir" @click="salvarMeta">
            {{ t('repasse.remuneracaoVariavel.incluir') }}
          </button>
        </div>
      </fieldset>

      <!-- Custo do prestador (cadastro do profissional; só leitura) -->
      <h2>{{ t('repasse.remuneracaoVariavel.custo.titulo') }}</h2>
      <p class="secundario">{{ t('repasse.remuneracaoVariavel.custo.explica') }}</p>
      <table v-if="p.custos.length" class="tabela" data-testid="rv-custos">
        <tbody>
          <tr v-for="c in p.custos" :key="c.id">
            <td>{{ c.descricao }}</td>
            <td>{{ c.valor !== null ? reais(c.valor) : `${c.percentual}%` }}</td>
            <td>
              <template v-if="c.faixaInicial !== null || c.faixaFinal !== null">
                {{ `${reais(c.faixaInicial ?? 0)} – ${c.faixaFinal !== null ? reais(c.faixaFinal) : '∞'}` }}
              </template>
            </td>
            <td>
              {{
                ['mensal', 'por_apuracao', 'unica'].includes(c.frequencia)
                  ? t(`repasse.remuneracaoVariavel.custo.frequencias.${c.frequencia}`)
                  : c.frequencia
              }}
            </td>
            <td>{{ vigencia(c) }}</td>
          </tr>
        </tbody>
      </table>

      <!-- Na apuração -->
      <h2>{{ t('repasse.remuneracaoVariavel.apuracao.titulo') }}</h2>
      <p v-if="!opApuracoes.length" class="secundario" data-testid="rv-sem-apuracao">
        {{ t('repasse.remuneracaoVariavel.apuracao.nenhuma') }}
      </p>
      <div v-else class="filtros acoes">
        <span class="campo">
          <SanteSelecao
            v-model="apuracao"
            :rotulo="t('repasse.remuneracaoVariavel.apuracao.escolher')"
            :opcoes="opApuracoes"
            data-testid="rv-apuracao"
          />
        </span>
      </div>
      <ErroFaturamento v-if="simulacao.error.value" :erro="simulacao.error.value" />
      <template v-if="doMedico">
        <p data-testid="rv-sim-totais">
          {{ t('repasse.remuneracaoVariavel.apuracao.producao') }}: {{ reais(doMedico.producao) }} ·
          {{ t('repasse.remuneracaoVariavel.apuracao.credito') }}: {{ reais(doMedico.credito) }} ·
          {{ t('repasse.remuneracaoVariavel.apuracao.debito') }}: {{ reais(doMedico.debito) }}
        </p>
        <ul v-if="doMedico.pendencias.length" role="alert" data-testid="rv-sim-pendencias">
          <li v-for="x in doMedico.pendencias" :key="x">{{ x }}</li>
        </ul>
        <table v-if="doMedico.itens.length" class="tabela" data-testid="rv-sim-itens">
          <tbody>
            <tr v-for="(i, k) in doMedico.itens" :key="k" :data-testid="`rv-sim-item-${i.tipo}`">
              <td>{{ t(`repasse.remuneracaoVariavel.apuracao.tipos.${i.tipo}`) }}</td>
              <td>{{ i.sentido === 'debito' ? '−' : '+' }} {{ reais(i.valor) }}</td>
              <td class="secundario">{{ i.memoria }}</td>
              <td>
                {{
                  i.lancado
                    ? t('repasse.remuneracaoVariavel.apuracao.lancado')
                    : t('repasse.remuneracaoVariavel.apuracao.aLancar')
                }}
              </td>
            </tr>
          </tbody>
        </table>
        <button
          v-if="podeLancar"
          type="button"
          :disabled="aLancar === 0"
          data-testid="rv-lancar"
          @click="lancar"
        >
          {{ t('repasse.remuneracaoVariavel.apuracao.lancar') }}
        </button>
      </template>
    </template>

    <ErroFaturamento v-if="erro" :erro="erro" />
    <MensagemFaturamento :texto="mensagem" testid="rv-mensagem" />
  </section>
</template>
