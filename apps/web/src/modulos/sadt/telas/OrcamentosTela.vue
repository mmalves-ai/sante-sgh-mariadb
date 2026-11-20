<script setup lang="ts">
// Orçamento de exames particular (ficha do M26, seção 7; regra 13): `/sadt/orcamentos`. Os orçamentos com a validade e
// a situação; o novo orçamento com os exames e os valores (o total com as parcelas); a conversão lança os mesmos exames
// e valores no atendimento escolhido (a requisição do setor aberta).
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  buscarProfissionaisSadt,
  converterOrcamento,
  criarOrcamento,
  listarOrcamentos,
  novaChave,
} from '../api-sadt.js';
import AvisoSadt from '../componentes/AvisoSadt.vue';
import ErroSadt from '../componentes/ErroSadt.vue';
import { usarSadt } from '../usar-sadt.js';

const { t } = useI18n();
const cliente = useQueryClient();
const termo = ref('');
const buscado = ref('');
const { gravacao, apoio, pode } = usarSadt(ref('laboratorio'));
const lista = useQuery({
  queryKey: computed(() => ['sadt', 'orcamentos', buscado.value]),
  queryFn: () => listarOrcamentos(buscado.value || null),
});
const motivoOrcamento = computed(() =>
  gravacao.data.value && !gravacao.data.value.orcamento.ligada ? gravacao.data.value.orcamento.motivo : null,
);
const podeCriar = computed(() => pode('orcamento', 'sadt.criarOrcamento'));
const podeConverter = computed(() => pode('orcamento', 'converter'));
const dinheiro = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const nome = ref('');
const convenio = ref('');
const itens = ref<{ exame: string; valor: string }[]>([{ exame: '', valor: '' }]);
const convenios = computed(() => [
  { valor: '', rotulo: t('sadt.escolha') },
  ...(apoio.data.value?.convenios ?? []).map((c) => ({ valor: String(c.codigo), rotulo: c.nome })),
]);
const exames = computed(() => [
  { valor: '', rotulo: t('sadt.escolha') },
  ...(apoio.data.value?.exames ?? [])
    .filter((e) => e.ato === 15)
    .map((e) => ({ valor: e.codigo, rotulo: e.nome })),
]);
const total = computed(() => itens.value.reduce((s, i) => s + (Number(i.valor.replace(',', '.')) || 0), 0));
const ocupado = ref(false);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
async function gravar(): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const r = await criarOrcamento(
      {
        nome: nome.value,
        convenio: Number(convenio.value),
        ato: 15,
        itens: itens.value
          .filter((i) => i.exame)
          .map((i) => ({ exame: i.exame, valor: Number(i.valor.replace(',', '.')) || 0 })),
      },
      novaChave('orcamento'),
    );
    mensagem.value = r.mensagem;
    nome.value = '';
    itens.value = [{ exame: '', valor: '' }];
    await cliente.invalidateQueries({ queryKey: ['sadt', 'orcamentos'] });
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
const atendimentoConversao = ref<Record<number, string>>({});
const termoExecutante = ref('');
const executantes = ref<{ id: number; nome: string }[]>([]);
const executante = ref('');
async function buscarExecutante(): Promise<void> {
  executantes.value = await buscarProfissionaisSadt(termoExecutante.value).catch(() => []);
  executante.value = executantes.value[0] ? String(executantes.value[0].id) : '';
}
const opcoesExecutantes = computed(() => [
  { valor: '', rotulo: t('sadt.escolha') },
  ...executantes.value.map((e) => ({ valor: String(e.id), rotulo: e.nome })),
]);
async function converter(id: number): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const prestador = apoio.data.value?.prestadores.find((p) => p.ato === 15);
    const r = await converterOrcamento(
      id,
      {
        atendimento: Number(atendimentoConversao.value[id]),
        executante: Number(executante.value || gravacao.data.value?.habilitacao.vinculo || 0),
        prestador: prestador?.id ?? 0,
        local: 1,
      },
      novaChave('converter'),
    );
    mensagem.value = r.mensagem;
    await cliente.invalidateQueries({ queryKey: ['sadt'] });
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="orc-titulo" data-testid="tela-sadt-orcamentos">
    <h1 id="orc-titulo">{{ t('sadt.orcamentos.titulo') }}</h1>
    <p>{{ t('sadt.orcamentos.texto') }}</p>
    <AvisoSadt :motivo="motivoOrcamento" />
    <div class="filtros">
      <span class="campo">
        <label for="orc-termo">{{ t('sadt.orcamentos.nome') }}</label>
        <input id="orc-termo" v-model="termo" type="search" @keyup.enter="buscado = termo" />
      </span>
      <SanteBotao variante="secundario" :rotulo="t('sadt.buscar')" @acionar="buscado = termo" />
    </div>
    <ErroSadt v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!lista.data.value" role="status">{{ t('sadt.carregando') }}</p>
    <p v-else-if="lista.data.value.itens.length === 0">{{ t('sadt.nenhum') }}</p>
    <div
      v-for="o in lista.data.value?.itens ?? []"
      :key="`${o.nome}-${o.ato}-${o.data}`"
      class="painel"
      :data-testid="`orcamento-${o.id}`"
    >
      <h2>{{ o.nome }} · {{ o.atoRotulo }}</h2>
      <p>
        {{ o.convenio.nome }} · {{ t('sadt.orcamentos.validade') }}
        {{ o.validade.split('-').reverse().join('/') }} ·
        <span :data-testid="`orcamento-situacao-${o.id}`">{{
          t(`sadt.orcamentos.situacoes.${o.situacao}`)
        }}</span>
      </p>
      <ul>
        <li v-for="i in o.itens" :key="i.exame">{{ i.nome }}: {{ dinheiro(i.valor) }}</li>
      </ul>
      <p>
        <strong>{{ t('sadt.orcamentos.total') }}: {{ dinheiro(o.total) }}</strong>
        <span class="secundario"> ({{ o.itens.map((i) => dinheiro(i.valor)).join(' + ') }})</span>
      </p>
      <div v-if="podeConverter && o.situacao === 'aberto' && o.id > 0" class="filtros">
        <span class="campo">
          <label :for="`orc-atd-${o.id}`">{{ t('sadt.orcamentos.atendimentoConversao') }}</label>
          <input
            :id="`orc-atd-${o.id}`"
            v-model="atendimentoConversao[o.id]"
            type="number"
            min="1"
            :data-testid="`orcamento-atendimento-${o.id}`"
          />
        </span>
        <span class="campo">
          <label :for="`orc-exe-${o.id}`">{{ t('sadt.executante') }}</label>
          <input
            :id="`orc-exe-${o.id}`"
            v-model="termoExecutante"
            type="search"
            :data-testid="`orcamento-executante-busca-${o.id}`"
            @keyup.enter="buscarExecutante"
          />
        </span>
        <SanteBotao
          variante="secundario"
          :rotulo="t('sadt.buscar')"
          :data-testid="`orcamento-executante-buscar-${o.id}`"
          @acionar="buscarExecutante"
        />
        <SanteSelecao
          v-if="executantes.length"
          v-model="executante"
          :rotulo="t('sadt.executante')"
          :opcoes="opcoesExecutantes"
        />
        <SanteBotao
          :rotulo="t('sadt.orcamentos.converter')"
          :desabilitado="ocupado || !atendimentoConversao[o.id] || !executante"
          :data-testid="`orcamento-converter-${o.id}`"
          @acionar="converter(o.id)"
        />
      </div>
    </div>
    <section v-if="podeCriar" class="painel" aria-labelledby="orc-novo-titulo">
      <h2 id="orc-novo-titulo">{{ t('sadt.orcamentos.novo') }}</h2>
      <div class="filtros">
        <span class="campo">
          <label for="orc-nome">{{ t('sadt.orcamentos.nome') }}</label>
          <input id="orc-nome" v-model="nome" maxlength="70" data-testid="orcamento-nome" />
        </span>
        <SanteSelecao
          v-model="convenio"
          :rotulo="t('sadt.convenio')"
          :opcoes="convenios"
          data-testid="orcamento-convenio"
        />
      </div>
      <div v-for="(i, k) in itens" :key="k" class="filtros">
        <SanteSelecao
          v-model="i.exame"
          :rotulo="t('sadt.orcamentos.item')"
          :opcoes="exames"
          :data-testid="`orcamento-exame-${k}`"
        />
        <span class="campo">
          <label :for="`orc-valor-${k}`">{{ t('sadt.valor') }}</label>
          <input
            :id="`orc-valor-${k}`"
            v-model="i.valor"
            inputmode="decimal"
            :data-testid="`orcamento-valor-${k}`"
          />
        </span>
      </div>
      <p>{{ t('sadt.orcamentos.total') }}: {{ dinheiro(total) }}</p>
      <div class="acoes">
        <SanteBotao
          variante="secundario"
          :rotulo="t('sadt.orcamentos.acrescentar')"
          @acionar="itens.push({ exame: '', valor: '' })"
        />
        <SanteBotao
          :rotulo="t('sadt.gravar')"
          :desabilitado="ocupado || nome.trim().length < 3 || !convenio || !itens.some((i) => i.exame)"
          data-testid="orcamento-gravar"
          @acionar="gravar"
        />
      </div>
    </section>
    <p v-if="mensagem" role="status" data-testid="orcamento-mensagem">{{ mensagem }}</p>
    <ErroSadt v-if="erro" :erro="erro" />
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
