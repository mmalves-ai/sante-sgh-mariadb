<script setup lang="ts">
// W0-03, mercado M5: a contenção mecânica da unidade. Um cartão por paciente internado: sem ordem, o botão de
// prescrever; com a ordem em curso, a situação (ativa ou vencida), o resumo, os horários aprazados da checagem (cada um
// com o estado) e as ações — checar o horário, renovar (ordem nova com nova avaliação), retirar (motivo) e inativar a
// lançada errada (motivo e senha, só do autor). Um aviso único no alto: as vencidas e as atrasadas. O histórico do
// paciente mostra as renovadas, as retiradas e as inativadas (tachadas). O indicador do período imprime o numerador e o
// denominador. Tudo o que decide vem do servidor (a tela só mostra).
// Revisão W0-03: a checagem feita se corrige por adendo do próprio autor (achados corrigidos e o motivo; a original
// continua visível); os horários da ordem renovada antes do fim do prazo ficam cancelados (são da nova).
import {
  ACHADOS_CHECAGEM_CONTENCAO,
  type AchadoChecagemContencao,
  type ContencaoLida,
  MEMBROS_CONTENCAO,
  type MembroContencao,
  MOTIVOS_CONTENCAO,
  type MotivoContencao,
  type PacienteContencao,
  ROTULOS_ACHADO_CONTENCAO,
  ROTULOS_MEMBRO_CONTENCAO,
  ROTULOS_MOTIVO_CONTENCAO,
  ROTULOS_TIPO_CONTENCAO,
  TIPOS_CONTENCAO,
  type TipoContencao,
} from '@sgh/contratos';
import { SanteBotao, SanteDialogo, SanteOpcoes, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import {
  adendoChecagemContencao,
  checarContencao,
  inativarContencao,
  lerContencoesDaUnidade,
  lerHistoricoContencao,
  lerIndicadorContencao,
  prescreverContencao,
  renovarContencao,
  retirarContencao,
} from '../api-contencao.js';
import DialogoCorrecao, { type DadosCorrecao } from '../componentes/DialogoCorrecao.vue';
import ErroEnfermagem from '../componentes/ErroEnfermagem.vue';
import SeletorUnidade from '../componentes/SeletorUnidade.vue';
import { usarEnfermagem } from '../usar-enfermagem.js';

const { t } = useI18n();
const rota = useRoute();
const uid = `ct-${useId()}`;
const { unidade, escolherUnidade, opcoesUnidade, login } = usarEnfermagem();
/** O registro é do usuário da sessão (só o autor corrige ou inativa; o servidor confere de novo). */
const ehMeu = (u: string | null | undefined) =>
  !!login.value && (u ?? '').toUpperCase() === login.value.toUpperCase();
const tela = useQuery({
  queryKey: computed(() => ['enfermagem', 'contencao', unidade.value]),
  queryFn: () => lerContencoesDaUnidade(unidade.value),
  enabled: computed(() => unidade.value !== ''),
  refetchInterval: 60_000,
});
const dados = computed(() => tela.data.value ?? null);
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const hora = (x: string | null | undefined) => (x ? x.slice(0, 16).replace('T', ' ') : '—');
const horaCurta = (x: string) => x.slice(11, 16);
const membros = (ms: readonly MembroContencao[]) => ms.map((m) => ROTULOS_MEMBRO_CONTENCAO[m]).join(', ');
// O paciente vindo do aviso da central (`?atendimento=`) abre o histórico dele.
const atendimentoDaRota = Number(rota.query['atendimento'] ?? 0) || null;

// ── A ordem e a renovação ────────────────────────────────────────────────────────
const dialogoOrdem = ref(false);
const alvoOrdem = ref<{ paciente: PacienteContencao; anterior: ContencaoLida | null } | null>(null);
const motivo = ref<MotivoContencao>('agitacao');
const justificativa = ref('');
const tipo = ref<TipoContencao>('leito');
const membrosEscolhidos = ref<MembroContencao[]>([]);
const prazo = ref(24);
const intervalo = ref(60);
const erroOrdem = ref<unknown>(null);
const opcoesMotivo = MOTIVOS_CONTENCAO.map((v) => ({ valor: v, rotulo: ROTULOS_MOTIVO_CONTENCAO[v] }));
const opcoesTipo = TIPOS_CONTENCAO.map((v) => ({ valor: v, rotulo: ROTULOS_TIPO_CONTENCAO[v] }));
function abrirOrdem(p: PacienteContencao, anterior: ContencaoLida | null): void {
  const par = dados.value?.parametros;
  alvoOrdem.value = { paciente: p, anterior };
  motivo.value = (anterior?.motivo as MotivoContencao | undefined) ?? 'agitacao';
  justificativa.value = '';
  tipo.value = (anterior?.tipo as TipoContencao | undefined) ?? 'leito';
  membrosEscolhidos.value = anterior ? [...anterior.membros] : [];
  prazo.value = par?.prazoMaximoHoras ?? 24;
  intervalo.value = anterior?.intervaloMinutos ?? par?.intervaloPadraoMinutos ?? 60;
  erroOrdem.value = null;
  dialogoOrdem.value = true;
}
const ordemValida = computed(
  () =>
    justificativa.value.trim().length >= 10 &&
    membrosEscolhidos.value.length > 0 &&
    prazo.value >= 1 &&
    prazo.value <= (dados.value?.parametros.prazoMaximoHoras ?? 24) &&
    intervalo.value >= 15 &&
    intervalo.value <= 120,
);
async function confirmarOrdem(): Promise<void> {
  const a = alvoOrdem.value;
  if (!a || !ordemValida.value) return;
  erroOrdem.value = null;
  const e = {
    paciente: a.paciente.paciente,
    atendimento: a.paciente.atendimento,
    motivo: motivo.value,
    justificativa: justificativa.value.trim(),
    tipo: tipo.value,
    membros: [...membrosEscolhidos.value],
    prazoHoras: Number(prazo.value),
    intervaloMinutos: Number(intervalo.value),
  };
  try {
    const r = a.anterior ? await renovarContencao(a.anterior.id, e) : await prescreverContencao(e);
    mensagem.value = r.mensagem;
    dialogoOrdem.value = false;
    await recarregar(a.paciente.atendimento);
  } catch (x) {
    erroOrdem.value = x;
  }
}

// ── A checagem de um horário ───────────────────────────────────────────────────────
const dialogoChecar = ref(false);
const alvoChecar = ref<{ ordem: ContencaoLida; previsto: string } | null>(null);
const achados = ref<Record<AchadoChecagemContencao, 'normal' | 'alterado'>>({
  perfusao: 'normal',
  pele: 'normal',
  posicao: 'normal',
  necessidades: 'normal',
});
const observacao = ref('');
const erroChecar = ref<unknown>(null);
const opcoesAchado = computed(() => [
  { valor: 'normal' as const, rotulo: t('enfermagem.contencao.normal') },
  { valor: 'alterado' as const, rotulo: t('enfermagem.contencao.alterado') },
]);
const temAlterado = computed(() => Object.values(achados.value).includes('alterado'));
const checagemValida = computed(() => !temAlterado.value || observacao.value.trim().length >= 10);
function abrirChecar(ordem: ContencaoLida, previsto: string): void {
  alvoChecar.value = { ordem, previsto };
  for (const k of ACHADOS_CHECAGEM_CONTENCAO) achados.value[k] = 'normal';
  observacao.value = '';
  erroChecar.value = null;
  dialogoChecar.value = true;
}
async function confirmarChecar(): Promise<void> {
  const a = alvoChecar.value;
  if (!a || !checagemValida.value) return;
  erroChecar.value = null;
  try {
    const r = await checarContencao(a.ordem.id, a.previsto, {
      achados: { ...achados.value },
      ...(observacao.value.trim() ? { observacao: observacao.value.trim() } : {}),
    });
    mensagem.value = r.mensagem;
    dialogoChecar.value = false;
    await recarregar(a.ordem.atendimento);
  } catch (x) {
    erroChecar.value = x;
  }
}

// ── O adendo da checagem (revisão W0-03: só do autor, com o motivo) ─────────────────────
const dialogoAdendo = ref(false);
const alvoAdendo = ref<{ ordem: ContencaoLida; previsto: string } | null>(null);
const motivoAdendo = ref('');
const erroAdendo = ref<unknown>(null);
type Horario = ContencaoLida['horarios'][number];
/** A checagem vigente do horário: a do último adendo, ou a original. */
const checagemVigente = (h: Horario) => {
  const c = h.checagem;
  if (!c) return null;
  return c.adendos.length ? { ...c, ...c.adendos[c.adendos.length - 1]! } : c;
};
function abrirAdendo(ordem: ContencaoLida, h: Horario): void {
  const c = checagemVigente(h);
  alvoAdendo.value = { ordem, previsto: h.previsto };
  for (const k of ACHADOS_CHECAGEM_CONTENCAO)
    achados.value[k] = c?.achados[k] === 'alterado' ? 'alterado' : 'normal';
  observacao.value = c?.observacao ?? '';
  motivoAdendo.value = '';
  erroAdendo.value = null;
  dialogoAdendo.value = true;
}
async function confirmarAdendo(): Promise<void> {
  const a = alvoAdendo.value;
  if (!a || !checagemValida.value || motivoAdendo.value.trim().length < 10) return;
  erroAdendo.value = null;
  try {
    const r = await adendoChecagemContencao(a.ordem.id, {
      previsto: a.previsto,
      achados: { ...achados.value },
      ...(observacao.value.trim() ? { observacao: observacao.value.trim() } : {}),
      motivo: motivoAdendo.value.trim(),
    });
    mensagem.value = r.mensagem;
    dialogoAdendo.value = false;
    await recarregar(a.ordem.atendimento);
  } catch (x) {
    erroAdendo.value = x;
  }
}

// ── A retirada e a inativação ───────────────────────────────────────────────────────
const dialogoRetirar = ref(false);
const dialogoInativar = ref(false);
const alvo = ref<ContencaoLida | null>(null);
function abrirRetirar(o: ContencaoLida): void {
  alvo.value = o;
  dialogoRetirar.value = true;
}
function abrirInativar(o: ContencaoLida): void {
  alvo.value = o;
  dialogoInativar.value = true;
}
async function retirar(c: DadosCorrecao): Promise<void> {
  const o = alvo.value;
  if (!o) return;
  mensagem.value = (await retirarContencao(o.id, c.motivo)).mensagem;
  await recarregar(o.atendimento);
}
async function inativar(c: DadosCorrecao): Promise<void> {
  const o = alvo.value;
  if (!o) return;
  mensagem.value = (await inativarContencao(o.id, c.motivo, c.senha)).mensagem;
  await recarregar(o.atendimento);
}

// ── O histórico do paciente ─────────────────────────────────────────────────────────
const historicoDe = ref<number | null>(atendimentoDaRota);
const historico = useQuery({
  queryKey: computed(() => ['enfermagem', 'contencao', 'historico', historicoDe.value]),
  queryFn: () => lerHistoricoContencao(historicoDe.value!),
  enabled: computed(() => historicoDe.value !== null),
});
async function recarregar(atendimento: number): Promise<void> {
  await tela.refetch();
  if (historicoDe.value === atendimento) await historico.refetch();
}

// ── O indicador ─────────────────────────────────────────────────────────────────────
const hoje = new Date().toISOString().slice(0, 10);
const de = ref(`${hoje.slice(0, 8)}01`);
const ate = ref(hoje);
const indicador = ref<Awaited<ReturnType<typeof lerIndicadorContencao>> | null>(null);
const erroIndicador = ref<unknown>(null);
async function calcular(): Promise<void> {
  erroIndicador.value = null;
  try {
    indicador.value = await lerIndicadorContencao(unidade.value, de.value, ate.value);
  } catch (x) {
    erroIndicador.value = x;
  }
}
const pode = computed(() => dados.value?.gravacao ?? null);
</script>

<template>
  <section class="tela-enf" :aria-labelledby="`${uid}-titulo`" data-testid="tela-contencao">
    <h1 :id="`${uid}-titulo`">{{ t('enfermagem.contencao.titulo') }}</h1>
    <p>{{ t('enfermagem.contencao.texto') }}</p>
    <p class="base">{{ t('enfermagem.contencao.base') }}</p>
    <div class="barra">
      <SeletorUnidade :model-value="unidade" :opcoes="opcoesUnidade" @update:model-value="escolherUnidade" />
    </div>
    <p v-if="mensagem" role="status" data-testid="ct-mensagem">{{ mensagem }}</p>
    <ErroEnfermagem v-if="erro" :erro="erro" />
    <!-- O aviso único: as ordens vencidas e as checagens atrasadas da unidade. -->
    <div
      v-if="dados && (dados.vencidas > 0 || dados.atrasadas > 0)"
      role="alert"
      class="cartao alerta"
      data-testid="ct-alerta"
    >
      <p v-if="dados.vencidas > 0">
        <strong>{{ t('enfermagem.contencao.alertaVencidas', { n: dados.vencidas }) }}</strong>
      </p>
      <p v-if="dados.atrasadas > 0">
        {{ t('enfermagem.contencao.alertaAtrasadas', { n: dados.atrasadas }) }}
      </p>
    </div>
    <p v-if="pode && !pode.ligada" role="note" data-testid="ct-desligada">
      {{ t('enfermagem.contencao.semGravacao', { motivo: pode.motivo ?? '' }) }}
    </p>
    <ErroEnfermagem v-if="tela.isError.value" :erro="tela.error.value" />
    <p v-else-if="!dados" role="status">{{ t('enfermagem.comum.carregando') }}</p>
    <ul v-else class="cartoes" data-testid="ct-pacientes">
      <li
        v-for="p in dados.pacientes"
        :key="p.atendimento"
        class="cartao"
        :data-testid="`ct-paciente-${p.atendimento}`"
        :data-situacao="p.ordem?.situacao ?? 'sem'"
      >
        <header class="cab">
          <strong>{{ p.leito }} · {{ p.nome }}</strong>
          <span
            v-if="p.ordem"
            :class="['selo', p.ordem.situacao]"
            :data-testid="`ct-situacao-${p.atendimento}`"
          >
            {{ t(`enfermagem.contencao.situacoes.${p.ordem.situacao}`) }}
          </span>
          <span v-else class="selo">{{ t('enfermagem.contencao.semOrdem') }}</span>
        </header>
        <template v-if="p.ordem">
          <p>
            {{ ROTULOS_MOTIVO_CONTENCAO[p.ordem.motivo] }} ·
            {{
              t('enfermagem.contencao.resumo', {
                tipo: ROTULOS_TIPO_CONTENCAO[p.ordem.tipo],
                membros: membros(p.ordem.membros),
                fim: hora(p.ordem.fim),
              })
            }}
          </p>
          <p class="discreto">
            {{
              t('enfermagem.contencao.prescritaPor', {
                por: p.ordem.prescritor,
                quando: hora(p.ordem.inicio),
              })
            }}
            <template v-if="p.ordem.anterior">
              · {{ t('enfermagem.contencao.renovacaoDe', { id: p.ordem.anterior }) }}</template
            >
          </p>
          <ol class="horarios" :aria-label="t('enfermagem.contencao.achados')">
            <li
              v-for="h in p.ordem.horarios"
              :key="h.previsto"
              :class="['horario', h.estado]"
              :data-testid="`ct-horario-${p.ordem.id}-${horaCurta(h.previsto).replace(':', '')}`"
              :data-estado="h.estado"
            >
              <span>{{ horaCurta(h.previsto) }} · {{ t(`enfermagem.contencao.estados.${h.estado}`) }}</span>
              <SanteBotao
                v-if="(h.estado === 'pendente' || h.estado === 'atrasada') && pode?.checar"
                variante="secundario"
                :rotulo="t('enfermagem.contencao.checar', { hora: horaCurta(h.previsto) })"
                :data-testid="`ct-checar-${p.ordem.id}-${horaCurta(h.previsto).replace(':', '')}`"
                @acionar="abrirChecar(p.ordem, h.previsto)"
              />
              <small
                v-if="h.checagem?.adendos.length"
                :data-testid="`ct-adendo-lido-${p.ordem.id}-${horaCurta(h.previsto).replace(':', '')}`"
                >{{ t('enfermagem.contencao.comAdendo', { n: h.checagem.adendos.length }) }}</small
              >
              <SanteBotao
                v-if="h.checagem && ehMeu(h.checagem.usuario) && pode?.checar"
                variante="secundario"
                :rotulo="t('enfermagem.contencao.adendo')"
                :data-testid="`ct-adendo-${p.ordem.id}-${horaCurta(h.previsto).replace(':', '')}`"
                @acionar="abrirAdendo(p.ordem, h)"
              />
            </li>
          </ol>
          <!-- W1-08: a checagem de perfusão e pele aprazada por turno da enfermagem. -->
          <ul
            v-if="p.ordem.turnos?.length"
            class="discreto turnos"
            :aria-label="t('enfermagem.contencao.turnos')"
            :data-testid="`ct-turnos-${p.ordem.id}`"
          >
            <li
              v-for="tu in p.ordem.turnos"
              :key="tu.inicio"
              :data-testid="`ct-turno-${p.ordem.id}-${tu.turno}`"
            >
              {{
                t('enfermagem.contencao.turnoResumo', {
                  turno: t(`enfermagem.contencao.turnoNome.${tu.turno}`),
                  inicio: horaCurta(tu.inicio),
                  fim: horaCurta(tu.fim),
                  feitas: tu.feitas,
                  previstas: tu.previstas,
                  atrasadas: tu.atrasadas,
                })
              }}
            </li>
          </ul>
          <div class="acoes">
            <SanteBotao
              :rotulo="t('enfermagem.contencao.renovar')"
              :desabilitado="!pode?.prescrever"
              :data-testid="`ct-renovar-${p.atendimento}`"
              @acionar="abrirOrdem(p, p.ordem)"
            />
            <SanteBotao
              variante="secundario"
              :rotulo="t('enfermagem.contencao.retirar')"
              :desabilitado="!pode?.prescrever"
              :data-testid="`ct-retirar-${p.atendimento}`"
              @acionar="abrirRetirar(p.ordem)"
            />
            <SanteBotao
              variante="secundario"
              :rotulo="t('enfermagem.contencao.inativar')"
              :desabilitado="!pode?.prescrever"
              :data-testid="`ct-inativar-${p.atendimento}`"
              @acionar="abrirInativar(p.ordem)"
            />
            <SanteBotao
              variante="secundario"
              :rotulo="t('enfermagem.contencao.historico')"
              :data-testid="`ct-historico-${p.atendimento}`"
              @acionar="historicoDe = p.atendimento"
            />
          </div>
        </template>
        <div v-else class="acoes">
          <SanteBotao
            :rotulo="t('enfermagem.contencao.prescrever')"
            :desabilitado="!pode?.prescrever"
            :data-testid="`ct-prescrever-${p.atendimento}`"
            @acionar="abrirOrdem(p, null)"
          />
          <SanteBotao
            variante="secundario"
            :rotulo="t('enfermagem.contencao.historico')"
            :data-testid="`ct-historico-${p.atendimento}`"
            @acionar="historicoDe = p.atendimento"
          />
        </div>
      </li>
    </ul>

    <section v-if="historicoDe" class="cartao" data-testid="ct-historico" :aria-labelledby="`${uid}-hist`">
      <h2 :id="`${uid}-hist`">{{ t('enfermagem.contencao.historico') }}</h2>
      <ErroEnfermagem v-if="historico.isError.value" :erro="historico.error.value" />
      <p v-else-if="!historico.data.value" role="status">{{ t('enfermagem.comum.carregando') }}</p>
      <p v-else-if="historico.data.value.ordens.length === 0">{{ t('enfermagem.comum.nenhum') }}</p>
      <table v-else class="grade">
        <thead>
          <tr>
            <th scope="col">{{ t('enfermagem.contencao.campos.motivo') }}</th>
            <th scope="col">{{ t('enfermagem.contencao.campos.membros') }}</th>
            <th scope="col">{{ t('enfermagem.comum.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="o in historico.data.value.ordens"
            :key="o.id"
            :class="{ inativo: o.inativa }"
            :data-testid="`ct-hist-${o.id}`"
            :data-situacao="o.situacao"
            :data-inativo="o.inativa ? 'sim' : 'nao'"
          >
            <td>
              <span :class="{ tachado: o.inativa }"
                >{{ hora(o.inicio) }} · {{ ROTULOS_MOTIVO_CONTENCAO[o.motivo] }}</span
              >
              <br />
              <small>{{ o.justificativa }}</small>
            </td>
            <td>{{ membros(o.membros) }}</td>
            <td>
              {{ t(`enfermagem.contencao.situacoes.${o.situacao}`) }}
              <template v-if="o.renovadaPor">
                · {{ t('enfermagem.contencao.renovadaPor', { id: o.renovadaPor }) }}</template
              >
              <template v-if="o.encerramento">
                ·
                <span :data-testid="`ct-hist-encerramento-${o.id}`">{{
                  t('enfermagem.contencao.encerrada', {
                    tipo: t(`enfermagem.contencao.tiposEncerramento.${o.encerramento.tipo}`),
                    por: o.encerramento.usuario,
                    quando: hora(o.encerramento.em),
                    motivo: o.encerramento.motivo,
                  })
                }}</span>
              </template>
              <br />
              <small>
                {{
                  o.horarios
                    .map((h) => `${horaCurta(h.previsto)} ${t(`enfermagem.contencao.estados.${h.estado}`)}`)
                    .join(' · ')
                }}
              </small>
              <template v-for="h in o.horarios" :key="`ad-${h.previsto}`">
                <small
                  v-for="(d, i) in h.checagem?.adendos ?? []"
                  :key="`${h.previsto}-${i}`"
                  class="adendo"
                  :data-testid="`ct-hist-adendo-${o.id}-${horaCurta(h.previsto).replace(':', '')}`"
                >
                  <br />{{
                    t('enfermagem.contencao.adendoLido', {
                      hora: horaCurta(h.previsto),
                      por: d.usuario,
                      quando: hora(d.em),
                      motivo: d.motivo,
                      achado: d.alterado
                        ? t('enfermagem.contencao.alterado')
                        : t('enfermagem.contencao.normal'),
                      original: h.checagem?.alterado
                        ? t('enfermagem.contencao.alterado')
                        : t('enfermagem.contencao.normal'),
                    })
                  }}
                </small>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
      <SanteBotao
        variante="secundario"
        :rotulo="t('enfermagem.contencao.fecharHistorico')"
        @acionar="historicoDe = null"
      />
    </section>

    <section class="cartao" :aria-labelledby="`${uid}-ind`" data-testid="ct-indicador">
      <h2 :id="`${uid}-ind`">{{ t('enfermagem.contencao.indicador.titulo') }}</h2>
      <form class="barra" @submit.prevent="calcular">
        <span class="campo">
          <label :for="`${uid}-de`">{{ t('enfermagem.contencao.indicador.de') }}</label>
          <input :id="`${uid}-de`" v-model="de" type="date" data-testid="ct-ind-de" />
        </span>
        <span class="campo">
          <label :for="`${uid}-ate`">{{ t('enfermagem.contencao.indicador.ate') }}</label>
          <input :id="`${uid}-ate`" v-model="ate" type="date" data-testid="ct-ind-ate" />
        </span>
        <SanteBotao
          tipo="submit"
          :rotulo="t('enfermagem.contencao.indicador.calcular')"
          data-testid="ct-ind-calcular"
        />
      </form>
      <ErroEnfermagem v-if="erroIndicador" :erro="erroIndicador" />
      <dl v-if="indicador" class="indicador" data-testid="ct-ind-resultado">
        <dt>{{ t('enfermagem.contencao.indicador.contencoes') }}</dt>
        <dd>
          {{ indicador.contencoes.por1000 ?? t('enfermagem.contencao.indicador.semDenominador') }}
          ({{ t('enfermagem.contencao.indicador.formulaMil', indicador.contencoes) }})
        </dd>
        <dt>{{ t('enfermagem.contencao.indicador.checagens') }}</dt>
        <dd>
          {{
            indicador.checagensNoPrazo.percentual === null
              ? t('enfermagem.contencao.indicador.semDenominador')
              : `${indicador.checagensNoPrazo.percentual}%`
          }}
          ({{ t('enfermagem.contencao.indicador.formula', indicador.checagensNoPrazo) }})
        </dd>
        <dt>{{ t('enfermagem.contencao.indicador.horas') }}</dt>
        <dd>{{ indicador.horasContidas }}</dd>
        <dt>{{ t('enfermagem.contencao.indicador.vencidas') }}</dt>
        <dd data-testid="ct-ind-vencidas">
          {{
            indicador.vencidasSemRenovacao.percentual === null
              ? t('enfermagem.contencao.indicador.semDenominador')
              : `${indicador.vencidasSemRenovacao.percentual}%`
          }}
          ({{ t('enfermagem.contencao.indicador.formulaVencidas', indicador.vencidasSemRenovacao) }})
        </dd>
      </dl>
      <p v-if="indicador" class="discreto" data-testid="ct-ind-impressao">
        {{ indicador.impressao }}
        {{ t('enfermagem.contencao.indicador.dias', { n: indicador.diasFechados }) }}
      </p>
    </section>

    <SanteDialogo
      v-model:visivel="dialogoOrdem"
      :titulo="
        alvoOrdem?.anterior
          ? t('enfermagem.contencao.dialogoRenovar')
          : t('enfermagem.contencao.dialogoOrdem')
      "
    >
      <form class="form" data-testid="ct-dialogo-ordem" @submit.prevent="confirmarOrdem">
        <p v-if="alvoOrdem">
          <strong>{{ alvoOrdem.paciente.leito }} · {{ alvoOrdem.paciente.nome }}</strong>
        </p>
        <SanteSelecao
          v-model="motivo"
          :rotulo="t('enfermagem.contencao.campos.motivo')"
          :opcoes="opcoesMotivo"
          obrigatorio
          data-testid="ct-motivo"
        />
        <span class="campo">
          <label :for="`${uid}-just`">{{ t('enfermagem.contencao.campos.justificativa') }}</label>
          <textarea
            :id="`${uid}-just`"
            v-model="justificativa"
            maxlength="300"
            rows="3"
            required
            :aria-describedby="`${uid}-just-ajuda`"
            data-testid="ct-justificativa"
          ></textarea>
          <small :id="`${uid}-just-ajuda`">{{ t('enfermagem.contencao.campos.justificativaAjuda') }}</small>
        </span>
        <SanteOpcoes v-model="tipo" :legenda="t('enfermagem.contencao.campos.tipo')" :opcoes="opcoesTipo" />
        <fieldset class="membros">
          <legend>{{ t('enfermagem.contencao.campos.membros') }}</legend>
          <label v-for="m in MEMBROS_CONTENCAO" :key="m">
            <input v-model="membrosEscolhidos" type="checkbox" :value="m" :data-testid="`ct-membro-${m}`" />
            {{ ROTULOS_MEMBRO_CONTENCAO[m] }}
          </label>
        </fieldset>
        <span class="campo">
          <label :for="`${uid}-prazo`">{{ t('enfermagem.contencao.campos.prazo') }}</label>
          <input
            :id="`${uid}-prazo`"
            v-model.number="prazo"
            type="number"
            min="1"
            :max="dados?.parametros.prazoMaximoHoras ?? 24"
            :aria-describedby="`${uid}-prazo-ajuda`"
            data-testid="ct-prazo"
          />
          <small :id="`${uid}-prazo-ajuda`">{{
            t('enfermagem.contencao.campos.prazoAjuda', { max: dados?.parametros.prazoMaximoHoras ?? 24 })
          }}</small>
        </span>
        <span class="campo">
          <label :for="`${uid}-int`">{{ t('enfermagem.contencao.campos.intervalo') }}</label>
          <input
            :id="`${uid}-int`"
            v-model.number="intervalo"
            type="number"
            min="15"
            max="120"
            step="15"
            :aria-describedby="`${uid}-int-ajuda`"
            data-testid="ct-intervalo"
          />
          <small :id="`${uid}-int-ajuda`">{{
            t('enfermagem.contencao.campos.intervaloAjuda', {
              padrao: dados?.parametros.intervaloPadraoMinutos ?? 60,
            })
          }}</small>
        </span>
        <ErroEnfermagem v-if="erroOrdem" :erro="erroOrdem" />
        <div class="acoes">
          <SanteBotao
            tipo="submit"
            :rotulo="
              alvoOrdem?.anterior
                ? t('enfermagem.contencao.confirmarRenovar')
                : t('enfermagem.contencao.confirmarOrdem')
            "
            :desabilitado="!ordemValida"
            data-testid="ct-ordem-confirmar"
          />
          <SanteBotao
            variante="secundario"
            :rotulo="t('enfermagem.correcao.cancelar')"
            @acionar="dialogoOrdem = false"
          />
        </div>
      </form>
    </SanteDialogo>

    <SanteDialogo
      v-model:visivel="dialogoChecar"
      :titulo="
        t('enfermagem.contencao.dialogoChecar', { hora: alvoChecar ? horaCurta(alvoChecar.previsto) : '' })
      "
    >
      <form class="form" data-testid="ct-dialogo-checar" @submit.prevent="confirmarChecar">
        <SanteOpcoes
          v-for="k in ACHADOS_CHECAGEM_CONTENCAO"
          :key="k"
          v-model="achados[k]"
          :legenda="ROTULOS_ACHADO_CONTENCAO[k]"
          :opcoes="opcoesAchado"
          :nome="`${uid}-achado-${k}`"
          :data-testid="`ct-achado-${k}`"
        />
        <span class="campo">
          <label :for="`${uid}-obs`">{{ t('enfermagem.contencao.observacao') }}</label>
          <textarea
            :id="`${uid}-obs`"
            v-model="observacao"
            maxlength="300"
            rows="2"
            data-testid="ct-observacao"
          ></textarea>
        </span>
        <ErroEnfermagem v-if="erroChecar" :erro="erroChecar" />
        <div class="acoes">
          <SanteBotao
            tipo="submit"
            :rotulo="t('enfermagem.contencao.confirmarChecar')"
            :desabilitado="!checagemValida"
            data-testid="ct-checar-confirmar"
          />
          <SanteBotao
            variante="secundario"
            :rotulo="t('enfermagem.correcao.cancelar')"
            @acionar="dialogoChecar = false"
          />
        </div>
      </form>
    </SanteDialogo>

    <SanteDialogo
      v-model:visivel="dialogoAdendo"
      :titulo="
        t('enfermagem.contencao.dialogoAdendo', { hora: alvoAdendo ? horaCurta(alvoAdendo.previsto) : '' })
      "
    >
      <form class="form" data-testid="ct-dialogo-adendo" @submit.prevent="confirmarAdendo">
        <p class="discreto">{{ t('enfermagem.contencao.textoAdendo') }}</p>
        <SanteOpcoes
          v-for="k in ACHADOS_CHECAGEM_CONTENCAO"
          :key="k"
          v-model="achados[k]"
          :legenda="ROTULOS_ACHADO_CONTENCAO[k]"
          :opcoes="opcoesAchado"
          :nome="`${uid}-adendo-${k}`"
          :data-testid="`ct-adendo-achado-${k}`"
        />
        <span class="campo">
          <label :for="`${uid}-obs-ad`">{{ t('enfermagem.contencao.observacao') }}</label>
          <textarea
            :id="`${uid}-obs-ad`"
            v-model="observacao"
            maxlength="300"
            rows="2"
            data-testid="ct-adendo-observacao"
          ></textarea>
        </span>
        <span class="campo">
          <label :for="`${uid}-mot-ad`">{{ t('enfermagem.contencao.motivoAdendo') }}</label>
          <textarea
            :id="`${uid}-mot-ad`"
            v-model="motivoAdendo"
            maxlength="300"
            rows="2"
            required
            data-testid="ct-adendo-motivo"
          ></textarea>
        </span>
        <ErroEnfermagem v-if="erroAdendo" :erro="erroAdendo" />
        <div class="acoes">
          <SanteBotao
            tipo="submit"
            :rotulo="t('enfermagem.contencao.confirmarAdendo')"
            :desabilitado="!checagemValida || motivoAdendo.trim().length < 10"
            data-testid="ct-adendo-confirmar"
          />
          <SanteBotao
            variante="secundario"
            :rotulo="t('enfermagem.correcao.cancelar')"
            @acionar="dialogoAdendo = false"
          />
        </div>
      </form>
    </SanteDialogo>

    <DialogoCorrecao
      v-model:visivel="dialogoRetirar"
      :titulo="t('enfermagem.contencao.dialogoRetirar')"
      :texto="t('enfermagem.contencao.textoRetirar')"
      :rotulo-confirmar="t('enfermagem.contencao.retirar')"
      testid="ct-dialogo-retirar"
      :executar="retirar"
    />
    <DialogoCorrecao
      v-model:visivel="dialogoInativar"
      :titulo="t('enfermagem.contencao.dialogoInativar')"
      :texto="t('enfermagem.contencao.textoInativar')"
      :rotulo-confirmar="t('enfermagem.contencao.inativar')"
      com-senha
      testid="ct-dialogo-inativar"
      :executar="inativar"
    />
  </section>
</template>

<style src="./estilo-enfermagem.css"></style>
<style scoped>
.base,
.discreto {
  color: var(--sgh-texto-secundario);
}
.cartoes {
  list-style: none;
  padding: 0;
  display: grid;
  gap: var(--sgh-espaco-2);
}
.cab {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: center;
}
.selo {
  border: 1px solid var(--sgh-borda-forte);
  padding: 0 var(--sgh-espaco-1);
}
.selo.vencida {
  border-color: var(--sgh-alerta);
  font-weight: 700;
}
.turnos {
  margin: var(--sgh-espaco-1) 0 0;
  padding-left: var(--sgh-espaco-2);
}
.horarios {
  list-style: none;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-1);
}
.horario {
  display: flex;
  gap: var(--sgh-espaco-1);
  align-items: center;
  border: 1px solid var(--sgh-borda-forte);
  padding: var(--sgh-espaco-1);
}
.horario.atrasada {
  font-weight: 700;
}
.horario.cancelada {
  text-decoration: line-through;
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
.membros {
  display: grid;
  gap: var(--sgh-espaco-1);
}
.tachado {
  text-decoration: line-through;
}
.indicador {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--sgh-espaco-1) var(--sgh-espaco-2);
}
textarea {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
</style>
