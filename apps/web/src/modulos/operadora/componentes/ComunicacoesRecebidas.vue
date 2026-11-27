<script setup lang="ts">
// Comunicações de internação e alta recebidas dos prestadores (04-INT linha 80, C1-108; F7), na tela das trocas TISS
// (`operadora.conta.ler`). A pendente ('recebida': a carteira não foi identificada na chegada) vem primeiro. Quem
// recebe contas (`operadora.conta.receber`) responde a pendente: identifica a carteira digitada (o servidor normaliza
// a pontuação e procura o beneficiário da operadora), aceita a comunicação com o beneficiário identificado ou a recusa
// com o motivo da terminologia de glosas. A respondida não muda.
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import {
  type ComunicacaoRecebida,
  identificarCarteira,
  lerComunicacoes,
  lerMotivosRecusa,
  responderComunicacao,
  type SituacaoComunicacao,
} from '../api-troca-tiss.js';

const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      titulo: 'Comunicações de internação e alta recebidas',
      texto:
        'O prestador comunica a internação e a alta do beneficiário. A carteira não identificada na chegada fica pendente para a central conferir, aceitar ou recusar com motivo.',
      carregando: 'Carregando…',
      nenhuma: 'Nenhuma comunicação com este filtro.',
      filtro: 'Situação',
      todas: 'Todas',
      situacoes: { recebida: 'Pendente', aceita: 'Aceita', recusada: 'Recusada' },
      eventos: { internacao: 'Internação', alta: 'Alta' },
      colunas: {
        recebida: 'Recebida em',
        prestador: 'Prestador',
        evento: 'Evento',
        data: 'Data do evento',
        carteira: 'Carteira informada',
        beneficiario: 'Beneficiário',
        situacao: 'Situação',
        motivo: 'Motivo da recusa',
        acoes: 'Ações',
      },
      naoIdentificado: 'Não identificado',
      rn: '(recém-nascido)',
      responder: 'Responder',
      painel: 'Responder a comunicação {n}',
      carteira: 'Carteira do beneficiário',
      identificar: 'Identificar carteira',
      aceitar: 'Aceitar comunicação',
      motivo: 'Motivo da recusa',
      escolha: 'Escolha o motivo',
      recusar: 'Recusar com motivo',
      fechar: 'Fechar',
      identificada: 'Carteira identificada.',
      aceita: 'Comunicação aceita.',
      recusada: 'Comunicação recusada.',
    },
  },
});

const podeResponder = computed(() => pode('operadora.conta.receber'));
const cliente = useQueryClient();
const filtro = ref<SituacaoComunicacao | null>(null);
const lista = useQuery({
  queryKey: computed(() => ['operadora', 'troca-tiss', 'comunicacoes', filtro.value]),
  queryFn: () => lerComunicacoes(filtro.value),
});
const motivos = useQuery({
  queryKey: ['operadora', 'troca-tiss', 'motivos-recusa'],
  queryFn: lerMotivosRecusa,
  enabled: podeResponder,
});
const opcoesFiltro = computed(() => [
  { valor: null as SituacaoComunicacao | null, rotulo: t('todas') },
  ...(['recebida', 'aceita', 'recusada'] as const).map((x) => ({
    valor: x as SituacaoComunicacao | null,
    rotulo: t(`situacoes.${x}`),
  })),
]);
const opcoesMotivo = computed(() => [
  { valor: null as number | null, rotulo: t('escolha') },
  ...(motivos.data.value ?? []).map((m) => ({ valor: m.id as number | null, rotulo: `${m.codigo} ${m.descricao}` })),
]);

const atual = ref<ComunicacaoRecebida | null>(null);
const carteira = ref('');
const motivo = ref<number | null>(null);
const enviando = ref(false);
const erro = ref<unknown>(null);
const aviso = ref('');

function abrir(x: ComunicacaoRecebida) {
  atual.value = x;
  carteira.value = x.matricula ?? x.numeroCarteira;
  motivo.value = null;
  erro.value = null;
  aviso.value = '';
}

async function executar(fn: (x: ComunicacaoRecebida) => Promise<{ versao: number }>, msg: string, fecha: boolean) {
  const x = atual.value;
  if (!x || enviando.value) return;
  enviando.value = true;
  erro.value = null;
  aviso.value = '';
  try {
    await fn(x);
    aviso.value = t(msg);
    await cliente.invalidateQueries({ queryKey: ['operadora', 'troca-tiss'] });
    const nova = (lista.data.value ?? []).find((y) => y.id === x.id) ?? null;
    atual.value = fecha ? null : nova;
  } catch (e) {
    erro.value = e;
  } finally {
    enviando.value = false;
  }
}

const identificar = () =>
  executar((x) => identificarCarteira(x.id, x.versao, carteira.value), 'identificada', false);
const aceitar = () => executar((x) => responderComunicacao(x.id, x.versao, { acao: 'aceitar' }), 'aceita', true);
const recusar = () =>
  executar(
    (x) => responderComunicacao(x.id, x.versao, { acao: 'recusar', motivoRecusa: motivo.value }),
    'recusada',
    true,
  );

const data = (v: string | null) => (v ? v.split('-').reverse().join('/') : '');
const quando = (v: string) => (v ? new Date(v).toLocaleString('pt-BR') : '');
</script>

<template>
  <section class="bloco" aria-labelledby="ope-comunicacoes-titulo" data-testid="comunicacoes-recebidas">
    <h2 id="ope-comunicacoes-titulo">{{ t('titulo') }}</h2>
    <p class="secundario">{{ t('texto') }}</p>
    <div class="campos">
      <SanteSelecao
        id="comunicacoes-filtro"
        v-model="filtro"
        :rotulo="t('filtro')"
        :opcoes="opcoesFiltro"
        data-testid="comunicacoes-filtro"
      />
    </div>
    <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="comunicacao-aviso" />
    <MensagemErro v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!lista.data.value" role="status">{{ t('carregando') }}</p>
    <p v-else-if="lista.data.value.length === 0" data-testid="comunicacoes-vazia">{{ t('nenhuma') }}</p>
    <table v-else class="tabela" data-testid="comunicacoes-lista">
      <caption class="visualmente-oculto">
        {{
          t('titulo')
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">{{ t('colunas.recebida') }}</th>
          <th scope="col">{{ t('colunas.prestador') }}</th>
          <th scope="col">{{ t('colunas.evento') }}</th>
          <th scope="col">{{ t('colunas.data') }}</th>
          <th scope="col">{{ t('colunas.carteira') }}</th>
          <th scope="col">{{ t('colunas.beneficiario') }}</th>
          <th scope="col">{{ t('colunas.situacao') }}</th>
          <th scope="col">{{ t('colunas.motivo') }}</th>
          <th v-if="podeResponder" scope="col">{{ t('colunas.acoes') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="x in lista.data.value" :key="x.id" :data-testid="`comunicacao-${x.id}`">
          <td>{{ quando(x.recebidoEm) }}</td>
          <td>{{ x.prestador ?? '' }}</td>
          <td>{{ t(`eventos.${x.tipoEvento}`) }} <span v-if="x.recemNascido">{{ t('rn') }}</span></td>
          <td>{{ data(x.eventoEm) }}</td>
          <td>{{ x.numeroCarteira }}</td>
          <td>{{ x.matricula ?? t('naoIdentificado') }}</td>
          <td :data-situacao="x.situacao">{{ t(`situacoes.${x.situacao}`) }}</td>
          <td>{{ x.motivoRecusa ? `${x.motivoRecusa.codigo} ${x.motivoRecusa.descricao}` : '' }}</td>
          <td v-if="podeResponder">
            <SanteBotao
              v-if="x.situacao === 'recebida'"
              :rotulo="t('responder')"
              variante="secundario"
              :data-testid="`comunicacao-responder-${x.id}`"
              @acionar="abrir(x)"
            />
          </td>
        </tr>
      </tbody>
    </table>

    <section
      v-if="atual && podeResponder"
      class="bloco"
      aria-labelledby="ope-comunicacao-painel"
      data-testid="comunicacao-painel"
    >
      <h3 id="ope-comunicacao-painel">{{ t('painel', { n: atual.numeroTransacao ?? atual.id }) }}</h3>
      <div class="campos">
        <SanteCampoTexto
          id="comunicacao-carteira"
          v-model="carteira"
          :max-bytes="30"
          :rotulo="t('carteira')"
          data-testid="comunicacao-carteira"
        />
      </div>
      <div class="acoes">
        <SanteBotao
          :rotulo="t('identificar')"
          variante="secundario"
          :desabilitado="enviando || !carteira.trim()"
          data-testid="comunicacao-identificar"
          @acionar="identificar"
        />
        <SanteBotao
          :rotulo="t('aceitar')"
          :desabilitado="enviando || atual.beneficiario === null"
          data-testid="comunicacao-aceitar"
          @acionar="aceitar"
        />
      </div>
      <div class="campos">
        <SanteSelecao
          id="comunicacao-motivo"
          v-model="motivo"
          :rotulo="t('motivo')"
          :opcoes="opcoesMotivo"
          data-testid="comunicacao-motivo"
        />
      </div>
      <div class="acoes">
        <SanteBotao
          :rotulo="t('recusar')"
          variante="secundario"
          :desabilitado="enviando || motivo === null"
          data-testid="comunicacao-recusar"
          @acionar="recusar"
        />
        <SanteBotao :rotulo="t('fechar')" variante="texto" data-testid="comunicacao-fechar" @acionar="atual = null" />
      </div>
      <MensagemErro v-if="erro" :erro="erro" />
    </section>
  </section>
</template>
