<script setup lang="ts">
// Ato transfusional à beira do leito (M47, etapa 1; ficha, seção 7 e regras 2 a 5): a requisição com o paciente, a
// amostra e o horário da prescrição a checar; o início com a pulseira lida, a bolsa conferida (número, hemocomponente,
// tipagem e validade da etiqueta, a etiqueta do receptor e a inspeção visual), o segundo profissional com o próprio
// login e senha e os sinais de antes (sem a dupla checagem a transfusão não começa; os bloqueios aparecem com o motivo);
// em curso, as tarefas dos sinais aos 10 a 15 minutos e ao término com a situação, a conclusão ou a interrupção com o
// volume e a reação transfusional (com a transfusão em curso, a reação a interrompe). O início precisa do servidor
// (a senha do segundo profissional é conferida na hora e nunca guardada).
// W0-03: os sinais registrados de cada momento com os adendos ao lado; o adendo (sinais digitados errado) pelo diálogo
// único com o motivo; o registro original nunca muda.
import {
  CODIGOS_CONDUTA_REACAO,
  CONDUTAS_REACAO,
  CORRELACOES_REACAO,
  FATORES_RH,
  GRAVIDADES_REACAO,
  GRUPOS_ABO,
  HEMOCOMPONENTES_VISTOS,
  rotuloTipagem,
  rotuloUrgencia,
  TIPOS_REACAO_TRANSFUSIONAL,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { usarContextoClinico } from '../../../casca/notificar/contexto-clinico.js';
import {
  adendoAto,
  concluirTransfusao,
  iniciarTransfusao,
  lerHistorico,
  lerRequisicao,
  registrarReacao,
  registrarSinais,
} from '../../sadt/api-transfusao.js';
import ErroTransfusao from '../../sadt/componentes/ErroTransfusao.vue';
import { novaChave } from '../api-enfermagem.js';
import DialogoCorrecao, { type DadosCorrecao } from '../componentes/DialogoCorrecao.vue';

const props = defineProps<{ req: string }>();
const { t } = useI18n();
const T = (k: string, p?: Record<string, unknown>) => t(`sadt.transfusao.${k}`, p ?? {});
const hora = (x: string | null) => (x ? x.slice(0, 16).replace('T', ' ') : '—');
const id = computed(() => Number(props.req) || 0);

const dados = useQuery({
  queryKey: computed(() => ['transfusao', 'requisicao', id.value]),
  queryFn: () => lerRequisicao(id.value),
  enabled: computed(() => id.value > 0),
});
const d = computed(() => dados.data.value);
// M48 (etapa 2): o atendimento da requisição é o contexto do "Notificar incidente" (o rótulo é o que a tela mostra).
usarContextoClinico(() => {
  const r = d.value?.requisicao;
  return r ? { atendimento: r.atendimento, rotulo: r.paciente.nome } : null;
});
// A tipagem e o histórico transfusional do paciente (as transfusões anteriores, com a reação).
const historico = useQuery({
  queryKey: computed(() => ['transfusao', 'historico', d.value?.requisicao.paciente.id ?? 0]),
  queryFn: () => lerHistorico(d.value!.requisicao.paciente.id),
  enabled: computed(() => !!d.value),
});
const anteriores = computed(() =>
  (historico.data.value?.atos ?? []).filter((x) => x.requisicao !== d.value?.requisicao.id),
);
const emCurso = computed(() => d.value?.atos.find((a) => a.estado === 'emCurso') ?? null);
const ultimo = computed(() => d.value?.atos[0] ?? null);
const aberta = computed(() =>
  ['requisitada', 'amostraColetada', 'emAtendimento'].includes(d.value?.requisicao.estado ?? ''),
);
const podeAdministrar = computed(() => d.value?.gravacao.acoes.administrar === true);
const mensagem = ref<string | null>(null);
const alertas = ref<string[]>([]);
const erro = ref<unknown>(null);
const ocupado = ref(false);

// A chave de cada ação fica a mesma até gravar: o reenvio (a rede caiu no meio) não grava duas vezes.
const chaves: Record<string, string> = {};
const chaveDe = (acao: string) => (chaves[acao] ??= novaChave(`transfusao-${acao}`));
async function executar(acao: string, fn: (chave: string) => Promise<{ mensagem: string }>): Promise<void> {
  ocupado.value = true;
  erro.value = null;
  mensagem.value = null;
  try {
    mensagem.value = (await fn(chaveDe(acao))).mensagem;
    delete chaves[acao];
    await dados.refetch();
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}

// ── O início com a dupla checagem ───────────────────────────────────────────────────────────────
const opcoesHemo = Object.entries(HEMOCOMPONENTES_VISTOS).map(([codigo, h]) => ({
  valor: codigo,
  rotulo: h.rotulo,
}));
const opcoesAbo = GRUPOS_ABO.map((g) => ({ valor: g, rotulo: g }));
const opcoesRh = computed(() =>
  FATORES_RH.map((f) => ({ valor: f, rotulo: f === 'positivo' ? 'Rh positivo' : 'Rh negativo' })),
);
const sinaisVazios = () => ({ pas: '', pad: '', fc: '', temperatura: '', fr: '', spo2: '' });
const inicio = reactive({
  pulseira: '',
  numero: '',
  hemocomponente: '',
  abo: 'O',
  rh: 'positivo',
  validade: '',
  volumeMl: '',
  etiqueta: false,
  inspecao: false,
  login: '',
  senha: '',
  justificativaRh: '',
  sinais: sinaisVazios(),
});
/** Etapa 2: a bolsa reservada pela agência preenche a etiqueta (a enfermagem confere com a bolsa na mão). */
function usarReservada(b: {
  numero: string;
  hemocomponente: string;
  tipagem: { abo: string | null; rh: string | null };
  validade: string;
  volumeMl: number;
}): void {
  Object.assign(inicio, {
    numero: b.numero,
    hemocomponente: b.hemocomponente,
    abo: b.tipagem.abo ?? 'O',
    rh: b.tipagem.rh ?? 'positivo',
    validade: b.validade.slice(0, 16),
    volumeMl: String(b.volumeMl),
  });
}
const numero = (x: string) => (x.trim() === '' ? undefined : Number(x.replace(',', '.')));
function sinaisDe(s: ReturnType<typeof sinaisVazios>) {
  const r: Record<string, number> = {
    pas: Number(s.pas),
    pad: Number(s.pad),
    fc: Number(s.fc),
    temperatura: Number(s.temperatura.replace(',', '.')),
  };
  const fr = numero(s.fr);
  const spo2 = numero(s.spo2);
  if (fr !== undefined) r['fr'] = fr;
  if (spo2 !== undefined) r['spo2'] = spo2;
  return r;
}
const sinaisProntos = (s: ReturnType<typeof sinaisVazios>) =>
  [s.pas, s.pad, s.fc, s.temperatura].every(
    (x) => x.trim() !== '' && !Number.isNaN(Number(x.replace(',', '.'))),
  );
const prontoInicio = computed(
  () =>
    !!inicio.numero.trim() &&
    !!inicio.hemocomponente &&
    !!inicio.validade &&
    Number(inicio.volumeMl) > 0 &&
    inicio.etiqueta &&
    inicio.inspecao &&
    !!inicio.login.trim() &&
    !!inicio.senha &&
    sinaisProntos(inicio.sinais),
);
function iniciar(): Promise<void> {
  alertas.value = [];
  return executar('inicio', async (chave) => {
    const r = await iniciarTransfusao(
      id.value,
      {
        horario: d.value?.horarioPendente?.id ?? null,
        pulseira: inicio.pulseira.trim()
          ? { lida: true, codigo: inicio.pulseira.trim() }
          : { lida: false, motivo: 'urgencia' },
        bolsa: {
          numero: inicio.numero.trim().toUpperCase(),
          hemocomponente: inicio.hemocomponente,
          tipagem: { abo: inicio.abo, rh: inicio.rh },
          validade: inicio.validade,
          volumeMl: Number(inicio.volumeMl),
          etiquetaDoReceptorConfere: inicio.etiqueta,
          inspecaoVisualOk: inicio.inspecao,
        },
        segundoProfissional: { login: inicio.login.trim(), senha: inicio.senha },
        sinaisAntes: sinaisDe(inicio.sinais),
        justificativaRh: inicio.justificativaRh.trim() || null,
      },
      chave,
    );
    alertas.value = r.alertas;
    inicio.senha = '';
    return r;
  });
}

// ── Sinais, conclusão e reação ──────────────────────────────────────────────────────────────────
const sinais = reactive({
  momento: 'durante' as 'durante' | 'depois',
  medidoEm: '',
  valores: sinaisVazios(),
});
function gravarSinais(ato: number, estado: string): Promise<void> {
  sinais.momento = estado === 'emCurso' ? 'durante' : 'depois';
  return executar(`sinais-${ato}`, async (chave) => {
    const r = await registrarSinais(
      ato,
      {
        momento: sinais.momento,
        sinais: sinaisDe(sinais.valores),
        medidoEm: sinais.medidoEm || (d.value?.agora ?? '').slice(0, 16),
      },
      chave,
    );
    sinais.valores = sinaisVazios();
    return r;
  });
}
const conclusao = reactive({ terminoEm: '', volume: '', interrompida: false, motivo: '' });
function concluir(ato: number): Promise<void> {
  return executar(`concluir-${ato}`, async () => {
    const r = await concluirTransfusao(ato, {
      terminoEm: conclusao.terminoEm || (d.value?.agora ?? '').slice(0, 16),
      volumeTransfundidoMl: Number(conclusao.volume),
      interrompida: conclusao.interrompida,
      motivoInterrupcao: conclusao.interrompida ? conclusao.motivo.trim() : null,
    });
    sinais.momento = 'depois';
    return r;
  });
}
const reacaoAberta = ref(false);
const reacao = reactive({
  tipo: 'febrilNaoHemolitica',
  descricaoOutra: '',
  grau: '1',
  correlacao: 'possivel',
  inicioEm: '',
  sinaisESintomas: '',
  condutas: ['interromperTransfusao'] as string[],
  condutaOutra: '',
  destinoBolsa: 'devolvida',
  volume: '',
  sinais: sinaisVazios(),
});
const opcoesTipo = TIPOS_REACAO_TRANSFUSIONAL.map((x) => ({ valor: x.codigo, rotulo: x.rotulo }));
const opcoesGrau = GRAVIDADES_REACAO.map((x) => ({ valor: String(x.grau), rotulo: x.rotulo }));
const opcoesCorrelacao = CORRELACOES_REACAO.map((x) => ({ valor: x.codigo, rotulo: x.rotulo }));
const opcoesDestino = computed(() => [
  { valor: 'devolvida', rotulo: T('reacao.devolvida') },
  { valor: 'descartada', rotulo: T('reacao.descartada') },
  { valor: 'naoSeAplica', rotulo: T('reacao.naoSeAplicaBolsa') },
]);
function gravarReacao(ato: number, emCursoAgora: boolean): Promise<void> {
  return executar(`reacao-${ato}`, async (chave) => {
    const r = await registrarReacao(
      ato,
      {
        tipo: reacao.tipo,
        descricaoOutra: reacao.tipo === 'outra' ? reacao.descricaoOutra.trim() : null,
        grau: Number(reacao.grau),
        correlacao: reacao.correlacao,
        inicioEm: reacao.inicioEm || (d.value?.agora ?? '').slice(0, 16),
        sinaisESintomas: reacao.sinaisESintomas.trim(),
        condutas: CODIGOS_CONDUTA_REACAO.filter((c) => reacao.condutas.includes(c)),
        condutaOutra: reacao.condutas.includes('outra') ? reacao.condutaOutra.trim() : null,
        destinoBolsa: reacao.destinoBolsa,
        sinaisNaReacao: sinaisProntos(reacao.sinais) ? sinaisDe(reacao.sinais) : null,
        volumeTransfundidoMl: emCursoAgora ? Number(reacao.volume || 0) : null,
      },
      chave,
    );
    reacaoAberta.value = false;
    return r;
  });
}
const rotuloTarefa = (s: string) =>
  ({
    feita: T('ato.tarefaFeita'),
    devida: T('ato.tarefaDevida'),
    atrasada: T('ato.tarefaAtrasada'),
    aguardando: T('ato.tarefaAguardando'),
  })[s] ?? s;
const rotuloMomento = (m: string) =>
  ({ antes: T('ato.sinaisAntes'), durante: T('ato.sinaisDurante'), depois: T('ato.sinaisDepois') })[m] ?? m;
const CAMPOS_SINAIS = ['pas', 'pad', 'fc', 'temperatura', 'fr', 'spo2'] as const;

// ── W0-03: o adendo do ato ──────────────────────────────────────────────────────────────────────
const C = (k: string, p?: Record<string, unknown>) => t(`enfermagem.correcao.hemo.${k}`, p ?? {});
const adendoDe = ref<number | null>(null);
const dialogoAdendo = ref(false);
const adendo = reactive({ momento: 'antes' as 'antes' | 'durante' | 'depois', valores: sinaisVazios() });
const momentosMedidos = computed(() => {
  const a = d.value?.atos.find((x) => x.id === adendoDe.value);
  return (a?.sinais ?? []).map((x) => ({ valor: x.momento, rotulo: rotuloMomento(x.momento) }));
});
function abrirAdendo(ato: number): void {
  const a = d.value?.atos.find((x) => x.id === ato);
  const primeiro = a?.sinais[0];
  adendoDe.value = ato;
  adendo.momento = primeiro?.momento ?? 'antes';
  adendo.valores = primeiro
    ? {
        pas: String(primeiro.pas),
        pad: String(primeiro.pad),
        fc: String(primeiro.fc),
        temperatura: String(primeiro.temperatura),
        fr: primeiro.fr === undefined ? '' : String(primeiro.fr),
        spo2: primeiro.spo2 === undefined ? '' : String(primeiro.spo2),
      }
    : sinaisVazios();
  dialogoAdendo.value = true;
}
async function confirmarAdendo(x: DadosCorrecao): Promise<void> {
  if (adendoDe.value === null) return;
  const r = await adendoAto(adendoDe.value, {
    momento: adendo.momento,
    sinais: sinaisDe(adendo.valores),
    motivo: x.motivo,
  });
  mensagem.value = r.mensagem;
  await dados.refetch();
}
const valorSinais = (s: {
  pas: number;
  pad: number;
  fc: number;
  temperatura: number;
  fr?: number | undefined;
  spo2?: number | undefined;
}) =>
  `PA ${s.pas}/${s.pad} · FC ${s.fc} · T ${s.temperatura}` +
  (s.fr !== undefined ? ` · FR ${s.fr}` : '') +
  (s.spo2 !== undefined ? ` · SpO2 ${s.spo2}%` : '');
</script>

<template>
  <section class="tela-transfusao" aria-labelledby="at-titulo" data-testid="tela-transfusao-leito">
    <h1 id="at-titulo">{{ T('ato.titulo') }}</h1>
    <ErroTransfusao v-if="dados.isError.value" :erro="dados.error.value" />
    <p v-else-if="!d" role="status">{{ T('carregando') }}</p>
    <template v-else>
      <p class="cabecalho" data-testid="at-cabecalho">
        <strong>{{ d.requisicao.paciente.nome }}</strong>
        · {{ T('prontuario', { n: d.requisicao.paciente.prontuario ?? '—' }) }}
        <span v-if="d.leito">
          · {{ T('ato.leito', { leito: d.leito.leito, unidade: d.leito.unidade }) }}</span
        >
      </p>
      <p data-testid="at-requisicao" :data-estado="d.requisicao.estado">
        {{ T('ato.requisicao') }} {{ d.requisicao.id }} · {{ d.requisicao.hemocomponente.rotulo }} ·
        {{
          T('bolsas', { feitas: d.requisicao.bolsasTransfundidas, pedidas: d.requisicao.quantidadeBolsas })
        }}
        · {{ rotuloUrgencia(d.requisicao.urgencia) }} · {{ T('tipagem') }}:
        {{ rotuloTipagem(d.requisicao.tipagem) }}
      </p>
      <p>
        {{
          d.requisicao.amostra
            ? T('requisicoes.amostraCodigo', {
                codigo: d.requisicao.amostra.codigo,
                coletada: hora(d.requisicao.amostra.coletadaEm),
                valida: hora(d.requisicao.amostra.validaAte),
              })
            : T('requisicoes.semAmostra')
        }}
      </p>
      <SanteAlerta v-if="!d.gravacao.ligada" variante="aviso" :texto="d.gravacao.motivo ?? T('desligado')" />
      <SanteAlerta
        v-if="d.horarioPendente"
        variante="info"
        :texto="T('ato.horarioPendente', { hora: hora(d.horarioPendente.previsto) })"
        data-testid="at-horario"
      />
      <p v-else class="secundario" data-testid="at-sem-horario">{{ T('ato.semHorarioPendente') }}</p>
      <p v-if="mensagem" role="status" data-testid="at-mensagem">{{ mensagem }}</p>
      <ul v-if="alertas.length" class="secundario" data-testid="at-alertas">
        <li v-for="a in alertas" :key="a">{{ a }}</li>
      </ul>
      <ErroTransfusao v-if="erro" :erro="erro" />

      <form
        v-if="aberta && !emCurso && podeAdministrar"
        class="cartao"
        aria-labelledby="at-iniciar"
        data-testid="at-form-inicio"
        @submit.prevent="iniciar"
      >
        <h2 id="at-iniciar">{{ T('ato.iniciar') }}</h2>
        <SanteCampoTexto
          id="at-pulseira"
          v-model="inicio.pulseira"
          :rotulo="T('requisicoes.lerPulseira')"
          :max-bytes="64"
        />
        <fieldset class="cartao">
          <legend>{{ T('ato.bolsa') }}</legend>
          <!-- Etapa 2 (agência própria): a tipagem da agência e as bolsas reservadas para esta requisição. -->
          <div v-if="d.agencia" data-testid="at-agencia">
            <p class="secundario" data-testid="at-tipagem-agencia">
              {{ T('ato.tipagemAgencia', { t: rotuloTipagem(d.agencia.receptor.tipagem) }) }}
            </p>
            <ul class="tarefas">
              <li v-for="b in d.agencia.reservadas" :key="b.numero">
                {{ b.numero }} · {{ b.hemocomponente }} · {{ rotuloTipagem(b.tipagem) }}
                <SanteBotao
                  variante="texto"
                  :rotulo="T('ato.usarReservada')"
                  :data-testid="`at-usar-${b.numero}`"
                  @acionar="usarReservada(b)"
                />
              </li>
            </ul>
          </div>
          <div class="barra">
            <SanteCampoTexto
              id="at-bolsa"
              v-model="inicio.numero"
              :rotulo="T('ato.numeroBolsa')"
              :max-bytes="24"
            />
            <SanteSelecao
              v-model="inicio.hemocomponente"
              :rotulo="T('hemocomponente')"
              :opcoes="[{ valor: '', rotulo: '—' }, ...opcoesHemo]"
              data-testid="at-hemo"
            />
            <SanteSelecao
              v-model="inicio.abo"
              :rotulo="T('ato.tipagemBolsa')"
              :opcoes="opcoesAbo"
              data-testid="at-abo"
            />
            <SanteSelecao
              v-model="inicio.rh"
              :rotulo="T('ato.fatorRh')"
              :opcoes="opcoesRh"
              data-testid="at-rh"
            />
            <span class="campo">
              <label for="at-validade">{{ T('ato.validade') }}</label>
              <input
                id="at-validade"
                v-model="inicio.validade"
                type="datetime-local"
                data-testid="at-validade"
              />
            </span>
            <span class="campo">
              <label for="at-volume">{{ T('ato.volumeBolsa') }}</label>
              <input
                id="at-volume"
                v-model="inicio.volumeMl"
                type="number"
                min="1"
                max="1000"
                data-testid="at-volume"
              />
            </span>
          </div>
          <label class="marca">
            <input v-model="inicio.etiqueta" type="checkbox" data-testid="at-etiqueta" />
            {{ T('ato.etiquetaReceptor') }}
          </label>
          <label class="marca">
            <input v-model="inicio.inspecao" type="checkbox" data-testid="at-inspecao" />
            {{ T('ato.inspecaoVisual') }}
          </label>
          <SanteCampoTexto
            id="at-justif-rh"
            v-model="inicio.justificativaRh"
            :rotulo="T('ato.justificativaRh')"
            :max-bytes="300"
          />
        </fieldset>
        <fieldset class="cartao">
          <legend>{{ T('ato.sinaisAntes') }}</legend>
          <div class="barra">
            <span v-for="c in CAMPOS_SINAIS" :key="c" class="campo">
              <label :for="`at-antes-${c}`">{{ T(`ato.${c}`) }}</label>
              <input
                :id="`at-antes-${c}`"
                v-model="inicio.sinais[c]"
                inputmode="decimal"
                :data-testid="`at-antes-${c}`"
              />
            </span>
          </div>
        </fieldset>
        <fieldset class="cartao">
          <legend>{{ T('ato.segundoProfissional') }}</legend>
          <div class="barra">
            <span class="campo">
              <label for="at-login">{{ T('ato.segundoLogin') }}</label>
              <input id="at-login" v-model="inicio.login" autocomplete="off" data-testid="at-login" />
            </span>
            <span class="campo">
              <label for="at-senha">{{ T('ato.segundoSenha') }}</label>
              <input
                id="at-senha"
                v-model="inicio.senha"
                type="password"
                autocomplete="off"
                data-testid="at-senha"
              />
            </span>
          </div>
        </fieldset>
        <SanteBotao
          tipo="submit"
          :rotulo="T('ato.iniciar')"
          :desabilitado="!prontoInicio || ocupado"
          data-testid="at-iniciar"
        />
      </form>
      <p v-else-if="!aberta && !emCurso" class="secundario">{{ T('ato.requisicaoFechada') }}</p>

      <section
        v-for="a in d.atos"
        :key="a.id"
        class="cartao"
        :data-testid="`at-ato-${a.id}`"
        :data-estado="a.estado"
      >
        <h2>
          {{ T('ato.bolsa') }} {{ a.bolsa.numero }} · {{ a.bolsa.hemocomponente }} ·
          {{ rotuloTipagem(a.bolsa.tipagem) }} ·
          {{ T(`ato.${a.estado}`) }}
        </h2>
        <p class="secundario">
          {{ T('intervalo', { de: hora(a.inicioEm), ate: hora(a.terminoEm) }) }} ·
          {{ T('ato.profissionais', { p: a.profissional, c: a.segundoProfissional }) }}
          <span v-if="a.volumeTransfundidoMl !== null">
            · {{ T('volumeMl', { n: a.volumeTransfundidoMl }) }}</span
          >
          <span v-if="a.ganhoLancado"> · {{ T('ato.ganhoNoBalanco') }}</span>
        </p>
        <h3>{{ C('sinaisRegistrados') }}</h3>
        <ul class="tarefas" :data-testid="`at-sinais-${a.id}`">
          <li v-for="x in a.sinais" :key="x.momento" :data-momento="x.momento">
            <span :class="{ inativa: (a.adendos ?? []).some((y) => y.momento === x.momento) }">
              {{ rotuloMomento(x.momento) }} ({{ hora(x.medidoEm) }}): {{ valorSinais(x) }}
              <small v-if="(a.adendos ?? []).some((y) => y.momento === x.momento)">{{ C('original') }}</small>
            </span>
            <ul>
              <li
                v-for="y in (a.adendos ?? []).filter((z) => z.momento === x.momento)"
                :key="y.id"
                :data-testid="`at-adendo-${y.id}`"
              >
                <strong>{{ valorSinais(y.sinais) }}</strong>
                <small class="secundario">
                  {{ C('adendoDe', { por: y.usuario, quando: hora(y.em), motivo: y.motivo }) }}
                </small>
              </li>
            </ul>
          </li>
        </ul>
        <SanteBotao
          v-if="d.gravacao.acoes.adendo && a.sinais.length > 0"
          variante="secundario"
          :rotulo="C('adendo')"
          :data-testid="`at-adendo-abrir-${a.id}`"
          @acionar="abrirAdendo(a.id)"
        />
        <h3>{{ T('ato.tarefas') }}</h3>
        <ul class="tarefas" :data-testid="`at-tarefas-${a.id}`">
          <li v-for="x in a.tarefas" :key="x.momento" :data-situacao="x.situacao" :data-momento="x.momento">
            {{ rotuloMomento(x.momento) }}: {{ rotuloTarefa(x.situacao) }}
            <span v-if="x.atrasaEm && x.situacao !== 'feita'" class="secundario">
              ({{ hora(x.atrasaEm) }})</span
            >
          </li>
        </ul>

        <template v-if="podeAdministrar">
          <form
            v-if="
              a.tarefas.some(
                (x) =>
                  x.momento !== 'antes' &&
                  x.situacao !== 'feita' &&
                  (x.momento === 'durante' ? a.estado === 'emCurso' : a.estado !== 'emCurso'),
              )
            "
            class="cartao"
            :data-testid="`at-form-sinais-${a.id}`"
            @submit.prevent="gravarSinais(a.id, a.estado)"
          >
            <h3>{{ T('ato.registrarSinais') }}</h3>
            <div class="barra">
              <SanteSelecao
                v-model="sinais.momento"
                :rotulo="T('ato.sinais')"
                :opcoes="
                  a.estado === 'emCurso'
                    ? [{ valor: 'durante', rotulo: T('ato.sinaisDurante') }]
                    : [{ valor: 'depois', rotulo: T('ato.sinaisDepois') }]
                "
                :data-testid="`at-momento-${a.id}`"
              />
              <span v-for="c in CAMPOS_SINAIS" :key="c" class="campo">
                <label :for="`at-s-${a.id}-${c}`">{{ T(`ato.${c}`) }}</label>
                <input
                  :id="`at-s-${a.id}-${c}`"
                  v-model="sinais.valores[c]"
                  inputmode="decimal"
                  :data-testid="`at-s-${c}`"
                />
              </span>
            </div>
            <SanteBotao
              tipo="submit"
              :rotulo="T('ato.registrarSinais')"
              :desabilitado="!sinaisProntos(sinais.valores) || ocupado"
              :data-testid="`at-gravar-sinais-${a.id}`"
            />
          </form>

          <form
            v-if="a.estado === 'emCurso'"
            class="cartao"
            :data-testid="`at-form-concluir-${a.id}`"
            @submit.prevent="concluir(a.id)"
          >
            <h3>{{ T('ato.concluir') }}</h3>
            <div class="barra">
              <span class="campo">
                <label :for="`at-vol-${a.id}`">{{ T('ato.volumeTransfundido') }}</label>
                <input
                  :id="`at-vol-${a.id}`"
                  v-model="conclusao.volume"
                  type="number"
                  min="0"
                  max="1000"
                  data-testid="at-vol"
                />
              </span>
              <label class="marca">
                <input v-model="conclusao.interrompida" type="checkbox" data-testid="at-interrompida" />
                {{ T('ato.interrompida') }}
              </label>
            </div>
            <SanteCampoTexto
              v-if="conclusao.interrompida"
              :id="`at-motivo-${a.id}`"
              v-model="conclusao.motivo"
              :rotulo="T('ato.motivoInterrupcao')"
              :max-bytes="300"
            />
            <SanteBotao
              tipo="submit"
              :rotulo="conclusao.interrompida ? T('ato.interromper') : T('ato.concluir')"
              :desabilitado="
                conclusao.volume === '' ||
                (conclusao.interrompida && conclusao.motivo.trim().length < 5) ||
                ocupado
              "
              data-testid="at-concluir"
            />
          </form>
        </template>

        <SanteBotao
          v-if="d.gravacao.acoes.reacao && a.reacao === null && !reacaoAberta"
          variante="texto"
          :rotulo="T('ato.registrarReacao')"
          :data-testid="`at-reacao-${a.id}`"
          @acionar="reacaoAberta = true"
        />
        <form
          v-if="reacaoAberta && a.reacao === null && a.id === (emCurso?.id ?? ultimo?.id)"
          class="cartao"
          :data-testid="`at-form-reacao-${a.id}`"
          @submit.prevent="gravarReacao(a.id, a.estado === 'emCurso')"
        >
          <h3>{{ T('ato.registrarReacao') }}</h3>
          <div class="barra">
            <SanteSelecao
              v-model="reacao.tipo"
              :rotulo="T('reacao.tipo')"
              :opcoes="opcoesTipo"
              :busca="true"
              data-testid="rc-tipo"
            />
            <SanteSelecao
              v-model="reacao.grau"
              :rotulo="T('reacao.gravidade')"
              :opcoes="opcoesGrau"
              data-testid="rc-grau"
            />
            <SanteSelecao
              v-model="reacao.correlacao"
              :rotulo="T('reacao.correlacao')"
              :opcoes="opcoesCorrelacao"
              data-testid="rc-correlacao"
            />
            <SanteSelecao
              v-model="reacao.destinoBolsa"
              :rotulo="T('reacao.destinoBolsa')"
              :opcoes="opcoesDestino"
              data-testid="rc-destino"
            />
          </div>
          <SanteCampoTexto
            v-if="reacao.tipo === 'outra'"
            id="rc-outra"
            v-model="reacao.descricaoOutra"
            :rotulo="T('reacao.descricaoOutra')"
            :max-bytes="200"
          />
          <SanteCampoTexto
            id="rc-sinais-sintomas"
            v-model="reacao.sinaisESintomas"
            :rotulo="T('reacao.sinaisESintomas')"
            :max-bytes="1000"
            :multilinha="true"
          />
          <fieldset class="cartao">
            <legend>{{ T('reacao.condutas') }}</legend>
            <label v-for="c in CONDUTAS_REACAO" :key="c.codigo" class="marca">
              <input
                v-model="reacao.condutas"
                type="checkbox"
                :value="c.codigo"
                :data-testid="`rc-conduta-${c.codigo}`"
              />
              {{ c.rotulo }}
            </label>
          </fieldset>
          <SanteCampoTexto
            v-if="reacao.condutas.includes('outra')"
            id="rc-conduta-outra"
            v-model="reacao.condutaOutra"
            :rotulo="T('reacao.condutaOutra')"
            :max-bytes="300"
          />
          <span v-if="a.estado === 'emCurso'" class="campo">
            <label for="rc-volume">{{ T('reacao.volumeAteInterromper') }}</label>
            <input
              id="rc-volume"
              v-model="reacao.volume"
              type="number"
              min="0"
              max="1000"
              data-testid="rc-volume"
            />
          </span>
          <fieldset class="cartao">
            <legend>{{ T('reacao.sinaisNaReacao') }}</legend>
            <div class="barra">
              <span v-for="c in CAMPOS_SINAIS" :key="c" class="campo">
                <label :for="`rc-${c}`">{{ T(`ato.${c}`) }}</label>
                <input
                  :id="`rc-${c}`"
                  v-model="reacao.sinais[c]"
                  inputmode="decimal"
                  :data-testid="`rc-s-${c}`"
                />
              </span>
            </div>
          </fieldset>
          <div class="barra">
            <SanteBotao
              tipo="submit"
              :rotulo="T('gravar')"
              :desabilitado="
                reacao.sinaisESintomas.trim().length < 5 || reacao.condutas.length === 0 || ocupado
              "
              data-testid="rc-gravar"
            />
            <SanteBotao variante="texto" :rotulo="T('cancelar')" @acionar="reacaoAberta = false" />
          </div>
        </form>
        <p v-if="a.reacao !== null" class="alerta" :data-testid="`at-com-reacao-${a.id}`">
          {{ T('reacao.registrada') }}
        </p>
      </section>
      <section aria-labelledby="at-historico" data-testid="at-historico">
        <h2 id="at-historico">{{ T('ato.historico') }}</h2>
        <p v-if="anteriores.length === 0" class="secundario">{{ T('ato.semHistorico') }}</p>
        <ul v-else>
          <li v-for="x in anteriores" :key="x.id">
            {{ hora(x.inicioEm) }} · {{ x.bolsa.hemocomponente }} {{ x.bolsa.numero }} ·
            {{ rotuloTipagem(x.bolsa.tipagem) }} · {{ T(`ato.${x.estado}`) }}
            <strong v-if="x.reacao !== null" class="alerta"> · {{ T('ato.comReacao') }}</strong>
          </li>
        </ul>
      </section>
      <RouterLink :to="{ name: 'sadt.agencia.requisicoes' }">{{ T('ato.abrirRequisicoes') }}</RouterLink>
    </template>
    <DialogoCorrecao
      v-model:visivel="dialogoAdendo"
      :titulo="C('tituloAdendo')"
      :texto="C('textoAdendo')"
      testid="at-dialogo-adendo"
      :pode-confirmar="sinaisProntos(adendo.valores)"
      :executar="confirmarAdendo"
    >
      <div class="barra">
        <SanteSelecao
          v-model="adendo.momento"
          :rotulo="C('momento')"
          :opcoes="momentosMedidos"
          data-testid="at-adendo-momento"
        />
        <span v-for="c in CAMPOS_SINAIS" :key="c" class="campo">
          <label :for="`at-ad-${c}`">{{ T(`ato.${c}`) }}</label>
          <input
            :id="`at-ad-${c}`"
            v-model="adendo.valores[c]"
            inputmode="decimal"
            :data-testid="`at-ad-${c}`"
          />
        </span>
      </div>
    </DialogoCorrecao>
  </section>
</template>

<style src="../../sadt/telas/estilo-transfusao.css"></style>
