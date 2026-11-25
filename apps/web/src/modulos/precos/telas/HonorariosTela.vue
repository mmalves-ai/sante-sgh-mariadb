<script setup lang="ts">
// "Honorários e procedimentos (AMB, CBHPM, TUSS, próprias)" (M12, ficha seção 7): a tabela escolhida (com o
// modelo de valor e os convênios que a usam), os itens com o valor que vale na data-base (paginados no
// servidor), as vigências de cada item com a autoria registrada pelo novo, o reajuste (proposta com vetos e
// alertas; confirmação da tabela compartilhada e da tabela com percentual; justificativa e a senha de novo)
// e os lotes gravados pelo novo, com o desfazer.
import type { PropostaReajusteResposta, TabelaPreco, VigenciasItem } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import ConfirmacaoCritica from '../componentes/ConfirmacaoCritica.vue';
import {
  aplicarReajuste,
  buscarHonorarios,
  buscarVigencias,
  desfazerLote,
  listarLotes,
  listarTabelas,
  proporReajuste,
} from '../api-precos.js';

const { t } = useI18n();
const tabelas = useQuery({ queryKey: ['tabelas', 'honorarios'], queryFn: () => listarTabelas('honorarios') });
const tab = ref<number | null>(null);
const opcoesTabela = computed(() =>
  (tabelas.data.value ?? []).map((x) => ({
    valor: x.codigo as number | null,
    rotulo: `${x.codigo} — ${x.nome}`,
  })),
);
watch(
  () => tabelas.data.value,
  (l) => {
    if (tab.value === null && l && l.length > 0)
      tab.value = l.find((x) => x.modelo === 'VALOR')?.codigo ?? l[0]?.codigo ?? null;
  },
  { immediate: true },
);
const tabela = computed<TabelaPreco | null>(
  () => tabelas.data.value?.find((x) => x.codigo === tab.value) ?? null,
);
const busca = ref('');
const termo = ref('');
const data = ref('');
const pagina = ref(0);
watch([tab, termo, data], () => (pagina.value = 0));
const itens = useQuery({
  queryKey: computed(() => ['honorarios', tab.value, termo.value, data.value, pagina.value]),
  queryFn: () =>
    buscarHonorarios(tab.value as number, {
      busca: termo.value,
      pagina: pagina.value,
      porPagina: 25,
      data: data.value || null,
    }),
  enabled: computed(() => tab.value !== null),
});
const lotes = useQuery({
  queryKey: computed(() => ['lotes', tab.value]),
  queryFn: () => listarLotes(tab.value),
  enabled: computed(() => tab.value !== null),
});
const totalPaginas = computed(() => Math.max(1, Math.ceil((itens.data.value?.total ?? 0) / 25)));
const dinheiro = (v: number | null | undefined) =>
  v === null || v === undefined
    ? ''
    : v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });

const mensagem = ref<string | null>(null);
const recusa = ref<string | null>(null);
const erro = ref<unknown>(null);
function tratar(e: unknown): void {
  if (e instanceof ErroApi && e.problema?.detail && [400, 401, 403, 404, 409].includes(e.status))
    recusa.value = e.problema.detail;
  else erro.value = e;
}

// Vigências do item
const vigencias = ref<VigenciasItem | null>(null);
async function verVigencias(cod: number): Promise<void> {
  if (tab.value === null) return;
  vigencias.value = await buscarVigencias(tab.value, cod).catch((e) => {
    tratar(e);
    return null;
  });
}

// Reajuste
const selecionados = ref<number[]>([]);
const percentual = ref('');
const proposta = ref<PropostaReajusteResposta | null>(null);
const confirmacoes = reactive<{ tabelaCompartilhada: boolean; percentualTabela: boolean }>({
  tabelaCompartilhada: false,
  percentualTabela: false,
});
const critica = reactive({ justificativa: '', senha: '' });
watch(tab, () => {
  selecionados.value = [];
  proposta.value = null;
  vigencias.value = null;
});
const pedido = () => ({
  codigos: selecionados.value.length > 0 ? [...selecionados.value] : null,
  percentual: Number(percentual.value.replace(',', '.')),
  valores: null,
});
async function propor(): Promise<void> {
  if (tab.value === null) return;
  recusa.value = null;
  erro.value = null;
  confirmacoes.tabelaCompartilhada = false;
  confirmacoes.percentualTabela = false;
  try {
    proposta.value = await proporReajuste(tab.value, pedido());
  } catch (e) {
    tratar(e);
  }
}
async function aplicar(): Promise<void> {
  if (tab.value === null) return;
  recusa.value = null;
  try {
    const r = await aplicarReajuste(tab.value, {
      ...pedido(),
      justificativa: critica.justificativa,
      senha: critica.senha,
      confirmacoes: { ...confirmacoes },
    });
    mensagem.value = r.mensagem;
    proposta.value = null;
    critica.senha = '';
    await Promise.all([itens.refetch(), lotes.refetch()]);
  } catch (e) {
    tratar(e);
  }
}
const loteDesfazer = ref<string | null>(null);
const desf = reactive({ justificativa: '', senha: '' });
async function desfazer(): Promise<void> {
  if (!loteDesfazer.value) return;
  recusa.value = null;
  try {
    const r = await desfazerLote(loteDesfazer.value, desf.justificativa, desf.senha);
    mensagem.value = r.mensagem;
    loteDesfazer.value = null;
    await Promise.all([itens.refetch(), lotes.refetch()]);
  } catch (e) {
    tratar(e);
  }
}
</script>

<template>
  <section class="tela" aria-labelledby="honorarios-titulo">
    <h1 id="honorarios-titulo">{{ t('precos.honorarios.titulo') }}</h1>
    <p>{{ t('precos.honorarios.texto') }}</p>
    <p>
      <router-link to="/precos/consulta">{{ t('precos.honorarios.consulta') }}</router-link>
      ·
      <router-link to="/precos/saneamento">{{ t('precos.honorarios.saneamento') }}</router-link>
    </p>
    <MensagemErro v-if="tabelas.isError.value" :erro="tabelas.error.value" />
    <form class="filtros" @submit.prevent="termo = busca">
      <div class="campo">
        <SanteSelecao
          id="honorarios-tabela"
          v-model="tab"
          :rotulo="t('precos.honorarios.escolha')"
          :opcoes="opcoesTabela"
          data-testid="honorarios-tabela"
        />
      </div>
      <div class="campo">
        <label for="honorarios-busca">{{ t('precos.comum.busca') }}</label>
        <input id="honorarios-busca" v-model="busca" type="search" data-testid="honorarios-busca" />
      </div>
      <div class="campo">
        <label for="honorarios-data">{{ t('precos.comum.data') }}</label>
        <input
          id="honorarios-data"
          v-model="data"
          pattern="\d{4}-\d{2}-\d{2}"
          :placeholder="t('precos.comum.dataAjuda')"
          data-testid="honorarios-data"
        />
      </div>
      <SanteBotao :rotulo="t('precos.comum.buscar')" tipo="submit" variante="secundario" />
    </form>
    <p v-if="tabela" data-testid="honorarios-modelo">
      {{ t('precos.honorarios.modelo') }}:
      {{ tabela.modelo ? t(`precos.honorarios.modelos.${tabela.modelo}`) : '' }}
      <strong v-if="tabela.compartilhada">· {{ t('precos.honorarios.compartilhada') }}</strong>
      <strong v-if="tabela.comPercentual">· {{ t('precos.honorarios.comPercentual') }}</strong>
      <span v-if="tabela.convenios.length > 0">
        · {{ tabela.convenios.map((c) => `${c.codigo} ${c.nome}`).join('; ') }}</span
      >
    </p>
    <p v-if="mensagem" role="status" data-testid="mensagem-honorarios">{{ mensagem }}</p>
    <SanteAlerta v-if="recusa" :texto="recusa" variante="aviso" anunciar data-testid="recusa-honorarios" />
    <MensagemErro v-if="erro" :erro="erro" />
    <MensagemErro v-if="itens.isError.value" :erro="itens.error.value" />
    <div v-else-if="itens.data.value" class="rolagem">
      <table data-testid="tabela-honorarios">
        <caption>
          {{
            tabela?.nome ?? ''
          }}
          —
          {{
            t('precos.comum.data')
          }}
          {{
            itens.data.value.dataBase
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">
              <span class="oculto">{{ t('precos.comum.acoes') }}</span>
            </th>
            <th scope="col">{{ t('precos.comum.codigo') }}</th>
            <th scope="col">{{ t('precos.comum.nome') }}</th>
            <th scope="col">{{ t('precos.honorarios.ch') }}</th>
            <th scope="col">{{ t('precos.honorarios.porte') }}</th>
            <th scope="col">{{ t('precos.comum.vigencia') }}</th>
            <th scope="col">{{ t('precos.honorarios.componentes') }}</th>
            <th scope="col" :title="t('precos.honorarios.totalVigenciaDica')">
              {{ t('precos.honorarios.totalVigencia') }}
            </th>
            <th scope="col">{{ t('precos.comum.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in itens.data.value.itens" :key="i.codigo">
            <td>
              <input
                v-model="selecionados"
                type="checkbox"
                :value="i.codigo"
                :aria-label="t('precos.honorarios.selecionar', { codigo: i.codigo })"
                :data-testid="`selecionar-${i.codigo}`"
              />
            </td>
            <td>{{ i.codigo }}</td>
            <th scope="row">{{ i.nome }}</th>
            <td>{{ i.ch !== 0 ? dinheiro(i.ch) : '' }}</td>
            <td>{{ i.porte ?? '' }}</td>
            <td>
              {{ i.vigencia ?? '' }}
              <em v-if="i.futura">{{ t('precos.honorarios.futura', { data: i.futura }) }}</em>
            </td>
            <td>
              {{
                i.valores
                  ? [i.valores.ch, i.valores.co, i.valores.filme, i.valores.anes, i.valores.outros]
                      .map(dinheiro)
                      .join(' / ')
                  : ''
              }}
            </td>
            <td :data-testid="`total-${i.codigo}`">{{ dinheiro(i.total) }}</td>
            <td>
              <SanteBotao
                :rotulo="t('precos.honorarios.verVigencias')"
                variante="texto"
                :data-testid="`vigencias-${i.codigo}`"
                @acionar="verVigencias(i.codigo)"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="totalPaginas > 1" class="botoes">
        <SanteBotao
          :rotulo="t('precos.comum.anterior')"
          variante="texto"
          :desabilitado="pagina === 0"
          @acionar="pagina--"
        />
        <span>{{
          t('precos.comum.pagina', { pagina: pagina + 1, total: totalPaginas, n: itens.data.value.total })
        }}</span>
        <SanteBotao
          :rotulo="t('precos.comum.proxima')"
          variante="texto"
          :desabilitado="pagina + 1 >= totalPaginas"
          @acionar="pagina++"
        />
      </div>
    </div>

    <section
      v-if="vigencias"
      class="painel"
      aria-labelledby="vigencias-titulo"
      data-testid="painel-vigencias"
    >
      <h2 id="vigencias-titulo">
        {{ t('precos.honorarios.vigenciasDe', { codigo: vigencias.codigo }) }} — {{ vigencias.nome }}
      </h2>
      <table>
        <caption>
          {{
            t('precos.honorarios.vigenciasDe', { codigo: vigencias.codigo })
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('precos.comum.vigencia') }}</th>
            <th scope="col">{{ t('precos.comum.total') }}</th>
            <th scope="col">{{ t('precos.honorarios.autoria') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="v in vigencias.vigencias" :key="v.data">
            <th scope="row">
              {{ v.data }} <strong v-if="v.vigente">{{ t('precos.contrato.vigente') }}</strong>
            </th>
            <td>{{ dinheiro(v.total) }}</td>
            <td>
              {{
                v.autoria
                  ? t('precos.honorarios.autoriaDe', {
                      autor: v.autoria.autor,
                      quando: v.autoria.quando,
                      origem: v.autoria.origem,
                    })
                  : t('precos.honorarios.semAutoria')
              }}
            </td>
          </tr>
        </tbody>
      </table>
      <SanteBotao :rotulo="t('precos.comum.fechar')" variante="texto" @acionar="vigencias = null" />
    </section>

    <section class="painel" aria-labelledby="reajuste-titulo">
      <h2 id="reajuste-titulo">{{ t('precos.honorarios.reajuste') }}</h2>
      <p>{{ t('precos.honorarios.reajusteTexto') }}</p>
      <form class="filtros" @submit.prevent="propor">
        <div class="campo">
          <label for="reajuste-percentual">{{ t('precos.honorarios.percentual') }}</label>
          <input
            id="reajuste-percentual"
            v-model="percentual"
            inputmode="decimal"
            required
            data-testid="reajuste-percentual"
          />
        </div>
        <SanteBotao
          :rotulo="t('precos.honorarios.propor')"
          tipo="submit"
          variante="secundario"
          data-testid="reajuste-propor"
        />
      </form>
      <div v-if="proposta" data-testid="proposta">
        <p>
          {{
            t('precos.honorarios.proposta', {
              itens: proposta.resumo.itens,
              mudam: proposta.resumo.mudam,
              atual: dinheiro(proposta.resumo.somaChAtual),
              nova: dinheiro(proposta.resumo.somaChNova),
              variacao: proposta.resumo.variacao ?? 0,
              transacoes: proposta.resumo.transacoes,
            })
          }}
        </p>
        <template v-if="proposta.vetos.length > 0">
          <h3>{{ t('precos.honorarios.vetos') }}</h3>
          <ul data-testid="vetos">
            <li v-for="v in proposta.vetos" :key="v.codigo">{{ v.mensagem }}</li>
          </ul>
        </template>
        <h3>{{ t('precos.honorarios.alertas') }}</h3>
        <ul data-testid="alertas">
          <li v-for="a in proposta.alertas" :key="a.codigo">{{ a.mensagem }}</li>
        </ul>
        <form
          v-if="proposta.vetos.length === 0"
          class="form"
          data-testid="form-reajuste"
          @submit.prevent="aplicar"
        >
          <label v-for="cf in proposta.confirmacoes" :key="cf" class="confirmacao">
            <input v-model="confirmacoes[cf]" type="checkbox" :data-testid="`confirmar-${cf}`" />
            {{ t('precos.honorarios.confirmar', { texto: t(`precos.honorarios.confirmacoes.${cf}`) }) }}
          </label>
          <ConfirmacaoCritica
            v-model:justificativa="critica.justificativa"
            v-model:senha="critica.senha"
            testid="reajuste"
          />
          <SanteBotao :rotulo="t('precos.honorarios.aplicar')" tipo="submit" data-testid="reajuste-aplicar" />
        </form>
      </div>
    </section>

    <section class="painel" aria-labelledby="lotes-titulo">
      <h2 id="lotes-titulo">{{ t('precos.honorarios.lotes') }}</h2>
      <p v-if="(lotes.data.value ?? []).length === 0">{{ t('precos.honorarios.semLotes') }}</p>
      <ul v-else data-testid="lista-lotes">
        <li v-for="l in lotes.data.value" :key="l.lote">
          {{ t('precos.honorarios.lote', { lote: l.lote, itens: l.itens, data: l.data, autor: l.autor }) }}
          <strong v-if="l.desfeito">{{ t('precos.honorarios.desfeito') }}</strong>
          <strong v-else-if="l.desfeitos > 0" :data-testid="`desfeito-em-parte-${l.lote}`">
            {{ t('precos.honorarios.desfeitoEmParte', { n: l.desfeitos, total: l.itens }) }}
          </strong>
          <SanteBotao
            v-if="!l.desfeito"
            :rotulo="
              t(l.desfeitos > 0 ? 'precos.honorarios.continuarDesfazer' : 'precos.honorarios.desfazer')
            "
            variante="texto"
            :data-testid="`desfazer-${l.lote}`"
            @acionar="loteDesfazer = l.lote"
          />
        </li>
      </ul>
      <form v-if="loteDesfazer" class="form" data-testid="form-desfazer" @submit.prevent="desfazer">
        <ConfirmacaoCritica
          v-model:justificativa="desf.justificativa"
          v-model:senha="desf.senha"
          testid="desfazer"
        />
        <div class="botoes">
          <SanteBotao
            :rotulo="t('precos.honorarios.desfazerConfirmar')"
            tipo="submit"
            data-testid="desfazer-confirmar"
          />
          <SanteBotao :rotulo="t('precos.comum.cancelar')" variante="texto" @acionar="loteDesfazer = null" />
        </div>
      </form>
    </section>
  </section>
</template>

<style scoped>
.filtros {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: var(--sgh-espaco-2);
  margin: var(--sgh-espaco-2) 0;
}
.campo,
.form {
  display: grid;
  gap: var(--sgh-espaco-1);
}
.form {
  max-width: 40rem;
  margin: var(--sgh-espaco-2) 0;
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
.painel {
  margin-top: var(--sgh-espaco-3);
}
.botoes {
  display: flex;
  gap: var(--sgh-espaco-2);
  align-items: center;
}
.oculto {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
input,
select {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
</style>
