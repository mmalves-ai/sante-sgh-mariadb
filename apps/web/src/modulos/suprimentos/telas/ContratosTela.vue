<script setup lang="ts">
// Contratos com fornecedores (M55, etapa 3; ficha, seção 7: `/suprimentos/contratos`; regras 5 a 8; cap-07 §7.3). O
// painel da situação (ativos, a vencer em 90, 60 e 30 dias, vencidos, avaliação vencida e saldo excedido: cada número
// filtra a lista), os filtros (situação, vigência, fornecedor com busca, número ou objeto), a lista paginada com a
// vigência, o valor total e o saldo, o cadastro do contrato e o contrato aberto (ContratoDetalhePainel). A leitura pela
// permissão suprimentos.contrato.ler; as ações só com a funcionalidade ligada e a permissão de agir (o servidor confere).
import { FAIXAS_VIGENCIA, type FaixaVigencia, SITUACOES_CONTRATO_FORNECEDOR } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  buscarFornecedoresContrato,
  type FiltroTelaContratos,
  listarContratosTela,
} from '../api-contrato.js';
import BuscaCodigoNome from '../componentes/BuscaCodigoNome.vue';
import ContratoDetalhePainel from '../componentes/ContratoDetalhePainel.vue';
import ContratoFormulario from '../componentes/ContratoFormulario.vue';
import { podeOperacao, rotuloFaixa } from '../componentes/contrato-tela.js';
import ErroSuprimentos from '../componentes/ErroSuprimentos.vue';
import { data, reais } from '../usar-suprimentos.js';
import './estilo-opme.css';

const { t } = useI18n();
const k = (s: string, p?: Record<string, unknown>) => t(`contratoFornecedor.${s}`, p ?? {});
const edicao = reactive({
  situacao: 'ativo',
  faixa: null as FaixaVigencia | null,
  fornecedor: null as number | null,
  termo: '',
});
const aplicado = ref<FiltroTelaContratos>({ situacao: 'ativo', pagina: 1 });
const lista = useQuery({
  queryKey: computed(() => ['contratos', 'lista', aplicado.value]),
  queryFn: () => listarContratosTela(aplicado.value),
});
const dados = computed(() => lista.data.value ?? null);
const podeEditar = computed(() => podeOperacao(dados.value?.gravacao, 'editar'));
const aberto = ref<number | null>(null);
const novo = ref(false);
const mensagem = ref('');

const situacoes = [
  ...SITUACOES_CONTRATO_FORNECEDOR.map((s) => ({ valor: s.codigo as string, rotulo: s.rotulo })),
  { valor: 'todos', rotulo: k('filtro.todas') },
];
const faixas = [
  { valor: null as FaixaVigencia | null, rotulo: k('filtro.todasFaixas') },
  ...FAIXAS_VIGENCIA.map((f) => ({ valor: f.codigo as FaixaVigencia | null, rotulo: f.rotulo })),
];
const buscarFornecedor = (termo: string) => buscarFornecedoresContrato(termo);

function filtrar(pagina = 1): void {
  aplicado.value = {
    situacao: edicao.situacao,
    faixa: edicao.faixa,
    fornecedor: edicao.fornecedor,
    termo: edicao.termo.trim() || null,
    pagina,
  };
}
function limpar(): void {
  Object.assign(edicao, { situacao: 'ativo', faixa: null, fornecedor: null, termo: '' });
  filtrar();
}
function porFaixa(f: FaixaVigencia): void {
  edicao.faixa = f;
  edicao.situacao = f === 'encerrado' ? 'todos' : 'ativo';
  filtrar();
}
const cartoes: FaixaVigencia[] = ['vigente', 'vence-90', 'vence-60', 'vence-30', 'vencido', 'a-iniciar'];

function vencimento(d: number | null, faixa: string): string {
  if (d === null || faixa === 'encerrado') return '';
  return d >= 0 ? k('lista.dias', { n: d }) : k('lista.vencidoHa', { n: -d });
}
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
  <section class="tela-opme tela-contratos" aria-labelledby="ctr-titulo" data-testid="tela-contratos">
    <div class="barra">
      <h1 id="ctr-titulo">{{ k('titulo') }}</h1>
      <SanteBotao
        v-if="dados && !novo"
        :rotulo="k('novo')"
        :desabilitado="!podeEditar"
        data-testid="ctr-novo"
        @acionar="((novo = true), (aberto = null))"
      />
    </div>
    <ErroSuprimentos v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!dados" role="status">{{ k('carregando') }}</p>
    <template v-else>
      <SanteAlerta
        v-if="!dados.gravacao.ligada"
        variante="aviso"
        :texto="dados.gravacao.motivo ?? k('emConsulta')"
        data-testid="ctr-desligado"
      />
      <p v-if="mensagem" role="status" data-testid="ctr-mensagem">{{ mensagem }}</p>

      <h2 class="sgh-visualmente-oculto">{{ k('painel.titulo') }}</h2>
      <ul class="cartoes-contrato" data-testid="ctr-painel">
        <li>
          <span class="secundario">{{ k('painel.ativos') }}</span>
          <strong data-testid="ctr-painel-ativos">{{ dados.painel.ativos }}</strong>
        </li>
        <li v-for="f in cartoes" :key="f">
          <SanteBotao
            variante="texto"
            :rotulo="`${rotuloFaixa(f)}: ${dados.painel.porFaixa[f] ?? 0}`"
            :data-testid="`ctr-painel-${f}`"
            @acionar="porFaixa(f)"
          />
        </li>
        <li>
          <span class="secundario">{{ k('painel.avaliacaoVencida') }}</span>
          <strong data-testid="ctr-painel-avaliacao">{{ dados.painel.avaliacaoVencida }}</strong>
        </li>
        <li>
          <span class="secundario">{{ k('painel.saldoExcedido') }}</span>
          <strong data-testid="ctr-painel-excedido">{{ dados.painel.saldoExcedido }}</strong>
        </li>
      </ul>

      <ContratoFormulario v-if="novo" :pode="podeEditar" @gravado="cadastrado" @cancelar="novo = false" />

      <ContratoDetalhePainel
        v-else-if="aberto !== null"
        :key="aberto"
        :id="aberto"
        :hoje="dados.hoje"
        @fechar="aberto = null"
        @mudou="lista.refetch()"
      />

      <template v-else>
        <form
          class="barra"
          :aria-label="k('filtro.titulo')"
          data-testid="ctr-filtros"
          @submit.prevent="filtrar()"
        >
          <SanteSelecao
            v-model="edicao.situacao"
            :rotulo="k('filtro.situacao')"
            :opcoes="situacoes"
            data-testid="ctr-f-situacao"
          />
          <SanteSelecao
            v-model="edicao.faixa"
            :rotulo="k('filtro.faixa')"
            :opcoes="faixas"
            data-testid="ctr-f-faixa"
          />
          <BuscaCodigoNome
            v-model="edicao.fornecedor"
            :rotulo="k('filtro.fornecedor')"
            :rotulo-buscar="k('filtro.buscarFornecedor')"
            :rotulo-escolhido="k('filtro.fornecedorEscolhido')"
            :rotulo-nenhum="k('filtro.fornecedorNenhum')"
            :rotulo-vazio="k('filtro.todosFornecedores')"
            :buscar="buscarFornecedor"
            testid="ctr-f-fornecedor"
          />
          <span class="campo">
            <label for="ctr-f-termo">{{ k('filtro.termo') }}</label>
            <input
              id="ctr-f-termo"
              v-model="edicao.termo"
              type="search"
              maxlength="60"
              data-testid="ctr-f-termo"
            />
          </span>
          <SanteBotao tipo="submit" :rotulo="k('filtro.aplicar')" data-testid="ctr-f-aplicar" />
          <SanteBotao
            variante="secundario"
            :rotulo="k('filtro.limpar')"
            data-testid="ctr-f-limpar"
            @acionar="limpar"
          />
        </form>

        <p v-if="dados.itens.length === 0" data-testid="ctr-vazio">{{ k('lista.nenhum') }}</p>
        <div v-else class="rolagem">
          <table class="grade" data-testid="ctr-lista">
            <thead>
              <tr>
                <th scope="col">{{ k('lista.colNumero') }}</th>
                <th scope="col">{{ k('lista.colFornecedor') }}</th>
                <th scope="col">{{ k('lista.colObjeto') }}</th>
                <th scope="col">{{ k('lista.colVigencia') }}</th>
                <th scope="col">{{ k('lista.colValor') }}</th>
                <th scope="col">{{ k('lista.colSaldo') }}</th>
                <th scope="col">{{ k('lista.colResponsaveis') }}</th>
                <th scope="col">{{ k('lista.colAcoes') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="x in dados.itens"
                :key="x.id"
                :data-testid="`ctr-linha-${x.id}`"
                :data-faixa="x.faixa"
              >
                <td>
                  {{ x.numero }}<span v-if="x.critico" class="secundario"> · {{ k('lista.critico') }}</span>
                </td>
                <td>{{ x.fornecedor }} · {{ x.fornecedorNome }}</td>
                <td>{{ x.objeto }}</td>
                <td>
                  {{ k('detalhe.vigenciaTexto', { inicio: data(x.inicio), fim: data(x.fim) }) }}
                  <br />
                  <span :class="x.faixa === 'vencido' || x.faixa === 'vence-30' ? 'alerta' : 'secundario'">
                    {{ rotuloFaixa(x.faixa) }} {{ vencimento(x.diasParaVencer, x.faixa) }}
                  </span>
                </td>
                <td>{{ reais(x.valorTotal) }}</td>
                <td :class="x.saldo < 0 ? 'alerta' : ''" :data-testid="`ctr-saldo-${x.id}`">
                  {{ reais(x.saldo) }}
                </td>
                <td>{{ k('lista.responsaveis', { gestor: x.gestor, fiscal: x.fiscal }) }}</td>
                <td>
                  <SanteBotao
                    variante="secundario"
                    :rotulo="k('lista.abrir', { numero: x.numero })"
                    :data-testid="`ctr-abrir-${x.id}`"
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
            data-testid="ctr-pag-anterior"
            @acionar="filtrar(dados.pagina - 1)"
          />
          <span>{{ k('lista.pagina', { n: dados.pagina }) }}</span>
          <SanteBotao
            variante="secundario"
            :rotulo="k('lista.proxima')"
            :desabilitado="!dados.cortada"
            data-testid="ctr-pag-proxima"
            @acionar="filtrar(dados.pagina + 1)"
          />
        </div>
      </template>
    </template>
  </section>
</template>

<style scoped>
.cartoes-contrato {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  list-style: none;
  margin: 0;
  padding: 0;
}
.cartoes-contrato li {
  display: flex;
  align-items: center;
  gap: var(--sgh-espaco-1);
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda);
  border-radius: var(--sgh-raio, 4px);
}
.tela-contratos :deep(.campo-largo) {
  display: flex;
  flex-direction: column;
  max-width: 60rem;
}
.tela-contratos :deep(.resumo-contrato) {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
  gap: var(--sgh-espaco-2);
}
.tela-contratos :deep(.resumo-contrato dt) {
  color: var(--sgh-texto-secundario);
}
.tela-contratos :deep(.resumo-contrato dd) {
  margin: 0;
}
.tela-contratos :deep(.campo-usuario) {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda);
}
</style>
