<script setup lang="ts">
// Farmacovigilância no paciente (03-PEP L103) e lista de uso contínuo (03-PEP L104), numa tela só por paciente:
// registrar a reação escolhendo o item prescrito (ou o nome do medicamento de fora), a gravidade e a manifestação;
// cada reação com a situação, o histórico e os passos que ela aceita (avaliar, notificar, encerrar, reabrir,
// inativar, evoluir). A regra (avaliação antes de encerrar, grave só encerra notificada) é do servidor; a tela
// mostra a recusa como veio. A lista de uso contínuo atravessa os atendimentos: incluir e suspender com justificativa.
// Cada um vê só os passos que pode dar: a avaliação (causalidade) é da farmácia clínica (pep.farmacovigilancia.avaliar);
// registrar e os demais passos, de quem registra no prontuário (pep.evolucao.criar).
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import {
  gravarReacao,
  gravarUsoContinuo,
  lerFarmacovigilancia,
  type ReacaoTela,
  type UsoContinuoTela,
} from '../api-farmacovigilancia.js';
import { dataHoraBr } from '../formato.js';

const props = defineProps<{ paciente: string }>();
const { t } = useI18n();
const cliente = useQueryClient();
const id = computed(() => Number(props.paciente));
const chave = computed(() => ['pep', 'farmacovigilancia', id.value]);
const dados = useQuery({ queryKey: chave, queryFn: () => lerFarmacovigilancia(id.value), staleTime: 0 });
const d = computed(() => dados.data.value);
const erro = ref<unknown>(null);
const ok = ref('');

const SEM_ITEM = 'externo';
const nova = reactive({ item: SEM_ITEM, nome: '', descricao: '', inicio: '', gravidade: '' });
const opcoesItem = computed(() => [
  { valor: SEM_ITEM, rotulo: t('pep.farmaco.semItem') },
  ...(d.value?.itensPrescritos ?? []).map((i) => ({ valor: String(i.id), rotulo: i.descricao })),
]);
const opcoesGravidade = computed(() =>
  (d.value?.gravidades ?? []).map((g) => ({ valor: String(g.id), rotulo: g.descricao })),
);
const opcoesCausalidade = computed(() =>
  (d.value?.causalidades ?? []).map((c) => ({ valor: String(c.id), rotulo: c.descricao })),
);
const DESFECHOS = [
  'recuperado',
  'recuperado_com_sequela',
  'em_recuperacao',
  'nao_recuperado',
  'obito',
  'desconhecido',
] as const;
const opcoesDesfecho = computed(() =>
  DESFECHOS.map((x) => ({ valor: x, rotulo: t(`pep.farmaco.desfechos.${x}`) })),
);
const FONTES = [
  'paciente',
  'familiar',
  'receita',
  'prontuario_anterior',
  'farmacia',
  'outro_servico',
  'outro',
] as const;
const opcoesFonte = computed(() => FONTES.map((x) => ({ valor: x, rotulo: t(`pep.farmaco.fontes.${x}`) })));

async function gravar(f: () => Promise<unknown>): Promise<void> {
  erro.value = null;
  ok.value = '';
  try {
    await f();
    ok.value = t('pep.farmaco.gravada');
    await cliente.invalidateQueries({ queryKey: chave.value });
  } catch (e) {
    erro.value = e;
  }
}

const registrar = () =>
  gravar(async () => {
    await gravarReacao({
      acao: 'registrar',
      paciente: id.value,
      ...(nova.item === SEM_ITEM
        ? { medicamentoDescricao: nova.nome }
        : { prescricaoItem: Number(nova.item) }),
      descricao: nova.descricao,
      inicio: new Date(nova.inicio || Date.now()).toISOString(),
      gravidade: Number(nova.gravidade),
    });
    Object.assign(nova, { item: SEM_ITEM, nome: '', descricao: '', inicio: '' });
  });

/** Campos do passo, um por reação (causalidade, desfecho, justificativa ou o que mudou). */
const passo = reactive<Record<number, { causalidade: string; desfecho: string; texto: string }>>({});
const campos = (r: ReacaoTela) => (passo[r.id] ??= { causalidade: '', desfecho: '', texto: '' });
const ACOES: Readonly<Record<string, readonly string[]>> = {
  registrada: ['avaliar', 'notificar', 'inativar', 'evoluir'],
  em_avaliacao: ['avaliar', 'notificar', 'inativar', 'evoluir'],
  avaliada: ['avaliar', 'notificar', 'encerrar', 'evoluir'],
  notificada: ['encerrar', 'evoluir'],
  encerrada: ['reabrir'],
  inativa: [],
};
const podeAvaliar = computed(() => pode('pep.farmacovigilancia.avaliar'));
const podeRegistrar = computed(() => pode('pep.evolucao.criar'));
const podeLista = computed(() => pode('pep.reconciliacao.registrar'));
/** Os passos que a reação aceita e que esta pessoa pode dar. */
const acoesDe = (r: ReacaoTela): readonly string[] =>
  (ACOES[r.situacao] ?? []).filter((a) => (a === 'avaliar' ? podeAvaliar.value : podeRegistrar.value));
function executar(r: ReacaoTela, acao: string): Promise<void> {
  const c = campos(r);
  const texto = c.texto.trim() || null;
  return gravar(() =>
    gravarReacao({
      acao,
      reacao: r.id,
      versao: r.versao,
      ...(acao === 'avaliar' ? { causalidade: c.causalidade ? Number(c.causalidade) : null } : {}),
      ...(acao === 'encerrar' ? { desfecho: c.desfecho || null } : {}),
      ...(acao === 'reabrir' || acao === 'inativar' ? { justificativa: texto } : {}),
      ...(acao === 'notificar' || acao === 'evoluir' ? { observacao: texto } : {}),
    }),
  );
}

const uso = reactive({ nome: '', posologia: '', fonte: 'paciente' });
const incluirUso = () =>
  gravar(async () => {
    await gravarUsoContinuo({
      acao: 'incluir',
      paciente: id.value,
      descricaoLivre: uso.nome,
      posologia: uso.posologia || null,
      fonte: uso.fonte,
    });
    Object.assign(uso, { nome: '', posologia: '' });
  });
const motivoSuspensao = reactive<Record<number, string>>({});
const suspender = (u: UsoContinuoTela) =>
  gravar(() =>
    gravarUsoContinuo({
      acao: 'suspender',
      uso: u.id,
      versao: u.versao,
      justificativa: motivoSuspensao[u.id] ?? '',
    }),
  );
</script>

<template>
  <section class="farmaco" data-testid="farmaco-tela">
    <h1>{{ t('pep.farmaco.titulo') }}</h1>
    <MensagemErro v-if="dados.error.value" :erro="dados.error.value" />
    <MensagemErro v-if="erro" :erro="erro" />
    <SanteAlerta v-if="ok" variante="info" :texto="ok" anunciar data-testid="farmaco-ok" />
    <p v-if="!d">{{ t('pep.carregando') }}</p>
    <template v-else>
      <h2>{{ t('pep.farmaco.reacoes') }}</h2>
      <form v-if="podeRegistrar" class="farmaco__nova" data-testid="farmaco-nova" @submit.prevent="registrar">
        <SanteSelecao
          v-model="nova.item"
          :rotulo="t('pep.farmaco.itemPrescrito')"
          :opcoes="opcoesItem"
          data-testid="farmaco-item"
        />
        <label v-if="nova.item === SEM_ITEM">
          {{ t('pep.farmaco.medicamentoNome') }}
          <input v-model="nova.nome" maxlength="200" data-testid="farmaco-nome" />
        </label>
        <label>
          {{ t('pep.farmaco.manifestacao') }}
          <textarea v-model="nova.descricao" maxlength="4000" required data-testid="farmaco-descricao" />
        </label>
        <label>
          {{ t('pep.farmaco.inicio') }}
          <input v-model="nova.inicio" type="datetime-local" data-testid="farmaco-inicio" />
        </label>
        <SanteSelecao
          v-model="nova.gravidade"
          :rotulo="t('pep.farmaco.gravidade')"
          :opcoes="opcoesGravidade"
          data-testid="farmaco-gravidade"
        />
        <SanteBotao tipo="submit" data-testid="farmaco-registrar" :rotulo="t('pep.farmaco.registrar')" />
      </form>
      <p v-if="d.reacoes.length === 0">{{ t('pep.farmaco.nenhumaReacao') }}</p>
      <article
        v-for="r in d.reacoes"
        :key="r.id"
        class="farmaco__reacao"
        :data-testid="`farmaco-reacao-${r.id}`"
      >
        <h3>{{ r.medicamento }} · {{ r.gravidade.descricao }}</h3>
        <p>{{ r.descricao }}</p>
        <p>
          <strong>{{ t(`pep.farmaco.situacao.${r.situacao}`) }}</strong>
          <span v-if="r.exigeNotificacao && !r.notificadaEm"> · {{ t('pep.farmaco.grave') }}</span>
          <span v-if="r.notificadaEm">
            · {{ t('pep.farmaco.notificadaEm', { quando: dataHoraBr(r.notificadaEm) }) }}</span
          >
        </p>
        <p>{{ t('pep.farmaco.historico', { etapas: r.eventos.map((e) => e.etapa).join(' → ') }) }}</p>
        <div v-if="acoesDe(r).length" class="farmaco__passo">
          <SanteSelecao
            v-if="acoesDe(r).includes('avaliar')"
            v-model="campos(r).causalidade"
            :rotulo="t('pep.farmaco.causalidade')"
            :opcoes="opcoesCausalidade"
            :data-testid="`farmaco-causalidade-${r.id}`"
          />
          <SanteSelecao
            v-if="acoesDe(r).includes('encerrar')"
            v-model="campos(r).desfecho"
            :rotulo="t('pep.farmaco.desfecho')"
            :opcoes="opcoesDesfecho"
            :data-testid="`farmaco-desfecho-${r.id}`"
          />
          <label>
            {{ t('pep.farmaco.justificativa') }}
            <input v-model="campos(r).texto" maxlength="1000" :data-testid="`farmaco-texto-${r.id}`" />
          </label>
          <SanteBotao
            v-for="a in acoesDe(r)"
            :key="a"
            variante="secundario"
            :data-testid="`farmaco-${a}-${r.id}`"
            @acionar="executar(r, a)"
            :rotulo="t(`pep.farmaco.${a}`)"
          />
        </div>
      </article>

      <h2>{{ t('pep.farmaco.usoContinuo') }}</h2>
      <form
        v-if="podeLista"
        class="farmaco__nova"
        data-testid="farmaco-uso-novo"
        @submit.prevent="incluirUso"
      >
        <label>
          {{ t('pep.farmaco.medicamentoNome') }}
          <input v-model="uso.nome" maxlength="200" required data-testid="farmaco-uso-nome" />
        </label>
        <label>
          {{ t('pep.farmaco.posologia') }}
          <input v-model="uso.posologia" maxlength="500" />
        </label>
        <SanteSelecao v-model="uso.fonte" :rotulo="t('pep.farmaco.fonte')" :opcoes="opcoesFonte" />
        <SanteBotao tipo="submit" data-testid="farmaco-uso-incluir" :rotulo="t('pep.farmaco.incluirUso')" />
      </form>
      <p v-if="d.usoContinuo.length === 0">{{ t('pep.farmaco.nenhumUso') }}</p>
      <ul>
        <li v-for="u in d.usoContinuo" :key="u.id" :data-testid="`farmaco-uso-${u.id}`">
          {{ u.medicamento }}<span v-if="u.posologia"> · {{ u.posologia }}</span>
          <span v-if="u.suspenso">
            · {{ t('pep.farmaco.suspenso', { motivo: u.justificativaSuspensao ?? '' }) }}</span
          >
          <template v-else-if="podeLista">
            <input
              v-model="motivoSuspensao[u.id]"
              maxlength="250"
              :aria-label="t('pep.farmaco.justificativa')"
            />
            <SanteBotao variante="secundario" @acionar="suspender(u)" :rotulo="t('pep.farmaco.suspender')" />
          </template>
        </li>
      </ul>
    </template>
  </section>
</template>

<style scoped>
.farmaco__nova,
.farmaco__passo {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-3);
  align-items: end;
}
.farmaco__reacao {
  border-top: 1px solid var(--sgh-borda);
  padding-block: var(--sgh-espaco-3);
}
</style>
