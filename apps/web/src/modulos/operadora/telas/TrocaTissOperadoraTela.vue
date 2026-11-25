<script setup lang="ts">
// Trocas TISS da operadora própria (08-SGO linha 107, C2-061; F7; rota `/operadora/troca-tiss`, `operadora.conta.ler`):
//   - a lista das trocas recebidas e enviadas (pedidos de autorização, cancelamentos de guia, comunicações de internação
//     e alta, demonstrativos de análise e de pagamento), com o filtro de tipo e de direção;
//   - quem recebe contas (`operadora.conta.receber`) envia a mensagem TISS 4.03 que o prestador mandou em arquivo e vê
//     o resultado na hora: o protocolo do pedido, o resultado guia a guia do cancelamento, se o beneficiário da
//     comunicação foi identificado, ou os motivos da rejeitada. A recusa do arquivo (versão, XSD, hash, destino,
//     prestador, sequencial repetido) aparece com o que o XSD apontou, sem registro.
// O arquivo é conferido antes do envio (extensão .xml e o teto de 2 MB): nada sai da tela que o servidor recusaria.
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import { pode } from '../../../casca/sessao/pode.js';
import { arquivoEmBase64 } from '../api-contas.js';
import {
  type DirecaoTroca,
  lerTrocas,
  MAXIMO_BYTES_TROCA,
  receberMensagem,
  type ResultadoTroca,
  TIPOS_TROCA,
  type TipoTroca,
} from '../api-troca-tiss.js';

const { t, te } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      titulo: 'Trocas TISS com os prestadores',
      texto:
        'Mensagens TISS trocadas com a rede: pedidos de autorização, cancelamentos de guia e comunicações de internação e alta recebidos; demonstrativos de análise e de pagamento enviados.',
      carregando: 'Carregando…',
      nenhuma: 'Nenhuma troca registrada com este filtro.',
      filtro: {
        tipo: 'Tipo de troca',
        direcao: 'Direção',
        todos: 'Todos',
        todas: 'Todas',
        buscar: 'Filtrar',
      },
      direcoes: { recebida: 'Recebida do prestador', enviada: 'Enviada ao prestador' },
      tipos: {
        envio_lote_guias: 'Lote de guias',
        solicitacao_procedimento: 'Pedido de autorização',
        solicitacao_status_autorizacao: 'Situação da autorização',
        solicitacao_status_protocolo: 'Situação do protocolo',
        verificacao_elegibilidade: 'Elegibilidade',
        cancelamento_guia: 'Cancelamento de guia',
        demonstrativo_pagamento: 'Demonstrativo de pagamento',
        demonstrativo_analise_conta: 'Demonstrativo de análise da conta',
        recurso_glosa: 'Recurso de glosa',
        envio_documentos: 'Documentos',
        envio_anexo: 'Anexo',
        comunicacao_internacao: 'Comunicação de internação ou alta',
      },
      situacoes: {
        processada: 'Processada',
        rejeitada: 'Rejeitada',
        enviada: 'Enviada',
        recebida: 'Recebida',
      },
      colunas: {
        quando: 'Registrada em',
        direcao: 'Direção',
        tipo: 'Tipo',
        prestador: 'Prestador',
        sequencial: 'Sequencial',
        protocolo: 'Protocolo',
        situacao: 'Situação',
        motivo: 'Motivo',
      },
      receber: {
        titulo: 'Receber mensagem do prestador',
        texto:
          'Pedido de autorização (SP/SADT ou internação), cancelamento de guia ou comunicação de internação e alta, no padrão TISS 4.03. O arquivo é conferido no XSD oficial e pelo hash.',
        arquivo: 'Arquivo XML da mensagem',
        escolhido: '{nome} ({kb} kB)',
        naoXml: 'Escolha um arquivo .xml.',
        grande: 'O arquivo passa de 2 MB.',
        enviar: 'Receber',
        enviando: 'Recebendo…',
        errosXsd: 'O que o XSD apontou:',
      },
      resultado: {
        processada: 'Mensagem processada.',
        rejeitada: 'Mensagem registrada como rejeitada.',
        protocolo: 'Protocolo: {protocolo}',
        motivos: 'Motivos:',
        guia: 'Guia do prestador',
        resultadoGuia: 'Resultado',
        observacao: 'Observação',
        identificado: 'Beneficiário identificado pela carteira: a comunicação foi aceita.',
        naoIdentificado: 'Carteira não encontrada na base: a comunicação ficou recebida, para conferência.',
        guias: {
          cancelada: 'Cancelada',
          nao_cancelada: 'Não cancelada',
          nao_localizada: 'Não localizada',
        },
      },
    },
  },
});

const cliente = useQueryClient();
const podeReceber = computed(() => pode('operadora.conta.receber'));
const rotulo = (grupo: string, codigo: string) =>
  te(`${grupo}.${codigo}`) ? t(`${grupo}.${codigo}`) : codigo;
const quando = (v: string) => {
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? v
    : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};

// ── Lista com o filtro ──────────────────────────────────────────────────────────────────────────
const tipo = ref<TipoTroca | null>(null);
const direcao = ref<DirecaoTroca | null>(null);
const opcoesTipo = computed(() => [
  { valor: null as TipoTroca | null, rotulo: t('filtro.todos') },
  ...TIPOS_TROCA.map((x) => ({ valor: x as TipoTroca | null, rotulo: t(`tipos.${x}`) })),
]);
const opcoesDirecao = computed(() => [
  { valor: null as DirecaoTroca | null, rotulo: t('filtro.todas') },
  { valor: 'recebida' as DirecaoTroca | null, rotulo: t('direcoes.recebida') },
  { valor: 'enviada' as DirecaoTroca | null, rotulo: t('direcoes.enviada') },
]);
const lista = useQuery({
  queryKey: computed(() => ['operadora', 'troca-tiss', tipo.value, direcao.value]),
  queryFn: () => lerTrocas({ tipo: tipo.value, direcao: direcao.value }),
});

// ── Recebimento ─────────────────────────────────────────────────────────────────────────────────
const arquivo = ref<File | null>(null);
const enviando = ref(false);
const resultado = ref<ResultadoTroca | null>(null);
const recusa = ref<string | null>(null);
const errosXsd = ref<string[]>([]);
const erro = ref<unknown>(null);
const problemaArquivo = computed(() => {
  const f = arquivo.value;
  if (!f) return null;
  if (!/\.xml$/i.test(f.name)) return t('receber.naoXml');
  if (f.size > MAXIMO_BYTES_TROCA) return t('receber.grande');
  return null;
});

function escolher(ev: Event): void {
  arquivo.value = (ev.target as HTMLInputElement).files?.[0] ?? null;
  resultado.value = null;
  recusa.value = null;
  errosXsd.value = [];
  erro.value = null;
}

async function receber(): Promise<void> {
  const f = arquivo.value;
  if (!f || problemaArquivo.value) return;
  enviando.value = true;
  resultado.value = null;
  recusa.value = null;
  errosXsd.value = [];
  erro.value = null;
  try {
    resultado.value = await receberMensagem(await arquivoEmBase64(f));
    await cliente.invalidateQueries({ queryKey: ['operadora', 'troca-tiss'] });
  } catch (e) {
    if (e instanceof ErroApi && e.problema?.detail && [400, 403, 409].includes(e.status)) {
      recusa.value = e.problema.detail;
      const avisos = (e.problema as { avisos?: unknown }).avisos;
      errosXsd.value = Array.isArray(avisos) ? avisos.map(String) : [];
    } else erro.value = e;
  } finally {
    enviando.value = false;
  }
}
</script>

<template>
  <section class="tela-operadora" aria-labelledby="ope-troca-titulo" data-testid="tela-operadora-troca-tiss">
    <h1 id="ope-troca-titulo">{{ t('titulo') }}</h1>
    <p>{{ t('texto') }}</p>

    <section v-if="podeReceber" class="bloco" aria-labelledby="ope-troca-receber" data-testid="troca-receber">
      <h2 id="ope-troca-receber">{{ t('receber.titulo') }}</h2>
      <p class="secundario">{{ t('receber.texto') }}</p>
      <span class="campo">
        <label for="troca-arquivo">{{ t('receber.arquivo') }}</label>
        <input
          id="troca-arquivo"
          type="file"
          accept=".xml,text/xml,application/xml"
          data-testid="troca-arquivo"
          @change="escolher"
        />
      </span>
      <p v-if="arquivo" class="secundario" data-testid="troca-arquivo-escolhido">
        {{ t('receber.escolhido', { nome: arquivo.name, kb: Math.ceil(arquivo.size / 1000) }) }}
      </p>
      <SanteAlerta v-if="problemaArquivo" :texto="problemaArquivo" variante="alerta" />
      <div class="acoes">
        <SanteBotao
          :rotulo="enviando ? t('receber.enviando') : t('receber.enviar')"
          :desabilitado="!arquivo || !!problemaArquivo || enviando"
          data-testid="troca-enviar"
          @acionar="receber"
        />
      </div>

      <div v-if="recusa" data-testid="troca-recusa">
        <SanteAlerta :texto="recusa" variante="alerta" />
        <template v-if="errosXsd.length">
          <p class="secundario">{{ t('receber.errosXsd') }}</p>
          <ul class="secundario" data-testid="troca-erros-xsd">
            <li v-for="(x, i) in errosXsd" :key="i">{{ x }}</li>
          </ul>
        </template>
      </div>
      <MensagemErro v-if="erro" :erro="erro" />

      <div v-if="resultado" role="status" data-testid="troca-resultado" :data-situacao="resultado.situacao">
        <SanteAlerta
          :texto="t(`resultado.${resultado.situacao}`) + ' ' + rotulo('tipos', resultado.tipo) + '.'"
          :variante="resultado.situacao === 'processada' ? 'info' : 'aviso'"
        />
        <p v-if="resultado.protocolo" data-testid="troca-protocolo">
          {{ t('resultado.protocolo', { protocolo: resultado.protocolo }) }}
        </p>
        <template v-if="resultado.motivos.length">
          <p>{{ t('resultado.motivos') }}</p>
          <ul data-testid="troca-motivos">
            <li v-for="(m, i) in resultado.motivos" :key="i">{{ m }}</li>
          </ul>
        </template>
        <p v-if="resultado.comunicacao" data-testid="troca-comunicacao">
          {{
            resultado.comunicacao.beneficiarioIdentificado
              ? t('resultado.identificado')
              : t('resultado.naoIdentificado')
          }}
        </p>
        <table v-if="resultado.guias?.length" class="tabela" data-testid="troca-guias">
          <caption class="visualmente-oculto">
            {{
              t('tipos.cancelamento_guia')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('resultado.guia') }}</th>
              <th scope="col">{{ t('resultado.resultadoGuia') }}</th>
              <th scope="col">{{ t('resultado.observacao') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="g in resultado.guias" :key="g.numeroGuiaPrestador">
              <td>{{ g.numeroGuiaPrestador }}</td>
              <td :data-resultado="g.resultado">{{ rotulo('resultado.guias', g.resultado) }}</td>
              <td>{{ g.observacao ?? '' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="bloco" aria-labelledby="ope-troca-lista">
      <h2 id="ope-troca-lista">{{ t('titulo') }}</h2>
      <div class="campos" data-testid="troca-filtro">
        <SanteSelecao
          v-model="tipo"
          :rotulo="t('filtro.tipo')"
          :opcoes="opcoesTipo"
          data-testid="troca-filtro-tipo"
        />
        <SanteSelecao
          v-model="direcao"
          :rotulo="t('filtro.direcao')"
          :opcoes="opcoesDirecao"
          data-testid="troca-filtro-direcao"
        />
      </div>
      <MensagemErro v-if="lista.isError.value" :erro="lista.error.value" />
      <p v-else-if="!lista.data.value" role="status">{{ t('carregando') }}</p>
      <p v-else-if="lista.data.value.length === 0" data-testid="troca-vazia">{{ t('nenhuma') }}</p>
      <table v-else class="tabela" data-testid="troca-lista">
        <caption class="visualmente-oculto">
          {{
            t('titulo')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('colunas.quando') }}</th>
            <th scope="col">{{ t('colunas.direcao') }}</th>
            <th scope="col">{{ t('colunas.tipo') }}</th>
            <th scope="col">{{ t('colunas.prestador') }}</th>
            <th scope="col">{{ t('colunas.sequencial') }}</th>
            <th scope="col">{{ t('colunas.protocolo') }}</th>
            <th scope="col">{{ t('colunas.situacao') }}</th>
            <th scope="col">{{ t('colunas.motivo') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in lista.data.value" :key="x.id" :data-testid="`troca-${x.id}`">
            <td>{{ quando(x.registradaEm) }}</td>
            <td>{{ rotulo('direcoes', x.direcao) }}</td>
            <td>{{ rotulo('tipos', x.tipo) }}</td>
            <td>{{ x.prestador ?? '' }}</td>
            <td>{{ x.sequencial ?? '' }}</td>
            <td>{{ x.protocolo ?? '' }}</td>
            <td :data-situacao="x.situacao">{{ rotulo('situacoes', x.situacao) }}</td>
            <td>{{ x.mensagemErro ?? '' }}</td>
          </tr>
        </tbody>
      </table>
    </section>
  </section>
</template>

<style scoped src="../estilo-operadora.css"></style>
<style scoped>
.campo {
  display: grid;
  gap: 0.25rem;
}
.campo input {
  min-height: 24px;
}
</style>
