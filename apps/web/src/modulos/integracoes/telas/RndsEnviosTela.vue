<script setup lang="ts">
// Envios à RNDS por paciente (F7, 08-INTG L130): `/admin/integracoes/rnds`. Visão por paciente numa tela só: a busca
// escolhe o paciente; a tela mostra só o TIPO da identificação usada com a rede (CPF, CNS ou nenhuma; o número nunca
// sai), os sumários de alta e os resultados de exame com o envio, a versão, o retorno e o bloqueio dito antes do
// pedido (melhoria: o motivo aparece antes de tentar). As ações vêm do servidor (enviar, substituir, cancelar); a
// substituição e o cancelamento pedem o motivo, conferido na hora. As versões de cada envio ficam à vista; nada é
// apagado (a correção é uma versão nova). Fora de produção, o envio vai ao simulador.
import type { ResultadoBuscaPaciente } from '@sgh/contratos';
import { SanteSelecao } from '@sgh/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { buscarPacientes } from '../../cadastro/api-cadastro.js';
import {
  type DocumentoRnds,
  lerEnviosRnds,
  lerPacienteRnds,
  lerVersoesRnds,
  MOTIVO_MINIMO_RNDS,
  SITUACOES_ENVIO_RNDS,
  solicitarEnvioRnds,
  type TipoVersaoRnds,
} from '../api-rnds-envio.js';
import { mensagensRndsEnvio } from '../i18n-rnds-envio.js';

const { t } = useI18n({ useScope: 'local', messages: mensagensRndsEnvio });
const fila = useQueryClient();
const podeEnviar = computed(() => pode('integracao.fhir.enviar'));

const termo = ref('');
const pedido = ref('');
const busca = useQuery({
  queryKey: computed(() => ['rnds', 'busca', pedido.value]),
  queryFn: (): Promise<ResultadoBuscaPaciente> => buscarPacientes(pedido.value),
  enabled: computed(() => pedido.value.length >= 2),
});
const paciente = ref<{ id: number; nome: string } | null>(null);
const idPaciente = computed(() => paciente.value?.id ?? 0);
const comPaciente = computed(() => idPaciente.value > 0);

const visao = useQuery({
  queryKey: ['rnds', 'paciente', idPaciente],
  queryFn: () => lerPacienteRnds(idPaciente.value),
  enabled: comPaciente,
});

const filtroSituacao = ref<string | null>(null);
const opcoesSituacao = computed(() => [
  { valor: '', rotulo: t('todos') },
  ...SITUACOES_ENVIO_RNDS.map((v) => ({ valor: v, rotulo: t(`situacoes.${v}`) })),
]);
const envios = useQuery({
  queryKey: ['rnds', 'envios', idPaciente, filtroSituacao],
  queryFn: () => lerEnviosRnds(idPaciente.value, filtroSituacao.value || null),
  enabled: comPaciente,
});
/** Os documentos do paciente, recortados pela situação do envio quando há filtro. */
const documentos = computed(() => {
  const todos = visao.data.value?.documentos ?? [];
  if (!filtroSituacao.value) return todos;
  const ids = new Set((envios.data.value ?? []).map((e) => e.id));
  return todos.filter((d) => d.envio && ids.has(d.envio.id));
});

const abertoVersoes = ref<number | null>(null);
const idVersoes = computed(() => abertoVersoes.value ?? 0);
const versoes = useQuery({
  queryKey: ['rnds', 'versoes', idVersoes],
  queryFn: () => lerVersoesRnds(idVersoes.value),
  enabled: computed(() => idVersoes.value > 0),
});

const aviso = ref('');
const erro = ref<unknown>(null);
const chave = (d: DocumentoRnds) => `${d.tipo}-${d.registro}`;
const dataBr = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '');

const escolher = (id: number, nome: string) => {
  paciente.value = { id, nome };
  aviso.value = '';
  erro.value = null;
  pedindo.value = null;
};
const trocar = () => {
  paciente.value = null;
  abertoVersoes.value = null;
  pedindo.value = null;
};

/** O pedido em preparo: documento e operação (a original vai direto; as demais pedem o motivo). */
const pedindo = ref<{ doc: DocumentoRnds; operacao: TipoVersaoRnds } | null>(null);
const motivo = ref('');
const motivoValido = computed(() => motivo.value.trim().length >= MOTIVO_MINIMO_RNDS);
const solicitacao = useMutation({
  mutationFn: (p: { doc: DocumentoRnds; operacao: TipoVersaoRnds }) =>
    solicitarEnvioRnds({
      tipo: p.doc.tipo,
      registro: p.doc.registro,
      operacao: p.operacao,
      motivo: p.operacao === 'original' ? null : motivo.value.trim(),
    }),
  onSuccess: async (r) => {
    pedindo.value = null;
    motivo.value = '';
    erro.value = null;
    aviso.value = t('solicitado', { versao: r.versao, tipo: t(`tiposVersao.${r.tipoVersao}`) });
    await fila.invalidateQueries({ queryKey: ['rnds'] });
  },
  onError: (e) => (erro.value = e),
});
const acionar = (doc: DocumentoRnds, operacao: TipoVersaoRnds) => {
  aviso.value = '';
  if (operacao === 'original') solicitacao.mutate({ doc, operacao });
  else {
    motivo.value = '';
    pedindo.value = { doc, operacao };
  }
};
</script>

<template>
  <section class="tela-agenda" aria-labelledby="rnds-envios-titulo" data-testid="tela-rnds-envios">
    <h1 id="rnds-envios-titulo">{{ t('titulo') }}</h1>
    <p>{{ t('explicacao') }}</p>
    <p v-if="!podeEnviar" role="note" data-testid="rnds-so-consulta">{{ t('soConsulta') }}</p>
    <p v-if="aviso" role="status" data-testid="rnds-aviso">{{ aviso }}</p>
    <MensagemErro v-if="erro" :erro="erro" />

    <form v-if="!paciente" class="rnds-linha" role="search" @submit.prevent="pedido = termo.trim()">
      <label>
        {{ t('termo') }}
        <input v-model="termo" minlength="2" required data-testid="rnds-termo" />
      </label>
      <button type="submit" data-testid="rnds-buscar">{{ t('buscar') }}</button>
    </form>
    <MensagemErro v-if="!paciente && busca.error.value" :erro="busca.error.value" />
    <ul v-if="!paciente && busca.data.value" class="rnds-lista" data-testid="rnds-pacientes">
      <li v-if="busca.data.value.itens.length === 0">{{ t('nenhumPaciente') }}</li>
      <li v-for="p in busca.data.value.itens" :key="p.id">
        <button
          type="button"
          :data-testid="`rnds-paciente-${p.id}`"
          @click="escolher(p.id, p.nomeSocial ?? p.nome)"
        >
          {{ t('escolherPaciente', { nome: p.nomeSocial ?? p.nome }) }}
        </button>
      </li>
    </ul>

    <template v-if="paciente">
      <div class="rnds-linha">
        <strong data-testid="rnds-paciente-escolhido">{{
          t('pacienteEscolhido', { nome: paciente.nome })
        }}</strong>
        <button type="button" data-testid="rnds-trocar" @click="trocar">{{ t('trocarPaciente') }}</button>
      </div>
      <MensagemErro v-if="visao.error.value" :erro="visao.error.value" />
      <template v-if="visao.data.value">
        <p data-testid="rnds-identificacao">
          {{ t('identificacao', { tipo: t(`identificacoes.${visao.data.value.identificacao}`) }) }}
        </p>
        <p
          v-if="visao.data.value.identificacao === 'nenhuma'"
          role="alert"
          data-testid="rnds-sem-identificacao"
        >
          {{ t('semIdentificacao') }}
        </p>
        <h2>{{ t('documentos') }}</h2>
        <SanteSelecao
          v-model="filtroSituacao"
          :rotulo="t('filtroSituacao')"
          :opcoes="opcoesSituacao"
          data-testid="rnds-filtro-situacao"
        />
        <p v-if="documentos.length === 0" data-testid="rnds-sem-documentos">{{ t('semDocumentos') }}</p>
        <ul class="rnds-lista" data-testid="rnds-documentos">
          <li v-for="d in documentos" :key="chave(d)" class="rnds-doc" :data-testid="`rnds-doc-${chave(d)}`">
            <strong>{{ t(`tiposDocumento.${d.tipo}`) }}</strong>
            <span>{{ d.descricao }} · {{ dataBr(d.data) }}</span>
            <span :data-testid="`rnds-envio-${chave(d)}`">
              {{
                d.envio
                  ? t('envio', {
                      versao: d.envio.versaoAtual,
                      tipo: d.envio.tipoVersao ? t(`tiposVersao.${d.envio.tipoVersao}`) : '',
                      situacao: t(`situacoes.${d.envio.situacao}`),
                    })
                  : t('naoEnviado')
              }}
            </span>
            <span v-if="d.bloqueio" role="note" :data-testid="`rnds-bloqueio-${chave(d)}`">
              {{ t('bloqueio', { motivo: d.bloqueio }) }}
            </span>
            <div class="rnds-linha">
              <template v-if="podeEnviar">
                <button
                  v-for="a in d.acoes"
                  :key="a"
                  type="button"
                  :disabled="solicitacao.isPending.value"
                  :data-testid="`rnds-acao-${a}-${chave(d)}`"
                  @click="acionar(d, a)"
                >
                  {{ t(`acoes.${a}`) }}
                </button>
              </template>
              <button
                v-if="d.envio"
                type="button"
                :data-testid="`rnds-versoes-${chave(d)}`"
                @click="abertoVersoes = abertoVersoes === d.envio.id ? null : d.envio.id"
              >
                {{ abertoVersoes === d.envio.id ? t('fecharVersoes') : t('verVersoes') }}
              </button>
            </div>

            <form
              v-if="pedindo && chave(pedindo.doc) === chave(d)"
              class="rnds-linha"
              data-testid="rnds-pedido"
              @submit.prevent="pedindo && motivoValido && solicitacao.mutate(pedindo)"
            >
              <label>
                {{ t('motivo') }}
                <input v-model="motivo" maxlength="500" data-testid="rnds-motivo" />
              </label>
              <p v-if="motivo && !motivoValido" role="alert" data-testid="rnds-erro-motivo">
                {{ t('erroMotivo') }}
              </p>
              <button
                type="submit"
                :disabled="!motivoValido || solicitacao.isPending.value"
                data-testid="rnds-confirmar"
              >
                {{ t('confirmar') }}
              </button>
              <button type="button" @click="pedindo = null">{{ t('fechar') }}</button>
            </form>

            <ol
              v-if="d.envio && abertoVersoes === d.envio.id"
              class="rnds-lista"
              :data-testid="`rnds-lista-versoes-${chave(d)}`"
            >
              <li
                v-for="v in versoes.data.value ?? []"
                :key="v.numero"
                :data-testid="`rnds-versao-${v.numero}`"
              >
                <span>{{
                  t('versao', {
                    numero: v.numero,
                    tipo: t(`tiposVersao.${v.tipo}`),
                    situacao: t(`situacoes.${v.situacao}`),
                  })
                }}</span>
                <span v-if="v.codigoRetorno || v.mensagem">{{
                  t('retorno', { codigo: v.codigoRetorno ?? '', mensagem: v.mensagem ?? '' })
                }}</span>
                <span v-if="v.motivo">{{ t('versaoMotivo', { motivo: v.motivo }) }}</span>
              </li>
            </ol>
          </li>
        </ul>
      </template>
    </template>
  </section>
</template>

<style scoped>
.rnds-linha {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: var(--sgh-espaco-3);
}
.rnds-lista {
  list-style: none;
  padding: 0;
}
.rnds-doc,
.rnds-lista li {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  padding-block: var(--sgh-espaco-2);
}
.rnds-doc {
  border-top: 1px solid var(--sgh-borda);
}
</style>
