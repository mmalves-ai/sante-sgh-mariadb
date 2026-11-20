<script setup lang="ts">
// W0-03, mercado M2: o Time de Resposta Rápida (TRR) e a parada cardiorrespiratória da unidade. No alto, o aviso único
// dos alertas abertos (o escore no gatilho de resposta rápida, ainda sem acionamento), cada um com o botão de acionar
// (a hora do alerta vem do escore; a do acionamento, do servidor). O acionamento à mão pede o motivo. Os acionamentos
// mostram os tempos e as ações (chegada, desfecho, ficha da parada). A ficha Utstein é gravada por versão: o rascunho do
// autor e, por fim, a finalizada. Os indicadores imprimem o numerador e o denominador.
// Revisão W0-03: toda ficha abre em leitura (a finalizada e as versões anteriores, riscadas, com os campos Utstein); a
// finalizada se corrige só pelo autor, com a justificativa; o acionamento com ficha mostra "Ver a ficha" (não abre
// outra); a chegada e o desfecho se corrigem (versão nova com o motivo) ou se inativam; o acionamento e a ficha lançados
// errado se inativam com o motivo e a senha (ficam riscados e saem dos indicadores); a ficha do paciente que já saiu da
// unidade continua na lista.
import {
  type AlertaTrrAberto,
  type DadosPcr,
  DESFECHOS_PCR,
  DESFECHOS_TRR,
  type DesfechoPcr,
  type DesfechoTrr,
  type EventoTrrLido,
  type FichaPcrLida,
  type RitmoPcr,
  RITMOS_PCR,
  ROTULOS_DESFECHO_PCR,
  ROTULOS_DESFECHO_TRR,
  ROTULOS_RITMO_PCR,
} from '@sgh/contratos';
import { SanteBotao, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  acionarTrr,
  corrigirFichaPcr,
  eventoTrr,
  gravarFichaPcr,
  inativarTrr,
  lerIndicadoresTrr,
  lerTrr,
  novaVersaoPcr,
  retificarEventoTrr,
  type TelaTrr,
} from '../api-trr.js';
import DialogoCorrecao, { type DadosCorrecao } from '../componentes/DialogoCorrecao.vue';
import ErroEnfermagem from '../componentes/ErroEnfermagem.vue';
import SeletorUnidade from '../componentes/SeletorUnidade.vue';
import { usarEnfermagem } from '../usar-enfermagem.js';

const { t } = useI18n();
const uid = `trr-${useId()}`;
const { unidade, escolherUnidade, opcoesUnidade, login } = usarEnfermagem();
/** O registro é do usuário da sessão (só o autor corrige ou inativa; o servidor confere de novo). */
const ehMeu = (u: string | null | undefined) =>
  !!login.value && (u ?? '').toUpperCase() === login.value.toUpperCase();
const tela = useQuery({
  queryKey: computed(() => ['enfermagem', 'trr', unidade.value]),
  queryFn: () => lerTrr(unidade.value),
  enabled: computed(() => unidade.value !== ''),
  refetchInterval: 30_000,
});
const dados = computed<TelaTrr | null>(() => tela.data.value ?? null);
const agir = computed(() => dados.value?.gravacao.agir === true);
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const hora = (x: string | null | undefined) => (x ? x.slice(11, 16) : '—');
const quando = (x: string) => x.slice(0, 16).replace('T', ' ');

async function feito(p: Promise<{ mensagem: string }>): Promise<boolean> {
  erro.value = null;
  try {
    mensagem.value = (await p).mensagem;
    await tela.refetch();
    return true;
  } catch (x) {
    erro.value = x;
    return false;
  }
}
const acionarDoAlerta = (a: AlertaTrrAberto) =>
  feito(acionarTrr({ paciente: a.paciente, atendimento: a.atendimento, escore: a.escore }));
const chegada = (id: number) => feito(eventoTrr(id, 'chegada'));

// ── O acionamento à mão ──────────────────────────────────────────────────────────────────
const dialogoMao = ref(false);
const pacienteMao = ref<number>(0);
const motivoMao = ref('');
const erroMao = ref<unknown>(null);
const opcoesPaciente = computed(() =>
  (dados.value?.pacientes ?? []).map((p) => ({ valor: p.atendimento, rotulo: `${p.leito} · ${p.nome}` })),
);
function abrirMao(): void {
  pacienteMao.value = dados.value?.pacientes[0]?.atendimento ?? 0;
  motivoMao.value = '';
  erroMao.value = null;
  dialogoMao.value = true;
}
async function confirmarMao(): Promise<void> {
  const p = dados.value?.pacientes.find((x) => x.atendimento === pacienteMao.value);
  if (!p || motivoMao.value.trim().length < 10) return;
  erroMao.value = null;
  try {
    mensagem.value = (
      await acionarTrr({ paciente: p.paciente, atendimento: p.atendimento, motivo: motivoMao.value.trim() })
    ).mensagem;
    dialogoMao.value = false;
    await tela.refetch();
  } catch (x) {
    erroMao.value = x;
  }
}

// ── O desfecho ──────────────────────────────────────────────────────────────────────────
const dialogoDesfecho = ref(false);
const alvoDesfecho = ref<number | null>(null);
const desfecho = ref<DesfechoTrr>('permanece');
const opcoesDesfecho = DESFECHOS_TRR.map((v) => ({ valor: v, rotulo: ROTULOS_DESFECHO_TRR[v] }));
function abrirDesfecho(id: number): void {
  alvoDesfecho.value = id;
  desfecho.value = 'permanece';
  dialogoDesfecho.value = true;
}
async function confirmarDesfecho(): Promise<void> {
  if (alvoDesfecho.value === null) return;
  if (await feito(eventoTrr(alvoDesfecho.value, 'desfecho', desfecho.value))) dialogoDesfecho.value = false;
}

// ── A ficha da parada ────────────────────────────────────────────────────────────────────
const dialogoFicha = ref(false);
const alvoFicha = ref<{
  paciente: number;
  atendimento: number;
  trr: number | null;
  anterior: number | null;
} | null>(null);
const vazia = (): DadosPcr => {
  const agora = (dados.value?.agora ?? '').slice(0, 16);
  return {
    presenciada: true,
    monitorizada: false,
    ritmoInicial: 'desconhecido',
    colapsoEm: agora,
    rcpEm: agora,
    desfibrilacaoEm: null,
    adrenalinaEm: null,
    viaAereaAvancada: false,
    rceEm: null,
    fimEm: null,
    desfecho: null,
  };
};
const ficha = ref<DadosPcr>(vazia());
/** Revisão W0-03: a correção da finalizada (pede a justificativa e grava finalizada). */
const corrigindo = ref(false);
const motivoCorrecao = ref('');
const desfechoPcr = ref<DesfechoPcr | ''>('');
const erroFicha = ref<unknown>(null);
const opcoesRitmo = RITMOS_PCR.map((v) => ({ valor: v as RitmoPcr, rotulo: ROTULOS_RITMO_PCR[v] }));
const opcoesDesfechoPcr = computed(() => [
  { valor: '' as const, rotulo: t('enfermagem.trr.campos.semDesfecho') },
  ...DESFECHOS_PCR.map((v) => ({ valor: v, rotulo: ROTULOS_DESFECHO_PCR[v] })),
]);
const horasOpcionais = ['desfibrilacaoEm', 'adrenalinaEm', 'rceEm', 'fimEm'] as const;
function abrirFicha(
  base: { paciente: number; atendimento: number; trr: number | null },
  atual?: FichaPcrLida,
): void {
  alvoFicha.value = { ...base, anterior: atual?.id ?? null };
  ficha.value = atual ? { ...atual.dados } : vazia();
  desfechoPcr.value = atual?.dados.desfecho ?? '';
  corrigindo.value = atual?.situacao === 'finalizada';
  motivoCorrecao.value = '';
  erroFicha.value = null;
  dialogoFicha.value = true;
}
async function salvarFicha(finalizar: boolean): Promise<void> {
  const a = alvoFicha.value;
  if (!a) return;
  const d: DadosPcr = { ...ficha.value, desfecho: desfechoPcr.value === '' ? null : desfechoPcr.value };
  for (const k of horasOpcionais) if (!d[k]) d[k] = null;
  const causa = (d.causaProvavel ?? '').trim();
  if (causa) d.causaProvavel = causa.slice(0, 200);
  else delete d.causaProvavel;
  erroFicha.value = null;
  try {
    const r =
      a.anterior !== null && corrigindo.value
        ? await corrigirFichaPcr(a.anterior, d, motivoCorrecao.value.trim())
        : a.anterior !== null
          ? await novaVersaoPcr(a.anterior, d, finalizar)
          : await gravarFichaPcr({
              paciente: a.paciente,
              atendimento: a.atendimento,
              ...(a.trr !== null ? { trr: a.trr } : {}),
              dados: d,
              finalizar,
            });
    mensagem.value = r.mensagem;
    dialogoFicha.value = false;
    await tela.refetch();
  } catch (x) {
    erroFicha.value = x;
  }
}
const leitoDe = (f: FichaPcrLida) =>
  dados.value?.pacientes.find((p) => p.atendimento === f.atendimento)?.leito ??
  t('enfermagem.trr.foraDaUnidade', { atendimento: f.atendimento });
const fichaDe = (id: number | null) => dados.value?.fichas.find((f) => f.id === id) ?? null;
const sim = (b: boolean) => (b ? t('enfermagem.trr.sim') : t('enfermagem.trr.nao'));

// ── A ficha em leitura (a vigente e as anteriores, riscadas) ─────────────────────────────
const dialogoVer = ref(false);
const fichaVista = ref<FichaPcrLida | null>(null);
function verFicha(f: FichaPcrLida | null): void {
  if (!f) return;
  fichaVista.value = f;
  dialogoVer.value = true;
}
const camposLidos = (d: DadosPcr) => [
  { rotulo: t('enfermagem.trr.campos.presenciada'), valor: sim(d.presenciada) },
  { rotulo: t('enfermagem.trr.campos.monitorizada'), valor: sim(d.monitorizada) },
  { rotulo: t('enfermagem.trr.campos.ritmo'), valor: ROTULOS_RITMO_PCR[d.ritmoInicial] },
  { rotulo: t('enfermagem.trr.campos.colapso'), valor: quando(d.colapsoEm) },
  { rotulo: t('enfermagem.trr.campos.rcp'), valor: quando(d.rcpEm) },
  {
    rotulo: t('enfermagem.trr.campos.desfibrilacao'),
    valor: d.desfibrilacaoEm ? quando(d.desfibrilacaoEm) : '—',
  },
  { rotulo: t('enfermagem.trr.campos.adrenalina'), valor: d.adrenalinaEm ? quando(d.adrenalinaEm) : '—' },
  { rotulo: t('enfermagem.trr.campos.viaAerea'), valor: sim(d.viaAereaAvancada) },
  { rotulo: t('enfermagem.trr.campos.rce'), valor: d.rceEm ? quando(d.rceEm) : '—' },
  { rotulo: t('enfermagem.trr.campos.fim'), valor: d.fimEm ? quando(d.fimEm) : '—' },
  {
    rotulo: t('enfermagem.trr.campos.desfecho'),
    valor: d.desfecho ? ROTULOS_DESFECHO_PCR[d.desfecho] : t('enfermagem.trr.campos.semDesfecho'),
  },
  { rotulo: t('enfermagem.trr.campos.causa'), valor: d.causaProvavel || '—' },
];

// ── A inativação (acionamento, chegada/desfecho ou ficha) e a correção do evento ──────────
const dialogoInativar = ref(false);
const alvoInativar = ref<{ origem: 'trr' | 'evento' | 'pcr'; id: number } | null>(null);
function abrirInativar(origem: 'trr' | 'evento' | 'pcr', id: number): void {
  alvoInativar.value = { origem, id };
  dialogoInativar.value = true;
}
const tituloInativar = computed(() =>
  alvoInativar.value?.origem === 'trr'
    ? t('enfermagem.trr.dialogoInativarAcionamento')
    : alvoInativar.value?.origem === 'pcr'
      ? t('enfermagem.trr.dialogoInativarFicha')
      : t('enfermagem.trr.dialogoInativarEvento'),
);
const textoInativar = computed(() =>
  alvoInativar.value?.origem === 'trr'
    ? t('enfermagem.trr.textoInativarAcionamento')
    : alvoInativar.value?.origem === 'pcr'
      ? t('enfermagem.trr.textoInativarFicha')
      : t('enfermagem.trr.textoInativarEvento'),
);
async function inativar(c: DadosCorrecao): Promise<void> {
  const a = alvoInativar.value;
  if (!a) return;
  mensagem.value = (await inativarTrr(a.origem, a.id, c.motivo, c.senha)).mensagem;
  await tela.refetch();
}
const dialogoEvento = ref(false);
const alvoEvento = ref<EventoTrrLido | null>(null);
const horaEvento = ref('');
const desfechoEvento = ref<DesfechoTrr>('permanece');
function abrirCorrigirEvento(v: EventoTrrLido): void {
  alvoEvento.value = v;
  horaEvento.value = v.em.slice(0, 16);
  desfechoEvento.value = v.desfecho ?? 'permanece';
  dialogoEvento.value = true;
}
const eventoMudou = computed(() => {
  const v = alvoEvento.value;
  if (!v) return false;
  return v.tipo === 'chegada'
    ? !!horaEvento.value && horaEvento.value !== v.em.slice(0, 16)
    : desfechoEvento.value !== v.desfecho;
});
async function corrigirEvento(c: DadosCorrecao): Promise<void> {
  const v = alvoEvento.value;
  if (!v) return;
  mensagem.value = (
    await retificarEventoTrr(
      v.id,
      v.tipo === 'chegada'
        ? { em: horaEvento.value.slice(0, 16), motivo: c.motivo }
        : { desfecho: desfechoEvento.value, motivo: c.motivo },
    )
  ).mensagem;
  await tela.refetch();
}
const vigente = (eventos: readonly EventoTrrLido[], tipo: 'chegada' | 'desfecho') =>
  eventos.find((v) => v.tipo === tipo && v.vigente) ?? null;
const anteriores = (eventos: readonly EventoTrrLido[], tipo: 'chegada' | 'desfecho') =>
  eventos
    .filter((v) => v.tipo === tipo && !v.vigente)
    .map(
      (v) =>
        `${v.tipo === 'chegada' ? hora(v.em) : v.desfecho ? ROTULOS_DESFECHO_TRR[v.desfecho] : '—'} (${
          v.inativacao ? t('enfermagem.trr.inativo') : t('enfermagem.trr.corrigido')
        })`,
    )
    .join('; ');

// ── Os indicadores ──────────────────────────────────────────────────────────────────────
const hoje = new Date().toISOString().slice(0, 10);
const de = ref(`${hoje.slice(0, 8)}01`);
const ate = ref(hoje);
const indicadores = ref<Awaited<ReturnType<typeof lerIndicadoresTrr>> | null>(null);
const erroInd = ref<unknown>(null);
async function calcular(): Promise<void> {
  erroInd.value = null;
  try {
    indicadores.value = await lerIndicadoresTrr(de.value, ate.value);
  } catch (x) {
    erroInd.value = x;
  }
}
</script>

<template>
  <section class="tela-enf" :aria-labelledby="`${uid}-titulo`" data-testid="tela-trr">
    <h1 :id="`${uid}-titulo`">{{ t('enfermagem.trr.titulo') }}</h1>
    <p>{{ t('enfermagem.trr.texto') }}</p>
    <p class="discreto">{{ t('enfermagem.trr.base') }}</p>
    <div class="barra">
      <SeletorUnidade :model-value="unidade" :opcoes="opcoesUnidade" @update:model-value="escolherUnidade" />
      <SanteBotao
        variante="secundario"
        :rotulo="t('enfermagem.trr.acionarMao')"
        :desabilitado="!agir"
        data-testid="trr-acionar-mao"
        @acionar="abrirMao"
      />
    </div>
    <p v-if="mensagem" role="status" data-testid="trr-mensagem">{{ mensagem }}</p>
    <ErroEnfermagem v-if="erro" :erro="erro" />
    <ErroEnfermagem v-if="tela.isError.value" :erro="tela.error.value" />
    <p v-else-if="!dados" role="status">{{ t('enfermagem.comum.carregando') }}</p>
    <template v-else>
      <section class="cartao" :aria-labelledby="`${uid}-alertas`" data-testid="trr-alertas">
        <h2 :id="`${uid}-alertas`">{{ t('enfermagem.trr.alertas') }}</h2>
        <div v-if="dados.alertas.length" role="alert" class="alerta" data-testid="trr-alerta-aviso">
          <strong>{{ t('enfermagem.trr.alertaAviso', { n: dados.alertas.length }) }}</strong>
        </div>
        <p v-else>{{ t('enfermagem.trr.semAlertas') }}</p>
        <ul class="lista">
          <li v-for="a in dados.alertas" :key="a.escore" :data-testid="`trr-alerta-${a.escore}`">
            <span>{{
              t('enfermagem.trr.alerta', {
                leito: a.leito,
                nome: a.nome,
                escala: a.escala.toUpperCase(),
                total: a.total,
                hora: hora(a.alertaEm),
              })
            }}</span>
            <SanteBotao
              :rotulo="t('enfermagem.trr.acionarAlerta')"
              :desabilitado="!agir"
              :data-testid="`trr-acionar-${a.escore}`"
              @acionar="acionarDoAlerta(a)"
            />
          </li>
        </ul>
      </section>

      <section class="cartao" :aria-labelledby="`${uid}-acion`">
        <h2 :id="`${uid}-acion`">{{ t('enfermagem.trr.acionamentos') }}</h2>
        <p v-if="dados.acionamentos.length === 0">{{ t('enfermagem.trr.semAcionamentos') }}</p>
        <table v-else class="grade">
          <thead>
            <tr>
              <th scope="col">{{ t('enfermagem.trr.colunas.paciente') }}</th>
              <th scope="col">{{ t('enfermagem.trr.colunas.origem') }}</th>
              <th scope="col">{{ t('enfermagem.trr.colunas.alerta') }}</th>
              <th scope="col">{{ t('enfermagem.trr.colunas.acionado') }}</th>
              <th scope="col">{{ t('enfermagem.trr.colunas.chegada') }}</th>
              <th scope="col">{{ t('enfermagem.trr.colunas.desfecho') }}</th>
              <th scope="col">{{ t('enfermagem.trr.colunas.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="x in dados.acionamentos"
              :key="x.id"
              :class="{ inativo: x.inativacao }"
              :data-testid="`trr-acionamento-${x.id}`"
              :data-origem="x.origem"
              :data-inativo="x.inativacao ? 'sim' : 'nao'"
            >
              <td>
                <span :class="{ tachado: x.inativacao }">{{ x.leito }} · {{ x.nome }}</span>
                <template v-if="x.inativacao"
                  ><br /><small :data-testid="`trr-acionamento-inativado-${x.id}`">{{
                    t('enfermagem.trr.inativada', {
                      por: x.inativacao.usuario,
                      quando: quando(x.inativacao.em),
                      motivo: x.inativacao.motivo,
                    })
                  }}</small></template
                >
              </td>
              <td>
                {{ t(`enfermagem.trr.origens.${x.origem}`)
                }}<template v-if="x.motivo"
                  ><br /><small>{{ x.motivo }}</small></template
                >
              </td>
              <td>
                {{ hora(x.alertaEm) }}
                <template v-if="x.escoreEstornado"
                  ><br /><small :data-testid="`trr-escore-estornado-${x.id}`">{{
                    t('enfermagem.trr.escoreEstornado')
                  }}</small></template
                >
              </td>
              <td :data-testid="`trr-acionado-${x.id}`">
                {{ hora(x.acionadoEm) }}
                <small v-if="x.minutosAteAcionar !== null"
                  >({{ t('enfermagem.trr.minutos', { n: x.minutosAteAcionar }) }})</small
                >
              </td>
              <td :data-testid="`trr-chegada-${x.id}`">
                {{ hora(x.chegadaEm) }}
                <small v-if="x.minutosResposta !== null"
                  >({{ t('enfermagem.trr.minutos', { n: x.minutosResposta }) }})</small
                >
                <template v-for="v in [vigente(x.eventos, 'chegada')]" :key="v?.id ?? 0">
                  <span v-if="v && ehMeu(v.usuario) && !x.inativacao" class="acoes">
                    <SanteBotao
                      variante="secundario"
                      :rotulo="t('enfermagem.trr.corrigirEvento')"
                      :desabilitado="!agir"
                      :data-testid="`trr-corrigir-chegada-${x.id}`"
                      @acionar="abrirCorrigirEvento(v)"
                    />
                    <SanteBotao
                      variante="secundario"
                      :rotulo="t('enfermagem.trr.inativarEvento')"
                      :desabilitado="!agir"
                      :data-testid="`trr-inativar-chegada-${x.id}`"
                      @acionar="abrirInativar('evento', v.id)"
                    />
                  </span>
                </template>
                <small v-if="anteriores(x.eventos, 'chegada')" class="tachado"
                  ><br />{{
                    t('enfermagem.trr.historicoEventos', { lista: anteriores(x.eventos, 'chegada') })
                  }}</small
                >
              </td>
              <td :data-testid="`trr-desfecho-${x.id}`">
                {{ x.desfecho ? ROTULOS_DESFECHO_TRR[x.desfecho] : '—' }}
                <template v-for="v in [vigente(x.eventos, 'desfecho')]" :key="v?.id ?? 0">
                  <span v-if="v && ehMeu(v.usuario) && !x.inativacao" class="acoes">
                    <SanteBotao
                      variante="secundario"
                      :rotulo="t('enfermagem.trr.corrigirEvento')"
                      :desabilitado="!agir"
                      :data-testid="`trr-corrigir-desfecho-${x.id}`"
                      @acionar="abrirCorrigirEvento(v)"
                    />
                    <SanteBotao
                      variante="secundario"
                      :rotulo="t('enfermagem.trr.inativarEvento')"
                      :desabilitado="!agir"
                      :data-testid="`trr-inativar-desfecho-${x.id}`"
                      @acionar="abrirInativar('evento', v.id)"
                    />
                  </span>
                </template>
                <small v-if="anteriores(x.eventos, 'desfecho')" class="tachado"
                  ><br />{{
                    t('enfermagem.trr.historicoEventos', { lista: anteriores(x.eventos, 'desfecho') })
                  }}</small
                >
              </td>
              <td class="acoes">
                <template v-if="!x.inativacao">
                  <SanteBotao
                    v-if="!x.chegadaEm"
                    variante="secundario"
                    :rotulo="t('enfermagem.trr.chegou')"
                    :desabilitado="!agir"
                    :data-testid="`trr-chegou-${x.id}`"
                    @acionar="chegada(x.id)"
                  />
                  <SanteBotao
                    v-if="!x.desfecho"
                    variante="secundario"
                    :rotulo="t('enfermagem.trr.desfechoBotao')"
                    :desabilitado="!agir"
                    :data-testid="`trr-desfecho-botao-${x.id}`"
                    @acionar="abrirDesfecho(x.id)"
                  />
                  <SanteBotao
                    v-if="x.ficha === null"
                    variante="secundario"
                    :rotulo="t('enfermagem.trr.abrirFicha')"
                    :desabilitado="!agir"
                    :data-testid="`trr-ficha-${x.id}`"
                    @acionar="abrirFicha({ paciente: x.paciente, atendimento: x.atendimento, trr: x.id })"
                  />
                  <SanteBotao
                    v-if="ehMeu(x.usuario)"
                    variante="secundario"
                    :rotulo="t('enfermagem.trr.inativarAcionamento')"
                    :desabilitado="!agir"
                    :data-testid="`trr-inativar-${x.id}`"
                    @acionar="abrirInativar('trr', x.id)"
                  />
                </template>
                <SanteBotao
                  v-if="x.ficha !== null"
                  variante="secundario"
                  :rotulo="t('enfermagem.trr.verFicha')"
                  :data-testid="`trr-ver-ficha-acionamento-${x.id}`"
                  @acionar="verFicha(fichaDe(x.ficha))"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="cartao" :aria-labelledby="`${uid}-fichas`" data-testid="trr-fichas">
        <h2 :id="`${uid}-fichas`">{{ t('enfermagem.trr.fichas') }}</h2>
        <p class="discreto">{{ t('enfermagem.trr.soAutor') }}</p>
        <p v-if="dados.fichas.length === 0">{{ t('enfermagem.trr.semFichas') }}</p>
        <ul class="lista">
          <li
            v-for="f in dados.fichas"
            :key="f.id"
            :class="{ inativo: f.inativacao }"
            :data-testid="`trr-ficha-lida-${f.id}`"
            :data-situacao="f.situacao"
            :data-versao="f.versao"
            :data-inativo="f.inativacao ? 'sim' : 'nao'"
          >
            <span :class="{ tachado: f.inativacao }">{{
              t('enfermagem.trr.ficha', {
                leito: leitoDe(f),
                versao: f.versao,
                situacao: t(`enfermagem.trr.situacoes.${f.situacao}`),
                autor: f.autor,
                quando: quando(f.criadoEm),
              })
            }}</span>
            <small v-if="f.versoes.length">{{
              t('enfermagem.trr.versoesAnteriores', {
                lista: f.versoes.map((v) => `v${v.versao}`).join(', '),
              })
            }}</small>
            <small v-if="f.inativacao">{{
              t('enfermagem.trr.inativada', {
                por: f.inativacao.usuario,
                quando: quando(f.inativacao.em),
                motivo: f.inativacao.motivo,
              })
            }}</small>
            <SanteBotao
              variante="secundario"
              :rotulo="t('enfermagem.trr.verFicha')"
              :data-testid="`trr-ver-${f.id}`"
              @acionar="verFicha(f)"
            />
            <template v-if="!f.inativacao && ehMeu(f.autor)">
              <SanteBotao
                v-if="f.situacao === 'rascunho'"
                variante="secundario"
                :rotulo="t('enfermagem.trr.continuar')"
                :desabilitado="!agir"
                :data-testid="`trr-continuar-${f.id}`"
                @acionar="abrirFicha({ paciente: f.paciente, atendimento: f.atendimento, trr: f.trr }, f)"
              />
              <SanteBotao
                v-else
                variante="secundario"
                :rotulo="t('enfermagem.trr.corrigirFicha')"
                :desabilitado="!agir"
                :data-testid="`trr-corrigir-${f.id}`"
                @acionar="abrirFicha({ paciente: f.paciente, atendimento: f.atendimento, trr: f.trr }, f)"
              />
              <SanteBotao
                variante="secundario"
                :rotulo="t('enfermagem.trr.inativarFicha')"
                :desabilitado="!agir"
                :data-testid="`trr-inativar-ficha-${f.id}`"
                @acionar="abrirInativar('pcr', f.id)"
              />
            </template>
          </li>
        </ul>
      </section>
    </template>

    <section class="cartao" :aria-labelledby="`${uid}-ind`" data-testid="trr-indicadores">
      <h2 :id="`${uid}-ind`">{{ t('enfermagem.trr.indicadores.titulo') }}</h2>
      <form class="barra" @submit.prevent="calcular">
        <span class="campo">
          <label :for="`${uid}-de`">{{ t('enfermagem.trr.indicadores.de') }}</label>
          <input :id="`${uid}-de`" v-model="de" type="date" />
        </span>
        <span class="campo">
          <label :for="`${uid}-ate`">{{ t('enfermagem.trr.indicadores.ate') }}</label>
          <input :id="`${uid}-ate`" v-model="ate" type="date" />
        </span>
        <SanteBotao
          tipo="submit"
          :rotulo="t('enfermagem.trr.indicadores.calcular')"
          data-testid="trr-ind-calcular"
        />
      </form>
      <ErroEnfermagem v-if="erroInd" :erro="erroInd" />
      <dl v-if="indicadores" class="indicador" data-testid="trr-ind-resultado">
        <dt>{{ t('enfermagem.trr.indicadores.pcr') }}</dt>
        <dd>
          {{ indicadores.pcrForaUti.por1000 ?? t('enfermagem.trr.indicadores.semDenominador') }}
          ({{ t('enfermagem.trr.indicadores.formulaMil', indicadores.pcrForaUti) }})
        </dd>
        <dt>
          {{ t('enfermagem.trr.indicadores.resposta', { meta: indicadores.tempoResposta.metaMinutos }) }}
        </dt>
        <dd>
          {{
            indicadores.tempoResposta.noPrazo.percentual === null
              ? t('enfermagem.trr.indicadores.semDenominador')
              : `${indicadores.tempoResposta.noPrazo.percentual}%`
          }}
          ({{ t('enfermagem.trr.indicadores.formula', indicadores.tempoResposta.noPrazo) }})
        </dd>
        <dt>{{ t('enfermagem.trr.indicadores.mediana') }}</dt>
        <dd>{{ t('enfermagem.trr.minutos', { n: indicadores.tempoResposta.medianaMinutos ?? '—' }) }}</dd>
        <dt>{{ t('enfermagem.trr.indicadores.alerta') }}</dt>
        <dd data-testid="trr-ind-alerta">
          {{ t('enfermagem.trr.minutos', { n: indicadores.alertaAteAcionar.medianaMinutos ?? '—' }) }}
          ({{ t('enfermagem.trr.indicadores.alertaN', { n: indicadores.alertaAteAcionar.n }) }})
        </dd>
      </dl>
    </section>

    <SanteDialogo v-model:visivel="dialogoMao" :titulo="t('enfermagem.trr.dialogoMao')">
      <form class="form" data-testid="trr-dialogo-mao" @submit.prevent="confirmarMao">
        <SanteSelecao
          v-model="pacienteMao"
          :rotulo="t('enfermagem.trr.paciente')"
          :opcoes="opcoesPaciente"
          obrigatorio
          data-testid="trr-mao-paciente"
        />
        <span class="campo">
          <label :for="`${uid}-motivo`">{{ t('enfermagem.trr.motivo') }}</label>
          <textarea
            :id="`${uid}-motivo`"
            v-model="motivoMao"
            maxlength="300"
            rows="3"
            required
            :aria-describedby="`${uid}-motivo-ajuda`"
            data-testid="trr-mao-motivo"
          ></textarea>
          <small :id="`${uid}-motivo-ajuda`">{{ t('enfermagem.trr.motivoAjuda') }}</small>
        </span>
        <ErroEnfermagem v-if="erroMao" :erro="erroMao" />
        <div class="acoes">
          <SanteBotao
            tipo="submit"
            :rotulo="t('enfermagem.trr.confirmarAcionar')"
            :desabilitado="motivoMao.trim().length < 10 || !pacienteMao"
            data-testid="trr-mao-confirmar"
          />
          <SanteBotao
            variante="secundario"
            :rotulo="t('enfermagem.trr.cancelar')"
            @acionar="dialogoMao = false"
          />
        </div>
      </form>
    </SanteDialogo>

    <SanteDialogo v-model:visivel="dialogoDesfecho" :titulo="t('enfermagem.trr.dialogoDesfecho')">
      <form class="form" data-testid="trr-dialogo-desfecho" @submit.prevent="confirmarDesfecho">
        <SanteSelecao
          v-model="desfecho"
          :rotulo="t('enfermagem.trr.desfecho')"
          :opcoes="opcoesDesfecho"
          data-testid="trr-desfecho-escolher"
        />
        <div class="acoes">
          <SanteBotao
            tipo="submit"
            :rotulo="t('enfermagem.trr.confirmarDesfecho')"
            data-testid="trr-desfecho-confirmar"
          />
          <SanteBotao
            variante="secundario"
            :rotulo="t('enfermagem.trr.cancelar')"
            @acionar="dialogoDesfecho = false"
          />
        </div>
      </form>
    </SanteDialogo>

    <SanteDialogo
      v-model:visivel="dialogoFicha"
      :titulo="corrigindo ? t('enfermagem.trr.dialogoCorrigir') : t('enfermagem.trr.dialogoFicha')"
    >
      <form class="form" data-testid="trr-dialogo-ficha" @submit.prevent="salvarFicha(false)">
        <label
          ><input v-model="ficha.presenciada" type="checkbox" />
          {{ t('enfermagem.trr.campos.presenciada') }}</label
        >
        <label
          ><input v-model="ficha.monitorizada" type="checkbox" />
          {{ t('enfermagem.trr.campos.monitorizada') }}</label
        >
        <SanteSelecao
          v-model="ficha.ritmoInicial"
          :rotulo="t('enfermagem.trr.campos.ritmo')"
          :opcoes="opcoesRitmo"
          data-testid="trr-ficha-ritmo"
        />
        <span class="campo">
          <label :for="`${uid}-colapso`">{{ t('enfermagem.trr.campos.colapso') }}</label>
          <input
            :id="`${uid}-colapso`"
            v-model="ficha.colapsoEm"
            type="datetime-local"
            data-testid="trr-ficha-colapso"
          />
        </span>
        <span class="campo">
          <label :for="`${uid}-rcp`">{{ t('enfermagem.trr.campos.rcp') }}</label>
          <input :id="`${uid}-rcp`" v-model="ficha.rcpEm" type="datetime-local" data-testid="trr-ficha-rcp" />
        </span>
        <span class="campo">
          <label :for="`${uid}-desf`">{{ t('enfermagem.trr.campos.desfibrilacao') }}</label>
          <input
            :id="`${uid}-desf`"
            v-model="ficha.desfibrilacaoEm"
            type="datetime-local"
            data-testid="trr-ficha-desfibrilacao"
          />
        </span>
        <span class="campo">
          <label :for="`${uid}-adr`">{{ t('enfermagem.trr.campos.adrenalina') }}</label>
          <input
            :id="`${uid}-adr`"
            v-model="ficha.adrenalinaEm"
            type="datetime-local"
            data-testid="trr-ficha-adrenalina"
          />
        </span>
        <label
          ><input v-model="ficha.viaAereaAvancada" type="checkbox" />
          {{ t('enfermagem.trr.campos.viaAerea') }}</label
        >
        <span class="campo">
          <label :for="`${uid}-rce`">{{ t('enfermagem.trr.campos.rce') }}</label>
          <input :id="`${uid}-rce`" v-model="ficha.rceEm" type="datetime-local" data-testid="trr-ficha-rce" />
        </span>
        <span class="campo">
          <label :for="`${uid}-fim`">{{ t('enfermagem.trr.campos.fim') }}</label>
          <input :id="`${uid}-fim`" v-model="ficha.fimEm" type="datetime-local" data-testid="trr-ficha-fim" />
        </span>
        <SanteSelecao
          v-model="desfechoPcr"
          :rotulo="t('enfermagem.trr.campos.desfecho')"
          :opcoes="opcoesDesfechoPcr"
          data-testid="trr-ficha-desfecho"
        />
        <span class="campo">
          <label :for="`${uid}-causa`">{{ t('enfermagem.trr.campos.causa') }}</label>
          <input
            :id="`${uid}-causa`"
            v-model="ficha.causaProvavel"
            maxlength="200"
            data-testid="trr-ficha-causa"
          />
        </span>
        <span v-if="corrigindo" class="campo">
          <label :for="`${uid}-motivo-corr`">{{ t('enfermagem.trr.motivoCorrecao') }}</label>
          <textarea
            :id="`${uid}-motivo-corr`"
            v-model="motivoCorrecao"
            maxlength="300"
            rows="2"
            required
            :aria-describedby="`${uid}-motivo-corr-ajuda`"
            data-testid="trr-ficha-motivo"
          ></textarea>
          <small :id="`${uid}-motivo-corr-ajuda`">{{ t('enfermagem.trr.motivoCorrecaoAjuda') }}</small>
        </span>
        <ErroEnfermagem v-if="erroFicha" :erro="erroFicha" />
        <div class="acoes">
          <SanteBotao
            v-if="corrigindo"
            :rotulo="t('enfermagem.trr.salvarCorrecao')"
            :desabilitado="motivoCorrecao.trim().length < 10"
            data-testid="trr-ficha-corrigir"
            @acionar="salvarFicha(true)"
          />
          <template v-else>
            <SanteBotao
              tipo="submit"
              :rotulo="t('enfermagem.trr.salvarRascunho')"
              data-testid="trr-ficha-rascunho"
            />
            <SanteBotao
              :rotulo="t('enfermagem.trr.finalizar')"
              data-testid="trr-ficha-finalizar"
              @acionar="salvarFicha(true)"
            />
          </template>
          <SanteBotao
            variante="secundario"
            :rotulo="t('enfermagem.trr.cancelar')"
            @acionar="dialogoFicha = false"
          />
        </div>
      </form>
    </SanteDialogo>

    <SanteDialogo
      v-model:visivel="dialogoVer"
      :titulo="
        fichaVista
          ? t('enfermagem.trr.dialogoVer', {
              versao: fichaVista.versao,
              situacao: t(`enfermagem.trr.situacoes.${fichaVista.situacao}`),
            })
          : ''
      "
    >
      <div v-if="fichaVista" class="form" data-testid="trr-dialogo-ver">
        <p v-if="fichaVista.inativacao" role="note">
          {{
            t('enfermagem.trr.inativada', {
              por: fichaVista.inativacao.usuario,
              quando: quando(fichaVista.inativacao.em),
              motivo: fichaVista.inativacao.motivo,
            })
          }}
        </p>
        <p v-if="fichaVista.motivo">{{ t('enfermagem.trr.justificativa', { motivo: fichaVista.motivo }) }}</p>
        <dl class="indicador" :class="{ tachado: fichaVista.inativacao }" data-testid="trr-ver-vigente">
          <template v-for="c in camposLidos(fichaVista.dados)" :key="c.rotulo">
            <dt>{{ c.rotulo }}</dt>
            <dd>{{ c.valor }}</dd>
          </template>
        </dl>
        <p v-if="fichaVista.versoes.length === 0" class="discreto">
          {{ t('enfermagem.trr.semVersoesAnteriores') }}
        </p>
        <section
          v-for="v in fichaVista.versoes"
          :key="v.id"
          class="anterior"
          :data-testid="`trr-ver-anterior-${v.versao}`"
        >
          <h3>
            {{
              t('enfermagem.trr.versaoAnterior', {
                versao: v.versao,
                situacao: t(`enfermagem.trr.situacoes.${v.situacao}`),
                autor: v.autor,
                quando: quando(v.criadoEm),
              })
            }}
          </h3>
          <p v-if="v.motivo">{{ t('enfermagem.trr.justificativa', { motivo: v.motivo }) }}</p>
          <dl v-if="v.dados" class="indicador tachado">
            <template v-for="c in camposLidos(v.dados)" :key="c.rotulo">
              <dt>{{ c.rotulo }}</dt>
              <dd>{{ c.valor }}</dd>
            </template>
          </dl>
        </section>
        <div class="acoes">
          <SanteBotao
            variante="secundario"
            :rotulo="t('enfermagem.trr.fechar')"
            data-testid="trr-ver-fechar"
            @acionar="dialogoVer = false"
          />
        </div>
      </div>
    </SanteDialogo>

    <DialogoCorrecao
      v-model:visivel="dialogoInativar"
      :titulo="tituloInativar"
      :texto="textoInativar"
      :rotulo-confirmar="t('enfermagem.trr.inativarEvento')"
      com-senha
      testid="trr-dialogo-inativar"
      :executar="inativar"
    />
    <DialogoCorrecao
      v-model:visivel="dialogoEvento"
      :titulo="
        alvoEvento?.tipo === 'chegada'
          ? t('enfermagem.trr.dialogoCorrigirChegada')
          : t('enfermagem.trr.dialogoCorrigirDesfecho')
      "
      :rotulo-confirmar="t('enfermagem.trr.corrigirEvento')"
      :pode-confirmar="eventoMudou"
      testid="trr-dialogo-evento"
      :executar="corrigirEvento"
    >
      <span v-if="alvoEvento?.tipo === 'chegada'" class="campo">
        <label :for="`${uid}-hora-ev`">{{ t('enfermagem.trr.horaChegada') }}</label>
        <input
          :id="`${uid}-hora-ev`"
          v-model="horaEvento"
          type="datetime-local"
          data-testid="trr-evento-hora"
        />
      </span>
      <SanteSelecao
        v-else
        v-model="desfechoEvento"
        :rotulo="t('enfermagem.trr.desfecho')"
        :opcoes="opcoesDesfecho"
        data-testid="trr-evento-desfecho"
      />
    </DialogoCorrecao>
  </section>
</template>

<style src="./estilo-enfermagem.css"></style>
<style scoped>
.discreto {
  color: var(--sgh-texto-secundario);
}
.lista {
  list-style: none;
  padding: 0;
  display: grid;
  gap: var(--sgh-espaco-1);
}
.lista li {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: center;
}
.acoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-1);
}
.form {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
}
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
}
.tachado {
  text-decoration: line-through;
}
.anterior {
  border-top: 1px solid var(--sgh-borda-forte);
  padding-top: var(--sgh-espaco-1);
}
.anterior h3 {
  font-size: 1rem;
  margin: 0;
}
.indicador {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--sgh-espaco-1) var(--sgh-espaco-2);
}
textarea,
input:not([type='checkbox']) {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
</style>
