<script setup lang="ts">
// Cadastro do calendário de entrega da fatura por convênio (06-FAT linha 31), no painel de prazos: as janelas em que
// cada convênio recebe a fatura de uma competência, o pagamento previsto (data fixa ou prazo em dias) e se a janela é
// restritiva (o registro do protocolo fora dela é recusado). A validação do domínio roda enquanto se digita (a mesma
// do servidor); escolher a competência já sugere a entrega a partir do mês seguinte. Inativar nunca apaga: a janela
// some do painel e da conferência do protocolo, e fica na lista com "mostrar inativas".
import type { JanelaCalendarioLida } from '@sgh/contratos';
import { conferirSobreposicaoJanela, validarJanelaEntrega } from '@sgh/dominio-faturamento';
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../../faturamento/componentes/MensagemFaturamento.vue';
import {
  alterarJanela,
  incluirJanela,
  inativarJanela,
  listarCalendario,
  type PedidoJanela,
} from '../api-calendario-entrega.js';
import { novaChave } from '../api-tiss.js';
import { data, opcoesConvenio, usarTiss } from '../usar-tiss.js';

const { t } = useI18n();
const qc = useQueryClient();
const { apoio, pode } = usarTiss('lote');
const podeEditar = computed(() => pode('faturamento.fecharCompetencia'));
const convenios = computed(() => opcoesConvenio(apoio.data.value?.convenios));
const conveniosFiltro = computed(() => opcoesConvenio(apoio.data.value?.convenios, t('tiss.todos')));

const filtroConvenio = ref('');
const inativas = ref(false);
const lista = useQuery({
  queryKey: computed(() => ['tiss', 'calendario-entrega', filtroConvenio.value, inativas.value]),
  queryFn: () => listarCalendario({ convenio: filtroConvenio.value, inativas: inativas.value }),
});

const vazio = () => ({
  convenio: '',
  competencia: '',
  inicio: '',
  fim: '',
  pagamentoPrevisto: '',
  prazoPagamentoDias: '' as string | number,
  restritivo: false,
  observacao: '',
});
const form = ref(vazio());
const editando = ref<JanelaCalendarioLida | null>(null);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const gravando = ref(false);

const mes = (d: string) => `${d.slice(5, 7)}/${d.slice(0, 4)}`;
const mesSeguinte = (comp: string) => {
  const [a, m] = comp.split('-').map(Number);
  return m === 12 ? `${a! + 1}-01` : `${a}-${String(m! + 1).padStart(2, '0')}`;
};

// Competência escolhida e entrega ainda vazia: sugere do dia 1 ao 10 do mês seguinte.
watch(
  () => form.value.competencia,
  (c) => {
    if (!c || editando.value || form.value.inicio || form.value.fim) return;
    const s = mesSeguinte(c);
    form.value.inicio = `${s}-01`;
    form.value.fim = `${s}-10`;
  },
);

const prazo = computed(() =>
  form.value.prazoPagamentoDias === '' || form.value.prazoPagamentoDias === null
    ? null
    : Number(form.value.prazoPagamentoDias),
);
const pedido = computed<PedidoJanela>(() => ({
  competencia: form.value.competencia,
  inicio: form.value.inicio,
  fim: form.value.fim,
  pagamentoPrevisto: form.value.pagamentoPrevisto || null,
  prazoPagamentoDias: prazo.value,
  restritivo: form.value.restritivo,
  observacao: form.value.observacao.trim(),
}));

// A mesma regra do servidor, na hora: datas, competência, entrega, pagamento, prazo e sobreposição com as ativas.
const validacao = computed<string | null>(() => {
  const p = pedido.value;
  if (!editando.value && !form.value.convenio) return t('tiss.calendario.faltaConvenio');
  if (!p.competencia || !p.inicio || !p.fim) return t('tiss.calendario.faltaDatas');
  const janela = {
    competencia: `${p.competencia}-01`,
    entregaInicio: p.inicio,
    entregaFim: p.fim,
    pagamentoPrevisto: p.pagamentoPrevisto,
    prazoPagamentoDias: p.prazoPagamentoDias,
    restritivo: p.restritivo,
  };
  const convenio = editando.value?.convenio ?? Number(form.value.convenio);
  const ativas = (lista.data.value ?? [])
    .filter((j) => j.ativo && j.convenio === convenio)
    .map((j) => ({ id: j.id, competencia: j.competencia, entregaInicio: j.inicio, entregaFim: j.fim }));
  const r =
    validarJanelaEntrega(janela) ?? conferirSobreposicaoJanela(janela, ativas, editando.value?.id ?? null);
  return r?.mensagem ?? null;
});

function limpar() {
  form.value = vazio();
  editando.value = null;
}

function alterar(j: JanelaCalendarioLida) {
  editando.value = j;
  form.value = {
    convenio: String(j.convenio),
    competencia: j.competencia.slice(0, 7),
    inicio: j.inicio,
    fim: j.fim,
    pagamentoPrevisto: j.pagamentoPrevisto ?? '',
    prazoPagamentoDias: j.prazoPagamentoDias ?? '',
    restritivo: j.restritivo,
    observacao: j.observacao,
  };
}

async function rodar(fn: () => Promise<unknown>, texto: string) {
  erro.value = null;
  mensagem.value = null;
  gravando.value = true;
  try {
    await fn();
    mensagem.value = texto;
    await qc.invalidateQueries({ queryKey: ['tiss'] });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}

async function gravar() {
  if (validacao.value) return;
  const e = editando.value;
  await rodar(
    () =>
      e
        ? alterarJanela(e.id, { ...pedido.value, versao: e.versao }, novaChave('calendario-alterar'))
        : incluirJanela(
            { ...pedido.value, convenio: Number(form.value.convenio) },
            novaChave('calendario-incluir'),
          ),
    e ? t('tiss.calendario.alterada') : t('tiss.calendario.incluida'),
  );
  if (!erro.value) limpar();
}

async function inativar(j: JanelaCalendarioLida) {
  await rodar(
    () => inativarJanela(j.id, j.versao, novaChave('calendario-inativar')),
    t('tiss.calendario.inativada'),
  );
  if (editando.value?.id === j.id) limpar();
}
</script>

<template>
  <section aria-labelledby="ce-titulo" data-testid="ce-calendario">
    <h2 id="ce-titulo">{{ t('tiss.calendario.titulo') }}</h2>
    <p>{{ t('tiss.calendario.texto') }}</p>
    <form class="filtros" @submit.prevent>
      <span class="campo">
        <SanteSelecao
          v-model="filtroConvenio"
          :rotulo="t('tiss.convenio')"
          :opcoes="conveniosFiltro"
          data-testid="ce-filtro-convenio"
        />
      </span>
      <span class="campo">
        <label>
          <input v-model="inativas" type="checkbox" data-testid="ce-inativas" />
          {{ t('tiss.calendario.mostrarInativas') }}
        </label>
      </span>
    </form>
    <ErroFaturamento v-if="lista.error.value" :erro="lista.error.value" />
    <p v-else-if="!lista.data.value" role="status">{{ t('tiss.carregando') }}</p>
    <p v-else-if="lista.data.value.length === 0" data-testid="ce-vazio">{{ t('tiss.calendario.vazio') }}</p>
    <table v-else class="tabela" data-testid="ce-lista">
      <thead>
        <tr>
          <th scope="col">{{ t('tiss.convenio') }}</th>
          <th scope="col">{{ t('tiss.competencia') }}</th>
          <th scope="col">{{ t('tiss.prazos.janela') }}</th>
          <th scope="col">{{ t('tiss.prazos.pagamento') }}</th>
          <th scope="col">{{ t('tiss.situacao') }}</th>
          <th scope="col">{{ t('tiss.calendario.acoes') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="j in lista.data.value" :key="j.id" :data-testid="`ce-linha-${j.id}`">
          <td>{{ j.convenioNome }}</td>
          <td>{{ mes(j.competencia) }}</td>
          <td>
            {{ data(j.inicio) }} — {{ data(j.fim) }}
            <template v-if="j.restritivo">
              <br />
              <span>{{ t('tiss.prazos.restritivo') }}</span>
            </template>
          </td>
          <td>
            {{ data(j.pagamentoCalculado) }}
            <span v-if="!j.pagamentoPrevisto && j.prazoPagamentoDias" class="secundario">
              ({{ t('tiss.calendario.prazoDe', { n: j.prazoPagamentoDias }) }})
            </span>
          </td>
          <td>{{ j.ativo ? t(`tiss.calendario.situacoes.${j.situacao}`) : t('tiss.calendario.inativa') }}</td>
          <td>
            <template v-if="j.ativo && podeEditar">
              <button
                type="button"
                :data-testid="`ce-alterar-${j.id}`"
                :disabled="gravando"
                @click="alterar(j)"
              >
                {{ t('tiss.calendario.alterar') }}
              </button>
              <button
                type="button"
                :data-testid="`ce-inativar-${j.id}`"
                :disabled="gravando"
                @click="inativar(j)"
              >
                {{ t('tiss.calendario.inativar') }}
              </button>
            </template>
          </td>
        </tr>
      </tbody>
    </table>

    <form v-if="podeEditar" class="filtros" data-testid="ce-form" @submit.prevent="gravar">
      <h3>{{ editando ? t('tiss.calendario.alterando') : t('tiss.calendario.nova') }}</h3>
      <span class="campo">
        <SanteSelecao
          v-model="form.convenio"
          :rotulo="t('tiss.convenio')"
          :opcoes="convenios"
          :desabilitado="editando !== null"
          data-testid="ce-convenio"
        />
      </span>
      <span class="campo">
        <label for="ce-competencia">{{ t('tiss.competencia') }}</label>
        <input id="ce-competencia" v-model="form.competencia" type="month" data-testid="ce-competencia" />
      </span>
      <span class="campo">
        <label for="ce-inicio">{{ t('tiss.calendario.inicio') }}</label>
        <input id="ce-inicio" v-model="form.inicio" type="date" data-testid="ce-inicio" />
      </span>
      <span class="campo">
        <label for="ce-fim">{{ t('tiss.calendario.fim') }}</label>
        <input id="ce-fim" v-model="form.fim" type="date" data-testid="ce-fim" />
      </span>
      <span class="campo">
        <label for="ce-pagamento">{{ t('tiss.calendario.pagamentoFixo') }}</label>
        <input id="ce-pagamento" v-model="form.pagamentoPrevisto" type="date" data-testid="ce-pagamento" />
      </span>
      <span class="campo">
        <label for="ce-prazo">{{ t('tiss.calendario.prazoDias') }}</label>
        <input
          id="ce-prazo"
          v-model="form.prazoPagamentoDias"
          type="number"
          min="1"
          max="999"
          data-testid="ce-prazo"
        />
      </span>
      <span class="campo">
        <label>
          <input v-model="form.restritivo" type="checkbox" data-testid="ce-restritivo" />
          {{ t('tiss.calendario.restritiva') }}
        </label>
      </span>
      <span class="campo">
        <label for="ce-observacao">{{ t('tiss.calendario.observacao') }}</label>
        <input id="ce-observacao" v-model="form.observacao" maxlength="500" data-testid="ce-observacao" />
      </span>
      <p v-if="validacao" class="secundario" role="status" data-testid="ce-validacao">{{ validacao }}</p>
      <button type="submit" :disabled="gravando || validacao !== null" data-testid="ce-gravar">
        {{ editando ? t('tiss.calendario.gravarAlteracao') : t('tiss.calendario.incluir') }}
      </button>
      <button v-if="editando" type="button" data-testid="ce-cancelar" @click="limpar">
        {{ t('tiss.calendario.cancelar') }}
      </button>
    </form>
    <ErroFaturamento v-if="erro" :erro="erro" />
    <MensagemFaturamento :texto="mensagem" testid="ce-mensagem" />
  </section>
</template>
