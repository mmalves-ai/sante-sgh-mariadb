<script setup lang="ts">
// Atendimentos do dia (ficha do M20, seção 7): `/recepcao/atendimento`. A lista do dia (as requisições de
// laboratório à parte, regra 3), com os atalhos para o segurado, os procedimentos extras, os impressos e o
// encerramento; a abertura nova; os indicadores do dia para quem os vê (o painel do período em tela própria). Os itens
// do menu de cada ação chegam aqui com `?acao=` e a lista destaca o atalho da ação. A busca por nome, prontuário,
// número do atendimento ou senha e o filtro do local; a identificação pendente dos pacientes não identificados.
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { pode } from '../../../casca/sessao/pode.js';
import { dataBr } from '../../agenda/formato.js';
import { lerIndicadoresAtendimento, listarAtendimentosDia } from '../api-atendimento.js';
import AvisoAtendimento from '../componentes/AvisoAtendimento.vue';
import ErroAtendimento from '../componentes/ErroAtendimento.vue';
import IdentificacaoPendente from '../componentes/IdentificacaoPendente.vue';
import { usarAtendimento } from '../usar-atendimento.js';

const { t } = useI18n();
const rota = useRoute();
const { apoio, motivoAmbulatorio } = usarAtendimento();
const ACOES = ['segurado', 'procedimentos', 'impressos', 'encerrar'] as const;
type Acao = (typeof ACOES)[number];
const acaoDaRota = computed<Acao | null>(() => {
  const a = rota.query['acao'];
  return typeof a === 'string' && (ACOES as readonly string[]).includes(a) ? (a as Acao) : null;
});
const data = ref('');
const unidade = ref('');
const local = ref('');
const termo = ref('');
const busca = ref('');
const requisicoes = ref(false);
const lista = useQuery({
  queryKey: computed(() => [
    'atendimento',
    'dia',
    data.value,
    unidade.value,
    local.value,
    busca.value,
    requisicoes.value,
  ]),
  queryFn: () =>
    listarAtendimentosDia({
      data: data.value || null,
      unidade: unidade.value ? Number(unidade.value) : null,
      local: local.value ? Number(local.value) : null,
      termo: busca.value || null,
      requisicoes: requisicoes.value,
    }),
  refetchInterval: 30_000,
});
const unidades = computed(() => [
  { valor: '', rotulo: t('atendimento.todasUnidades') },
  ...(apoio.data.value?.unidades ?? []).map((u) => ({ valor: String(u.codigo), rotulo: u.nome })),
]);
const locais = computed(() => [
  { valor: '', rotulo: t('atendimento.dia.todosLocais') },
  ...(apoio.data.value?.locais ?? []).map((l) => ({ valor: String(l.id), rotulo: l.descricao })),
]);
const podeIdentificar = pode('atendimento.atendimento.abrir');
const veIndicadores = pode('atendimento.indicador.ler');
const configuraImpressao = pode('documento.cadastro.editar');
const dia = computed(() => lista.data.value?.data ?? '');
const indicadores = useQuery({
  queryKey: computed(() => ['atendimento', 'indicadores', dia.value]),
  queryFn: () => lerIndicadoresAtendimento(dia.value, dia.value),
  enabled: computed(() => veIndicadores && dia.value !== ''),
});
const rotuloAcao = (a: Acao) => t(`atendimento.${a}.titulo`);
</script>

<template>
  <section class="tela-agenda" aria-labelledby="dia-atd-titulo" data-testid="tela-atendimentos-dia">
    <h1 id="dia-atd-titulo">{{ t('atendimento.dia.titulo') }}</h1>
    <p>
      {{
        acaoDaRota
          ? t('atendimento.dia.escolhaPara', { acao: rotuloAcao(acaoDaRota) })
          : t('atendimento.dia.texto')
      }}
    </p>
    <AvisoAtendimento :motivo="motivoAmbulatorio" />
    <p class="acoes">
      <RouterLink to="/recepcao/atendimento/novo" data-testid="link-novo-atendimento">{{
        t('atendimento.abrir.titulo')
      }}</RouterLink>
      <RouterLink to="/consultorio/fila">{{ t('atendimento.fila.titulo') }}</RouterLink>
      <RouterLink to="/pa/quadro">{{ t('atendimento.quadro.titulo') }}</RouterLink>
      <RouterLink to="/recepcao/atendimento/heranca">{{ t('atendimento.heranca.titulo') }}</RouterLink>
      <RouterLink
        v-if="configuraImpressao"
        to="/recepcao/atendimento/regras-impressao"
        data-testid="link-regras-impressao"
        >{{ t('regrasImpressao.atalho') }}</RouterLink
      >
      <RouterLink
        v-if="veIndicadores"
        to="/recepcao/atendimento/indicadores"
        data-testid="link-indicadores"
        >{{ t('atendimento.painelIndicadores.titulo') }}</RouterLink
      >
    </p>
    <form class="filtros" role="search" @submit.prevent="busca = termo.trim()">
      <div class="campo">
        <label for="dia-atd-termo">{{ t('atendimento.dia.termo') }}</label>
        <input
          id="dia-atd-termo"
          v-model="termo"
          type="search"
          autocomplete="off"
          data-testid="dia-atd-termo"
        />
      </div>
      <SanteBotao
        tipo="submit"
        variante="secundario"
        :rotulo="t('atendimento.buscar')"
        data-testid="dia-atd-buscar"
      />
      <SanteBotao
        v-if="busca"
        variante="texto"
        :rotulo="t('atendimento.dia.limpar')"
        @acionar="((busca = ''), (termo = ''))"
      />
    </form>
    <div class="filtros">
      <div class="campo">
        <label for="dia-atd-data">{{ t('atendimento.data') }}</label>
        <input id="dia-atd-data" v-model="data" type="date" data-testid="dia-atd-data" />
      </div>
      <SanteSelecao v-model="unidade" :rotulo="t('atendimento.unidade')" :opcoes="unidades" />
      <SanteSelecao
        v-model="local"
        :rotulo="t('atendimento.dia.local')"
        :opcoes="locais"
        data-testid="dia-atd-local"
      />
      <label><input v-model="requisicoes" type="checkbox" /> {{ t('atendimento.dia.comRequisicoes') }}</label>
    </div>

    <section
      v-if="veIndicadores && indicadores.data.value"
      class="painel"
      aria-labelledby="dia-atd-indicadores"
    >
      <h2 id="dia-atd-indicadores">{{ t('atendimento.indicadores.titulo') }}</h2>
      <ul class="cartoes" data-testid="indicadores-dia">
        <li>{{ t('atendimento.indicadores.atendimentos', { n: indicadores.data.value.atendimentos }) }}</li>
        <li>
          {{ t('atendimento.indicadores.requisicoes', { n: indicadores.data.value.requisicoesLaboratorio }) }}
        </li>
        <li>{{ t('atendimento.indicadores.pa', { n: indicadores.data.value.pa.atendimentos }) }}</li>
        <li>
          {{
            indicadores.data.value.pa.portaMedicoMedianaMin === null
              ? t('atendimento.indicadores.portaMedicoSem')
              : t('atendimento.indicadores.portaMedico', {
                  n: indicadores.data.value.pa.portaMedicoMedianaMin,
                })
          }}
        </li>
        <li>{{ t('atendimento.indicadores.semMarcas', { n: indicadores.data.value.semMarcas }) }}</li>
      </ul>
    </section>

    <IdentificacaoPendente :pode-identificar="podeIdentificar" />

    <ErroAtendimento v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!lista.data.value" role="status">{{ t('atendimento.carregando') }}</p>
    <template v-else>
      <p v-if="lista.data.value.requisicoes > 0 && !requisicoes" class="secundario">
        {{ t('atendimento.dia.requisicoesAParte', { n: lista.data.value.requisicoes }) }}
      </p>
      <p v-if="lista.data.value.itens.length === 0">{{ t('atendimento.nenhum') }}</p>
      <table v-else class="tabela" data-testid="tabela-atendimentos-dia">
        <caption>
          {{
            t('atendimento.dia.legenda', {
              n: lista.data.value.itens.length,
              data: dataBr(lista.data.value.data),
            })
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('atendimento.numero') }}</th>
            <th scope="col">{{ t('atendimento.hora') }}</th>
            <th scope="col">{{ t('atendimento.paciente') }}</th>
            <th scope="col">{{ t('atendimento.tipo') }}</th>
            <th scope="col">{{ t('atendimento.convenio') }}</th>
            <th scope="col">{{ t('atendimento.situacao') }}</th>
            <th scope="col">{{ t('atendimento.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in lista.data.value.itens" :key="a.reg" :data-testid="`atendimento-${a.reg}`">
            <td>{{ a.reg }}</td>
            <td>{{ a.hora }}</td>
            <td>
              {{ a.paciente.nome }}
              <span class="secundario"
                >· {{ t('atendimento.prontuario', { n: a.paciente.prontuario }) }}</span
              >
            </td>
            <td>{{ a.tipoRotulo }}</td>
            <td>{{ a.convenio.nome }}</td>
            <td>{{ a.desfecho ? a.desfecho.rotulo : t('atendimento.aberto') }}</td>
            <td class="acoes">
              <RouterLink
                v-for="ac in ACOES"
                :key="ac"
                :to="`/recepcao/atendimento/${a.reg}/${ac}`"
                :class="{ destaque: acaoDaRota === ac }"
                :aria-label="t('atendimento.dia.acaoDe', { acao: rotuloAcao(ac), reg: a.reg })"
                :data-testid="`atd-${ac}-${a.reg}`"
                >{{ rotuloAcao(ac) }}</RouterLink
              >
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="lista.data.value.cortada" class="secundario">{{ t('atendimento.cortada') }}</p>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style scoped>
.destaque {
  font-weight: 700;
}
</style>
