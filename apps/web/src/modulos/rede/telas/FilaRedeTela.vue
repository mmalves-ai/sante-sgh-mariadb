<script setup lang="ts">
// MPI da Rede (M57, etapa 1; ficha, seção 7) — `Cadastros > Pacientes (cadastro único) > MPI da Rede`: a fila de
// prováveis duplicados entre os estabelecimentos da rede, paginada no servidor, com os filtros de situação, faixa de
// pontuação e outro estabelecimento (SanteSelecao, ADR 0027), a busca por paciente pelo prontuário deste
// estabelecimento (achar o par ou o vínculo de um paciente para comparar ou desfazer), o que bateu e o que diverge, "Atualizar a fila" (um ciclo
// de pareamento; só com `rede.mpi.vincular`), a comparação lado a lado com a decisão e, na outra parte da tela, o
// relatório de divergência entre os índices. Os cadastros de cada estabelecimento nunca mudam: só a ligação.
import {
  type CandidatoRede,
  FAIXAS_PONTUACAO_REDE_CODIGOS,
  type FaixaPontuacaoRede,
  SITUACOES_CANDIDATO_REDE,
  type SituacaoCandidatoRede,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import { carimboBr, dataBr } from '../../cadastro/formato.js';
import PaginacaoCadastro from '../../cadastro/componentes/PaginacaoCadastro.vue';
import { atualizarFilaRede, lerFilaRede } from '../api-rede.js';
import DivergenciasRede from '../componentes/DivergenciasRede.vue';
import ParRedeDialogo from '../componentes/ParRedeDialogo.vue';

const POR_PAGINA = 20;
const { t } = useI18n();
const cliente = useQueryClient();
/** Depois de gravar, todas as consultas do MPI (as outras situações e faixas, a divergência) são relidas. */
const reler = () => cliente.invalidateQueries({ queryKey: ['rede'] });
const vista = ref<'fila' | 'divergencia'>('fila');
const situacao = ref<SituacaoCandidatoRede>('aberto');
const faixa = ref<FaixaPontuacaoRede | ''>('');
const outro = ref<string>('');
const pagina = ref(1);
/** Busca por paciente: o prontuário do cadastro deste estabelecimento (null: a fila inteira). */
const prontuario = ref<number | null>(null);
const digitado = ref('');
const buscaInvalida = ref(false);
watch([situacao, faixa, outro, prontuario], () => (pagina.value = 1));
function buscar(): void {
  const v = digitado.value.trim();
  buscaInvalida.value = v !== '' && !/^[1-9]\d{0,9}$/.test(v);
  if (buscaInvalida.value) return;
  prontuario.value = v === '' ? null : Number(v);
}
function limparBusca(): void {
  digitado.value = '';
  buscaInvalida.value = false;
  prontuario.value = null;
}

const fila = useQuery({
  queryKey: computed(() => [
    'rede',
    'fila',
    situacao.value,
    faixa.value,
    outro.value,
    prontuario.value,
    pagina.value,
  ]),
  queryFn: () =>
    lerFilaRede({
      situacao: situacao.value,
      ...(faixa.value ? { faixa: faixa.value } : {}),
      ...(outro.value ? { outroEstabelecimento: outro.value } : {}),
      ...(prontuario.value !== null ? { prontuario: prontuario.value } : {}),
      pagina: pagina.value,
      porPagina: POR_PAGINA,
    }),
});
const f = computed(() => fila.data.value);
const podeVincular = computed(() => pode('rede.mpi.vincular'));

const opcoesSituacao = computed(() =>
  SITUACOES_CANDIDATO_REDE.map((v) => ({ valor: v, rotulo: t(`rede.situacoes.${v}`) })),
);
const opcoesFaixa = computed(() => [
  { valor: '' as const, rotulo: t('rede.filtros.todas') },
  ...FAIXAS_PONTUACAO_REDE_CODIGOS.map((v) => ({ valor: v, rotulo: t(`rede.faixas.${v}`) })),
]);
const { estabelecimentoAtivo: sessaoEst } = usarSessao();
const opcoesOutro = computed(() => [
  { valor: '', rotulo: t('rede.filtros.todos') },
  ...(f.value?.estabelecimentos ?? [])
    .filter((e) => e.codigo !== sessaoEst.value?.codigo)
    .map((e) => ({ valor: e.codigo, rotulo: e.nome })),
]);
const nomes = computed(() =>
  Object.fromEntries((f.value?.estabelecimentos ?? []).map((e) => [e.codigo, e.nome])),
);
const umSo = computed(() => (f.value ? f.value.estabelecimentos.length < 2 : false));

const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
async function atualizar(): Promise<void> {
  mensagem.value = null;
  erro.value = null;
  try {
    const r = await atualizarFilaRede();
    mensagem.value = t('rede.filaAtualizada', r);
    await reler();
  } catch (e) {
    erro.value = e;
  }
}

const escolhido = ref<string | null>(null);
const aberto = ref(false);
function comparar(p: CandidatoRede): void {
  escolhido.value = p.chave;
  aberto.value = true;
}
async function decidido(m: string): Promise<void> {
  mensagem.value = m;
  await reler();
}

const criterios = (p: CandidatoRede) => p.criterios.map((c) => t(`rede.criterios.${c}`)).join(', ');
const divergencias = (p: CandidatoRede) => p.divergencias.map((d) => t(`rede.divergencias.${d}`)).join(', ');
</script>

<template>
  <section class="tela" aria-labelledby="rede-titulo" data-testid="tela-mpi-rede">
    <h1 id="rede-titulo">{{ t('rede.titulo') }}</h1>
    <p>{{ t('rede.subtitulo') }}</p>
    <nav class="abas" :aria-label="t('rede.abas.rotulo')">
      <SanteBotao
        :rotulo="t('rede.abas.fila')"
        :variante="vista === 'fila' ? 'primario' : 'texto'"
        :aria-pressed="vista === 'fila'"
        data-testid="aba-fila"
        @acionar="vista = 'fila'"
      />
      <SanteBotao
        :rotulo="t('rede.abas.divergencia')"
        :variante="vista === 'divergencia' ? 'primario' : 'texto'"
        :aria-pressed="vista === 'divergencia'"
        data-testid="aba-divergencia"
        @acionar="vista = 'divergencia'"
      />
    </nav>

    <template v-if="vista === 'fila'">
      <div class="barra">
        <SanteSelecao v-model="situacao" :rotulo="t('rede.filtros.situacao')" :opcoes="opcoesSituacao" />
        <SanteSelecao v-model="faixa" :rotulo="t('rede.filtros.faixa')" :opcoes="opcoesFaixa" />
        <SanteSelecao v-model="outro" :rotulo="t('rede.filtros.estabelecimento')" :opcoes="opcoesOutro" />
        <SanteBotao
          v-if="podeVincular"
          :rotulo="t('rede.atualizarFila')"
          variante="secundario"
          data-testid="botao-atualizar-fila-rede"
          @acionar="atualizar"
        />
      </div>
      <form class="barra" role="search" data-testid="busca-paciente-rede" @submit.prevent="buscar">
        <SanteCampoTexto v-model="digitado" :rotulo="t('rede.busca.rotulo')" :max-bytes="10" />
        <SanteBotao :rotulo="t('rede.busca.buscar')" tipo="submit" data-testid="botao-buscar-rede" />
        <SanteBotao
          v-if="prontuario !== null"
          :rotulo="t('rede.busca.limpar')"
          variante="texto"
          data-testid="botao-limpar-busca-rede"
          @acionar="limparBusca"
        />
      </form>
      <p class="pequeno">{{ t('rede.busca.dica') }}</p>
      <p v-if="buscaInvalida" role="alert" data-testid="busca-rede-invalida">
        {{ t('rede.busca.invalida') }}
      </p>
      <p v-if="prontuario !== null" role="status" data-testid="busca-rede-ativa">
        {{ t('rede.busca.ativa', { prontuario }) }}
      </p>
      <p v-if="mensagem" role="status" data-testid="mensagem-fila-rede">{{ mensagem }}</p>
      <MensagemErro v-if="erro" :erro="erro" />
      <MensagemErro v-if="fila.isError.value" :erro="fila.error.value" />
      <p v-else-if="!f">{{ t('rede.carregando') }}</p>
      <template v-else>
        <SanteAlerta v-if="umSo" :texto="t('rede.umEstabelecimento')" variante="info" />
        <p data-testid="por-faixa">{{ t('rede.porFaixa', f.porFaixa) }}</p>
        <p v-if="f.itens.length === 0" data-testid="fila-rede-vazia">{{ t('rede.nenhum') }}</p>
        <table v-else data-testid="tabela-fila-rede">
          <caption>
            {{
              t('rede.legenda', { total: f.total })
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('rede.local') }}</th>
              <th scope="col">{{ t('rede.remoto') }}</th>
              <th scope="col">{{ t('rede.colunas.pontuacao') }}</th>
              <th scope="col">{{ t('rede.colunas.criterios') }}</th>
              <th scope="col">{{ t('rede.colunas.divergencias') }}</th>
              <th scope="col">{{ t('rede.colunas.situacao') }}</th>
              <th scope="col">
                <span class="oculto">{{ t('rede.comparar') }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in f.itens" :key="p.chave" :data-testid="`par-rede-${p.chave}`">
              <td>
                {{ p.local.prontuario }} · {{ p.local.nome }}
                <span class="pequeno">{{ dataBr(p.local.nascimento) }}</span>
              </td>
              <td>
                {{ p.remoto.estabelecimentoNome }} · {{ p.remoto.prontuario }} · {{ p.remoto.nome }}
                <span class="pequeno">{{ dataBr(p.remoto.nascimento) }}</span>
              </td>
              <td>{{ p.pontuacao }}</td>
              <td>{{ criterios(p) }}</td>
              <td>{{ divergencias(p) || '—' }}</td>
              <td>
                {{ t(`rede.situacoes.${p.situacao}`) }}
                <span v-if="p.origem" class="pequeno">{{ t(`rede.origens.${p.origem}`) }}</span>
                <span v-if="p.decididoPor" class="pequeno"
                  >{{ p.decididoPor }} · {{ carimboBr(p.decididoEm) }}</span
                >
              </td>
              <td>
                <SanteBotao
                  :rotulo="t('rede.comparar')"
                  variante="texto"
                  :data-testid="`comparar-rede-${p.chave}`"
                  @acionar="comparar(p)"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <PaginacaoCadastro
          v-model="pagina"
          :total="f.total"
          :por-pagina="POR_PAGINA"
          :rotulo="t('rede.titulo')"
        />
      </template>
      <ParRedeDialogo v-model:visivel="aberto" :chave="escolhido" @decidido="decidido" />
    </template>
    <DivergenciasRede v-else :nomes="nomes" />
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
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
  vertical-align: top;
}
.barra,
.abas {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
  margin: var(--sgh-espaco-2) 0;
}
.pequeno {
  display: block;
  font-size: var(--sgh-fonte-pequena);
}
.oculto {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
</style>
