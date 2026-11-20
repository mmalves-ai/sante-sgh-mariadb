<script setup lang="ts">
// Retorno do gestor (M51, etapa 4; ficha, seções 5 e 7) — `Faturamento > Faturamento SUS > AIH (internação, SIH)` e
// `> BPA (produção ambulatorial)`: a importação do espelho do SIH ou do relatório do SIA da competência (texto CSV com
// cabeçalho; o arquivo escolhido ou o texto colado), o resultado (as linhas casadas com a AIH apresentada ou com a linha
// do BPA, as que ficaram fora e os erros por linha), a lista do retorno com a situação, o motivo, os valores e a glosa, e
// a decisão de cada linha rejeitada ou glosada: reapresentar (a AIH rejeitada volta a fechada para a competência
// seguinte) ou aceitar a glosa, com justificativa. Desligado com a AIH e o BPA por estabelecimento (DP-35).
import {
  COLUNAS_RETORNO_SUS,
  INSTRUMENTOS_RETORNO_SUS,
  type InstrumentoRetornoSus,
  type ResultadoRetornoSus,
  type RetornoSusLido,
  SITUACOES_RETORNO_SUS,
  type SituacaoRetornoSus,
  TRATAMENTOS_RETORNO_SUS,
  type TratamentoRetornoSus,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import PaginacaoCadastro from '../../cadastro/componentes/PaginacaoCadastro.vue';
import { carimboBr } from '../../cadastro/formato.js';
import ErroFaturamento from '../componentes/ErroFaturamento.vue';
import { importarRetornoSus, lerPainelAih, lerRetornosSus, tratarRetornoSus } from '../api-sus-aih.js';

const { t } = useI18n();
/** A primeira linha do arquivo de retorno (D-RETORNO-51): os nomes das colunas, como o arquivo traz. */
const CABECALHO = COLUNAS_RETORNO_SUS.join(';');
const cliente = useQueryClient();
const podeImportar = computed(() => pode('faturamento.susRetorno.importar'));
const painel = useQuery({ queryKey: ['sus', 'aih', 'painel'], queryFn: () => lerPainelAih() });
const liberados = computed(() => ({
  aih: painel.data.value?.liberado ?? false,
  bpa: painel.data.value?.retornoBpaLiberado ?? false,
}));

const opcoesInstrumento = computed(() =>
  INSTRUMENTOS_RETORNO_SUS.map((i) => ({ valor: i, rotulo: t(`faturamentoSus.instrumentos.${i}`) })),
);
const entrada = reactive({
  instrumento: 'aih' as InstrumentoRetornoSus,
  competencia: '',
  nome: '',
  conteudo: '',
});
const resultado = ref<ResultadoRetornoSus | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);
const mensagem = ref<string | null>(null);
const aviso = ref<string | null>(null);

async function escolherArquivo(ev: Event): Promise<void> {
  aviso.value = null;
  const f = (ev.target as HTMLInputElement).files?.[0];
  if (!f) return;
  if (f.size > 900_000) {
    aviso.value = t('faturamentoSus.retorno.arquivoGrande');
    return;
  }
  entrada.nome = f.name.replace(/[^\w .()-]/g, '_').slice(0, 60);
  entrada.conteudo = await f.text();
}
const entradaValida = computed(
  () =>
    /^(20\d{2})(0[1-9]|1[0-2])$/.test(entrada.competencia.trim()) &&
    entrada.nome.trim().length > 0 &&
    entrada.conteudo.trim().length > 0,
);
async function importar(): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    resultado.value = await importarRetornoSus({
      instrumento: entrada.instrumento,
      competencia: entrada.competencia.trim(),
      nomeArquivo: entrada.nome.trim(),
      conteudo: entrada.conteudo,
    });
    filtro.instrumento = entrada.instrumento;
    filtro.competencia = entrada.competencia.trim();
    await cliente.invalidateQueries({ queryKey: ['sus'] });
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}

// A lista (filtros e paginação no servidor).
const POR_PAGINA = 50;
const filtro = reactive({
  instrumento: '' as '' | InstrumentoRetornoSus,
  competencia: '',
  situacao: '' as '' | SituacaoRetornoSus,
  tratamento: '' as '' | TratamentoRetornoSus,
});
// O instrumento pelo endereço (o atalho da tela do BPA traz ?instrumento=bpa): a importação e o filtro já nele.
const doEndereco = useRoute().query['instrumento'];
if (typeof doEndereco === 'string' && (INSTRUMENTOS_RETORNO_SUS as readonly string[]).includes(doEndereco)) {
  entrada.instrumento = doEndereco as InstrumentoRetornoSus;
  filtro.instrumento = doEndereco as InstrumentoRetornoSus;
}
const pagina = ref(1);
watch(filtro, () => (pagina.value = 1));
const todos = computed(() => ({ valor: '' as const, rotulo: t('faturamentoSus.retorno.todos') }));
const opcoesFiltroInstrumento = computed(() => [todos.value, ...opcoesInstrumento.value]);
const opcoesSituacao = computed(() => [
  todos.value,
  ...SITUACOES_RETORNO_SUS.map((s) => ({ valor: s, rotulo: t(`faturamentoSus.retorno.situacoes.${s}`) })),
]);
const opcoesTratamento = computed(() => [
  todos.value,
  ...TRATAMENTOS_RETORNO_SUS.map((s) => ({ valor: s, rotulo: t(`faturamentoSus.retorno.tratamentos.${s}`) })),
]);
const competenciaFiltro = computed(() =>
  /^(20\d{2})(0[1-9]|1[0-2])$/.test(filtro.competencia.trim()) ? filtro.competencia.trim() : '',
);
const lista = useQuery({
  queryKey: computed(() => [
    'sus',
    'retorno',
    filtro.instrumento,
    competenciaFiltro.value,
    filtro.situacao,
    filtro.tratamento,
    pagina.value,
  ]),
  queryFn: () =>
    lerRetornosSus({
      ...(filtro.instrumento ? { instrumento: filtro.instrumento } : {}),
      ...(competenciaFiltro.value ? { competencia: competenciaFiltro.value } : {}),
      ...(filtro.situacao ? { situacao: filtro.situacao } : {}),
      ...(filtro.tratamento ? { tratamento: filtro.tratamento } : {}),
      pagina: pagina.value - 1,
      porPagina: POR_PAGINA,
    }),
});

const tratando = ref<number | null>(null);
const justificativa = ref('');
async function tratar(r: RetornoSusLido, decisao: 'reapresentar' | 'aceita'): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    await tratarRetornoSus({
      retorno: r.id,
      versao: r.versao,
      decisao,
      justificativa: justificativa.value.trim(),
    });
    mensagem.value = t(`faturamentoSus.retorno.tratado.${decisao}`, { identificacao: r.identificacao });
    tratando.value = null;
    justificativa.value = '';
    await cliente.invalidateQueries({ queryKey: ['sus'] });
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}
const moeda = (v: number | null) =>
  v === null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const podeTratar = (r: RetornoSusLido) =>
  podeImportar.value &&
  liberados.value[r.instrumento] &&
  r.tratamento === 'pendente' &&
  r.situacao !== 'aprovada';
</script>

<template>
  <section class="tela" aria-labelledby="retorno-titulo" data-testid="tela-retorno-sus">
    <h1 id="retorno-titulo">{{ t('faturamentoSus.retorno.titulo') }}</h1>
    <p>{{ t('faturamentoSus.retorno.explicacao') }}</p>
    <nav class="linha" :aria-label="t('faturamentoSus.aih.atalhos')">
      <RouterLink to="/faturamento/sus/aih">{{ t('faturamentoSus.retorno.irAih') }}</RouterLink>
      <RouterLink to="/faturamento/sus/bpa">{{ t('faturamentoSus.retorno.irBpa') }}</RouterLink>
    </nav>
    <MensagemErro v-if="painel.isError.value" :erro="painel.error.value" />
    <template v-else-if="painel.data.value">
      <SanteAlerta
        v-if="!liberados.aih && !liberados.bpa"
        :texto="t('faturamentoSus.retorno.desligado')"
        variante="aviso"
        data-testid="retorno-desligado"
      />
      <section
        v-if="podeImportar && (liberados.aih || liberados.bpa)"
        aria-labelledby="retorno-importar-titulo"
        data-testid="retorno-importar"
      >
        <h2 id="retorno-importar-titulo">{{ t('faturamentoSus.retorno.importar') }}</h2>
        <p class="pequeno">{{ t('faturamentoSus.retorno.formato') }}</p>
        <code class="pequeno">{{ CABECALHO }}</code>
        <form class="grade" data-testid="form-retorno" @submit.prevent="importar">
          <SanteSelecao
            v-model="entrada.instrumento"
            :rotulo="t('faturamentoSus.retorno.instrumento')"
            :opcoes="opcoesInstrumento"
            data-testid="retorno-instrumento"
          />
          <SanteCampoTexto
            v-model="entrada.competencia"
            :rotulo="t('faturamentoSus.retorno.competencia')"
            :max-bytes="6"
            data-testid="retorno-competencia"
          />
          <label class="arquivo">
            {{ t('faturamentoSus.retorno.arquivo') }}
            <input
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              data-testid="retorno-arquivo"
              @change="escolherArquivo"
            />
          </label>
          <SanteCampoTexto
            v-model="entrada.nome"
            :rotulo="t('faturamentoSus.retorno.nome')"
            :max-bytes="60"
            data-testid="retorno-nome"
          />
          <SanteCampoTexto
            v-model="entrada.conteudo"
            :rotulo="t('faturamentoSus.retorno.conteudo')"
            :max-bytes="900000"
            multilinha
            data-testid="retorno-conteudo"
          />
          <SanteBotao
            :rotulo="t('faturamentoSus.retorno.importarBotao')"
            tipo="submit"
            :desabilitado="ocupado || !entradaValida"
            data-testid="botao-importar-retorno"
          />
        </form>
        <p v-if="aviso" role="alert">{{ aviso }}</p>
      </section>
      <p v-if="mensagem" role="status" data-testid="mensagem-retorno">{{ mensagem }}</p>
      <ErroFaturamento v-if="erro" :erro="erro" />
      <section v-if="resultado" aria-labelledby="retorno-resultado-titulo" data-testid="retorno-resultado">
        <h2 id="retorno-resultado-titulo">{{ t('faturamentoSus.retorno.resultado') }}</h2>
        <p>
          {{
            t('faturamentoSus.retorno.resumo', {
              linhas: resultado.linhas,
              casadas: resultado.casadas,
              fora: resultado.naoCasadas.length,
              erros: resultado.erros.length,
              repetidas: resultado.repetidas,
              glosado: moeda(resultado.valorGlosado),
            })
          }}
        </p>
        <ul v-if="resultado.naoCasadas.length" data-testid="retorno-nao-casadas">
          <li v-for="x in resultado.naoCasadas" :key="x.linha">
            {{ t('faturamentoSus.retorno.naoCasada', { linha: x.linha, identificacao: x.identificacao }) }}
          </li>
        </ul>
        <ul v-if="resultado.erros.length" data-testid="retorno-erros">
          <li v-for="x in resultado.erros" :key="x.linha">
            {{
              t('faturamentoSus.retorno.erroLinha', {
                linha: x.linha,
                problema: t(`faturamentoSus.retorno.problemas.${x.problema}`),
              })
            }}
          </li>
        </ul>
        <p class="pequeno">{{ t('faturamentoSus.retorno.hash', { hash: resultado.hash }) }}</p>
      </section>

      <section aria-labelledby="retorno-lista-titulo" data-testid="retorno-lista">
        <h2 id="retorno-lista-titulo">{{ t('faturamentoSus.retorno.lista') }}</h2>
        <div class="linha">
          <SanteSelecao
            v-model="filtro.instrumento"
            :rotulo="t('faturamentoSus.retorno.instrumento')"
            :opcoes="opcoesFiltroInstrumento"
          />
          <SanteCampoTexto
            v-model="filtro.competencia"
            :rotulo="t('faturamentoSus.retorno.competencia')"
            :max-bytes="6"
          />
          <SanteSelecao
            v-model="filtro.situacao"
            :rotulo="t('faturamentoSus.retorno.situacao')"
            :opcoes="opcoesSituacao"
          />
          <SanteSelecao
            v-model="filtro.tratamento"
            :rotulo="t('faturamentoSus.retorno.tratamento')"
            :opcoes="opcoesTratamento"
            data-testid="retorno-filtro-tratamento"
          />
        </div>
        <MensagemErro v-if="lista.isError.value" :erro="lista.error.value" />
        <p v-else-if="!lista.data.value">{{ t('faturamentoSus.carregando') }}</p>
        <p v-else-if="lista.data.value.itens.length === 0" data-testid="retorno-vazio">
          {{ t('faturamentoSus.retorno.nenhum') }}
        </p>
        <template v-else>
          <p class="pequeno" data-testid="retorno-totais">
            {{
              t('faturamentoSus.retorno.totais', {
                n: lista.data.value.total,
                glosado: moeda(lista.data.value.valorGlosado),
              })
            }}
          </p>
          <table data-testid="tabela-retorno">
            <thead>
              <tr>
                <th scope="col">{{ t('faturamentoSus.retorno.instrumento') }}</th>
                <th scope="col">{{ t('faturamentoSus.retorno.competencia') }}</th>
                <th scope="col">{{ t('faturamentoSus.retorno.identificacao') }}</th>
                <th scope="col">{{ t('faturamentoSus.retorno.situacao') }}</th>
                <th scope="col">{{ t('faturamentoSus.retorno.motivo') }}</th>
                <th scope="col">{{ t('faturamentoSus.retorno.apresentado') }}</th>
                <th scope="col">{{ t('faturamentoSus.retorno.aprovado') }}</th>
                <th scope="col">{{ t('faturamentoSus.retorno.glosado') }}</th>
                <th scope="col">{{ t('faturamentoSus.retorno.tratamento') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in lista.data.value.itens" :key="r.id" :data-testid="`retorno-${r.id}`">
                <td>{{ t(`faturamentoSus.instrumentos.${r.instrumento}`) }}</td>
                <td>{{ r.competencia }}</td>
                <td>
                  {{ r.identificacao }} <span class="pequeno">{{ r.procedimento ?? '' }}</span>
                </td>
                <td>{{ t(`faturamentoSus.retorno.situacoes.${r.situacao}`) }}</td>
                <td>{{ r.motivo ?? '—' }}</td>
                <td>{{ moeda(r.valorApresentado) }}</td>
                <td>{{ moeda(r.valorAprovado) }}</td>
                <td>{{ moeda(r.valorGlosado) }}</td>
                <td>
                  {{ t(`faturamentoSus.retorno.tratamentos.${r.tratamento}`) }}
                  <span v-if="r.tratadoPor" class="pequeno"
                    >{{ r.tratadoPor }} {{ r.tratadoEm ? carimboBr(r.tratadoEm) : '' }}</span
                  >
                  <template v-if="podeTratar(r)">
                    <SanteBotao
                      v-if="tratando !== r.id"
                      :rotulo="t('faturamentoSus.retorno.decidir')"
                      variante="secundario"
                      :data-testid="`botao-decidir-${r.id}`"
                      @acionar="tratando = r.id"
                    />
                    <form v-else class="linha" @submit.prevent>
                      <SanteCampoTexto
                        v-model="justificativa"
                        :rotulo="t('faturamentoSus.retorno.justificativa')"
                        :max-bytes="500"
                        :data-testid="`retorno-justificativa-${r.id}`"
                      />
                      <SanteBotao
                        v-if="r.instrumento === 'bpa' || r.situacao === 'rejeitada'"
                        :rotulo="t('faturamentoSus.retorno.reapresentar')"
                        :desabilitado="ocupado || justificativa.trim().length < 10"
                        :data-testid="`botao-reapresentar-${r.id}`"
                        @acionar="tratar(r, 'reapresentar')"
                      />
                      <SanteBotao
                        :rotulo="t('faturamentoSus.retorno.aceitar')"
                        variante="secundario"
                        :desabilitado="ocupado || justificativa.trim().length < 10"
                        :data-testid="`botao-aceitar-${r.id}`"
                        @acionar="tratar(r, 'aceita')"
                      />
                    </form>
                  </template>
                </td>
              </tr>
            </tbody>
          </table>
          <PaginacaoCadastro
            v-model="pagina"
            :total="lista.data.value.total"
            :por-pagina="POR_PAGINA"
            :rotulo="t('faturamentoSus.retorno.lista')"
          />
        </template>
      </section>
    </template>
  </section>
</template>

<style scoped>
table {
  border-collapse: collapse;
  width: 100%;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
  vertical-align: top;
}
.linha {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
  margin: var(--sgh-espaco-2) 0;
}
.grade {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
  gap: var(--sgh-espaco-2);
  align-items: end;
  margin: var(--sgh-espaco-2) 0;
}
.arquivo {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-1);
}
.pequeno {
  display: block;
  font-size: var(--sgh-fonte-pequena);
}
</style>
