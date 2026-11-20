<script setup lang="ts">
// Teleconsulta (ou teleinterconsulta) na tela do médico (M50, etapa 4; ficha, seção 7: `/pep/telemedicina/:atendimento`,
// aqui pelo identificador da teleconsulta; regra 7). O paciente, a situação na sala de espera (o termo aceito e o local
// informado), o alerta do crônico sem consulta presencial há mais de 180 dias (com a ciência registrada), INICIAR (a
// declaração do médico, o CID e os dados da ficha que a marcação traz: abre a sala de vídeo e o atendimento como uma
// consulta), a sala (simulada fora de produção), o ENCERRAMENTO com o motivo e o caminho para o prontuário. Na
// teleinterconsulta: o motivo, a sala, o parecer do convidado e o cancelamento de quem pediu.
import {
  MOTIVOS_ENCERRAMENTO_TELECONSULTA,
  type MotivoEncerramentoTeleconsulta,
  type TeleconsultaDetalhe,
  TEXTO_DECLARACAO_MEDICO,
  VERSAO_DECLARACAO_MEDICO,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import {
  abrirSalaInterconsulta,
  apoioTelemedicina,
  buscarCidTelemedicina,
  cancelarTeleinterconsulta,
  detalheTeleconsulta,
  encerrarTeleconsulta,
  iniciarTeleconsulta,
  responderTeleinterconsulta,
} from '../api-telemedicina.js';
import ErroTelemedicina from '../componentes/ErroTelemedicina.vue';

const { t } = useI18n();
const rota = useRoute();
const id = computed(() => Number(rota.params['id'] ?? 0));
const versao = ref(0);
const atual = ref<TeleconsultaDetalhe | null>(null);
const det = useQuery({
  queryKey: computed(() => ['telemedicina', 'detalhe', id.value, versao.value]),
  queryFn: () => detalheTeleconsulta(id.value),
  // Na espera, relê a cada 15 segundos (o paciente entra pelo portal).
  refetchInterval: (q) => {
    const s = (q.state.data as TeleconsultaDetalhe | undefined)?.situacao;
    return s === 'agendada' || s === 'aguardando' || s === 'sala-aberta' || s === 'solicitada'
      ? 15_000
      : false;
  },
});
watch(
  () => det.data.value,
  (d) => {
    if (d) atual.value = d;
  },
  { immediate: true },
);
const d = computed(() => atual.value);
const apoio = useQuery({ queryKey: ['telemedicina', 'apoio'], queryFn: () => apoioTelemedicina() });

const dia = (x: string) => x.split('-').reverse().join('/');
const hora = (h: string) => `${h.slice(0, 2)}:${h.slice(2, 4)}`;
const instante = (s: string | null) => (s ? `${dia(s.slice(0, 10))} ${s.slice(11, 16)}` : '');
const salaSimulada = computed(() => {
  const s = d.value?.sala;
  return s && s.provedor === 'simulado' ? (s.endereco.split(':')[1] ?? '') : null;
});

// ── Iniciar ──
const especialidade = ref('');
const unidade = ref('');
const centroCusto = ref('');
const procedimento = ref('');
const termoCid = ref('');
const cids = ref<{ id: number; codigo: string; nome: string }[]>([]);
const cid = ref('');
const declaracao = ref(false);
const cienteAlerta = ref(false);
const preenchido = ref(false);
watch(
  () => [d.value, apoio.data.value] as const,
  ([x, a]) => {
    if (!x || !a || preenchido.value) return;
    preenchido.value = true;
    const ab = x.abertura;
    especialidade.value = ab && ab.especialidade > 0 ? String(ab.especialidade) : '';
    unidade.value = ab && ab.unidade > 0 ? String(ab.unidade) : '';
    centroCusto.value = ab && ab.centroCusto > 0 ? String(ab.centroCusto) : '';
    procedimento.value = String(ab && ab.procedimento > 0 ? ab.procedimento : a.procedimentoPadrao);
  },
  { immediate: true },
);
const opc = (xs: readonly { codigo: number; nome: string }[]) => [
  { valor: '', rotulo: t('telemedicina.pedir.escolha') },
  ...xs.map((x) => ({ valor: String(x.codigo), rotulo: x.nome })),
];
const opcoesEspecialidade = computed(() => opc(apoio.data.value?.especialidades ?? []));
const opcoesUnidade = computed(() => opc(apoio.data.value?.unidades ?? []));
const opcoesCentro = computed(() => opc(apoio.data.value?.centrosCusto ?? []));
const opcoesCid = computed(() => [
  { valor: '', rotulo: t('telemedicina.pedir.escolha') },
  ...cids.value.map((c) => ({ valor: String(c.id), rotulo: `${c.codigo} · ${c.nome}` })),
]);
const erro = ref<unknown>(null);
const aviso = ref<string | null>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);

async function buscarCid(): Promise<void> {
  erro.value = null;
  try {
    cids.value = await buscarCidTelemedicina(termoCid.value);
    if (cids.value.length === 1) cid.value = String(cids.value[0]!.id);
  } catch (x) {
    erro.value = x;
  }
}

async function rodar(
  fn: () => Promise<{ teleconsulta: TeleconsultaDetalhe; mensagem: string }>,
): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const r = await fn();
    atual.value = r.teleconsulta;
    mensagem.value = r.mensagem;
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}

async function iniciar(): Promise<void> {
  aviso.value = null;
  if (!d.value) return;
  if (!declaracao.value) {
    aviso.value = t('telemedicina.detalhe.iniciar.faltaDeclaracao');
    return;
  }
  if (!cid.value) {
    aviso.value = t('telemedicina.detalhe.iniciar.faltaCid');
    return;
  }
  const n = [especialidade.value, unidade.value, centroCusto.value, procedimento.value].map((v) => Number(v));
  if (n.some((x) => !Number.isInteger(x) || x <= 0)) {
    aviso.value = t('telemedicina.detalhe.iniciar.faltaCampos');
    return;
  }
  const x = d.value;
  await rodar(() =>
    iniciarTeleconsulta(x.id, {
      declaracao: VERSAO_DECLARACAO_MEDICO,
      cidPrincipal: Number(cid.value),
      especialidade: n[0]!,
      unidade: n[1]!,
      centroCusto: n[2]!,
      procedimento: n[3]!,
      cienteAlerta: cienteAlerta.value,
      versao: x.versao,
    }),
  );
}

// ── Encerrar ──
const motivoEncerrar = ref<MotivoEncerramentoTeleconsulta>('concluida');
const opcoesMotivo = computed(() =>
  MOTIVOS_ENCERRAMENTO_TELECONSULTA.map((m) => ({
    valor: m,
    rotulo: t(`telemedicina.detalhe.encerrar.motivos.${m}`),
  })),
);
watch(
  () => d.value?.situacao,
  (s) => {
    if (s && s !== 'em-andamento' && motivoEncerrar.value === 'concluida')
      motivoEncerrar.value = 'paciente-ausente';
    if (s === 'em-andamento') motivoEncerrar.value = 'concluida';
  },
  { immediate: true },
);
async function encerrar(): Promise<void> {
  const x = d.value;
  if (!x) return;
  await rodar(() => encerrarTeleconsulta(x.id, { motivo: motivoEncerrar.value, versao: x.versao }));
}

// ── Teleinterconsulta ──
const parecer = ref('');
const motivoCancelar = ref('');
async function abrirSalaInter(): Promise<void> {
  const x = d.value;
  if (!x) return;
  await rodar(() => abrirSalaInterconsulta(x.id, x.versao));
}
async function responder(): Promise<void> {
  const x = d.value;
  if (!x) return;
  await rodar(() => responderTeleinterconsulta(x.id, { parecer: parecer.value, versao: x.versao }));
}
async function cancelar(): Promise<void> {
  const x = d.value;
  if (!x) return;
  await rodar(() => cancelarTeleinterconsulta(x.id, { motivo: motivoCancelar.value, versao: x.versao }));
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="teled-titulo" data-testid="tela-teleconsulta-medico">
    <p class="acoes">
      <RouterLink :to="{ name: 'telemedicina.lista' }">{{ t('telemedicina.detalhe.voltar') }}</RouterLink>
    </p>
    <ErroTelemedicina v-if="det.error.value && !d" :erro="det.error.value" />
    <p v-else-if="!d" role="status">{{ t('telemedicina.carregando') }}</p>
    <template v-else>
      <h1 id="teled-titulo">
        {{
          d.modalidade === 'teleconsulta'
            ? t('telemedicina.detalhe.titulo')
            : t('telemedicina.detalhe.tituloInter')
        }}
        · {{ t('telemedicina.detalhe.quando', { dia: dia(d.data), hora: hora(d.hora) }) }}
      </h1>
      <div class="painel" data-testid="teled-paciente">
        <p v-if="d.paciente">
          {{ t('telemedicina.detalhe.paciente') }}: <strong>{{ d.paciente.nome }}</strong> ·
          {{ t('telemedicina.detalhe.prontuario', { n: d.paciente.prontuario }) }}
          <RouterLink :to="`/pep/prontuario/${d.paciente.id}`" data-testid="teled-prontuario">{{
            t('telemedicina.detalhe.abrirProntuario')
          }}</RouterLink>
        </p>
        <p data-testid="teled-situacao">
          {{ t(`telemedicina.situacoes.${d.situacao}`) }} · {{ d.agenda }}
          <span v-if="d.atendimento" data-testid="teled-atendimento">
            · {{ t('telemedicina.detalhe.atendimento', { reg: d.atendimento }) }}</span
          >
        </p>
        <template v-if="d.modalidade === 'teleconsulta'">
          <p v-if="d.termo" data-testid="teled-termo">
            {{
              t('telemedicina.detalhe.termo', { quando: instante(d.termo.aceitoEm), versao: d.termo.versao })
            }}
          </p>
          <p v-else data-testid="teled-sem-termo">{{ t('telemedicina.detalhe.semTermo') }}</p>
          <p v-if="d.local" data-testid="teled-local">
            {{
              t('telemedicina.detalhe.local', {
                municipio: d.local.municipio,
                uf: d.local.uf,
                tipo: t(`telemedicina.detalhe.tiposLocal.${d.local.tipo}`),
              })
            }}
          </p>
          <p v-if="d.esperaDesde">
            {{ t('telemedicina.detalhe.espera', { quando: instante(d.esperaDesde) }) }}
          </p>
          <p v-if="d.pacienteEntrouEm" data-testid="teled-entrou">
            {{ t('telemedicina.detalhe.entrou', { quando: instante(d.pacienteEntrouEm) }) }}
          </p>
          <p v-if="d.medico">{{ t('telemedicina.detalhe.medico', { medico: d.medico }) }}</p>
        </template>
      </div>

      <div v-if="d.alerta?.alerta" class="painel" data-testid="teled-alerta">
        <SanteAlerta :texto="d.alerta.mensagem ?? ''" variante="aviso" anunciar />
        <p v-if="d.alerta.condicoes.length">
          {{ t('telemedicina.detalhe.condicoes', { condicoes: d.alerta.condicoes.join('; ') }) }}
        </p>
        <label v-if="d.acoes.iniciar.pode"
          ><input v-model="cienteAlerta" type="checkbox" data-testid="teled-ciente" />
          {{ t('telemedicina.detalhe.alertaCiente') }}</label
        >
      </div>

      <div v-if="d.sala" class="painel" aria-live="polite" data-testid="teled-sala">
        <h2>{{ t('telemedicina.detalhe.sala') }}</h2>
        <p v-if="salaSimulada !== null" class="simulada" data-testid="teled-sala-simulada">
          {{ t('telemedicina.detalhe.salaSimulada', { sala: salaSimulada }) }}
        </p>
      </div>

      <section
        v-if="d.modalidade === 'teleconsulta' && d.acoes.iniciar.pode"
        class="painel"
        aria-labelledby="teled-iniciar"
        data-testid="teled-iniciar"
      >
        <h2 id="teled-iniciar">{{ t('telemedicina.detalhe.iniciar.titulo') }}</h2>
        <p>{{ t('telemedicina.detalhe.iniciar.ajuda') }}</p>
        <div class="filtros">
          <SanteSelecao
            v-model="especialidade"
            :rotulo="t('telemedicina.detalhe.iniciar.especialidade')"
            :opcoes="opcoesEspecialidade"
            :busca="true"
            data-testid="teled-especialidade"
          />
          <SanteSelecao
            v-model="unidade"
            :rotulo="t('telemedicina.detalhe.iniciar.unidade')"
            :opcoes="opcoesUnidade"
            :busca="true"
            data-testid="teled-unidade"
          />
          <SanteSelecao
            v-model="centroCusto"
            :rotulo="t('telemedicina.detalhe.iniciar.centroCusto')"
            :opcoes="opcoesCentro"
            :busca="true"
            data-testid="teled-centro"
          />
          <SanteCampoTexto
            id="teled-procedimento"
            v-model="procedimento"
            :rotulo="t('telemedicina.detalhe.iniciar.procedimento')"
            :max-bytes="9"
            data-testid="teled-procedimento"
          />
        </div>
        <form class="filtros" role="search" @submit.prevent="buscarCid">
          <span class="campo">
            <label for="teled-busca-cid">{{ t('telemedicina.detalhe.iniciar.buscarCid') }}</label>
            <input
              id="teled-busca-cid"
              v-model="termoCid"
              type="search"
              autocomplete="off"
              maxlength="40"
              data-testid="teled-busca-cid"
            />
          </span>
          <SanteBotao tipo="submit" variante="secundario" :rotulo="t('telemedicina.atualizar')" />
          <SanteSelecao
            v-model="cid"
            :rotulo="t('telemedicina.detalhe.iniciar.cid')"
            :opcoes="opcoesCid"
            :busca="true"
            data-testid="teled-cid"
          />
        </form>
        <h3>{{ t('telemedicina.detalhe.iniciar.declaracao') }}</h3>
        <p>{{ TEXTO_DECLARACAO_MEDICO }}</p>
        <label
          ><input v-model="declaracao" type="checkbox" data-testid="teled-declaracao" />
          {{ t('telemedicina.detalhe.iniciar.aceite', { versao: VERSAO_DECLARACAO_MEDICO }) }}</label
        >
        <SanteAlerta v-if="aviso" :texto="aviso" variante="aviso" anunciar />
        <SanteBotao
          :rotulo="t('telemedicina.detalhe.iniciar.acao')"
          :desabilitado="ocupado"
          data-testid="teled-iniciar-acao"
          @acionar="iniciar"
        />
      </section>
      <p
        v-else-if="
          d.modalidade === 'teleconsulta' && d.situacao !== 'encerrada' && d.situacao !== 'em-andamento'
        "
        class="secundario"
        data-testid="teled-iniciar-motivo"
      >
        {{ d.acoes.iniciar.motivo }}
      </p>

      <section
        v-if="d.modalidade === 'teleconsulta' && d.acoes.encerrar.pode"
        class="painel"
        aria-labelledby="teled-encerrar"
        data-testid="teled-encerrar"
      >
        <h2 id="teled-encerrar">{{ t('telemedicina.detalhe.encerrar.titulo') }}</h2>
        <div class="filtros">
          <SanteSelecao
            v-model="motivoEncerrar"
            :rotulo="t('telemedicina.detalhe.encerrar.motivo')"
            :opcoes="opcoesMotivo"
            data-testid="teled-motivo"
          />
          <SanteBotao
            variante="destrutivo"
            :rotulo="t('telemedicina.detalhe.encerrar.acao')"
            :confirmacao="t('telemedicina.detalhe.encerrar.confirmacao')"
            :desabilitado="ocupado"
            data-testid="teled-encerrar-acao"
            @acionar="encerrar"
          />
        </div>
        <p v-if="d.situacao === 'em-andamento'" class="secundario">
          {{ t('telemedicina.detalhe.encerrar.depois') }}
        </p>
      </section>

      <section v-if="d.interconsulta" class="painel" aria-labelledby="teled-inter" data-testid="teled-inter">
        <h2 id="teled-inter">{{ t('telemedicina.detalhe.tituloInter') }}</h2>
        <p>{{ t('telemedicina.detalhe.inter.solicitante', { quem: d.interconsulta.solicitante }) }}</p>
        <p>{{ t('telemedicina.detalhe.inter.convidado', { nome: d.interconsulta.convidado.nome }) }}</p>
        <h3>{{ t('telemedicina.detalhe.inter.motivo') }}</h3>
        <p>{{ d.interconsulta.motivo }}</p>
        <template v-if="d.interconsulta.parecer">
          <h3>{{ t('telemedicina.detalhe.inter.parecer') }}</h3>
          <p data-testid="teled-parecer">{{ d.interconsulta.parecer }}</p>
          <p class="secundario">
            {{
              t('telemedicina.detalhe.inter.respondidaEm', { quando: instante(d.interconsulta.respondidaEm) })
            }}
          </p>
        </template>
        <template v-if="d.acoes.responder.pode">
          <SanteBotao
            v-if="d.situacao === 'solicitada'"
            variante="secundario"
            :rotulo="t('telemedicina.detalhe.inter.abrirSala')"
            :desabilitado="ocupado"
            data-testid="teled-inter-sala"
            @acionar="abrirSalaInter"
          />
          <SanteCampoTexto
            id="teled-parecer-texto"
            v-model="parecer"
            :rotulo="t('telemedicina.detalhe.inter.parecer')"
            :max-bytes="4000"
            multilinha
            data-testid="teled-parecer-texto"
          />
          <SanteBotao
            :rotulo="t('telemedicina.detalhe.inter.responder')"
            :desabilitado="ocupado"
            data-testid="teled-responder"
            @acionar="responder"
          />
        </template>
        <template v-if="d.acoes.cancelar.pode">
          <SanteCampoTexto
            id="teled-cancelar-motivo"
            v-model="motivoCancelar"
            :rotulo="t('telemedicina.detalhe.inter.motivoCancelamento')"
            :max-bytes="200"
            data-testid="teled-cancelar-motivo"
          />
          <SanteBotao
            variante="destrutivo"
            :rotulo="t('telemedicina.detalhe.inter.cancelar')"
            :confirmacao="t('telemedicina.detalhe.inter.cancelarConfirma')"
            :desabilitado="ocupado"
            data-testid="teled-cancelar"
            @acionar="cancelar"
          />
        </template>
      </section>
    </template>
    <p v-if="mensagem" role="status" data-testid="teled-mensagem">{{ mensagem }}</p>
    <ErroTelemedicina v-if="erro" :erro="erro" />
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style scoped>
.simulada {
  padding: var(--sgh-espaco-3);
  border: 1px dashed var(--sgh-borda);
}
</style>
