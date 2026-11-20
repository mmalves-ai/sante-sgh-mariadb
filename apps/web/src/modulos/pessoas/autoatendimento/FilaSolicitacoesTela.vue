<script setup lang="ts">
// Fila das solicitações do autoatendimento (W0-06, parte 6d-2; M3 de mercado; `pessoas.autoatendimento.aprovar`): os
// pedidos da equipe filtrados pela situação e pelo tipo, a aprovação (o efeito entra na mesma transação: férias
// programadas, justificativa no ponto por dia, ajuste do ponto decidido, correção do nome) e a recusa, ambas com o
// motivo. Abono e atestado pedem o tipo de movimento do ponto (o do pedido ou o que o gestor escolhe); as férias, a
// empresa da folha (sem ela, a única) e o período aquisitivo (sem ele, o mais antigo com saldo). O atestado é dado de
// saúde: a leitura pede a finalidade e fica na trilha; o CID só com `pessoas.atestado.verCid` (o servidor responde 403
// a quem pede sem ela) e só quem tem essa permissão vê a lista de quem leu. A decisão nunca é do próprio solicitante:
// o servidor diz em `acoes.decidir`.
import {
  SITUACOES_SOLICITACAO_PESSOA,
  TIPOS_SOLICITACAO_PESSOA,
  type AtestadoPessoaResposta,
  type SituacaoSolicitacaoPessoaContrato,
  type SolicitacaoPessoaResposta,
  type TipoSolicitacaoPessoaContrato,
} from '@sgh/contratos';
import {
  SanteAlerta,
  SanteBotao,
  SanteCampoTexto,
  SanteChave,
  SanteData,
  SanteDialogo,
  SanteSelecao,
} from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { lerApoioFerias } from '../../folha/ferias/api-ferias.js';
import { dataBr, opcoesDe } from '../comum.js';
import DialogoMotivo from '../componentes/DialogoMotivo.vue';
import ErroPessoas from '../componentes/ErroPessoas.vue';
import { lerApoioPonto } from '../ponto/api-ponto.js';
import { decidirSolicitacao, lerAtestadoFila, lerFilaSolicitacoes } from './api-solicitacoes.js';
import {
  formDecisaoVazio,
  montarDecisao,
  pedeMovimento,
  periodoDoPedido,
  type FormDecisao,
} from './solicitacao-comum.js';

const { t } = useI18n();
const qc = useQueryClient();

const situacao = ref<SituacaoSolicitacaoPessoaContrato>('pendente');
const tipo = ref<TipoSolicitacaoPessoaContrato | null>(null);
const opcoesSituacao = opcoesDe(SITUACOES_SOLICITACAO_PESSOA);
const opcoesTipo = computed(() => [
  { valor: null as TipoSolicitacaoPessoaContrato | null, rotulo: t('pessoas.solicitacoes.fila.todos') },
  ...opcoesDe(TIPOS_SOLICITACAO_PESSOA),
]);

const fila = useQuery({
  queryKey: computed(() => ['pessoas', 'solicitacoes', 'fila', situacao.value, tipo.value]),
  queryFn: () =>
    lerFilaSolicitacoes({ situacao: situacao.value, ...(tipo.value ? { tipo: tipo.value } : {}) }),
});
const lista = computed(() => fila.data.value ?? null);
const resultado = ref<string | null>(null);

// Os tipos de movimento do ponto (abono e atestado) e as empresas da folha (férias): só para quem os lê.
const apoioPonto = useQuery({
  queryKey: ['pessoas', 'solicitacoes', 'apoio-ponto'],
  queryFn: () => lerApoioPonto().catch(() => null),
  retry: false,
});
const apoioFerias = useQuery({
  queryKey: ['pessoas', 'solicitacoes', 'apoio-ferias'],
  queryFn: () => lerApoioFerias().catch(() => null),
  retry: false,
});
const opcoesMovimento = computed(() =>
  (apoioPonto.data.value?.dominios.movimentos ?? []).map((m) => ({
    valor: m.codigo as number | null,
    rotulo: m.rotulo,
  })),
);
const opcoesJustificativa = computed(() => [
  { valor: null as number | null, rotulo: t('pessoas.solicitacoes.fila.semJustificativa') },
  ...(apoioPonto.data.value?.dominios.justificativas ?? []).map((m) => ({
    valor: m.codigo as number | null,
    rotulo: m.rotulo,
  })),
]);
const opcoesEmpresa = computed(() => [
  { valor: null as number | null, rotulo: t('pessoas.solicitacoes.fila.empresaUnica') },
  ...(apoioFerias.data.value?.empresas ?? []).map((e) => ({
    valor: e.codigo as number | null,
    rotulo: e.rotulo,
  })),
]);

// A decisão (aprovar ou recusar), sempre com o motivo.
const decidindo = ref<{ s: SolicitacaoPessoaResposta; decisao: 'aprovar' | 'recusar' } | null>(null);
const dialogoDecisao = computed({
  get: () => decidindo.value !== null,
  set: (v: boolean) => {
    if (!v) decidindo.value = null;
  },
});
const form = ref<FormDecisao>({
  movimento: null,
  justificativa: null,
  empresa: null,
  aquisitivoInicio: null,
});
watch(decidindo, (d) => {
  if (d) form.value = formDecisaoVazio(d.s);
});
const montagem = computed(() =>
  decidindo.value
    ? montarDecisao(decidindo.value.s, decidindo.value.decisao, 'motivo provisorio da decisao', form.value)
    : null,
);
async function decidir(motivo: string): Promise<void> {
  const d = decidindo.value!;
  const m = montarDecisao(d.s, d.decisao, motivo, form.value);
  if (!m.ok) throw new Error(m.mensagem);
  const r = await decidirSolicitacao(d.s.id, m.entrada);
  resultado.value = [r.mensagem || t('pessoas.solicitacoes.fila.feito'), ...r.avisos].join(' ');
  await qc.invalidateQueries({ queryKey: ['pessoas', 'solicitacoes'] });
}

// A leitura do atestado (finalidade obrigatória; CID e trilha só com `verCid`).
const lendo = ref<SolicitacaoPessoaResposta | null>(null);
const dialogoAtestado = computed({
  get: () => lendo.value !== null,
  set: (v: boolean) => {
    if (!v) lendo.value = null;
  },
});
const finalidade = ref('');
const verCid = ref(false);
const atestado = ref<AtestadoPessoaResposta | null>(null);
const erroAtestado = ref<unknown>(null);
watch(lendo, () => {
  finalidade.value = '';
  verCid.value = false;
  atestado.value = null;
  erroAtestado.value = null;
});
async function lerAtestado(): Promise<void> {
  erroAtestado.value = null;
  try {
    atestado.value = await lerAtestadoFila(lendo.value!.id, {
      finalidade: finalidade.value.trim(),
      verCid: verCid.value,
    });
  } catch (e) {
    erroAtestado.value = e;
  }
}

const decisaoTexto = (s: SolicitacaoPessoaResposta) =>
  s.decididoPor && s.decididoEm
    ? t('pessoas.solicitacoes.linha.decidido', {
        situacao: SITUACOES_SOLICITACAO_PESSOA[s.situacao],
        por: s.decididoPor,
        em: dataBr(s.decididoEm),
      })
    : null;
</script>

<template>
  <section class="tela-pessoas" aria-labelledby="pes-fila-solic" data-testid="tela-fila-solicitacoes">
    <h1 id="pes-fila-solic">{{ t('pessoas.solicitacoes.fila.titulo') }}</h1>
    <p>{{ t('pessoas.solicitacoes.fila.subtitulo') }}</p>
    <div role="status" aria-live="polite">
      <SanteAlerta v-if="resultado" :texto="resultado" variante="info" data-testid="fila-resultado" />
    </div>
    <div class="campos">
      <SanteSelecao
        v-model="situacao"
        :rotulo="t('pessoas.solicitacoes.fila.situacao')"
        :opcoes="opcoesSituacao"
        data-testid="fila-situacao"
      />
      <SanteSelecao
        v-model="tipo"
        :rotulo="t('pessoas.solicitacoes.fila.tipo')"
        :opcoes="opcoesTipo"
        data-testid="fila-tipo"
      />
    </div>
    <ErroPessoas v-if="fila.isError.value" :erro="fila.error.value" />
    <p v-else-if="!lista" role="status">{{ t('pessoas.carregando') }}</p>
    <SanteAlerta
      v-else-if="lista.itens.length === 0"
      :texto="t('pessoas.solicitacoes.fila.vazio')"
      variante="info"
      data-testid="fila-vazia"
    />
    <table v-else class="tabela" data-testid="fila-lista">
      <caption class="secundario">
        {{
          t('pessoas.solicitacoes.fila.legenda')
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">{{ t('pessoas.solicitacoes.fila.colaborador') }}</th>
          <th scope="col">{{ t('pessoas.solicitacoes.fila.pedido') }}</th>
          <th scope="col">{{ t('pessoas.solicitacoes.fila.detalhe') }}</th>
          <th scope="col">{{ t('pessoas.solicitacoes.fila.acoes') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="s in lista.itens" :key="s.id" :data-testid="`fila-${s.id}`">
          <td>
            {{ s.colaborador ?? s.vinculo }}
            <div v-if="s.matricula" class="secundario">{{ s.matricula }}</div>
          </td>
          <td>
            <strong>{{ TIPOS_SOLICITACAO_PESSOA[s.tipo] }}</strong>
            <div v-if="periodoDoPedido(s, dataBr)">{{ periodoDoPedido(s, dataBr) }}</div>
            <div class="secundario">
              {{ t('pessoas.solicitacoes.linha.pedido', { em: dataBr(s.pedidoEm) }) }}
            </div>
          </td>
          <td>
            <strong :data-testid="`fila-${s.id}-situacao`">{{
              SITUACOES_SOLICITACAO_PESSOA[s.situacao]
            }}</strong>
            <div v-if="s.valorNovo">
              {{
                t('pessoas.solicitacoes.linha.valor', { antes: s.valorAnterior ?? '', depois: s.valorNovo })
              }}
            </div>
            <div v-if="s.observacao" class="secundario">
              {{ t('pessoas.solicitacoes.linha.motivo', { m: s.observacao }) }}
            </div>
            <div v-if="decisaoTexto(s)" class="secundario">{{ decisaoTexto(s) }}</div>
            <div v-if="s.motivoDecisao" class="secundario">
              {{ t('pessoas.solicitacoes.linha.motivo', { m: s.motivoDecisao }) }}
            </div>
          </td>
          <td>
            <div class="acoes">
              <SanteBotao
                v-if="s.acoes.decidir"
                :rotulo="t('pessoas.solicitacoes.fila.aprovar')"
                variante="secundario"
                :data-testid="`fila-${s.id}-aprovar`"
                @acionar="decidindo = { s, decisao: 'aprovar' }"
              />
              <SanteBotao
                v-if="s.acoes.decidir"
                :rotulo="t('pessoas.solicitacoes.fila.recusar')"
                variante="texto"
                :data-testid="`fila-${s.id}-recusar`"
                @acionar="decidindo = { s, decisao: 'recusar' }"
              />
              <SanteBotao
                v-if="s.temAtestado"
                :rotulo="t('pessoas.solicitacoes.minhas.verAtestado')"
                variante="texto"
                :data-testid="`fila-${s.id}-atestado`"
                @acionar="lendo = s"
              />
            </div>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-if="lista?.limitado" class="secundario">{{ t('pessoas.solicitacoes.minhas.limitado') }}</p>

    <DialogoMotivo
      v-model:visivel="dialogoDecisao"
      :titulo="
        decidindo?.decisao === 'recusar'
          ? t('pessoas.solicitacoes.fila.recusarTitulo')
          : t('pessoas.solicitacoes.fila.aprovarTitulo')
      "
      :texto="
        decidindo?.decisao === 'recusar'
          ? t('pessoas.solicitacoes.fila.recusarTexto')
          : t('pessoas.solicitacoes.fila.aprovarTexto')
      "
      :confirmar="
        decidindo?.decisao === 'recusar'
          ? t('pessoas.solicitacoes.fila.recusar')
          : t('pessoas.solicitacoes.fila.aprovar')
      "
      :variante="decidindo?.decisao === 'recusar' ? 'destrutivo' : 'primario'"
      :pronto="montagem?.ok ?? false"
      :acao="decidir"
      testid="fila-decisao"
    >
      <div v-if="decidindo?.decisao === 'aprovar'" class="campos">
        <template v-if="pedeMovimento(decidindo.s)">
          <template v-if="opcoesMovimento.length > 0">
            <SanteSelecao
              v-model="form.movimento"
              :rotulo="t('pessoas.solicitacoes.fila.movimento')"
              :opcoes="opcoesMovimento"
              busca
              data-testid="fila-decisao-movimento"
            />
            <SanteSelecao
              v-model="form.justificativa"
              :rotulo="t('pessoas.solicitacoes.fila.justificativa')"
              :opcoes="opcoesJustificativa"
              busca
              data-testid="fila-decisao-justificativa"
            />
          </template>
          <p v-else class="secundario">{{ t('pessoas.solicitacoes.fila.semApoioPonto') }}</p>
        </template>
        <template v-else-if="decidindo.s.tipo === 'ferias'">
          <SanteSelecao
            v-model="form.empresa"
            :rotulo="t('pessoas.solicitacoes.fila.empresa')"
            :opcoes="opcoesEmpresa"
            busca
            data-testid="fila-decisao-empresa"
          />
          <SanteData
            v-model="form.aquisitivoInicio"
            :rotulo="t('pessoas.solicitacoes.fila.aquisitivo')"
            editavel
            data-testid="fila-decisao-aquisitivo"
          />
        </template>
        <p v-if="montagem && !montagem.ok" class="secundario" data-testid="fila-decisao-pendencia">
          {{ montagem.mensagem }}
        </p>
      </div>
    </DialogoMotivo>

    <SanteDialogo v-model:visivel="dialogoAtestado" :titulo="t('pessoas.solicitacoes.atestado.titulo')">
      <div class="campos-coluna" data-testid="fila-atestado-dialogo">
        <p>{{ t('pessoas.solicitacoes.atestado.texto') }}</p>
        <template v-if="!atestado">
          <SanteCampoTexto
            v-model="finalidade"
            :rotulo="t('pessoas.solicitacoes.atestado.finalidade')"
            :max-bytes="200"
            data-testid="atestado-finalidade"
          />
          <SanteChave
            :ligada="verCid"
            :rotulo="t('pessoas.solicitacoes.atestado.verCid')"
            data-testid="atestado-ver-cid"
            @alternar="(v: boolean) => (verCid = v)"
          />
          <ErroPessoas v-if="erroAtestado" :erro="erroAtestado" />
          <SanteBotao
            :rotulo="t('pessoas.solicitacoes.atestado.ler')"
            :desabilitado="finalidade.trim().length < 5"
            data-testid="atestado-ler"
            @acionar="lerAtestado"
          />
        </template>
        <div v-else data-testid="atestado-conteudo">
          <p>
            {{
              t('pessoas.solicitacoes.atestado.emitidoEm', {
                d: dataBr(atestado.emitidoEm),
                n: atestado.dias,
              })
            }}
          </p>
          <p>{{ t('pessoas.solicitacoes.atestado.emitente', { e: atestado.emitente }) }}</p>
          <p data-testid="atestado-cid">
            {{
              atestado.cid
                ? t('pessoas.solicitacoes.atestado.cid', { c: atestado.cid })
                : atestado.temCid
                  ? t('pessoas.solicitacoes.atestado.cidOculto')
                  : t('pessoas.solicitacoes.atestado.semCid')
            }}
          </p>
          <SanteAlerta
            v-if="atestado.avisoInss"
            :texto="t('pessoas.solicitacoes.atestado.inss')"
            variante="info"
          />
          <template v-if="atestado.acessos.length > 0">
            <h2 class="sub">{{ t('pessoas.solicitacoes.atestado.acessos') }}</h2>
            <ul data-testid="atestado-acessos">
              <li v-for="(a, i) in atestado.acessos" :key="i">
                {{
                  t('pessoas.solicitacoes.atestado.acesso', {
                    em: dataBr(a.acessadoEm),
                    por: a.acessadoPor,
                    f: a.finalidade,
                  })
                }}
              </li>
            </ul>
          </template>
        </div>
      </div>
    </SanteDialogo>
  </section>
</template>

<style scoped src="../estilo-pessoas.css"></style>
<style scoped>
.campos-coluna {
  display: grid;
  gap: 0.5rem;
}
.sub {
  font-size: 1rem;
  margin: 0.5rem 0 0;
}
</style>
