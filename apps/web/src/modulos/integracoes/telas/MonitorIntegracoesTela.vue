<script setup lang="ts">
// Monitor de filas e reprocessamento (M34; ficha, seção 7, regras 8 a 10): `/admin/integracoes/monitor`. A saída de
// eventos, as entregas e as entradas por parceiro e situação, a fila de mortos com o alerta das que passaram de 4 h sem
// tratamento, o tratamento com o motivo (`integracao.fila.reprocessar`: reprocessar, corrigir ou descartar; auditado)
// e a saúde das integrações em uso (filas HL7, fila do BI, exames para o laboratório de apoio: só contagens).
import { type EnvioLido, TRATAMENTOS_MORTO } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { lerMonitor, tratarMorto } from '../api-integracoes.js';

const { t, te } = useI18n();
const cliente = useQueryClient();
const podeTratar = pode('integracao.fila.reprocessar');
const monitor = useQuery({
  queryKey: ['integracoes', 'monitor'],
  queryFn: () => lerMonitor(),
  refetchInterval: 30_000,
});
const tratando = ref<EnvioLido | null>(null);
const tratamento = reactive({ acao: 'reprocessar', motivo: '' });
const erro = ref<unknown>(null);
const feito = ref<string | null>(null);
async function tratar(): Promise<void> {
  if (!tratando.value) return;
  erro.value = null;
  try {
    const r = await tratarMorto(tratando.value.id, tratamento.acao, tratamento.motivo);
    feito.value = t('integracoes.monitor.tratado', { situacao: situacao(r.situacao) });
    tratando.value = null;
    tratamento.motivo = '';
    await cliente.invalidateQueries({ queryKey: ['integracoes', 'monitor'] });
  } catch (e) {
    erro.value = e;
  }
}
const situacao = (s: string) =>
  te(`integracoes.monitor.situacoes.${s}`) ? t(`integracoes.monitor.situacoes.${s}`) : s;
const opAcoes = computed(() =>
  TRATAMENTOS_MORTO.map((a) => ({ valor: a, rotulo: t(`integracoes.monitor.acoesMorto.${a}`) })),
);
const quando = (v: string | null) => (v ? v.slice(0, 16).replace('T', ' ') : '—');
</script>

<template>
  <section class="tela-agenda" aria-labelledby="monitor-titulo" data-testid="tela-monitor-integracoes">
    <h1 id="monitor-titulo">{{ t('integracoes.monitor.titulo') }}</h1>
    <p>{{ t('integracoes.monitor.texto') }}</p>
    <MensagemErro v-if="monitor.isError.value" :erro="monitor.error.value" />
    <p v-else-if="!monitor.data.value" role="status">{{ t('integracoes.carregando') }}</p>
    <template v-else>
      <p class="secundario">
        {{ t('integracoes.monitor.medido', { quando: quando(monitor.data.value.medidoEm) }) }}
      </p>
      <div v-if="monitor.data.value.alertas.length" role="alert" data-testid="monitor-alerta">
        <SanteAlerta
          variante="alerta"
          :texto="t('integracoes.monitor.alertas', { n: monitor.data.value.alertas.length })"
        />
      </div>
      <p v-if="feito" role="status" data-testid="monitor-feito">{{ feito }}</p>
      <section class="painel" aria-labelledby="mortos-titulo">
        <h2 id="mortos-titulo">{{ t('integracoes.monitor.mortos') }}</h2>
        <p v-if="monitor.data.value.mortos.length === 0">{{ t('integracoes.monitor.semMortos') }}</p>
        <table v-else class="tabela" data-testid="tabela-mortos">
          <caption>
            {{
              t('integracoes.monitor.mortos')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('integracoes.monitor.parceiro') }}</th>
              <th scope="col">{{ t('integracoes.monitor.evento') }}</th>
              <th scope="col">{{ t('integracoes.monitor.objeto') }}</th>
              <th scope="col">{{ t('integracoes.monitor.tentativas') }}</th>
              <th scope="col">{{ t('integracoes.monitor.resposta') }}</th>
              <th v-if="podeTratar" scope="col">{{ t('integracoes.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in monitor.data.value.mortos" :key="m.id" :data-testid="`morto-${m.id}`">
              <td>{{ m.parceiro }}</td>
              <td>{{ m.tipoEvento }}</td>
              <td>{{ m.objeto ?? m.chaveOrdem }}</td>
              <td>{{ m.tentativas }}</td>
              <td>
                {{ m.resposta ?? '—' }}
                <span class="secundario">{{
                  t('integracoes.monitor.morta', { n: m.minutosMorto ?? 0 })
                }}</span>
              </td>
              <td v-if="podeTratar">
                <SanteBotao
                  variante="secundario"
                  :rotulo="t('integracoes.monitor.tratar')"
                  :data-testid="`morto-tratar-${m.id}`"
                  @acionar="tratando = m"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <form v-if="tratando" class="formulario" data-testid="morto-tratamento" @submit.prevent="tratar">
          <SanteSelecao v-model="tratamento.acao" :rotulo="t('integracoes.monitor.acao')" :opcoes="opAcoes" />
          <SanteCampoTexto
            v-model="tratamento.motivo"
            :rotulo="t('integracoes.motivo')"
            :max-bytes="200"
            obrigatorio
            data-testid="morto-motivo"
          />
          <MensagemErro v-if="erro" :erro="erro" />
          <SanteBotao tipo="submit" :rotulo="t('integracoes.gravar')" data-testid="morto-confirmar" />
          <SanteBotao variante="texto" :rotulo="t('integracoes.cancelar')" @acionar="tratando = null" />
        </form>
      </section>
      <section class="painel" aria-labelledby="filas-titulo">
        <h2 id="filas-titulo">{{ t('integracoes.monitor.envios') }}</h2>
        <table class="tabela" data-testid="tabela-envios">
          <caption>
            {{
              t('integracoes.monitor.envios')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('integracoes.monitor.parceiro') }}</th>
              <th scope="col">{{ t('integracoes.monitor.situacao') }}</th>
              <th scope="col">{{ t('integracoes.monitor.quantidade') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="x in monitor.data.value.envios" :key="`${x.parceiro}-${x.situacao}`">
              <td>{{ x.parceiro }}</td>
              <td>{{ situacao(x.situacao) }}</td>
              <td>{{ x.quantidade }}</td>
            </tr>
          </tbody>
        </table>
        <h3>{{ t('integracoes.monitor.outbox') }}</h3>
        <ul>
          <li v-for="x in monitor.data.value.outbox" :key="`${x.tipo}-${x.situacao}`">
            {{ x.tipo }} · {{ situacao(x.situacao) }}: {{ x.quantidade }}
          </li>
        </ul>
        <h3>{{ t('integracoes.monitor.entradas') }}</h3>
        <ul>
          <li v-for="x in monitor.data.value.entradas" :key="`${x.parceiro}-${x.situacao}`">
            {{ x.parceiro }} · {{ situacao(x.situacao) }}: {{ x.quantidade }}
          </li>
        </ul>
      </section>
      <section
        v-if="monitor.data.value.legado"
        class="painel"
        aria-labelledby="em-uso-titulo"
        data-testid="monitor-em-uso"
      >
        <h2 id="em-uso-titulo">{{ t('integracoes.monitor.legado') }}</h2>
        <table class="tabela">
          <caption>
            {{
              t('integracoes.monitor.filas')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('integracoes.monitor.fila') }}</th>
              <th scope="col">{{ t('integracoes.monitor.direcao') }}</th>
              <th scope="col">{{ t('integracoes.monitor.quantidade') }}</th>
              <th scope="col">{{ t('integracoes.monitor.maisAntiga') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="f in monitor.data.value.legado.filas" :key="f.fila">
              <td>{{ f.fila }}</td>
              <td>{{ t(`integracoes.monitor.direcoes.${f.direcao}`) }}</td>
              <td>{{ f.quantidade }}</td>
              <td>{{ quando(f.maisAntiga) }}</td>
            </tr>
          </tbody>
        </table>
        <p>{{ t('integracoes.monitor.bi', { n: monitor.data.value.legado.bi.pendentes }) }}</p>
        <p>{{ t('integracoes.monitor.apoio', monitor.data.value.legado.examesApoio) }}</p>
      </section>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
