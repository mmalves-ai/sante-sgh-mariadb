<script setup lang="ts">
// Pedido de transporte do paciente (C1-066, 03-PEP linha 125). Duas entradas na mesma tela:
//   - `/internacao/:reg/transporte`: a visão da internação. O pedido nasce com o tipo e o destino da alta registrada
//     (transferência externa leva o estabelecimento de destino) e a origem no setor atual. O formulário valida na hora
//     pela mesma regra do domínio que a API aplica, inclusive o pedido repetido em aberto. Abaixo, o histórico de
//     pedidos da internação;
//   - `/internacao/transportes`: a fila do transporte, com os pedidos em aberto, a emergência primeiro e depois a
//     previsão.
// Nas duas, cada pedido é agendado, tem a saída e a chegada registradas ou é cancelado com motivo antes da saída. Os
// botões só se habilitam quando a regra do domínio aceita a ação. Nada se apaga.
import {
  conferirAcaoTransporte,
  conferirPedidoTransporte,
  PRIORIDADES_TRANSPORTE,
  SITUACOES_ABERTAS_TRANSPORTE,
  type SituacaoTransporte,
  TIPOS_TRANSPORTE,
} from '@sgh/dominio-internacao';
import { SanteSelecao } from '@sgh/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  agendarTransporte,
  cancelarTransporte,
  concluirTransporte,
  iniciarTransporte,
  lerInternacaoTransporte,
  lerOpcoesTransporte,
  listarTransportes,
  solicitarTransporte,
  type Transporte,
} from '../api-transporte.js';
import { pode } from '../../../casca/sessao/pode.js';
import ErroAdt from '../componentes/ErroAdt.vue';

const props = defineProps<{ reg?: string }>();
const { t } = useI18n();
const cliente = useQueryClient();
const internacaoId = computed(() => (props.reg ? Number(props.reg) : null));

const opcoes = useQuery({ queryKey: ['adt', 'transporte', 'opcoes'], queryFn: lerOpcoesTransporte });
const internacao = useQuery({
  queryKey: computed(() => ['adt', 'transporte', 'internacao', internacaoId.value]),
  queryFn: () => lerInternacaoTransporte(internacaoId.value!),
  enabled: computed(() => internacaoId.value !== null),
});
const lista = useQuery({
  queryKey: computed(() => ['adt', 'transporte', 'lista', internacaoId.value]),
  queryFn: () => listarTransportes(internacaoId.value ? { internacao: internacaoId.value } : {}),
});
const recarregar = () => cliente.invalidateQueries({ queryKey: ['adt', 'transporte'] });
// Ler pede internacao.internacao.ler; pedir e atender (agendar, saída, chegada, cancelar) pedem a mesma permissão que a
// API cobra em todas as gravações. Sem ela, o formulário e os botões não aparecem.
const podeGravar = computed(() => pode('leitos.transferencia.criar'));

type Id = number | '';
const comVazio = (vazio: string, itens: { id: number; nome: string }[]) => [
  { valor: '' as Id, rotulo: vazio },
  ...itens.map((x) => ({ valor: x.id as Id, rotulo: x.nome })),
];
const opTipos = computed(() =>
  TIPOS_TRANSPORTE.map((x) => ({ valor: x as string, rotulo: t(`adt.transporte.tipos.${x}`) })),
);
const opPrioridades = computed(() =>
  PRIORIDADES_TRANSPORTE.map((x) => ({ valor: x as string, rotulo: t(`adt.transporte.prioridades.${x}`) })),
);
const opMeios = computed(() =>
  comVazio(
    t('adt.transporte.semMeio'),
    (opcoes.data.value?.meios ?? []).map((m) => ({
      id: m.id,
      nome: m.exigeAmbulancia ? t('adt.transporte.exigeAmbulancia', { nome: m.nome }) : m.nome,
    })),
  ),
);
const opPosicoes = computed(() =>
  comVazio(t('adt.transporte.semPosicao'), opcoes.data.value?.posicoes ?? []),
);
const opSetores = computed(() => comVazio(t('adt.transporte.nenhum'), opcoes.data.value?.setores ?? []));
const opExternos = computed(() => comVazio(t('adt.transporte.nenhum'), opcoes.data.value?.externos ?? []));
const opAmbulancias = computed(() =>
  comVazio(t('adt.transporte.semAmbulancia'), opcoes.data.value?.ambulancias ?? []),
);
const opMotivos = computed(() => comVazio(t('adt.transporte.escolha'), opcoes.data.value?.motivos ?? []));
const exigeAmbulancia = (meio: number | null) =>
  meio === null ? null : (opcoes.data.value?.meios.find((m) => m.id === meio)?.exigeAmbulancia ?? null);

// Pedido novo (só na visão da internação).
const tipo = ref<string>('interno');
const prioridade = ref<string>('rotina');
const meio = ref<Id>('');
const posicao = ref<Id>('');
const destinoSetor = ref<Id>('');
const destinoExterno = ref<Id>('');
const destinoDescricao = ref('');
const origemDescricao = ref('');
const condicao = ref('');
const oxigenio = ref(false);
const monitorizacao = ref(false);
const maca = ref(false);
const acompanhante = ref('');
const previsto = ref('');
const observacao = ref('');
watch(
  () => internacao.data.value,
  (i) => {
    if (!i) return;
    tipo.value = i.tipoSugerido;
    if (i.alta?.destinoExterno) destinoExterno.value = i.alta.destinoExterno;
  },
  { immediate: true },
);
const vaiASetor = computed(() => tipo.value === 'interno' || tipo.value === 'retorno');
// No retorno o paciente volta de fora do hospital: a origem é o local externo informado, nunca o setor atual.
const eRetorno = computed(() => tipo.value === 'retorno');
const origemSetor = computed(() => (eRetorno.value ? null : (internacao.data.value?.setorAtual ?? null)));
const origemTexto = computed(() => (eRetorno.value ? origemDescricao.value.trim() || null : null));
const nulo = (v: Id) => (v === '' ? null : v);
const quando = (s: string) => (s ? new Date(s) : null);
const abertosMesmoTipo = computed(
  () =>
    (lista.data.value?.itens ?? []).filter(
      (x) =>
        x.tipo === tipo.value && (SITUACOES_ABERTAS_TRANSPORTE as readonly string[]).includes(x.situacao),
    ).length,
);
const problemas = computed(() =>
  conferirPedidoTransporte({
    tipo: tipo.value,
    prioridade: prioridade.value,
    internacao: internacaoId.value,
    atendimento: internacao.data.value?.atendimento ?? null,
    origemSetor: origemSetor.value,
    origemDescricao: origemTexto.value,
    destinoSetor: vaiASetor.value ? nulo(destinoSetor.value) : null,
    destinoExterno: vaiASetor.value ? null : nulo(destinoExterno.value),
    destinoDescricao: vaiASetor.value ? null : destinoDescricao.value.trim() || null,
    requerOxigenio: oxigenio.value,
    requerMonitorizacao: monitorizacao.value,
    meioExigeAmbulancia: exigeAmbulancia(nulo(meio.value)),
    previsto: quando(previsto.value),
    abertosMesmoTipo: abertosMesmoTipo.value,
    agora: new Date(),
  }).map((p) => p.mensagem),
);

const aviso = ref('');
const erro = ref<unknown>(null);
const acao = useMutation({
  mutationFn: (f: () => Promise<unknown>) => f(),
  onSuccess: () => {
    erro.value = null;
    void recarregar();
  },
  onError: (e) => {
    erro.value = e;
    aviso.value = '';
  },
});
const pedir = () =>
  acao.mutate(async () => {
    await solicitarTransporte({
      internacao: internacaoId.value!,
      tipo: tipo.value,
      prioridade: prioridade.value,
      meio: nulo(meio.value),
      posicao: nulo(posicao.value),
      origemSetor: null,
      origemDescricao: origemTexto.value,
      destinoSetor: vaiASetor.value ? nulo(destinoSetor.value) : null,
      destinoExterno: vaiASetor.value ? null : nulo(destinoExterno.value),
      destinoDescricao: vaiASetor.value ? null : destinoDescricao.value.trim() || null,
      condicao: condicao.value.trim() || null,
      requerOxigenio: oxigenio.value,
      requerMonitorizacao: monitorizacao.value,
      requerMaca: maca.value,
      acompanhanteNome: acompanhante.value.trim() || null,
      previsto: quando(previsto.value)?.toISOString() ?? null,
      observacao: observacao.value.trim() || null,
    });
    aviso.value = t('adt.transporte.pedido');
    condicao.value = '';
    observacao.value = '';
    previsto.value = '';
    origemDescricao.value = '';
  });

// Ações nos pedidos: os campos ficam acima da tabela e valem para o pedido em que se clica.
const novaPrevisao = ref('');
const meioAcao = ref<Id>('');
const ambulancia = ref<Id>('');
const distancia = ref<number | null>(null);
const motivo = ref<Id>('');
function regra(x: Transporte, a: 'agendar' | 'iniciar' | 'concluir' | 'cancelar') {
  const meioEfetivo = nulo(meioAcao.value) ?? x.meio;
  return conferirAcaoTransporte({
    acao: a,
    situacao: x.situacao,
    meioDefinido: meioEfetivo !== null,
    meioExigeAmbulancia: exigeAmbulancia(meioEfetivo) ?? x.meioExigeAmbulancia,
    requerOxigenio: x.requerOxigenio,
    requerMonitorizacao: x.requerMonitorizacao,
    ambulancia: nulo(ambulancia.value) ?? x.ambulancia,
    previsto: quando(novaPrevisao.value),
    saida: a === 'iniciar' ? new Date() : x.saida ? new Date(x.saida) : null,
    chegada: a === 'concluir' ? new Date() : null,
    retorno: null,
    distanciaKm: distancia.value,
    motivoCancelamento: nulo(motivo.value),
    agora: new Date(),
  }).situacao;
}
const podeAgir = (x: Transporte, a: 'agendar' | 'iniciar' | 'concluir' | 'cancelar') =>
  podeGravar.value && !acao.isPending.value && regra(x, a) !== null;
const feito = () => {
  aviso.value = t('adt.transporte.feito');
};
const agendar = (x: Transporte) =>
  acao.mutate(async () => {
    await agendarTransporte(x.id, {
      previsto: quando(novaPrevisao.value)!.toISOString(),
      meio: nulo(meioAcao.value),
      ambulancia: nulo(ambulancia.value),
      versao: x.versao,
    });
    feito();
  });
const iniciar = (x: Transporte) =>
  acao.mutate(async () => {
    await iniciarTransporte(x.id, { ambulancia: nulo(ambulancia.value), versao: x.versao });
    feito();
  });
const concluir = (x: Transporte) =>
  acao.mutate(async () => {
    await concluirTransporte(x.id, { distanciaKm: distancia.value, versao: x.versao });
    feito();
  });
const cancelar = (x: Transporte) =>
  acao.mutate(async () => {
    await cancelarTransporte(x.id, { motivo: nulo(motivo.value), versao: x.versao });
    feito();
  });

const hora = (s: string | null) => (s ? new Date(s).toLocaleString('pt-BR') : '');
const aberto = (s: string) =>
  (SITUACOES_ABERTAS_TRANSPORTE as readonly string[]).includes(s as SituacaoTransporte);
const temAberto = computed(() => (lista.data.value?.itens ?? []).some((x) => aberto(x.situacao)));
const necessidades = (x: Transporte) =>
  [
    x.requerOxigenio ? t('adt.transporte.oxigenio') : '',
    x.requerMonitorizacao ? t('adt.transporte.monitorizacao') : '',
    x.requerMaca ? t('adt.transporte.maca') : '',
  ]
    .filter(Boolean)
    .join(' · ');
</script>

<template>
  <section class="tela-agenda" aria-labelledby="transporte-titulo" data-testid="tela-transporte">
    <h1 id="transporte-titulo">
      {{ internacaoId ? t('adt.transporte.tituloInternacao') : t('adt.transporte.tituloFila') }}
    </h1>
    <p>{{ internacaoId ? t('adt.transporte.textoInternacao') : t('adt.transporte.textoFila') }}</p>
    <p class="acoes">
      <RouterLink v-if="internacaoId" :to="{ name: 'adt.transportes' }" data-testid="transporte-ir-fila">{{
        t('adt.transporte.irFila')
      }}</RouterLink>
    </p>
    <ErroAdt v-if="opcoes.isError.value" :erro="opcoes.error.value" />
    <ErroAdt v-if="internacao.isError.value" :erro="internacao.error.value" />
    <ErroAdt v-if="erro" :erro="erro" />
    <p v-if="aviso" role="status" data-testid="transporte-aviso">{{ aviso }}</p>

    <template v-if="internacaoId">
      <p v-if="internacao.data.value" data-testid="transporte-internacao">
        {{
          t('adt.transporte.internacao', {
            numero: internacao.data.value.numero,
            prontuario: internacao.data.value.prontuario ?? '',
          })
        }}
        <template v-if="internacao.data.value.alta">
          ·
          {{
            t('adt.transporte.altaRegistrada', {
              destino: t(`adt.transporte.destinosAlta.${internacao.data.value.alta.destino}`),
            })
          }}
        </template>
      </p>

      <p v-if="!podeGravar" role="note" data-testid="transporte-somente-leitura">
        {{ t('adt.transporte.somenteLeitura') }}
      </p>
      <h2 v-if="podeGravar">{{ t('adt.transporte.novo') }}</h2>
      <form v-if="podeGravar" class="filtros" data-testid="transporte-form" @submit.prevent="pedir">
        <SanteSelecao
          v-model="tipo"
          :rotulo="t('adt.transporte.tipo')"
          :opcoes="opTipos"
          obrigatorio
          data-testid="transporte-tipo"
        />
        <SanteSelecao
          v-model="prioridade"
          :rotulo="t('adt.transporte.prioridade')"
          :opcoes="opPrioridades"
          obrigatorio
          data-testid="transporte-prioridade"
        />
        <label v-if="eRetorno"
          >{{ t('adt.transporte.origemDescricao') }}
          <input v-model="origemDescricao" maxlength="150" required data-testid="transporte-origem-descricao"
        /></label>
        <SanteSelecao
          v-if="vaiASetor"
          v-model="destinoSetor"
          :rotulo="t('adt.transporte.destinoSetor')"
          :opcoes="opSetores"
          obrigatorio
          data-testid="transporte-destino-setor"
        />
        <template v-else>
          <SanteSelecao
            v-model="destinoExterno"
            :rotulo="t('adt.transporte.destinoExterno')"
            :opcoes="opExternos"
            data-testid="transporte-destino-externo"
          />
          <label
            >{{ t('adt.transporte.destinoDescricao') }}
            <input v-model="destinoDescricao" maxlength="150" data-testid="transporte-destino-descricao"
          /></label>
        </template>
        <SanteSelecao
          v-model="meio"
          :rotulo="t('adt.transporte.meio')"
          :opcoes="opMeios"
          data-testid="transporte-meio"
        />
        <SanteSelecao
          v-model="posicao"
          :rotulo="t('adt.transporte.posicao')"
          :opcoes="opPosicoes"
          data-testid="transporte-posicao"
        />
        <label
          ><input v-model="oxigenio" type="checkbox" data-testid="transporte-oxigenio" />
          {{ t('adt.transporte.oxigenio') }}</label
        >
        <label
          ><input v-model="monitorizacao" type="checkbox" data-testid="transporte-monitorizacao" />
          {{ t('adt.transporte.monitorizacao') }}</label
        >
        <label
          ><input v-model="maca" type="checkbox" data-testid="transporte-maca" />
          {{ t('adt.transporte.maca') }}</label
        >
        <label
          >{{ t('adt.transporte.condicao') }}
          <input v-model="condicao" maxlength="300" data-testid="transporte-condicao"
        /></label>
        <label
          >{{ t('adt.transporte.acompanhante') }}
          <input v-model="acompanhante" maxlength="150" data-testid="transporte-acompanhante"
        /></label>
        <label
          >{{ t('adt.transporte.previsto') }}
          <input v-model="previsto" type="datetime-local" data-testid="transporte-previsto"
        /></label>
        <label
          >{{ t('adt.transporte.observacao') }}
          <input v-model="observacao" maxlength="1000" data-testid="transporte-observacao"
        /></label>
        <ul v-if="problemas.length" class="problemas" data-testid="transporte-problemas">
          <li v-for="p in problemas" :key="p">{{ p }}</li>
        </ul>
        <button
          type="submit"
          :disabled="problemas.length > 0 || acao.isPending.value || !internacao.data.value"
          data-testid="transporte-pedir"
        >
          {{ t('adt.transporte.pedir') }}
        </button>
      </form>
    </template>

    <h2>{{ t('adt.transporte.pedidos') }}</h2>
    <ErroAdt v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!lista.data.value" role="status">{{ t('adt.carregando') }}</p>
    <p v-else-if="lista.data.value.itens.length === 0" data-testid="transporte-vazio">
      {{ t('adt.transporte.vazio') }}
    </p>
    <template v-else>
      <form v-if="temAberto && podeGravar" class="filtros" data-testid="transporte-acoes" @submit.prevent>
        <label
          >{{ t('adt.transporte.previsao') }}
          <input v-model="novaPrevisao" type="datetime-local" data-testid="transporte-nova-previsao"
        /></label>
        <SanteSelecao
          v-model="meioAcao"
          :rotulo="t('adt.transporte.meio')"
          :opcoes="opMeios"
          data-testid="transporte-meio-acao"
        />
        <SanteSelecao
          v-model="ambulancia"
          :rotulo="t('adt.transporte.ambulancia')"
          :opcoes="opAmbulancias"
          data-testid="transporte-ambulancia"
        />
        <label
          >{{ t('adt.transporte.distancia') }}
          <input
            v-model.number="distancia"
            type="number"
            min="0"
            step="0.1"
            data-testid="transporte-distancia"
        /></label>
        <SanteSelecao
          v-model="motivo"
          :rotulo="t('adt.transporte.motivo')"
          :opcoes="opMotivos"
          data-testid="transporte-motivo"
        />
      </form>
      <table class="tabela" data-testid="tabela-transportes">
        <thead>
          <tr>
            <th scope="col">{{ t('adt.transporte.paciente') }}</th>
            <th scope="col">{{ t('adt.transporte.tipo') }}</th>
            <th scope="col">{{ t('adt.transporte.prioridade') }}</th>
            <th scope="col">{{ t('adt.transporte.origem') }}</th>
            <th scope="col">{{ t('adt.transporte.destino') }}</th>
            <th scope="col">{{ t('adt.transporte.meio') }}</th>
            <th scope="col">{{ t('adt.transporte.necessidades') }}</th>
            <th scope="col">{{ t('adt.transporte.tempos') }}</th>
            <th scope="col">{{ t('adt.transporte.situacao') }}</th>
            <th scope="col">{{ t('adt.acoesColuna') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in lista.data.value.itens" :key="x.id" :data-testid="`transporte-${x.id}`">
            <td>
              <RouterLink
                v-if="x.internacao && !internacaoId"
                :to="{ name: 'adt.transporte', params: { reg: String(x.internacao) } }"
                >{{ x.internacaoNumero ?? x.internacao }}</RouterLink
              >
              <template v-else>{{ x.internacaoNumero ?? '' }}</template>
              <template v-if="x.prontuario"> · {{ x.prontuario }}</template>
            </td>
            <td>{{ t(`adt.transporte.tipos.${x.tipo}`) }}</td>
            <td>{{ t(`adt.transporte.prioridades.${x.prioridade}`) }}</td>
            <td>{{ x.origemNome ?? '' }}</td>
            <td>{{ x.destinoNome ?? '' }}</td>
            <td>
              {{ x.meioNome ?? t('adt.transporte.semMeio') }}
              <template v-if="x.ambulanciaPlaca"><br />{{ x.ambulanciaPlaca }}</template>
            </td>
            <td>
              {{ necessidades(x) }}
              <template v-if="x.condicao"><br />{{ x.condicao }}</template>
            </td>
            <td>
              {{ t('adt.transporte.pedidoEm', { quando: hora(x.solicitado) }) }}
              <template v-if="x.previsto"
                ><br />{{ t('adt.transporte.previstoEm', { quando: hora(x.previsto) }) }}</template
              >
              <template v-if="x.saida"
                ><br />{{ t('adt.transporte.saidaEm', { quando: hora(x.saida) }) }}</template
              >
              <template v-if="x.chegada"
                ><br />{{ t('adt.transporte.chegadaEm', { quando: hora(x.chegada) }) }}</template
              >
            </td>
            <td>
              {{ t(`adt.transporte.situacoes.${x.situacao}`) }}
              <template v-if="x.motivoCancelamento"><br />{{ x.motivoCancelamento }}</template>
            </td>
            <td>
              <template v-if="podeGravar && aberto(x.situacao)">
                <button
                  v-if="x.situacao !== 'em_andamento'"
                  type="button"
                  :disabled="!podeAgir(x, 'agendar')"
                  :data-testid="`transporte-agendar-${x.id}`"
                  @click="agendar(x)"
                >
                  {{ t('adt.transporte.agendar') }}
                </button>
                <button
                  v-if="x.situacao !== 'em_andamento'"
                  type="button"
                  :disabled="!podeAgir(x, 'iniciar')"
                  :data-testid="`transporte-iniciar-${x.id}`"
                  @click="iniciar(x)"
                >
                  {{ t('adt.transporte.iniciar') }}
                </button>
                <button
                  v-if="x.situacao === 'em_andamento'"
                  type="button"
                  :disabled="!podeAgir(x, 'concluir')"
                  :data-testid="`transporte-concluir-${x.id}`"
                  @click="concluir(x)"
                >
                  {{ t('adt.transporte.concluir') }}
                </button>
                <button
                  v-if="x.situacao !== 'em_andamento'"
                  type="button"
                  :disabled="!podeAgir(x, 'cancelar')"
                  :data-testid="`transporte-cancelar-${x.id}`"
                  @click="cancelar(x)"
                >
                  {{ t('adt.transporte.cancelar') }}
                </button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
