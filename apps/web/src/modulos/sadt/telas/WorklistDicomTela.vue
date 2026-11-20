<script setup lang="ts">
// Lista de trabalho DICOM e integração com o PACS/RIS (ficha do M47, seção 7, etapa 3; regras 8, 9 e 11):
// `/sadt/imagem/worklist`. Os exames de imagem do dia com a modalidade, o item da lista de trabalho (número de acesso,
// envios, entrega pelas integrações) e o status na modalidade; enviar os que ficaram de fora, reenviar com o mesmo
// número de acesso, o atalho para o monitor de integrações e, fora de produção, o simulador de modalidade.
import {
  CODIGOS_SITUACAO_WORKLIST,
  type ItemWorklist,
  type SituacaoWorklist,
  type StatusEstudo,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { codigoDaRecusa } from '../api-sadt.js';
import { enviarWorklist, lerWorklist, reenviarWorklist, simularStatus } from '../api-pacs.js';
import { hojeLocal, quando } from '../usar-sadt.js';

const { t, te } = useI18n();
const data = ref(hojeLocal());
const setor = ref('');
const situacao = ref('');
const termo = ref('');
const buscado = ref('');
const tela = useQuery({
  queryKey: computed(() => ['sadt', 'worklist', data.value, setor.value, situacao.value, buscado.value]),
  queryFn: () =>
    lerWorklist({
      data: data.value || undefined,
      ...(setor.value ? { setor: Number(setor.value) } : {}),
      ...(situacao.value ? { situacao: situacao.value as SituacaoWorklist } : {}),
      ...(buscado.value.trim() ? { termo: buscado.value.trim() } : {}),
    }),
  refetchInterval: 30_000,
});
const d = computed(() => tela.data.value);

const opcoesSetor = computed(() => [
  { valor: '', rotulo: t('pacs.filtros.todos') },
  ...(d.value?.setores ?? []).map((s) => ({
    valor: String(s.ato),
    rotulo: s.modalidade
      ? t('pacs.setores.comModalidade', { setor: s.rotulo, modalidade: s.modalidade })
      : t('pacs.setores.semModalidade', { setor: s.rotulo }),
  })),
]);
const opcoesSituacao = computed(() => [
  { valor: '', rotulo: t('pacs.filtros.todos') },
  ...CODIGOS_SITUACAO_WORKLIST.map((s) => ({ valor: s, rotulo: t(`pacs.situacoes.${s}`) })),
]);

const selecionados = ref<number[]>([]);
const aEnviar = computed(() => (d.value?.itens ?? []).filter((x) => x.situacao === 'a-enviar'));
function alternar(id: number): void {
  selecionados.value = selecionados.value.includes(id)
    ? selecionados.value.filter((x) => x !== id)
    : [...selecionados.value, id];
}
function selecionarTodos(): void {
  selecionados.value = aEnviar.value.map((x) => x.exame);
}

const ocupado = ref(false);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const textoErro = computed(() => {
  const c = codigoDaRecusa(erro.value);
  return c && te(`pacs.recusas.${c}`) ? t(`pacs.recusas.${c}`) : null;
});

async function agir(fn: () => Promise<string>): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    mensagem.value = await fn();
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
    await tela.refetch();
  }
}

const enviar = () =>
  agir(async () => {
    const r = await enviarWorklist(selecionados.value);
    selecionados.value = [];
    return [r.mensagem, ...r.ignorados.map((i) => `${i.exame}: ${i.motivo}`)].join(' ');
  });
const reenviar = (x: ItemWorklist) =>
  agir(async () => (await reenviarWorklist(x.mwl!.id, x.mwl!.envios)).mensagem);

// Simulador de modalidade (fora de produção).
const comItem = computed(() => (d.value?.itens ?? []).filter((x) => x.mwl));
const itemSimulado = ref('');
const opcoesItem = computed(() =>
  comItem.value.map((x) => ({
    valor: String(x.mwl!.id),
    rotulo: `${x.mwl!.accession} · ${x.nomeExame} · ${x.paciente.nome}`,
  })),
);
const simular = (status: StatusEstudo) =>
  agir(async () => {
    const r = await simularStatus(Number(itemSimulado.value), status);
    return t('pacs.simulador.resposta', {
      vigente: t(`pacs.status.${r.vigente}`),
      repetida: r.repetida ? t('pacs.simulador.repetida') : '',
      foraDeOrdem: r.foraDeOrdem ? t('pacs.simulador.foraDeOrdem') : '',
    });
  });
</script>

<template>
  <section class="tela-agenda" aria-labelledby="worklist-titulo" data-testid="tela-worklist-dicom">
    <h1 id="worklist-titulo">{{ t('pacs.titulo') }}</h1>
    <p>{{ t('pacs.texto') }}</p>
    <p class="acoes">
      <RouterLink to="/admin/integracoes/monitor" data-testid="worklist-monitor">{{
        t('pacs.acoes.monitor')
      }}</RouterLink>
    </p>
    <div class="filtros" role="group" :aria-label="t('pacs.filtros.titulo')">
      <span class="campo">
        <label for="worklist-data">{{ t('pacs.filtros.data') }}</label>
        <input id="worklist-data" v-model="data" type="date" data-testid="worklist-data" />
      </span>
      <SanteSelecao
        v-model="setor"
        :rotulo="t('pacs.filtros.setor')"
        :opcoes="opcoesSetor"
        data-testid="worklist-setor"
      />
      <SanteSelecao
        v-model="situacao"
        :rotulo="t('pacs.filtros.situacao')"
        :opcoes="opcoesSituacao"
        data-testid="worklist-situacao"
      />
      <span class="campo">
        <label for="worklist-termo">{{ t('pacs.filtros.termo') }}</label>
        <input
          id="worklist-termo"
          v-model="termo"
          type="search"
          maxlength="60"
          data-testid="worklist-termo"
          @keyup.enter="buscado = termo"
        />
      </span>
      <SanteBotao
        variante="secundario"
        :rotulo="t('pacs.filtros.buscar')"
        data-testid="worklist-buscar"
        @acionar="buscado = termo"
      />
    </div>
    <MensagemErro v-if="tela.isError.value" :erro="tela.error.value" />
    <p v-else-if="!d" role="status">{{ t('pacs.carregando') }}</p>
    <template v-else>
      <SanteAlerta
        v-if="d.destino.modo !== 'desligado'"
        variante="info"
        :texto="t(`pacs.destino.${d.destino.modo}`, { parceiro: d.destino.parceiro ?? '' })"
        data-testid="worklist-destino"
      />
      <SanteAlerta
        v-if="d.acoes.motivo"
        variante="aviso"
        :texto="d.acoes.motivo"
        data-testid="worklist-motivo"
      />
      <p class="secundario" data-testid="worklist-visualizador">
        {{
          d.visualizador.configurado
            ? t('pacs.visualizador.configurado', { nome: d.visualizador.nome })
            : t('pacs.visualizador.semEndereco')
        }}
      </p>
      <p v-if="mensagem" role="status" data-testid="worklist-mensagem">{{ mensagem }}</p>
      <div v-if="erro" role="alert" data-testid="worklist-erro">
        <SanteAlerta v-if="textoErro" variante="alerta" :texto="textoErro" />
        <MensagemErro v-else :erro="erro" />
      </div>

      <section class="painel" aria-labelledby="worklist-contagens" data-testid="worklist-contagens">
        <h2 id="worklist-contagens">{{ t('pacs.contagens') }}</h2>
        <ul class="lista">
          <li v-for="(n, s) in d.contagens" :key="s" :data-testid="`contagem-${s}`">
            {{ t(`pacs.situacoes.${s}`) }}: <strong>{{ n }}</strong>
          </li>
        </ul>
      </section>

      <p v-if="d.cortada" role="status">{{ t('sadt.cortada') }}</p>
      <p v-if="d.itens.length === 0" data-testid="worklist-vazia">{{ t('sadt.nenhum') }}</p>
      <table v-else class="tabela" data-testid="tabela-worklist">
        <caption>
          {{
            t('pacs.tabela.legenda')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">
              <span class="sgh-visualmente-oculto">{{ t('pacs.tabela.selecionar') }}</span>
            </th>
            <th scope="col">{{ t('pacs.tabela.exame') }}</th>
            <th scope="col">{{ t('pacs.tabela.paciente') }}</th>
            <th scope="col">{{ t('pacs.tabela.modalidade') }}</th>
            <th scope="col">{{ t('pacs.tabela.acesso') }}</th>
            <th scope="col">{{ t('pacs.tabela.entrega') }}</th>
            <th scope="col">{{ t('pacs.tabela.status') }}</th>
            <th scope="col">{{ t('pacs.tabela.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in d.itens" :key="x.exame" :data-testid="`worklist-exame-${x.exame}`">
            <td>
              <input
                v-if="x.situacao === 'a-enviar' && d.acoes.enviar"
                type="checkbox"
                :checked="selecionados.includes(x.exame)"
                :aria-label="t('pacs.tabela.selecionarExame', { exame: x.nomeExame })"
                :data-testid="`worklist-selecionar-${x.exame}`"
                @change="alternar(x.exame)"
              />
            </td>
            <td>
              {{ x.nomeExame }}
              <strong v-if="x.urgente"> · {{ t('pacs.tabela.urgente') }}</strong>
              <span class="secundario"> · {{ x.setor }} · {{ quando(x.data) }}</span>
            </td>
            <td>{{ x.paciente.nome }}</td>
            <td>{{ x.modalidade?.sigla ?? t('pacs.tabela.semItem') }}</td>
            <td :data-testid="`worklist-acesso-${x.exame}`">
              {{ x.mwl?.accession ?? t('pacs.tabela.semItem') }}
            </td>
            <td :data-testid="`worklist-situacao-${x.exame}`">
              {{ t(`pacs.situacoes.${x.situacao}`) }}
              <span v-if="x.mwl" class="secundario">
                ·
                {{
                  t('pacs.tabela.envios', {
                    n: x.mwl.envios,
                    em: quando(x.mwl.ultimoEnvioEm),
                    por: x.mwl.ultimoEnvioPor,
                    origem: t(`pacs.origens.${x.mwl.origem}`),
                  })
                }}
              </span>
              <span v-if="x.mwl && x.mwl.tentativas > 0" class="secundario">
                · {{ t('pacs.tabela.tentativas', { n: x.mwl.tentativas, resposta: x.mwl.resposta ?? '' }) }}
              </span>
            </td>
            <td :data-testid="`worklist-status-${x.exame}`">
              {{ x.estudo ? t(`pacs.status.${x.estudo.status}`) : t('pacs.tabela.semItem') }}
              <a
                v-if="x.estudo?.link"
                :href="x.estudo.link"
                target="_blank"
                rel="noopener noreferrer"
                :data-testid="`worklist-link-${x.exame}`"
                >{{ t('pacs.acoes.abrirImagens') }}</a
              >
            </td>
            <td>
              <SanteBotao
                v-if="x.mwl && d.acoes.reenviar"
                variante="texto"
                :rotulo="t('pacs.acoes.reenviar')"
                :aria-label="t('pacs.acoes.reenviarExame', { acesso: x.mwl.accession })"
                :desabilitado="ocupado"
                :data-testid="`worklist-reenviar-${x.exame}`"
                @acionar="reenviar(x)"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="d.acoes.enviar && aEnviar.length > 0" class="acoes">
        <SanteBotao
          variante="secundario"
          :rotulo="t('pacs.acoes.selecionarTodos')"
          data-testid="worklist-selecionar-todos"
          @acionar="selecionarTodos"
        />
        <SanteBotao
          :rotulo="t('pacs.acoes.enviar')"
          :desabilitado="ocupado || selecionados.length === 0"
          data-testid="worklist-enviar"
          @acionar="enviar"
        />
      </p>

      <section
        v-if="d.acoes.simular && comItem.length > 0"
        class="painel"
        aria-labelledby="worklist-simulador"
        data-testid="worklist-simulador"
      >
        <h2 id="worklist-simulador">{{ t('pacs.simulador.titulo') }}</h2>
        <p class="secundario">{{ t('pacs.simulador.texto') }}</p>
        <SanteSelecao
          v-model="itemSimulado"
          :rotulo="t('pacs.simulador.item')"
          :opcoes="opcoesItem"
          data-testid="simulador-item"
        />
        <p class="acoes">
          <SanteBotao
            variante="secundario"
            :rotulo="t('pacs.simulador.iniciar')"
            :desabilitado="ocupado || !itemSimulado"
            data-testid="simulador-em-andamento"
            @acionar="simular('em-andamento')"
          />
          <SanteBotao
            :rotulo="t('pacs.simulador.concluir')"
            :desabilitado="ocupado || !itemSimulado"
            data-testid="simulador-concluido"
            @acionar="simular('concluido')"
          />
          <SanteBotao
            variante="texto"
            :rotulo="t('pacs.simulador.descontinuar')"
            :desabilitado="ocupado || !itemSimulado"
            data-testid="simulador-descontinuado"
            @acionar="simular('descontinuado')"
          />
        </p>
      </section>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
