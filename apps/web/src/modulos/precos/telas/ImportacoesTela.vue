<script setup lang="ts">
// "Importação versionada de tabelas (com comparação)" (M12, ficha seções 5 e 7): o arquivo entra na área de
// preparação, é validado e comparado com a vigência atual (novos, removidos, alterados, iguais); a aprovação
// (supervisor do faturamento; justificativa e a senha de novo) publica os itens alterados como reajuste por
// arquivo; itens novos e removidos aparecem, mas não são publicados.
import type { CargaDetalhe } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import ConfirmacaoCritica from '../componentes/ConfirmacaoCritica.vue';
import {
  aprovarImportacao,
  buscarImportacao,
  criarImportacao,
  listarImportacoes,
  listarTabelas,
  rejeitarImportacao,
} from '../api-precos.js';

const { t } = useI18n();
const lista = useQuery({ queryKey: ['importacoes'], queryFn: () => listarImportacoes() });
const tabelas = useQuery({ queryKey: ['tabelas', 'honorarios'], queryFn: () => listarTabelas('honorarios') });
const nova = reactive({ tabela: '', arquivo: '', conteudo: '' });
const opcoesTabela = computed(() =>
  (tabelas.data.value ?? []).map((x) => ({ valor: String(x.codigo), rotulo: `${x.codigo} — ${x.nome}` })),
);
const mensagem = ref<string | null>(null);
const recusa = ref<string | null>(null);
const erro = ref<unknown>(null);
function tratar(e: unknown): void {
  if (e instanceof ErroApi && e.problema?.detail && [400, 401, 403, 404, 409].includes(e.status))
    recusa.value = e.problema.detail;
  else erro.value = e;
}
async function lerArquivo(ev: Event): Promise<void> {
  const f = (ev.target as HTMLInputElement).files?.[0];
  if (!f) return;
  nova.arquivo = f.name;
  nova.conteudo = await f.text();
}
async function preparar(): Promise<void> {
  recusa.value = null;
  erro.value = null;
  // A tabela é obrigatória (antes garantida pelo required do select nativo).
  if (nova.tabela === '') {
    recusa.value = t('precos.importacoes.escolhaTabela');
    return;
  }
  try {
    const r = await criarImportacao(Number(nova.tabela), nova.arquivo || 'colado.csv', nova.conteudo);
    mensagem.value = `${t('precos.importacoes.preparada', { id: r.id, situacao: t(`precos.importacoes.situacoes.${r.situacao}`) })} ${r.motivo ?? ''}`;
    await lista.refetch();
    aberta.value = r.id;
  } catch (e) {
    tratar(e);
  }
}
const aberta = ref<number | null>(null);
const pagina = ref(0);
const comparacao = ref('');
const opcoesComparacao = computed(() => [
  { valor: '', rotulo: t('precos.comum.todos') },
  ...['alterado', 'igual', 'novo', 'removido'].map((x) => ({
    valor: x,
    rotulo: t(`precos.importacoes.comparacoes.${x}`),
  })),
]);
watch([aberta, comparacao], () => (pagina.value = 0));
const detalhe = useQuery({
  queryKey: computed(() => ['importacao', aberta.value, pagina.value, comparacao.value]),
  queryFn: () => buscarImportacao(aberta.value as number, pagina.value, comparacao.value || null),
  enabled: computed(() => aberta.value !== null),
});
const d = computed<(CargaDetalhe & { versao: number }) | null>(() => detalhe.data.value ?? null);
const ap = reactive({ justificativa: '', senha: '', tabelaCompartilhada: false, percentualTabela: false });
const motivo = ref('');
async function aprovar(): Promise<void> {
  if (!d.value) return;
  recusa.value = null;
  try {
    const r = await aprovarImportacao(d.value.carga.id, {
      justificativa: ap.justificativa,
      senha: ap.senha,
      versao: d.value.versao,
      confirmacoes: { tabelaCompartilhada: ap.tabelaCompartilhada, percentualTabela: ap.percentualTabela },
    });
    mensagem.value = `${t('precos.importacoes.publicada')} ${r.mensagem}`;
    ap.senha = '';
    await Promise.all([lista.refetch(), detalhe.refetch()]);
  } catch (e) {
    tratar(e);
  }
}
async function rejeitar(): Promise<void> {
  if (!d.value) return;
  recusa.value = null;
  try {
    await rejeitarImportacao(d.value.carga.id, motivo.value, d.value.versao);
    mensagem.value = t('precos.importacoes.rejeitada');
    await Promise.all([lista.refetch(), detalhe.refetch()]);
  } catch (e) {
    tratar(e);
  }
}
const tabelaDaCarga = computed(
  () => tabelas.data.value?.find((x) => x.codigo === d.value?.carga.tabela) ?? null,
);
/** Diferença do arquivo para o vigente, só nos componentes que o arquivo traz (os outros não mudam). */
const diferenca = (antes: Record<string, number> | null, depois: Record<string, number> | null) => {
  if (!antes || !depois) return '';
  const dif = Object.entries(depois).reduce((s, [k, x]) => s + (x - (antes[k] ?? 0)), 0);
  const txt = Math.abs(dif).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return dif === 0 ? '0' : `${dif > 0 ? '+' : '−'}${txt}`;
};
const fmt = (v: Record<string, number> | null) =>
  v
    ? Object.entries(v)
        .map(([k, x]) => `${k}=${x.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}`)
        .join(' ')
    : '';
</script>

<template>
  <section class="tela" aria-labelledby="importacoes-titulo">
    <h1 id="importacoes-titulo">{{ t('precos.importacoes.titulo') }}</h1>
    <p>{{ t('precos.importacoes.texto') }}</p>
    <p v-if="mensagem" role="status" data-testid="mensagem-importacao">{{ mensagem }}</p>
    <SanteAlerta v-if="recusa" :texto="recusa" variante="aviso" anunciar data-testid="recusa-importacao" />
    <MensagemErro v-if="erro" :erro="erro" />
    <section class="painel" aria-labelledby="nova-titulo">
      <h2 id="nova-titulo">{{ t('precos.importacoes.nova') }}</h2>
      <form class="form" data-testid="form-importacao" @submit.prevent="preparar">
        <div class="campo">
          <SanteSelecao
            id="imp-tabela"
            v-model="nova.tabela"
            obrigatorio
            :rotulo="t('precos.comum.tabela')"
            :opcoes="opcoesTabela"
            data-testid="importacao-tabela"
          />
        </div>
        <div class="campo">
          <label for="imp-arquivo">{{ t('precos.importacoes.arquivo') }}</label>
          <input id="imp-arquivo" type="file" accept=".csv,text/csv,text/plain" @change="lerArquivo" />
        </div>
        <div class="campo">
          <label for="imp-nome">{{ t('precos.importacoes.nomeArquivo') }}</label>
          <input id="imp-nome" v-model="nova.arquivo" maxlength="120" data-testid="importacao-nome" />
        </div>
        <div class="campo">
          <label for="imp-conteudo">{{ t('precos.importacoes.conteudo') }}</label>
          <textarea
            id="imp-conteudo"
            v-model="nova.conteudo"
            rows="6"
            required
            data-testid="importacao-conteudo"
          />
        </div>
        <SanteBotao
          :rotulo="t('precos.importacoes.preparar')"
          tipo="submit"
          data-testid="importacao-preparar"
        />
      </form>
    </section>
    <section class="painel" aria-labelledby="lista-titulo">
      <h2 id="lista-titulo">{{ t('precos.importacoes.lista') }}</h2>
      <MensagemErro v-if="lista.isError.value" :erro="lista.error.value" />
      <p v-else-if="(lista.data.value?.cargas ?? []).length === 0">{{ t('precos.importacoes.nenhuma') }}</p>
      <ul v-else data-testid="lista-importacoes">
        <li v-for="c in lista.data.value?.cargas ?? []" :key="c.id">
          {{ c.id }} — {{ c.arquivo }} ({{ t('precos.comum.tabela') }} {{ c.tabela }}):
          <strong>{{ t(`precos.importacoes.situacoes.${c.situacao}`) }}</strong> ·
          {{ t('precos.importacoes.totais', c.totais) }}
          <SanteBotao
            :rotulo="t('precos.importacoes.abrir')"
            variante="texto"
            :data-testid="`abrir-importacao-${c.id}`"
            @acionar="aberta = c.id"
          />
        </li>
      </ul>
    </section>
    <section v-if="d" class="painel" aria-labelledby="detalhe-titulo" data-testid="detalhe-importacao">
      <h2 id="detalhe-titulo">
        {{
          t('precos.importacoes.detalhe', {
            id: d.carga.id,
            arquivo: d.carga.arquivo,
            tabela: d.carga.tabela ?? '',
          })
        }}
      </h2>
      <p>
        <strong>{{ t(`precos.importacoes.situacoes.${d.carga.situacao}`) }}</strong> ·
        {{ t('precos.importacoes.totais', d.carga.totais) }}
      </p>
      <p v-if="d.carga.motivo">{{ d.carga.motivo }}</p>
      <div class="campo">
        <SanteSelecao
          id="imp-filtro"
          v-model="comparacao"
          :rotulo="t('precos.importacoes.filtro')"
          :opcoes="opcoesComparacao"
          data-testid="importacao-filtro"
        />
      </div>
      <div class="rolagem">
        <table data-testid="tabela-comparacao">
          <caption>
            {{
              t('precos.importacoes.detalhe', {
                id: d.carga.id,
                arquivo: d.carga.arquivo,
                tabela: d.carga.tabela ?? '',
              })
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('precos.importacoes.linha') }}</th>
              <th scope="col">{{ t('precos.comum.codigo') }}</th>
              <th scope="col">{{ t('precos.comum.nome') }}</th>
              <th scope="col">{{ t('precos.importacoes.resultado') }}</th>
              <th scope="col">{{ t('precos.importacoes.valorAtual') }}</th>
              <th scope="col">{{ t('precos.importacoes.valores') }}</th>
              <th scope="col">{{ t('precos.importacoes.diferenca') }}</th>
              <th scope="col">{{ t('precos.importacoes.motivo') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(l, i) in d.linhas" :key="i" :data-testid="`linha-comparacao-${l.codigo ?? 'x'}`">
              <td>{{ l.linha ?? '' }}</td>
              <td>{{ l.codigo ?? '' }}</td>
              <td>{{ l.nome ?? '' }}</td>
              <td>{{ l.comparacao ? t(`precos.importacoes.comparacoes.${l.comparacao}`) : l.resultado }}</td>
              <td data-testid="valor-atual">{{ fmt(l.antes) }}</td>
              <td data-testid="valor-arquivo">{{ fmt(l.depois) }}</td>
              <td data-testid="valor-diferenca">{{ diferenca(l.antes, l.depois) }}</td>
              <td>{{ l.motivo ?? '' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="d.total > 50" class="botoes">
        <SanteBotao
          :rotulo="t('precos.comum.anterior')"
          variante="texto"
          :desabilitado="pagina === 0"
          @acionar="pagina--"
        />
        <SanteBotao
          :rotulo="t('precos.comum.proxima')"
          variante="texto"
          :desabilitado="(pagina + 1) * 50 >= d.total"
          @acionar="pagina++"
        />
      </div>
      <form
        v-if="d.carga.situacao === 'comparada'"
        class="form"
        data-testid="form-aprovar"
        @submit.prevent="aprovar"
      >
        <label v-if="tabelaDaCarga?.compartilhada" class="confirmacao">
          <input v-model="ap.tabelaCompartilhada" type="checkbox" data-testid="aprovar-compartilhada" />
          {{
            t('precos.honorarios.confirmar', {
              texto: t('precos.honorarios.confirmacoes.tabelaCompartilhada'),
            })
          }}
        </label>
        <label v-if="tabelaDaCarga?.comPercentual" class="confirmacao">
          <input v-model="ap.percentualTabela" type="checkbox" />
          {{
            t('precos.honorarios.confirmar', { texto: t('precos.honorarios.confirmacoes.percentualTabela') })
          }}
        </label>
        <ConfirmacaoCritica
          v-model:justificativa="ap.justificativa"
          v-model:senha="ap.senha"
          testid="aprovar"
        />
        <SanteBotao
          :rotulo="t('precos.importacoes.aprovar')"
          tipo="submit"
          data-testid="importacao-aprovar"
        />
      </form>
      <form
        v-if="['preparada', 'validada', 'comparada'].includes(d.carga.situacao)"
        class="form"
        @submit.prevent="rejeitar"
      >
        <div class="campo">
          <label for="imp-motivo">{{ t('precos.importacoes.motivoRejeicao') }}</label>
          <input id="imp-motivo" v-model="motivo" maxlength="200" required />
        </div>
        <SanteBotao :rotulo="t('precos.importacoes.rejeitar')" tipo="submit" variante="secundario" />
      </form>
    </section>
  </section>
</template>

<style scoped>
.form,
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
  max-width: 40rem;
  margin: var(--sgh-espaco-2) 0;
}
.painel {
  margin-top: var(--sgh-espaco-3);
}
.rolagem {
  overflow-x: auto;
}
table {
  border-collapse: collapse;
  width: 100%;
}
caption {
  text-align: left;
  font-weight: 600;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
.botoes {
  display: flex;
  gap: var(--sgh-espaco-2);
}
input,
select,
textarea {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
</style>
