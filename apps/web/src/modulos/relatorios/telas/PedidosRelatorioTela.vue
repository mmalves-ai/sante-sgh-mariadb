<script setup lang="ts">
// Pedidos de relatório (M34; ficha, seção 7): `/relatorios/pedidos`. Quem tem `relatorio.pedido.criar` pede um
// relatório novo (o que mostra, para que serve, a área e o prazo) e acompanha os seus; o curador do catálogo
// (`relatorio.pedido.publicar`) vê todos e responde: em análise, publicado (com o relatório do catálogo que atende)
// ou recusado. O pedido nunca vira consulta livre: vira relatório revisado.
// W0-09: o pedido sem desdobramento se corrige enquanto aberto e se cancela com motivo; a exclusão física (com log) só
// vale para o nunca atendido; o já atendido é recusado (409) e a tela oferece o cancelamento. Histórico por pedido.
import { type PedidoLido, RELATORIOS_CATALOGO } from '@sgh/contratos';
import { SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import {
  alterarPedido,
  cancelarPedido,
  codigoDaRecusa,
  criarPedido,
  excluirPedido,
  lerHistoricoPedido,
  lerPedidos,
  novaChave,
  responderPedido,
} from '../api-relatorios.js';
import AcaoComMotivo from '../componentes/AcaoComMotivo.vue';
import RecusaVinculos from '../componentes/RecusaVinculos.vue';

const { t } = useI18n();
const cliente = useQueryClient();
const curador = pode('relatorio.pedido.publicar');
const pedidos = useQuery({ queryKey: ['relatorios', 'pedidos'], queryFn: () => lerPedidos() });
const novo = reactive({ titulo: '', descricao: '', finalidade: '', area: '', prazo: '' });
const erro = ref<unknown>(null);
const feito = ref<string | null>(null);
// W0-09: o pedido aberto em correção (o mesmo formulário, com o motivo).
const editando = ref<PedidoLido | null>(null);
const motivoEdicao = ref('');
const motivoCurto = ref(false);
let chaveEdicao: string | null = null;
function editar(p: PedidoLido): void {
  editando.value = p;
  Object.assign(novo, {
    titulo: p.titulo,
    descricao: p.descricao,
    finalidade: p.finalidade,
    area: p.area,
    prazo: p.prazo,
  });
  motivoEdicao.value = '';
  motivoCurto.value = false;
  chaveEdicao = null;
  feito.value = null;
}
function limparNovo(): void {
  editando.value = null;
  Object.assign(novo, { titulo: '', descricao: '', finalidade: '', area: '', prazo: '' });
}
async function pedir(): Promise<void> {
  erro.value = null;
  feito.value = null;
  try {
    if (editando.value) {
      if (motivoEdicao.value.trim().length < 5) {
        motivoCurto.value = true;
        return;
      }
      motivoCurto.value = false;
      chaveEdicao ??= novaChave('pedido-alterar');
      await alterarPedido(editando.value.id, { ...novo, motivo: motivoEdicao.value.trim() }, chaveEdicao);
      chaveEdicao = null;
      feito.value = t('relatorios.gestao.pedidoAlterado');
    } else {
      await criarPedido({ ...novo });
      feito.value = t('relatorios.pedidos.pedido');
    }
    limparNovo();
    await cliente.invalidateQueries({ queryKey: ['relatorios', 'pedidos'] });
  } catch (e) {
    erro.value = e;
  }
}

// W0-09: cancelar e excluir (com motivo); o histórico do pedido.
type AcaoPedido = { tipo: 'cancelar' | 'excluir'; pedido: PedidoLido };
const acao = ref<AcaoPedido | null>(null);
const recusa = ref<{ erro: unknown; pedido: PedidoLido } | null>(null);
const ocupado = ref(false);
let chaveAcao: string | null = null;
function iniciar(tipo: AcaoPedido['tipo'], pedido: PedidoLido): void {
  acao.value = { tipo, pedido };
  recusa.value = null;
  erro.value = null;
  feito.value = null;
  chaveAcao = null;
}
async function confirmarAcao(motivo: string): Promise<void> {
  const a = acao.value;
  if (!a) return;
  ocupado.value = true;
  erro.value = null;
  chaveAcao ??= novaChave(`pedido-${a.tipo}`);
  try {
    if (a.tipo === 'cancelar') await cancelarPedido(a.pedido.id, motivo, chaveAcao);
    else await excluirPedido(a.pedido.id, motivo, chaveAcao);
    feito.value = t(
      a.tipo === 'cancelar' ? 'relatorios.gestao.pedidoCancelado' : 'relatorios.gestao.pedidoExcluido',
    );
    acao.value = null;
    chaveAcao = null;
    await cliente.invalidateQueries({ queryKey: ['relatorios', 'pedidos'] });
  } catch (e) {
    chaveAcao = null;
    if (a.tipo === 'excluir' && codigoDaRecusa(e)?.startsWith('pedido-')) {
      recusa.value = { erro: e, pedido: a.pedido };
      acao.value = null;
    } else erro.value = e;
  } finally {
    ocupado.value = false;
  }
}
const historicoDe = ref<PedidoLido | null>(null);
const historico = useQuery({
  queryKey: computed(() => ['relatorios', 'pedidos', 'historico', historicoDe.value?.id]),
  queryFn: () => lerHistoricoPedido(historicoDe.value!.id),
  enabled: computed(() => historicoDe.value !== null),
});
const respondendo = ref<PedidoLido | null>(null);
const resposta = reactive({ situacao: 'em-analise', relatorio: '', resposta: '' });
async function responder(): Promise<void> {
  if (!respondendo.value) return;
  erro.value = null;
  try {
    await responderPedido(respondendo.value.id, {
      situacao: resposta.situacao,
      relatorio: resposta.relatorio || null,
      resposta: resposta.resposta,
    });
    respondendo.value = null;
    feito.value = t('relatorios.pedidos.respondido');
    await cliente.invalidateQueries({ queryKey: ['relatorios', 'pedidos'] });
  } catch (e) {
    erro.value = e;
  }
}
const opSituacoes = computed(() =>
  (['em-analise', 'publicado', 'recusado'] as const).map((s) => ({
    valor: s,
    rotulo: t(`relatorios.pedidos.situacoes.${s}`),
  })),
);
const opRelatorios = computed(() => [
  { valor: '', rotulo: '—' },
  ...RELATORIOS_CATALOGO.map((r) => ({ valor: r.codigo, rotulo: r.titulo })),
]);
</script>

<template>
  <section class="tela-agenda" aria-labelledby="pedidos-titulo" data-testid="tela-pedidos-relatorio">
    <h1 id="pedidos-titulo">{{ t('relatorios.pedidos.titulo') }}</h1>
    <p>{{ t('relatorios.pedidos.texto') }}</p>
    <form
      class="painel formulario"
      aria-labelledby="novo-pedido"
      data-testid="pedido-novo"
      @submit.prevent="pedir"
    >
      <h2 id="novo-pedido">
        {{
          editando
            ? t('relatorios.gestao.editarPedido', { t: editando.titulo })
            : t('relatorios.pedidos.novo')
        }}
      </h2>
      <SanteCampoTexto
        v-model="novo.titulo"
        :rotulo="t('relatorios.pedidos.tituloPedido')"
        :max-bytes="120"
        obrigatorio
      />
      <SanteCampoTexto
        v-model="novo.descricao"
        :rotulo="t('relatorios.pedidos.descricao')"
        :max-bytes="2000"
        multilinha
        obrigatorio
      />
      <SanteCampoTexto
        v-model="novo.finalidade"
        :rotulo="t('relatorios.pedidos.finalidade')"
        :max-bytes="300"
        obrigatorio
      />
      <SanteCampoTexto
        v-model="novo.area"
        :rotulo="t('relatorios.pedidos.area')"
        :max-bytes="60"
        obrigatorio
      />
      <span class="campo">
        <label for="pedido-prazo">{{ t('relatorios.pedidos.prazo') }}</label>
        <input id="pedido-prazo" v-model="novo.prazo" type="date" required />
      </span>
      <template v-if="editando">
        <SanteCampoTexto
          v-model="motivoEdicao"
          :rotulo="t('relatorios.gestao.motivo')"
          :max-bytes="200"
          obrigatorio
          data-testid="pedido-motivo"
        />
        <p v-if="motivoCurto" class="erro" role="alert" data-testid="pedido-motivo-curto">
          {{ t('relatorios.gestao.motivoCurto') }}
        </p>
      </template>
      <SanteBotao
        tipo="submit"
        :rotulo="editando ? t('relatorios.gravar') : t('relatorios.pedidos.pedir')"
        data-testid="pedido-enviar"
      />
      <SanteBotao
        v-if="editando"
        variante="texto"
        :rotulo="t('relatorios.gestao.desistir')"
        data-testid="pedido-desistir"
        @acionar="limparNovo"
      />
    </form>
    <p v-if="feito" role="status" data-testid="pedido-feito">{{ feito }}</p>
    <MensagemErro v-if="erro" :erro="erro" />
    <AcaoComMotivo
      v-if="acao"
      :titulo="t(`relatorios.gestao.titulo.${acao.tipo}Pedido`, { t: acao.pedido.titulo })"
      :rotulo="t(`relatorios.gestao.${acao.tipo}`)"
      :destrutivo="acao.tipo === 'excluir'"
      :dica="t(`relatorios.gestao.dica.${acao.tipo}Pedido`)"
      :ocupado="ocupado"
      @confirmar="confirmarAcao"
      @desistir="acao = null"
    />
    <RecusaVinculos
      v-if="recusa"
      :erro="recusa.erro"
      :oferta="t('relatorios.gestao.ofertaCancelar')"
      :sem-oferta="t('relatorios.gestao.pedidoJaCancelado')"
      @aceitar="iniciar('cancelar', recusa.pedido)"
    />
    <MensagemErro v-if="pedidos.isError.value" :erro="pedidos.error.value" />
    <p v-else-if="!pedidos.data.value" role="status">{{ t('relatorios.carregando') }}</p>
    <table v-else class="tabela" data-testid="tabela-pedidos">
      <caption>
        {{
          t('relatorios.pedidos.lista')
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">{{ t('relatorios.pedidos.tituloPedido') }}</th>
          <th scope="col">{{ t('relatorios.pedidos.area') }}</th>
          <th scope="col">{{ t('relatorios.pedidos.solicitante') }}</th>
          <th scope="col">{{ t('relatorios.pedidos.prazo') }}</th>
          <th scope="col">{{ t('relatorios.pedidos.situacao') }}</th>
          <th scope="col">{{ t('relatorios.pedidos.resposta') }}</th>
          <th scope="col">{{ t('relatorios.acoes') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="pedidos.data.value.length === 0">
          <td colspan="7">{{ t('relatorios.nenhum') }}</td>
        </tr>
        <tr v-for="p in pedidos.data.value" :key="p.id" :data-testid="`pedido-${p.id}`">
          <td>
            {{ p.titulo }}<span class="secundario">{{ p.finalidade }}</span>
          </td>
          <td>{{ p.area }}</td>
          <td>{{ p.solicitante }}</td>
          <td>
            {{ p.prazo.split('-').reverse().join('/') }}
            <strong v-if="p.atrasado">{{ t('relatorios.pedidos.atrasado') }}</strong>
          </td>
          <td>
            {{ t(`relatorios.pedidos.situacoes.${p.situacao}`) }}
            <span v-if="p.canceladoEm" class="secundario" :data-testid="`pedido-cancelado-${p.id}`">{{
              t('relatorios.gestao.canceladoPor', {
                por: p.canceladoPor ?? '—',
                em: p.canceladoEm.slice(0, 16).replace('T', ' '),
                motivo: p.motivoCancelamento ?? '—',
              })
            }}</span>
          </td>
          <td>
            {{ p.resposta ?? '—' }}<span v-if="p.relatorio" class="secundario">{{ p.relatorio }}</span>
          </td>
          <td>
            <SanteBotao
              v-if="curador && (p.situacao === 'aberto' || p.situacao === 'em-analise')"
              variante="texto"
              :rotulo="t('relatorios.pedidos.responder')"
              @acionar="respondendo = p"
            />
            <SanteBotao
              v-if="p.editavel"
              variante="texto"
              :rotulo="t('relatorios.gestao.editar')"
              :data-testid="`pedido-editar-${p.id}`"
              @acionar="editar(p)"
            />
            <SanteBotao
              v-if="p.cancelavel"
              variante="texto"
              :rotulo="t('relatorios.gestao.cancelar')"
              :data-testid="`pedido-cancelar-${p.id}`"
              @acionar="iniciar('cancelar', p)"
            />
            <SanteBotao
              v-if="p.excluivel || p.cancelavel"
              variante="texto"
              :rotulo="t('relatorios.gestao.excluir')"
              :data-testid="`pedido-excluir-${p.id}`"
              @acionar="iniciar('excluir', p)"
            />
            <SanteBotao
              variante="texto"
              :rotulo="t('relatorios.gestao.historico')"
              :data-testid="`pedido-historico-${p.id}`"
              @acionar="historicoDe = p"
            />
          </td>
        </tr>
      </tbody>
    </table>
    <form
      v-if="respondendo"
      class="painel formulario"
      data-testid="pedido-resposta"
      @submit.prevent="responder"
    >
      <h2>{{ t('relatorios.pedidos.responder') }}: {{ respondendo.titulo }}</h2>
      <SanteSelecao
        v-model="resposta.situacao"
        :rotulo="t('relatorios.pedidos.situacao')"
        :opcoes="opSituacoes"
      />
      <SanteSelecao
        v-model="resposta.relatorio"
        :rotulo="t('relatorios.pedidos.relatorio')"
        :opcoes="opRelatorios"
      />
      <SanteCampoTexto
        v-model="resposta.resposta"
        :rotulo="t('relatorios.pedidos.resposta')"
        :max-bytes="500"
        obrigatorio
      />
      <SanteBotao tipo="submit" :rotulo="t('relatorios.gravar')" />
      <SanteBotao variante="texto" :rotulo="t('relatorios.cancelar')" @acionar="respondendo = null" />
    </form>
    <section
      v-if="historicoDe"
      class="painel"
      data-testid="pedido-historico"
      aria-labelledby="pedido-hist-titulo"
    >
      <h2 id="pedido-hist-titulo">{{ t('relatorios.gestao.historicoDe', { t: historicoDe.titulo }) }}</h2>
      <MensagemErro v-if="historico.isError.value" :erro="historico.error.value" />
      <p v-else-if="!historico.data.value" role="status">{{ t('relatorios.carregando') }}</p>
      <p v-else-if="historico.data.value.length === 0">{{ t('relatorios.nenhum') }}</p>
      <ul v-else>
        <li v-for="(ev, i) in historico.data.value" :key="i">
          <strong>{{ t(`relatorios.gestao.eventos.${ev.evento}`) }}</strong> ·
          {{ ev.em.slice(0, 16).replace('T', ' ') }} · {{ ev.por }} · {{ ev.motivo }}
        </li>
      </ul>
      <SanteBotao variante="texto" :rotulo="t('relatorios.gestao.fechar')" @acionar="historicoDe = null" />
    </section>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style scoped>
.erro {
  color: var(--sgh-perigo-texto, var(--sgh-texto));
  font-weight: 600;
  margin: 0;
}
</style>
