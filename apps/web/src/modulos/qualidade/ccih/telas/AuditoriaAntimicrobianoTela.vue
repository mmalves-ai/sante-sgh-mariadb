<script setup lang="ts">
// Qualidade e segurança › CCIH › Auditoria de antimicrobianos (F7, 03-PEP linha 110): as fichas de antimicrobiano que o
// prescritor preencheu junto da prescrição, agrupadas por paciente, as pendentes primeiro. A auditoria abre na própria
// linha: droga, dose, tempo e via já marcadas como adequadas (o caso comum, menos cliques), a indicação pela finalidade
// da ficha, o tipo de auditoria sugerindo o parecer e o parecer padrão trazendo a prorrogação; o que falta aparece na
// hora e o botão fica travado até estar completo (as mesmas regras da API, @sgh/dominio-qualidade). O histórico por
// paciente mostra as auditorias vigentes e as substituídas.
import '../../componentes/estilo-qualidade.css';
import '../componentes/estilo-ccih.css';
import {
  ADEQUACOES_AUDITORIA,
  type AcaoTipoAuditoria,
  type AdequacaoAuditoria,
  avaliarAuditoriaAntimicrobiano,
  INDICACOES_AUDITORIA,
  type IndicacaoAuditoria,
  MENSAGENS_AUDITORIA_ANTIMICROBIANO,
  PARECERES_AUDITORIA_ANTIMICROBIANO,
  type ParecerAuditoriaAntimicrobiano,
  parecerSugerido,
} from '@sgh/dominio-qualidade';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { pode } from '../../../../casca/sessao/pode.js';
import { dataHora } from '../../regras-qualidade.js';
import { codigoDaRecusa, novaChaveCcih } from '../api-ccih.js';
import {
  type FichaDaAuditoria,
  gravarAuditoria,
  lerAuditoriasDoPaciente,
  lerCadastroDaAuditoria,
  lerFichasParaAuditoria,
} from '../api-auditoria-antimicrobiano.js';
import ErroCcih from '../componentes/ErroCcih.vue';
import NavCcih from '../componentes/NavCcih.vue';

const { t } = useI18n();
const cliente = useQueryClient();
const podeAuditar = pode('qualidade.antimicrobiano.liberar');
const soPendentes = ref(true);
const fila = useQuery({
  queryKey: computed(() => ['ccih', 'auditoria-am', soPendentes.value]),
  queryFn: () => lerFichasParaAuditoria(!soPendentes.value),
  refetchInterval: 120_000,
});
const cadastro = useQuery({
  queryKey: ['ccih', 'auditoria-am', 'cadastro'],
  queryFn: lerCadastroDaAuditoria,
  staleTime: 60_000,
});

const porPaciente = computed(() => {
  const m = new Map<number, { paciente: number; nome: string; fichas: FichaDaAuditoria[] }>();
  for (const f of fila.data.value ?? []) {
    const g = m.get(f.paciente) ?? { paciente: f.paciente, nome: f.nome, fichas: [] };
    g.fichas.push(f);
    m.set(f.paciente, g);
  }
  return [...m.values()];
});
const dia = (d: string | null) => (d ? d.split('-').reverse().join('/') : '');

// ── Auditoria na linha ──
const f = reactive({
  ficha: 0,
  versao: 0,
  avaliavel: true,
  droga: 'adequada' as AdequacaoAuditoria,
  dose: 'adequada' as AdequacaoAuditoria,
  tempo: 'adequada' as AdequacaoAuditoria,
  via: 'adequada' as AdequacaoAuditoria,
  indicacao: null as IndicacaoAuditoria | null,
  parecer: '' as ParecerAuditoriaAntimicrobiano | '',
  prorrogacao: null as boolean | null,
  recomendacao: '',
  tipo: null as number | null,
  parecerPadrao: null as number | null,
});
const chave = ref(novaChaveCcih('auditoria-am'));
const erro = ref<unknown>(null);
const aviso = ref<string | null>(null);
const aberta = computed(() => (fila.data.value ?? []).find((x) => x.id === f.ficha) ?? null);
function abrir(x: FichaDaAuditoria): void {
  const tipoPadrao = (cadastro.data.value?.tipos ?? []).find((y) => y.ativo && y.padrao) ?? null;
  Object.assign(f, {
    ficha: x.id,
    versao: x.versao,
    avaliavel: true,
    droga: 'adequada',
    dose: 'adequada',
    tempo: 'adequada',
    via: 'adequada',
    indicacao: null,
    parecer: parecerSugerido((tipoPadrao?.acao ?? null) as AcaoTipoAuditoria | null) ?? '',
    prorrogacao: null,
    recomendacao: '',
    tipo: tipoPadrao?.id ?? null,
    parecerPadrao: null,
  });
  erro.value = null;
  aviso.value = null;
}
const tipoEscolhido = computed(() => (cadastro.data.value?.tipos ?? []).find((y) => y.id === f.tipo) ?? null);
const padraoEscolhido = computed(
  () => (cadastro.data.value?.pareceres ?? []).find((y) => y.id === f.parecerPadrao) ?? null,
);
// O tipo escolhido sugere o parecer (o auditor pode trocar).
watch(
  () => f.tipo,
  () => {
    const s = parecerSugerido((tipoEscolhido.value?.acao ?? null) as AcaoTipoAuditoria | null);
    if (s) f.parecer = s;
  },
);
const opAdequacao = ADEQUACOES_AUDITORIA.map((a) => ({
  valor: a as AdequacaoAuditoria,
  rotulo: t(`ccih.auditoriaAntimicrobiano.adequacoes.${a}`),
}));
const opIndicacao = [
  { valor: null as IndicacaoAuditoria | null, rotulo: t('ccih.auditoriaAntimicrobiano.indicacaoDaFicha') },
  ...INDICACOES_AUDITORIA.map((i) => ({
    valor: i as IndicacaoAuditoria | null,
    rotulo: t(`ccih.auditoriaAntimicrobiano.indicacoes.${i}`),
  })),
];
const opParecer = [
  { valor: '' as ParecerAuditoriaAntimicrobiano | '', rotulo: '' },
  ...PARECERES_AUDITORIA_ANTIMICROBIANO.map((p) => ({
    valor: p as ParecerAuditoriaAntimicrobiano | '',
    rotulo: t(`ccih.auditoriaAntimicrobiano.pareceres.${p}`),
  })),
];
const opTipo = computed(() => [
  { valor: null as number | null, rotulo: t('ccih.auditoriaAntimicrobiano.nenhum') },
  ...(cadastro.data.value?.tipos ?? [])
    .filter((y) => y.ativo)
    .map((y) => ({ valor: y.id as number | null, rotulo: y.descricao })),
]);
const opPadrao = computed(() => [
  { valor: null as number | null, rotulo: t('ccih.auditoriaAntimicrobiano.nenhum') },
  ...(cadastro.data.value?.pareceres ?? [])
    .filter((y) => y.ativo)
    .map((y) => ({ valor: y.id as number | null, rotulo: y.descricao })),
]);
/** A mesma regra do servidor, na hora: o que falta ou contradiz. */
const avaliacao = computed(() =>
  avaliarAuditoriaAntimicrobiano(
    {
      avaliavel: f.avaliavel,
      droga: f.droga,
      dose: f.dose,
      tempo: f.tempo,
      via: f.via,
      indicacao: f.indicacao,
      parecer: f.parecer,
      permiteProrrogacao: f.prorrogacao,
      recomendacao: f.recomendacao,
    },
    {
      tipo: tipoEscolhido.value
        ? { ativo: tipoEscolhido.value.ativo, acao: tipoEscolhido.value.acao as AcaoTipoAuditoria }
        : null,
      parecerPadrao: padraoEscolhido.value
        ? {
            ativo: padraoEscolhido.value.ativo,
            permiteProrrogacao: padraoEscolhido.value.permiteProrrogacao,
          }
        : null,
      finalidade: aberta.value?.finalidadeCodigo ?? null,
    },
  ),
);
const falta = computed(() =>
  avaliacao.value.ok ? [] : avaliacao.value.recusas.map((r) => MENSAGENS_AUDITORIA_ANTIMICROBIANO[r]),
);
const prorrogaMarcado = computed({
  get: () => f.prorrogacao ?? padraoEscolhido.value?.permiteProrrogacao ?? false,
  set: (v: boolean) => {
    f.prorrogacao = v;
  },
});
const recusa = computed(() => {
  const c = codigoDaRecusa(erro.value);
  return c && c in MENSAGENS_AUDITORIA_ANTIMICROBIANO
    ? MENSAGENS_AUDITORIA_ANTIMICROBIANO[c as keyof typeof MENSAGENS_AUDITORIA_ANTIMICROBIANO]
    : null;
});
async function gravar(): Promise<void> {
  if (!avaliacao.value.ok || f.parecer === '') return;
  erro.value = null;
  try {
    const r = await gravarAuditoria(
      f.ficha,
      {
        versaoFicha: f.versao,
        avaliavel: f.avaliavel,
        droga: f.droga,
        dose: f.dose,
        tempo: f.tempo,
        via: f.via,
        indicacao: f.indicacao,
        parecer: f.parecer,
        permiteProrrogacao: f.prorrogacao,
        recomendacao: f.recomendacao.trim() || null,
        tipo: f.tipo,
        parecerPadrao: f.parecerPadrao,
      },
      chave.value,
    );
    chave.value = novaChaveCcih('auditoria-am');
    f.ficha = 0;
    aviso.value = t('ccih.auditoriaAntimicrobiano.gravada', {
      avaliacao: t(`ccih.auditoriaAntimicrobiano.avaliacoes.${r.avaliacao}`),
    });
    await cliente.invalidateQueries({ queryKey: ['ccih', 'auditoria-am'] });
  } catch (e) {
    erro.value = e;
  }
}

// ── Visão do paciente ──
const pacienteVisto = ref<number | null>(null);
const historico = useQuery({
  queryKey: computed(() => ['ccih', 'auditoria-am', 'historico', pacienteVisto.value]),
  queryFn: () => lerAuditoriasDoPaciente(pacienteVisto.value!),
  enabled: computed(() => pacienteVisto.value !== null),
});
const adequacoesDe = (a: {
  droga: string | null;
  dose: string | null;
  tempo: string | null;
  via: string | null;
}) =>
  [a.droga, a.dose, a.tempo, a.via]
    .map((x) => (x ? t(`ccih.auditoriaAntimicrobiano.adequacoes.${x}`) : '-'))
    .join(' / ');
</script>

<template>
  <section class="tela-agenda" aria-labelledby="ccih-aud-titulo" data-testid="tela-ccih-auditoria-am">
    <h1 id="ccih-aud-titulo">{{ t('ccih.auditoriaAntimicrobiano.titulo') }}</h1>
    <NavCcih />
    <p class="secundario">{{ t('ccih.auditoriaAntimicrobiano.explicacao') }}</p>
    <label class="linha-ccih"
      ><input v-model="soPendentes" type="checkbox" data-testid="auditoria-so-pendentes" />{{
        t('ccih.auditoriaAntimicrobiano.soPendentes')
      }}</label
    >
    <div v-if="aviso" role="status" data-testid="auditoria-aviso">{{ aviso }}</div>

    <ErroCcih v-if="fila.isError.value" :erro="fila.error.value" />
    <p v-else-if="!fila.data.value" role="status">{{ t('ccih.carregando') }}</p>
    <p v-else-if="!porPaciente.length" data-testid="auditoria-nenhuma">
      {{ t('ccih.auditoriaAntimicrobiano.nenhuma') }}
    </p>
    <section
      v-for="g in porPaciente"
      :key="g.paciente"
      class="painel-ccih"
      :aria-label="t('ccih.auditoriaAntimicrobiano.paciente', { nome: g.nome })"
      :data-testid="`auditoria-paciente-${g.paciente}`"
    >
      <div class="linha-ccih">
        <h2>{{ t('ccih.auditoriaAntimicrobiano.paciente', { nome: g.nome }) }}</h2>
        <SanteBotao
          :rotulo="t('ccih.auditoriaAntimicrobiano.verHistorico')"
          variante="texto"
          :data-testid="`auditoria-ver-historico-${g.paciente}`"
          @acionar="pacienteVisto = g.paciente"
        />
      </div>
      <ul class="lista-ccih">
        <li v-for="x in g.fichas" :key="x.id" :data-testid="`auditoria-ficha-${x.id}`">
          <strong>{{ x.antimicrobiano }}</strong> · {{ x.finalidade }} ·
          {{
            t('ccih.auditoriaAntimicrobiano.periodo', {
              inicio: dia(x.inicio),
              fim: dia(x.fimPrevisto),
              dias: x.diasPrevistos,
            })
          }}
          <span
            class="selo"
            :class="{ 'selo--grave': x.avaliacao !== 'pendente' && x.avaliacao !== 'aprovada' }"
            :data-testid="`auditoria-situacao-${x.id}`"
            >{{ t(`ccih.auditoriaAntimicrobiano.avaliacoes.${x.avaliacao}`) }}</span
          >
          <div class="secundario">
            {{ x.indicacaoClinica }}
            <span v-if="x.sitio"> · {{ t('ccih.auditoriaAntimicrobiano.sitio', { sitio: x.sitio }) }}</span>
            ·
            {{
              x.culturaColetada
                ? t('ccih.auditoriaAntimicrobiano.culturaColetada')
                : t('ccih.auditoriaAntimicrobiano.semCultura')
            }}
            · {{ t('ccih.auditoriaAntimicrobiano.prescritor', { nome: x.prescritor }) }}
          </div>
          <SanteBotao
            v-if="podeAuditar && f.ficha !== x.id"
            :rotulo="t('ccih.auditoriaAntimicrobiano.auditar')"
            variante="secundario"
            :data-testid="`auditoria-auditar-${x.id}`"
            @acionar="abrir(x)"
          />
          <div v-if="f.ficha === x.id" class="painel-ccih" data-testid="form-auditoria">
            <label class="linha-ccih"
              ><input v-model="f.avaliavel" type="checkbox" data-testid="auditoria-avaliavel" />{{
                t('ccih.auditoriaAntimicrobiano.avaliavel')
              }}</label
            >
            <div v-if="f.avaliavel" class="linha-ccih">
              <SanteSelecao
                v-model="f.droga"
                :rotulo="t('ccih.auditoriaAntimicrobiano.droga')"
                :opcoes="opAdequacao"
                data-testid="auditoria-droga"
              />
              <SanteSelecao
                v-model="f.dose"
                :rotulo="t('ccih.auditoriaAntimicrobiano.dose')"
                :opcoes="opAdequacao"
                data-testid="auditoria-dose"
              />
              <SanteSelecao
                v-model="f.tempo"
                :rotulo="t('ccih.auditoriaAntimicrobiano.tempo')"
                :opcoes="opAdequacao"
                data-testid="auditoria-tempo"
              />
              <SanteSelecao
                v-model="f.via"
                :rotulo="t('ccih.auditoriaAntimicrobiano.via')"
                :opcoes="opAdequacao"
                data-testid="auditoria-via"
              />
            </div>
            <div class="linha-ccih">
              <SanteSelecao
                v-model="f.indicacao"
                :rotulo="t('ccih.auditoriaAntimicrobiano.indicacao')"
                :opcoes="opIndicacao"
                data-testid="auditoria-indicacao"
              />
              <SanteSelecao
                v-model="f.tipo"
                :rotulo="t('ccih.auditoriaAntimicrobiano.tipo')"
                :opcoes="opTipo"
                data-testid="auditoria-tipo"
              />
              <SanteSelecao
                v-model="f.parecerPadrao"
                :rotulo="t('ccih.auditoriaAntimicrobiano.parecerPadrao')"
                :opcoes="opPadrao"
                data-testid="auditoria-parecer-padrao"
              />
              <SanteSelecao
                v-model="f.parecer"
                :rotulo="t('ccih.auditoriaAntimicrobiano.parecer')"
                :opcoes="opParecer"
                obrigatorio
                data-testid="auditoria-parecer"
              />
            </div>
            <label class="linha-ccih"
              ><input
                v-model="prorrogaMarcado"
                type="checkbox"
                :disabled="!f.avaliavel"
                data-testid="auditoria-prorrogacao"
              />{{ t('ccih.auditoriaAntimicrobiano.prorrogacao') }}</label
            >
            <SanteCampoTexto
              v-model="f.recomendacao"
              :rotulo="t('ccih.auditoriaAntimicrobiano.recomendacao')"
              :max-bytes="4000"
              data-testid="auditoria-recomendacao"
            />
            <p v-if="falta.length" class="secundario" data-testid="auditoria-falta">
              {{ t('ccih.auditoriaAntimicrobiano.falta', { itens: falta.join(' ') }) }}
            </p>
            <div v-if="recusa" role="alert" data-testid="recusa-auditoria">
              <SanteAlerta variante="alerta" :texto="recusa" />
            </div>
            <ErroCcih v-else-if="erro" :erro="erro" />
            <div class="linha-ccih">
              <SanteBotao
                :rotulo="t('ccih.gravar')"
                variante="primario"
                :desabilitado="falta.length > 0"
                data-testid="auditoria-gravar"
                @acionar="gravar"
              />
              <SanteBotao :rotulo="t('ccih.cancelar')" variante="texto" @acionar="f.ficha = 0" />
            </div>
          </div>
        </li>
      </ul>
      <div v-if="pacienteVisto === g.paciente" data-testid="auditorias-paciente">
        <ErroCcih v-if="historico.isError.value" :erro="historico.error.value" />
        <p v-else-if="!historico.data.value" role="status">{{ t('ccih.carregando') }}</p>
        <table v-else class="tabela">
          <caption>
            {{
              t('ccih.auditoriaAntimicrobiano.historico')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('ccih.auditoriaAntimicrobiano.colData') }}</th>
              <th scope="col">{{ t('ccih.auditoriaAntimicrobiano.colAvaliacao') }}</th>
              <th scope="col">{{ t('ccih.auditoriaAntimicrobiano.colParecer') }}</th>
              <th scope="col">{{ t('ccih.auditoriaAntimicrobiano.colAuditor') }}</th>
              <th scope="col">{{ t('ccih.auditoriaAntimicrobiano.colSituacao') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="a in historico.data.value" :key="a.id" :data-testid="`auditoria-${a.id}`">
              <td>{{ dataHora(a.auditadaEm) }}</td>
              <td>{{ adequacoesDe(a) }}</td>
              <td>
                {{ t(`ccih.auditoriaAntimicrobiano.pareceres.${a.parecer}`) }}
                <span v-if="a.recomendacao" class="secundario"> · {{ a.recomendacao }}</span>
              </td>
              <td>{{ a.auditor }}</td>
              <td>{{ t(`ccih.auditoriaAntimicrobiano.situacoes.${a.situacao}`) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </section>
</template>

<style src="../../../agenda/componentes/estilo-agenda.css"></style>
