<script setup lang="ts">
// Licitação e pregão (M55, etapa 4; ficha, seção 7: `/suprimentos/licitacao`; regras 9 e 12; cap-07 §7.3; DP-13). O
// painel por etapa (cada número filtra a lista) com os processos em andamento e as sessões dos próximos 7 dias, os
// filtros (etapa, modalidade, número ou objeto), a lista paginada com o estimado (oculto no orçamento sigiloso para quem
// não conduz), o termo de referência de um novo processo e o processo aberto (LicitacaoDetalhePainel), mais a consulta
// dos pedidos de compra já marcados como licitação no cadastro de pedidos. Construída e desligada por estabelecimento
// (chave `licitacao`): desligada, a tela é só consulta e mostra o motivo. A leitura pela permissão
// suprimentos.licitacao.ler; conduzir e homologar pelas suas permissões (o servidor confere).
import { ETAPAS_LICITACAO, type EtapaLicitacao, MODALIDADES_LICITACAO } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  type FiltroTelaLicitacoes,
  lerPedidosMarcadosLicitacao,
  listarLicitacoesTela,
} from '../api-licitacao.js';
import ErroSuprimentos from '../componentes/ErroSuprimentos.vue';
import LicitacaoDetalhePainel from '../componentes/LicitacaoDetalhePainel.vue';
import LicitacaoFormulario from '../componentes/LicitacaoFormulario.vue';
import {
  podeLicitacao,
  rotuloCriterio,
  rotuloEtapa,
  rotuloModalidade,
} from '../componentes/licitacao-tela.js';
import { data, reais } from '../usar-suprimentos.js';
import './estilo-opme.css';

const { t } = useI18n();
const k = (s: string, p?: Record<string, unknown>) => t(`licitacao.${s}`, p ?? {});
type Aba = 'processos' | 'marcados';
const aba = ref<Aba>('processos');
const edicao = reactive({ etapa: null as string | null, modalidade: null as string | null, termo: '' });
const aplicado = ref<FiltroTelaLicitacoes>({ pagina: 1 });
const lista = useQuery({
  queryKey: computed(() => ['licitacoes', 'lista', aplicado.value]),
  queryFn: () => listarLicitacoesTela(aplicado.value),
});
const marcados = useQuery({
  queryKey: ['licitacoes', 'pedidos-marcados'],
  queryFn: lerPedidosMarcadosLicitacao,
  enabled: computed(() => aba.value === 'marcados'),
});
const dados = computed(() => lista.data.value ?? null);
const conduz = computed(() => podeLicitacao(dados.value?.gravacao, 'conduzir'));
const aberto = ref<number | null>(null);
const novo = ref(false);
const mensagem = ref('');

const etapas = [
  { valor: null as string | null, rotulo: k('filtro.todasEtapas') },
  ...ETAPAS_LICITACAO.map((e) => ({ valor: e.codigo as string | null, rotulo: e.rotulo })),
];
const modalidades = [
  { valor: null as string | null, rotulo: k('filtro.todasModalidades') },
  ...MODALIDADES_LICITACAO.map((m) => ({ valor: m.codigo as string | null, rotulo: m.rotulo })),
];

function filtrar(pagina = 1): void {
  aplicado.value = {
    etapa: edicao.etapa,
    modalidade: edicao.modalidade,
    termo: edicao.termo.trim() || null,
    pagina,
  };
}
function limpar(): void {
  Object.assign(edicao, { etapa: null, modalidade: null, termo: '' });
  filtrar();
}
function porEtapa(e: EtapaLicitacao): void {
  edicao.etapa = e;
  filtrar();
}
const cartoes = computed(() =>
  ETAPAS_LICITACAO.map((e) => e.codigo).filter((e) => (dados.value?.painel.porEtapa[e] ?? 0) > 0),
);
const pedidosDistintos = computed(
  () => new Set((marcados.data.value?.itens ?? []).map((x) => `${x.ano}/${x.documento}`)).size,
);

function abrir(id: number): void {
  novo.value = false;
  aberto.value = id;
  mensagem.value = '';
}
async function cadastrado(id: number, m: string): Promise<void> {
  novo.value = false;
  mensagem.value = m;
  await lista.refetch();
  aberto.value = id;
}
</script>

<template>
  <section class="tela-opme tela-licitacao" aria-labelledby="lic-titulo" data-testid="tela-licitacao">
    <div class="barra">
      <h1 id="lic-titulo">{{ k('titulo') }}</h1>
      <SanteBotao
        v-if="dados && !novo && aba === 'processos'"
        :rotulo="k('novo')"
        :desabilitado="!conduz"
        data-testid="lic-novo"
        @acionar="((novo = true), (aberto = null))"
      />
    </div>
    <div class="abas" role="tablist">
      <SanteBotao
        v-for="a in ['processos', 'marcados'] as Aba[]"
        :key="a"
        role="tab"
        :aria-selected="aba === a"
        variante="secundario"
        :rotulo="k(`abas.${a}`)"
        :data-testid="`lic-aba-${a}`"
        @acionar="aba = a"
      />
    </div>

    <template v-if="aba === 'marcados'">
      <p class="secundario">{{ k('marcados.explicacao') }}</p>
      <ErroSuprimentos v-if="marcados.isError.value" :erro="marcados.error.value" />
      <p v-else-if="!marcados.data.value" role="status">{{ k('carregando') }}</p>
      <p v-else-if="marcados.data.value.itens.length === 0" data-testid="lic-marcados-vazio">
        {{ k('marcados.nenhum') }}
      </p>
      <template v-else>
        <p data-testid="lic-marcados-total">
          {{ k('marcados.total', { n: marcados.data.value.itens.length, p: pedidosDistintos }) }}
        </p>
        <div class="rolagem">
          <table class="grade" data-testid="lic-marcados">
            <thead>
              <tr>
                <th scope="col">{{ k('marcados.colPedido') }}</th>
                <th scope="col">{{ k('marcados.colDocumento') }}</th>
                <th scope="col">{{ k('marcados.colDescricao') }}</th>
                <th scope="col">{{ k('marcados.colFornecedor') }}</th>
                <th scope="col">{{ k('marcados.colData') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="x in marcados.data.value.itens" :key="`${x.ano}-${x.documento}-${x.sequencia}`">
                <td>{{ x.pedido ?? '—' }}</td>
                <td>{{ x.ano }}/{{ x.documento }} · {{ x.sequencia }}</td>
                <td>{{ x.descricao }}</td>
                <td>{{ x.fornecedor ?? '—' }}</td>
                <td>{{ data(x.data) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </template>

    <template v-else>
      <ErroSuprimentos v-if="lista.isError.value" :erro="lista.error.value" />
      <p v-else-if="!dados" role="status">{{ k('carregando') }}</p>
      <template v-else>
        <SanteAlerta
          v-if="!dados.gravacao.ligada"
          variante="aviso"
          :texto="dados.gravacao.motivo ?? k('emConsulta')"
          data-testid="lic-desligado"
        />
        <p v-if="mensagem" role="status" data-testid="lic-mensagem">{{ mensagem }}</p>

        <h2 class="sgh-visualmente-oculto">{{ k('painel.titulo') }}</h2>
        <ul class="cartoes-licitacao" data-testid="lic-painel">
          <li>
            <span class="secundario">{{ k('painel.emAndamento') }}</span>
            <strong data-testid="lic-painel-andamento">{{ dados.painel.emAndamento }}</strong>
          </li>
          <li>
            <span class="secundario">{{ k('painel.sessoesProximas') }}</span>
            <strong data-testid="lic-painel-sessoes">{{ dados.painel.sessoesProximas }}</strong>
          </li>
          <li v-for="e in cartoes" :key="e">
            <SanteBotao
              variante="texto"
              :rotulo="`${rotuloEtapa(e)}: ${dados.painel.porEtapa[e] ?? 0}`"
              :data-testid="`lic-painel-${e}`"
              @acionar="porEtapa(e)"
            />
          </li>
        </ul>

        <LicitacaoFormulario v-if="novo" :pode="conduz" @gravado="cadastrado" @cancelar="novo = false" />

        <LicitacaoDetalhePainel
          v-else-if="aberto !== null"
          :key="aberto"
          :id="aberto"
          @fechar="aberto = null"
          @mudou="lista.refetch()"
        />

        <template v-else>
          <form
            class="barra"
            :aria-label="k('filtro.titulo')"
            data-testid="lic-filtros"
            @submit.prevent="filtrar()"
          >
            <SanteSelecao
              v-model="edicao.etapa"
              :rotulo="k('filtro.etapa')"
              :opcoes="etapas"
              data-testid="lic-f-etapa"
            />
            <SanteSelecao
              v-model="edicao.modalidade"
              :rotulo="k('filtro.modalidade')"
              :opcoes="modalidades"
              data-testid="lic-f-modalidade"
            />
            <span class="campo">
              <label for="lic-f-termo">{{ k('filtro.termo') }}</label>
              <input
                id="lic-f-termo"
                v-model="edicao.termo"
                type="search"
                maxlength="60"
                data-testid="lic-f-termo"
              />
            </span>
            <SanteBotao tipo="submit" :rotulo="k('filtro.aplicar')" data-testid="lic-f-aplicar" />
            <SanteBotao
              variante="secundario"
              :rotulo="k('filtro.limpar')"
              data-testid="lic-f-limpar"
              @acionar="limpar"
            />
          </form>

          <p v-if="dados.itens.length === 0" data-testid="lic-vazio">{{ k('lista.nenhum') }}</p>
          <div v-else class="rolagem">
            <table class="grade" data-testid="lic-lista">
              <thead>
                <tr>
                  <th scope="col">{{ k('lista.colNumero') }}</th>
                  <th scope="col">{{ k('lista.colModalidade') }}</th>
                  <th scope="col">{{ k('lista.colObjeto') }}</th>
                  <th scope="col">{{ k('lista.colEtapa') }}</th>
                  <th scope="col">{{ k('lista.colEstimado') }}</th>
                  <th scope="col">{{ k('lista.colAbertura') }}</th>
                  <th scope="col">{{ k('lista.colAgente') }}</th>
                  <th scope="col">{{ k('lista.colAcoes') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="x in dados.itens"
                  :key="x.id"
                  :data-testid="`lic-linha-${x.id}`"
                  :data-etapa="x.etapa"
                >
                  <td>
                    {{ x.numero }}<br /><span class="secundario">{{ k('lista.itens', { n: x.itens }) }}</span>
                  </td>
                  <td>
                    {{ rotuloModalidade(x.modalidade) }}<br /><span class="secundario">{{
                      rotuloCriterio(x.criterio)
                    }}</span>
                  </td>
                  <td>{{ x.objeto }}</td>
                  <td>{{ rotuloEtapa(x.etapa) }}</td>
                  <td :data-testid="`lic-estimado-${x.id}`">
                    {{ x.valorEstimado === null ? '—' : reais(x.valorEstimado) }}
                  </td>
                  <td>{{ x.dataAbertura ? data(x.dataAbertura) : '—' }}</td>
                  <td>{{ x.agente }}</td>
                  <td>
                    <SanteBotao
                      variante="secundario"
                      :rotulo="k('lista.abrir', { numero: x.numero })"
                      :data-testid="`lic-abrir-${x.id}`"
                      @acionar="abrir(x.id)"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="dados.cortada" class="secundario">{{ k('lista.cortada') }}</p>
          <div v-if="dados.pagina > 1 || dados.cortada" class="barra">
            <SanteBotao
              variante="secundario"
              :rotulo="k('lista.anterior')"
              :desabilitado="dados.pagina <= 1"
              data-testid="lic-pag-anterior"
              @acionar="filtrar(dados.pagina - 1)"
            />
            <span>{{ k('lista.pagina', { n: dados.pagina }) }}</span>
            <SanteBotao
              variante="secundario"
              :rotulo="k('lista.proxima')"
              :desabilitado="!dados.cortada"
              data-testid="lic-pag-proxima"
              @acionar="filtrar(dados.pagina + 1)"
            />
          </div>
        </template>
      </template>
    </template>
  </section>
</template>

<style scoped>
.cartoes-licitacao,
.tela-licitacao :deep(.proximas-licitacao) {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  list-style: none;
  margin: 0;
  padding: 0;
}
.cartoes-licitacao li {
  display: flex;
  align-items: center;
  gap: var(--sgh-espaco-1);
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda);
  border-radius: var(--sgh-raio, 4px);
}
.tela-licitacao :deep(.proximas-licitacao) {
  flex-direction: column;
}
.tela-licitacao :deep(.campo-largo) {
  display: flex;
  flex-direction: column;
  max-width: 60rem;
}
.tela-licitacao :deep(.resumo-licitacao) {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
  gap: var(--sgh-espaco-2);
}
.tela-licitacao :deep(.resumo-licitacao dt) {
  color: var(--sgh-texto-secundario);
}
.tela-licitacao :deep(.resumo-licitacao dd) {
  margin: 0;
}
.tela-licitacao :deep(.campo-usuario),
.tela-licitacao :deep(.itens-licitacao) {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda);
}
.tela-licitacao :deep(.formulario-licitacao) {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
  margin-block: var(--sgh-espaco-3, 1rem);
}
</style>
