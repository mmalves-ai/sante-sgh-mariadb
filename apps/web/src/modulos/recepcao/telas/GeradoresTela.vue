<script setup lang="ts">
// Geradores de senha e totem (M19; ficha, seção 7): o cadastro dos serviços de senha com gravação (02-REC linha 33,
// EstruturaRecepcaoBloco: prefixo único por recepção, tipo, prioridade legal, limite do dia e posição do botão), a fila de cada serviço (ordem de chamada, intercalação,
// tempo-alvo e o botão do totem, só do novo) e os totens cadastrados.
import { ORDENS_FILA, type GeradorLido } from '@sgh/contratos';
import { SanteBotao, SanteCampoTexto, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { configurarFila, lerApoio, novaChave } from '../api-recepcao.js';
import DispositivosBloco from '../componentes/DispositivosBloco.vue';
import EstruturaRecepcaoBloco from '../componentes/EstruturaRecepcaoBloco.vue';

const { t } = useI18n();
const cliente = useQueryClient();
const apoio = useQuery({ queryKey: ['recepcao', 'apoio'], queryFn: () => lerApoio() });
const podeEditar = computed(() => pode('recepcao.gerador.editar'));
const podeDispositivos = computed(() => pode('recepcao.dispositivo.ler'));
const linhas = computed(() =>
  (apoio.data.value?.recepcoes ?? []).flatMap((r) =>
    r.geradores.map((g) => ({ ...g, recepcaoNome: r.descricao })),
  ),
);
const ordemTexto = (o: string) =>
  t(`recepcao.geradores.ordens.${ORDENS_FILA.some((x) => x.codigo === o) ? o : 'prioridade'}`);

const editando = ref<GeradorLido | null>(null);
const ordem = ref('prioridade');
const intercalar = ref('2');
const tempoAlvo = ref('20');
const rotulo = ref('');
const noTotem = ref(true);
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const dialogo = computed({
  get: () => editando.value !== null,
  set: (v: boolean) => {
    if (!v) editando.value = null;
  },
});
const opcoesOrdem = computed(() =>
  ORDENS_FILA.map((o) => ({ valor: o.codigo, rotulo: t(`recepcao.geradores.ordens.${o.codigo}`) })),
);
function editar(g: GeradorLido): void {
  ordem.value = g.ordem;
  intercalar.value = String(g.intercalar);
  tempoAlvo.value = String(g.tempoAlvoMinutos);
  rotulo.value = g.rotuloTotem ?? '';
  noTotem.value = g.noTotem;
  editando.value = g;
}
const numeroEntre = (v: string, min: number, max: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};
const valido = computed(
  () => numeroEntre(intercalar.value, 1, 9) !== null && numeroEntre(tempoAlvo.value, 0, 600) !== null,
);
async function gravar(): Promise<void> {
  const g = editando.value;
  if (!g || !valido.value) return;
  editando.value = null;
  mensagem.value = null;
  erro.value = null;
  try {
    const r = await configurarFila(
      g.id,
      {
        gerador: g.id,
        ordem: ordem.value,
        intercalar: numeroEntre(intercalar.value, 1, 9),
        tempoAlvoMinutos: numeroEntre(tempoAlvo.value, 0, 600),
        rotuloTotem: rotulo.value.trim() || null,
        noTotem: noTotem.value,
      },
      novaChave('fila'),
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
  <section class="tela-recepcao" aria-labelledby="geradores-titulo" data-testid="tela-geradores">
    <h1 id="geradores-titulo">{{ t('recepcao.geradores.titulo') }}</h1>
    <p>{{ t('recepcao.geradores.texto') }}</p>
    <EstruturaRecepcaoBloco foco="servicos" />

    <section class="painel" aria-labelledby="fila-titulo">
      <h2 id="fila-titulo">{{ t('recepcao.geradores.fila') }}</h2>
      <p class="secundario">{{ t('recepcao.geradores.filaTexto') }}</p>
      <p v-if="mensagem" role="status" data-testid="mensagem-fila">{{ mensagem }}</p>
      <MensagemErro v-if="erro" :erro="erro" />
      <MensagemErro v-if="apoio.isError.value" :erro="apoio.error.value" />
      <p v-else-if="!apoio.data.value" role="status">{{ t('recepcao.carregando') }}</p>
      <table v-else class="tabela" data-testid="tabela-filas">
        <caption class="visualmente-oculto">
          {{
            t('recepcao.geradores.fila')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('recepcao.servico') }}</th>
            <th scope="col">{{ t('recepcao.recepcao') }}</th>
            <th scope="col">{{ t('recepcao.geradores.ordem') }}</th>
            <th scope="col">{{ t('recepcao.geradores.tempoAlvo') }}</th>
            <th scope="col">{{ t('recepcao.geradores.noTotem') }}</th>
            <th scope="col">
              <span class="visualmente-oculto">{{ t('recepcao.geradores.configurar') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="g in linhas" :key="g.id" :data-testid="`fila-${g.id}`">
            <td>
              <strong>{{ g.letra }}</strong> · {{ g.nome }}
              <template v-if="g.prioritaria"> · {{ t('recepcao.geradores.prioritaria') }}</template>
              <template v-if="!g.ativo"> · {{ t('recepcao.geradores.inativo') }}</template>
            </td>
            <td>{{ g.recepcaoNome }}</td>
            <td>
              {{ ordemTexto(g.ordem)
              }}<template v-if="g.ordem === 'intercalada'">
                · {{ t('recepcao.geradores.intercaladas', { n: g.intercalar }) }}</template
              >
            </td>
            <td>{{ g.tempoAlvoMinutos || '—' }}</td>
            <td>{{ g.noTotem ? (g.rotuloTotem ?? t('recepcao.sim')) : t('recepcao.nao') }}</td>
            <td>
              <SanteBotao
                v-if="podeEditar"
                variante="texto"
                :rotulo="t('recepcao.geradores.configurarTitulo', { servico: g.nome })"
                :data-testid="`configurar-${g.id}`"
                @acionar="editar(g)"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <DispositivosBloco v-if="podeDispositivos" tipo="totem" :titulo="t('recepcao.dispositivos.totens')" />

    <SanteDialogo
      v-model:visivel="dialogo"
      :titulo="t('recepcao.geradores.configurarTitulo', { servico: editando?.nome ?? '' })"
    >
      <div class="formulario">
        <SanteSelecao v-model="ordem" :rotulo="t('recepcao.geradores.ordem')" :opcoes="opcoesOrdem" />
        <div v-if="ordem === 'intercalada'" class="campo">
          <label for="fila-intercalar">{{ t('recepcao.geradores.intercalar') }}</label>
          <input id="fila-intercalar" v-model="intercalar" type="number" min="1" max="9" />
        </div>
        <div class="campo">
          <label for="fila-alvo">{{ t('recepcao.geradores.tempoAlvo') }}</label>
          <input id="fila-alvo" v-model="tempoAlvo" type="number" min="0" max="600" />
        </div>
        <label><input v-model="noTotem" type="checkbox" /> {{ t('recepcao.geradores.noTotem') }}</label>
        <SanteCampoTexto v-model="rotulo" :rotulo="t('recepcao.geradores.rotuloTotem')" :max-bytes="40" />
      </div>
      <template #rodape>
        <SanteBotao variante="secundario" :rotulo="t('recepcao.cancelar')" @acionar="editando = null" />
        <SanteBotao
          :rotulo="t('recepcao.gravar')"
          :desabilitado="!valido"
          data-testid="gravar-fila"
          @acionar="gravar"
        />
      </template>
    </SanteDialogo>
  </section>
</template>

<style src="../estilo-recepcao.css"></style>
