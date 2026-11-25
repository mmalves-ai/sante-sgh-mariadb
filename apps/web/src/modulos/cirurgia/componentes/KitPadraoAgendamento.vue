<script setup lang="ts">
// O kit padrão no agendamento cirúrgico (F3.6, 05-SUP linha 13): ao abrir a cirurgia marcada, o kit padrão de cada
// procedimento já vem sugerido e marcado (o que ainda não está na lista); um clique leva os escolhidos à lista de
// materiais previstos, que o almoxarifado e o bloco enxergam antes do dia. A linha retirada sai da lista, mas fica
// guardada com a marca de exclusão. Fechada a lista (cirurgia começou, terminou ou foi cancelada), só a leitura.
import { kitJaNaLista } from '@sgh/dominio-cirurgia';
import { SanteBotao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import {
  aplicarKitAgendamento,
  type KitSugeridoAgendamento,
  lerKitAgendamento,
  retirarMaterialAgendamento,
} from '../api-kit-agendamento.js';
import ErroCirurgia from './ErroCirurgia.vue';

const props = defineProps<{ agendamento: number }>();
const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      titulo: 'Materiais previstos e kit padrão',
      sugeridos: 'Kit padrão dos procedimentos',
      nenhumSugerido: 'Nenhum procedimento desta cirurgia tem kit padrão cadastrado.',
      kit: '{codigo} · {nome} ({kits} kit(s))',
      principal: 'principal',
      jaNaLista: 'já na lista',
      incluir: 'Incluir os kits marcados na lista',
      nenhumMarcado: 'Marque ao menos um kit para incluir.',
      incluidos: '{n} kit(s) incluído(s) na lista de materiais.',
      lista: 'Lista de materiais previstos',
      listaVazia: 'Nenhum material previsto ainda.',
      linha: '{seq}. {nome} · {qtd}',
      retirar: 'Retirar',
      retirado: 'Material retirado da lista (fica guardado no histórico).',
      fechada: 'A lista desta cirurgia está fechada: a cirurgia já começou, terminou ou foi cancelada.',
    },
  },
});

const cliente = useQueryClient();
const { permissoes } = usarSessao();
const podeEditar = computed(() => permissoes.value.has('cirurgia.agenda.agendar'));
const chaveConsulta = computed(() => ['cirurgia', 'kit-agendamento', props.agendamento]);
const consulta = useQuery({ queryKey: chaveConsulta, queryFn: () => lerKitAgendamento(props.agendamento) });
const dados = computed(() => consulta.data.value);
const chave = (s: KitSugeridoAgendamento) => `${s.procedimentoAgendamento}:${s.kit}`;
const marcados = ref<Record<string, boolean>>({});
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);

// Ao ler, marca de saída o que ainda não está na lista (a escolha mais comum vira zero clique).
watch(
  dados,
  (d) => {
    if (!d) return;
    marcados.value = Object.fromEntries(d.sugeridos.map((s) => [chave(s), !kitJaNaLista(s, d.materiais)]));
  },
  { immediate: true },
);

const escolhidos = computed(() =>
  (dados.value?.sugeridos ?? [])
    .filter((s) => !s.jaNaLista && marcados.value[chave(s)])
    .map((s) => ({ kit: s.kit, procedimentoAgendamento: s.procedimentoAgendamento })),
);
const podeIncluir = computed(
  () => Boolean(dados.value?.aberta) && podeEditar.value && escolhidos.value.length > 0 && !ocupado.value,
);
const qtd = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 4 });

async function recarregar(): Promise<void> {
  await cliente.invalidateQueries({ queryKey: chaveConsulta.value });
}

async function incluir(): Promise<void> {
  if (!podeIncluir.value) return;
  ocupado.value = true;
  erro.value = null;
  mensagem.value = null;
  try {
    const r = await aplicarKitAgendamento(props.agendamento, escolhidos.value);
    mensagem.value = t('incluidos', { n: r.incluidos });
    await recarregar();
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}

async function retirar(material: number, versao: number): Promise<void> {
  ocupado.value = true;
  erro.value = null;
  mensagem.value = null;
  try {
    await retirarMaterialAgendamento(props.agendamento, material, versao);
    mensagem.value = t('retirado');
    await recarregar();
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="painel" aria-labelledby="kit-agendamento-titulo" data-testid="kit-agendamento">
    <h2 id="kit-agendamento-titulo">{{ t('titulo') }}</h2>
    <ErroCirurgia v-if="consulta.isError.value" :erro="consulta.error.value" />
    <template v-else-if="dados">
      <p v-if="!dados.aberta" role="status" data-testid="kit-agendamento-fechada">{{ t('fechada') }}</p>
      <h3>{{ t('sugeridos') }}</h3>
      <p v-if="dados.sugeridos.length === 0" data-testid="kit-agendamento-sem-sugestao">
        {{ t('nenhumSugerido') }}
      </p>
      <ul v-else class="lista-kits">
        <li
          v-for="s in dados.sugeridos"
          :key="chave(s)"
          :data-testid="`kit-agendamento-sugerido-${s.codigo}`"
        >
          <label>
            <input
              v-model="marcados[chave(s)]"
              type="checkbox"
              :disabled="s.jaNaLista || !dados.aberta || !podeEditar"
              :data-testid="`kit-agendamento-marca-${s.codigo}`"
            />
            <strong>{{ s.procedimentoCodigo }} · {{ s.procedimentoNome }}</strong>
            <span v-if="s.principal"> ({{ t('principal') }})</span> —
            {{ t('kit', { codigo: s.codigo, nome: s.nome, kits: qtd(s.quantidadeKits) }) }}
            <span v-if="s.jaNaLista" class="secundario"> · {{ t('jaNaLista') }}</span>
          </label>
          <p class="secundario">
            {{ s.itens.map((i) => `${qtd(i.quantidade)} ${i.unidade} · ${i.nome}`).join('; ') }}
          </p>
        </li>
      </ul>
      <div v-if="dados.aberta && podeEditar && dados.sugeridos.length > 0" class="filtros">
        <SanteBotao
          :rotulo="t('incluir')"
          :desabilitado="!podeIncluir"
          data-testid="kit-agendamento-incluir"
          @acionar="incluir"
        />
        <span v-if="escolhidos.length === 0" class="secundario" data-testid="kit-agendamento-nenhum-marcado">
          {{ t('nenhumMarcado') }}
        </span>
      </div>
      <h3>{{ t('lista') }}</h3>
      <p v-if="dados.materiais.length === 0" data-testid="kit-agendamento-lista-vazia">
        {{ t('listaVazia') }}
      </p>
      <ul v-else data-testid="kit-agendamento-lista">
        <li v-for="x in dados.materiais" :key="x.id" :data-testid="`kit-agendamento-material-${x.sequencia}`">
          {{ t('linha', { seq: x.sequencia, nome: x.nome ?? '—', qtd: qtd(x.quantidade) }) }}
          <SanteBotao
            v-if="dados.aberta && podeEditar"
            variante="secundario"
            :rotulo="t('retirar')"
            :desabilitado="ocupado"
            :data-testid="`kit-agendamento-retirar-${x.sequencia}`"
            @acionar="retirar(x.id, x.versao)"
          />
        </li>
      </ul>
    </template>
    <p v-if="mensagem" role="status" data-testid="kit-agendamento-mensagem">{{ mensagem }}</p>
    <ErroCirurgia v-if="erro" :erro="erro" />
  </section>
</template>

<style scoped>
.lista-kits {
  list-style: none;
  padding: 0;
}
</style>
