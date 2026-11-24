<script setup lang="ts">
// Orçamento de exames particular (F3.5, 05-SADT linha 26): `/sadt/orcamentos`. A lista com a validade e a situação; o
// novo orçamento com os exames, a quantidade e o preço da tabela da fonte particular calculado na hora (o balcão pode
// informar outro valor), o desconto e o total com as parcelas; a recusa da regra aparece antes de gravar. A conversão
// mostra os atendimentos do paciente e converte num clique: a requisição abre no setor executante de cada exame.
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  atendimentosDoOrcamento,
  converterOrcamentoExames,
  type CorpoOrcamento,
  gravarOrcamento,
  type PreviaOrcamento,
  previaOrcamento,
} from '../api-orcamento.js';
import { listarOrcamentos, novaChave } from '../api-sadt.js';
import ErroSadt from '../componentes/ErroSadt.vue';
import { usarSadt } from '../usar-sadt.js';

const { t } = useI18n();
const cliente = useQueryClient();
const termo = ref('');
const buscado = ref('');
const { apoio } = usarSadt(ref('laboratorio'));
const lista = useQuery({
  queryKey: computed(() => ['sadt', 'orcamentos', buscado.value]),
  queryFn: () => listarOrcamentos(buscado.value || null),
});
const dinheiro = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const linhaItem = (p: PreviaOrcamento['itens'][number]) =>
  `${p.nome}: ${p.quantidade} × ${dinheiro(p.unitario)} = ${dinheiro(p.total)}`;
const parcelas = (p: PreviaOrcamento) =>
  `= ${p.itens.map((i) => dinheiro(i.total)).join(' + ')} − ${dinheiro(p.desconto)} ·`;
const numero = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));

// ── Novo orçamento ──────────────────────────────────────────────────────────────────────────────────────────
const nome = ref('');
const cpf = ref('');
const telefone = ref('');
const fonte = ref('');
const desconto = ref('');
const validadeDias = ref('30');
const itens = ref<{ exame: string; quantidade: string; valor: string }[]>([
  { exame: '', quantidade: '1', valor: '' },
]);
const fontes = computed(() => [
  { valor: '', rotulo: t('sadt.escolha') },
  ...(apoio.data.value?.convenios ?? []).map((c) => ({ valor: String(c.codigo), rotulo: c.nome })),
]);
const exames = computed(() => [
  { valor: '', rotulo: t('sadt.escolha') },
  ...(apoio.data.value?.exames ?? []).map((e) => ({
    valor: String(e.id),
    rotulo: `${e.nome} (${e.codigo})`,
  })),
]);
const corpo = computed<CorpoOrcamento>(() => ({
  paciente: null,
  nome: nome.value.trim() || null,
  cpf: cpf.value.trim() || null,
  telefone: telefone.value.trim() || null,
  fontePagadora: Number(fonte.value),
  exames: itens.value
    .filter((i) => i.exame)
    .map((i) => ({ exame: Number(i.exame), quantidade: Number(i.quantidade) || 1, valor: numero(i.valor) })),
  desconto: numero(desconto.value) ?? 0,
  validadeDias: Number(validadeDias.value) || 30,
}));
const previa = ref<PreviaOrcamento | null>(null);
const erroPrevia = ref<unknown>(null);
let pendente: ReturnType<typeof setTimeout> | null = null;
watch(
  corpo,
  (c) => {
    if (pendente) clearTimeout(pendente);
    previa.value = null;
    erroPrevia.value = null;
    if (!c.fontePagadora || c.exames.length === 0) return;
    pendente = setTimeout(async () => {
      try {
        previa.value = await previaOrcamento(c, novaChave('previa'));
      } catch (x) {
        erroPrevia.value = x;
      }
    }, 400);
  },
  { deep: true },
);
const ocupado = ref(false);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
async function gravar(): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const r = await gravarOrcamento(corpo.value, novaChave('orcamento'));
    mensagem.value = t('sadt.orcamentos.gravadoNumero', { numero: r.numero, total: dinheiro(r.total) });
    nome.value = '';
    cpf.value = '';
    telefone.value = '';
    desconto.value = '';
    itens.value = [{ exame: '', quantidade: '1', valor: '' }];
    await cliente.invalidateQueries({ queryKey: ['sadt', 'orcamentos'] });
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}

// ── Conversão ───────────────────────────────────────────────────────────────────────────────────────────────
const atendimentos = ref<Record<number, { id: number; numero: string; entradaEm: string; fonte: string }[]>>(
  {},
);
const manual = ref<Record<number, string>>({});
async function verAtendimentos(id: number): Promise<void> {
  erro.value = null;
  try {
    atendimentos.value = { ...atendimentos.value, [id]: (await atendimentosDoOrcamento(id)).itens };
  } catch (x) {
    erro.value = x;
  }
}
async function converter(id: number, atendimento: number): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const r = await converterOrcamentoExames(id, atendimento, novaChave('converter'));
    mensagem.value = t('sadt.orcamentos.convertido', { n: r.requisicoes.length });
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

    <section class="painel" aria-labelledby="orc-novo-titulo">
      <h2 id="orc-novo-titulo">{{ t('sadt.orcamentos.novo') }}</h2>
      <div class="filtros">
        <span class="campo">
          <label for="orc-nome">{{ t('sadt.orcamentos.nome') }}</label>
          <input id="orc-nome" v-model="nome" maxlength="150" data-testid="orcamento-nome" />
        </span>
        <span class="campo">
          <label for="orc-cpf">{{ t('sadt.orcamentos.cpf') }}</label>
          <input id="orc-cpf" v-model="cpf" maxlength="14" inputmode="numeric" data-testid="orcamento-cpf" />
        </span>
        <span class="campo">
          <label for="orc-tel">{{ t('sadt.orcamentos.telefone') }}</label>
          <input id="orc-tel" v-model="telefone" maxlength="20" inputmode="tel" />
        </span>
        <SanteSelecao
          v-model="fonte"
          :rotulo="t('sadt.convenio')"
          :opcoes="fontes"
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
          <label :for="`orc-qtd-${k}`">{{ t('sadt.orcamentos.quantidade') }}</label>
          <input :id="`orc-qtd-${k}`" v-model="i.quantidade" type="number" min="1" max="99" />
        </span>
        <span class="campo">
          <label :for="`orc-valor-${k}`">{{ t('sadt.orcamentos.valorBalcao') }}</label>
          <input
            :id="`orc-valor-${k}`"
            v-model="i.valor"
            inputmode="decimal"
            :placeholder="
              previa?.itens.find((p) => String(p.exame) === i.exame)?.precoTabela?.toFixed(2) ?? ''
            "
            :data-testid="`orcamento-valor-${k}`"
          />
        </span>
        <SanteBotao
          v-if="itens.length > 1"
          variante="secundario"
          :rotulo="t('sadt.orcamentos.remover')"
          @acionar="itens.splice(k, 1)"
        />
      </div>
      <div class="filtros">
        <span class="campo">
          <label for="orc-desc">{{ t('sadt.orcamentos.desconto') }}</label>
          <input id="orc-desc" v-model="desconto" inputmode="decimal" data-testid="orcamento-desconto" />
        </span>
        <span class="campo">
          <label for="orc-val">{{ t('sadt.orcamentos.validadeDias') }}</label>
          <input id="orc-val" v-model="validadeDias" type="number" min="1" max="180" />
        </span>
      </div>
      <div v-if="previa" data-testid="orcamento-previa">
        <ul>
          <li v-for="p in previa.itens" :key="p.exame">
            {{ linhaItem(p) }}
            <span class="secundario">({{ t(`sadt.orcamentos.${p.origemPreco}`) }})</span>
          </li>
        </ul>
        <p>
          <strong data-testid="orcamento-total"
            >{{ t('sadt.orcamentos.total') }}: {{ dinheiro(previa.total) }}</strong
          >
          <span class="secundario">
            {{ parcelas(previa) }}
            {{ t('sadt.orcamentos.validoAte', { data: previa.validade.split('-').reverse().join('/') }) }}
          </span>
        </p>
      </div>
      <ErroSadt v-if="erroPrevia" :erro="erroPrevia" />
      <div class="acoes">
        <SanteBotao
          variante="secundario"
          :rotulo="t('sadt.orcamentos.acrescentar')"
          @acionar="itens.push({ exame: '', quantidade: '1', valor: '' })"
        />
        <SanteBotao
          :rotulo="t('sadt.gravar')"
          :desabilitado="ocupado || !previa || nome.trim().length < 3"
          data-testid="orcamento-gravar"
          @acionar="gravar"
        />
      </div>
    </section>
    <p v-if="mensagem" role="status" data-testid="orcamento-mensagem">{{ mensagem }}</p>
    <ErroSadt v-if="erro" :erro="erro" />

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
      :key="o.id"
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
        <li v-for="(i, k) in o.itens" :key="k">{{ i.nome }}: {{ dinheiro(i.valor) }}</li>
      </ul>
      <p>
        <strong>{{ t('sadt.orcamentos.total') }}: {{ dinheiro(o.total) }}</strong>
        <span class="secundario"> ({{ o.itens.map((i) => dinheiro(i.valor)).join(' + ') }})</span>
      </p>
      <div v-if="o.situacao === 'aberto'" class="filtros">
        <SanteBotao
          variante="secundario"
          :rotulo="t('sadt.orcamentos.verAtendimentos')"
          :data-testid="`orcamento-atendimentos-${o.id}`"
          @acionar="verAtendimentos(o.id)"
        />
        <template v-if="atendimentos[o.id]">
          <SanteBotao
            v-for="a in atendimentos[o.id]"
            :key="a.id"
            :rotulo="`${t('sadt.orcamentos.converterAqui')}: ${a.numero} · ${a.entradaEm.slice(0, 10).split('-').reverse().join('/')} · ${a.fonte}`"
            :desabilitado="ocupado"
            :data-testid="`orcamento-converter-${o.id}-${a.id}`"
            @acionar="converter(o.id, a.id)"
          />
          <template v-if="atendimentos[o.id]?.length === 0">
            <p>{{ t('sadt.orcamentos.semAtendimentos') }}</p>
            <span class="campo">
              <label :for="`orc-atd-${o.id}`">{{ t('sadt.orcamentos.atendimentoConversao') }}</label>
              <input
                :id="`orc-atd-${o.id}`"
                v-model="manual[o.id]"
                type="number"
                min="1"
                :data-testid="`orcamento-atendimento-${o.id}`"
              />
            </span>
            <SanteBotao
              :rotulo="t('sadt.orcamentos.converter')"
              :desabilitado="ocupado || !manual[o.id]"
              :data-testid="`orcamento-converter-${o.id}`"
              @acionar="converter(o.id, Number(manual[o.id]))"
            />
          </template>
        </template>
      </div>
    </div>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
