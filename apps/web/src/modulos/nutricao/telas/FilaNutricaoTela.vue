<script setup lang="ts">
// Fila da nutrição e triagem (ficha do M45, seção 7; regra 10): `/nutricao/triagem`. Os internados a triar em até 48 h da
// admissão (de preferência 24 h), a vencida em vermelho, a de atenção, as reavaliações e os triados, com os indicadores
// (triados em 24 h e em 48 h, com as parcelas). A nutricionista tria pela ação de cada linha (NRS-2002, ou NUTRIC na
// terapia intensiva); o total é sempre calculado pelo sistema.
// W0-05: o histórico das triagens de cada internado num cartão (todas as versões; a inativa riscada e visível, com quem,
// quando e o motivo); o próprio autor retifica (nova versão pelo formulário da triagem, com o motivo) ou estorna (o
// diálogo de correção, com o motivo). A impressão sai com as versões inativas.
import type {
  CorrecaoLida,
  ItemFilaNutricao,
  ResultadoCorrecao,
  ResultadoTriagem,
  TriagemNutricionalLida,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, nextTick, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import {
  estornarTriagem,
  lerFilaNutricao,
  lerGravacaoNutricao,
  lerOpcoesMapa,
  lerTriagens,
  novaChaveNutricao,
} from '../api-nutricao.js';
import AvisoNutricao from '../componentes/AvisoNutricao.vue';
import DialogoCorrecao from '../componentes/DialogoCorrecao.vue';
import ErroNutricao from '../componentes/ErroNutricao.vue';
import TriagemDialogo from '../componentes/TriagemDialogo.vue';
import { combinaBusca, corDaSituacao, instanteCurto, leitoTexto } from '../regras-nutricao.js';

const { t } = useI18n();
const gravacao = useQuery({
  queryKey: ['nutricao', 'gravacao'],
  queryFn: lerGravacaoNutricao,
  staleTime: 30_000,
});
const pode = (acao: string) => gravacao.data.value?.operacoes[acao]?.pode ?? false;
const motivoTriar = computed(() => gravacao.data.value?.operacoes['triar']?.motivo ?? null);
const aviso = computed(() =>
  gravacao.data.value && !gravacao.data.value.ligada ? gravacao.data.value.motivo : null,
);
const unidade = ref<string>('');
const opcoes = useQuery({
  queryKey: ['nutricao', 'mapa-opcoes'],
  queryFn: () => lerOpcoesMapa(),
  staleTime: 60_000,
  retry: false,
});
const unidades = computed(() => [
  { valor: '', rotulo: t('nutricao.todas') },
  ...(opcoes.data.value?.unidades ?? []).map((u) => ({
    valor: u.unidade,
    rotulo: `${u.nome} (${u.unidade})`,
  })),
]);
const fila = useQuery({
  queryKey: computed(() => ['nutricao', 'fila', unidade.value]),
  queryFn: () => lerFilaNutricao(unidade.value || null),
  refetchInterval: 60_000,
});
const busca = ref('');
const itens = computed(() =>
  (fila.data.value?.itens ?? []).filter((i) =>
    combinaBusca(busca.value, [i.nome, String(i.internacao), String(i.paciente), leitoTexto(i.leito)]),
  ),
);
const escolhido = ref<ItemFilaNutricao | null>(null);
const dialogo = ref(false);
const ultimo = ref<ResultadoTriagem | null>(null);
function triar(i: ItemFilaNutricao): void {
  escolhido.value = i;
  dialogo.value = true;
}
async function gravado(r: ResultadoTriagem): Promise<void> {
  ultimo.value = r;
  correcao.value = null;
  await fila.refetch();
  if (historicoDe.value) await triagens.refetch();
}

// ── W0-05: histórico, retificação e estorno da triagem ──
const { sessao } = usarSessao();
const login = computed(() => (sessao.value?.usuario.login ?? sessao.value?.usuario.id ?? '').toUpperCase());
const historicoDe = ref<ItemFilaNutricao | null>(null);
const triagens = useQuery({
  queryKey: computed(() => ['nutricao', 'triagens', historicoDe.value?.internacao]),
  queryFn: () => lerTriagens(historicoDe.value?.internacao as number),
  enabled: computed(() => historicoDe.value !== null),
});
const retificando = ref<TriagemNutricionalLida | null>(null);
const estornando = ref<TriagemNutricionalLida | null>(null);
const dialogoEstorno = ref(false);
const correcao = ref<string | null>(null);
const doAutor = (x: TriagemNutricionalLida) => x.por.toUpperCase() === login.value;
// Revisão (acessibilidade): o histórico abre no fim da fila; o foco vai ao título do painel (anunciado pelo leitor de
// tela) e a tela rola até ele. Ao fechar, o foco volta ao botão "Histórico" da linha.
const tituloHistorico = ref<HTMLElement | null>(null);
let voltarFoco: HTMLElement | null = null;
async function verHistorico(i: ItemFilaNutricao): Promise<void> {
  voltarFoco = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  historicoDe.value = i;
  correcao.value = null;
  await nextTick();
  tituloHistorico.value?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  tituloHistorico.value?.focus({ preventScroll: true });
}
async function fecharHistorico(): Promise<void> {
  historicoDe.value = null;
  await nextTick();
  voltarFoco?.focus();
  voltarFoco = null;
}
function abrirRetificar(x: TriagemNutricionalLida): void {
  if (!historicoDe.value) return;
  escolhido.value = historicoDe.value;
  retificando.value = x;
  dialogo.value = true;
}
function abrirTriar(i: ItemFilaNutricao): void {
  retificando.value = null;
  triar(i);
}
function abrirEstorno(x: TriagemNutricionalLida): void {
  estornando.value = x;
  dialogoEstorno.value = true;
}
const gravarEstorno = ({ motivo }: { motivo: string }) =>
  estornarTriagem(estornando.value?.id as number, motivo, novaChaveNutricao('estornar-triagem'));
async function corrigido(r: unknown): Promise<void> {
  ultimo.value = null;
  correcao.value = (r as ResultadoCorrecao).mensagem;
  retificando.value = null;
  await Promise.all([fila.refetch(), triagens.refetch()]);
}
const notaCorrecao = (c: CorrecaoLida, situacao: string) =>
  t(`nutricao.correcao.${situacao === 'estornado' ? 'estornado' : 'retificado'}`, {
    em: instanteCurto(c.em),
    por: c.por,
    motivo: c.motivo,
  });
const pilula = (s: string) =>
  s === 'ativo' ? 'pilula--ok' : s === 'estornado' ? 'pilula--alerta' : 'pilula--neutra';
const imprimir = () => window.print();
const resumo = computed(() => {
  const c = fila.data.value?.contagens;
  return c
    ? t('nutricao.fila.resumo', {
        vencida: c.vencida,
        atencao: c.atencao,
        atriar: c['a-triar'],
        reavaliar: c.reavaliar,
        triado: c.triado,
      })
    : '';
});
</script>

<template>
  <section
    class="tela-agenda tela-correcoes"
    aria-labelledby="nutricao-fila-titulo"
    data-testid="tela-fila-nutricao"
  >
    <h1 id="nutricao-fila-titulo">{{ t('nutricao.fila.titulo') }}</h1>
    <p>
      {{
        t('nutricao.fila.texto', {
          prazo: fila.data.value?.prazoHoras ?? 48,
          pref: fila.data.value?.preferencialHoras ?? 24,
        })
      }}
    </p>
    <p class="acoes">
      <RouterLink to="/nutricao/mapa">{{ t('nutricao.atalhos.mapa') }}</RouterLink>
      <RouterLink to="/nutricao/terapia">{{ t('nutricao.fila.terapia') }}</RouterLink>
      <RouterLink to="/servico-social">{{ t('nutricao.atalhos.social') }}</RouterLink>
    </p>
    <AvisoNutricao :motivo="aviso" />
    <div class="filtros">
      <SanteSelecao
        v-model="unidade"
        :rotulo="t('nutricao.unidade')"
        :opcoes="unidades"
        data-testid="fila-unidade"
      />
      <SanteCampoTexto
        v-model="busca"
        :rotulo="t('nutricao.buscar')"
        :max-bytes="60"
        data-testid="fila-busca"
      />
    </div>
    <SanteAlerta
      v-if="ultimo"
      variante="info"
      :texto="
        t('nutricao.triagem.gravada', { total: ultimo.total, risco: t(`nutricao.riscos.${ultimo.risco}`) }) +
        (ultimo.dentroDoPrazo ? '' : ' ' + t('nutricao.triagem.foraDoPrazo'))
      "
      anunciar
      data-testid="triagem-gravada"
    />
    <SanteAlerta v-if="correcao" variante="info" :texto="correcao" anunciar data-testid="triagem-corrigida" />
    <ErroNutricao v-if="fila.isError.value" :erro="fila.error.value" />
    <p v-else-if="!fila.data.value" role="status">{{ t('nutricao.carregando') }}</p>
    <template v-else>
      <p data-testid="fila-resumo">{{ resumo }}</p>
      <p class="secundario" data-testid="fila-indicadores">
        {{
          t('nutricao.fila.indicadores', {
            n: fila.data.value.indicadores.admitidos,
            t24: fila.data.value.indicadores.triados24h,
            t48: fila.data.value.indicadores.triados48h,
            pref: fila.data.value.preferencialHoras,
            prazo: fila.data.value.prazoHoras,
          })
        }}
      </p>
      <p v-if="fila.data.value.cortada" role="status">{{ t('nutricao.cortada') }}</p>
      <p v-if="fila.data.value.itens.length === 0">{{ t('nutricao.nenhum') }}</p>
      <p v-else-if="itens.length === 0" role="status">{{ t('nutricao.nenhumNaBusca') }}</p>
      <table v-else class="tabela" data-testid="tabela-fila-nutricao">
        <caption>
          {{
            t('nutricao.fila.legenda')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('nutricao.paciente') }}</th>
            <th scope="col">{{ t('nutricao.leito') }}</th>
            <th scope="col">{{ t('nutricao.admissao') }}</th>
            <th scope="col">{{ t('nutricao.situacoes.triado') }}</th>
            <th scope="col">{{ t('nutricao.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="i in itens"
            :key="i.internacao"
            :class="`situacao-${corDaSituacao(i.situacao)}`"
            :data-testid="`fila-${i.internacao}`"
            :data-situacao="i.situacao"
          >
            <td>
              <strong>{{ i.nome }}</strong>
              <span class="secundario">
                · {{ i.idade === null ? t('nutricao.semIdade') : t('nutricao.idade', { n: i.idade }) }}</span
              >
              <span v-if="i.intensiva" class="chip">{{ t('nutricao.fila.intensiva') }}</span>
              <span v-if="i.emTerapia" class="chip">{{ t('nutricao.fila.emTerapia') }}</span>
            </td>
            <td>{{ leitoTexto(i.leito) }}</td>
            <td>
              {{ instanteCurto(i.admissao) }}
              <span class="secundario">· {{ t('nutricao.horas', { n: i.horasDesdeAdmissao }) }}</span>
            </td>
            <td>
              <strong class="marca" :data-cor="corDaSituacao(i.situacao)">{{
                t(`nutricao.situacoes.${i.situacao}`, {
                  h:
                    i.situacao === 'vencida' ? fila.data.value.prazoHoras : fila.data.value.preferencialHoras,
                })
              }}</strong>
              <span v-if="i.situacao !== 'triado'" class="secundario">
                · {{ t('nutricao.fila.prazoEm', { em: instanteCurto(i.prazoEm) }) }}</span
              >
              <div v-if="i.ultima" class="secundario">
                {{
                  t('nutricao.fila.ultima', {
                    instrumento: t(`nutricao.instrumentos.${i.ultima.instrumento}`),
                    total: i.ultima.total,
                    em: instanteCurto(i.ultima.em),
                  })
                }}
                · {{ t(`nutricao.riscos.${i.ultima.risco}`) }}
              </div>
            </td>
            <td class="acoes">
              <SanteBotao
                v-if="pode('triar')"
                variante="secundario"
                :rotulo="t('nutricao.fila.triar')"
                :data-testid="`triar-${i.internacao}`"
                @acionar="abrirTriar(i)"
              />
              <span v-else-if="motivoTriar" class="secundario">{{ motivoTriar }}</span>
              <SanteBotao
                variante="texto"
                :rotulo="t('nutricao.fila.historico')"
                :data-testid="`historico-${i.internacao}`"
                @acionar="verHistorico(i)"
              />
              <RouterLink :to="`/nutricao/terapia/${i.internacao}`">{{
                t('nutricao.fila.terapia')
              }}</RouterLink>
              <RouterLink :to="`/servico-social/${i.internacao}`">{{ t('nutricao.fila.social') }}</RouterLink>
            </td>
          </tr>
        </tbody>
      </table>
    </template>
    <section
      v-if="historicoDe"
      class="painel"
      aria-labelledby="triagens-titulo"
      data-testid="triagens-historico"
    >
      <div class="cabeca-registro">
        <h2 id="triagens-titulo" ref="tituloHistorico" tabindex="-1" data-testid="triagens-titulo">
          {{ t('nutricao.triagem.historicoDe', { nome: historicoDe.nome }) }}
        </h2>
        <span class="acoes-registro nao-imprimir">
          <SanteBotao
            variante="secundario"
            :rotulo="t('nutricao.correcao.imprimir')"
            :title="t('nutricao.correcao.imprimirAjuda')"
            data-testid="triagens-imprimir"
            @acionar="imprimir"
          />
          <SanteBotao
            variante="texto"
            :rotulo="t('nutricao.triagem.fecharHistorico')"
            data-testid="triagens-fechar"
            @acionar="fecharHistorico"
          />
        </span>
      </div>
      <p class="nota-correcao">{{ t('nutricao.correcao.soAutor') }}</p>
      <ErroNutricao v-if="triagens.isError.value" :erro="triagens.error.value" />
      <p v-else-if="!triagens.data.value" role="status">{{ t('nutricao.carregando') }}</p>
      <p v-else-if="triagens.data.value.itens.length === 0">{{ t('nutricao.triagem.semTriagens') }}</p>
      <article
        v-for="x in triagens.data.value?.itens ?? []"
        :key="x.id"
        :class="['cartao-registro', { inativo: x.situacao !== 'ativo' }]"
        :data-testid="`triagem-${x.id}`"
        :data-situacao="x.situacao"
      >
        <p class="cabeca-registro">
          <strong :class="{ riscado: x.situacao !== 'ativo' }">{{
            t('nutricao.triagem.linha', {
              instrumento: t(`nutricao.instrumentos.${x.instrumento}`),
              total: x.total,
              risco: t(`nutricao.riscos.${x.risco}`),
            })
          }}</strong>
          <span :class="['pilula', pilula(x.situacao)]">{{
            t(`nutricao.terapia.situacoes.${x.situacao}`)
          }}</span>
          <span v-if="x.substitui" class="pilula pilula--neutra">{{ t('nutricao.correcao.substitui') }}</span>
        </p>
        <p class="secundario">
          {{
            t('nutricao.triagem.autoria', {
              por: x.por,
              em: instanteCurto(x.em),
              horas: x.horasDesdeAdmissao,
            })
          }}
          <span v-if="x.conduta"> · {{ x.conduta }}</span>
        </p>
        <p v-if="x.correcao" class="nota-correcao" :data-testid="`triagem-correcao-${x.id}`">
          {{ notaCorrecao(x.correcao, x.situacao) }}
        </p>
        <p v-if="x.situacao === 'ativo' && pode('triar') && doAutor(x)" class="acoes-registro nao-imprimir">
          <SanteBotao
            variante="secundario"
            :rotulo="t('nutricao.triagem.retificar')"
            :data-testid="`triagem-retificar-${x.id}`"
            @acionar="abrirRetificar(x)"
          />
          <SanteBotao
            variante="texto"
            :rotulo="t('nutricao.triagem.estornar')"
            :data-testid="`triagem-estornar-${x.id}`"
            @acionar="abrirEstorno(x)"
          />
        </p>
      </article>
    </section>
    <TriagemDialogo
      v-model:visivel="dialogo"
      :internado="escolhido"
      :retificar="retificando"
      @gravado="gravado"
      @corrigido="corrigido"
    />
    <DialogoCorrecao
      v-model:visivel="dialogoEstorno"
      :titulo="t('nutricao.triagem.estornarTitulo')"
      :texto="t('nutricao.triagem.estornarTexto')"
      :confirmar="t('nutricao.triagem.estornar')"
      :gravar="gravarEstorno"
      @feito="corrigido"
    />
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style src="../componentes/estilo-correcao.css"></style>
<style scoped>
.marca[data-cor='vermelho'] {
  color: var(--sgh-alerta);
}
.marca[data-cor='amarelo'] {
  color: var(--sgh-aviso);
}
.marca[data-cor='verde'] {
  color: var(--sgh-sucesso);
}
tr.situacao-vermelho td:first-child {
  border-inline-start: 4px solid var(--sgh-alerta);
}
.chip {
  display: inline-block;
  margin-inline-start: var(--sgh-espaco-1);
  padding: 0 var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda);
  border-radius: 999px;
  font-size: var(--sgh-fonte-pequena);
}
</style>
