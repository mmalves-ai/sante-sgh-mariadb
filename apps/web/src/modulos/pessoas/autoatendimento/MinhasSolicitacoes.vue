<script setup lang="ts">
// "Minhas solicitações" no Meu espaço (W0-06, parte 6d; M3 de mercado; `pessoas.autoatendimento.solicitar`, só o
// próprio vínculo): a lista dos pedidos com a situação e a decisão do gestor, a inclusão (férias, abono, ajuste de
// ponto, correção do nome, atestado) com o motivo e a desistência com motivo enquanto aguarda (o servidor diz em
// `acoes.desistir`; só quem pediu). O atestado é dado de saúde: a leitura pede a finalidade e fica na trilha. Os tipos
// de movimento do ponto vêm do apoio do ponto quando a pessoa o lê; sem ele, o gestor escolhe na aprovação. A marcação
// a desconsiderar vem do próprio espelho do dia. Leve para o celular (uma coluna, alvos de 24 px).
import {
  CAMPOS_ALTERACAO_CADASTRAL_PESSOA,
  SITUACOES_SOLICITACAO_PESSOA,
  TIPOS_AJUSTE,
  TIPOS_SOLICITACAO_PESSOA,
  type AtestadoPessoaResposta,
  type SolicitacaoPessoaResposta,
} from '@sgh/contratos';
import {
  SanteAlerta,
  SanteBotao,
  SanteCampoTexto,
  SanteChave,
  SanteData,
  SanteDialogo,
  SanteHora,
  SanteSelecao,
} from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import DialogoMotivo from '../componentes/DialogoMotivo.vue';
import ErroPessoas from '../componentes/ErroPessoas.vue';
import { dataBr, opcoesDe } from '../comum.js';
import { lerApoioPonto, lerMeuEspelho } from '../ponto/api-ponto.js';
import {
  desistirSolicitacao,
  incluirSolicitacao,
  lerMeuAtestado,
  lerMinhasSolicitacoes,
} from './api-solicitacoes.js';
import {
  formSolicitacaoVazio,
  montarPedido,
  periodoDoPedido,
  type FormSolicitacao,
} from './solicitacao-comum.js';

const props = defineProps<{ vinculo: number | null; nomeAtual: string }>();
const { t } = useI18n();
const cliente = useQueryClient();

const minhas = useQuery({
  queryKey: computed(() => ['pessoas', 'solicitacoes', 'minhas', props.vinculo]),
  queryFn: () => lerMinhasSolicitacoes(props.vinculo),
});
const lista = computed(() => minhas.data.value ?? null);
const recarregar = () => cliente.invalidateQueries({ queryKey: ['pessoas', 'solicitacoes'] });

// O apoio do ponto (tipos de movimento) só para quem o lê; sem ele, o gestor escolhe o movimento na aprovação.
const apoio = useQuery({
  queryKey: ['pessoas', 'solicitacoes', 'apoio-ponto'],
  queryFn: () => lerApoioPonto().catch(() => null),
  retry: false,
});
const movimentos = computed(() =>
  (apoio.data.value?.dominios.movimentos ?? []).map((m) => ({
    valor: m.codigo as number | null,
    rotulo: m.rotulo,
  })),
);

const aviso = ref<string | null>(null);
const abrindo = ref(false);
const form = ref<FormSolicitacao>(formSolicitacaoVazio());
watch(abrindo, (v) => {
  if (v) form.value = formSolicitacaoVazio(form.value.tipo);
});
const opcoesTipo = opcoesDe(TIPOS_SOLICITACAO_PESSOA);
const opcoesAjuste = computed(() =>
  opcoesDe(TIPOS_AJUSTE).filter((o) => o.valor !== 'justificativa' || movimentos.value.length > 0),
);
const opcoesCampo = opcoesDe(CAMPOS_ALTERACAO_CADASTRAL_PESSOA);
const opcoesMovimento = computed(() => [
  { valor: null as number | null, rotulo: t('pessoas.solicitacoes.novo.movimentoGestor') },
  ...movimentos.value,
]);

// As marcações do dia (desconsiderar), do próprio espelho.
const diaDesconsiderar = computed(() =>
  form.value.tipo === 'ajuste_ponto' && form.value.ajuste === 'desconsiderar' ? form.value.dia : null,
);
const espelho = useQuery({
  queryKey: computed(() => [
    'pessoas',
    'solicitacoes',
    'espelho',
    diaDesconsiderar.value?.slice(0, 7),
    props.vinculo,
  ]),
  queryFn: () => lerMeuEspelho(diaDesconsiderar.value!.slice(0, 7), props.vinculo),
  enabled: computed(() => !!diaDesconsiderar.value),
  retry: false,
});
const opcoesMarcacao = computed(() => {
  const d = espelho.data.value?.espelho?.dias.find((x) => x.dia === diaDesconsiderar.value);
  return (d?.marcacoes ?? [])
    .filter((m) => m.id !== null && !m.desconsiderada)
    .map((m) => ({ valor: m.id as number | null, rotulo: m.instante.slice(11, 16) }));
});

const montagem = computed(() => montarPedido(form.value, 'motivo provisorio', props.vinculo));
async function incluir(motivo: string): Promise<void> {
  const m = montarPedido(form.value, motivo, props.vinculo);
  if (!m.ok) throw new Error(m.mensagem);
  const r = await incluirSolicitacao(m.entrada);
  aviso.value = [r.mensagem || t('pessoas.solicitacoes.novo.enviado'), ...r.avisos].join(' ');
  await recarregar();
}

const desistindo = ref<SolicitacaoPessoaResposta | null>(null);
const dialogoDesistir = computed({
  get: () => desistindo.value !== null,
  set: (v: boolean) => {
    if (!v) desistindo.value = null;
  },
});
async function desistir(motivo: string): Promise<void> {
  const s = desistindo.value!;
  const r = await desistirSolicitacao(s.id, s.versao, motivo);
  aviso.value = r.mensagem;
  await recarregar();
}

// A leitura do atestado (com a finalidade; o próprio colaborador pode ver o próprio CID).
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
    atestado.value = await lerMeuAtestado(lendo.value!.id, {
      finalidade: finalidade.value.trim(),
      verCid: verCid.value,
    });
  } catch (e) {
    erroAtestado.value = e;
  }
}

const decisao = (s: SolicitacaoPessoaResposta) =>
  s.decididoPor && s.decididoEm
    ? t('pessoas.solicitacoes.linha.decidido', {
        situacao: SITUACOES_SOLICITACAO_PESSOA[s.situacao],
        por: s.decididoPor,
        em: dataBr(s.decididoEm),
      })
    : null;
</script>

<template>
  <article class="cartao" aria-labelledby="minhas-solic" data-testid="minhas-solicitacoes">
    <h2 id="minhas-solic">{{ t('pessoas.solicitacoes.minhas.titulo') }}</h2>
    <p class="secundario">{{ t('pessoas.solicitacoes.minhas.texto') }}</p>
    <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="solicitacao-aviso" />
    <ErroPessoas v-if="minhas.isError.value" :erro="minhas.error.value" />
    <p v-else-if="!lista" role="status">{{ t('pessoas.carregando') }}</p>
    <template v-else>
      <p v-if="lista.itens.length === 0">{{ t('pessoas.solicitacoes.minhas.vazio') }}</p>
      <ul v-else class="lista-solic">
        <li v-for="s in lista.itens" :key="s.id" :data-testid="`solicitacao-${s.id}`">
          <strong>{{ TIPOS_SOLICITACAO_PESSOA[s.tipo] }}</strong>
          <span v-if="periodoDoPedido(s, dataBr)"> · {{ periodoDoPedido(s, dataBr) }}</span>
          —
          <strong :data-testid="`solicitacao-${s.id}-situacao`">{{
            SITUACOES_SOLICITACAO_PESSOA[s.situacao]
          }}</strong>
          <div v-if="s.valorNovo" class="secundario">
            {{ t('pessoas.solicitacoes.linha.valor', { antes: s.valorAnterior ?? '', depois: s.valorNovo }) }}
          </div>
          <div class="secundario">
            {{ t('pessoas.solicitacoes.linha.pedido', { em: dataBr(s.pedidoEm) }) }}
            <template v-if="decisao(s)"> · {{ decisao(s) }}</template>
          </div>
          <div v-if="s.motivoDecisao" class="secundario">
            {{ t('pessoas.solicitacoes.linha.motivo', { m: s.motivoDecisao }) }}
          </div>
          <div class="acoes-linha">
            <SanteBotao
              v-if="s.acoes.desistir"
              :rotulo="t('pessoas.solicitacoes.minhas.desistir')"
              variante="texto"
              :data-testid="`solicitacao-${s.id}-desistir`"
              @acionar="desistindo = s"
            />
            <SanteBotao
              v-if="s.temAtestado"
              :rotulo="t('pessoas.solicitacoes.minhas.verAtestado')"
              variante="texto"
              :data-testid="`solicitacao-${s.id}-atestado`"
              @acionar="lendo = s"
            />
          </div>
        </li>
      </ul>
      <p v-if="lista.limitado" class="secundario">{{ t('pessoas.solicitacoes.minhas.limitado') }}</p>
      <SanteBotao
        :rotulo="t('pessoas.solicitacoes.minhas.nova')"
        variante="secundario"
        data-testid="solicitacao-nova"
        @acionar="abrindo = true"
      />
    </template>

    <DialogoMotivo
      v-model:visivel="abrindo"
      :titulo="t('pessoas.solicitacoes.novo.titulo')"
      :texto="t('pessoas.solicitacoes.novo.texto')"
      :confirmar="t('pessoas.solicitacoes.novo.confirmar')"
      variante="primario"
      :pronto="montagem.ok"
      :acao="incluir"
      testid="solicitacao-incluir"
    >
      <div class="campos">
        <SanteSelecao
          v-model="form.tipo"
          :rotulo="t('pessoas.solicitacoes.novo.tipo')"
          :opcoes="opcoesTipo"
          data-testid="solicitacao-tipo"
        />
        <template v-if="form.tipo === 'ferias'">
          <SanteData
            v-model="form.inicio"
            :rotulo="t('pessoas.solicitacoes.novo.inicioFerias')"
            editavel
            data-testid="solicitacao-inicio"
          />
          <SanteCampoTexto
            v-model="form.diasGozo"
            :rotulo="t('pessoas.solicitacoes.novo.diasGozo')"
            :max-bytes="2"
            data-testid="solicitacao-dias-gozo"
          />
          <SanteCampoTexto
            v-model="form.diasAbono"
            :rotulo="t('pessoas.solicitacoes.novo.diasAbono')"
            :max-bytes="2"
            data-testid="solicitacao-dias-abono"
          />
          <SanteChave
            :ligada="form.adiantaDecimo"
            :rotulo="t('pessoas.solicitacoes.novo.adiantaDecimo')"
            data-testid="solicitacao-decimo"
            @alternar="(v: boolean) => (form.adiantaDecimo = v)"
          />
        </template>
        <template v-else-if="form.tipo === 'abono' || form.tipo === 'atestado'">
          <SanteData
            v-model="form.inicio"
            :rotulo="t('pessoas.solicitacoes.novo.inicio')"
            editavel
            data-testid="solicitacao-inicio"
          />
          <SanteData
            v-model="form.fim"
            :rotulo="t('pessoas.solicitacoes.novo.fim')"
            editavel
            data-testid="solicitacao-fim"
          />
          <SanteSelecao
            v-if="movimentos.length > 0"
            v-model="form.movimento"
            :rotulo="t('pessoas.solicitacoes.novo.movimento')"
            :opcoes="opcoesMovimento"
            busca
            data-testid="solicitacao-movimento"
          />
          <template v-if="form.tipo === 'atestado'">
            <SanteData
              v-model="form.emitidoEm"
              :rotulo="t('pessoas.solicitacoes.novo.emitidoEm')"
              editavel
              data-testid="solicitacao-emitido"
            />
            <SanteCampoTexto
              v-model="form.diasAtestado"
              :rotulo="t('pessoas.solicitacoes.novo.diasAtestado')"
              :max-bytes="3"
              data-testid="solicitacao-dias-atestado"
            />
            <SanteCampoTexto
              v-model="form.emitente"
              :rotulo="t('pessoas.solicitacoes.novo.emitente')"
              :max-bytes="80"
              data-testid="solicitacao-emitente"
            />
            <SanteCampoTexto
              v-model="form.registroConselho"
              :rotulo="t('pessoas.solicitacoes.novo.registroConselho')"
              :max-bytes="30"
              data-testid="solicitacao-conselho"
            />
            <SanteCampoTexto
              v-model="form.cid"
              :rotulo="t('pessoas.solicitacoes.novo.cid')"
              :max-bytes="6"
              data-testid="solicitacao-cid"
            />
            <p class="secundario">{{ t('pessoas.solicitacoes.novo.cidAviso') }}</p>
          </template>
        </template>
        <template v-else-if="form.tipo === 'ajuste_ponto'">
          <SanteData
            v-model="form.dia"
            :rotulo="t('pessoas.solicitacoes.novo.dia')"
            editavel
            data-testid="solicitacao-dia"
          />
          <SanteSelecao
            v-model="form.ajuste"
            :rotulo="t('pessoas.solicitacoes.novo.ajuste')"
            :opcoes="opcoesAjuste"
            data-testid="solicitacao-ajuste"
          />
          <SanteHora
            v-if="form.ajuste === 'inclusao'"
            v-model="form.hora"
            :rotulo="t('pessoas.solicitacoes.novo.hora')"
            editavel
            data-testid="solicitacao-hora"
          />
          <template v-else-if="form.ajuste === 'desconsiderar'">
            <SanteSelecao
              v-if="opcoesMarcacao.length > 0"
              v-model="form.marcacao"
              :rotulo="t('pessoas.solicitacoes.novo.marcacao')"
              :opcoes="opcoesMarcacao"
              data-testid="solicitacao-marcacao"
            />
            <p v-else-if="form.dia" class="secundario">{{ t('pessoas.solicitacoes.novo.semMarcacao') }}</p>
          </template>
          <SanteSelecao
            v-else
            v-model="form.movimento"
            :rotulo="t('pessoas.solicitacoes.novo.movimento')"
            :opcoes="movimentos"
            busca
            data-testid="solicitacao-movimento"
          />
          <p v-if="movimentos.length === 0" class="secundario">
            {{ t('pessoas.solicitacoes.novo.semJustificativa') }}
          </p>
        </template>
        <template v-else>
          <SanteSelecao
            :model-value="'nome'"
            :rotulo="t('pessoas.solicitacoes.novo.campo')"
            :opcoes="opcoesCampo"
            data-testid="solicitacao-campo"
          />
          <p class="secundario">{{ t('pessoas.solicitacoes.novo.valorAtual', { v: nomeAtual }) }}</p>
          <SanteCampoTexto
            v-model="form.valorNovo"
            :rotulo="t('pessoas.solicitacoes.novo.valorNovo')"
            :max-bytes="70"
            data-testid="solicitacao-valor-novo"
          />
        </template>
        <p v-if="!montagem.ok" class="secundario" data-testid="solicitacao-pendencia">
          {{ montagem.mensagem }}
        </p>
      </div>
    </DialogoMotivo>

    <DialogoMotivo
      v-model:visivel="dialogoDesistir"
      :titulo="t('pessoas.solicitacoes.minhas.desistirTitulo')"
      :texto="t('pessoas.solicitacoes.minhas.desistirTexto')"
      :confirmar="t('pessoas.solicitacoes.minhas.desistirConfirmar')"
      :acao="desistir"
      testid="solicitacao-desistir"
    />

    <SanteDialogo v-model:visivel="dialogoAtestado" :titulo="t('pessoas.solicitacoes.atestado.titulo')">
      <div class="campos" data-testid="solicitacao-atestado-dialogo">
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
        </div>
      </div>
    </SanteDialogo>
  </article>
</template>

<style scoped>
.cartao {
  display: grid;
  gap: 0.5rem;
  padding: 0.75rem;
  border: 1px solid var(--p-content-border-color);
  border-radius: 0.5rem;
}
.cartao h2 {
  font-size: 1.1rem;
  margin: 0;
}
.lista-solic {
  margin: 0;
  padding-left: 1rem;
  display: grid;
  gap: 0.5rem;
}
.acoes-linha {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.campos {
  display: grid;
  gap: 0.5rem;
}
.secundario {
  color: var(--p-text-muted-color);
}
</style>
