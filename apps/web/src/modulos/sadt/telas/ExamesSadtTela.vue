<script setup lang="ts">
// Lançamento e solicitação de exames (ficha do M26, seção 7): `/sadt/exames`. Os pedidos do prontuário a receber e os
// exames do dia por setor, com as contagens por situação; receber os selecionados (executante, prestador e local do
// setor) e lançar exame direto no setor no atendimento buscado pelo número (a requisição do setor aberta). O alerta de
// sexo, idade ou repetição pede confirmação; o servidor confere tudo de novo.
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  type AtendimentoSadt,
  buscarAtendimentosSadt,
  lancarExames,
  listarExamesSadt,
  novaChave,
  receberPedidos,
} from '../api-sadt.js';
import AvisoSadt from '../componentes/AvisoSadt.vue';
import ErroSadt from '../componentes/ErroSadt.vue';
import PacienteSadt from '../componentes/PacienteSadt.vue';
import { hojeLocal, quando, usarSadt } from '../usar-sadt.js';

const { t } = useI18n();
const cliente = useQueryClient();
const setor = ref('laboratorio');
const data = ref(hojeLocal());
const situacao = ref('todos');
const termo = ref('');
const buscado = ref('');
const { apoio, pode, motivoSetor, gravacao } = usarSadt(setor);
const lista = useQuery({
  queryKey: computed(() => ['sadt', 'exames', setor.value, data.value, situacao.value, buscado.value]),
  queryFn: () =>
    listarExamesSadt({
      setor: setor.value,
      data: data.value,
      situacao: situacao.value,
      termo: buscado.value || null,
    }),
});
const setores = computed(() =>
  (['laboratorio', 'imagem', 'metodosGraficos', 'endoscopia'] as const).map((s) => ({
    valor: s,
    rotulo: t(`sadt.setores.${s}`),
  })),
);
const situacoes = computed(() =>
  (['todos', 'aReceber', 'recebidos', 'aDigitar', 'aLiberar', 'liberados', 'aEmitir'] as const).map((s) => ({
    valor: s,
    rotulo: t(`sadt.situacoes.${s}`),
  })),
);
const executantes = computed(() => [
  { valor: '', rotulo: t('sadt.escolha') },
  ...(apoio.data.value?.executantes ?? []).map((e) => ({ valor: String(e.id), rotulo: e.nome })),
]);
const prestadores = computed(() => [
  { valor: '', rotulo: t('sadt.escolha') },
  ...(apoio.data.value?.prestadores ?? []).map((p) => ({ valor: String(p.id), rotulo: p.nome })),
]);
const executante = ref('');
const prestador = ref('');
const local = ref('1');
const selecionados = ref<number[]>([]);
const podeReceber = computed(() => pode(setor.value, 'sadt.receberSolicitacao'));
const podeLancar = computed(() => pode(setor.value, 'sadt.lancarExame'));
const ocupado = ref(false);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);

function alternar(id: number) {
  selecionados.value = selecionados.value.includes(id)
    ? selecionados.value.filter((x) => x !== id)
    : [...selecionados.value, id];
}

async function receber(): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const itens = (lista.data.value?.itens ?? []).filter((x) => selecionados.value.includes(x.id));
    const r = await receberPedidos(
      {
        exames: itens.map((x) => ({ id: x.id, chave: x.chave, versao: x.versao })),
        executante: Number(executante.value || gravacao.data.value?.habilitacao.vinculo || 0),
        prestador: Number(prestador.value),
        local: Number(local.value || 1),
      },
      novaChave('receber'),
    );
    mensagem.value = r.mensagem;
    selecionados.value = [];
    await cliente.invalidateQueries({ queryKey: ['sadt'] });
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}

// ── Lançamento direto no setor ─────────────────────────────────────────────────────────────────────
const numero = ref('');
const encontrados = ref<AtendimentoSadt[]>([]);
const atendimento = ref<AtendimentoSadt | null>(null);
const exameLancar = ref('');
const urgente = ref(false);
const confirmarAlertas = ref(false);
const examesDoSetor = computed(() => [
  { valor: '', rotulo: t('sadt.escolha') },
  ...(apoio.data.value?.exames ?? []).map((e) => ({ valor: String(e.id), rotulo: e.nome })),
]);
async function buscarAtendimento(): Promise<void> {
  erro.value = null;
  atendimento.value = null;
  try {
    encontrados.value = await buscarAtendimentosSadt(Number(numero.value));
    atendimento.value = encontrados.value[0] ?? null;
  } catch (x) {
    erro.value = x;
  }
}
async function lancar(): Promise<void> {
  if (!atendimento.value) return;
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const ex = apoio.data.value?.exames.find((e) => String(e.id) === exameLancar.value);
    const r = await lancarExames(
      {
        atendimento: atendimento.value.atendimento,
        ato: ex?.ato ?? 15,
        itens: [{ exame: Number(exameLancar.value), urgente: urgente.value }],
        executante: Number(executante.value || gravacao.data.value?.habilitacao.vinculo || 0),
        prestador: Number(prestador.value),
        local: Number(local.value || 1),
        confirmarAlertas: confirmarAlertas.value,
      },
      novaChave('lancar'),
    );
    mensagem.value = r.mensagem;
    confirmarAlertas.value = false;
    await cliente.invalidateQueries({ queryKey: ['sadt'] });
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="sadt-exames-titulo" data-testid="tela-sadt-exames">
    <h1 id="sadt-exames-titulo">{{ t('sadt.exames.titulo') }}</h1>
    <p>{{ t('sadt.exames.texto') }}</p>
    <AvisoSadt :motivo="motivoSetor" />
    <div class="filtros">
      <SanteSelecao v-model="setor" :rotulo="t('sadt.setor')" :opcoes="setores" data-testid="sadt-setor" />
      <span class="campo">
        <label for="sadt-data">{{ t('sadt.data') }}</label>
        <input id="sadt-data" v-model="data" type="date" data-testid="sadt-data" />
      </span>
      <SanteSelecao
        v-model="situacao"
        :rotulo="t('sadt.situacao')"
        :opcoes="situacoes"
        data-testid="sadt-situacao"
      />
      <span class="campo">
        <label for="sadt-termo">{{ t('sadt.termo') }}</label>
        <input
          id="sadt-termo"
          v-model="termo"
          type="search"
          data-testid="sadt-termo"
          @keyup.enter="buscado = termo"
        />
      </span>
      <SanteBotao variante="secundario" :rotulo="t('sadt.buscar')" @acionar="buscado = termo" />
    </div>
    <ErroSadt v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!lista.data.value" role="status">{{ t('sadt.carregando') }}</p>
    <template v-else>
      <p class="secundario" data-testid="sadt-contagens">
        {{
          t('sadt.contagens', {
            aReceber: lista.data.value.contagens['aReceber'] ?? 0,
            aDigitar: lista.data.value.contagens['aDigitar'] ?? 0,
            aLiberar: lista.data.value.contagens['aLiberar'] ?? 0,
            liberados: lista.data.value.contagens['liberados'] ?? 0,
            suspensos: lista.data.value.contagens['suspensos'] ?? 0,
          })
        }}
      </p>
      <p v-if="lista.data.value.cortada" role="status">{{ t('sadt.cortada') }}</p>
      <p v-if="lista.data.value.itens.length === 0">{{ t('sadt.nenhum') }}</p>
      <table v-else class="tabela" data-testid="tabela-sadt-exames">
        <caption>
          {{
            t('sadt.exames.titulo')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">
              <span class="sgh-visualmente-oculto">{{ t('sadt.acoes') }}</span>
            </th>
            <th scope="col">{{ t('sadt.paciente') }}</th>
            <th scope="col">{{ t('sadt.exame') }}</th>
            <th scope="col">{{ t('sadt.situacao') }}</th>
            <th scope="col">{{ t('sadt.solicitante') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in lista.data.value.itens" :key="e.id" :data-testid="`sadt-exame-${e.id}`">
            <td>
              <input
                v-if="e.estado === 'solicitado' || e.estado === 'coletado'"
                type="checkbox"
                :checked="selecionados.includes(e.id)"
                :aria-label="t('sadt.exames.selecionar', { exame: e.exame.nome })"
                :data-testid="`sadt-selecionar-${e.id}`"
                @change="alternar(e.id)"
              />
            </td>
            <td><PacienteSadt :paciente="e.paciente" /></td>
            <td>
              {{ e.exame.nome }}
              <strong v-if="e.urgente"> · {{ t('sadt.urgente') }}</strong>
              <span class="secundario">
                · {{ t(`sadt.origens.${e.origem}`) }} · {{ quando(e.pedidoEm) }}</span
              >
            </td>
            <td :data-testid="`sadt-estado-${e.id}`">
              {{ e.estadoRotulo }}<strong v-if="e.critico"> · {{ t('sadt.critico') }}</strong>
            </td>
            <td>{{ e.solicitante || '—' }}</td>
          </tr>
        </tbody>
      </table>
      <div v-if="podeReceber" class="painel">
        <p>{{ t('sadt.exames.selecionados', { n: selecionados.length }) }}</p>
        <div class="filtros">
          <SanteSelecao
            v-model="executante"
            :rotulo="t('sadt.executante')"
            :opcoes="executantes"
            data-testid="sadt-executante"
          />
          <SanteSelecao
            v-model="prestador"
            :rotulo="t('sadt.prestador')"
            :opcoes="prestadores"
            data-testid="sadt-prestador"
          />
          <span class="campo">
            <label for="sadt-local">{{ t('sadt.local') }}</label>
            <input id="sadt-local" v-model="local" type="number" min="0" data-testid="sadt-local" />
          </span>
          <SanteBotao
            :rotulo="t('sadt.exames.receber')"
            :desabilitado="ocupado || selecionados.length === 0 || !prestador"
            data-testid="sadt-receber"
            @acionar="receber"
          />
        </div>
      </div>
    </template>

    <section v-if="podeLancar" class="painel" aria-labelledby="sadt-lancar-titulo">
      <h2 id="sadt-lancar-titulo">{{ t('sadt.exames.lancar') }}</h2>
      <p>{{ t('sadt.exames.lancarTexto') }}</p>
      <div class="filtros">
        <span class="campo">
          <label for="sadt-numero">{{ t('sadt.exames.numero') }}</label>
          <input id="sadt-numero" v-model="numero" type="number" min="1" data-testid="sadt-numero" />
        </span>
        <SanteBotao
          variante="secundario"
          :rotulo="t('sadt.buscar')"
          data-testid="sadt-buscar-atendimento"
          @acionar="buscarAtendimento"
        />
      </div>
      <template v-if="atendimento">
        <p data-testid="sadt-atendimento">
          <PacienteSadt :paciente="atendimento.paciente" /> · {{ atendimento.convenio.nome }}
        </p>
        <p v-if="!atendimento.conta" role="status">{{ t('sadt.exames.semConta') }}</p>
        <div v-else class="filtros">
          <SanteSelecao
            v-model="exameLancar"
            :rotulo="t('sadt.exames.exameLancar')"
            :opcoes="examesDoSetor"
            data-testid="sadt-exame-lancar"
          />
          <label
            ><input v-model="urgente" type="checkbox" data-testid="sadt-urgente" />
            {{ t('sadt.urgente') }}</label
          >
          <label>
            <input v-model="confirmarAlertas" type="checkbox" data-testid="sadt-confirmar-alertas" />
            {{ t('sadt.exames.confirmarAlertas') }}
          </label>
          <SanteBotao
            :rotulo="t('sadt.exames.lancar')"
            :desabilitado="ocupado || !exameLancar || !prestador"
            data-testid="sadt-lancar"
            @acionar="lancar"
          />
        </div>
      </template>
    </section>
    <p v-if="mensagem" role="status" data-testid="sadt-mensagem">{{ mensagem }}</p>
    <ErroSadt v-if="erro" :erro="erro" />
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
