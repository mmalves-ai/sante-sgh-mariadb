<script setup lang="ts">
// Qualidade e segurança › Segurança do paciente (NSP) › Notificação de incidentes e eventos adversos (M48, etapa 1;
// ficha, seção 7): a lista paginada (50 por página) com os filtros, a coluna do próximo prazo regulatório e "Triar
// próxima" (a mais antiga recebida, com dano grave, óbito ou never event no topo). Cada linha abre o detalhe com a
// linha do tempo e o painel de triagem. O gestor da área não usa esta tela (vê pela análise, etapa 2).
import {
  CLASSIFICACOES_OMS,
  GRAUS_DANO,
  SITUACOES_NOTIFICACAO,
  SITUACOES_NOTIVISA,
  SITUACOES_PRAZO,
  TIPOS_INCIDENTE,
} from '@sgh/contratos';
import { exigeAtencaoImediata } from '@sgh/dominio-qualidade';
import { SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { keepPreviousData, useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { pode } from '../../../casca/sessao/pode.js';
import { lerFormularioNotificacao, lerProximaNotificacao, listarNotificacoes } from '../api.js';
import ErroQualidade from '../componentes/ErroQualidade.vue';
import PrazoChip from '../componentes/PrazoChip.vue';
import { dataHora } from '../regras-qualidade.js';

const { t } = useI18n();
const roteador = useRouter();
const podeTriar = computed(() => pode('qualidade.notificacao.triar'));
const podeVigilancia = computed(() => pode('qualidade.tecnovigilancia.ler'));

const filtro = reactive({
  situacao: '',
  tipo: '',
  classificacao: '',
  prazo: '',
  unidade: null as number | null,
  de: null as string | null,
  ate: null as string | null,
  protocolo: '',
});
const pagina = ref(1);
watch(filtro, () => (pagina.value = 1));
const protocoloValido = computed(
  () => filtro.protocolo.trim() === '' || /^NSP-\d{4}-\d{6}$/i.test(filtro.protocolo.trim()),
);

const lista = useQuery({
  queryKey: computed(() => ['qualidade', 'nsp', 'lista', { ...filtro }, pagina.value]),
  queryFn: () =>
    listarNotificacoes({
      ...filtro,
      protocolo: protocoloValido.value ? filtro.protocolo : '',
      pagina: pagina.value,
    }),
  placeholderData: keepPreviousData,
  refetchInterval: 60_000,
});
// As unidades são as do formulário de notificação (as mesmas que o notificador escolhe).
const formulario = useQuery({
  queryKey: ['qualidade', 'formulario'],
  queryFn: lerFormularioNotificacao,
  staleTime: 60_000,
});

const todas = (rotulo: string) => ({ valor: '', rotulo });
const opSituacao = [
  todas(t('qualidade.lista.todas')),
  ...SITUACOES_NOTIFICACAO.map((s) => ({ valor: s.codigo as string, rotulo: s.rotulo })),
];
const opTipo = [
  todas(t('qualidade.lista.todos')),
  ...TIPOS_INCIDENTE.map((s) => ({ valor: s.codigo as string, rotulo: s.rotulo })),
];
const opClassificacao = [
  todas(t('qualidade.lista.todas')),
  ...CLASSIFICACOES_OMS.map((s) => ({ valor: s.codigo as string, rotulo: s.rotulo })),
];
const opPrazo = [
  todas(t('qualidade.lista.todos')),
  ...SITUACOES_PRAZO.filter((s) => s !== 'cumprido').map((s) => ({
    valor: s as string,
    rotulo: t(`qualidade.prazos.situacoes.${s}`),
  })),
];
const opUnidade = computed(() => [
  { valor: null as number | null, rotulo: t('qualidade.lista.todas') },
  ...(formulario.data.value?.unidades ?? []).map((u) => ({
    valor: u.codigo as number | null,
    rotulo: u.nome,
  })),
]);

const rotulo = {
  tipo: (c: string) => TIPOS_INCIDENTE.find((x) => x.codigo === c)?.rotulo ?? c,
  classificacao: (c: string) => CLASSIFICACOES_OMS.find((x) => x.codigo === c)?.rotulo ?? c,
  dano: (c: string) => GRAUS_DANO.find((x) => x.codigo === c)?.rotulo ?? c,
  situacao: (c: string) => SITUACOES_NOTIFICACAO.find((x) => x.codigo === c)?.rotulo ?? c,
  notivisa: (c: string) => SITUACOES_NOTIVISA.find((x) => x.codigo === c)?.rotulo ?? c,
};

const erroProxima = ref<unknown>(null);
const semProxima = ref(false);
async function triarProxima(): Promise<void> {
  erroProxima.value = null;
  semProxima.value = false;
  try {
    const p = await lerProximaNotificacao();
    if (p.id === null) semProxima.value = true;
    else await roteador.push(`/qualidade/nsp/notificacoes/${String(p.id)}`);
  } catch (e) {
    erroProxima.value = e;
  }
}
function limpar(): void {
  Object.assign(filtro, {
    situacao: '',
    tipo: '',
    classificacao: '',
    prazo: '',
    unidade: null,
    de: null,
    ate: null,
    protocolo: '',
  });
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="nsp-lista-titulo" data-testid="tela-nsp-notificacoes">
    <h1 id="nsp-lista-titulo">{{ t('qualidade.lista.titulo') }}</h1>
    <p class="acoes">
      <SanteBotao
        v-if="podeTriar"
        :rotulo="t('qualidade.lista.triarProxima')"
        variante="primario"
        data-testid="triar-proxima"
        @acionar="triarProxima"
      />
      <RouterLink to="/qualidade/nsp/prazos" data-testid="ir-prazos">{{
        t('qualidade.prazos.titulo')
      }}</RouterLink>
      <RouterLink to="/qualidade/nsp/analises" data-testid="ir-analises">{{
        t('qualidade.analise.listaTitulo')
      }}</RouterLink>
      <RouterLink v-if="podeVigilancia" to="/qualidade/nsp/tecnovigilancia" data-testid="ir-vigilancia">{{
        t('qualidade.vigilancia.titulo')
      }}</RouterLink>
    </p>
    <p v-if="semProxima" role="status" data-testid="sem-proxima">{{ t('qualidade.lista.semProxima') }}</p>
    <ErroQualidade v-if="erroProxima" :erro="erroProxima" />

    <form class="filtros" :aria-label="t('qualidade.lista.filtros')" @submit.prevent>
      <SanteSelecao
        v-model="filtro.situacao"
        :rotulo="t('qualidade.lista.filtroSituacao')"
        :opcoes="opSituacao"
        data-testid="filtro-situacao"
      />
      <SanteSelecao
        v-model="filtro.tipo"
        :rotulo="t('qualidade.lista.filtroTipo')"
        :opcoes="opTipo"
        busca
        data-testid="filtro-tipo"
      />
      <SanteSelecao
        v-model="filtro.classificacao"
        :rotulo="t('qualidade.lista.filtroClassificacao')"
        :opcoes="opClassificacao"
        data-testid="filtro-classificacao"
      />
      <SanteSelecao
        v-model="filtro.prazo"
        :rotulo="t('qualidade.lista.filtroPrazo')"
        :opcoes="opPrazo"
        data-testid="filtro-prazo"
      />
      <SanteSelecao
        v-model="filtro.unidade"
        :rotulo="t('qualidade.lista.filtroUnidade')"
        :opcoes="opUnidade"
        data-testid="filtro-unidade"
      />
      <SanteData v-model="filtro.de" :rotulo="t('qualidade.lista.de')" editavel />
      <SanteData v-model="filtro.ate" :rotulo="t('qualidade.lista.ate')" editavel />
      <SanteCampoTexto
        v-model="filtro.protocolo"
        :rotulo="t('qualidade.lista.buscarProtocolo')"
        :max-bytes="15"
        data-testid="filtro-protocolo"
      />
      <SanteBotao
        :rotulo="t('qualidade.lista.limpar')"
        variante="texto"
        data-testid="filtro-limpar"
        @acionar="limpar"
      />
    </form>
    <p v-if="!protocoloValido" role="status">{{ t('qualidade.lista.protocoloInvalido') }}</p>

    <ErroQualidade v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!lista.data.value" role="status">{{ t('qualidade.carregando') }}</p>
    <template v-else>
      <p v-if="lista.data.value.itens.length === 0" data-testid="nsp-nenhuma">{{ t('qualidade.nenhuma') }}</p>
      <table v-else class="tabela" data-testid="tabela-nsp">
        <caption>
          {{
            t('qualidade.lista.legenda', { pagina: lista.data.value.pagina })
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('qualidade.lista.protocolo') }}</th>
            <th scope="col">{{ t('qualidade.lista.ocorridoEm') }}</th>
            <th scope="col">{{ t('qualidade.lista.tipo') }}</th>
            <th scope="col">{{ t('qualidade.lista.classificacao') }}</th>
            <th scope="col">{{ t('qualidade.lista.unidade') }}</th>
            <th scope="col">{{ t('qualidade.lista.situacao') }}</th>
            <th scope="col">{{ t('qualidade.lista.notivisa') }}</th>
            <th scope="col">{{ t('qualidade.lista.prazo') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="n in lista.data.value.itens" :key="n.id" :data-testid="`nsp-linha-${n.protocolo}`">
            <td>
              <RouterLink
                :to="`/qualidade/nsp/notificacoes/${n.id}`"
                :data-testid="`nsp-abrir-${n.protocolo}`"
                >{{ n.protocolo }}</RouterLink
              >
              <div class="secundario">
                {{ dataHora(n.notificadaEm) }} ·
                {{ n.anonima ? t('qualidade.lista.anonima') : t('qualidade.lista.identificada') }}
              </div>
            </td>
            <td>{{ dataHora(n.ocorridoEm) }}</td>
            <td>{{ rotulo.tipo(n.tipo) }}</td>
            <td>
              {{ rotulo.classificacao(n.classificacao) }}
              <div class="secundario">
                {{ t('qualidade.lista.dano') }}: {{ rotulo.dano(n.dano) }}
                <span
                  v-if="n.situacao === 'recebida' && exigeAtencaoImediata(n.dano)"
                  class="selo selo--grave"
                  :title="t('qualidade.lista.atencaoImediata')"
                  >{{ t('qualidade.lista.urgente') }}</span
                >
              </div>
            </td>
            <td>{{ n.unidade ?? '-' }}</td>
            <td>{{ rotulo.situacao(n.situacao) }}</td>
            <td>{{ rotulo.notivisa(n.notivisa) }}</td>
            <td><PrazoChip :prazo="n.proximoPrazo" /></td>
          </tr>
        </tbody>
      </table>
      <nav class="acoes" :aria-label="t('qualidade.lista.paginas')">
        <SanteBotao
          :rotulo="t('qualidade.lista.anterior')"
          variante="secundario"
          :desabilitado="pagina <= 1"
          data-testid="pagina-anterior"
          @acionar="pagina--"
        />
        <SanteBotao
          :rotulo="t('qualidade.lista.proxima')"
          variante="secundario"
          :desabilitado="!lista.data.value.temMais"
          data-testid="pagina-proxima"
          @acionar="pagina++"
        />
      </nav>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style>
@import '../componentes/estilo-qualidade.css';
</style>
<style scoped>
.acoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-3);
  align-items: center;
}
</style>
