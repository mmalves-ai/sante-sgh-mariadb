<script setup lang="ts">
// Rastreio de amostra (ficha do M26, seção 7; regra 3): `/sadt/amostras`. As amostras do dia por estado e as passagens
// (coletada, em transporte, recebida, em análise, rejeitada e recoleta) com hora e responsável; o leitor acha a amostra
// pelo código da etiqueta. A rejeição pede o motivo (a lista padrão) e o "outro" pede o detalhe; as rejeições do dia
// aparecem por motivo. Só no novo (as tabelas de rastreio do outro sistema estão vazias).
import { aceitaPedidoDeRecoleta, podeMudar } from '@sgh/dominio-sadt';
import { CODIGOS_ESTADO_AMOSTRA, type AmostraDetalhe, type EstadoAmostra } from '@sgh/contratos';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { lerMotivosPedido, pedirRecoleta } from '../api-pedido.js';
import { lerAmostraPorCodigo, listarAmostras, mudarEstadoAmostra, novaChave } from '../api-sadt.js';
import AvisoSadt from '../componentes/AvisoSadt.vue';
import ErroSadt from '../componentes/ErroSadt.vue';
import PacienteSadt from '../componentes/PacienteSadt.vue';
import { hojeLocal, quando, usarSadt } from '../usar-sadt.js';

const { t } = useI18n();
const cliente = useQueryClient();
const data = ref(hojeLocal());
const filtro = ref('');
const { gravacao, apoio, pode } = usarSadt();
const lista = useQuery({
  queryKey: computed(() => ['sadt', 'amostras', data.value, filtro.value]),
  queryFn: () => listarAmostras(data.value, filtro.value || null),
});
const motivoRastreio = computed(() =>
  gravacao.data.value && !gravacao.data.value.rastreio.ligada ? gravacao.data.value.rastreio.motivo : null,
);
const estados = computed(() => [
  { valor: '', rotulo: t('sadt.situacoes.todos') },
  ...CODIGOS_ESTADO_AMOSTRA.map((e) => ({ valor: e, rotulo: t(`sadt.amostras.estados.${e}`) })),
]);
const codigo = ref('');
const achada = ref<AmostraDetalhe | null>(null);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
async function achar(): Promise<void> {
  erro.value = null;
  try {
    achada.value = await lerAmostraPorCodigo(codigo.value.trim());
  } catch (x) {
    achada.value = null;
    erro.value = x;
  }
}
const novoEstado = ref<Record<number, string>>({});
const motivo = ref<Record<number, string>>({});
const motivoRecoleta = ref<Record<number, string>>({});
const detalhe = ref<Record<number, string>>({});
const motivos = computed(() => [
  { valor: '', rotulo: t('sadt.escolha') },
  ...(apoio.data.value?.motivosRejeicao ?? []).map((m) => ({ valor: m.codigo, rotulo: m.rotulo })),
]);
// A recoleta não é troca de estado: vira o pedido de recoleta com o motivo do cadastro, que rejeita a original (e as
// alíquotas) e cria a nova coleta numerada (05-SADT linha 7). Oferecida em toda amostra coletada ainda não substituída.
const motivosPedido = useQuery({ queryKey: ['sadt', 'pedido', 'motivos'], queryFn: lerMotivosPedido });
const motivosRecoleta = computed(() => [
  { valor: '', rotulo: t('sadt.escolha') },
  ...(motivosPedido.data.value?.recoleta ?? []).map((m) => ({ valor: String(m.id), rotulo: m.descricao })),
]);
const proximos = (de: EstadoAmostra) => [
  { valor: '', rotulo: t('sadt.escolha') },
  ...CODIGOS_ESTADO_AMOSTRA.filter((p) =>
    p === 'recoleta' ? aceitaPedidoDeRecoleta(de) : podeMudar(de, p).pode,
  ).map((p) => ({
    valor: p,
    rotulo: t(`sadt.amostras.estados.${p}`),
  })),
];
const podePassar = (para: string) =>
  para === 'rejeitada' || para === 'recoleta' ? pode('rastreio', 'rejeitar') : pode('rastreio', 'receber');
const ocupado = ref(false);
async function mudar(a: AmostraDetalhe): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const para = novoEstado.value[a.id] ?? '';
    if (para === 'recoleta') {
      const rc = await pedirRecoleta(a.id, Number(motivoRecoleta.value[a.id]), novaChave('recoleta.pedir'));
      mensagem.value = t('sadt.pedido.pedida', { numero: rc.numero });
      novoEstado.value[a.id] = '';
      achada.value = null;
      await cliente.invalidateQueries({ queryKey: ['sadt'] });
      return;
    }
    const r = await mudarEstadoAmostra(
      a.id,
      {
        estado: para,
        ...(motivo.value[a.id] ? { motivo: motivo.value[a.id] } : {}),
        ...(detalhe.value[a.id]?.trim() ? { detalhe: detalhe.value[a.id]?.trim() } : {}),
      },
      novaChave('amostra'),
    );
    mensagem.value = `${r.codigo}: ${r.rotulo}`;
    if (achada.value?.id === a.id) achada.value = r;
    novoEstado.value[a.id] = '';
    await cliente.invalidateQueries({ queryKey: ['sadt'] });
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
const visiveis = computed(() => {
  const l = lista.data.value?.itens ?? [];
  return achada.value && !l.some((x) => x.id === achada.value?.id) ? [achada.value, ...l] : l;
});
</script>

<template>
  <section class="tela-agenda" aria-labelledby="amostras-titulo" data-testid="tela-sadt-amostras">
    <h1 id="amostras-titulo">{{ t('sadt.amostras.titulo') }}</h1>
    <p>{{ t('sadt.amostras.texto') }}</p>
    <AvisoSadt :motivo="motivoRastreio" />
    <div class="filtros">
      <span class="campo">
        <label for="amostra-codigo">{{ t('sadt.amostras.codigo') }}</label>
        <input id="amostra-codigo" v-model="codigo" data-testid="amostra-codigo" @keyup.enter="achar" />
      </span>
      <SanteBotao
        variante="secundario"
        :rotulo="t('sadt.amostras.ler')"
        data-testid="amostra-achar"
        @acionar="achar"
      />
      <span class="campo">
        <label for="amostra-data">{{ t('sadt.data') }}</label>
        <input id="amostra-data" v-model="data" type="date" />
      </span>
      <SanteSelecao v-model="filtro" :rotulo="t('sadt.situacao')" :opcoes="estados" />
    </div>
    <ErroSadt v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!lista.data.value" role="status">{{ t('sadt.carregando') }}</p>
    <p v-else-if="visiveis.length === 0">{{ t('sadt.nenhum') }}</p>
    <div v-for="a in visiveis" :key="a.id" class="painel" :data-testid="`amostra-${a.codigo}`">
      <h2>{{ a.codigo }} · {{ a.rotulo }}</h2>
      <p><PacienteSadt :paciente="a.paciente" /> · {{ a.recipiente ?? '—' }}</p>
      <p>{{ a.exames.map((e) => e.nome).join(', ') }}</p>
      <details>
        <summary>{{ t('sadt.amostras.eventos') }}</summary>
        <ul>
          <li v-for="(ev, i) in a.eventos" :key="i">
            {{ quando(ev.em) }} · {{ ev.rotulo }} · {{ ev.por
            }}<template v-if="ev.motivo"> · {{ ev.motivo }}</template>
          </li>
        </ul>
      </details>
      <div v-if="proximos(a.estado).length > 1" class="filtros">
        <SanteSelecao
          :model-value="novoEstado[a.id] ?? ''"
          @update:model-value="(v: string) => (novoEstado[a.id] = v)"
          :rotulo="t('sadt.amostras.estado')"
          :opcoes="proximos(a.estado)"
          :data-testid="`amostra-estado-${a.codigo}`"
        />
        <SanteSelecao
          v-if="novoEstado[a.id] === 'recoleta'"
          :model-value="motivoRecoleta[a.id] ?? ''"
          @update:model-value="(v: string) => (motivoRecoleta[a.id] = v)"
          :rotulo="t('sadt.motivo')"
          :opcoes="motivosRecoleta"
          :data-testid="`amostra-motivo-recoleta-${a.codigo}`"
        />
        <template v-if="novoEstado[a.id] === 'rejeitada'">
          <SanteSelecao
            :model-value="motivo[a.id] ?? ''"
            @update:model-value="(v: string) => (motivo[a.id] = v)"
            :rotulo="t('sadt.motivo')"
            :opcoes="motivos"
          />
          <span class="campo">
            <label :for="`amostra-detalhe-${a.id}`">{{ t('sadt.amostras.detalhe') }}</label>
            <input :id="`amostra-detalhe-${a.id}`" v-model="detalhe[a.id]" />
          </span>
        </template>
        <SanteBotao
          v-if="novoEstado[a.id] && podePassar(novoEstado[a.id] ?? '')"
          :rotulo="t('sadt.amostras.mudar')"
          :desabilitado="ocupado || (novoEstado[a.id] === 'recoleta' && !motivoRecoleta[a.id])"
          :data-testid="`amostra-mudar-${a.codigo}`"
          @acionar="mudar(a)"
        />
      </div>
    </div>
    <section v-if="(lista.data.value?.rejeicoes.length ?? 0) > 0" class="painel">
      <h2>{{ t('sadt.amostras.rejeicoes') }}</h2>
      <ul>
        <li v-for="r in lista.data.value?.rejeicoes ?? []" :key="r.motivo">
          {{ r.motivo }}: {{ r.quantidade }}
        </li>
      </ul>
    </section>
    <p v-if="mensagem" role="status" data-testid="amostra-mensagem">{{ mensagem }}</p>
    <ErroSadt v-if="erro" :erro="erro" />
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
