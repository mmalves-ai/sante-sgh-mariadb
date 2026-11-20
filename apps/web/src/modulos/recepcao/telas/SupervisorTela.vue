<script setup lang="ts">
// Painel do supervisor da recepção (M19; ficha, seção 7): filas do dia por serviço (aguardando, prioritárias, espera
// média, maior espera e acima do tempo-alvo), guichês abertos (por estas telas e pelos outros terminais) com as
// chamadas do dia, as senhas esperando há mais tempo e os totais. Liberar o guichê de outra pessoa (guichê
// bloqueado) pede a justificativa e vai à trilha (permissão recepcao.guiche.liberar). Relê a cada 15 s.
import { SanteBotao, SanteCampoTexto, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { fecharGuiche, lerApoio, lerSupervisor, novaChave } from '../api-recepcao.js';
import { horaDe } from '../formato.js';

const { t } = useI18n();
const cliente = useQueryClient();
const recepcao = ref('');
const apoio = useQuery({ queryKey: ['recepcao', 'apoio'], queryFn: () => lerApoio(), staleTime: 60_000 });
const painel = useQuery({
  queryKey: computed(() => ['recepcao', 'supervisor', recepcao.value]),
  queryFn: () => lerSupervisor(recepcao.value ? Number(recepcao.value) : null),
  refetchInterval: 15_000,
});
const opcoes = computed(() => [
  { valor: '', rotulo: t('recepcao.supervisor.todas') },
  ...(apoio.data.value?.recepcoes ?? []).map((r) => ({ valor: String(r.id), rotulo: r.descricao })),
]);
const nomeRecepcao = (id: number) =>
  apoio.data.value?.recepcoes.find((r) => r.id === id)?.descricao ?? String(id);
const nomeLocal = (id: number) =>
  apoio.data.value?.recepcoes.flatMap((r) => r.locais).find((l) => l.id === id)?.descricao ?? String(id);
const podeLiberar = computed(() => pode('recepcao.guiche.liberar'));

type GuicheLinha = NonNullable<typeof painel.data.value>['guiches'][number];
const liberando = ref<GuicheLinha | null>(null);
const justificativa = ref('');
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const dialogo = computed({
  get: () => liberando.value !== null,
  set: (v: boolean) => {
    if (!v) liberando.value = null;
  },
});
function abrirLiberacao(g: GuicheLinha): void {
  justificativa.value = '';
  liberando.value = g;
}
async function liberar(): Promise<void> {
  const g = liberando.value;
  if (!g || justificativa.value.trim().length < 5) return;
  liberando.value = null;
  mensagem.value = null;
  erro.value = null;
  try {
    const r = await fecharGuiche(
      { recepcao: g.recepcao, local: g.local, guiche: g.guiche, justificativa: justificativa.value },
      novaChave('liberar'),
    );
    mensagem.value = r.mensagem;
  } catch (e) {
    erro.value = e;
  } finally {
    await cliente.invalidateQueries({ queryKey: ['recepcao'] });
  }
}
</script>

<template>
  <section class="tela-recepcao" aria-labelledby="supervisor-titulo" data-testid="tela-supervisor">
    <h1 id="supervisor-titulo">{{ t('recepcao.supervisor.titulo') }}</h1>
    <p>{{ t('recepcao.supervisor.texto') }}</p>
    <div class="filtros">
      <SanteSelecao v-model="recepcao" :rotulo="t('recepcao.recepcao')" :opcoes="opcoes" />
      <RouterLink v-if="pode('recepcao.indicador.ler')" to="/recepcao/indicadores">{{
        t('recepcao.supervisor.indicadores')
      }}</RouterLink>
    </div>
    <p v-if="mensagem" role="status" data-testid="mensagem-supervisor">{{ mensagem }}</p>
    <MensagemErro v-if="erro" :erro="erro" />
    <MensagemErro v-if="painel.isError.value" :erro="painel.error.value" />
    <p v-else-if="!painel.data.value" role="status">{{ t('recepcao.carregando') }}</p>
    <template v-else>
      <p role="status" data-testid="supervisor-totais">
        {{ t('recepcao.supervisor.totais', painel.data.value.totais) }} ·
        {{ horaDe(painel.data.value.agora) }}
      </p>
      <table class="tabela" data-testid="supervisor-filas">
        <caption>
          {{
            t('recepcao.supervisor.filas')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('recepcao.servico') }}</th>
            <th scope="col">{{ t('recepcao.recepcao') }}</th>
            <th scope="col">{{ t('recepcao.supervisor.aguardando') }}</th>
            <th scope="col">{{ t('recepcao.supervisor.prioritarias') }}</th>
            <th scope="col">{{ t('recepcao.supervisor.esperaMedia') }}</th>
            <th scope="col">{{ t('recepcao.supervisor.maiorEspera') }}</th>
            <th scope="col">{{ t('recepcao.supervisor.meta') }}</th>
            <th scope="col">{{ t('recepcao.supervisor.acimaDaMeta') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="painel.data.value.filas.length === 0">
            <td colspan="8">{{ t('recepcao.nenhuma') }}</td>
          </tr>
          <tr v-for="f in painel.data.value.filas" :key="f.gerador">
            <td>{{ f.servico }}</td>
            <td>{{ nomeRecepcao(f.recepcao) }}</td>
            <td>{{ f.aguardando }}</td>
            <td>{{ f.prioritarias }}</td>
            <td>{{ t('recepcao.minutos', { n: f.esperaMediaMinutos }) }}</td>
            <td>{{ t('recepcao.minutos', { n: f.maiorEsperaMinutos }) }}</td>
            <td>{{ f.tempoAlvoMinutos ? t('recepcao.minutos', { n: f.tempoAlvoMinutos }) : '—' }}</td>
            <td>
              <strong v-if="f.acimaDaMeta > 0">{{ f.acimaDaMeta }}</strong>
              <template v-else>{{ f.acimaDaMeta }}</template>
            </td>
          </tr>
        </tbody>
      </table>
      <table class="tabela" data-testid="supervisor-guiches">
        <caption>
          {{
            t('recepcao.supervisor.guiches')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('recepcao.guicheRotulo') }}</th>
            <th scope="col">{{ t('recepcao.recepcao') }}</th>
            <th scope="col">{{ t('recepcao.local') }}</th>
            <th scope="col">{{ t('recepcao.supervisor.usuario') }}</th>
            <th scope="col">{{ t('recepcao.supervisor.chamadasHoje') }}</th>
            <th scope="col">
              <span class="visualmente-oculto">{{ t('recepcao.supervisor.liberar') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="painel.data.value.guiches.length === 0">
            <td colspan="6">{{ t('recepcao.nenhuma') }}</td>
          </tr>
          <tr
            v-for="g in painel.data.value.guiches"
            :key="`${g.recepcao}-${g.guiche}`"
            :data-testid="`guiche-${g.recepcao}-${g.guiche}`"
          >
            <td>{{ g.guiche }}</td>
            <td>{{ nomeRecepcao(g.recepcao) }}</td>
            <td>{{ nomeLocal(g.local) }}</td>
            <td>{{ g.usuario ?? '—' }}</td>
            <td>{{ g.chamadasHoje }}</td>
            <td>
              <SanteBotao
                v-if="podeLiberar && g.ocupadoPor === 'outro'"
                variante="texto"
                :rotulo="t('recepcao.supervisor.liberarTitulo', { guiche: g.guiche })"
                :data-testid="`liberar-${g.recepcao}-${g.guiche}`"
                @acionar="abrirLiberacao(g)"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <table class="tabela" data-testid="supervisor-antigas">
        <caption>
          {{
            t('recepcao.supervisor.maisAntigas')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('recepcao.senha') }}</th>
            <th scope="col">{{ t('recepcao.servico') }}</th>
            <th scope="col">{{ t('recepcao.prioridade') }}</th>
            <th scope="col">{{ t('recepcao.espera') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="painel.data.value.maisAntigas.length === 0">
            <td colspan="4">{{ t('recepcao.nenhuma') }}</td>
          </tr>
          <tr v-for="s in painel.data.value.maisAntigas" :key="s.id">
            <td>
              <strong>{{ s.texto }}</strong>
            </td>
            <td>{{ s.servico }}</td>
            <td>
              {{
                t(`recepcao.prioridades.${s.prioridade === '0' || s.prioridade === '1' ? s.prioridade : '2'}`)
              }}
            </td>
            <td>{{ t('recepcao.minutos', { n: s.esperaMinutos }) }}</td>
          </tr>
        </tbody>
      </table>
    </template>
    <SanteDialogo
      v-model:visivel="dialogo"
      :titulo="t('recepcao.supervisor.liberarTitulo', { guiche: liberando?.guiche ?? '' })"
    >
      <SanteCampoTexto
        v-model="justificativa"
        :rotulo="t('recepcao.supervisor.justificativa')"
        :max-bytes="200"
        multilinha
        obrigatorio
      />
      <template #rodape>
        <SanteBotao variante="secundario" :rotulo="t('recepcao.cancelar')" @acionar="liberando = null" />
        <SanteBotao
          :rotulo="t('recepcao.supervisor.liberar')"
          :desabilitado="justificativa.trim().length < 5"
          data-testid="confirmar-liberacao"
          @acionar="liberar"
        />
      </template>
    </SanteDialogo>
  </section>
</template>

<style src="../estilo-recepcao.css"></style>
