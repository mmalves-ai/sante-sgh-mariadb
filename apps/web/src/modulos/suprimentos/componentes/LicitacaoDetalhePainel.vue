<script setup lang="ts">
// O processo aberto (M55, etapa 4): o resumo (regime, modalidade, critério, objeto, agente, estimado, publicação,
// abertura, julgamento, homologação, prazo de recurso) com os próximos passos e o motivo de cada bloqueio, os avisos
// (pesquisa insuficiente, inexequível, empate, prazo de recurso), e as abas de trabalho: itens e pesquisa de preços,
// sessão e julgamento, etapas e atos, autoridade, histórico e o termo de referência (só antes da pesquisa). Conduzir
// e homologar pelas permissões e com a funcionalidade ligada; o servidor confere tudo de novo.
import type { EventoLicitacao } from '@sgh/contratos';
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { lerLicitacaoTela } from '../api-licitacao.js';
import { data, reais } from '../usar-suprimentos.js';
import ErroSuprimentos from './ErroSuprimentos.vue';
import LicitacaoAtosPainel from './LicitacaoAtosPainel.vue';
import LicitacaoAutoridadePainel from './LicitacaoAutoridadePainel.vue';
import LicitacaoDocumentosPainel from './LicitacaoDocumentosPainel.vue';
import LicitacaoFormulario from './LicitacaoFormulario.vue';
import LicitacaoPesquisaPainel from './LicitacaoPesquisaPainel.vue';
import LicitacaoSessaoPainel from './LicitacaoSessaoPainel.vue';
import {
  podeLicitacao,
  rotuloCriterio,
  rotuloEtapa,
  rotuloEventoLicitacao,
  rotuloModalidade,
  rotuloNatureza,
  rotuloRegime,
  rotuloVeiculo,
} from './licitacao-tela.js';

const props = defineProps<{ id: number }>();
const emit = defineEmits<{ fechar: []; mudou: [] }>();
const { t } = useI18n();
const k = (s: string, p?: Record<string, unknown>) => t(`licitacao.${s}`, p ?? {});
type Aba = 'resumo' | 'pesquisa' | 'sessao' | 'atos' | 'autoridade' | 'historico' | 'termo';
const aba = ref<Aba>('resumo');
const consulta = useQuery({
  queryKey: computed(() => ['licitacoes', 'detalhe', props.id]),
  queryFn: () => lerLicitacaoTela(props.id),
});
const d = computed(() => consulta.data.value ?? null);
const conduz = computed(() => podeLicitacao(d.value?.gravacao, 'conduzir'));
const homologa = computed(() => podeLicitacao(d.value?.gravacao, 'homologar'));
const abas = computed<Aba[]>(() => [
  'resumo',
  'pesquisa',
  'sessao',
  'atos',
  'autoridade',
  'historico',
  ...(d.value?.etapa === 'planejamento' ? (['termo'] as Aba[]) : []),
]);
const mensagem = ref('');
const diaHora = (x: string) => `${data(x)} ${x.slice(11, 16)}`;
const tid = (s: string) => `lic-det-${s}`;

async function gravado(m: string): Promise<void> {
  mensagem.value = m;
  await consulta.refetch();
  emit('mudou');
}
async function termoGravado(_id: number, m: string): Promise<void> {
  aba.value = 'resumo';
  await gravado(m);
}

/** A aba onde se faz cada próximo passo. */
const ABA_DA_ACAO: Readonly<Record<string, Aba>> = {
  pesquisa: 'atos',
  edital: 'atos',
  publicado: 'atos',
  sessao: 'atos',
  julgado: 'sessao',
  fracassado: 'atos',
  deserto: 'atos',
  homologar: 'autoridade',
  revogar: 'autoridade',
};
const rotuloAcao = (a: string) =>
  a === 'homologar'
    ? k('detalhe.acaoHomologar')
    : a === 'revogar'
      ? k('detalhe.acaoRevogar')
      : rotuloEtapa(a);

function detalheEvento(e: EventoLicitacao): string {
  const xs: string[] = [];
  if (e.de && e.para && e.de !== e.para)
    xs.push(k('historico.etapas', { de: rotuloEtapa(e.de), para: rotuloEtapa(e.para) }));
  if (e.data) xs.push(k('historico.dataAto', { data: data(e.data) }));
  if (e.veiculo) xs.push(k('historico.veiculo', { veiculo: rotuloVeiculo(e.veiculo) }));
  if (e.referencia) xs.push(k('historico.referencia', { ref: e.referencia }));
  if (e.fornecedor !== null) xs.push(k('historico.fornecedor', { n: e.fornecedor }));
  if (e.resultado) xs.push(k('historico.resultado', { r: e.resultado }));
  if (e.pedido !== null) xs.push(k('historico.pedido', { n: e.pedido }));
  if (e.documento !== null) xs.push(k('historico.documento', { n: e.documento }));
  if (e.descricao) xs.push(e.descricao);
  return xs.join(' · ');
}
const eventos = computed(() => [...(d.value?.eventos ?? [])].sort((a, b) => b.id - a.id));
</script>

<template>
  <section class="detalhe-licitacao" aria-labelledby="lic-det-titulo" :data-testid="tid('painel')">
    <ErroSuprimentos v-if="consulta.isError.value" :erro="consulta.error.value" />
    <p v-else-if="!d" role="status">{{ k('carregando') }}</p>
    <template v-else>
      <div class="barra">
        <h2 id="lic-det-titulo">{{ d.numero }} · {{ rotuloModalidade(d.modalidade) }}</h2>
        <span class="secundario" :data-testid="tid('etapa')" :data-etapa="d.etapa">{{
          rotuloEtapa(d.etapa)
        }}</span>
        <SanteBotao
          variante="secundario"
          :rotulo="k('fechar')"
          :data-testid="tid('fechar')"
          @acionar="emit('fechar')"
        />
      </div>
      <div class="abas" role="tablist">
        <SanteBotao
          v-for="a in abas"
          :key="a"
          role="tab"
          :aria-selected="aba === a"
          variante="secundario"
          :rotulo="k(`detalhe.abas.${a}`)"
          :data-testid="tid(`aba-${a}`)"
          @acionar="aba = a"
        />
      </div>
      <p v-if="mensagem" role="status" :data-testid="tid('mensagem')">{{ mensagem }}</p>
      <SanteAlerta
        v-if="!d.gravacao.ligada"
        variante="aviso"
        :texto="d.gravacao.motivo ?? k('emConsulta')"
        :data-testid="tid('desligado')"
      />
      <SanteAlerta
        v-for="a in d.avisos"
        :key="a.codigo"
        variante="aviso"
        :texto="a.mensagem"
        :data-testid="tid(`aviso-${a.codigo}`)"
      />

      <template v-if="aba === 'resumo'">
        <dl class="resumo-licitacao" :data-testid="tid('dados')">
          <div>
            <dt>{{ k('detalhe.regime') }}</dt>
            <dd>{{ rotuloRegime(d.regime) }}</dd>
          </div>
          <div>
            <dt>{{ k('detalhe.criterio') }}</dt>
            <dd>{{ rotuloCriterio(d.criterio) }}</dd>
          </div>
          <div>
            <dt>{{ k('detalhe.natureza') }}</dt>
            <dd>{{ rotuloNatureza(d.processo.natureza) }}</dd>
          </div>
          <div>
            <dt>{{ k('detalhe.objeto') }}</dt>
            <dd>{{ d.objeto }}</dd>
          </div>
          <div>
            <dt>{{ k('detalhe.justificativa') }}</dt>
            <dd>{{ d.processo.justificativa }}</dd>
          </div>
          <div v-if="d.processo.fundamento">
            <dt>{{ k('detalhe.fundamento') }}</dt>
            <dd>{{ d.processo.fundamento }}</dd>
          </div>
          <div>
            <dt>{{ k('detalhe.agente') }}</dt>
            <dd>{{ d.agente }}</dd>
          </div>
          <div>
            <dt>{{ k('detalhe.estimado') }}</dt>
            <dd :data-testid="tid('estimado')">
              {{ d.valorEstimado === null ? '—' : reais(d.valorEstimado) }}
              <span v-if="d.processo.sigiloso" class="secundario"> · {{ k('detalhe.sigiloso') }}</span>
            </dd>
          </div>
          <div v-if="d.processo.dataPublicacao">
            <dt>{{ k('detalhe.publicacao') }}</dt>
            <dd>{{ data(d.processo.dataPublicacao) }}</dd>
          </div>
          <div v-if="d.dataAbertura">
            <dt>{{ k('detalhe.abertura') }}</dt>
            <dd>{{ data(d.dataAbertura) }}</dd>
          </div>
          <div v-if="d.processo.dataJulgamento">
            <dt>{{ k('detalhe.julgamento') }}</dt>
            <dd>
              {{
                k('detalhe.julgadoPor', {
                  data: data(d.processo.dataJulgamento),
                  usuario: d.processo.julgadoPor ?? '—',
                })
              }}
              <template v-if="d.prazoRecursoAte">
                · {{ k('detalhe.prazoRecurso', { data: data(d.prazoRecursoAte) }) }}
              </template>
            </dd>
          </div>
          <div v-if="d.processo.homologadoEm">
            <dt>{{ k('detalhe.etapa') }}</dt>
            <dd>
              {{
                k('detalhe.homologadoPor', {
                  data: data(d.processo.homologadoEm),
                  usuario: d.processo.homologadoPor ?? '—',
                })
              }}
            </dd>
          </div>
        </dl>
        <h3>{{ k('detalhe.proximas') }}</h3>
        <p v-if="d.acoes.length === 0" class="secundario">{{ k('detalhe.nenhumaAcao') }}</p>
        <ul v-else class="proximas-licitacao" :data-testid="tid('proximas')">
          <li v-for="a in d.acoes" :key="a.acao" :data-testid="tid(`acao-${a.acao}`)" :data-pode="a.pode">
            <strong>{{ rotuloAcao(a.acao) }}</strong>
            <span class="secundario"> · {{ a.pode ? k('detalhe.pode') : k('detalhe.bloqueado') }}</span>
            <span v-if="a.motivo"> · {{ a.motivo }}</span>
            <SanteBotao
              variante="texto"
              :rotulo="k('detalhe.abrirAba', { aba: k(`detalhe.abas.${ABA_DA_ACAO[a.acao] ?? 'atos'}`) })"
              :data-testid="tid(`ir-${a.acao}`)"
              @acionar="aba = ABA_DA_ACAO[a.acao] ?? 'atos'"
            />
          </li>
        </ul>
        <LicitacaoDocumentosPainel
          :id="d.id"
          :etapa="d.etapa"
          :eventos="d.eventos"
          @emitido="consulta.refetch()"
        />
      </template>

      <LicitacaoPesquisaPainel v-else-if="aba === 'pesquisa'" :d="d" :pode="conduz" @gravado="gravado" />
      <LicitacaoSessaoPainel v-else-if="aba === 'sessao'" :d="d" :pode="conduz" @gravado="gravado" />
      <LicitacaoAtosPainel v-else-if="aba === 'atos'" :d="d" :pode="conduz" @gravado="gravado" />
      <LicitacaoAutoridadePainel
        v-else-if="aba === 'autoridade'"
        :d="d"
        :pode="homologa"
        @gravado="gravado"
      />

      <template v-else-if="aba === 'historico'">
        <p v-if="eventos.length === 0" class="secundario">{{ k('historico.nenhum') }}</p>
        <div v-else class="rolagem">
          <table class="grade" :data-testid="tid('historico')">
            <thead>
              <tr>
                <th scope="col">{{ k('historico.colData') }}</th>
                <th scope="col">{{ k('historico.colAto') }}</th>
                <th scope="col">{{ k('historico.colDetalhe') }}</th>
                <th scope="col">{{ k('historico.colUsuario') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="e in eventos" :key="e.id" :data-testid="tid(`evento-${e.tipo}`)">
                <td>{{ diaHora(e.criadoEm) }}</td>
                <td>{{ rotuloEventoLicitacao(e.tipo) }}</td>
                <td>{{ detalheEvento(e) }}</td>
                <td>{{ e.usuario }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <LicitacaoFormulario
        v-else-if="aba === 'termo'"
        :key="d.versao"
        :licitacao="d"
        :pode="conduz"
        @gravado="termoGravado"
        @cancelar="aba = 'resumo'"
      />
    </template>
  </section>
</template>
