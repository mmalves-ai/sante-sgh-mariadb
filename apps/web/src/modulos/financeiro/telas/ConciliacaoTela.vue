<script setup lang="ts">
// Conciliação bancária (ficha do M32, seção 7): `/financeiro/tesouraria/conciliacao`. Duas colunas: as linhas do
// extrato importado (OFX ou CSV; o arquivo fica guardado com a impressão digital) e as sugestões por regra (valor e
// data, valor numa janela de dias, documento). Confirmar concilia; o crédito sem casamento vai para os créditos não
// identificados, que se atribuem a um título a receber. Quem paga não concilia (o servidor recusa).
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import AvisoFaturamento from '../../faturamento/componentes/AvisoFaturamento.vue';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../../faturamento/componentes/MensagemFaturamento.vue';
import {
  atribuirCredito,
  conciliar,
  importarExtrato,
  lerConciliacao,
  listarCreditos,
  novaChave,
} from '../api-financeiro.js';
import { data, opcoesContas, reais, usarFinanceiro } from '../usar-financeiro.js';

const { t } = useI18n();
const qc = useQueryClient();
const { apoio, pode, motivo, motivoFuncionalidade } = usarFinanceiro();
const conta = ref('');
watch(
  () => apoio.data.value?.contas,
  (cs) => {
    if (cs?.[0] && !conta.value) conta.value = String(cs[0].id);
  },
  { immediate: true },
);
const contas = computed(() => opcoesContas(apoio.data.value?.contas));
const conciliacao = useQuery({
  queryKey: computed(() => ['financeiro', 'conciliacao', conta.value]),
  queryFn: () => lerConciliacao(Number(conta.value)),
  enabled: computed(() => !!conta.value),
});
const creditos = useQuery({ queryKey: ['financeiro', 'creditos'], queryFn: () => listarCreditos() });
const pendentes = computed(() =>
  (conciliacao.data.value?.linhas ?? []).filter((l) => l.situacao === 'pendente'),
);
const sugestoesDa = (linha: number) =>
  (conciliacao.data.value?.sugestoes ?? []).filter((s) => s.linha === linha);

const importacao = reactive({ origem: 'csv' as 'ofx' | 'csv', conteudo: '' });
const origens = [
  { valor: 'csv', rotulo: 'CSV' },
  { valor: 'ofx', rotulo: 'OFX' },
];
async function lerArquivo(ev: Event) {
  const f = (ev.target as HTMLInputElement).files?.[0];
  if (!f) return;
  importacao.conteudo = await f.text();
  if (/\.ofx$/i.test(f.name)) importacao.origem = 'ofx';
}
const titulosCredito = reactive<Record<number, string>>({});
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const gravando = ref(false);
async function gravar(f: () => Promise<{ mensagem: string }>) {
  erro.value = null;
  mensagem.value = null;
  gravando.value = true;
  try {
    mensagem.value = (await f()).mensagem;
    await qc.invalidateQueries({ queryKey: ['financeiro'] });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
const importar = () =>
  gravar(async () => {
    const r = await importarExtrato(
      { conta: Number(conta.value), origem: importacao.origem, conteudo: importacao.conteudo },
      novaChave('extrato'),
    );
    importacao.conteudo = '';
    return r;
  });
const confirmar = (s: {
  linha: number;
  tipo: 'movimento' | 'titulo-pagar' | 'titulo-receber';
  id: number;
  regra: 'valor-data' | 'valor-janela' | 'documento';
}) =>
  gravar(() =>
    conciliar({ linha: s.linha, alvo: { tipo: s.tipo, id: s.id }, regra: s.regra }, novaChave('conciliar')),
  );
const aPendente = (linha: number) =>
  gravar(() =>
    conciliar({ linha, alvo: { tipo: 'credito-pendente' }, regra: 'manual' }, novaChave('pendente')),
  );
const atribuir = (id: number) =>
  gravar(() =>
    atribuirCredito(id, { tituloReceber: Number(titulosCredito[id]), observacao: '' }, novaChave('atribuir')),
  );
</script>

<template>
  <section class="tela-agenda" aria-labelledby="cb-titulo" data-testid="tela-fin-conciliacao">
    <h1 id="cb-titulo">{{ t('financeiro.conciliacao.titulo') }}</h1>
    <p>{{ t('financeiro.conciliacao.texto') }}</p>
    <AvisoFaturamento :motivo="motivoFuncionalidade('tesouraria')" />
    <span class="campo">
      <SanteSelecao v-model="conta" :rotulo="t('financeiro.conta')" :opcoes="contas" data-testid="cb-conta" />
    </span>
    <form class="formulario" data-testid="cb-importar" @submit.prevent="importar">
      <h2>{{ t('financeiro.conciliacao.importar') }}</h2>
      <span class="campo">
        <SanteSelecao
          v-model="importacao.origem"
          :rotulo="t('financeiro.conciliacao.origem')"
          :opcoes="origens"
          data-testid="cb-origem"
        />
      </span>
      <span class="campo">
        <label for="cb-arquivo">{{ t('financeiro.conciliacao.arquivo') }}</label>
        <input
          id="cb-arquivo"
          type="file"
          accept=".ofx,.csv,.txt"
          data-testid="cb-arquivo"
          @change="lerArquivo"
        />
      </span>
      <span class="campo">
        <label for="cb-conteudo">{{ t('financeiro.conciliacao.conteudo') }}</label>
        <textarea
          id="cb-conteudo"
          v-model="importacao.conteudo"
          rows="4"
          data-testid="cb-conteudo"
        ></textarea>
      </span>
      <button
        type="submit"
        :disabled="gravando || !importacao.conteudo || !conta || !pode('importarExtrato')"
        data-testid="cb-importar-enviar"
      >
        {{ t('financeiro.conciliacao.importar') }}
      </button>
      <p v-if="!pode('importarExtrato')" class="secundario">{{ motivo('importarExtrato') }}</p>
    </form>
    <ErroFaturamento v-if="erro" :erro="erro" />
    <MensagemFaturamento :texto="mensagem" testid="cb-mensagem" />

    <ErroFaturamento v-if="conciliacao.error.value" :erro="conciliacao.error.value" />
    <div v-else-if="conciliacao.data.value" class="duas-colunas" data-testid="cb-colunas">
      <table class="tabela" data-testid="cb-extrato">
        <caption>
          {{
            t('financeiro.conciliacao.extrato')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('financeiro.data') }}</th>
            <th scope="col">{{ t('financeiro.historico') }}</th>
            <th scope="col">{{ t('financeiro.documento') }}</th>
            <th scope="col">{{ t('financeiro.valor') }}</th>
            <th scope="col">{{ t('financeiro.situacao') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in conciliacao.data.value.linhas" :key="l.id" :data-testid="`cb-linha-${l.id}`">
            <td>{{ data(l.data) }}</td>
            <td>{{ l.historico }}</td>
            <td>{{ l.documento }}</td>
            <td>{{ reais(l.valor) }}</td>
            <td>{{ l.situacao }}</td>
          </tr>
        </tbody>
      </table>
      <table class="tabela" data-testid="cb-sugestoes">
        <caption>
          {{
            t('financeiro.conciliacao.sugestoes')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('financeiro.conciliacao.extrato') }}</th>
            <th scope="col">{{ t('financeiro.tipo') }}</th>
            <th scope="col">{{ t('financeiro.conciliacao.regra') }}</th>
            <th scope="col">{{ t('financeiro.valor') }}</th>
            <th scope="col">{{ t('financeiro.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="l in pendentes" :key="l.id">
            <tr v-for="s in sugestoesDa(l.id)" :key="`${s.linha}-${s.tipo}-${s.id}`">
              <td>{{ data(l.data) }} · {{ reais(l.valor) }}</td>
              <td>{{ t(`financeiro.conciliacao.alvos.${s.tipo}`) }} {{ s.id }}</td>
              <td>{{ t(`financeiro.conciliacao.regras.${s.regra}`) }}</td>
              <td>{{ reais(s.valor) }}</td>
              <td>
                <button
                  type="button"
                  :disabled="gravando || !pode('conciliar')"
                  :data-testid="`cb-confirmar-${s.linha}-${s.id}`"
                  @click="confirmar(s)"
                >
                  {{ t('financeiro.conciliacao.confirmar') }}
                </button>
              </td>
            </tr>
            <tr v-if="!sugestoesDa(l.id).length && l.valor > 0">
              <td>{{ data(l.data) }} · {{ reais(l.valor) }}</td>
              <td colspan="3">—</td>
              <td>
                <button
                  type="button"
                  :disabled="gravando || !pode('conciliar')"
                  :data-testid="`cb-pendente-${l.id}`"
                  @click="aPendente(l.id)"
                >
                  {{ t('financeiro.conciliacao.pendente') }}
                </button>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <h2>{{ t('financeiro.conciliacao.creditos') }}</h2>
    <ErroFaturamento v-if="creditos.error.value" :erro="creditos.error.value" />
    <table v-else-if="creditos.data.value?.length" class="tabela" data-testid="cb-creditos">
      <thead>
        <tr>
          <th scope="col">{{ t('financeiro.data') }}</th>
          <th scope="col">{{ t('financeiro.conta') }}</th>
          <th scope="col">{{ t('financeiro.valor') }}</th>
          <th scope="col">{{ t('financeiro.situacao') }}</th>
          <th scope="col">{{ t('financeiro.conciliacao.tituloReceber') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="c in creditos.data.value" :key="c.id">
          <td>{{ data(c.data) }}</td>
          <td>{{ c.conta }}</td>
          <td>{{ reais(c.valor) }}</td>
          <td>{{ c.situacao }}</td>
          <td>
            <template v-if="c.situacao === 'pendente'">
              <label :for="`cb-cr-${c.id}`" class="visualmente-oculto">{{
                t('financeiro.conciliacao.tituloReceber')
              }}</label>
              <input
                :id="`cb-cr-${c.id}`"
                v-model="titulosCredito[c.id]"
                inputmode="numeric"
                :data-testid="`cb-cr-${c.id}`"
              />
              <button
                type="button"
                :disabled="gravando || !titulosCredito[c.id] || !pode('atribuirCredito')"
                :data-testid="`cb-atribuir-${c.id}`"
                @click="atribuir(c.id)"
              >
                {{ t('financeiro.conciliacao.atribuir') }}
              </button>
            </template>
            <template v-else>{{ c.tituloReceber ?? '—' }}</template>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else>{{ t('financeiro.nenhum') }}</p>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style src="../componentes/estilo-financeiro.css"></style>
