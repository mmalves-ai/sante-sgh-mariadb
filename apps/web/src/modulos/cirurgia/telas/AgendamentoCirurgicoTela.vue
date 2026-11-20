<script setup lang="ts">
// Agendamento cirúrgico (ficha do M18, seção 7): `/cirurgia/agendamentos/:id` (na sala) e
// `/cirurgia/solicitacoes/:id` (pedido que ainda não ocupa a sala). O detalhe com o nome completo (a leitura é
// registrada na trilha), a equipe, os recursos, os procedimentos adicionais, o histórico e os conflitos; as ações
// que o estado permite: mover (cirurgia.remarcarCirurgia, com o controle do que a tela leu), cancelar ou suspender
// com motivo codificado (cirurgia.cancelarCirurgia), marcar o andamento, as pendências pré-operatórias e registrar o
// ato.
import { usarSessao } from '../../../casca/sessao/sessao.js';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { acoesDoEstado } from '@sgh/dominio-cirurgia';
import { dataBr, horaDoContrato } from '../../agenda/formato.js';
import {
  cancelarCirurgia,
  cancelarSolicitacao,
  lerAgendamento,
  lerSolicitacao,
  marcarAndamento,
  moverCirurgia,
  novaChave,
  registrarPendencia,
} from '../api-cirurgia.js';
import AvisoCirurgia from '../componentes/AvisoCirurgia.vue';
import ErroCirurgia from '../componentes/ErroCirurgia.vue';
import { usarCirurgia } from '../usar-cirurgia.js';

const props = defineProps<{ id: string; tipo?: 'agendamento' | 'solicitacao' }>();
const { t } = useI18n();
const cliente = useQueryClient();
const { opcoes, pode, motivoAgenda, salasPermitidas } = usarCirurgia();
const numero = computed(() => Number(props.id));
const ehSolicitacao = computed(() => props.tipo === 'solicitacao');
const encerrado = ref(false);
const detalhe = useQuery({
  queryKey: computed(() => ['cirurgia', ehSolicitacao.value ? 'solicitacao' : 'agendamento', numero.value]),
  queryFn: () => (ehSolicitacao.value ? lerSolicitacao(numero.value) : lerAgendamento(numero.value)),
  enabled: computed(() => !encerrado.value),
});
const d = computed(() => detalhe.data.value);
const a = computed(() => d.value?.agendamento);
const acoes = computed(() => (a.value ? acoesDoEstado(a.value.estado) : null));
const nomeSala = (c: number | null) =>
  c === null ? '—' : (opcoes.data.value?.salas.find((s) => s.codigo === c)?.nome ?? String(c));
const acao = ref<'' | 'mover' | 'cancelar' | 'pendencia'>('');
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);
const podeMover = pode('cirurgia.remarcarCirurgia');
const podeCancelar = pode('cirurgia.cancelarCirurgia');
const podeAndamento = pode('andamento');
const podePendencia = pode('pendencia');
const podeExcecao = pode('excecao');
const podeRegistrar = pode('cirurgia.registrarCirurgia');
// M46 (etapa 1): a APA e a ficha anestésica do agendamento (pela permissão de leitura de cada uma).
const { permissoes } = usarSessao();
const veApa = computed(() => permissoes.value.has('cirurgia.apa.ler'));
const veFicha = computed(() => permissoes.value.has('cirurgia.fichaAnestesica.ler'));
const motivos = computed(() =>
  (opcoes.data.value?.motivos ?? []).map((m) => ({ valor: m.codigo, rotulo: m.texto })),
);
const solicitantes = computed(() =>
  (['paciente', 'hospital', 'equipe', 'convenio'] as const).map((v) => ({
    valor: v,
    rotulo: t(`cirurgia.solicitantes.${v}`),
  })),
);
const tiposPendencia = computed(() =>
  (opcoes.data.value?.pendencias ?? []).map((p) => ({ valor: p.codigo, rotulo: p.rotulo })),
);
const situacoes = computed(() =>
  (['pendente', 'ok', 'dispensada'] as const).map((v) => ({
    valor: v,
    rotulo: t(`cirurgia.situacoesPendencia.${v}`),
  })),
);

const mSala = ref('');
const mData = ref('');
const mHora = ref('');
const mDuracao = ref('');
const mJustificativa = ref('');
const mExcecao = ref(false);
const mMotivoExcecao = ref('');
const cMotivo = ref('PAC-CLINICO');
const cSolicitante = ref('equipe');
const cComplemento = ref('');
const cSuspender = ref(false);
const pTipo = ref('autorizacao');
const pSituacao = ref('pendente');
const pObservacao = ref('');
function abrirMover(): void {
  if (!a.value) return;
  mSala.value = String(a.value.sala);
  mData.value = a.value.data;
  mHora.value = a.value.hora;
  mDuracao.value = String(a.value.duracaoMin);
  acao.value = 'mover';
}

async function rodar(fn: () => Promise<{ mensagem: string }>, encerra = false): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const r = await fn();
    mensagem.value = r.mensagem;
    acao.value = '';
    if (encerra) encerrado.value = true;
    await cliente.invalidateQueries({ queryKey: ['cirurgia'] });
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}
async function mover(): Promise<void> {
  const x = a.value;
  if (!x || x.id === null) return;
  const id = x.id;
  await rodar(() =>
    moverCirurgia(
      id,
      {
        sala: Number(mSala.value),
        data: mData.value,
        hora: horaDoContrato(mHora.value) ?? mHora.value,
        ...(mDuracao.value && Number(mDuracao.value) !== x.duracaoMin
          ? { duracaoMin: Number(mDuracao.value) }
          : {}),
        lido: { sala: x.sala, data: x.data, hora: horaDoContrato(x.hora) ?? x.hora },
        justificativa: mJustificativa.value,
        excecao: mExcecao.value ? { motivo: mMotivoExcecao.value } : null,
      },
      novaChave('mover-cirurgia'),
    ),
  );
}
async function cancelar(): Promise<void> {
  const x = a.value;
  if (!x) return;
  const corpo = {
    motivo: cMotivo.value,
    solicitante: cSolicitante.value,
    suspender: cSuspender.value,
    ...(cComplemento.value.trim() ? { complemento: cComplemento.value } : {}),
  };
  const id = x.id;
  const estado = x.estadoId;
  if (id !== null) await rodar(() => cancelarCirurgia(id, corpo, novaChave('cancelar-cirurgia')), true);
  else if (estado !== null)
    await rodar(() => cancelarSolicitacao(estado, corpo, novaChave('cancelar-solicitacao')));
}
async function andamento(estado: 'no-bloco' | 'em-sala' | 'solicitado'): Promise<void> {
  const id = a.value?.estadoId;
  if (id === null || id === undefined) return;
  await rodar(() => marcarAndamento(id, { estado }, novaChave('andamento')));
}
async function pendencia(): Promise<void> {
  const id = a.value?.estadoId;
  if (id === null || id === undefined) return;
  await rodar(() =>
    registrarPendencia(
      id,
      {
        tipo: pTipo.value,
        situacao: pSituacao.value,
        ...(pObservacao.value.trim() ? { observacao: pObservacao.value } : {}),
      },
      novaChave('pendencia'),
    ),
  );
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="agendamento-titulo" data-testid="tela-agendamento-cirurgico">
    <h1 id="agendamento-titulo">
      {{ ehSolicitacao ? t('cirurgia.agendamento.tituloSolicitacao') : t('cirurgia.agendamento.titulo') }}
    </h1>
    <AvisoCirurgia :motivo="motivoAgenda" />
    <p class="acoes">
      <RouterLink to="/cirurgia/mapa">{{ t('cirurgia.mapa.titulo') }}</RouterLink>
    </p>
    <ErroCirurgia v-if="detalhe.isError.value" :erro="detalhe.error.value" />
    <p v-else-if="!d || !a" role="status">{{ t('cirurgia.carregando') }}</p>
    <template v-else>
      <dl class="painel" data-testid="agendamento-dados">
        <div>
          <dt>{{ t('cirurgia.paciente') }}</dt>
          <dd>{{ d.pacienteNome }} · {{ t('cirurgia.agendamento.prontuario', { n: a.prontuario }) }}</dd>
        </div>
        <div>
          <dt>{{ t('cirurgia.sala') }}</dt>
          <dd>
            {{ nomeSala(a.sala) }} · {{ dataBr(a.data) }}
            {{ t('cirurgia.faixa', { de: a.hora, ate: a.fim }) }} ({{
              t('cirurgia.minutos', { n: a.duracaoMin })
            }})
          </dd>
        </div>
        <div>
          <dt>{{ t('cirurgia.agendamento.estado') }}</dt>
          <dd data-testid="agendamento-estado">{{ a.estadoRotulo }}</dd>
        </div>
        <div>
          <dt>{{ t('cirurgia.procedimento') }}</dt>
          <dd>{{ a.procedimento.nome }} ({{ a.procedimento.codigo }})</dd>
        </div>
        <div v-if="d.procedimentosAdicionais.length">
          <dt>{{ t('cirurgia.agendamento.adicionais') }}</dt>
          <dd>{{ d.procedimentosAdicionais.map((p) => p.nome).join(' · ') }}</dd>
        </div>
        <div>
          <dt>{{ t('cirurgia.agendamento.equipe') }}</dt>
          <dd>{{ a.equipe.map((e) => `${e.rotulo}: ${e.nome}`).join(' · ') || '—' }}</dd>
        </div>
        <div>
          <dt>{{ t('cirurgia.anestesia') }}</dt>
          <dd>{{ a.anestesia.nome }}</dd>
        </div>
        <div v-if="a.recursos.length">
          <dt>{{ t('cirurgia.mapa.recursos') }}</dt>
          <dd>{{ a.recursos.join(' · ') }}</dd>
        </div>
        <div v-if="a.observacao">
          <dt>{{ t('cirurgia.observacao') }}</dt>
          <dd>{{ a.observacao }}</dd>
        </div>
        <div v-if="d.motivo">
          <dt>{{ t('cirurgia.motivo') }}</dt>
          <dd>
            {{ d.motivo.texto }}<span v-if="d.motivo.complemento"> · {{ d.motivo.complemento }}</span>
          </dd>
        </div>
      </dl>
      <SanteAlerta
        v-if="d.conflitos.length"
        variante="aviso"
        :texto="
          t('cirurgia.agendamento.conflitos', {
            lista: d.conflitos.map((c) => c.inicio.slice(11)).join(', '),
          })
        "
        data-testid="alerta-conflito"
      />
      <SanteAlerta v-if="a.excecao" variante="info" :texto="t('cirurgia.mapa.excecao')" />

      <div v-if="!encerrado" class="acoes">
        <SanteBotao
          v-if="podeMover && acoes?.mover && a.id !== null"
          variante="secundario"
          :rotulo="t('cirurgia.agendamento.mover')"
          @acionar="abrirMover"
        />
        <SanteBotao
          v-if="podeCancelar && acoes?.cancelar"
          variante="secundario"
          :rotulo="t('cirurgia.agendamento.cancelar')"
          @acionar="acao = 'cancelar'"
        />
        <SanteBotao
          v-if="podeAndamento && acoes?.marcarNoBloco && a.estadoId !== null"
          variante="secundario"
          :rotulo="t('cirurgia.agendamento.noBloco')"
          @acionar="andamento('no-bloco')"
        />
        <SanteBotao
          v-if="podeAndamento && acoes?.marcarEmSala && a.estadoId !== null"
          variante="secundario"
          :rotulo="t('cirurgia.agendamento.emSala')"
          @acionar="andamento('em-sala')"
        />
        <SanteBotao
          v-if="podeAndamento && acoes?.retomar && a.estadoId !== null"
          variante="secundario"
          :rotulo="t('cirurgia.agendamento.retomar')"
          @acionar="andamento('solicitado')"
        />
        <SanteBotao
          v-if="podePendencia && a.estadoId !== null"
          variante="secundario"
          :rotulo="t('cirurgia.agendamento.pendencia')"
          @acionar="acao = 'pendencia'"
        />
        <RouterLink v-if="veApa && a.id !== null" :to="`/bloco/apa/${a.id}`" data-testid="link-apa">
          {{ t('anestesia.apa.titulo') }}
        </RouterLink>
        <RouterLink
          v-if="veFicha && a.id !== null"
          :to="`/bloco/ficha-anestesica/${a.id}`"
          data-testid="link-ficha"
        >
          {{ t('anestesia.ficha.titulo') }}
        </RouterLink>
        <RouterLink
          v-if="podeRegistrar && acoes?.registrar && a.id !== null"
          :to="`/cirurgia/registro?agendamento=${a.id}`"
          data-testid="link-registrar"
        >
          {{ t('cirurgia.agendamento.registrar') }}
        </RouterLink>
      </div>

      <section
        v-if="acao === 'mover'"
        class="painel"
        aria-labelledby="mover-cirurgia"
        data-testid="form-mover-cirurgia"
      >
        <h2 id="mover-cirurgia">{{ t('cirurgia.agendamento.mover') }}</h2>
        <div class="filtros">
          <SanteSelecao v-model="mSala" :rotulo="t('cirurgia.sala')" :opcoes="salasPermitidas" />
          <div class="campo">
            <label for="mover-data">{{ t('cirurgia.data') }}</label>
            <input id="mover-data" v-model="mData" type="date" data-testid="mover-data" />
          </div>
          <div class="campo">
            <label for="mover-hora">{{ t('cirurgia.inicio') }}</label>
            <input
              id="mover-hora"
              v-model="mHora"
              inputmode="numeric"
              :placeholder="t('cirurgia.horaExemplo')"
              data-testid="mover-hora"
            />
          </div>
          <div class="campo">
            <label for="mover-duracao">{{ t('cirurgia.duracaoMin') }}</label>
            <input id="mover-duracao" v-model="mDuracao" type="number" min="5" max="1439" step="5" />
          </div>
        </div>
        <SanteCampoTexto
          v-model="mJustificativa"
          :rotulo="t('cirurgia.agendamento.justificativa')"
          :max-bytes="150"
        />
        <template v-if="podeExcecao">
          <label><input v-model="mExcecao" type="checkbox" /> {{ t('cirurgia.mapa.excecaoPedido') }}</label>
          <SanteCampoTexto
            v-if="mExcecao"
            v-model="mMotivoExcecao"
            :rotulo="t('cirurgia.mapa.motivoExcecao')"
            :max-bytes="200"
          />
        </template>
        <div class="acoes">
          <SanteBotao
            :rotulo="t('cirurgia.agendamento.confirmarMover')"
            :desabilitado="ocupado || mJustificativa.trim().length < 5 || !horaDoContrato(mHora)"
            data-testid="confirmar-mover"
            @acionar="mover"
          />
          <SanteBotao variante="texto" :rotulo="t('cirurgia.voltar')" @acionar="acao = ''" />
        </div>
      </section>

      <section
        v-if="acao === 'cancelar'"
        class="painel"
        aria-labelledby="cancelar-cirurgia"
        data-testid="form-cancelar-cirurgia"
      >
        <h2 id="cancelar-cirurgia">{{ t('cirurgia.agendamento.cancelar') }}</h2>
        <div class="filtros">
          <SanteSelecao v-model="cMotivo" :rotulo="t('cirurgia.motivo')" :opcoes="motivos" />
          <SanteSelecao
            v-model="cSolicitante"
            :rotulo="t('cirurgia.agendamento.quemPediu')"
            :opcoes="solicitantes"
          />
          <label
            ><input v-model="cSuspender" type="checkbox" /> {{ t('cirurgia.agendamento.suspender') }}</label
          >
        </div>
        <p class="secundario">
          {{
            cSuspender ? t('cirurgia.agendamento.suspenderTexto') : t('cirurgia.agendamento.cancelarTexto')
          }}
        </p>
        <SanteCampoTexto v-model="cComplemento" :rotulo="t('cirurgia.complemento')" :max-bytes="200" />
        <div class="acoes">
          <SanteBotao
            variante="destrutivo"
            :rotulo="
              cSuspender
                ? t('cirurgia.agendamento.confirmarSuspender')
                : t('cirurgia.agendamento.confirmarCancelar')
            "
            :confirmacao="t('cirurgia.agendamento.cancelarPergunta', { paciente: a.paciente })"
            data-testid="confirmar-cancelar-cirurgia"
            @acionar="cancelar"
          />
          <SanteBotao variante="texto" :rotulo="t('cirurgia.voltar')" @acionar="acao = ''" />
        </div>
      </section>

      <section class="painel" aria-labelledby="pendencias-titulo">
        <h2 id="pendencias-titulo">{{ t('cirurgia.agendamento.pendencias') }}</h2>
        <p v-if="d.pendencias.length === 0">{{ t('cirurgia.nenhuma') }}</p>
        <ul v-else>
          <li v-for="p in d.pendencias" :key="p.id">
            {{ p.rotulo }}: {{ p.situacao }}<span v-if="p.observacao"> · {{ p.observacao }}</span>
          </li>
        </ul>
        <form v-if="acao === 'pendencia'" class="filtros" @submit.prevent="pendencia">
          <SanteSelecao
            v-model="pTipo"
            :rotulo="t('cirurgia.agendamento.tipoPendencia')"
            :opcoes="tiposPendencia"
          />
          <SanteSelecao
            v-model="pSituacao"
            :rotulo="t('cirurgia.agendamento.situacaoPendencia')"
            :opcoes="situacoes"
          />
          <SanteCampoTexto v-model="pObservacao" :rotulo="t('cirurgia.observacao')" :max-bytes="200" />
          <SanteBotao tipo="submit" :rotulo="t('cirurgia.gravar')" :desabilitado="ocupado" />
        </form>
      </section>

      <section v-if="d.historico.length" class="painel" aria-labelledby="historico-titulo">
        <h2 id="historico-titulo">{{ t('cirurgia.agendamento.historico') }}</h2>
        <ul>
          <li v-for="(h, i) in d.historico" :key="i">
            {{ h.quando }} · {{ h.operacao }} · {{ h.usuario }}: {{ nomeSala(h.salaAnterior) }}
            {{ t('cirurgia.agendamento.de', { de: h.inicioAnterior ?? '—' }) }}
            {{ t('cirurgia.agendamento.para', { sala: nomeSala(h.sala), inicio: h.inicio ?? '—' }) }}
            <span v-if="h.justificativa"> · {{ h.justificativa }}</span>
          </li>
        </ul>
      </section>
    </template>
    <p v-if="mensagem" role="status" data-testid="agendamento-mensagem">{{ mensagem }}</p>
    <ErroCirurgia v-if="erro" :erro="erro" />
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
