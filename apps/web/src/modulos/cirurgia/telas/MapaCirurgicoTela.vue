<script setup lang="ts">
// Agenda cirúrgica (ficha do M18, seção 7): `/cirurgia/mapa`. O mapa das salas por dia (até 7 dias), com a
// ocupação, o alerta das cirurgias que se cruzam (gravadas fora destas telas) e das datas impossíveis; as
// solicitações que ainda não ocupam a sala; e o pedido de sala: agendar na sala (cirurgia.agendarCirurgia, com a
// recusa de sobreposição e a sugestão do próximo início livre; a urgência em sala ocupada só com a permissão de
// exceção e o motivo) ou só solicitar (registro do novo).
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import type { AgendamentoCirurgico, ResultadoBuscaPaciente } from '@sgh/contratos';
import { aplicarSugestoesDoProcedimento, proximoInicioLivre } from '@sgh/dominio-cirurgia';
import { dataBr, horaDoContrato } from '../../agenda/formato.js';
import { buscarPacientes } from '../../cadastro/api-cadastro.js';
import {
  agendarCirurgia,
  buscarProcedimentos,
  cancelarSolicitacao,
  codigoDaRecusa,
  lerMapa,
  lerSolicitacao,
  novaChave,
  solicitarCirurgia,
} from '../api-cirurgia.js';
import { lerCartaoAplicavel } from '../api-cartao-preferencia.js';
import { lerGradeAberta } from '../api-grade-sala.js';
import AvisoCirurgia from '../componentes/AvisoCirurgia.vue';
import ErroCirurgia from '../componentes/ErroCirurgia.vue';
import { profissionalDaEscolha, usarCirurgia } from '../usar-cirurgia.js';

const { t } = useI18n();
const roteador = useRouter();
const cliente = useQueryClient();
const { opcoes, pode, motivoAgenda, salas, salasPermitidas, profissionais, convenios } = usarCirurgia();

// ── Mapa ──
// `?inicio=AAAA-MM-DD` abre o mapa já no dia (o atalho do pedido do portal na tela das contas do médico externo).
const rota = useRoute();
const inicioDaRota =
  typeof rota.query['inicio'] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rota.query['inicio'])
    ? rota.query['inicio']
    : '';
const inicio = ref(inicioDaRota);
const dias = ref('1');
const sala = ref('');
const pedidoMapa = ref({ inicio: inicioDaRota, dias: 1, sala: '' });
const mapa = useQuery({
  queryKey: computed(() => ['cirurgia', 'mapa', pedidoMapa.value]),
  queryFn: () =>
    lerMapa(
      pedidoMapa.value.inicio || null,
      pedidoMapa.value.dias,
      pedidoMapa.value.sala ? Number(pedidoMapa.value.sala) : null,
    ),
});
// 04-CC linha 92: a grade aberta de cada sala no período do mapa, pintada sob os blocos (sala sem grade: nada).
const gradeAberta = useQuery({
  queryKey: computed(() => [
    'cirurgia',
    'grade-sala',
    'aberta',
    mapa.data.value?.de ?? '',
    pedidoMapa.value.dias,
  ]),
  queryFn: () => lerGradeAberta(mapa.data.value?.de ?? '', pedidoMapa.value.dias),
  enabled: computed(() => !!mapa.data.value?.de),
});
const gradeDa = (dia: string, sala: number) => {
  const d = gradeAberta.data.value?.dias.find((x) => x.dia === dia);
  const s = d?.salas.find((x) => x.sala === sala);
  return s ? { feriado: d?.feriado ?? false, faixas: s.faixas } : null;
};
const estiloFaixa = (f: { inicio: string; fim: string }) => {
  const ini = Math.min(Math.max(minutos(f.inicio) - ABRE, 0), TURNO);
  const fim = Math.min(Math.max(minutos(f.fim) - ABRE, 0), TURNO);
  return { left: `${(ini / TURNO) * 100}%`, width: `${((fim - ini) / TURNO) * 100}%` };
};
function verMapa(): void {
  pedidoMapa.value = { inicio: inicio.value, dias: Number(dias.value), sala: sala.value };
}
const escolhasDias = computed(() =>
  [1, 3, 5, 7].map((d) => ({ valor: String(d), rotulo: t('cirurgia.mapa.dias', { n: d }) })),
);
const escolhasSala = computed(() => [{ valor: '', rotulo: t('cirurgia.todasSalas') }, ...salas.value]);
const nomeSala = (c: number) => opcoes.data.value?.salas.find((s) => s.codigo === c)?.nome ?? String(c);
const ABRE = 7 * 60;
const TURNO = 14 * 60;
const minutos = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
const estiloBloco = (a: AgendamentoCirurgico) => {
  const ini = Math.max(minutos(a.hora) - ABRE, 0);
  const tam = Math.max(Math.min(a.duracaoMin, TURNO - ini), 5);
  return { left: `${(ini / TURNO) * 100}%`, width: `${(tam / TURNO) * 100}%` };
};

// ── Pedido de sala ──
const podeAgendar = pode('cirurgia.agendarCirurgia');
const podeSolicitar = pode('solicitar');
const podeExcecao = pode('excecao');
const podeCancelar = pode('cirurgia.cancelarCirurgia');
const fSala = ref('');
const fData = ref('');
const fHora = ref('');
const fDuracao = ref('60');
const fReg = ref('');
const fAtendimento = ref('I');
const fEspecialidade = ref('');
const fConvenio = ref('');
const fAnestesia = ref('');
const fCarater = ref('2');
const fCirurgiao = ref('');
// M50 (etapa 3): o cirurgião do pedido do portal que ainda não atuou no bloco entra nas opções do cirurgião.
const cirurgiaoDoPedido = ref<{ valor: string; rotulo: string } | null>(null);
const cirurgioes = computed(() =>
  cirurgiaoDoPedido.value && !profissionais.value.some((p) => p.valor === cirurgiaoDoPedido.value?.valor)
    ? [cirurgiaoDoPedido.value, ...profissionais.value]
    : profissionais.value,
);
const fAnestesista = ref('');
const fAuxiliar = ref('');
const fRecursos = ref<string[]>([]);
const fObservacao = ref('');
const fExcecao = ref(false);
const fMotivoExcecao = ref('');
const solicitacao = ref<number | null>(null);
const termoProc = ref('');
type ProcedimentoBuscado = Awaited<ReturnType<typeof buscarProcedimentos>>[number];
const procs = ref<ProcedimentoBuscado[]>([]);
const procedimento = ref<{ codigo: number; nome: string } | null>(null);
// C1-089: escolher o procedimento aplica o caráter, a anestesia e a duração sugeridos pelo cadastro dele.
function escolherProcedimento(p: ProcedimentoBuscado): void {
  procedimento.value = p;
  const idOuNulo = (v: string) => (v ? Number(v) : null);
  const r = aplicarSugestoesDoProcedimento(
    {
      carater: idOuNulo(fCarater.value),
      anestesia: idOuNulo(fAnestesia.value),
      duracaoMin: idOuNulo(fDuracao.value),
    },
    p,
  );
  fCarater.value = r.carater === null ? fCarater.value : String(r.carater);
  fAnestesia.value = r.anestesia === null ? '' : String(r.anestesia);
  fDuracao.value = r.duracaoMin === null ? fDuracao.value : String(r.duracaoMin);
}
async function procurarProcedimento(): Promise<void> {
  procs.value = termoProc.value.trim().length >= 3 ? await buscarProcedimentos(termoProc.value.trim()) : [];
}
const termo = ref('');
const pedidoPaciente = ref('');
const pacientes = useQuery({
  queryKey: computed(() => ['cirurgia', 'pacientes', pedidoPaciente.value]),
  queryFn: (): Promise<ResultadoBuscaPaciente> => buscarPacientes(pedidoPaciente.value),
  enabled: computed(() => pedidoPaciente.value.length >= 2),
});
const paciente = ref<{ id: number; nome: string } | null>(null);
const comVazio = (l: { valor: string; rotulo: string }[], rotulo = t('cirurgia.escolha')) => [
  { valor: '', rotulo },
  ...l,
];
const anestesias = computed(() =>
  comVazio(
    (opcoes.data.value?.anestesias ?? []).map((a) => ({ valor: String(a.codigo), rotulo: a.nome })),
    t('cirurgia.naoInformada'),
  ),
);
const caracteres = computed(() =>
  (opcoes.data.value?.caracteres ?? []).map((c) => ({ valor: String(c.codigo), rotulo: c.nome })),
);
const especialidades = computed(() =>
  comVazio(
    (opcoes.data.value?.especialidades ?? []).map((e) => ({ valor: String(e.codigo), rotulo: e.nome })),
  ),
);
const atendimentos = computed(() => [
  { valor: 'I', rotulo: t('cirurgia.atendimentos.I') },
  { valor: 'E', rotulo: t('cirurgia.atendimentos.E') },
]);
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const sugestao = ref<string | null>(null);
const ocupado = ref(false);
const chave = ref(novaChave('agendar-cirurgia'));
const pronto = computed(
  () =>
    !!fSala.value &&
    !!fData.value &&
    !!horaDoContrato(fHora.value) &&
    Number(fDuracao.value) > 0 &&
    paciente.value !== null &&
    procedimento.value !== null &&
    !!fConvenio.value &&
    (!fExcecao.value || fMotivoExcecao.value.trim().length >= 10),
);

// C1-012 (F8, 04-CC L105): com o cirurgião e o procedimento escolhidos, o cartão de preferência que vale na data do
// pedido sugere sala, tempo e posição; um clique preenche sala e duração (editáveis), nada é imposto.
const cartaoDoPedido = useQuery({
  queryKey: computed(() => [
    'cirurgia',
    'cartao-aplicavel',
    fCirurgiao.value,
    procedimento.value?.codigo ?? null,
    fData.value,
  ]),
  queryFn: () =>
    lerCartaoAplicavel(
      profissionalDaEscolha(fCirurgiao.value)?.id ?? 0,
      procedimento.value?.codigo ?? null,
      fData.value || null,
    ),
  enabled: computed(() => !!profissionalDaEscolha(fCirurgiao.value) && procedimento.value !== null),
  retry: false,
});
const sugestaoCartao = computed(() =>
  cartaoDoPedido.data.value?.cartao && cartaoDoPedido.data.value.mapa ? cartaoDoPedido.data.value : null,
);
const salaDoCartaoPermitida = computed(() => {
  const s = sugestaoCartao.value?.mapa?.sala;
  return s !== null && s !== undefined && salasPermitidas.value.some((x) => x.valor === String(s));
});
function usarCartao(): void {
  const m = sugestaoCartao.value?.mapa;
  if (!m) return;
  if (m.sala !== null && salaDoCartaoPermitida.value) fSala.value = String(m.sala);
  if (m.tempoMinutos) fDuracao.value = String(m.tempoMinutos);
}

function equipe() {
  const e: Record<string, { id: number; cod: number }> = {};
  const c = profissionalDaEscolha(fCirurgiao.value);
  if (c) e['cirurgiao'] = c;
  const a = profissionalDaEscolha(fAnestesista.value);
  if (a) e['anestesista'] = a;
  const x = profissionalDaEscolha(fAuxiliar.value);
  if (x) e['auxiliar1'] = x;
  return e;
}

async function agendar(): Promise<void> {
  if (!pronto.value || !paciente.value || !procedimento.value) return;
  erro.value = null;
  mensagem.value = null;
  sugestao.value = null;
  ocupado.value = true;
  const hora = horaDoContrato(fHora.value) ?? fHora.value;
  try {
    const r = await agendarCirurgia(
      {
        sala: Number(fSala.value),
        data: fData.value,
        hora,
        duracaoMin: Number(fDuracao.value),
        paciente: paciente.value.id,
        reg: fReg.value ? Number(fReg.value) : 0,
        atendimento: fAtendimento.value,
        especialidade: fEspecialidade.value ? Number(fEspecialidade.value) : 0,
        convenio: Number(fConvenio.value),
        procedimento: procedimento.value.codigo,
        anestesia: fAnestesia.value ? Number(fAnestesia.value) : 0,
        equipe: equipe(),
        recursos: fRecursos.value,
        carater: Number(fCarater.value),
        solicitacao: solicitacao.value,
        excecao: fExcecao.value ? { motivo: fMotivoExcecao.value } : null,
        ...(fObservacao.value.trim() ? { observacao: fObservacao.value } : {}),
      },
      chave.value,
    );
    mensagem.value = r.mensagem;
    chave.value = novaChave('agendar-cirurgia');
    await cliente.invalidateQueries({ queryKey: ['cirurgia'] });
    const id = Number(r.resultado['agendamento']);
    if (id) await roteador.push(`/cirurgia/agendamentos/${id}`);
  } catch (e) {
    erro.value = e;
    chave.value = novaChave('agendar-cirurgia');
    if (codigoDaRecusa(e) === 'sala-ocupada') sugerir(hora);
  } finally {
    ocupado.value = false;
  }
}

/** Próximo início livre na mesma sala e dia, pelo mapa lido (o servidor reconfere ao gravar). */
async function sugerir(hora: string): Promise<void> {
  const m = await lerMapa(fData.value, 1, Number(fSala.value)).catch(() => null);
  const ags = m?.dias[0]?.salas[0]?.agendamentos ?? [];
  const livre = proximoInicioLivre(
    Number(fSala.value),
    `${fData.value} ${hora.slice(0, 2)}:${hora.slice(2)}`,
    Number(fDuracao.value),
    ags
      .filter((a) => a.id !== null)
      .map((a) => ({
        id: a.id as number,
        sala: a.sala,
        inicio: `${a.data} ${a.hora}`,
        duracaoMin: a.duracaoMin,
        intervaloMin: a.intervaloMin,
      })),
    15,
    m?.preparoMinimoMin ?? 0,
  );
  sugestao.value = livre ? livre.slice(11) : null;
}
function usarSugestao(): void {
  if (sugestao.value) fHora.value = sugestao.value;
  sugestao.value = null;
  erro.value = null;
}

async function solicitar(): Promise<void> {
  if (!paciente.value || !procedimento.value) return;
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const c = profissionalDaEscolha(fCirurgiao.value);
    const r = await solicitarCirurgia(
      {
        sala: Number(fSala.value),
        data: fData.value,
        hora: horaDoContrato(fHora.value) ?? fHora.value,
        duracaoMin: Number(fDuracao.value),
        paciente: paciente.value.id,
        reg: fReg.value ? Number(fReg.value) : 0,
        procedimento: procedimento.value.codigo,
        convenio: Number(fConvenio.value),
        cirurgiao: c ? c.id : null,
        carater: Number(fCarater.value),
        anestesia: fAnestesia.value ? Number(fAnestesia.value) : 0,
        ...(fObservacao.value.trim() ? { observacao: fObservacao.value } : {}),
      },
      novaChave('solicitar-cirurgia'),
    );
    mensagem.value = r.mensagem;
    await cliente.invalidateQueries({ queryKey: ['cirurgia'] });
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}

async function confirmarSolicitacao(s: AgendamentoCirurgico): Promise<void> {
  solicitacao.value = s.estadoId;
  cirurgiaoDoPedido.value = null;
  // M50 (etapa 3): o pedido do portal do médico externo vem sem o cadastro; a busca já começa pelo nome informado, e o
  // cirurgião do pedido entra nas opções mesmo que ainda não tenha atuado no bloco.
  if (s.pedidoPortal && s.estadoId !== null) {
    const d = await lerSolicitacao(s.estadoId).catch(() => null);
    const nome = d?.agendamento.pedidoPortal?.paciente ?? '';
    if (nome) {
      paciente.value = null;
      termo.value = nome;
      pedidoPaciente.value = nome;
    }
    const cir = d?.agendamento.pedidoPortal?.cirurgiao;
    if (cir) cirurgiaoDoPedido.value = { valor: `${cir.id}:${cir.cod}`, rotulo: cir.nome };
  }
  fSala.value = String(s.sala);
  fData.value = s.data;
  fHora.value = s.hora;
  fDuracao.value = String(s.duracaoMin);
  fConvenio.value = String(s.convenio);
  procedimento.value = s.procedimento;
  const cir = s.equipe.find((x) => x.funcao === 'cirurgiao');
  const p = cir ? opcoes.data.value?.profissionais.find((x) => x.id === cir.id) : undefined;
  const doPedido =
    cir && cirurgiaoDoPedido.value?.valor.startsWith(`${cir.id}:`) ? cirurgiaoDoPedido.value.valor : '';
  fCirurgiao.value = p ? `${p.id}:${p.cod}` : doPedido;
  mensagem.value = t('cirurgia.mapa.confirmandoSolicitacao');
}
async function descartarSolicitacao(s: AgendamentoCirurgico): Promise<void> {
  if (s.estadoId === null) return;
  erro.value = null;
  try {
    const r = await cancelarSolicitacao(
      s.estadoId,
      { motivo: 'ERRO-AGENDAMENTO', solicitante: 'hospital' },
      novaChave('cancelar-solicitacao'),
    );
    mensagem.value = r.mensagem;
    await cliente.invalidateQueries({ queryKey: ['cirurgia'] });
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="mapa-titulo" data-testid="tela-mapa-cirurgico">
    <h1 id="mapa-titulo">{{ t('cirurgia.mapa.titulo') }}</h1>
    <p>{{ t('cirurgia.mapa.texto') }}</p>
    <AvisoCirurgia :motivo="motivoAgenda" />
    <p class="acoes">
      <RouterLink to="/cirurgia/registro">{{ t('cirurgia.registro.titulo') }}</RouterLink>
      <RouterLink to="/cirurgia/salas">{{ t('cirurgia.salas.titulo') }}</RouterLink>
      <RouterLink to="/cirurgia/cancelamentos">{{ t('cirurgia.cancelamentos.titulo') }}</RouterLink>
    </p>
    <form class="filtros" @submit.prevent="verMapa">
      <div class="campo">
        <label for="mapa-inicio">{{ t('cirurgia.mapa.inicio') }}</label>
        <input id="mapa-inicio" v-model="inicio" type="date" data-testid="mapa-inicio" />
      </div>
      <SanteSelecao v-model="dias" :rotulo="t('cirurgia.mapa.periodo')" :opcoes="escolhasDias" />
      <SanteSelecao v-model="sala" :rotulo="t('cirurgia.sala')" :opcoes="escolhasSala" />
      <SanteBotao tipo="submit" :rotulo="t('cirurgia.mapa.ver')" />
    </form>
    <ErroCirurgia v-if="mapa.isError.value" :erro="mapa.error.value" />
    <p v-else-if="!mapa.data.value" role="status">{{ t('cirurgia.carregando') }}</p>
    <template v-else>
      <SanteAlerta
        v-if="mapa.data.value.sobreposicoes > 0"
        variante="aviso"
        :texto="t('cirurgia.mapa.sobreposicoes', { n: mapa.data.value.sobreposicoes })"
        data-testid="alerta-sobreposicao"
      />
      <SanteAlerta
        v-if="mapa.data.value.datasImpossiveis > 0"
        variante="aviso"
        :texto="t('cirurgia.mapa.datasImpossiveis', { n: mapa.data.value.datasImpossiveis })"
      />
      <section
        v-for="d in mapa.data.value.dias"
        :key="d.dia"
        class="painel"
        :aria-labelledby="`mapa-dia-${d.dia}`"
      >
        <h2 :id="`mapa-dia-${d.dia}`">{{ t('cirurgia.mapa.dia', { data: dataBr(d.dia) }) }}</h2>
        <div
          v-for="s in d.salas"
          :key="s.sala"
          class="sala-do-mapa"
          :data-testid="`mapa-${d.dia}-sala-${s.sala}`"
        >
          <h3>{{ nomeSala(s.sala) }} · {{ t('cirurgia.mapa.ocupacao', { p: s.ocupacao }) }}</h3>
          <p
            v-if="gradeDa(d.dia, s.sala)"
            class="secundario"
            :data-testid="`mapa-grade-${d.dia}-sala-${s.sala}`"
          >
            {{
              gradeDa(d.dia, s.sala)?.faixas.length
                ? t('cirurgia.gradeSala.mapaAberta', {
                    faixas: gradeDa(d.dia, s.sala)
                      ?.faixas.map((g) => t('cirurgia.faixa', { de: g.inicio, ate: g.fim }))
                      .join(', '),
                  })
                : gradeDa(d.dia, s.sala)?.feriado
                  ? t('cirurgia.gradeSala.mapaFechadaFeriado')
                  : t('cirurgia.gradeSala.mapaFechada')
            }}
          </p>
          <div class="linha-do-tempo" aria-hidden="true">
            <span
              v-for="g in gradeDa(d.dia, s.sala)?.faixas ?? []"
              :key="`g-${g.inicio}`"
              class="faixa-aberta"
              :style="estiloFaixa(g)"
            ></span>
            <span
              v-for="a in s.agendamentos"
              :key="a.id ?? a.estadoId ?? a.hora"
              class="bloco"
              :class="{ sobreposto: a.sobreposto }"
              :style="estiloBloco(a)"
            ></span>
          </div>
          <p v-if="s.agendamentos.length === 0" class="secundario">{{ t('cirurgia.mapa.salaLivre') }}</p>
          <ul v-else>
            <li v-for="a in s.agendamentos" :key="a.id ?? a.hora" class="acoes">
              <strong>{{ t('cirurgia.faixa', { de: a.hora, ate: a.fim }) }}</strong>
              {{ a.paciente }} · {{ a.procedimento.nome }} · {{ a.estadoRotulo }}
              <span v-if="a.equipe[0]" class="secundario">· {{ a.equipe[0].nome }}</span>
              <SanteAlerta v-if="a.sobreposto" variante="aviso" :texto="t('cirurgia.mapa.cruza')" />
              <SanteAlerta v-if="a.excecao" variante="info" :texto="t('cirurgia.mapa.excecao')" />
              <span v-if="a.pendencias > 0" class="secundario"
                >· {{ t('cirurgia.mapa.pendencias', { n: a.pendencias }) }}</span
              >
              <RouterLink
                v-if="a.id !== null"
                :to="`/cirurgia/agendamentos/${a.id}`"
                :data-testid="`abrir-agendamento-${a.id}`"
                :aria-label="t('cirurgia.mapa.abrir', { hora: a.hora, sala: nomeSala(a.sala) })"
              >
                {{ t('cirurgia.mapa.abrirCurto') }}
              </RouterLink>
            </li>
          </ul>
        </div>
      </section>
      <section class="painel" aria-labelledby="mapa-solicitacoes" data-testid="lista-solicitacoes">
        <h2 id="mapa-solicitacoes">{{ t('cirurgia.mapa.solicitacoes') }}</h2>
        <p v-if="mapa.data.value.solicitacoes.length === 0">{{ t('cirurgia.nenhuma') }}</p>
        <ul v-else>
          <li v-for="s in mapa.data.value.solicitacoes" :key="s.estadoId ?? s.hora" class="acoes">
            {{ dataBr(s.data) }} {{ s.hora }} · {{ nomeSala(s.sala) }} · {{ s.paciente }} ·
            {{ s.procedimento.nome }} ·
            {{ s.estadoRotulo }}
            <span v-if="s.pedidoPortal" class="secundario" :data-testid="`solicitacao-portal-${s.estadoId}`">
              · {{ t('cirurgia.mapa.pedidoPortal', { medico: s.pedidoPortal.medico }) }}</span
            >
            <RouterLink v-if="s.estadoId !== null" :to="`/cirurgia/solicitacoes/${s.estadoId}`">{{
              t('cirurgia.mapa.abrirCurto')
            }}</RouterLink>
            <SanteBotao
              v-if="podeAgendar && s.estado === 'solicitado'"
              variante="texto"
              :rotulo="t('cirurgia.mapa.confirmarNaSala')"
              @acionar="confirmarSolicitacao(s)"
            />
            <SanteBotao
              v-if="podeCancelar"
              variante="destrutivo"
              :rotulo="t('cirurgia.mapa.descartar')"
              :confirmacao="t('cirurgia.mapa.descartarPergunta', { paciente: s.paciente })"
              @acionar="descartarSolicitacao(s)"
            />
          </li>
        </ul>
      </section>
    </template>

    <section
      v-if="podeAgendar || podeSolicitar"
      class="painel"
      aria-labelledby="mapa-pedido"
      data-testid="form-agendar-cirurgia"
    >
      <h2 id="mapa-pedido">
        {{ solicitacao ? t('cirurgia.mapa.confirmarSolicitacao') : t('cirurgia.mapa.pedido') }}
      </h2>
      <div class="filtros">
        <SanteSelecao v-model="fSala" :rotulo="t('cirurgia.sala')" :opcoes="comVazio(salasPermitidas)" />
        <div class="campo">
          <label for="pedido-data">{{ t('cirurgia.data') }}</label>
          <input id="pedido-data" v-model="fData" type="date" data-testid="pedido-data" />
        </div>
        <div class="campo">
          <label for="pedido-hora">{{ t('cirurgia.inicio') }}</label>
          <input
            id="pedido-hora"
            v-model="fHora"
            inputmode="numeric"
            :placeholder="t('cirurgia.horaExemplo')"
            data-testid="pedido-hora"
          />
        </div>
        <div class="campo">
          <label for="pedido-duracao">{{ t('cirurgia.duracaoMin') }}</label>
          <input
            id="pedido-duracao"
            v-model="fDuracao"
            type="number"
            min="5"
            max="1439"
            step="5"
            data-testid="pedido-duracao"
          />
        </div>
      </div>
      <p v-if="salasPermitidas.length === 0" class="secundario">{{ t('cirurgia.mapa.semSala') }}</p>
      <form class="filtros" role="search" @submit.prevent="pedidoPaciente = termo.trim()">
        <div class="campo">
          <label for="pedido-termo">{{ t('cirurgia.mapa.termoPaciente') }}</label>
          <input
            id="pedido-termo"
            v-model="termo"
            type="search"
            autocomplete="off"
            data-testid="pedido-termo"
          />
        </div>
        <SanteBotao tipo="submit" variante="secundario" :rotulo="t('cirurgia.mapa.buscarPaciente')" />
      </form>
      <ul v-if="pacientes.data.value && !paciente">
        <li v-for="p in pacientes.data.value.itens" :key="p.id">
          <SanteBotao
            variante="texto"
            :rotulo="t('cirurgia.mapa.escolherPaciente', { nome: p.nomeSocial ?? p.nome })"
            :data-testid="`paciente-cirurgia-${p.id}`"
            @acionar="paciente = { id: p.id, nome: p.nomeSocial ?? p.nome }"
          />
        </li>
      </ul>
      <p v-if="paciente" class="acoes" data-testid="paciente-cirurgia-escolhido">
        {{ t('cirurgia.mapa.pacienteEscolhido', { nome: paciente.nome }) }}
        <SanteBotao variante="texto" :rotulo="t('cirurgia.trocar')" @acionar="paciente = null" />
      </p>
      <form class="filtros" role="search" @submit.prevent="procurarProcedimento">
        <div class="campo">
          <label for="pedido-proc">{{ t('cirurgia.mapa.termoProcedimento') }}</label>
          <input
            id="pedido-proc"
            v-model="termoProc"
            type="search"
            autocomplete="off"
            data-testid="pedido-procedimento"
          />
        </div>
        <SanteBotao tipo="submit" variante="secundario" :rotulo="t('cirurgia.mapa.buscarProcedimento')" />
      </form>
      <ul v-if="procs.length && !procedimento">
        <li v-for="p in procs" :key="p.codigo">
          <SanteBotao
            variante="texto"
            :rotulo="t('cirurgia.mapa.escolherProcedimento', { nome: p.nome, codigo: p.codigo })"
            :data-testid="`procedimento-${p.codigo}`"
            @acionar="escolherProcedimento(p)"
          />
        </li>
      </ul>
      <p v-if="procedimento" class="acoes" data-testid="procedimento-escolhido">
        {{ t('cirurgia.mapa.procedimentoEscolhido', { nome: procedimento.nome }) }}
        <SanteBotao variante="texto" :rotulo="t('cirurgia.trocar')" @acionar="procedimento = null" />
      </p>
      <div class="filtros">
        <SanteSelecao v-model="fConvenio" :rotulo="t('cirurgia.convenio')" :opcoes="comVazio(convenios)" />
        <SanteSelecao
          v-model="fEspecialidade"
          :rotulo="t('cirurgia.especialidade')"
          :opcoes="especialidades"
        />
        <SanteSelecao v-model="fAtendimento" :rotulo="t('cirurgia.atendimento')" :opcoes="atendimentos" />
        <div class="campo">
          <label for="pedido-reg">{{ t('cirurgia.mapa.reg') }}</label>
          <input id="pedido-reg" v-model="fReg" inputmode="numeric" />
        </div>
        <SanteSelecao v-model="fCarater" :rotulo="t('cirurgia.carater')" :opcoes="caracteres" />
        <SanteSelecao v-model="fAnestesia" :rotulo="t('cirurgia.anestesia')" :opcoes="anestesias" />
      </div>
      <div class="filtros">
        <SanteSelecao
          v-model="fCirurgiao"
          :rotulo="t('cirurgia.funcoes.cirurgiao')"
          :opcoes="comVazio(cirurgioes)"
          data-testid="pedido-cirurgiao"
        />
        <SanteSelecao
          v-model="fAnestesista"
          :rotulo="t('cirurgia.funcoes.anestesista')"
          :opcoes="comVazio(profissionais, t('cirurgia.semProfissional'))"
        />
        <SanteSelecao
          v-model="fAuxiliar"
          :rotulo="t('cirurgia.funcoes.auxiliar1')"
          :opcoes="comVazio(profissionais, t('cirurgia.semProfissional'))"
        />
      </div>
      <p v-if="sugestaoCartao" class="acoes" role="status" data-testid="pedido-cartao">
        {{
          t('cirurgia.cartaoPreferencia.doPedido', {
            sala: sugestaoCartao.cartao?.salaDescricao ?? '—',
            tempo: sugestaoCartao.mapa?.tempoMinutos ?? '—',
            posicao: sugestaoCartao.cartao?.posicaoDescricao ?? '—',
          })
        }}
        <SanteBotao
          variante="secundario"
          :rotulo="t('cirurgia.cartaoPreferencia.usarNoPedido')"
          data-testid="pedido-usar-cartao"
          @acionar="usarCartao"
        />
        <span v-if="sugestaoCartao.mapa?.sala && !salaDoCartaoPermitida" class="secundario">
          {{ t('cirurgia.cartaoPreferencia.salaNaoPermitida') }}
        </span>
      </p>
      <fieldset class="filtros">
        <legend>{{ t('cirurgia.mapa.recursos') }}</legend>
        <label v-for="r in opcoes.data.value?.recursos ?? []" :key="r.campo">
          <input v-model="fRecursos" type="checkbox" :value="r.campo" /> {{ r.rotulo }}
        </label>
      </fieldset>
      <SanteCampoTexto v-model="fObservacao" :rotulo="t('cirurgia.observacao')" :max-bytes="150" />
      <template v-if="podeExcecao">
        <label
          ><input v-model="fExcecao" type="checkbox" data-testid="pedido-excecao" />
          {{ t('cirurgia.mapa.excecaoPedido') }}</label
        >
        <SanteCampoTexto
          v-if="fExcecao"
          v-model="fMotivoExcecao"
          :rotulo="t('cirurgia.mapa.motivoExcecao')"
          :max-bytes="200"
        />
      </template>
      <div class="acoes">
        <SanteBotao
          v-if="podeAgendar"
          :rotulo="t('cirurgia.mapa.agendar')"
          :desabilitado="!pronto || !fCirurgiao || ocupado"
          data-testid="botao-agendar-cirurgia"
          @acionar="agendar"
        />
        <SanteBotao
          v-if="podeSolicitar && !solicitacao"
          variante="secundario"
          :rotulo="t('cirurgia.mapa.soSolicitar')"
          :desabilitado="!pronto || ocupado"
          data-testid="botao-solicitar-cirurgia"
          @acionar="solicitar"
        />
        <SanteBotao
          v-if="solicitacao"
          variante="texto"
          :rotulo="t('cirurgia.voltar')"
          @acionar="solicitacao = null"
        />
      </div>
      <p v-if="mensagem" role="status" data-testid="mapa-mensagem">{{ mensagem }}</p>
      <ErroCirurgia v-if="erro" :erro="erro" />
      <div v-if="sugestao" class="acoes" role="status" data-testid="sugestao-inicio">
        <SanteAlerta variante="aviso" :texto="t('cirurgia.mapa.sugestao', { hora: sugestao })" />
        <SanteBotao :rotulo="t('cirurgia.mapa.usarSugestao', { hora: sugestao })" @acionar="usarSugestao" />
      </div>
    </section>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style scoped>
.sala-do-mapa h3 {
  margin: var(--sgh-espaco-2) 0 var(--sgh-espaco-1);
  font-size: 1rem;
}
.linha-do-tempo {
  position: relative;
  height: 1.25rem;
  border: 1px solid var(--sgh-borda);
  border-radius: 4px;
  background: var(--sgh-fundo-elevado);
}
.linha-do-tempo .bloco {
  position: absolute;
  top: 0;
  bottom: 0;
  background: var(--sgh-foco);
  opacity: 0.6;
  border-radius: 3px;
}
.linha-do-tempo .faixa-aberta {
  position: absolute;
  top: 0;
  bottom: 0;
  background: var(--sgh-primaria-suave);
}
.linha-do-tempo .bloco.sobreposto {
  background: var(--sgh-alerta);
  opacity: 0.8;
}
</style>
