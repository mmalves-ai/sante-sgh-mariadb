<script setup lang="ts">
// Previsão e provisão de pagamentos (F8, 07-FIN linha 68): `/financeiro/tesouraria/previsao`. O período abre no mês
// corrente e nos dois seguintes, com o previsto × realizado por ocorrência e os totais. Realizar não pede número: a
// linha abre a lista dos títulos livres do mesmo credor (despesa, título a pagar) ou da mesma fonte pagadora (receita,
// título a receber), os de valor mais próximo primeiro; um clique confirma e a diferença aparece na linha. Cancelar a
// ocorrência e encerrar a previsão pedem o motivo, conferido enquanto se digita, e o motivo fica na linha. A nova
// previsão confere o fim antes do início na hora. As provisões do passivo aparecem abaixo, com o saldo.
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import AvisoFaturamento from '../../faturamento/componentes/AvisoFaturamento.vue';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../../faturamento/componentes/MensagemFaturamento.vue';
import {
  cancelarOcorrencia,
  criarPrevisao,
  encerrarPrevisao,
  estenderPrevisao,
  lerApoiosPrevisao,
  lerPrevistoRealizado,
  lerProvisoes,
  lerTitulosParaRealizar,
  type OcorrenciaPrevista,
  realizarOcorrencia,
} from '../api-compensacao.js';
import { novaChave } from '../api-financeiro.js';
import { data, reais, somarMeses, usarFinanceiro } from '../usar-financeiro.js';

const MOTIVO_MINIMO = 5;
const PERIODICIDADES = [
  'mensal',
  'unica',
  'semanal',
  'quinzenal',
  'bimestral',
  'trimestral',
  'semestral',
  'anual',
] as const;
const { t } = useI18n();
const qc = useQueryClient();
const { apoio, pode, motivo, motivoFuncionalidade } = usarFinanceiro();
const OP = {
  criar: 'financeiro.criarPrevisaoFinanceira',
  realizar: 'financeiro.realizarPrevisaoFinanceira',
  estender: 'financeiro.estenderPrevisaoFinanceira',
  cancelar: 'financeiro.cancelarOcorrenciaPrevisao',
  encerrar: 'financeiro.encerrarPrevisaoFinanceira',
} as const;
const podeGravar = (op: string) => pode(op, 'financeiro.tituloPagar.criar');

// Período: do mês corrente ao fim do segundo mês seguinte.
const de = ref('');
const ate = ref('');
const fimDoMes = (c: string) => {
  const [a, m] = c.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
};
watch(
  () => apoio.data.value?.hoje,
  (hoje) => {
    if (!hoje || de.value) return;
    const mes = `${hoje.slice(0, 7)}-01`;
    de.value = mes;
    ate.value = fimDoMes(somarMeses(mes, 2));
  },
  { immediate: true },
);
const periodoValido = computed(() => !!de.value && !!ate.value && ate.value >= de.value);
const ocorrencias = useQuery({
  queryKey: computed(() => ['financeiro', 'previsoes', de.value, ate.value]),
  queryFn: () => lerPrevistoRealizado({ de: de.value, ate: ate.value }),
  enabled: periodoValido,
});
const provisoes = useQuery({ queryKey: ['financeiro', 'provisoes'], queryFn: () => lerProvisoes() });
const apoios = useQuery({
  queryKey: ['financeiro', 'previsoes', 'apoios'],
  queryFn: () => lerApoiosPrevisao(),
  staleTime: 60_000,
});
const totais = computed(() => {
  const vivas = (ocorrencias.data.value ?? []).filter((o) => o.situacao !== 'cancelada');
  const previsto = vivas.reduce((s, o) => s + o.previsto, 0);
  const realizado = vivas.reduce((s, o) => s + (o.realizado ?? 0), 0);
  const diferenca = vivas.reduce((s, o) => s + (o.diferenca ?? 0), 0);
  return { previsto: reais(previsto), realizado: reais(realizado), diferenca: reais(diferenca) };
});

// Gravação comum: mensagem do servidor, nova chave e releitura.
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const gravando = ref(false);
let chave = novaChave('previsao');
async function acao(f: (c: string) => Promise<{ mensagem: string }>) {
  erro.value = null;
  mensagem.value = null;
  gravando.value = true;
  try {
    mensagem.value = (await f(chave)).mensagem;
    chave = novaChave('previsao');
    fechar();
    await qc.invalidateQueries({ queryKey: ['financeiro'] });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}

// Ação aberta numa linha: realizar, cancelar a ocorrência ou encerrar a previsão.
type Modo = 'realizar' | 'cancelar' | 'encerrar';
const aberta = ref<{ modo: Modo; ocorrencia: OcorrenciaPrevista } | null>(null);
const titulo = ref('');
const motivoTexto = ref('');
const dataEncerramento = ref('');
function abrir(modo: Modo, o: OcorrenciaPrevista) {
  aberta.value = { modo, ocorrencia: o };
  titulo.value = '';
  motivoTexto.value = '';
  dataEncerramento.value = o.dataEsperada;
}
function fechar() {
  aberta.value = null;
}
const candidatos = useQuery({
  queryKey: computed(() => ['financeiro', 'previsoes', 'titulos', aberta.value?.ocorrencia.id ?? 0]),
  queryFn: () => lerTitulosParaRealizar(aberta.value?.ocorrencia.id ?? 0),
  enabled: computed(() => aberta.value?.modo === 'realizar'),
});
const opcoesTitulos = computed(() => [
  { valor: '', rotulo: '—' },
  ...(candidatos.data.value ?? []).map((c) => ({
    valor: String(c.id),
    rotulo: `${c.numero} · ${data(c.data)} · ${reais(c.valor)}`,
  })),
]);
watch(
  () => candidatos.data.value,
  (lista) => {
    if (lista?.[0] && !titulo.value) titulo.value = String(lista[0].id);
  },
);
const faltamMotivo = computed(() => Math.max(0, MOTIVO_MINIMO - motivoTexto.value.trim().length));
function confirmar() {
  const a = aberta.value;
  if (!a) return;
  const o = a.ocorrencia;
  if (a.modo === 'realizar') {
    const c = (candidatos.data.value ?? []).find((x) => String(x.id) === titulo.value);
    if (c) void acao((k) => realizarOcorrencia(o.id, c, k));
  } else if (a.modo === 'cancelar') void acao((k) => cancelarOcorrencia(o.id, motivoTexto.value.trim(), k));
  else void acao((k) => encerrarPrevisao(o.previsao, dataEncerramento.value, motivoTexto.value.trim(), k));
}
const podeConfirmar = computed(() => {
  const a = aberta.value;
  if (!a || gravando.value) return false;
  if (a.modo === 'realizar') return !!titulo.value;
  return faltamMotivo.value === 0 && (a.modo === 'cancelar' || !!dataEncerramento.value);
});

// Nova previsão.
const nova = reactive({
  descricao: '',
  tipo: 'despesa' as 'despesa' | 'receita',
  natureza: '',
  valor: '',
  periodicidade: 'mensal',
  diaVencimento: '',
  dataInicio: '',
  dataFim: '',
  ajuste: 'postergar' as 'antecipar' | 'postergar' | 'manter',
});
const opcoesTipo = computed(() =>
  (['despesa', 'receita'] as const).map((v) => ({ valor: v, rotulo: t(`financeiro.previsao.tipos.${v}`) })),
);
const opcoesNatureza = computed(() => [
  { valor: '', rotulo: '—' },
  ...(apoios.data.value?.naturezas ?? [])
    .filter((n) => n.tipo === nova.tipo)
    .map((n) => ({ valor: String(n.id), rotulo: n.rotulo })),
]);
watch(
  () => nova.tipo,
  () => {
    nova.natureza = '';
  },
);
const opcoesPeriodicidade = computed(() =>
  PERIODICIDADES.map((v) => ({ valor: v, rotulo: t(`financeiro.previsao.periodicidades.${v}`) })),
);
const opcoesAjuste = computed(() =>
  (['postergar', 'antecipar', 'manter'] as const).map((v) => ({
    valor: v,
    rotulo: t(`financeiro.previsao.ajustes.${v}`),
  })),
);
const fimAntesInicio = computed(() => !!nova.dataFim && !!nova.dataInicio && nova.dataFim < nova.dataInicio);
const valorNova = computed(() => Number(nova.valor.replace(',', '.')));
const novaValida = computed(
  () =>
    nova.descricao.trim().length >= 3 &&
    !!nova.natureza &&
    valorNova.value > 0 &&
    !!nova.dataInicio &&
    !fimAntesInicio.value,
);
function gravarNova() {
  if (!novaValida.value) return;
  const dia = Number(nova.diaVencimento);
  void acao(async (k) => {
    const r = await criarPrevisao(
      {
        descricao: nova.descricao.trim(),
        tipo: nova.tipo,
        natureza: Number(nova.natureza),
        valor: valorNova.value,
        periodicidade: nova.periodicidade,
        ...(dia >= 1 && dia <= 31 ? { diaVencimento: dia } : {}),
        dataInicio: nova.dataInicio,
        ...(nova.dataFim ? { dataFim: nova.dataFim } : {}),
        ajuste: nova.ajuste,
      },
      k,
    );
    nova.descricao = '';
    nova.valor = '';
    nova.dataFim = '';
    return r;
  });
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="pp-titulo" data-testid="tela-fin-previsao">
    <h1 id="pp-titulo">{{ t('financeiro.previsao.titulo') }}</h1>
    <p>{{ t('financeiro.previsao.texto') }}</p>
    <AvisoFaturamento :motivo="motivoFuncionalidade('tesouraria')" />
    <MensagemFaturamento :texto="mensagem" />
    <ErroFaturamento v-if="erro" :erro="erro" />

    <form class="formulario" :aria-label="t('financeiro.previsao.periodo')" @submit.prevent>
      <span class="campo">
        <label for="pp-de">{{ t('financeiro.de') }}</label>
        <input id="pp-de" v-model="de" type="date" data-testid="pp-de" />
      </span>
      <span class="campo">
        <label for="pp-ate">{{ t('financeiro.ate') }}</label>
        <input id="pp-ate" v-model="ate" type="date" :aria-invalid="!periodoValido" data-testid="pp-ate" />
      </span>
    </form>

    <p class="resumo" data-testid="pp-totais">{{ t('financeiro.previsao.totais', totais) }}</p>
    <ErroFaturamento v-if="ocorrencias.error.value" :erro="ocorrencias.error.value" />
    <table v-else-if="ocorrencias.data.value?.length" class="tabela" data-testid="pp-lista">
      <thead>
        <tr>
          <th scope="col">{{ t('financeiro.previsao.dataEsperada') }}</th>
          <th scope="col">{{ t('financeiro.previsao.descricao') }}</th>
          <th scope="col">{{ t('financeiro.previsao.tipo') }}</th>
          <th scope="col">{{ t('financeiro.previsao.previsto') }}</th>
          <th scope="col">{{ t('financeiro.previsao.realizado') }}</th>
          <th scope="col">{{ t('financeiro.previsao.diferenca') }}</th>
          <th scope="col">{{ t('financeiro.situacao') }}</th>
          <th scope="col">{{ t('financeiro.acoes') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="o in ocorrencias.data.value" :key="o.id" :data-testid="`pp-linha-${o.id}`">
          <td>{{ data(o.dataEsperada) }}</td>
          <td>{{ o.descricao }}</td>
          <td>{{ t(`financeiro.previsao.tipos.${o.tipo}`) }}</td>
          <td>{{ reais(o.previsto) }}</td>
          <td>{{ o.realizado === null ? '—' : reais(o.realizado) }}</td>
          <td>{{ o.diferenca === null ? '—' : reais(o.diferenca) }}</td>
          <td :data-testid="`pp-situacao-${o.id}`">
            {{ t(`financeiro.previsao.situacoes.${o.situacao}`) }}
            <span v-if="o.titulo"> · {{ o.titulo }}</span>
            <span v-if="o.motivoCancelamento"> · {{ o.motivoCancelamento }}</span>
          </td>
          <td>
            <template v-if="o.situacao === 'aberta'">
              <button
                type="button"
                :disabled="gravando || !podeGravar(OP.realizar)"
                :title="motivo(OP.realizar) ?? undefined"
                :data-testid="`pp-realizar-${o.id}`"
                @click="abrir('realizar', o)"
              >
                {{ t('financeiro.previsao.realizar') }}
              </button>
              <button
                type="button"
                :disabled="gravando || !podeGravar(OP.cancelar)"
                :title="motivo(OP.cancelar) ?? undefined"
                :data-testid="`pp-cancelar-${o.id}`"
                @click="abrir('cancelar', o)"
              >
                {{ t('financeiro.previsao.cancelarOcorrencia') }}
              </button>
            </template>
            <template v-if="o.previsaoAtiva">
              <button
                type="button"
                :disabled="gravando || !podeGravar(OP.estender)"
                :title="motivo(OP.estender) ?? undefined"
                :data-testid="`pp-estender-${o.id}`"
                @click="acao((k) => estenderPrevisao(o.previsao, k))"
              >
                {{ t('financeiro.previsao.estender') }}
              </button>
              <button
                type="button"
                :disabled="gravando || !podeGravar(OP.encerrar)"
                :title="motivo(OP.encerrar) ?? undefined"
                :data-testid="`pp-encerrar-${o.id}`"
                @click="abrir('encerrar', o)"
              >
                {{ t('financeiro.previsao.encerrar') }}
              </button>
            </template>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else-if="ocorrencias.data.value">{{ t('financeiro.nenhum') }}</p>

    <form v-if="aberta" class="formulario" data-testid="pp-acao" @submit.prevent="confirmar">
      <h2>
        {{
          aberta.modo === 'realizar'
            ? t('financeiro.previsao.realizarCom', {
                data: data(aberta.ocorrencia.dataEsperada),
                valor: reais(aberta.ocorrencia.previsto),
              })
            : aberta.modo === 'cancelar'
              ? t('financeiro.previsao.cancelarOcorrencia')
              : t('financeiro.previsao.encerrar')
        }}
        · {{ aberta.ocorrencia.descricao }}
      </h2>
      <template v-if="aberta.modo === 'realizar'">
        <ErroFaturamento v-if="candidatos.error.value" :erro="candidatos.error.value" />
        <p v-else-if="candidatos.data.value && !candidatos.data.value.length" data-testid="pp-sem-titulo">
          {{ t('financeiro.previsao.semCandidato') }}
        </p>
        <span v-else class="campo">
          <SanteSelecao
            v-model="titulo"
            :rotulo="t('financeiro.previsao.tituloCandidato')"
            :opcoes="opcoesTitulos"
            data-testid="pp-titulo"
          />
        </span>
      </template>
      <template v-else>
        <span v-if="aberta.modo === 'encerrar'" class="campo">
          <label for="pp-data-encerramento">{{ t('financeiro.previsao.dataEncerramento') }}</label>
          <input
            id="pp-data-encerramento"
            v-model="dataEncerramento"
            type="date"
            data-testid="pp-data-encerramento"
          />
        </span>
        <span class="campo">
          <label for="pp-motivo">{{ t('financeiro.previsao.motivo') }}</label>
          <textarea
            id="pp-motivo"
            v-model="motivoTexto"
            maxlength="500"
            :aria-invalid="faltamMotivo > 0"
            aria-describedby="pp-motivo-falta"
            data-testid="pp-motivo"
          ></textarea>
          <small v-if="faltamMotivo > 0" id="pp-motivo-falta">
            {{ t('financeiro.previsao.motivoFalta', { n: faltamMotivo }) }}
          </small>
        </span>
      </template>
      <button type="submit" :disabled="!podeConfirmar" data-testid="pp-confirmar">
        {{
          aberta.modo === 'realizar'
            ? t('financeiro.previsao.confirmarRealizar')
            : aberta.modo === 'cancelar'
              ? t('financeiro.previsao.confirmarCancelar')
              : t('financeiro.previsao.confirmarEncerrar')
        }}
      </button>
      <button type="button" @click="fechar">{{ t('financeiro.cancelar') }}</button>
    </form>

    <form
      v-if="podeGravar(OP.criar)"
      class="formulario"
      data-testid="pp-nova"
      :aria-label="t('financeiro.previsao.nova')"
      @submit.prevent="gravarNova"
    >
      <h2>{{ t('financeiro.previsao.nova') }}</h2>
      <span class="campo">
        <label for="pp-descricao">{{ t('financeiro.previsao.descricao') }}</label>
        <input id="pp-descricao" v-model="nova.descricao" maxlength="150" data-testid="pp-descricao" />
      </span>
      <span class="campo">
        <SanteSelecao
          v-model="nova.tipo"
          :rotulo="t('financeiro.previsao.tipo')"
          :opcoes="opcoesTipo"
          data-testid="pp-tipo"
        />
      </span>
      <span class="campo">
        <SanteSelecao
          v-model="nova.natureza"
          :rotulo="t('financeiro.previsao.natureza')"
          :opcoes="opcoesNatureza"
          data-testid="pp-natureza"
        />
      </span>
      <span class="campo">
        <label for="pp-valor">{{ t('financeiro.previsao.valor') }}</label>
        <input id="pp-valor" v-model="nova.valor" inputmode="decimal" data-testid="pp-valor" />
      </span>
      <span class="campo">
        <SanteSelecao
          v-model="nova.periodicidade"
          :rotulo="t('financeiro.previsao.periodicidade')"
          :opcoes="opcoesPeriodicidade"
          data-testid="pp-periodicidade"
        />
      </span>
      <span class="campo">
        <label for="pp-dia">{{ t('financeiro.previsao.diaVencimento') }}</label>
        <input id="pp-dia" v-model="nova.diaVencimento" type="number" min="1" max="31" data-testid="pp-dia" />
      </span>
      <span class="campo">
        <label for="pp-inicio">{{ t('financeiro.previsao.inicio') }}</label>
        <input id="pp-inicio" v-model="nova.dataInicio" type="date" data-testid="pp-inicio" />
      </span>
      <span class="campo">
        <label for="pp-fim">{{ t('financeiro.previsao.fim') }}</label>
        <input
          id="pp-fim"
          v-model="nova.dataFim"
          type="date"
          :aria-invalid="fimAntesInicio"
          aria-describedby="pp-fim-erro"
          data-testid="pp-fim"
        />
        <small v-if="fimAntesInicio" id="pp-fim-erro" data-testid="pp-fim-erro">
          {{ t('financeiro.previsao.fimAntesInicio') }}
        </small>
      </span>
      <span class="campo">
        <SanteSelecao
          v-model="nova.ajuste"
          :rotulo="t('financeiro.previsao.ajuste')"
          :opcoes="opcoesAjuste"
          data-testid="pp-ajuste"
        />
      </span>
      <button type="submit" :disabled="gravando || !novaValida" data-testid="pp-gravar">
        {{ t('financeiro.previsao.gravarPrevisao') }}
      </button>
    </form>

    <h2>{{ t('financeiro.previsao.provisoes') }}</h2>
    <ErroFaturamento v-if="provisoes.error.value" :erro="provisoes.error.value" />
    <table v-else-if="provisoes.data.value?.length" class="tabela" data-testid="pp-provisoes">
      <thead>
        <tr>
          <th scope="col">{{ t('financeiro.previsao.competencia') }}</th>
          <th scope="col">{{ t('financeiro.previsao.descricao') }}</th>
          <th scope="col">{{ t('financeiro.previsao.conta') }}</th>
          <th scope="col">{{ t('financeiro.previsao.provisionado') }}</th>
          <th scope="col">{{ t('financeiro.previsao.baixado') }}</th>
          <th scope="col">{{ t('financeiro.previsao.revertido') }}</th>
          <th scope="col">{{ t('financeiro.previsao.saldo') }}</th>
          <th scope="col">{{ t('financeiro.situacao') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="p in provisoes.data.value" :key="p.id">
          <td>{{ `${p.competencia.slice(5, 7)}/${p.competencia.slice(0, 4)}` }}</td>
          <td>{{ p.descricao }}</td>
          <td>{{ p.conta }}</td>
          <td>{{ reais(p.provisionado) }}</td>
          <td>{{ reais(p.baixado) }}</td>
          <td>{{ reais(p.revertido) }}</td>
          <td>{{ reais(p.saldo) }}</td>
          <td>{{ p.situacao }}</td>
        </tr>
      </tbody>
    </table>
    <p v-else-if="provisoes.data.value">{{ t('financeiro.nenhum') }}</p>
  </section>
</template>
