<script setup lang="ts">
// Pacotes e orçamentos-padrão (ficha do M30, seção 7): `/faturamento/pacotes`. Os pacotes vigentes do contrato (no novo)
// para conferir as contas por pacote, sem mudar o cálculo da conta (regra 10): criar, editar (carregado pelo id, com a
// quantidade de cada item) e desativar; os orçamentos-padrão cadastrados em consulta (a manutenção desligada, POL-3:
// chave composta e 1 linha; D-CRUD-30).
import type { PacoteLido } from '@sgh/contratos';
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { editarPacote, lerPacotes, novaChave } from '../api-faturamento.js';
import AvisoFaturamento from '../componentes/AvisoFaturamento.vue';
import ErroFaturamento from '../componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../componentes/MensagemFaturamento.vue';
import { data, numero, reais, usarFaturamento } from '../usar-faturamento.js';

const { t } = useI18n();
const qc = useQueryClient();
const { pode, motivoFuncionalidade, apoio } = usarFaturamento();
const q = useQuery({ queryKey: ['faturamento', 'pacotes'], queryFn: () => lerPacotes() });
const vazio = () => ({
  id: null as number | null,
  convenio: '0',
  codigo: '',
  nome: '',
  valor: '',
  inicio: '',
  fim: '',
  itens: [{ codigo: '', quantidade: '1' }] as { codigo: string; quantidade: string }[],
});
const novo = ref(vazio());
const opcoesConvenio = computed(() => [
  { valor: '0', rotulo: t('faturamento.regras.convenioTodos') },
  ...(apoio.data.value?.convenios ?? []).map((c) => ({
    valor: String(c.codigo),
    rotulo: `${c.codigo} — ${c.nome}`,
  })),
]);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const faltaItem = ref(false);
function editar(p: PacoteLido) {
  novo.value = {
    id: p.id,
    convenio: String(p.convenio),
    codigo: String(p.codigo),
    nome: p.nome,
    valor: String(p.valor).replace('.', ','),
    inicio: p.inicio.slice(0, 10),
    fim: p.fim ? p.fim.slice(0, 10) : '',
    itens: p.itens.map((i) => ({
      codigo: String(i.codigo),
      quantidade: String(i.quantidade).replace('.', ','),
    })),
  };
}
async function enviar(e: Record<string, unknown>) {
  erro.value = null;
  mensagem.value = null;
  try {
    mensagem.value = (await editarPacote(e, novaChave('pacote'))).mensagem;
    await qc.invalidateQueries({ queryKey: ['faturamento', 'pacotes'] });
    return true;
  } catch (x) {
    erro.value = x;
    return false;
  }
}
async function gravar() {
  const itens = novo.value.itens
    .filter((i) => i.codigo.trim() !== '')
    .map((i) => ({ codigo: Number(i.codigo), quantidade: numero(i.quantidade || '1') }));
  faltaItem.value = itens.length === 0;
  if (faltaItem.value) return;
  const ok = await enviar({
    id: novo.value.id,
    convenio: Number(novo.value.convenio),
    codigo: Number(novo.value.codigo),
    nome: novo.value.nome,
    valor: numero(novo.value.valor),
    inicio: novo.value.inicio || apoio.data.value?.hoje,
    fim: novo.value.fim || null,
    itens,
  });
  if (ok) novo.value = vazio();
}
function desativar(p: PacoteLido) {
  return enviar({
    id: p.id,
    convenio: p.convenio,
    codigo: p.codigo,
    nome: p.nome,
    valor: p.valor,
    inicio: p.inicio.slice(0, 10),
    fim: p.fim ? p.fim.slice(0, 10) : null,
    itens: p.itens,
    ativo: false,
  });
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="pac-titulo" data-testid="tela-faturamento-pacotes">
    <h1 id="pac-titulo">{{ t('faturamento.pacotes.titulo') }}</h1>
    <p>{{ t('faturamento.pacotes.texto') }}</p>
    <AvisoFaturamento :motivo="motivoFuncionalidade('regras')" />
    <ErroFaturamento v-if="erro" :erro="erro" />
    <MensagemFaturamento :texto="mensagem" testid="pac-mensagem" />
    <ErroFaturamento v-if="q.error.value" :erro="q.error.value" />
    <p v-else-if="!q.data.value" role="status">{{ t('faturamento.carregando') }}</p>
    <template v-else>
      <table class="tabela" data-testid="pac-lista">
        <thead>
          <tr>
            <th scope="col">{{ t('faturamento.convenio') }}</th>
            <th scope="col">{{ t('faturamento.codigo') }}</th>
            <th scope="col">{{ t('faturamento.nome') }}</th>
            <th scope="col">{{ t('faturamento.valor') }}</th>
            <th scope="col">{{ t('faturamento.pacotes.inicio') }}</th>
            <th scope="col">{{ t('faturamento.pacotes.fim') }}</th>
            <th scope="col">{{ t('faturamento.pacotes.itens') }}</th>
            <th v-if="pode('editarPacote')" scope="col">{{ t('faturamento.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="q.data.value.pacotes.length === 0">
            <td colspan="8">{{ t('faturamento.nenhum') }}</td>
          </tr>
          <tr v-for="p in q.data.value.pacotes" :key="p.id">
            <td>{{ p.convenio }}</td>
            <td>{{ p.codigo }}</td>
            <td>{{ p.nome }}</td>
            <td>{{ reais(p.valor) }}</td>
            <td>{{ data(p.inicio) }}</td>
            <td>{{ data(p.fim) }}</td>
            <td>{{ p.itens.map((i) => `${i.codigo} × ${i.quantidade}`).join(', ') }}</td>
            <td v-if="pode('editarPacote')" class="acoes">
              <button type="button" :data-testid="`pac-editar-${p.id}`" @click="editar(p)">
                {{ t('faturamento.editar') }}
              </button>
              <button type="button" :data-testid="`pac-desativar-${p.id}`" @click="desativar(p)">
                {{ t('faturamento.desativar') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <form v-if="pode('editarPacote')" class="filtros" @submit.prevent="gravar">
        <span class="campo">
          <SanteSelecao
            v-model="novo.convenio"
            :rotulo="t('faturamento.convenio')"
            :opcoes="opcoesConvenio"
            data-testid="pac-conv"
          />
        </span>
        <span class="campo"
          ><label for="pac-cod">{{ t('faturamento.codigo') }}</label
          ><input id="pac-cod" v-model="novo.codigo" inputmode="numeric" data-testid="pac-cod"
        /></span>
        <span class="campo"
          ><label for="pac-nome">{{ t('faturamento.nome') }}</label
          ><input id="pac-nome" v-model="novo.nome" maxlength="80" data-testid="pac-nome"
        /></span>
        <span class="campo"
          ><label for="pac-valor">{{ t('faturamento.valor') }}</label
          ><input id="pac-valor" v-model="novo.valor" inputmode="decimal" size="8" data-testid="pac-valor"
        /></span>
        <span class="campo"
          ><label for="pac-ini">{{ t('faturamento.pacotes.inicio') }}</label
          ><input id="pac-ini" v-model="novo.inicio" type="date"
        /></span>
        <span class="campo"
          ><label for="pac-fim">{{ t('faturamento.pacotes.fim') }}</label
          ><input id="pac-fim" v-model="novo.fim" type="date"
        /></span>
        <fieldset data-testid="pac-itens">
          <legend>{{ t('faturamento.pacotes.itens') }}</legend>
          <span v-for="(i, k) in novo.itens" :key="k" class="campo acoes">
            <label :for="`pac-item-${k}`">{{ t('faturamento.pacotes.item') }}</label>
            <input
              :id="`pac-item-${k}`"
              v-model="i.codigo"
              inputmode="numeric"
              :data-testid="`pac-item-${k}`"
            />
            <label :for="`pac-qtd-${k}`">{{ t('faturamento.quantidade') }}</label>
            <input
              :id="`pac-qtd-${k}`"
              v-model="i.quantidade"
              inputmode="decimal"
              size="5"
              :data-testid="`pac-qtd-${k}`"
            />
            <button type="button" @click="novo.itens.splice(k, 1)">{{ t('faturamento.remover') }}</button>
          </span>
          <button
            type="button"
            data-testid="pac-novo-item"
            @click="novo.itens.push({ codigo: '', quantidade: '1' })"
          >
            {{ t('faturamento.pacotes.novoItem') }}
          </button>
          <p v-if="faltaItem" role="alert">{{ t('faturamento.pacotes.semItens') }}</p>
        </fieldset>
        <button type="submit" data-testid="pac-gravar">
          {{ novo.id ? t('faturamento.pacotes.salvar', { id: novo.id }) : t('faturamento.pacotes.novo') }}
        </button>
        <button v-if="novo.id" type="button" data-testid="pac-cancelar" @click="novo = vazio()">
          {{ t('faturamento.cancelar') }}
        </button>
      </form>
      <h2>{{ t('faturamento.pacotes.padrao') }}</h2>
      <p class="secundario">{{ t('faturamento.pacotes.padraoTexto') }}</p>
      <table class="tabela" data-testid="pac-padrao">
        <thead>
          <tr>
            <th scope="col">{{ t('faturamento.convenio') }}</th>
            <th scope="col">{{ t('faturamento.codigo') }}</th>
            <th scope="col">{{ t('faturamento.nome') }}</th>
            <th scope="col">{{ t('faturamento.valor') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(o, i) in q.data.value.orcamentosPadrao" :key="i">
            <td>{{ o.convenio }}</td>
            <td>{{ o.procedimento }}</td>
            <td>{{ o.nome }}</td>
            <td>{{ reais(o.valor) }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>

<style scoped>
/* Alvos de toque de pelo menos 24 px e afastados (WCAG 2.5.8): as ações da linha e do item. */
.acoes {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}
.acoes button {
  min-height: 2rem;
  min-width: 2rem;
  padding: 0 0.75rem;
}
</style>
