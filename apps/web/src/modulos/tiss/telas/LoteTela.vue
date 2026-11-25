<script setup lang="ts">
// O lote TISS (ficha do M31, seção 7): `/faturamento/lotes/:id`. O XML guardado (versão 04.03.00, hash do epílogo,
// SHA-256 do arquivo e o resultado do XSD), as contas do lote, o histórico do protocolo (data, autor, recibo e situação
// que o cadastro de origem não guarda) e as trocas com a operadora. O envio vai ao simulador fora de produção; o
// protocolo devolvido é registrado no diálogo do protocolo, que congela o lote.
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRouter } from 'vue-router';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../../faturamento/componentes/MensagemFaturamento.vue';
import { enviarLote, lerLote, novaChave } from '../api-tiss.js';
import { data, quando, reais, usarTiss } from '../usar-tiss.js';

const props = defineProps<{ id: string }>();
const { t, te } = useI18n();
const qc = useQueryClient();
const router = useRouter();
const { pode, motivo, gravacao } = usarTiss('lote');
const id = computed(() => Number(props.id));
const l = useQuery({
  queryKey: computed(() => ['tiss', 'lote', id.value]),
  queryFn: () => lerLote(id.value),
});
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const avisos = ref<readonly string[]>([]);
const resposta = ref<{ protocolo: string | null; recibo: string | null; situacao: number | null } | null>(
  null,
);
const enviando = ref(false);

async function enviar() {
  erro.value = null;
  mensagem.value = null;
  enviando.value = true;
  try {
    const r = await enviarLote(id.value, novaChave('envio'));
    mensagem.value = r.mensagem;
    avisos.value = r.avisos;
    resposta.value = r.resposta;
    await qc.invalidateQueries({ queryKey: ['tiss', 'lote', id.value] });
  } catch (e) {
    erro.value = e;
  } finally {
    enviando.value = false;
  }
}
function protocolar() {
  void router.push({
    path: `/faturamento/lotes/${id.value}/protocolo`,
    query: resposta.value?.protocolo
      ? {
          protocolo: resposta.value.protocolo,
          recibo: resposta.value.recibo ?? '',
          situacao: String(resposta.value.situacao ?? ''),
        }
      : {},
  });
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="lt-titulo" data-testid="tela-tiss-lote">
    <h1 id="lt-titulo">{{ t('tiss.lote') }} {{ id }}</h1>
    <p>
      <RouterLink to="/faturamento/lotes">{{ t('tiss.voltarLotes') }}</RouterLink>
    </p>
    <ErroFaturamento v-if="l.error.value" :erro="l.error.value" />
    <p v-else-if="!l.data.value" role="status">{{ t('tiss.carregando') }}</p>
    <template v-else>
      <dl class="resumo" data-testid="lt-resumo">
        <dt>{{ t('tiss.numero') }}</dt>
        <dd>{{ l.data.value.numero }} · {{ t('tiss.sequencial') }} {{ l.data.value.sequencial }}</dd>
        <dt>{{ t('tiss.convenio') }}</dt>
        <dd>{{ l.data.value.convenioNome || l.data.value.convenio }}</dd>
        <dt>{{ t('tiss.tipoGuia') }}</dt>
        <dd>{{ l.data.value.tipoGuiaNome }}</dd>
        <dt>{{ t('tiss.dataHora') }}</dt>
        <dd>{{ quando(l.data.value.dataHora) }}</dd>
        <dt>{{ t('tiss.situacao') }}</dt>
        <dd data-testid="lt-situacao">{{ l.data.value.situacaoRotulo }}</dd>
        <dt>{{ t('tiss.protocolo') }}</dt>
        <dd data-testid="lt-protocolo">
          {{ l.data.value.protocolo || '—' }}
          <span v-if="l.data.value.congelado" class="secundario" data-testid="lt-congelado"
            >· {{ t('tiss.loteTela.congelado') }}</span
          >
        </dd>
        <dt>{{ t('tiss.valor') }}</dt>
        <dd>{{ reais(l.data.value.valor) }}</dd>
      </dl>
      <p v-if="l.data.value.aviso" class="secundario" data-testid="lt-inferida">{{ l.data.value.aviso }}</p>

      <h2>{{ t('tiss.loteTela.xml') }}</h2>
      <p v-if="!l.data.value.xml" data-testid="lt-sem-xml">{{ t('tiss.loteTela.semXml') }}</p>
      <dl v-else class="resumo" data-testid="lt-xml">
        <dt>{{ t('tiss.versao') }}</dt>
        <dd data-testid="lt-versao">{{ l.data.value.xml.versao }}</dd>
        <dt>{{ t('tiss.loteTela.xsd') }}</dt>
        <dd>{{ l.data.value.xml.valido ? t('tiss.loteTela.xsdValido') : t('tiss.loteTela.xsdInvalido') }}</dd>
        <dt>{{ t('tiss.loteTela.hashEpilogo') }}</dt>
        <dd>
          <code>{{ l.data.value.xml.hashEpilogo }}</code>
        </dd>
        <dt>{{ t('tiss.loteTela.hashArquivo') }}</dt>
        <dd>
          <code>{{ l.data.value.xml.hashArquivo }}</code>
        </dd>
      </dl>

      <div class="filtros">
        <button
          type="button"
          :disabled="enviando || !l.data.value.xml || l.data.value.congelado || !pode('enviarLote')"
          data-testid="lt-enviar"
          @click="enviar"
        >
          {{
            gravacao.data.value?.destinoEnvio === 'operadora'
              ? t('tiss.loteTela.enviarOperadora')
              : t('tiss.loteTela.enviarSimulador')
          }}
        </button>
        <button
          type="button"
          :disabled="!pode('faturamento.registrarProtocolo')"
          data-testid="lt-protocolar"
          @click="protocolar"
        >
          {{
            l.data.value.congelado
              ? t('tiss.loteTela.limparProtocolo')
              : t('tiss.loteTela.registrarProtocolo')
          }}
        </button>
      </div>
      <p v-if="!pode('enviarLote')" class="secundario">{{ motivo('enviarLote') }}</p>
      <ErroFaturamento v-if="erro" :erro="erro" />
      <MensagemFaturamento :texto="mensagem" :avisos="avisos" testid="lt-mensagem" />

      <h2>{{ t('tiss.loteTela.contas') }}</h2>
      <table class="tabela" data-testid="lt-contas">
        <thead>
          <tr>
            <th scope="col">{{ t('tiss.conta') }}</th>
            <th scope="col">{{ t('tiss.carteira') }}</th>
            <th scope="col">{{ t('tiss.total') }}</th>
            <th scope="col">{{ t('tiss.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in l.data.value.contasDoLote" :key="c.conta">
            <td>
              {{ c.conta }} <span class="secundario">· {{ c.chave }}</span>
            </td>
            <td>{{ c.beneficiario }}</td>
            <td>{{ reais(c.total) }}</td>
            <td>
              <RouterLink :to="`/faturamento/glosas?conta=${c.conta}`">{{
                t('tiss.loteTela.verRetorno')
              }}</RouterLink>
            </td>
          </tr>
        </tbody>
      </table>

      <h2>{{ t('tiss.loteTela.fatura') }}</h2>
      <p v-if="!l.data.value.fatura" data-testid="lt-sem-fatura">{{ t('tiss.loteTela.semFatura') }}</p>
      <dl v-else class="resumo" data-testid="lt-fatura">
        <dt>{{ t('tiss.loteTela.faturaNumero') }}</dt>
        <dd>{{ l.data.value.fatura.numero }}</dd>
        <dt>{{ t('tiss.situacao') }}</dt>
        <dd>
          {{
            te(`tiss.loteTela.faturaSituacoes.${l.data.value.fatura.situacao}`)
              ? t(`tiss.loteTela.faturaSituacoes.${l.data.value.fatura.situacao}`)
              : l.data.value.fatura.situacao
          }}
        </dd>
        <dt>{{ t('tiss.loteTela.faturaContas') }}</dt>
        <dd>{{ l.data.value.fatura.contas }}</dd>
        <dt>{{ t('tiss.loteTela.faturaValor') }}</dt>
        <dd>{{ reais(l.data.value.fatura.valorApresentado) }}</dd>
        <dt>{{ t('tiss.protocolo') }}</dt>
        <dd>{{ l.data.value.fatura.protocolo || '—' }}</dd>
        <dt>{{ t('tiss.loteTela.faturaEntrega') }}</dt>
        <dd>{{ data(l.data.value.fatura.entrega) }}</dd>
      </dl>

      <h2>{{ t('tiss.loteTela.historico') }}</h2>
      <p v-if="l.data.value.historico.length === 0">{{ t('tiss.nenhum') }}</p>
      <table v-else class="tabela" data-testid="lt-historico">
        <thead>
          <tr>
            <th scope="col">{{ t('tiss.loteTela.acao') }}</th>
            <th scope="col">{{ t('tiss.protocolo') }}</th>
            <th scope="col">{{ t('tiss.data') }}</th>
            <th scope="col">{{ t('tiss.recibo') }}</th>
            <th scope="col">{{ t('tiss.situacao') }}</th>
            <th scope="col">{{ t('tiss.autor') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(h, i) in l.data.value.historico" :key="i">
            <td>{{ t(`tiss.loteTela.acoes.${h.acao}`) }}</td>
            <td>{{ h.protocolo }}</td>
            <td>{{ data(h.data) }}</td>
            <td>{{ h.recibo || '—' }}</td>
            <td>{{ h.situacaoNome || '—' }}</td>
            <td>{{ h.autor }} · {{ quando(h.em) }}</td>
          </tr>
        </tbody>
      </table>

      <h2>{{ t('tiss.loteTela.mensagens') }}</h2>
      <p v-if="l.data.value.mensagens.length === 0">{{ t('tiss.nenhum') }}</p>
      <table v-else class="tabela" data-testid="lt-mensagens">
        <thead>
          <tr>
            <th scope="col">{{ t('tiss.loteTela.direcao') }}</th>
            <th scope="col">{{ t('tiss.loteTela.destino') }}</th>
            <th scope="col">{{ t('tiss.loteTela.transacao') }}</th>
            <th scope="col">{{ t('tiss.situacao') }}</th>
            <th scope="col">{{ t('tiss.protocolo') }}</th>
            <th scope="col">{{ t('tiss.dataHora') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(m, i) in l.data.value.mensagens" :key="i">
            <td>{{ m.direcao }}</td>
            <td>{{ t(`tiss.loteTela.destinos.${m.destino}`) }}</td>
            <td>{{ m.transacao }}</td>
            <td>{{ m.situacao }}</td>
            <td>{{ m.protocolo || '—' }}</td>
            <td>{{ quando(m.em) }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
