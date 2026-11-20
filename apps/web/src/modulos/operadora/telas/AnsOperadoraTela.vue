<script setup lang="ts">
// Envios à ANS (M56; item `Faturamento > Operadora própria > Envios à ANS e exportações`; `operadora.ans.ler` vê,
// `operadora.ans.gerar` grava). Etapa F0: a situação da operadora no estabelecimento (as chaves do módulo e das partes,
// desligadas por padrão) e a consulta dos catálogos da ANS em leitura (CatalogosAns, `catalogo.ans.ler`), com os domínios
// embutidos (CRUD genérico do grupo `operadora`) e a consulta do item. Etapa 7 (F6), com a chave `operadora.ans` ligada:
//   - aba "Envios": as contagens, a lista dos envios (operadora, obrigação, competência ou ano, situação; páginas), o novo
//     arquivo com a prévia (GerarEnvioAns) e a ficha do envio (FichaEnvioAns: arquivo, envio, retorno, GRU);
//   - aba "Pendências do cadastro (SIB)": os beneficiários com movimento e o que impede cada um, com o complemento;
//   - aba "Ressarcimento ao SUS": os avisos registrados (a mesma lista, só desta obrigação), o registro do aviso e a
//     decisão de cada atendimento na ficha.
// Desligada (POL-3), a tela diz o motivo e mostra só a situação e os catálogos.
import { CODIGOS_SITUACAO_ENVIO_ANS, type ObrigacaoAns } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import GrupoDominiosTela from '../../config/telas/GrupoDominiosTela.vue';
import { lerApoioAns, lerEnviosAns, type ResultadoAns } from '../api-ans.js';
import CatalogosAns from '../componentes/CatalogosAns.vue';
import { dataBr } from '../componentes/f1/comum.js';
import { brl } from '../componentes/f2/comum.js';
import AvisoRessarcimento from '../componentes/f6/AvisoRessarcimento.vue';
import { competenciaTela } from '../componentes/f6/comum.js';
import FichaEnvioAns from '../componentes/f6/FichaEnvioAns.vue';
import GerarEnvioAns from '../componentes/f6/GerarEnvioAns.vue';
import PendenciasSib from '../componentes/f6/PendenciasSib.vue';
import SituacaoOperadora from '../componentes/SituacaoOperadora.vue';

const ITEM_ANS = 'faturamento.operadora-propria-sgo-se-a-rede-tiver-plano.envios-a-ans-sib-sip-e-exportacoes';

const { t } = useI18n();
const cliente = useQueryClient();
const podeGerar = computed(() => pode('operadora.ans.gerar'));
const apoio = useQuery({ queryKey: ['operadora', 'ans', 'apoio'], queryFn: () => lerApoioAns() });
const a = computed(() => apoio.data.value ?? null);
const ligada = computed(() => a.value?.situacao.vale === true);
const comOperadora = computed(() => (a.value?.operadoras.length ?? 0) > 0);

type Aba = 'envios' | 'sib' | 'ressarcimento';
const ABAS: readonly Aba[] = ['envios', 'sib', 'ressarcimento'];
const aba = ref<Aba>('envios');
const operadora = ref<number | null>(null);
watch(
  a,
  (v) => {
    if (v && operadora.value === null) operadora.value = v.operadoras[0]?.id ?? null;
  },
  { immediate: true },
);

// ── Ficha, novo arquivo, aviso e mensagens ──────────────────────────────────────────────────────
const aberto = ref<number | null>(null);
const novo = ref<'arquivo' | 'aviso' | null>(null);
const mensagem = ref<string | null>(null);
async function gravado(r: ResultadoAns): Promise<void> {
  novo.value = null;
  mensagem.value = r.mensagem;
  aberto.value = r.id;
  await cliente.invalidateQueries({ queryKey: ['operadora', 'ans'] });
}
function abrir(id: number): void {
  mensagem.value = null;
  novo.value = null;
  aberto.value = id;
}
function abrirNovo(n: 'arquivo' | 'aviso'): void {
  mensagem.value = null;
  aberto.value = null;
  novo.value = n;
}

// ── Lista (filtro aplicado + pilha de cursores) ────────────────────────────────────────────────
const obrigacao = ref<ObrigacaoAns | null>(null);
const competencia = ref('');
const situacao = ref<string | null>(null);
const aplicado = ref({
  obrigacao: null as ObrigacaoAns | null,
  competencia: '',
  situacao: null as string | null,
});
const cursores = ref<(number | null)[]>([null]);
const cursor = computed(() => cursores.value[cursores.value.length - 1] ?? null);
const obrigacaoEfetiva = computed<ObrigacaoAns | null>(() =>
  aba.value === 'ressarcimento' ? 'RESSARCIMENTO_SUS' : aplicado.value.obrigacao,
);
const lista = useQuery({
  queryKey: computed(() => [
    'operadora',
    'ans',
    'lista',
    operadora.value,
    obrigacaoEfetiva.value,
    aplicado.value,
    cursor.value,
  ]),
  queryFn: () =>
    lerEnviosAns({
      operadora: operadora.value,
      obrigacao: obrigacaoEfetiva.value,
      competencia: aplicado.value.competencia || null,
      situacao: aplicado.value.situacao,
      apos: cursor.value,
    }),
  enabled: computed(() => ligada.value && comOperadora.value && aba.value !== 'sib'),
});
const competenciaValida = computed(
  () => !competencia.value.trim() || /^\d{4}(-(\d{2}|T[1-4]|\d{2}-\d{2}))?$/.test(competencia.value.trim()),
);
function filtrar(): void {
  if (!competenciaValida.value) return;
  aplicado.value = {
    obrigacao: obrigacao.value,
    competencia: competencia.value.trim(),
    situacao: situacao.value,
  };
  cursores.value = [null];
}
watch([aba, operadora], () => {
  cursores.value = [null];
  aberto.value = null;
  novo.value = null;
});

const opcoesOperadora = computed(() =>
  (a.value?.operadoras ?? []).map((o) => ({
    valor: o.id as number | null,
    rotulo: `${o.nome} · ${o.registroAns}`,
  })),
);
const opcoesObrigacao = computed(() => [
  { valor: null as ObrigacaoAns | null, rotulo: t('operadoraAns.filtro.todas') },
  ...(a.value?.obrigacoes ?? [])
    .filter((o) => o.codigo !== 'RESSARCIMENTO_SUS')
    .map((o) => ({ valor: o.codigo as ObrigacaoAns | null, rotulo: o.rotulo })),
]);
const opcoesSituacao = computed(() => [
  { valor: null as string | null, rotulo: t('operadoraAns.filtro.todas') },
  ...CODIGOS_SITUACAO_ENVIO_ANS.map((s) => ({
    valor: s as string | null,
    rotulo: t(`operadoraAns.situacoes.${s}`),
  })),
]);
const rotuloObrigacao = (c: ObrigacaoAns) => a.value?.obrigacoes.find((o) => o.codigo === c)?.rotulo ?? c;
</script>

<template>
  <section class="tela-operadora" aria-labelledby="ope-ans-titulo" data-testid="tela-operadora-ans">
    <h1 id="ope-ans-titulo">{{ t('operadoraAns.titulo') }}</h1>
    <p>{{ t('operadoraAns.texto') }}</p>

    <SituacaoOperadora />

    <section class="bloco" aria-labelledby="ope-envios-titulo" data-testid="operadora-envios">
      <h2 id="ope-envios-titulo">{{ t('operadora.telas.ans.envios') }}</h2>
      <MensagemErro v-if="apoio.isError.value" :erro="apoio.error.value" />
      <p v-else-if="!a" role="status">{{ t('operadoraAns.carregando') }}</p>
      <SanteAlerta
        v-else-if="!ligada"
        :texto="a.situacao.motivo ?? t('operadoraAns.desligada')"
        variante="info"
        data-testid="ans-desligada"
      />
      <p v-else-if="!comOperadora" data-testid="ans-sem-operadora">{{ t('operadoraAns.semOperadora') }}</p>

      <template v-if="a && ligada && comOperadora">
        <SanteAlerta
          :texto="t(`operadoraAns.destino.${a.destino}`)"
          :variante="a.destino === 'ans' ? 'aviso' : 'info'"
          data-testid="ans-destino"
        />
        <p class="secundario">{{ t('operadoraAns.leiaute', { versao: a.leiaute }) }}</p>
        <div class="campos">
          <SanteSelecao
            v-model="operadora"
            :rotulo="t('operadoraAns.filtro.operadora')"
            :opcoes="opcoesOperadora"
            :busca="true"
            data-testid="ans-operadora"
          />
        </div>
        <p v-if="mensagem" role="status" data-testid="ans-mensagem">{{ mensagem }}</p>
        <div class="acoes" role="group" :aria-label="t('operadoraAns.titulo')">
          <SanteBotao
            v-for="x in ABAS"
            :key="x"
            :rotulo="t(`operadoraAns.abas.${x}`)"
            :variante="aba === x ? 'primario' : 'texto'"
            :aria-pressed="aba === x"
            :data-testid="`ans-aba-${x}`"
            @acionar="aba = x"
          />
        </div>

        <PendenciasSib
          v-if="aba === 'sib' && operadora !== null"
          :key="operadora"
          :apoio="a"
          :operadora="operadora"
          :pode-gerar="podeGerar"
        />

        <template v-if="aba !== 'sib'">
          <dl v-if="lista.data.value" class="totais" data-testid="ans-totais">
            <div v-for="(v, k) in lista.data.value.totais" :key="k" :data-testid="`ans-total-${k}`">
              <dt>{{ t(`operadoraAns.totais.${k}`) }}</dt>
              <dd>{{ v }}</dd>
            </div>
          </dl>

          <p v-if="aba === 'ressarcimento'" class="secundario">{{ t('operadoraAns.ressarcimento.texto') }}</p>
          <form class="campos" data-testid="ans-filtro" @submit.prevent="filtrar">
            <SanteSelecao
              v-if="aba === 'envios'"
              v-model="obrigacao"
              :rotulo="t('operadoraAns.filtro.obrigacao')"
              :opcoes="opcoesObrigacao"
              data-testid="ans-filtro-obrigacao"
            />
            <div>
              <SanteCampoTexto
                id="ans-filtro-competencia"
                v-model="competencia"
                :rotulo="t('operadoraAns.filtro.competencia')"
                :max-bytes="10"
              />
              <p class="secundario">{{ t('operadoraAns.filtro.competenciaAjuda') }}</p>
              <p v-if="!competenciaValida" class="erro" role="alert">
                {{ t('operadoraAns.filtro.competenciaInvalida') }}
              </p>
            </div>
            <SanteSelecao
              v-model="situacao"
              :rotulo="t('operadoraAns.filtro.situacao')"
              :opcoes="opcoesSituacao"
              data-testid="ans-filtro-situacao"
            />
            <div class="acoes">
              <SanteBotao tipo="submit" :rotulo="t('operadoraAns.filtro.buscar')" data-testid="ans-buscar" />
              <SanteBotao
                v-if="aba === 'envios' && podeGerar"
                variante="secundario"
                :rotulo="t('operadoraAns.acoes.novo')"
                data-testid="ans-novo"
                @acionar="abrirNovo('arquivo')"
              />
              <SanteBotao
                v-if="aba === 'ressarcimento' && podeGerar"
                variante="secundario"
                :rotulo="t('operadoraAns.acoes.aviso')"
                data-testid="ans-novo-aviso"
                @acionar="abrirNovo('aviso')"
              />
            </div>
          </form>

          <GerarEnvioAns
            v-if="novo === 'arquivo'"
            :apoio="a"
            :operadora="operadora"
            :pode-gerar="podeGerar"
            @gravado="gravado"
            @cancelar="novo = null"
          />
          <AvisoRessarcimento
            v-if="novo === 'aviso'"
            :apoio="a"
            :operadora="operadora"
            @gravado="gravado"
            @cancelar="novo = null"
          />

          <MensagemErro v-if="lista.isError.value" :erro="lista.error.value" />
          <p v-else-if="!lista.data.value" role="status">{{ t('operadoraAns.carregando') }}</p>
          <p v-else-if="lista.data.value.itens.length === 0" data-testid="ans-vazia">
            {{ t('operadoraAns.nenhum') }}
          </p>
          <div v-else class="rolagem">
            <table class="tabela" data-testid="ans-lista">
              <caption class="visualmente-oculto">
                {{
                  t(`operadoraAns.abas.${aba}`)
                }}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{{ t('operadoraAns.colunas.obrigacao') }}</th>
                  <th scope="col">{{ t('operadoraAns.colunas.competencia') }}</th>
                  <th scope="col">{{ t('operadoraAns.colunas.sequencial') }}</th>
                  <th scope="col">{{ t('operadoraAns.colunas.situacao') }}</th>
                  <th scope="col">{{ t('operadoraAns.colunas.registros') }}</th>
                  <th scope="col">{{ t('operadoraAns.colunas.valor') }}</th>
                  <th scope="col">{{ t('operadoraAns.colunas.criado') }}</th>
                  <th scope="col">{{ t('operadoraAns.colunas.prazo') }}</th>
                  <th scope="col">
                    <span class="visualmente-oculto">{{ t('operadoraAns.colunas.acoes') }}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="k in lista.data.value.itens" :key="k.id" :data-testid="`ans-envio-${k.id}`">
                  <td>{{ rotuloObrigacao(k.obrigacao) }}</td>
                  <td>{{ competenciaTela(k.competencia) }}</td>
                  <td>{{ k.sequencial }}</td>
                  <td :data-situacao="k.situacao">{{ t(`operadoraAns.situacoes.${k.situacao}`) }}</td>
                  <td>{{ k.registros }}</td>
                  <td>{{ brl(k.valorTotal) }}</td>
                  <td>{{ dataBr(k.criadoEm) }}</td>
                  <td>{{ dataBr(k.prazo) }}</td>
                  <td>
                    <SanteBotao
                      variante="texto"
                      :rotulo="
                        t('operadoraAns.acoes.abrir', {
                          obrigacao: k.obrigacao,
                          competencia: competenciaTela(k.competencia),
                        })
                      "
                      :data-testid="`ans-abrir-${k.id}`"
                      @acionar="abrir(k.id)"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-if="lista.data.value" class="acoes">
            <SanteBotao
              v-if="cursores.length > 1"
              variante="secundario"
              :rotulo="t('operadoraAns.paginas.anterior')"
              @acionar="cursores = cursores.slice(0, -1)"
            />
            <SanteBotao
              v-if="lista.data.value.proxima"
              variante="secundario"
              :rotulo="t('operadoraAns.paginas.proxima')"
              @acionar="cursores = [...cursores, lista.data.value.proxima]"
            />
            <span v-else-if="cursores.length > 1" class="secundario">{{
              t('operadoraAns.paginas.fim')
            }}</span>
          </div>

          <FichaEnvioAns
            v-if="aberto !== null"
            :key="aberto"
            :id="aberto"
            :pode-gerar="podeGerar"
            @gravado="gravado"
            @fechar="aberto = null"
          />
        </template>
      </template>
    </section>

    <CatalogosAns v-if="pode('catalogo.ans.ler')" />

    <GrupoDominiosTela subitem="operadoraAns" embutida />
    <p>
      <RouterLink :to="`/consultas/item/${ITEM_ANS}`" data-testid="operadora-outras-tabelas">{{
        t('operadora.telas.ans.outrasTabelas')
      }}</RouterLink>
    </p>
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
.rolagem {
  overflow-x: auto;
}
.erro {
  color: var(--sgh-perigo);
}
</style>
