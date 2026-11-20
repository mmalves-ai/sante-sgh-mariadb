<script setup lang="ts">
// Avaliação farmacêutica da prescrição (ficha do M29, seção 7; regras 7 e 8; DP-25): `/farmacia/avaliacao`. A fila
// priorizada (alto risco e antimicrobiano primeiro; os achados de alergia, duplicidade, via e dose), os 12 status do
// outro sistema agrupados em 5 situações, o prontuário ao lado (leitura auditada), o histórico de substituições e de
// intervenções, a decisão e a intervenção ao prescritor (só no novo até a DP-25). Tempo real pela vigia dos horários.
import type { ItemAvaliacao } from '@sgh/contratos';
import { GRUPOS_SITUACAO_FARMACIA, TIPOS_INTERVENCAO } from '@sgh/contratos/regras-suprimentos';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import {
  CANAL_AVALIACAO,
  decidir,
  intervir,
  lerAvaliacao,
  lerHistorico,
  lerUnidadesAvaliacao,
  novaChave,
  triar,
} from '../api-farmacia.js';
import AvisoFarmacia from '../componentes/AvisoFarmacia.vue';
import ErroFarmacia from '../componentes/ErroFarmacia.vue';
import { horario, qtd, usarAvisosFarmacia, usarFarmacia } from '../usar-farmacia.js';

const { t } = useI18n();
const { pode, motivoFuncionalidade } = usarFarmacia();
const unidades = useQuery({
  queryKey: ['farmacia', 'unidades-avaliacao'],
  queryFn: () => lerUnidadesAvaliacao(),
});
const unidade = ref('');
watch(
  () => unidades.data.value,
  (u) => {
    if (!unidade.value && u?.[0]) unidade.value = u[0].unidade;
  },
  { immediate: true },
);
const opcoesUnidade = computed(() => [
  { valor: '', rotulo: t('farmacia.escolha') },
  ...(unidades.data.value ?? []).map((u) => ({ valor: u.unidade, rotulo: u.nome })),
]);
const fila = useQuery({
  queryKey: computed(() => ['farmacia', 'avaliacao', unidade.value]),
  queryFn: () => lerAvaliacao(unidade.value),
  enabled: computed(() => !!unidade.value),
});
usarAvisosFarmacia(CANAL_AVALIACAO, () => void fila.refetch());
const grupo = ref('');
const opcoesGrupo = computed(() => [
  { valor: '', rotulo: t('farmacia.escolha') },
  ...GRUPOS_SITUACAO_FARMACIA.map((g) => ({
    valor: g.id,
    rotulo: `${t(`farmacia.avaliacao.grupos.${g.id}`)} (${fila.data.value?.resumo[g.id] ?? 0})`,
  })),
]);
const itens = computed(() =>
  (fila.data.value?.itens ?? []).filter((i) => !grupo.value || i.grupo === grupo.value),
);
const aberto = ref<ItemAvaliacao | null>(null);
const historico = useQuery({
  queryKey: computed(() => ['farmacia', 'historico', aberto.value?.item ?? 0]),
  queryFn: () => lerHistorico(aberto.value!.item, aberto.value?.horario ? [aberto.value.horario] : []),
  enabled: computed(() => !!aberto.value),
});
const decisao = ref('valido');
const justificativa = ref('');
const tipo = ref('ajuste-dose');
const texto = ref('');
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const opcoesDecisao = computed(() =>
  (['valido', 'nao-aprovado', 'pendencia-revisao-medica'] as const).map((d) => ({
    valor: d,
    rotulo: t(`farmacia.avaliacao.decisoes.${d}`),
  })),
);
const opcoesTipo = computed(() =>
  TIPOS_INTERVENCAO.map((x) => ({ valor: x.id, rotulo: t(`farmacia.avaliacao.tipos.${x.id}`) })),
);
async function aplicarTriagem(): Promise<void> {
  erro.value = null;
  try {
    mensagem.value = (await triar(unidade.value, novaChave('triagem'))).mensagem;
    await fila.refetch();
  } catch (x) {
    erro.value = x;
  }
}
async function registrarDecisao(): Promise<void> {
  if (!aberto.value) return;
  erro.value = null;
  try {
    mensagem.value = (
      await decidir(
        aberto.value.item,
        { decisao: decisao.value, justificativa: justificativa.value, unidade: unidade.value },
        novaChave('decisao'),
      )
    ).mensagem;
    await fila.refetch();
  } catch (x) {
    erro.value = x;
  }
}
async function registrarIntervencao(): Promise<void> {
  if (!aberto.value) return;
  erro.value = null;
  try {
    mensagem.value = (
      await intervir(aberto.value.item, { tipo: tipo.value, texto: texto.value }, novaChave('intervencao'))
    ).mensagem;
    texto.value = '';
    await historico.refetch();
  } catch (x) {
    erro.value = x;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="aval-titulo" data-testid="tela-farmacia-avaliacao">
    <h1 id="aval-titulo">{{ t('farmacia.avaliacao.titulo') }}</h1>
    <p>{{ t('farmacia.avaliacao.texto') }}</p>
    <p class="atalhos">
      <RouterLink to="/farmacia/avaliacao/tipos">{{ t('farmacia.avaliacao.tiposEnvio') }}</RouterLink>
    </p>
    <AvisoFarmacia :motivo="motivoFuncionalidade('avaliacao')" />
    <div class="filtros">
      <SanteSelecao v-model="unidade" :rotulo="t('farmacia.unidade')" :opcoes="opcoesUnidade" />
      <SanteSelecao v-model="grupo" :rotulo="t('farmacia.situacao')" :opcoes="opcoesGrupo" />
      <SanteBotao
        v-if="(fila.data.value?.novos ?? 0) > 0"
        variante="secundario"
        :rotulo="t('farmacia.avaliacao.triar', { n: fila.data.value?.novos ?? 0 })"
        :desabilitado="!pode('decidir')"
        data-testid="aval-triar"
        @acionar="aplicarTriagem"
      />
    </div>
    <ErroFarmacia v-if="erro" :erro="erro" />
    <p v-if="mensagem" role="status" data-testid="aval-mensagem">{{ mensagem }}</p>
    <p v-if="fila.isLoading.value">{{ t('farmacia.carregando') }}</p>
    <table v-else class="tabela" data-testid="aval-fila">
      <caption class="sgh-visualmente-oculto">
        {{
          t('farmacia.avaliacao.titulo')
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">{{ t('farmacia.avaliacao.prioridade') }}</th>
          <th scope="col">{{ t('farmacia.leito') }}</th>
          <th scope="col">{{ t('farmacia.item') }}</th>
          <th scope="col">{{ t('farmacia.avaliacao.achados') }}</th>
          <th scope="col">{{ t('farmacia.situacao') }}</th>
          <th scope="col">{{ t('farmacia.acoes') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="i in itens" :key="i.item" :data-testid="`aval-item-${i.item}`">
          <td>{{ i.prioridade }} · {{ t(`farmacia.avaliacao.destinos.${i.destino}`) }}</td>
          <td>{{ i.leito }} · {{ i.iniciais }}</td>
          <td>
            {{ i.descricao }} · {{ qtd(i.dose) }} {{ i.unidadeDose ?? '' }} · {{ i.via ?? '—' }}
            <span class="selo">{{ t(`farmacia.classes.${i.classe}`) }}</span>
          </td>
          <td>{{ i.achados.join(', ') || '—' }}</td>
          <td>
            {{ t(`farmacia.avaliacao.estados.${i.estado}`)
            }}<span v-if="i.decisao"> · {{ t(`farmacia.avaliacao.decisoes.${i.decisao}`) }}</span>
          </td>
          <td>
            <SanteBotao
              variante="secundario"
              :rotulo="t('farmacia.avaliacao.decidir')"
              :data-testid="`aval-abrir-${i.item}`"
              @acionar="aberto = i"
            />
          </td>
        </tr>
      </tbody>
    </table>
    <aside v-if="aberto" class="painel" aria-labelledby="aval-item" data-testid="aval-painel">
      <h2 id="aval-item">{{ aberto.descricao }} · {{ t('farmacia.leito') }} {{ aberto.leito }}</h2>
      <p>
        <!-- Em nova aba: o farmacêutico mantém a fila e o painel da decisão (a leitura do prontuário é a auditada). -->
        <RouterLink
          :to="`/pep/prontuario/${aberto.paciente}`"
          target="_blank"
          rel="noopener"
          data-testid="aval-prontuario"
          >{{ t('farmacia.avaliacao.prontuario') }}</RouterLink
        >
      </p>
      <h3>{{ t('farmacia.avaliacao.historico') }}</h3>
      <p>
        {{ t('farmacia.avaliacao.substituicoes') }}: {{ historico.data.value?.substituicoes.length ?? 0 }}
      </p>
      <ul>
        <li v-for="s in historico.data.value?.substituicoes ?? []" :key="s.id">
          {{ horario(s.em) }} · {{ s.descricao }} · {{ qtd(s.quantidade) }} {{ s.unidade }}
        </li>
      </ul>
      <p>{{ t('farmacia.avaliacao.intervencoes') }}</p>
      <ul data-testid="aval-intervencoes">
        <li v-for="x in historico.data.value?.intervencoes ?? []" :key="x.id">
          {{ horario(x.criadaEm) }} · {{ t(`farmacia.avaliacao.tipos.${x.tipo}`) }}: {{ x.texto }} —
          <template v-if="x.resposta">{{
            t('farmacia.avaliacao.respondida', { resposta: x.resposta, quem: x.respondente ?? '' })
          }}</template>
          <template v-else>{{ t('farmacia.avaliacao.aberta') }}</template>
        </li>
      </ul>
      <form class="filtros" @submit.prevent="registrarDecisao">
        <SanteSelecao v-model="decisao" :rotulo="t('farmacia.avaliacao.decidir')" :opcoes="opcoesDecisao" />
        <span class="campo">
          <label for="aval-just">{{ t('farmacia.justificativa') }}</label>
          <input id="aval-just" v-model="justificativa" maxlength="250" data-testid="aval-justificativa" />
        </span>
        <SanteBotao
          tipo="submit"
          :rotulo="t('farmacia.avaliacao.decidir')"
          :desabilitado="!pode('decidir')"
          data-testid="aval-decidir"
        />
      </form>
      <form class="filtros" @submit.prevent="registrarIntervencao">
        <SanteSelecao v-model="tipo" :rotulo="t('farmacia.avaliacao.tipoIntervencao')" :opcoes="opcoesTipo" />
        <span class="campo">
          <label for="aval-texto">{{ t('farmacia.avaliacao.textoIntervencao') }}</label>
          <textarea id="aval-texto" v-model="texto" maxlength="1000" data-testid="aval-texto"></textarea>
        </span>
        <SanteBotao
          tipo="submit"
          variante="secundario"
          :rotulo="t('farmacia.avaliacao.intervir')"
          :desabilitado="!pode('intervir')"
          data-testid="aval-intervir"
        />
      </form>
    </aside>
  </section>
</template>
