<script setup lang="ts">
// Cadastro de bens, plaquetas e responsáveis (M54, etapa 6; item `Controladoria > Patrimônio > Cadastro de bens,
// plaquetas e responsáveis`; `patrimonio.bem.ler`): a lista paginada no servidor (busca, setor, situação, grupo) com os
// totais da página e a conta impressa, a abertura pelo QR ou pela plaqueta digitada, a ficha do bem, o cadastro em
// passos da nota ou do termo (`patrimonio.bem.cadastrar`) e os cadastros auxiliares (CRUD genérico do M54.1). Com a
// chave desligada, a consulta funciona e as gravações ficam ocultas, com o motivo.
import {
  CADASTROS_PATRIMONIO_BENS,
  type GrupoBem,
  SITUACOES_BEM,
  type SituacaoBem,
  TAMANHO_PAGINA_BENS,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import MensagemErro from '../../casca/MensagemErro.vue';
import { lerApoioPatrimonio, lerBemPorCodigo, lerBens } from './api-patrimonio.js';
import CadastrosPatrimonio from './CadastrosPatrimonio.vue';
import { hojeLocal, nomeDoGrupo, reais, rotuloCentro } from './comum-patrimonio.js';
import ErroPatrimonio from './ErroPatrimonio.vue';
import FichaBem from './FichaBem.vue';
import FormCadastroBem from './FormCadastroBem.vue';
import GruposBem from './GruposBem.vue';

type Aba = 'lista' | 'cadastrar' | 'grupos' | 'cadastros';
const props = defineProps<{ hoje?: string }>();
const { t } = useI18n();
const rota = useRoute();
const hoje = computed(() => props.hoje ?? hojeLocal());

const apoio = useQuery({
  queryKey: ['patrimonio', 'apoio', 'bens'],
  queryFn: () => lerApoioPatrimonio('bens'),
});
const a = computed(() => apoio.data.value ?? null);
const cadastros = computed(() =>
  CADASTROS_PATRIMONIO_BENS.filter((c) => a.value?.cadastros.includes(c) ?? false),
);
const aba = ref<Aba>('lista');
const abas = computed(() =>
  (['lista', 'cadastrar', 'grupos', 'cadastros'] as const).filter(
    (x) =>
      x === 'lista' ||
      x === 'grupos' ||
      (x === 'cadastrar' && a.value?.acoes.cadastrar === true) ||
      (x === 'cadastros' && cadastros.value.length > 0),
  ),
);

// ── Filtros e página ────────────────────────────────────────────────────────────────────────────────────────────────
const busca = ref('');
const filtro = ref<{
  busca: string;
  centro: number | null;
  situacao: SituacaoBem | null;
  grupo: GrupoBem | null;
}>({ busca: '', centro: null, situacao: 'ativo', grupo: null });
const pagina = ref(1);
const lista = useQuery({
  queryKey: computed(() => ['patrimonio', 'bens', filtro.value, pagina.value]),
  queryFn: () => lerBens({ ...filtro.value, pagina: pagina.value, tamanho: TAMANHO_PAGINA_BENS }),
});
const l = computed(() => lista.data.value ?? null);
const paginas = computed(() => (l.value ? Math.max(1, Math.ceil(l.value.total / l.value.tamanho)) : 1));
watch(filtro, () => (pagina.value = 1), { deep: true });

const opcoesCentro = computed(() => [
  { valor: null as number | null, rotulo: t('patrimonio.todos') },
  ...(a.value?.centros ?? []).map((c) => ({ valor: c.id as number | null, rotulo: rotuloCentro(c) })),
]);
const opcoesSituacao = computed(() => [
  { valor: null as SituacaoBem | null, rotulo: t('patrimonio.todas') },
  ...SITUACOES_BEM.map((s) => ({
    valor: s as SituacaoBem | null,
    rotulo: t(`patrimonio.situacoesBem.${s}`),
  })),
]);
const opcoesGrupo = computed(() => [
  { valor: null as GrupoBem | null, rotulo: t('patrimonio.todos') },
  // O filtro da lista mostra também os grupos inativos (há bens neles), marcados.
  ...(a.value?.grupos ?? []).map((g) => ({
    valor: g.valor as GrupoBem | null,
    rotulo: g.ativo ? g.rotulo : `${g.rotulo} (${t('patrimonio.gruposBem.marcaInativo')})`,
  })),
]);

// ── Abrir pelo QR ou pela plaqueta; ficha ───────────────────────────────────────────────────────────────────────────
const aberto = ref<number | null>(null);
const codigo = ref('');
const erroCodigo = ref<unknown>(null);
async function abrirPorCodigo() {
  erroCodigo.value = null;
  if (!codigo.value.trim()) return;
  try {
    const b = await lerBemPorCodigo(codigo.value.trim());
    aberto.value = b.id;
    aba.value = 'lista';
    codigo.value = '';
  } catch (e) {
    erroCodigo.value = e;
  }
}
const daRota = Number(rota?.query?.['bem']);
if (Number.isInteger(daRota) && daRota > 0) aberto.value = daRota;
function abrir(id: number) {
  aberto.value = id;
  aba.value = 'lista';
}
</script>

<template>
  <section class="tela-patrimonio" aria-labelledby="bens-titulo" data-testid="tela-bens">
    <h1 id="bens-titulo">{{ t('patrimonio.bens.titulo') }}</h1>
    <p>{{ t('patrimonio.bens.descricao') }}</p>
    <MensagemErro v-if="apoio.isError.value" :erro="apoio.error.value" />
    <p v-else-if="!a" role="status">{{ t('patrimonio.carregando') }}</p>
    <template v-else>
      <SanteAlerta
        v-if="!a.liberacao.ligada"
        :texto="t('patrimonio.desligado')"
        variante="info"
        data-testid="patrimonio-desligado"
      />
      <div class="acoes" role="tablist">
        <SanteBotao
          v-for="x in abas"
          :key="x"
          role="tab"
          :aria-selected="aba === x"
          :variante="aba === x ? 'primario' : 'secundario'"
          :rotulo="t(`patrimonio.bens.abas.${x}`)"
          :data-testid="`bens-aba-${x}`"
          @acionar="aba = x"
        />
      </div>

      <template v-if="aba === 'lista'">
        <form class="campos" data-testid="bens-codigo" @submit.prevent="abrirPorCodigo">
          <SanteCampoTexto
            v-model="codigo"
            :rotulo="t('patrimonio.bens.lerCodigo')"
            :max-bytes="80"
            data-testid="bens-codigo-campo"
          />
          <SanteBotao
            tipo="submit"
            variante="secundario"
            :rotulo="t('patrimonio.abrir')"
            data-testid="bens-codigo-abrir"
          />
        </form>
        <ErroPatrimonio v-if="erroCodigo" :erro="erroCodigo" />

        <FichaBem
          v-if="aberto !== null"
          :id="aberto"
          :key="aberto"
          :apoio="a"
          :hoje="hoje"
          @fechar="aberto = null"
        />

        <section class="bloco" aria-labelledby="bens-lista-titulo">
          <h2 id="bens-lista-titulo">{{ t('patrimonio.bens.abas.lista') }}</h2>
          <form
            class="campos"
            data-testid="bens-filtros"
            @submit.prevent="filtro = { ...filtro, busca: busca.trim() }"
          >
            <SanteCampoTexto
              v-model="busca"
              :rotulo="t('patrimonio.bens.busca')"
              :max-bytes="60"
              data-testid="bens-busca"
            />
            <SanteSelecao
              v-model="filtro.centro"
              :rotulo="t('patrimonio.setor')"
              :opcoes="opcoesCentro"
              busca
              data-testid="bens-centro"
            />
            <SanteSelecao
              v-model="filtro.situacao"
              :rotulo="t('patrimonio.bens.situacao')"
              :opcoes="opcoesSituacao"
              data-testid="bens-situacao"
            />
            <SanteSelecao
              v-model="filtro.grupo"
              :rotulo="t('patrimonio.bens.grupo')"
              :opcoes="opcoesGrupo"
              busca
              data-testid="bens-grupo"
            />
            <SanteBotao
              tipo="submit"
              variante="secundario"
              :rotulo="t('patrimonio.bens.filtrar')"
              data-testid="bens-filtrar"
            />
          </form>
          <MensagemErro v-if="lista.isError.value" :erro="lista.error.value" />
          <p v-else-if="!l" role="status">{{ t('patrimonio.carregando') }}</p>
          <p v-else-if="l.bens.length === 0" data-testid="bens-vazio">{{ t('patrimonio.bens.nenhum') }}</p>
          <template v-else>
            <div class="rolagem">
              <table class="tabela" data-testid="tabela-bens">
                <thead>
                  <tr>
                    <th scope="col">{{ t('patrimonio.bens.plaqueta') }}</th>
                    <th scope="col">{{ t('patrimonio.bens.descricaoBem') }}</th>
                    <th scope="col">{{ t('patrimonio.bens.grupo') }}</th>
                    <th scope="col">{{ t('patrimonio.setor') }}</th>
                    <th scope="col">{{ t('patrimonio.bens.situacao') }}</th>
                    <th scope="col">{{ t('patrimonio.bens.valor') }}</th>
                    <th scope="col">{{ t('patrimonio.bens.acumulada') }}</th>
                    <th scope="col">{{ t('patrimonio.bens.contabil') }}</th>
                    <th scope="col">{{ t('patrimonio.acoes') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="b in l.bens" :key="b.id" :data-testid="`bem-${b.id}`">
                    <td>{{ b.plaqueta }}</td>
                    <td>
                      {{ b.descricao }}
                      <span v-if="b.movimentoPendente" class="secundario">
                        ({{
                          t('patrimonio.bens.pendente', {
                            tipo: t(`patrimonio.tiposMovimento.${b.movimentoPendente.tipo}`),
                          })
                        }})
                      </span>
                    </td>
                    <td>{{ nomeDoGrupo(a?.grupos, b.grupo, t) }}</td>
                    <td>{{ rotuloCentro(b.centro) }}</td>
                    <td>{{ t(`patrimonio.situacoesBem.${b.situacao}`) }}</td>
                    <td>{{ reais(b.valorCent) }}</td>
                    <td>{{ reais(b.acumuladaCent) }}</td>
                    <td>{{ reais(b.contabilCent) }}</td>
                    <td>
                      <SanteBotao
                        variante="secundario"
                        :rotulo="t('patrimonio.abrir')"
                        :data-testid="`bem-abrir-${b.id}`"
                        @acionar="aberto = b.id"
                      />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p data-testid="bens-totais">
              {{
                t('patrimonio.bens.totaisPagina', {
                  valor: reais(l.totaisPagina.valorCent),
                  acumulada: reais(l.totaisPagina.acumuladaCent),
                  contabil: reais(l.totaisPagina.contabilCent),
                })
              }}
            </p>
            <div class="acoes">
              <SanteBotao
                variante="secundario"
                :rotulo="t('patrimonio.bens.anterior')"
                :desabilitado="pagina <= 1"
                data-testid="bens-anterior"
                @acionar="pagina--"
              />
              <span role="status" data-testid="bens-pagina">{{
                t('patrimonio.bens.pagina', { p: pagina, n: paginas, total: l.total })
              }}</span>
              <SanteBotao
                variante="secundario"
                :rotulo="t('patrimonio.bens.proxima')"
                :desabilitado="pagina >= paginas"
                data-testid="bens-proxima"
                @acionar="pagina++"
              />
            </div>
          </template>
        </section>
      </template>

      <FormCadastroBem v-else-if="aba === 'cadastrar'" :apoio="a" :hoje="hoje" @abrir="abrir" />

      <GruposBem v-else-if="aba === 'grupos'" :apoio="a" />

      <CadastrosPatrimonio
        v-else
        :cadastros="cadastros"
        :titulo="t('patrimonio.bens.abas.cadastros')"
        :ajuda="t('patrimonio.bens.cadastrosAjuda')"
        testid="bens-cadastros"
      />
    </template>
  </section>
</template>

<style scoped src="./estilo-patrimonio.css"></style>
