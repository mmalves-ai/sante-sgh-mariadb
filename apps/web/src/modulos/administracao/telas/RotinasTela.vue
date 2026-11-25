<script setup lang="ts">
// "Rotinas agendadas" (01-SIS L95, ficha F3.9): as rotinas automáticas do sistema (fechamento do censo, envio de
// eventos às integrações, envio agendado de relatórios, vigia do banco) com a última e a próxima execução e o atraso
// pela tolerância. As atrasadas e as com falha vêm primeiro; o histórico abre na própria linha, com as etapas (uma
// por estabelecimento ou passo) e quem disparou. Executar agora, suspender e retomar num clique (o servidor confere a
// regra; o botão já vem desabilitado com o motivo quando a regra não deixa). Atualiza sozinha a cada 30 segundos.
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { tipoDoProblema } from '@sgh/contratos';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import {
  acionarRotina,
  buscarHistoricoRotina,
  buscarRotinas,
  type RotinaDoPainel,
  suspensaoRotina,
} from '../api-rotinas.js';

const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      titulo: 'Rotinas agendadas',
      texto:
        'Rotinas automáticas do sistema com a última e a próxima execução. Atrasadas e com falha aparecem primeiro.',
      carregando: 'Carregando as rotinas…',
      nenhuma: 'Nenhuma rotina registrada ainda: elas aparecem na primeira volta do serviço.',
      soProblemas: 'Só atrasadas ou com falha',
      rotina: 'Rotina',
      situacao: 'Situação',
      ultima: 'Última execução',
      proxima: 'Próxima',
      acoes: 'Ações',
      executar: 'Executar agora',
      suspender: 'Suspender',
      retomar: 'Retomar',
      confirmaSuspender: 'Suspender a rotina? Ela não roda até alguém retomá-la.',
      historico: 'Histórico',
      fecharHistorico: 'Fechar histórico',
      pedido: 'Execução pedida; roda na próxima volta do serviço.',
      atrasada: 'Atrasada há {tempo}',
      semHistorico: 'Sem execuções registradas.',
      volumes: 'lidos {l} · gravados {g} · rejeitados {r}',
      por: 'por {quem}',
      etapa: 'Etapa',
      inicio: 'Início',
      fim: 'Fim',
      mensagem: 'Mensagem',
      colVolumes: 'Lidos / gravados / rejeitados',
      ok: 'Feito.',
      sit: {
        ociosa: 'Em dia',
        em_execucao: 'Em execução',
        suspensa: 'Suspensa',
        com_falha: 'Com falha',
        aguardando: 'Aguardando',
        concluida: 'Concluída',
        concluida_com_avisos: 'Concluída com avisos',
        falhou: 'Falhou',
        cancelada: 'Cancelada',
        expirada: 'Expirada',
        ignorada: 'Ignorada',
      },
      disp: { agendado: 'agendada', manual: 'à mão', reprocessamento: 'reprocessamento' },
    },
  },
});
const cliente = useQueryClient();
const consulta = useQuery({ queryKey: ['adm', 'rotinas'], queryFn: buscarRotinas, refetchInterval: 30_000 });
const aberta = ref<number | null>(null);
const historico = useQuery({
  queryKey: computed(() => ['adm', 'rotinas', 'historico', aberta.value]),
  queryFn: () => buscarHistoricoRotina(aberta.value as number),
  enabled: computed(() => aberta.value !== null),
});
const soProblemas = ref(false);
const recusa = ref('');
const aviso = ref('');
const erro = ref<unknown>(null);
const podeAcionar = computed(() => pode('config.rotina.acionar'));

const peso = (r: RotinaDoPainel) =>
  r.situacao === 'com_falha' ? 0 : r.atrasada ? 1 : r.situacao === 'suspensa' ? 3 : 2;
const rotinas = computed(() =>
  [...(consulta.data.value?.rotinas ?? [])]
    .filter((r) => !soProblemas.value || r.atrasada || r.situacao === 'com_falha')
    .sort((a, b) => peso(a) - peso(b) || a.nome.localeCompare(b.nome)),
);

const fmt = (s: string | null) =>
  s ? new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' }) : '—';
function tempo(seg: number): string {
  if (seg < 60) return `${seg} s`;
  if (seg < 3600) return `${Math.floor(seg / 60)} min`;
  if (seg < 86_400) return `${Math.floor(seg / 3600)} h ${Math.floor((seg % 3600) / 60)} min`;
  return `${Math.floor(seg / 86_400)} d`;
}
const sit = (s: string) => t(`sit.${s}`);

async function agir(fn: () => Promise<unknown>, mensagem: string): Promise<void> {
  recusa.value = '';
  aviso.value = '';
  erro.value = null;
  try {
    await fn();
    aviso.value = mensagem;
    await cliente.invalidateQueries({ queryKey: ['adm', 'rotinas'] });
  } catch (e) {
    if (e instanceof ErroApi && e.problema && tipoDoProblema(e.problema) === 'recusa-de-negocio')
      recusa.value = e.problema.detail ?? '';
    else erro.value = e;
  }
}
const alternar = (id: number) => (aberta.value = aberta.value === id ? null : id);
</script>

<template>
  <section class="tela" aria-labelledby="rotinas-titulo">
    <h1 id="rotinas-titulo">{{ t('titulo') }}</h1>
    <p>{{ t('texto') }}</p>
    <SanteAlerta v-if="recusa" :texto="recusa" variante="aviso" anunciar />
    <p v-if="aviso" role="status" data-testid="rotinas-aviso">{{ aviso }}</p>
    <MensagemErro v-if="erro" :erro="erro" />
    <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
    <p v-else-if="consulta.isPending.value">{{ t('carregando') }}</p>
    <template v-else-if="consulta.data.value">
      <label class="filtro">
        <input v-model="soProblemas" type="checkbox" data-testid="rotinas-so-problemas" />
        {{ t('soProblemas') }}
      </label>
      <p v-if="rotinas.length === 0">{{ t('nenhuma') }}</p>
      <table v-else data-testid="tabela-rotinas">
        <caption class="oculto">
          {{
            t('titulo')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('rotina') }}</th>
            <th scope="col">{{ t('situacao') }}</th>
            <th scope="col">{{ t('ultima') }}</th>
            <th scope="col">{{ t('proxima') }}</th>
            <th scope="col">{{ t('acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="r in rotinas" :key="r.id">
            <tr :data-testid="`rotina-${r.codigo}`">
              <th scope="row">
                {{ r.nome }}
                <small v-if="r.descricao" class="secundario">{{ r.descricao }}</small>
              </th>
              <td>
                <strong>{{ sit(r.situacao) }}</strong>
                <SanteAlerta
                  v-if="r.atrasada"
                  :texto="t('atrasada', { tempo: tempo(r.atrasoSegundos) })"
                  variante="aviso"
                />
                <small v-if="r.pedidoPendente" class="secundario">{{ t('pedido') }}</small>
              </td>
              <td>
                {{ fmt(r.ultimaExecucaoEm) }}
                <small v-if="r.ultima" class="secundario">
                  {{ sit(r.ultima.situacao) }} ({{ t(`disp.${r.ultima.disparo}`) }}) ·
                  {{ t('volumes', { l: r.ultima.lidos, g: r.ultima.gravados, r: r.ultima.rejeitados }) }}
                  <template v-if="r.ultima.mensagemErro"> · {{ r.ultima.mensagemErro }}</template>
                </small>
              </td>
              <td>{{ fmt(r.proximaExecucaoEm) }}</td>
              <td class="botoes">
                <SanteBotao
                  :rotulo="aberta === r.id ? t('fecharHistorico') : t('historico')"
                  variante="texto"
                  :data-testid="`historico-${r.codigo}`"
                  @acionar="alternar(r.id)"
                />
                <template v-if="podeAcionar">
                  <SanteBotao
                    v-if="r.permiteAcionamentoManual"
                    :rotulo="t('executar')"
                    variante="secundario"
                    :desabilitado="r.impedimentoAcionar !== null"
                    :title="r.impedimentoAcionar ?? undefined"
                    :data-testid="`executar-${r.codigo}`"
                    @acionar="agir(() => acionarRotina(r.id), t('pedido'))"
                  />
                  <SanteBotao
                    v-if="r.situacao === 'suspensa'"
                    :rotulo="t('retomar')"
                    variante="secundario"
                    :data-testid="`retomar-${r.codigo}`"
                    @acionar="agir(() => suspensaoRotina(r.id, r.versao, 'retomar'), t('ok'))"
                  />
                  <SanteBotao
                    v-else
                    :rotulo="t('suspender')"
                    variante="destrutivo"
                    :confirmacao="t('confirmaSuspender')"
                    :data-testid="`suspender-${r.codigo}`"
                    @acionar="agir(() => suspensaoRotina(r.id, r.versao, 'suspender'), t('ok'))"
                  />
                </template>
              </td>
            </tr>
            <tr v-if="aberta === r.id">
              <td colspan="5" :data-testid="`historico-lista-${r.codigo}`">
                <MensagemErro v-if="historico.isError.value" :erro="historico.error.value" />
                <p v-else-if="historico.isPending.value">{{ t('carregando') }}</p>
                <p v-else-if="(historico.data.value?.execucoes ?? []).length === 0">
                  {{ t('semHistorico') }}
                </p>
                <details v-for="x in historico.data.value?.execucoes ?? []" :key="x.id" class="execucao">
                  <summary>
                    {{ fmt(x.inicioEm ?? x.ocorridoEm) }} — {{ sit(x.situacao) }} ({{ t(`disp.${x.disparo}`)
                    }}<template v-if="x.usuario">, {{ t('por', { quem: x.usuario }) }}</template
                    >) · {{ t('volumes', { l: x.lidos, g: x.gravados, r: x.rejeitados }) }}
                    <template v-if="x.mensagemErro"> · {{ x.mensagemErro }}</template>
                  </summary>
                  <table v-if="x.etapas.length">
                    <thead>
                      <tr>
                        <th scope="col">{{ t('etapa') }}</th>
                        <th scope="col">{{ t('situacao') }}</th>
                        <th scope="col">{{ t('inicio') }}</th>
                        <th scope="col">{{ t('fim') }}</th>
                        <th scope="col">{{ t('colVolumes') }}</th>
                        <th scope="col">{{ t('mensagem') }}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="e in x.etapas" :key="e.sequencia">
                        <th scope="row">{{ e.nome }}</th>
                        <td>{{ sit(e.situacao) }}</td>
                        <td>{{ fmt(e.inicioEm) }}</td>
                        <td>{{ fmt(e.fimEm) }}</td>
                        <td>{{ e.lidos }} / {{ e.gravados }} / {{ e.rejeitados }}</td>
                        <td>{{ e.mensagem ?? '—' }}</td>
                      </tr>
                    </tbody>
                  </table>
                </details>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
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
  vertical-align: top;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
.secundario {
  display: block;
}
.botoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-1);
}
.filtro {
  display: inline-flex;
  gap: var(--sgh-espaco-1);
  margin-bottom: var(--sgh-espaco-2);
}
.execucao {
  margin-bottom: var(--sgh-espaco-1);
}
.oculto {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
</style>
