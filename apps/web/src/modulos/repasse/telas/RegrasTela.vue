<script setup lang="ts">
// Regras de repasse e simulador (ficha do M33, seção 7): `/repasse/regras`. As regras vigentes do convênio na data
// (a usada em apuração não muda: a mudança é nova versão com vigência própria; regra 3), a proposta de regra nova ou de
// nova versão (rascunho), o simulador lado a lado (um item de exemplo contra as vigentes ou contra a proposta; nada é
// gravado) e a fila das propostas para o supervisor aprovar ou recusar (quem propôs não aprova). As vigentes filtram por
// convênio, procedimento e profissional (ficha §4) e vêm em páginas do servidor ("Carregar mais", com o aviso de que há
// mais); o médico é escolhido pela busca (nome e conselho).
import type { ListaRegrasRepasse, SimulacaoRepasseResposta, VersaoRegraResposta } from '@sgh/contratos';
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../../faturamento/componentes/MensagemFaturamento.vue';
import BuscaPrestador from '../componentes/BuscaPrestador.vue';
import { decidirRegra, lerRegras, lerVersoes, novaChave, proporRegra, simular } from '../api-repasse.js';
import { opcoes, reais, usarRepasse } from '../usar-repasse.js';

const { t } = useI18n();
const qc = useQueryClient();
const { apoio, pode, motivo, tem } = usarRepasse();
const hoje = computed(() => apoio.data.value?.hoje ?? '');
const filtro = reactive({ convenio: '', data: '', procedimento: '', profissional: '' });
const consulta = reactive({ convenio: 0, data: '', procedimento: 0, profissional: 0 });
const pedidoRegras = (depoisDe?: number) => ({
  convenio: consulta.convenio,
  data: consulta.data || hoje.value,
  procedimento: consulta.procedimento || undefined,
  profissional: consulta.profissional || undefined,
  depoisDe,
});
const regras = useQuery({
  queryKey: computed(() => [
    'repasse',
    'regras',
    consulta.convenio,
    consulta.data,
    consulta.procedimento,
    consulta.profissional,
  ]),
  queryFn: () => lerRegras(pedidoRegras()),
  enabled: computed(() => consulta.convenio > 0),
});
// As páginas seguintes (keyset do servidor: `depoisDe`), acrescentadas à primeira.
const mais = ref<ListaRegrasRepasse[]>([]);
const todas = computed(() => [...(regras.data.value?.regras ?? []), ...mais.value.flatMap((p) => p.regras)]);
const usadas = computed(
  () => new Set([...(regras.data.value?.usadas ?? []), ...mais.value.flatMap((p) => p.usadas)]),
);
const proxima = computed(() => (mais.value.at(-1) ?? regras.data.value)?.depoisDe ?? null);
const carregando = ref(false);
const erroMais = ref<unknown>(null);
async function carregarMais() {
  if (proxima.value === null) return;
  erroMais.value = null;
  carregando.value = true;
  try {
    mais.value = [...mais.value, await lerRegras(pedidoRegras(proxima.value))];
  } catch (e) {
    erroMais.value = e;
  } finally {
    carregando.value = false;
  }
}
const versoes = useQuery({ queryKey: ['repasse', 'versoes'], queryFn: () => lerVersoes() });
const convenios = computed(() => opcoes(apoio.data.value?.convenios, t('repasse.qualquer')));
const eventos = computed(() => opcoes(apoio.data.value?.eventos));
const bases = computed(() =>
  (['cobrado', 'recebido', 'misto'] as const).map((b) => ({ valor: b, rotulo: t(`repasse.base.${b}`) })),
);
const contas = [
  { valor: 'A', rotulo: 'Externa e internação' },
  { valor: 'E', rotulo: 'Externa' },
  { valor: 'I', rotulo: 'Internação' },
];
function consultar() {
  mais.value = [];
  consulta.convenio = Number(filtro.convenio) || 0;
  consulta.data = filtro.data || hoje.value;
  consulta.procedimento = Number(filtro.procedimento) || 0;
  consulta.profissional = Number(filtro.profissional) || 0;
}

const vazia = () => ({
  substitui: null as number | null,
  vigencia: hoje.value,
  profissional: '',
  convenio: filtro.convenio,
  procedimentoInicial: '',
  procedimentoFinal: '',
  tipoConta: 'A',
  percentual: '',
  valorFixo: '',
  base: apoio.data.value?.basePadrao ?? 'cobrado',
  evento: String(apoio.data.value?.eventos[0]?.codigo ?? ''),
  justificativa: '',
});
const form = reactive(vazia());
const editando = ref(false);
function nova(substitui: number | null = null) {
  Object.assign(form, vazia(), { substitui });
  editando.value = true;
}
const n = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')));

const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const gravando = ref(false);
async function propor() {
  erro.value = null;
  mensagem.value = null;
  gravando.value = true;
  try {
    const r = await proporRegra(
      {
        substitui: form.substitui,
        vigencia: form.vigencia,
        beneficiario: 'M',
        profissional: n(form.profissional),
        convenio: n(form.convenio),
        procedimentoInicial: n(form.procedimentoInicial),
        procedimentoFinal: n(form.procedimentoFinal),
        tipoConta: form.tipoConta,
        percentual: n(form.percentual) ?? 0,
        valorFixo: n(form.valorFixo) ?? 0,
        base: form.base,
        evento: Number(form.evento),
        justificativa: form.justificativa,
      },
      novaChave('propor'),
    );
    mensagem.value = r.mensagem;
    sim.versao = String(r.ids['versao'] ?? '');
    editando.value = false;
    await qc.invalidateQueries({ queryKey: ['repasse', 'versoes'] });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}

// ── Simulador ──
const sim = reactive({
  versao: '',
  convenio: '',
  procedimento: '',
  profissional: '',
  tipoConta: 'I',
  valorCobrado: '',
  valorRecebido: '',
});
const simulacao = ref<SimulacaoRepasseResposta | null>(null);
const erroSim = ref<unknown>(null);
async function rodarSimulador() {
  erroSim.value = null;
  simulacao.value = null;
  try {
    simulacao.value = await simular(
      {
        versao: n(sim.versao),
        data: hoje.value,
        convenio: Number(sim.convenio),
        procedimento: Number(sim.procedimento),
        profissional: n(sim.profissional),
        tipoConta: sim.tipoConta,
        valorCobrado: n(sim.valorCobrado) ?? 0,
        valorRecebido: n(sim.valorRecebido),
      },
      novaChave('simular'),
    );
    await qc.invalidateQueries({ queryKey: ['repasse', 'versoes'] });
  } catch (e) {
    erroSim.value = e;
  }
}
const versoesSim = computed(() => [
  { valor: '', rotulo: t('repasse.regras.vigentes') },
  ...(versoes.data.value ?? [])
    .filter((v) => v.estado === 'rascunho' || v.estado === 'simulada')
    .map((v) => ({ valor: String(v.id), rotulo: `${v.id} — ${t(`repasse.regras.estado.${v.estado}`)}` })),
]);

// ── Decisão do supervisor ──
const decisao = reactive<Record<number, string>>({});
const erroDecisao = ref<unknown>(null);
const mensagemDecisao = ref<string | null>(null);
async function decidir(v: VersaoRegraResposta, d: 'aprovar' | 'recusar') {
  erroDecisao.value = null;
  mensagemDecisao.value = null;
  try {
    const r = await decidirRegra(
      v.id,
      { decisao: d, justificativa: decisao[v.id] ?? '' },
      novaChave('decidir'),
    );
    mensagemDecisao.value = r.mensagem;
    await qc.invalidateQueries({ queryKey: ['repasse'] });
  } catch (e) {
    erroDecisao.value = e;
  }
}
const regraTexto = (p: VersaoRegraResposta['proposta']) =>
  `${p.convenio ?? t('repasse.qualquer')} · ${p.procedimentoInicial ?? t('repasse.qualquer')} · ${p.profissional ?? t('repasse.qualquer')} · ${p.percentual > 0 ? `${p.percentual}%` : reais(p.valorFixo)}`;
</script>

<template>
  <section class="tela-agenda tela-repasse" aria-labelledby="rg-titulo" data-testid="tela-rep-regras">
    <h1 id="rg-titulo">{{ t('repasse.regras.titulo') }}</h1>
    <ErroFaturamento v-if="apoio.error.value" :erro="apoio.error.value" />
    <form class="filtros" @submit.prevent="consultar">
      <span class="campo">
        <SanteSelecao
          v-model="filtro.convenio"
          :rotulo="t('repasse.convenio')"
          :opcoes="convenios"
          data-testid="rg-convenio"
        />
      </span>
      <span class="campo">
        <label for="rg-data">{{ t('repasse.data') }}</label>
        <input id="rg-data" v-model="filtro.data" type="date" data-testid="rg-data" />
      </span>
      <span class="campo">
        <label for="rg-f-proc">{{ t('repasse.procedimento') }}</label>
        <input
          id="rg-f-proc"
          v-model="filtro.procedimento"
          inputmode="numeric"
          data-testid="rg-filtro-procedimento"
        />
      </span>
      <BuscaPrestador
        v-model="filtro.profissional"
        :rotulo="t('repasse.profissional')"
        qualquer
        testid="rg-filtro-profissional"
      />
      <button type="submit" data-testid="rg-consultar">{{ t('repasse.consultar') }}</button>
      <button
        type="button"
        :disabled="!pode('proporRegra', 'repasse.regra.propor')"
        :title="motivo('proporRegra') ?? undefined"
        data-testid="rg-nova"
        @click="nova()"
      >
        {{ t('repasse.regras.nova') }}
      </button>
    </form>

    <h2>{{ t('repasse.regras.vigentes') }}</h2>
    <ErroFaturamento v-if="regras.error.value" :erro="regras.error.value" />
    <table v-else-if="todas.length" class="tabela" data-testid="rg-lista">
      <thead>
        <tr>
          <th scope="col">#</th>
          <th scope="col">{{ t('repasse.regras.vigencia') }}</th>
          <th scope="col">{{ t('repasse.profissional') }}</th>
          <th scope="col">{{ t('repasse.procedimento') }}</th>
          <th scope="col">{{ t('repasse.tipoConta') }}</th>
          <th scope="col">{{ t('repasse.regras.percentual') }}</th>
          <th scope="col">{{ t('repasse.regras.valorFixo') }}</th>
          <th scope="col">{{ t('repasse.acoes') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in todas" :key="r.id">
          <td>{{ r.id }}</td>
          <td>{{ r.vigencia }}</td>
          <td>{{ r.profissional ?? t('repasse.qualquer') }}</td>
          <td>
            {{ r.procedimentoInicial ?? t('repasse.qualquer')
            }}{{
              r.procedimentoFinal && r.procedimentoFinal !== r.procedimentoInicial
                ? ` a ${r.procedimentoFinal}`
                : ''
            }}
          </td>
          <td>{{ r.tipoConta }}</td>
          <td>{{ r.percentual ? `${r.percentual}%` : '—' }}</td>
          <td>{{ r.valorFixo ? reais(r.valorFixo) : '—' }}</td>
          <td>
            <span v-if="usadas.has(r.id)" class="secundario">{{ t('repasse.regras.usada') }}</span>
            <button
              type="button"
              :disabled="!pode('proporRegra', 'repasse.regra.propor')"
              :aria-label="`${t('repasse.regras.novaVersao')} ${r.id}`"
              @click="nova(r.id)"
            >
              {{ t('repasse.regras.novaVersao') }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else-if="consulta.convenio">{{ t('repasse.nenhum') }}</p>
    <p v-if="todas.length" role="status" data-testid="rg-paginacao">
      {{
        proxima !== null
          ? t('repasse.regras.haMais', { n: todas.length })
          : t('repasse.regras.todas', { n: todas.length })
      }}
      <button
        v-if="proxima !== null"
        type="button"
        :disabled="carregando"
        data-testid="rg-mais"
        @click="carregarMais"
      >
        {{ t('repasse.regras.carregarMais') }}
      </button>
    </p>
    <ErroFaturamento v-if="erroMais" :erro="erroMais" />

    <form v-if="editando" class="formulario" data-testid="rg-form" @submit.prevent="propor">
      <h2>
        {{
          form.substitui ? `${t('repasse.regras.novaVersao')} ${form.substitui}` : t('repasse.regras.nova')
        }}
      </h2>
      <span class="campo">
        <label for="rg-vigencia">{{ t('repasse.regras.vigencia') }}</label>
        <input id="rg-vigencia" v-model="form.vigencia" type="date" required data-testid="rg-vigencia" />
      </span>
      <BuscaPrestador
        v-model="form.profissional"
        :rotulo="t('repasse.profissional')"
        qualquer
        testid="rg-profissional"
      />
      <span class="campo">
        <SanteSelecao
          v-model="form.convenio"
          :rotulo="t('repasse.convenio')"
          :opcoes="convenios"
          data-testid="rg-f-convenio"
        />
      </span>
      <span class="campo">
        <label for="rg-pini">{{ t('repasse.regras.faixaInicial') }}</label>
        <input
          id="rg-pini"
          v-model="form.procedimentoInicial"
          inputmode="numeric"
          data-testid="rg-procedimento"
        />
      </span>
      <span class="campo">
        <label for="rg-pfim">{{ t('repasse.regras.faixaFinal') }}</label>
        <input id="rg-pfim" v-model="form.procedimentoFinal" inputmode="numeric" />
      </span>
      <span class="campo">
        <SanteSelecao
          v-model="form.tipoConta"
          :rotulo="t('repasse.tipoConta')"
          :opcoes="contas"
          data-testid="rg-tipo-conta"
        />
      </span>
      <span class="campo">
        <label for="rg-perc">{{ t('repasse.regras.percentual') }}</label>
        <input id="rg-perc" v-model="form.percentual" inputmode="decimal" data-testid="rg-percentual" />
      </span>
      <span class="campo">
        <label for="rg-fixo">{{ t('repasse.regras.valorFixo') }}</label>
        <input id="rg-fixo" v-model="form.valorFixo" inputmode="decimal" data-testid="rg-valor-fixo" />
      </span>
      <span class="campo">
        <SanteSelecao
          v-model="form.base"
          :rotulo="t('repasse.regras.base')"
          :opcoes="bases"
          data-testid="rg-base"
        />
      </span>
      <span class="campo">
        <SanteSelecao
          v-model="form.evento"
          :rotulo="t('repasse.evento')"
          :opcoes="eventos"
          data-testid="rg-evento"
        />
      </span>
      <span class="campo largo">
        <label for="rg-just">{{ t('repasse.justificativa') }}</label>
        <textarea
          id="rg-just"
          v-model="form.justificativa"
          rows="2"
          required
          data-testid="rg-justificativa"
        />
        <small>{{ t('repasse.justificativaAjuda') }}</small>
      </span>
      <button type="submit" :disabled="gravando" data-testid="rg-propor">
        {{ t('repasse.regras.propor') }}
      </button>
      <button type="button" @click="editando = false">{{ t('repasse.cancelar') }}</button>
    </form>
    <ErroFaturamento v-if="erro" :erro="erro" />
    <MensagemFaturamento :texto="mensagem" testid="rg-mensagem" />

    <section class="painel" aria-labelledby="rg-sim-titulo" data-testid="rg-simulador">
      <h2 id="rg-sim-titulo">{{ t('repasse.simulador.titulo') }}</h2>
      <p class="secundario">{{ t('repasse.simulador.explicacao') }}</p>
      <form class="filtros" @submit.prevent="rodarSimulador">
        <span class="campo">
          <SanteSelecao
            v-model="sim.versao"
            :rotulo="t('repasse.simulador.regraAplicada')"
            :opcoes="versoesSim"
            data-testid="sim-versao"
          />
        </span>
        <span class="campo">
          <SanteSelecao
            v-model="sim.convenio"
            :rotulo="t('repasse.convenio')"
            :opcoes="convenios"
            data-testid="sim-convenio"
          />
        </span>
        <span class="campo">
          <label for="sim-proc">{{ t('repasse.procedimento') }}</label>
          <input
            id="sim-proc"
            v-model="sim.procedimento"
            inputmode="numeric"
            required
            data-testid="sim-procedimento"
          />
        </span>
        <BuscaPrestador
          v-model="sim.profissional"
          :rotulo="t('repasse.profissional')"
          qualquer
          testid="sim-profissional"
        />
        <span class="campo">
          <SanteSelecao
            v-model="sim.tipoConta"
            :rotulo="t('repasse.tipoConta')"
            :opcoes="contas.slice(1)"
            data-testid="sim-tipo-conta"
          />
        </span>
        <span class="campo">
          <label for="sim-cob">{{ t('repasse.simulador.valorCobrado') }}</label>
          <input
            id="sim-cob"
            v-model="sim.valorCobrado"
            inputmode="decimal"
            required
            data-testid="sim-cobrado"
          />
        </span>
        <span class="campo">
          <label for="sim-rec">{{ t('repasse.simulador.valorRecebido') }}</label>
          <input id="sim-rec" v-model="sim.valorRecebido" inputmode="decimal" data-testid="sim-recebido" />
        </span>
        <button type="submit" data-testid="sim-rodar">{{ t('repasse.regras.simular') }}</button>
      </form>
      <ErroFaturamento v-if="erroSim" :erro="erroSim" />
      <div v-if="simulacao" data-testid="sim-resultado">
        <p>
          <strong>{{ t('repasse.simulador.resultado') }}:</strong> {{ reais(simulacao.memoria.valor) }} —
          {{ simulacao.memoria.conta }}
        </p>
        <p v-if="simulacao.memoria.regra !== null">
          {{ t('repasse.simulador.regraAplicada') }}: {{ simulacao.memoria.regra }} ({{
            simulacao.memoria.dimensoes.join(', ')
          }})
        </p>
        <p v-else>{{ t('repasse.simulador.semRegra') }}</p>
        <details v-if="simulacao.memoria.ignoradas.length">
          <summary>
            {{ t('repasse.simulador.regrasIgnoradas') }} ({{ simulacao.memoria.ignoradas.length }})
          </summary>
          <ul>
            <li v-for="i in simulacao.memoria.ignoradas" :key="i.regra">{{ i.regra }}: {{ i.motivo }}</li>
          </ul>
        </details>
      </div>
    </section>

    <h2>{{ t('repasse.regras.aguardando') }}</h2>
    <ErroFaturamento v-if="versoes.error.value" :erro="versoes.error.value" />
    <table v-else-if="versoes.data.value?.length" class="tabela" data-testid="rg-versoes">
      <thead>
        <tr>
          <th scope="col">#</th>
          <th scope="col">{{ t('repasse.regras.titulo') }}</th>
          <th scope="col">{{ t('repasse.regras.vigencia') }}</th>
          <th scope="col">{{ t('repasse.justificativa') }}</th>
          <th scope="col">{{ t('repasse.acoes') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="v in versoes.data.value" :key="v.id">
          <td>{{ v.id }}</td>
          <td>{{ regraTexto(v.proposta) }} · {{ t(`repasse.regras.estado.${v.estado}`) }}</td>
          <td>{{ v.proposta.vigencia }}</td>
          <td>{{ v.proposta.justificativa }}</td>
          <td>
            <template
              v-if="(v.estado === 'rascunho' || v.estado === 'simulada') && tem('repasse.regra.aprovar')"
            >
              <label :for="`rg-dec-${v.id}`" class="oculto">{{ t('repasse.justificativa') }}</label>
              <input :id="`rg-dec-${v.id}`" v-model="decisao[v.id]" :data-testid="`rg-dec-just-${v.id}`" />
              <button type="button" :data-testid="`rg-aprovar-${v.id}`" @click="decidir(v, 'aprovar')">
                {{ t('repasse.regras.aprovar') }}
              </button>
              <button type="button" :data-testid="`rg-recusar-${v.id}`" @click="decidir(v, 'recusar')">
                {{ t('repasse.regras.recusar') }}
              </button>
            </template>
            <span v-else>{{ v.decididaPor ?? '—' }}</span>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else>{{ t('repasse.nenhum') }}</p>
    <ErroFaturamento v-if="erroDecisao" :erro="erroDecisao" />
    <MensagemFaturamento :texto="mensagemDecisao" testid="rg-dec-mensagem" />
  </section>
</template>

<style src="../estilo-repasse.css"></style>
