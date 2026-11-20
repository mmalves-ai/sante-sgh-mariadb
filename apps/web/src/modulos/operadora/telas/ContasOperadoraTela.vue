<script setup lang="ts">
// Contas médicas dos prestadores da operadora própria (M56, etapa 6, F5; rota `/operadora/contas`, aberta pelo atalho das
// telas da rede credenciada, da autorização e da cobrança; `operadora.conta.ler` / `.receber` / `.analisar` / `.pagar`):
//   - aba "Lotes recebidos" (quem lê as contas: atendimento e auditoria): as contagens, a lista dos lotes (busca pelo
//     protocolo ou pelo número do lote, prestador, competência, situação, vencidos, recursos pendentes; páginas), o
//     recebimento do lote em XML TISS e a ficha do lote (FichaConta), com a glosa, a análise, a devolução, o
//     demonstrativo e o recurso;
//   - aba "Pagamento aos prestadores" (a área financeira da operadora): só os valores (PagamentosPrestadores).
// A fatia nasce desligada (POL-3): a tela diz o motivo e não mostra os lotes.
import { CODIGOS_SITUACAO_CONTA_MEDICA, type ResultadoConta } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { lerApoioContas, lerContas } from '../api-contas.js';
import { dataBr } from '../componentes/f1/comum.js';
import FichaConta from '../componentes/f5/FichaConta.vue';
import PagamentosPrestadores from '../componentes/f5/PagamentosPrestadores.vue';
import ReceberConta from '../componentes/f5/ReceberConta.vue';

const { t } = useI18n();
const cliente = useQueryClient();
const apoio = useQuery({ queryKey: ['operadora', 'contas', 'apoio'], queryFn: () => lerApoioContas() });
const a = computed(() => apoio.data.value ?? null);
const ligada = computed(() => a.value?.ligada === true);
const podeLer = computed(() => a.value?.podeLer === true);
const podePagar = computed(() => a.value?.podePagar === true);
const semAcesso = computed(() => ligada.value && !podeLer.value && !podePagar.value);
type Aba = 'lotes' | 'pagamentos';
const aba = ref<Aba>('lotes');
const abas = computed<Aba[]>(() => [
  ...(podeLer.value ? (['lotes'] as const) : []),
  ...(podePagar.value ? (['pagamentos'] as const) : []),
]);
watch(abas, (v) => {
  if (v.length && !v.includes(aba.value)) aba.value = v[0]!;
});
const brl = (v: number) =>
  `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ── Lista (filtro aplicado + pilha de cursores) ────────────────────────────────────────────────
const busca = ref('');
const prestador = ref<number | null>(null);
const competencia = ref('');
const situacao = ref<string | null>(null);
const vencidas = ref(false);
const recursos = ref(false);
const aplicado = ref({
  busca: '',
  prestador: null as number | null,
  competencia: '',
  situacao: null as string | null,
  vencidas: false,
  recursos: false,
});
const cursores = ref<(number | null)[]>([null]);
const cursor = computed(() => cursores.value[cursores.value.length - 1] ?? null);
const lista = useQuery({
  queryKey: computed(() => ['operadora', 'contas', 'lista', aplicado.value, cursor.value]),
  queryFn: () =>
    lerContas({
      busca: aplicado.value.busca || null,
      prestador: aplicado.value.prestador,
      competencia: aplicado.value.competencia || null,
      situacao: aplicado.value.situacao,
      vencidas: aplicado.value.vencidas,
      recursos: aplicado.value.recursos,
      apos: cursor.value,
    }),
  enabled: computed(() => ligada.value && podeLer.value),
});
const competenciaValida = computed(
  () => !competencia.value.trim() || /^\d{4}-(0[1-9]|1[0-2])$/.test(competencia.value.trim()),
);
function filtrar(): void {
  if (!competenciaValida.value) return;
  aplicado.value = {
    busca: busca.value.trim(),
    prestador: prestador.value,
    competencia: competencia.value.trim(),
    situacao: situacao.value,
    vencidas: vencidas.value,
    recursos: recursos.value,
  };
  cursores.value = [null];
}
const opcoesSituacao = computed(() => [
  { valor: null as string | null, rotulo: t('operadoraContas.filtro.todas') },
  ...CODIGOS_SITUACAO_CONTA_MEDICA.map((s) => ({
    valor: s as string | null,
    rotulo: t(`operadoraContas.situacoes.${s}`),
  })),
]);
const opcoesPrestador = computed(() => [
  { valor: null as number | null, rotulo: t('operadoraContas.filtro.todos') },
  ...(a.value?.prestadores ?? []).map((p) => ({ valor: p.id as number | null, rotulo: p.nome })),
]);

// ── Ficha, recebimento e mensagens ───────────────────────────────────────────────────────────
const aberto = ref<number | null>(null);
const recebendo = ref(false);
const mensagem = ref<string | null>(null);
const avisos = ref<string[]>([]);
async function gravado(r: ResultadoConta): Promise<void> {
  recebendo.value = false;
  mensagem.value = r.mensagem;
  avisos.value = r.avisos;
  if (aba.value === 'lotes') aberto.value = r.id;
  await cliente.invalidateQueries({ queryKey: ['operadora', 'contas'] });
}
function abrir(id: number): void {
  mensagem.value = null;
  avisos.value = [];
  aberto.value = id;
}
watch(ligada, (v) => {
  if (!v) aberto.value = null;
});
</script>

<template>
  <section class="tela-operadora" aria-labelledby="ope-contas-titulo" data-testid="tela-operadora-contas">
    <h1 id="ope-contas-titulo">{{ t('operadoraContas.titulo') }}</h1>
    <p>{{ t('operadoraContas.texto') }}</p>

    <MensagemErro v-if="apoio.isError.value" :erro="apoio.error.value" />
    <p v-else-if="!a" role="status">{{ t('operadoraContas.carregando') }}</p>
    <div v-else-if="!ligada" data-testid="contas-desligada">
      <SanteAlerta :texto="a.motivo ?? t('operadoraContas.desligada')" variante="info" />
    </div>
    <p v-else-if="semAcesso" class="secundario" data-testid="contas-sem-acesso">
      {{ t('operadoraContas.semAcesso') }}
    </p>

    <template v-if="a && ligada && !semAcesso">
      <p v-if="mensagem" role="status" data-testid="contas-mensagem">{{ mensagem }}</p>
      <ul v-if="avisos.length" class="secundario" data-testid="contas-avisos">
        <li v-for="x in avisos" :key="x">{{ x }}</li>
      </ul>
      <div v-if="abas.length > 1" class="acoes" role="group" :aria-label="t('operadoraContas.titulo')">
        <SanteBotao
          v-for="x in abas"
          :key="x"
          :rotulo="t(`operadoraContas.abas.${x}`)"
          :variante="aba === x ? 'primario' : 'texto'"
          :aria-pressed="aba === x"
          :data-testid="`contas-aba-${x}`"
          @acionar="aba = x"
        />
      </div>

      <template v-if="aba === 'lotes' && podeLer">
        <p v-if="a.auditor" class="secundario" data-testid="contas-designacao">
          {{
            t('operadoraContas.voce', { categoria: t(`operadoraContas.categorias.${a.auditor.categoria}`) })
          }}
        </p>
        <SanteAlerta
          v-else-if="a.podeAnalisar"
          :texto="t('operadoraContas.semDesignacao')"
          variante="aviso"
        />

        <dl v-if="lista.data.value" class="totais" data-testid="contas-totais">
          <div v-for="(v, k) in lista.data.value.totais" :key="k" :data-testid="`contas-total-${k}`">
            <dt>{{ t(`operadoraContas.totais.${k}`) }}</dt>
            <dd>{{ k === 'valorEmAnalise' || k === 'valorAPagar' ? brl(v) : v }}</dd>
          </div>
        </dl>

        <section class="bloco" aria-labelledby="ope-contas-lista">
          <h2 id="ope-contas-lista">{{ t('operadoraContas.abas.lotes') }}</h2>
          <form class="campos" data-testid="contas-filtro" @submit.prevent="filtrar">
            <SanteCampoTexto
              id="contas-busca"
              v-model="busca"
              :rotulo="t('operadoraContas.filtro.busca')"
              :max-bytes="20"
            />
            <SanteSelecao
              v-model="prestador"
              :rotulo="t('operadoraContas.filtro.prestador')"
              :opcoes="opcoesPrestador"
              :busca="true"
              data-testid="contas-filtro-prestador"
            />
            <SanteCampoTexto
              id="contas-competencia"
              v-model="competencia"
              :rotulo="t('operadoraContas.filtro.competencia')"
              :max-bytes="7"
            />
            <SanteSelecao
              v-model="situacao"
              :rotulo="t('operadoraContas.filtro.situacao')"
              :opcoes="opcoesSituacao"
              data-testid="contas-filtro-situacao"
            />
            <label class="marcar"
              ><input v-model="vencidas" type="checkbox" data-testid="contas-filtro-vencidas" />
              {{ t('operadoraContas.filtro.vencidas') }}</label
            >
            <label class="marcar"
              ><input v-model="recursos" type="checkbox" data-testid="contas-filtro-recursos" />
              {{ t('operadoraContas.filtro.recursos') }}</label
            >
            <div class="acoes">
              <SanteBotao
                tipo="submit"
                :rotulo="t('operadoraContas.filtro.buscar')"
                data-testid="contas-buscar"
              />
              <SanteBotao
                v-if="a.podeReceber"
                variante="secundario"
                :rotulo="t('operadoraContas.receber.botao')"
                data-testid="contas-receber"
                @acionar="recebendo = true"
              />
            </div>
          </form>
          <MensagemErro v-if="lista.isError.value" :erro="lista.error.value" />
          <p v-else-if="!lista.data.value" role="status">{{ t('operadoraContas.carregando') }}</p>
          <p v-else-if="lista.data.value.itens.length === 0" data-testid="contas-vazia">
            {{ t('operadoraContas.nenhum') }}
          </p>
          <table v-else class="tabela" data-testid="contas-lista">
            <caption class="visualmente-oculto">
              {{
                t('operadoraContas.abas.lotes')
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t('operadoraContas.colunas.protocolo') }}</th>
                <th scope="col">{{ t('operadoraContas.colunas.lote') }}</th>
                <th scope="col">{{ t('operadoraContas.colunas.prestador') }}</th>
                <th scope="col">{{ t('operadoraContas.colunas.tipo') }}</th>
                <th scope="col">{{ t('operadoraContas.colunas.competencia') }}</th>
                <th scope="col">{{ t('operadoraContas.colunas.situacao') }}</th>
                <th scope="col">{{ t('operadoraContas.colunas.apresentado') }}</th>
                <th scope="col">{{ t('operadoraContas.colunas.glosado') }}</th>
                <th scope="col">{{ t('operadoraContas.colunas.saldo') }}</th>
                <th scope="col">{{ t('operadoraContas.colunas.prazo') }}</th>
                <th scope="col">
                  <span class="visualmente-oculto">{{ t('operadoraContas.colunas.acoes') }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="k in lista.data.value.itens" :key="k.id" :data-testid="`contas-lote-${k.id}`">
                <td>{{ k.protocolo }}</td>
                <td>{{ k.numeroLote }}</td>
                <td>{{ k.prestadorNome }}</td>
                <td>{{ t(`operadoraContas.tiposGuia.${k.tipoGuia}`) }} · {{ k.guias }}</td>
                <td>{{ k.competencia }}</td>
                <td :data-situacao="k.situacao">
                  {{ t(`operadoraContas.situacoes.${k.situacao}`) }}
                  <span v-if="k.recursosPendentes" class="secundario">
                    · {{ t('operadoraContas.recursoPendente') }}</span
                  >
                </td>
                <td>{{ brl(k.apresentado) }}</td>
                <td>{{ brl(k.glosado) }}</td>
                <td>{{ brl(k.saldo) }}</td>
                <td>
                  {{ dataBr(k.prazoPagamento) }}
                  <strong v-if="k.vencida"> · {{ t('operadoraContas.prazoVencido') }}</strong>
                </td>
                <td>
                  <SanteBotao
                    variante="texto"
                    :rotulo="t('operadoraContas.acoes.abrir', { protocolo: k.protocolo })"
                    :data-testid="`contas-abrir-${k.id}`"
                    @acionar="abrir(k.id)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
          <div v-if="lista.data.value" class="acoes">
            <SanteBotao
              v-if="cursores.length > 1"
              variante="secundario"
              :rotulo="t('operadoraContas.paginas.anterior')"
              @acionar="cursores = cursores.slice(0, -1)"
            />
            <SanteBotao
              v-if="lista.data.value.proxima"
              variante="secundario"
              :rotulo="t('operadoraContas.paginas.proxima')"
              @acionar="cursores = [...cursores, lista.data.value.proxima]"
            />
            <span v-else-if="cursores.length > 1" class="secundario">{{
              t('operadoraContas.paginas.fim')
            }}</span>
          </div>
        </section>

        <FichaConta
          v-if="aberto !== null"
          :key="aberto"
          :id="aberto"
          :apoio="a"
          @gravado="gravado"
          @fechar="aberto = null"
        />
      </template>

      <PagamentosPrestadores v-if="aba === 'pagamentos' && podePagar" :apoio="a" @gravado="gravado" />
    </template>

    <SanteDialogo v-model:visivel="recebendo" :titulo="t('operadoraContas.receber.titulo')" largura="40rem">
      <ReceberConta
        v-if="recebendo && a"
        :maximo-kilobytes="a.parametros.maximoKilobytes"
        @gravado="gravado"
        @cancelar="recebendo = false"
      />
    </SanteDialogo>
  </section>
</template>

<style scoped src="../estilo-operadora.css"></style>
<style scoped>
.totais {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
  gap: 0.75rem;
  margin: 0;
}
.totais div {
  display: grid;
  gap: 0.125rem;
}
.totais dd {
  font-size: 1.4rem;
  margin: 0;
}
.marcar {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  min-height: 24px;
}
</style>
