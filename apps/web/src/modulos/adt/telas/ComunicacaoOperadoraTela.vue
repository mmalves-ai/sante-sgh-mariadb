<script setup lang="ts">
// Comunicação da internação e da alta à operadora (F78.04-2, 04-INT linha 80): `/internacao/:reg/comunicacoes-operadora`.
// Visão por internação: registrar a comunicação (os dados vêm da internação, nada redigitado), ver a mensagem de
// comunicação de beneficiário e acompanhar a situação. Os botões mostram só as ações que a situação admite (a mesma
// tabela de transições do domínio); o motivo é pedido na hora quando a ação exige.
// C1-108: a pendente de internação, alta ou óbito sai pelo serviço web da operadora num clique (a mensagem montada dos
// dados gravados vai à fila de integração); a enviada por ele lê o retorno (confirma, rejeita ou falha sozinha).
// C2-070: a comunicação desfeita (alta cancelada ou internação excluída) mostra quando e por quê; a que a operadora já
// recebeu fica com a retificação pendente e oferece 'Cancelar junto à operadora' (o 'cancelar' com o motivo, que a
// regra do domínio admite na enviada e na confirmada só nesse caso).
import {
  eventoDaMensagem,
  TIPOS_COMUNICACAO_OPERADORA,
  transicaoComunicacao as regraTransicao,
} from '@sgh/dominio-internacao';
import type {
  AcaoComunicacao,
  SituacaoComunicacaoOperadora,
  TipoComunicacaoOperadora,
} from '@sgh/dominio-internacao';
import { SanteSelecao } from '@sgh/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  type Comunicacao,
  lerComunicacoes,
  lerMensagemComunicacao,
  lerRetornoComunicacao,
  registrarComunicacao,
  transicaoComunicacao,
  transmitirComunicacao,
} from '../api-leitos-sus.js';
import ErroAdt from '../componentes/ErroAdt.vue';

const props = defineProps<{ reg: string }>();
const { t } = useI18n();
const cliente = useQueryClient();
const internacao = computed(() => Number(props.reg));
const lista = useQuery({
  queryKey: computed(() => ['adt', 'comunicacoes-operadora', internacao.value]),
  queryFn: () => lerComunicacoes(internacao.value),
});
const tipo = ref('internacao');
const opTipos = computed(() =>
  TIPOS_COMUNICACAO_OPERADORA.map((v) => ({ valor: v, rotulo: t(`adt.leitosSus.comunicacao.tipos.${v}`) })),
);
const ACOES: AcaoComunicacao[] = ['enviar', 'confirmar', 'rejeitar', 'falhar', 'reenviar', 'cancelar'];
const campos = reactive<Record<number, { protocolo: string; resposta: string }>>({});
const campo = (id: number) => (campos[id] ??= { protocolo: '', resposta: '' });
// Só as ações que a situação admite (a falta de protocolo ou motivo aparece ao tentar).
const acoesDe = (c: Comunicacao) =>
  ACOES.filter(
    (a) =>
      regraTransicao({
        situacao: c.situacao as SituacaoComunicacaoOperadora,
        acao: a,
        protocolo: 'x',
        resposta: 'x',
      }).para !== null,
  );
const problemasDe = (c: Comunicacao, a: AcaoComunicacao) =>
  regraTransicao({
    situacao: c.situacao as SituacaoComunicacaoOperadora,
    acao: a,
    protocolo: campo(c.id).protocolo || c.protocolo,
    resposta: campo(c.id).resposta,
    retificacaoPendente: c.retificacaoPendente,
  }).problemas.map((p) => p.mensagem);
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const avisos = ref<string[]>([]);
const acao = useMutation({
  mutationFn: (fn: () => Promise<unknown>) => fn(),
  onSuccess: () => {
    erro.value = null;
    void cliente.invalidateQueries({ queryKey: ['adt', 'comunicacoes-operadora'] });
  },
  onError: (e) => {
    erro.value = e;
  },
});
const aplicar = (c: Comunicacao, a: AcaoComunicacao) => {
  avisos.value = problemasDe(c, a);
  if (avisos.value.length) return;
  acao.mutate(() =>
    transicaoComunicacao(c.id, {
      acao: a,
      versao: c.versao,
      protocolo: campo(c.id).protocolo || null,
      resposta: campo(c.id).resposta || null,
    }),
  );
};
const quando = (iso: string | null) => iso?.slice(0, 16).replace('T', ' ') ?? '—';
const podeTransmitir = (c: Comunicacao) =>
  c.situacao === 'pendente' && eventoDaMensagem(c.tipo as TipoComunicacaoOperadora) !== null;
const transmitir = (c: Comunicacao) => {
  avisos.value = [];
  acao.mutate(() => transmitirComunicacao(c.id, c.versao));
};
const lerRetorno = (c: Comunicacao) => {
  avisos.value = [];
  acao.mutate(async () => {
    const r = await lerRetornoComunicacao(c.id);
    if (r.aguardando) avisos.value = [t('adt.leitosSus.comunicacao.aguardando')];
    return r;
  });
};
const verMensagem = async (c: Comunicacao) => {
  const r = await lerMensagemComunicacao(c.id);
  mensagem.value = r.xml;
  avisos.value = r.problemas.map((p) => p.mensagem);
};
</script>

<template>
  <section class="tela-agenda" aria-labelledby="com-op-titulo" data-testid="tela-comunicacao-operadora">
    <h1 id="com-op-titulo">{{ t('adt.leitosSus.comunicacao.titulo') }}</h1>
    <p>{{ t('adt.leitosSus.comunicacao.texto') }}</p>
    <ErroAdt v-if="lista.isError.value" :erro="lista.error.value" />
    <ErroAdt v-if="erro" :erro="erro" />
    <ul v-if="avisos.length" class="problemas" data-testid="com-op-problemas">
      <li v-for="p in avisos" :key="p">{{ p }}</li>
    </ul>
    <form class="filtros" @submit.prevent="acao.mutate(() => registrarComunicacao(internacao, tipo))">
      <SanteSelecao
        v-model="tipo"
        :rotulo="t('adt.leitosSus.comunicacao.tipo')"
        :opcoes="opTipos"
        data-testid="com-op-tipo"
      />
      <button type="submit" :disabled="acao.isPending.value" data-testid="com-op-registrar">
        {{ t('adt.leitosSus.comunicacao.registrar') }}
      </button>
    </form>
    <p v-if="lista.data.value?.itens.length === 0">{{ t('adt.leitosSus.comunicacao.vazio') }}</p>
    <table v-else-if="lista.data.value" data-testid="com-op-lista">
      <thead>
        <tr>
          <th>{{ t('adt.leitosSus.comunicacao.tipo') }}</th>
          <th></th>
          <th>{{ t('adt.leitosSus.comunicacao.protocolo') }}</th>
          <th>{{ t('adt.leitosSus.comunicacao.enviadoEm') }}</th>
          <th>{{ t('adt.leitosSus.comunicacao.respondidoEm') }}</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="c in lista.data.value.itens" :key="c.id" :data-testid="`com-op-${c.tipo}`">
          <td>{{ t(`adt.leitosSus.comunicacao.tipos.${c.tipo}`) }}</td>
          <td>
            {{ t(`adt.leitosSus.comunicacao.situacoes.${c.situacao}`) }}
            <span v-if="c.situacaoEnvio" class="secundario" :data-testid="`com-op-envio-${c.id}`">
              ·
              {{
                t('adt.leitosSus.comunicacao.pelaIntegracao', {
                  situacao: t(`adt.leitosSus.comunicacao.envios.${c.situacaoEnvio}`),
                })
              }}
            </span>
            <span v-if="c.desfeitaEm" class="secundario" :data-testid="`com-op-desfeita-${c.id}`">
              <br />
              {{
                t('adt.leitosSus.comunicacao.desfeita', {
                  quando: quando(c.desfeitaEm),
                  motivo: c.motivoDesfeita,
                })
              }}
            </span>
            <strong v-if="c.retificacaoPendente" :data-testid="`com-op-retificacao-${c.id}`">
              <br />
              {{ t('adt.leitosSus.comunicacao.retificacaoPendente') }}
            </strong>
          </td>
          <td>{{ c.protocolo ?? '—' }}</td>
          <td>{{ quando(c.enviadoEm) }}</td>
          <td>{{ quando(c.respondidoEm) }}</td>
          <td>
            <template v-if="acoesDe(c).length">
              <label
                >{{ t('adt.leitosSus.comunicacao.protocolo') }}
                <input v-model="campo(c.id).protocolo" maxlength="50"
              /></label>
              <label
                >{{ t('adt.leitosSus.comunicacao.resposta') }}
                <input v-model="campo(c.id).resposta" maxlength="2000"
              /></label>
              <button v-for="a in acoesDe(c)" :key="a" type="button" @click="aplicar(c, a)">
                {{ t(`adt.leitosSus.comunicacao.acoes.${a}`) }}
              </button>
            </template>
            <template v-if="c.retificacaoPendente">
              <label v-if="!acoesDe(c).length"
                >{{ t('adt.leitosSus.comunicacao.motivoCancelamento') }}
                <input
                  v-model="campo(c.id).resposta"
                  maxlength="2000"
                  :data-testid="`com-op-motivo-cancelamento-${c.id}`"
              /></label>
              <button
                type="button"
                :disabled="acao.isPending.value"
                :data-testid="`com-op-cancelar-operadora-${c.id}`"
                @click="aplicar(c, 'cancelar')"
              >
                {{ t('adt.leitosSus.comunicacao.cancelarOperadora') }}
              </button>
            </template>
            <button
              v-if="podeTransmitir(c)"
              type="button"
              :disabled="acao.isPending.value"
              :data-testid="`com-op-transmitir-${c.id}`"
              @click="transmitir(c)"
            >
              {{ t('adt.leitosSus.comunicacao.transmitir') }}
            </button>
            <button
              v-if="c.pelaIntegracao && c.situacao === 'enviada'"
              type="button"
              :disabled="acao.isPending.value"
              :data-testid="`com-op-retorno-${c.id}`"
              @click="lerRetorno(c)"
            >
              {{ t('adt.leitosSus.comunicacao.lerRetorno') }}
            </button>
            <button type="button" @click="verMensagem(c)">
              {{ t('adt.leitosSus.comunicacao.mensagem') }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <pre v-if="mensagem" data-testid="com-op-mensagem">{{ mensagem }}</pre>
  </section>
</template>
