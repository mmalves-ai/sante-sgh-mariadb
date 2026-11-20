<script setup lang="ts">
// Arquivos do SPED contábil gerados (M54.3): tipo, exercício, número, situação, leiaute (conferido ou não no validador
// oficial), linhas, tamanho, o hash (o arquivo salvo confere com ele), quem gerou e quando, o recibo. Com
// `contabil.sped.gerar`: salvar o arquivo para o programa oficial (em ISO-8859-1; a leitura fica registrada), registrar o
// recibo da transmissão e cancelar com o motivo. Nada se apaga.
import {
  type ApoioSped,
  type ArquivoSpedListado,
  SITUACOES_ARQUIVO_SPED,
  TIPOS_ARQUIVO_SPED,
} from '@sgh/contratos';
import { SanteBotao, SanteCampoTexto, SanteData } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../casca/MensagemErro.vue';
import ErroContabil from './ErroContabil.vue';
import {
  baixarSped,
  cancelarSped,
  lerArquivosSped,
  registrarReciboSped,
  salvarArquivo,
} from './api-demonstracoes.js';
import { instante } from './comum-contabil.js';
import { latin1, tamanhoBr } from './comum-demonstracoes.js';

const props = defineProps<{ apoio: ApoioSped; empresa: number; hoje: string }>();
const { t } = useI18n();
const cliente = useQueryClient();
const lista = useQuery({
  queryKey: computed(() => ['contabil', 'sped-arquivos', props.empresa]),
  queryFn: () => lerArquivosSped(props.empresa),
});
const itens = computed(() => lista.data.value?.itens ?? null);

const acao = ref<{ tipo: 'recibo' | 'cancelar'; arquivo: ArquivoSpedListado } | null>(null);
const recibo = ref('');
const transmitidoEm = ref<string | null>(props.hoje);
const motivo = ref('');
const ocupado = ref(false);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
function abrir(tipo: 'recibo' | 'cancelar', arquivo: ArquivoSpedListado) {
  acao.value = { tipo, arquivo };
  recibo.value = '';
  motivo.value = '';
  transmitidoEm.value = props.hoje;
  erro.value = null;
}
const podeConfirmar = computed(() =>
  acao.value?.tipo === 'recibo'
    ? recibo.value.trim().length >= 10 && !!transmitidoEm.value && transmitidoEm.value <= props.hoje
    : motivo.value.trim().length >= 10,
);
async function confirmar() {
  if (!acao.value || !podeConfirmar.value) return;
  ocupado.value = true;
  erro.value = null;
  try {
    const x =
      acao.value.tipo === 'recibo'
        ? await registrarReciboSped({
            empresa: props.empresa,
            id: acao.value.arquivo.id,
            recibo: recibo.value.trim(),
            transmitidoEm: transmitidoEm.value!,
          })
        : await cancelarSped({
            empresa: props.empresa,
            id: acao.value.arquivo.id,
            motivo: motivo.value.trim(),
          });
    mensagem.value = x.mensagem;
    acao.value = null;
    await cliente.invalidateQueries({ queryKey: ['contabil', 'sped-arquivos'] });
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}
async function baixar(a: ArquivoSpedListado) {
  erro.value = null;
  try {
    const x = await baixarSped(props.empresa, a.id);
    salvarArquivo({ nome: x.nomeArquivo, conteudo: new Blob([latin1(x.conteudo)], { type: 'text/plain' }) });
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <section class="bloco" aria-labelledby="sped-arquivos-titulo" data-testid="sped-arquivos">
    <h2 id="sped-arquivos-titulo">{{ t('contabil.sped.arquivos') }}</h2>
    <p v-if="mensagem" role="status" data-testid="sped-arquivo-mensagem">{{ mensagem }}</p>
    <MensagemErro v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!itens" role="status">{{ t('contabil.carregando') }}</p>
    <p v-else-if="itens.length === 0" data-testid="sped-arquivos-vazio">
      {{ t('contabil.sped.nenhumArquivo') }}
    </p>
    <div v-else class="rolagem">
      <table class="tabela" data-testid="tabela-sped">
        <thead>
          <tr>
            <th scope="col">{{ t('contabil.sped.tipo') }}</th>
            <th scope="col">{{ t('contabil.demonstracoes.exercicio') }}</th>
            <th scope="col">{{ t('contabil.sped.numero') }}</th>
            <th scope="col">{{ t('contabil.sped.situacao') }}</th>
            <th scope="col">{{ t('contabil.sped.leiauteCol') }}</th>
            <th scope="col">{{ t('contabil.sped.linhas') }}</th>
            <th scope="col">{{ t('contabil.sped.hash') }}</th>
            <th scope="col">{{ t('contabil.sped.geradoPor') }}</th>
            <th scope="col">{{ t('contabil.sped.recibo') }}</th>
            <th scope="col">{{ t('contabil.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in itens" :key="a.id" :data-testid="`sped-arquivo-${a.id}`">
            <td>
              {{ TIPOS_ARQUIVO_SPED[a.tipo] }}
              <span v-if="a.substituta" class="secundario">({{ t('contabil.sped.substitutaCurta') }})</span>
            </td>
            <td>{{ a.exercicio }}</td>
            <td>{{ a.numero }}</td>
            <td :data-testid="`sped-arquivo-situacao-${a.id}`">
              {{ SITUACOES_ARQUIVO_SPED[a.situacao] }}
              <span v-if="a.motivo" class="secundario">: {{ a.motivo }}</span>
            </td>
            <td>
              {{ a.leiaute }}
              <span class="secundario">
                {{ a.leiauteConferido ? t('contabil.sped.conferido') : t('contabil.sped.naoConferido') }}
              </span>
            </td>
            <td>{{ a.linhas }} · {{ tamanhoBr(a.tamanho) }}</td>
            <td>
              <code :title="a.hash">{{ `${a.hash.slice(0, 12)}…` }}</code>
            </td>
            <td>{{ a.geradoPor }} · {{ instante(a.geradoEm) }}</td>
            <td>
              <template v-if="a.recibo">{{ a.recibo }} ({{ a.transmitidoEm }})</template>
            </td>
            <td>
              <div v-if="apoio.podeGerar" class="acoes">
                <SanteBotao
                  v-if="a.situacao !== 'cancelado'"
                  variante="secundario"
                  :rotulo="t('contabil.sped.baixar')"
                  :data-testid="`sped-baixar-${a.id}`"
                  @acionar="baixar(a)"
                />
                <SanteBotao
                  v-if="a.situacao === 'gerado'"
                  variante="secundario"
                  :rotulo="t('contabil.sped.registrarRecibo')"
                  :data-testid="`sped-recibo-${a.id}`"
                  @acionar="abrir('recibo', a)"
                />
                <SanteBotao
                  v-if="a.situacao === 'gerado'"
                  variante="secundario"
                  :rotulo="t('contabil.sped.cancelar')"
                  :data-testid="`sped-cancelar-${a.id}`"
                  @acionar="abrir('cancelar', a)"
                />
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <section v-if="acao" class="bloco" aria-labelledby="sped-acao-titulo" data-testid="sped-acao">
      <h3 id="sped-acao-titulo">
        {{
          acao.tipo === 'recibo'
            ? t('contabil.sped.reciboDe', { n: acao.arquivo.numero })
            : t('contabil.sped.cancelarDe', { n: acao.arquivo.numero })
        }}
      </h3>
      <div v-if="acao.tipo === 'recibo'" class="campos">
        <SanteCampoTexto
          v-model="recibo"
          :rotulo="t('contabil.sped.recibo')"
          :max-bytes="60"
          data-testid="sped-recibo-numero"
        />
        <SanteData
          v-model="transmitidoEm"
          :rotulo="t('contabil.sped.transmitidoEm')"
          :maximo="hoje"
          editavel
          data-testid="sped-recibo-data"
        />
      </div>
      <SanteCampoTexto
        v-else
        v-model="motivo"
        :rotulo="t('contabil.sped.motivo')"
        :max-bytes="500"
        multilinha
        data-testid="sped-cancelar-motivo"
      />
      <p v-if="acao.tipo === 'cancelar'" class="secundario">{{ t('contabil.justificativaAjuda') }}</p>
      <div class="acoes">
        <SanteBotao
          :rotulo="t('contabil.confirmar')"
          :desabilitado="ocupado || !podeConfirmar"
          data-testid="sped-acao-confirmar"
          @acionar="confirmar"
        />
        <SanteBotao
          variante="secundario"
          :rotulo="t('contabil.cancelar')"
          data-testid="sped-acao-fechar"
          @acionar="acao = null"
        />
      </div>
    </section>
    <ErroContabil v-if="erro" :erro="erro" />
  </section>
</template>

<style scoped src="./estilo-contabil.css"></style>
