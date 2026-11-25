<script setup lang="ts">
// Reserva de equipamentos e hemocomponentes para a cirurgia (F8, 04-CC linha 103), no pedido da cirurgia. O período
// já vem preenchido com a janela da cirurgia (início e duração previstos): reservar um equipamento é escolher e clicar.
// A validação roda na hora pela regra do domínio (período, quantidade); o conflito com outra cirurgia volta do servidor
// com o número da cirurgia que ocupa o equipamento. O sangue pedido mostra a prova cruzada e, ligado à requisição
// transfusional do paciente (do mesmo tipo), as bolsas já liberadas pela agência. Nada se apaga: cancelada, a
// reserva continua na lista com a situação.
import { conferirReservaEquipamento, conferirReservaHemocomponente } from '@sgh/dominio-cirurgia';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import {
  cancelarReserva,
  ligarRequisicao,
  lerReservasCirurgia,
  pedirHemocomponente,
  reservarEquipamento,
} from '../api-reserva-cirurgia.js';
import ErroCirurgia from './ErroCirurgia.vue';

const props = defineProps<{ agendamento: number }>();
const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      titulo: 'Reserva de equipamentos e hemocomponentes',
      fechada: 'As reservas desta cirurgia estão fechadas: a cirurgia já começou, terminou ou foi cancelada.',
      liberar:
        'A cirurgia não vai acontecer como marcada: cancele as reservas ainda abertas para liberar o equipamento e o sangue.',
      equipamentos: 'Equipamentos',
      semEquipamento: 'Nenhum equipamento reservado.',
      equipamento: 'Equipamento',
      escolha: 'Escolha…',
      inicio: 'Início da reserva',
      fim: 'Fim da reserva',
      quantidade: 'Quantidade',
      reservar: 'Reservar equipamento',
      periodoCirurgia: 'Período da cirurgia: {inicio} a {fim}',
      semPeriodo: 'A cirurgia ainda não tem horário: informe o período da reserva.',
      linhaEquipamento: '{seq}. {codigo} · {nome} · {qtd} · {inicio} a {fim}',
      hemocomponentes: 'Hemocomponentes',
      semHemo: 'Nenhum hemocomponente pedido.',
      hemocomponente: 'Hemocomponente',
      bolsas: 'Bolsas',
      observacao: 'Observação',
      pedir: 'Pedir hemocomponente',
      linhaHemo: '{seq}. {sigla} · {descricao} · {qtd} bolsa(s)',
      prova: 'prova cruzada: {p}',
      ligada: 'requisição {numero}: {liberadas} bolsa(s) liberada(s)',
      requisicao: 'Requisição transfusional do paciente',
      ligar: 'Ligar à requisição',
      semRequisicao: 'O paciente não tem requisição transfusional deste tipo em aberto.',
      cancelar: 'Cancelar reserva',
      gravado: 'Reserva gravada.',
      cancelado: 'Reserva cancelada (fica no histórico).',
      situacao: {
        reservado: 'reservado',
        confirmado: 'confirmado',
        em_uso: 'em uso',
        liberado: 'liberado',
        cancelado: 'cancelado',
        solicitada: 'solicitada',
        reservada: 'reservada',
        utilizada: 'utilizada',
        devolvida: 'devolvida',
        cancelada: 'cancelada',
      },
      provas: {
        nao_solicitada: 'não solicitada',
        solicitada: 'solicitada',
        em_andamento: 'em andamento',
        compativel: 'compatível',
        incompativel: 'incompatível',
        dispensada: 'dispensada',
      },
    },
  },
});

const cliente = useQueryClient();
const { permissoes } = usarSessao();
const podeEditar = computed(() => permissoes.value.has('cirurgia.agenda.agendar'));
const chaveConsulta = computed(() => ['cirurgia', 'reservas', props.agendamento]);
const consulta = useQuery({ queryKey: chaveConsulta, queryFn: () => lerReservasCirurgia(props.agendamento) });
const dados = computed(() => consulta.data.value);
const editavel = computed(() => Boolean(dados.value?.aberta) && podeEditar.value);
// Cirurgia aberta, ou cancelada, suspensa ou reprovada: a reserva ainda aberta pode ser cancelada (liberada).
const liberavel = computed(() => Boolean(dados.value?.liberavel) && podeEditar.value);

const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);

// Equipamento: período da cirurgia de saída ("AAAA-MM-DDTHH:MM" no campo; "AAAA-MM-DD HH:MM" no contrato).
const eqEscolhido = ref<number | null>(null);
const eqInicio = ref('');
const eqFim = ref('');
const eqQtd = ref(1);
const doCampo = (v: string) => v.replace('T', ' ');
const paraCampo = (v: string) => v.replace(' ', 'T');
watch(
  () => dados.value?.periodo,
  (p) => {
    if (p && !eqInicio.value && !eqFim.value) {
      eqInicio.value = paraCampo(p.inicio);
      eqFim.value = paraCampo(p.fim);
    }
  },
  { immediate: true },
);
const opcoesEquipamento = computed(() => [
  { valor: null, rotulo: t('escolha') },
  ...(dados.value?.opcoes.equipamentos ?? []).map((e) => ({
    valor: e.id,
    rotulo: `${e.codigo} · ${e.nome}`,
  })),
]);
const problemasEquipamento = computed(() =>
  dados.value && eqEscolhido.value !== null
    ? conferirReservaEquipamento(
        { id: props.agendamento, situacao: dados.value.situacao },
        { inicio: doCampo(eqInicio.value), fim: doCampo(eqFim.value), quantidade: Number(eqQtd.value) },
        { situacao: 'ativo' },
        [],
      )
    : [],
);
const podeReservar = computed(
  () =>
    editavel.value && eqEscolhido.value !== null && problemasEquipamento.value.length === 0 && !ocupado.value,
);

// Hemocomponente.
const hemoEscolhido = ref<number | null>(null);
const hemoQtd = ref(1);
const hemoObs = ref('');
const opcoesHemo = computed(() => [
  { valor: null, rotulo: t('escolha') },
  ...(dados.value?.opcoes.hemocomponentes ?? []).map((h) => ({
    valor: h.id,
    rotulo: `${h.sigla} · ${h.descricao}`,
  })),
]);
const problemasHemo = computed(() =>
  dados.value && hemoEscolhido.value !== null
    ? conferirReservaHemocomponente(dados.value.situacao, Number(hemoQtd.value), { ativo: true })
    : [],
);
const podePedir = computed(
  () => editavel.value && hemoEscolhido.value !== null && problemasHemo.value.length === 0 && !ocupado.value,
);

// Vínculo com a requisição: por reserva, os itens do mesmo tipo de hemocomponente.
const escolhaRequisicao = ref<Record<number, number | null>>({});
const opcoesRequisicao = (hemocomponente: number) => [
  { valor: null, rotulo: t('escolha') },
  ...(dados.value?.opcoes.requisicoes ?? [])
    .filter((r) => r.hemocomponente === hemocomponente)
    .map((r) => ({ valor: r.item, rotulo: `${r.requisicao} · ${r.sigla} · ${r.liberadas}/${r.bolsas}` })),
];

const periodoTexto = computed(() => {
  const p = dados.value?.periodo;
  return p ? t('periodoCirurgia', { inicio: p.inicio, fim: p.fim.slice(11) }) : t('semPeriodo');
});

async function executar(fn: () => Promise<unknown>, ok: string): Promise<boolean> {
  ocupado.value = true;
  erro.value = null;
  mensagem.value = null;
  try {
    await fn();
    mensagem.value = ok;
    await cliente.invalidateQueries({ queryKey: chaveConsulta.value });
    return true;
  } catch (x) {
    erro.value = x;
    return false;
  } finally {
    ocupado.value = false;
  }
}

async function reservar(): Promise<void> {
  if (!podeReservar.value || eqEscolhido.value === null) return;
  const equipamento = eqEscolhido.value;
  if (
    await executar(
      () =>
        reservarEquipamento(props.agendamento, {
          equipamento,
          quantidade: Number(eqQtd.value),
          inicio: doCampo(eqInicio.value),
          fim: doCampo(eqFim.value),
        }),
      t('gravado'),
    )
  )
    eqEscolhido.value = null;
}

async function pedir(): Promise<void> {
  if (!podePedir.value || hemoEscolhido.value === null) return;
  const hemocomponente = hemoEscolhido.value;
  const observacao = hemoObs.value.trim();
  if (
    await executar(
      () =>
        pedirHemocomponente(props.agendamento, {
          hemocomponente,
          quantidade: Number(hemoQtd.value),
          ...(observacao ? { observacao } : {}),
        }),
      t('gravado'),
    )
  ) {
    hemoEscolhido.value = null;
    hemoObs.value = '';
  }
}

async function ligar(reserva: number, versao: number): Promise<void> {
  const item = escolhaRequisicao.value[reserva];
  if (!item) return;
  await executar(() => ligarRequisicao(props.agendamento, reserva, item, versao), t('gravado'));
}

async function cancelar(tipo: 'equipamentos' | 'hemocomponentes', reserva: number, versao: number) {
  await executar(() => cancelarReserva(props.agendamento, tipo, reserva, versao), t('cancelado'));
}

const situacaoTexto = (s: string) => t(`situacao.${s}`);
</script>

<template>
  <section class="painel" aria-labelledby="reservas-cirurgia-titulo" data-testid="reservas-cirurgia">
    <h2 id="reservas-cirurgia-titulo">{{ t('titulo') }}</h2>
    <ErroCirurgia v-if="consulta.isError.value" :erro="consulta.error.value" />
    <template v-else-if="dados">
      <p v-if="!dados.aberta" role="status" data-testid="reservas-fechada">{{ t('fechada') }}</p>
      <p v-if="!dados.aberta && liberavel" role="status" data-testid="reservas-liberar">{{ t('liberar') }}</p>

      <h3>{{ t('equipamentos') }}</h3>
      <p v-if="dados.equipamentos.length === 0" data-testid="reservas-sem-equipamento">
        {{ t('semEquipamento') }}
      </p>
      <ul v-else data-testid="reservas-equipamentos">
        <li
          v-for="r in dados.equipamentos"
          :key="r.id"
          :data-testid="`reserva-equipamento-${r.sequencia}`"
          :class="{ secundario: r.situacao === 'cancelado' }"
        >
          {{
            t('linhaEquipamento', {
              seq: r.sequencia,
              codigo: r.codigo,
              nome: r.nome,
              qtd: r.quantidade,
              inicio: r.inicio,
              fim: r.fim.slice(11),
            })
          }}
          · <strong>{{ situacaoTexto(r.situacao) }}</strong>
          <SanteBotao
            v-if="liberavel && (r.situacao === 'reservado' || r.situacao === 'confirmado')"
            variante="secundario"
            :rotulo="t('cancelar')"
            :desabilitado="ocupado"
            :data-testid="`reserva-equipamento-cancelar-${r.sequencia}`"
            @acionar="cancelar('equipamentos', r.id, r.versao)"
          />
        </li>
      </ul>
      <div v-if="editavel" class="formulario" data-testid="reservas-novo-equipamento">
        <p class="secundario" data-testid="reservas-periodo">{{ periodoTexto }}</p>
        <span data-testid="reservas-equipamento">
          <SanteSelecao v-model="eqEscolhido" :rotulo="t('equipamento')" :opcoes="opcoesEquipamento" />
        </span>
        <div class="campo">
          <label for="reserva-inicio">{{ t('inicio') }}</label>
          <input id="reserva-inicio" v-model="eqInicio" type="datetime-local" data-testid="reservas-inicio" />
        </div>
        <div class="campo">
          <label for="reserva-fim">{{ t('fim') }}</label>
          <input id="reserva-fim" v-model="eqFim" type="datetime-local" data-testid="reservas-fim" />
        </div>
        <div class="campo">
          <label for="reserva-eq-qtd">{{ t('quantidade') }}</label>
          <input
            id="reserva-eq-qtd"
            v-model.number="eqQtd"
            type="number"
            min="1"
            max="20"
            data-testid="reservas-equipamento-qtd"
          />
        </div>
        <ul
          v-if="problemasEquipamento.length"
          class="problemas"
          role="alert"
          data-testid="reservas-problemas-equipamento"
        >
          <li v-for="p in problemasEquipamento" :key="p.campo + p.mensagem">{{ p.mensagem }}</li>
        </ul>
        <SanteBotao
          :rotulo="t('reservar')"
          :desabilitado="!podeReservar"
          data-testid="reservas-reservar"
          @acionar="reservar"
        />
      </div>

      <h3>{{ t('hemocomponentes') }}</h3>
      <p v-if="dados.hemocomponentes.length === 0" data-testid="reservas-sem-hemo">{{ t('semHemo') }}</p>
      <ul v-else data-testid="reservas-hemocomponentes">
        <li
          v-for="h in dados.hemocomponentes"
          :key="h.id"
          :data-testid="`reserva-hemo-${h.sequencia}`"
          :class="{ secundario: h.situacao === 'cancelada' }"
        >
          {{
            t('linhaHemo', { seq: h.sequencia, sigla: h.sigla, descricao: h.descricao, qtd: h.quantidade })
          }}
          · <strong>{{ situacaoTexto(h.situacao) }}</strong> ·
          {{ t('prova', { p: t(`provas.${h.provaCruzada}`) }) }}
          <span v-if="h.requisicaoNumero" :data-testid="`reserva-hemo-requisicao-${h.sequencia}`">
            · {{ t('ligada', { numero: h.requisicaoNumero, liberadas: h.bolsasLiberadas ?? 0 }) }}
          </span>
          <span v-if="h.observacao" class="secundario"> · {{ h.observacao }}</span>
          <div
            v-if="liberavel && (h.situacao === 'solicitada' || h.situacao === 'reservada')"
            class="acoes-linha"
          >
            <template v-if="editavel && !h.requisicaoItem">
              <template v-if="opcoesRequisicao(h.hemocomponente).length > 1">
                <span :data-testid="`reserva-hemo-escolha-requisicao-${h.sequencia}`">
                  <SanteSelecao
                    :model-value="escolhaRequisicao[h.id] ?? null"
                    @update:model-value="(v: number | null) => (escolhaRequisicao[h.id] = v)"
                    :rotulo="t('requisicao')"
                    :opcoes="opcoesRequisicao(h.hemocomponente)"
                  />
                </span>
                <SanteBotao
                  variante="secundario"
                  :rotulo="t('ligar')"
                  :desabilitado="ocupado || !escolhaRequisicao[h.id]"
                  :data-testid="`reserva-hemo-ligar-${h.sequencia}`"
                  @acionar="ligar(h.id, h.versao)"
                />
              </template>
              <span v-else class="secundario" :data-testid="`reserva-hemo-sem-requisicao-${h.sequencia}`">
                {{ t('semRequisicao') }}
              </span>
            </template>
            <SanteBotao
              variante="secundario"
              :rotulo="t('cancelar')"
              :desabilitado="ocupado"
              :data-testid="`reserva-hemo-cancelar-${h.sequencia}`"
              @acionar="cancelar('hemocomponentes', h.id, h.versao)"
            />
          </div>
        </li>
      </ul>
      <div v-if="editavel" class="formulario" data-testid="reservas-novo-hemo">
        <span data-testid="reservas-hemocomponente">
          <SanteSelecao v-model="hemoEscolhido" :rotulo="t('hemocomponente')" :opcoes="opcoesHemo" />
        </span>
        <div class="campo">
          <label for="reserva-hemo-qtd">{{ t('bolsas') }}</label>
          <input
            id="reserva-hemo-qtd"
            v-model.number="hemoQtd"
            type="number"
            min="1"
            max="20"
            data-testid="reservas-hemo-qtd"
          />
        </div>
        <div class="campo">
          <label for="reserva-hemo-obs">{{ t('observacao') }}</label>
          <input id="reserva-hemo-obs" v-model="hemoObs" maxlength="255" data-testid="reservas-hemo-obs" />
        </div>
        <ul v-if="problemasHemo.length" class="problemas" role="alert" data-testid="reservas-problemas-hemo">
          <li v-for="p in problemasHemo" :key="p.campo + p.mensagem">{{ p.mensagem }}</li>
        </ul>
        <SanteBotao
          :rotulo="t('pedir')"
          :desabilitado="!podePedir"
          data-testid="reservas-pedir"
          @acionar="pedir"
        />
      </div>
    </template>
    <p v-if="mensagem" role="status" data-testid="reservas-mensagem">{{ mensagem }}</p>
    <ErroCirurgia v-if="erro" :erro="erro" />
  </section>
</template>

<style scoped>
.formulario {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-3);
  align-items: flex-end;
}
.acoes-linha {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: flex-end;
}
.problemas {
  flex-basis: 100%;
  color: var(--sgh-alerta);
}
</style>
