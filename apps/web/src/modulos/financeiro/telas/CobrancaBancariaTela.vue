<script setup lang="ts">
// F7, 07-FIN linha 78: `/financeiro/receber/cobranca-bancaria`. A cobrança com boleto numa tela só, por carteira:
// - Boletos: busca as parcelas em aberto pelo pagador ou título, marca várias e emite de uma vez (o pagador sem CPF ou
//   CNPJ no cadastro é informado na hora, conferido a cada tecla); a lista dos boletos traz a linha digitável, a
//   impressão (código de barras intercalado 2 de 5 em SVG, impressa ou salva em PDF pela janela de impressão) e o
//   cancelamento com motivo.
// - Remessa: um clique gera o CNAB 240 com o que aguarda (registro e pedidos de baixa) e a mensagem ao pagador.
// - Retorno: o arquivo é conferido na hora pela mesma regra do servidor; fora de produção, o simulador do banco.
// - Carteiras: o cadastro conferido a cada tecla (faixa do nosso número, código, tarifa).
import { conferirCarteira, lerRetornoCobranca240, retornoCobrancaRecusado } from '@sgh/dominio-financeiro';
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../../faturamento/componentes/MensagemFaturamento.vue';
import { novaChave } from '../api-financeiro.js';
import {
  type BoletoImpressao,
  type BoletoTela,
  cancelarBoleto,
  emitirBoletos,
  gerarRemessaCobranca,
  lerArquivoRemessa,
  lerBoletoImpressao,
  lerBoletos,
  lerCarteirasCobranca,
  lerParcelasParaBoleto,
  lerRemessasCobranca,
  lerRetornoCobrancaSimulado,
  lerRetornosCobranca,
  manterCarteiraCobranca,
  processarRetornoCobranca,
} from '../api-cobranca-bancaria.js';
import { barrasItf, linhaDigitavelFormatada } from '../codigo-barras-itf.js';
import { data, opcoesContas, reais, usarFinanceiro } from '../usar-financeiro.js';

const { t, te } = useI18n();
const situacaoRetorno = (s: string) =>
  te(`financeiro.cobranca.retorno.situacoes.${s}`) ? t(`financeiro.cobranca.retorno.situacoes.${s}`) : s;
const qc = useQueryClient();
const rota = useRoute();
const { apoio, gravacao, tem } = usarFinanceiro();
const podeEmitir = computed(() => tem('financeiro.cobrancaBancaria.emitir'));
const podeConfigurar = computed(() => tem('financeiro.cobrancaBancaria.configurar'));
const podeBaixar = computed(() => tem('financeiro.tituloReceber.baixar'));
const simulador = computed(() => gravacao.data.value?.destinoExterno === 'simulador');

type Aba = 'boletos' | 'remessa' | 'retorno' | 'carteiras';
const ABAS: readonly Aba[] = ['boletos', 'remessa', 'retorno', 'carteiras'];
const aba = ref<Aba>(ABAS.includes(rota.query['aba'] as Aba) ? (rota.query['aba'] as Aba) : 'boletos');
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const gravando = ref(false);
async function gravar(fn: () => Promise<{ mensagem: string }>, depois: () => Promise<unknown>) {
  erro.value = null;
  mensagem.value = null;
  gravando.value = true;
  try {
    mensagem.value = (await fn()).mensagem;
    await depois();
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
function trocarAba(a: Aba) {
  aba.value = a;
  erro.value = null;
  mensagem.value = null;
}
const recarregar = () => qc.invalidateQueries({ queryKey: ['financeiro'] });

// ── Carteira escolhida (vale para todas as abas) ──
const carteiras = useQuery({
  queryKey: ['financeiro', 'cobranca-bancaria', 'carteiras'],
  queryFn: () => lerCarteirasCobranca(),
});
const ativas = computed(() => (carteiras.data.value ?? []).filter((c) => c.ativo));
const carteira = ref('');
watch(
  ativas,
  (lista) => {
    // Uma carteira só: já vem escolhida.
    if (!carteira.value && lista.length === 1) carteira.value = String(lista[0]?.id);
  },
  { immediate: true },
);
const carteiraAtual = computed(() => ativas.value.find((c) => String(c.id) === carteira.value) ?? null);
const opcoesCarteira = computed(() => [
  { valor: '', rotulo: t('financeiro.escolha') },
  ...ativas.value.map((c) => ({
    valor: String(c.id),
    rotulo: `${c.descricao} · ${c.contaNome} · ${t('financeiro.cobranca.remessa.aguardando', { n: c.aguardandoRemessa })}`,
  })),
]);

// ── Boletos: parcelas e emissão em lote ──
const busca = ref('');
const buscaAplicada = ref('');
let atraso: ReturnType<typeof setTimeout> | undefined;
watch(busca, (v) => {
  clearTimeout(atraso);
  atraso = setTimeout(() => (buscaAplicada.value = v.trim()), 300);
});
const parcelas = useQuery({
  queryKey: computed(() => ['financeiro', 'cobranca-bancaria', 'parcelas', buscaAplicada.value]),
  queryFn: () => lerParcelasParaBoleto(buscaAplicada.value),
  enabled: computed(() => aba.value === 'boletos'),
});
const semBoleto = computed(() => (parcelas.data.value ?? []).filter((p) => !p.temBoleto));
const marcadas = reactive(new Set<number>());
const selecionadas = computed(() => semBoleto.value.filter((p) => marcadas.has(p.parcela)));
const totalMarcado = computed(() => selecionadas.value.reduce((s, p) => s + p.saldo, 0));
const pagadores = computed(() => new Set(selecionadas.value.map((p) => p.pagador)));
const faltaDocumento = computed(() => selecionadas.value.some((p) => !p.temDocumento));
function alternar(id: number) {
  if (marcadas.has(id)) marcadas.delete(id);
  else marcadas.add(id);
}
const pagadorNaHora = reactive({ documento: '', nome: '' });
const documentoDigitos = computed(() => pagadorNaHora.documento.replace(/\D/g, ''));
/** A recusa da emissão, na hora, antes de enviar. */
const recusaEmissao = computed(() => {
  if (!faltaDocumento.value) return null;
  if (pagadores.value.size > 1) return t('financeiro.cobranca.boletos.outroPagador');
  if (documentoDigitos.value.length !== 11 && documentoDigitos.value.length !== 14)
    return t('financeiro.cobranca.boletos.documentoInvalido');
  return null;
});
const emitir = () =>
  gravar(
    () =>
      emitirBoletos(
        {
          carteira: Number(carteira.value),
          parcelas: selecionadas.value.map((p) => p.parcela),
          pagadorDocumento: faltaDocumento.value ? documentoDigitos.value : null,
          pagadorNome: faltaDocumento.value && pagadorNaHora.nome.trim() ? pagadorNaHora.nome.trim() : null,
        },
        novaChave('emitir-boletos'),
      ),
    async () => {
      marcadas.clear();
      Object.assign(pagadorNaHora, { documento: '', nome: '' });
      await recarregar();
    },
  );

// ── Boletos emitidos ──
const SITUACOES = [
  'emitido',
  'registrado',
  'rejeitado',
  'pago',
  'baixado',
  'cancelado',
  'protestado',
] as const;
const filtroSituacao = ref('');
const opcoesSituacao = computed(() => [
  { valor: '', rotulo: t('financeiro.todas') },
  ...SITUACOES.map((s) => ({ valor: s, rotulo: t(`financeiro.cobranca.situacoes.${s}`) })),
]);
const boletos = useQuery({
  queryKey: computed(() => [
    'financeiro',
    'cobranca-bancaria',
    'boletos',
    carteira.value,
    filtroSituacao.value,
    buscaAplicada.value,
  ]),
  queryFn: () =>
    lerBoletos({
      carteira: Number(carteira.value) || null,
      situacao: filtroSituacao.value || null,
      busca: buscaAplicada.value,
    }),
  enabled: computed(() => aba.value === 'boletos'),
});
const cancelando = ref<BoletoTela | null>(null);
const motivoCancelamento = ref('');
function pedirCancelamento(b: BoletoTela) {
  cancelando.value = b;
  motivoCancelamento.value = '';
}
const cancelar = () =>
  gravar(
    () =>
      cancelarBoleto(
        { boleto: cancelando.value?.id ?? 0, motivo: motivoCancelamento.value.trim() },
        novaChave('cancelar-boleto'),
      ),
    async () => {
      cancelando.value = null;
      await recarregar();
    },
  );

// ── Impressão ──
const impressao = ref<BoletoImpressao | null>(null);
const barras = computed(() => (impressao.value ? barrasItf(impressao.value.codigoBarras) : null));
const folha = ref<HTMLElement | null>(null);
async function abrirImpressao(b: BoletoTela) {
  erro.value = null;
  try {
    impressao.value = await lerBoletoImpressao(b.id);
  } catch (e) {
    erro.value = e;
  }
}
/** Abre a janela de impressão só com o boleto (o navegador imprime ou salva em PDF). */
function imprimir() {
  const html = folha.value?.outerHTML;
  const janela = html ? window.open('', '_blank', 'width=900,height=700') : null;
  if (!janela || !html) return;
  janela.document.title = t('financeiro.cobranca.impressao.titulo', {
    nossoNumero: impressao.value?.nossoNumero ?? '',
  });
  janela.document.body.innerHTML = html;
  const estilo = janela.document.createElement('style');
  estilo.textContent =
    'body{font-family:sans-serif;font-size:12px}table{width:100%;border-collapse:collapse}' +
    'td,th{border:1px solid;padding:4px;text-align:left;vertical-align:top}svg{display:block}';
  janela.document.head.appendChild(estilo);
  janela.focus();
  janela.print();
}

// ── Remessa ──
const remessas = useQuery({
  queryKey: computed(() => ['financeiro', 'cobranca-bancaria', 'remessas', carteira.value]),
  queryFn: () => lerRemessasCobranca(Number(carteira.value)),
  enabled: computed(() => aba.value === 'remessa' && Number(carteira.value) > 0),
});
const mensagemRemessa = ref('');
const gerarRemessa = () =>
  gravar(
    () =>
      gerarRemessaCobranca(
        { carteira: Number(carteira.value), mensagem: mensagemRemessa.value.trim() || null },
        novaChave('remessa-cobranca'),
      ),
    async () => {
      mensagemRemessa.value = '';
      await recarregar();
    },
  );
async function baixarArquivo(remessa: number) {
  erro.value = null;
  try {
    const a = await lerArquivoRemessa(remessa);
    if (!a.conferido) {
      mensagem.value = t('financeiro.cobranca.remessa.naoConfere');
      return;
    }
    const url = URL.createObjectURL(new Blob([a.conteudo], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = a.nomeArquivo;
    link.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    erro.value = e;
  }
}

// ── Retorno ──
const retornos = useQuery({
  queryKey: computed(() => ['financeiro', 'cobranca-bancaria', 'retornos', carteira.value]),
  queryFn: () => lerRetornosCobranca(Number(carteira.value)),
  enabled: computed(() => aba.value === 'retorno' && Number(carteira.value) > 0),
});
const arquivo = reactive({ nome: '', conteudo: '' });
/** A mesma leitura do servidor, na hora: o banco é o do próprio cabeçalho (o servidor confere com o da carteira). */
const conferenciaArquivo = computed(() => {
  if (!arquivo.conteudo) return null;
  const banco = Number(arquivo.conteudo.slice(0, 3));
  const r = lerRetornoCobranca240(arquivo.conteudo, Number.isInteger(banco) ? banco : -1);
  if (retornoCobrancaRecusado(r)) return { ok: false as const, motivo: r.mensagem };
  return {
    ok: true as const,
    linhas: arquivo.conteudo.split(/\r?\n/).filter((l) => l.length > 0).length,
    titulos: new Set(r.linhas.map((l) => l.nossoNumero)).size,
  };
});
async function escolherArquivo(ev: Event) {
  const f = (ev.target as HTMLInputElement).files?.[0];
  arquivo.nome = f?.name ?? '';
  arquivo.conteudo = f ? await f.text() : '';
}
async function usarSimulador() {
  erro.value = null;
  try {
    const r = await lerRetornoCobrancaSimulado(Number(carteira.value));
    arquivo.nome = r.nomeArquivo;
    arquivo.conteudo = r.conteudo;
  } catch (e) {
    erro.value = e;
  }
}
const processar = () =>
  gravar(
    () =>
      processarRetornoCobranca(
        { carteira: Number(carteira.value), nomeArquivo: arquivo.nome, conteudo: arquivo.conteudo },
        novaChave('retorno-cobranca'),
      ),
    async () => {
      arquivo.nome = '';
      arquivo.conteudo = '';
      await recarregar();
    },
  );

// ── Carteiras ──
const contas = computed(() => opcoesContas(apoio.data.value?.contas, t('financeiro.escolha')));
const vazio = () => ({
  conta: '',
  descricao: '',
  codigoCarteira: '',
  variacaoCarteira: '',
  codigoBeneficiario: '',
  convenio: '',
  nossoNumeroInicial: '1',
  nossoNumeroFinal: '',
  diasCompensacao: '1',
  valorTarifa: '',
  localPagamento: '',
});
const form = reactive(vazio());
const inteiro = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v.trim()) : Number.NaN);
const dadosCarteira = computed(() => ({
  conta: Number(form.conta),
  descricao: form.descricao.trim(),
  codigoCarteira: form.codigoCarteira.trim(),
  variacaoCarteira: form.variacaoCarteira.trim() || null,
  codigoBeneficiario: form.codigoBeneficiario.trim(),
  convenio: form.convenio.trim() || null,
  nossoNumeroInicial: inteiro(form.nossoNumeroInicial),
  nossoNumeroFinal: inteiro(form.nossoNumeroFinal),
  diasCompensacao: inteiro(form.diasCompensacao),
  valorTarifa: form.valorTarifa.trim() ? Number(form.valorTarifa.replace(',', '.')) : null,
  localPagamento: form.localPagamento.trim() || null,
}));
/** A regra do servidor a cada tecla: a recusa aparece antes de gravar. */
const recusaCarteira = computed(() => {
  const preenchido =
    form.descricao || form.codigoCarteira || form.codigoBeneficiario || form.nossoNumeroFinal;
  if (!preenchido) return null;
  return conferirCarteira(dadosCarteira.value)?.mensagem ?? null;
});
const incluirCarteira = () =>
  gravar(
    () => manterCarteiraCobranca({ acao: 'incluir', ...dadosCarteira.value }, novaChave('carteira-cobranca')),
    async () => {
      Object.assign(form, vazio());
      await recarregar();
    },
  );
const desativarCarteira = (id: number) =>
  gravar(
    () => manterCarteiraCobranca({ acao: 'desativar', carteira: id }, novaChave('carteira-cobranca')),
    recarregar,
  );
</script>

<template>
  <section class="tela-agenda" aria-labelledby="cb-titulo" data-testid="tela-fin-cobranca-bancaria">
    <h1 id="cb-titulo">{{ t('financeiro.cobranca.titulo') }}</h1>
    <p>{{ t('financeiro.cobranca.texto') }}</p>
    <p v-if="simulador" class="secundario" data-testid="cb-simulador">{{ t('financeiro.simulador') }}</p>
    <div class="filtros" role="group" :aria-label="t('financeiro.cobranca.titulo')">
      <button
        v-for="a in ABAS"
        :key="a"
        type="button"
        :aria-pressed="aba === a"
        :data-testid="`cb-aba-${a}`"
        @click="trocarAba(a)"
      >
        {{ t(`financeiro.cobranca.abas.${a}`) }}
      </button>
    </div>
    <ErroFaturamento v-if="erro" :erro="erro" />
    <MensagemFaturamento :texto="mensagem" testid="cb-mensagem" />
    <ErroFaturamento v-if="carteiras.error.value" :erro="carteiras.error.value" />

    <div v-if="aba !== 'carteiras'" class="filtros">
      <span class="campo">
        <SanteSelecao
          v-model="carteira"
          :rotulo="t('financeiro.cobranca.carteira')"
          :opcoes="opcoesCarteira"
          obrigatorio
          data-testid="cb-carteira"
        />
      </span>
      <p v-if="carteiras.data.value && !ativas.length" class="secundario" data-testid="cb-sem-carteira">
        {{ t('financeiro.cobranca.semCarteira') }}
      </p>
    </div>

    <!-- ── Boletos ── -->
    <template v-if="aba === 'boletos'">
      <h2>{{ t('financeiro.cobranca.boletos.parcelas') }}</h2>
      <div class="filtros">
        <span class="campo">
          <label for="cb-busca">{{ t('financeiro.cobranca.boletos.buscar') }}</label>
          <input id="cb-busca" v-model="busca" type="search" data-testid="cb-busca" />
        </span>
      </div>
      <ErroFaturamento v-if="parcelas.error.value" :erro="parcelas.error.value" />
      <table v-else-if="semBoleto.length" class="tabela" data-testid="cb-parcelas">
        <thead>
          <tr>
            <th scope="col">{{ t('financeiro.marcar') }}</th>
            <th scope="col">{{ t('financeiro.cobranca.boletos.pagador') }}</th>
            <th scope="col">{{ t('financeiro.cobranca.boletos.titulo') }}</th>
            <th scope="col">{{ t('financeiro.vencimento') }}</th>
            <th scope="col">{{ t('financeiro.valor') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in semBoleto" :key="p.parcela" :data-testid="`cb-parcela-${p.parcela}`">
            <td>
              <input
                type="checkbox"
                :checked="marcadas.has(p.parcela)"
                :aria-label="`${t('financeiro.marcar')} ${p.titulo}/${p.sequencia}`"
                :data-testid="`cb-marcar-${p.parcela}`"
                @change="alternar(p.parcela)"
              />
            </td>
            <td>
              {{ p.pagador }}
              <small v-if="!p.temDocumento" class="secundario">
                ({{ t('financeiro.cobranca.boletos.semDocumento') }})
              </small>
            </td>
            <td>{{ p.titulo }}/{{ p.sequencia }}</td>
            <td>{{ p.vencimento ? data(p.vencimento) : '' }}</td>
            <td>{{ reais(p.saldo) }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else data-testid="cb-sem-parcela">{{ t('financeiro.cobranca.boletos.nenhumaParcela') }}</p>
      <form class="filtros" @submit.prevent="emitir">
        <template v-if="faltaDocumento">
          <p class="secundario" data-testid="cb-falta-documento">
            {{ t('financeiro.cobranca.boletos.faltaDocumento') }}
          </p>
          <span class="campo">
            <label for="cb-pagador-doc">{{ t('financeiro.cobranca.boletos.pagadorDocumento') }}</label>
            <input
              id="cb-pagador-doc"
              v-model="pagadorNaHora.documento"
              inputmode="numeric"
              maxlength="18"
              data-testid="cb-pagador-documento"
            />
          </span>
          <span class="campo">
            <label for="cb-pagador-nome">{{ t('financeiro.cobranca.boletos.pagadorNome') }}</label>
            <input
              id="cb-pagador-nome"
              v-model="pagadorNaHora.nome"
              maxlength="150"
              data-testid="cb-pagador-nome"
            />
          </span>
        </template>
        <button
          type="submit"
          :disabled="
            gravando ||
            !podeEmitir ||
            !Number(carteira) ||
            selecionadas.length === 0 ||
            recusaEmissao !== null
          "
          data-testid="cb-emitir"
        >
          {{ t('financeiro.cobranca.boletos.emitir') }}
        </button>
      </form>
      <p role="status" data-testid="cb-total-marcado">
        {{ t('financeiro.cobranca.boletos.marcado', { n: selecionadas.length, total: reais(totalMarcado) }) }}
      </p>
      <p v-if="recusaEmissao" role="alert" data-testid="cb-recusa-emissao">{{ recusaEmissao }}</p>

      <h2>{{ t('financeiro.cobranca.boletos.emitidos') }}</h2>
      <div class="filtros">
        <span class="campo">
          <SanteSelecao
            v-model="filtroSituacao"
            :rotulo="t('financeiro.cobranca.boletos.filtroSituacao')"
            :opcoes="opcoesSituacao"
            data-testid="cb-filtro-situacao"
          />
        </span>
      </div>
      <ErroFaturamento v-if="boletos.error.value" :erro="boletos.error.value" />
      <table v-else-if="boletos.data.value?.length" class="tabela" data-testid="cb-boletos">
        <thead>
          <tr>
            <th scope="col">{{ t('financeiro.cobranca.boletos.nossoNumero') }}</th>
            <th scope="col">{{ t('financeiro.cobranca.boletos.pagador') }}</th>
            <th scope="col">{{ t('financeiro.vencimento') }}</th>
            <th scope="col">{{ t('financeiro.valor') }}</th>
            <th scope="col">{{ t('financeiro.situacao') }}</th>
            <th scope="col">{{ t('financeiro.cobranca.boletos.linhaDigitavel') }}</th>
            <th scope="col">{{ t('financeiro.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="b in boletos.data.value"
            :key="b.id"
            :data-testid="`cb-boleto-${b.id}`"
            :data-situacao="b.situacao"
          >
            <td>{{ b.nossoNumero }}</td>
            <td>{{ b.pagador }}</td>
            <td>{{ b.vencimento ? data(b.vencimento) : '' }}</td>
            <td>{{ reais(b.valor) }}</td>
            <td>
              {{ t(`financeiro.cobranca.situacoes.${b.situacao}`) }}
              <small v-if="b.dataPagamento && b.valorPago !== null" class="secundario">
                ({{
                  t('financeiro.cobranca.boletos.pagoEm', {
                    data: data(b.dataPagamento),
                    valor: reais(b.valorPago),
                  })
                }})
              </small>
              <small v-if="b.motivoCancelamento" class="secundario">({{ b.motivoCancelamento }})</small>
            </td>
            <td>
              <code>{{ linhaDigitavelFormatada(b.linhaDigitavel) }}</code>
            </td>
            <td>
              <button
                v-if="b.situacao !== 'cancelado'"
                type="button"
                :data-testid="`cb-imprimir-${b.id}`"
                @click="abrirImpressao(b)"
              >
                {{ t('financeiro.cobranca.boletos.imprimir') }}
              </button>
              <button
                v-if="podeEmitir && (b.situacao === 'emitido' || b.situacao === 'registrado')"
                type="button"
                :data-testid="`cb-cancelar-${b.id}`"
                @click="pedirCancelamento(b)"
              >
                {{ t('financeiro.cobranca.boletos.cancelar') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else data-testid="cb-sem-boleto">{{ t('financeiro.cobranca.boletos.nenhum') }}</p>

      <form
        v-if="cancelando"
        class="filtros"
        :aria-label="t('financeiro.cobranca.boletos.confirmarCancelamento')"
        data-testid="cb-cancelamento"
        @submit.prevent="cancelar"
      >
        <span class="campo">
          <label for="cb-motivo">
            {{ t('financeiro.cobranca.boletos.motivo') }} ({{ cancelando.nossoNumero }})
          </label>
          <input id="cb-motivo" v-model="motivoCancelamento" maxlength="500" data-testid="cb-motivo" />
        </span>
        <small v-if="motivoCancelamento.trim().length < 5" class="secundario">
          {{ t('financeiro.cobranca.boletos.motivoCurto') }}
        </small>
        <button
          type="submit"
          :disabled="gravando || motivoCancelamento.trim().length < 5"
          data-testid="cb-confirmar-cancelamento"
        >
          {{ t('financeiro.cobranca.boletos.confirmarCancelamento') }}
        </button>
        <button type="button" data-testid="cb-desistir" @click="cancelando = null">
          {{ t('financeiro.cobranca.boletos.desistir') }}
        </button>
      </form>

      <section v-if="impressao" aria-labelledby="cb-impressao-titulo" data-testid="cb-impressao">
        <h2 id="cb-impressao-titulo">
          {{ t('financeiro.cobranca.impressao.titulo', { nossoNumero: impressao.nossoNumero }) }}
        </h2>
        <div class="filtros">
          <button type="button" data-testid="cb-imprimir-janela" @click="imprimir">
            {{ t('financeiro.cobranca.impressao.imprimir') }}
          </button>
          <button type="button" data-testid="cb-fechar-impressao" @click="impressao = null">
            {{ t('financeiro.cobranca.impressao.fechar') }}
          </button>
        </div>
        <div ref="folha">
          <p>
            <strong>{{ t('financeiro.cobranca.impressao.reciboPagador') }}</strong> ·
            {{ impressao.bancoNome }} | {{ impressao.banco }}
          </p>
          <table class="tabela">
            <tbody>
              <tr>
                <th scope="row">{{ t('financeiro.cobranca.impressao.beneficiario') }}</th>
                <td>{{ impressao.beneficiario }} ({{ impressao.beneficiarioDocumento }})</td>
                <th scope="row">{{ t('financeiro.cobranca.impressao.vencimento') }}</th>
                <td>{{ impressao.vencimento ? data(impressao.vencimento) : '' }}</td>
              </tr>
              <tr>
                <th scope="row">{{ t('financeiro.cobranca.impressao.pagador') }}</th>
                <td>{{ impressao.pagador }} ({{ impressao.pagadorDocumento }})</td>
                <th scope="row">{{ t('financeiro.cobranca.impressao.valor') }}</th>
                <td data-testid="cb-impressao-valor">{{ reais(impressao.valor) }}</td>
              </tr>
            </tbody>
          </table>
          <p>
            <strong>{{ t('financeiro.cobranca.impressao.fichaCompensacao') }}</strong> ·
            {{ impressao.banco }} ·
            <code data-testid="cb-impressao-linha">{{
              linhaDigitavelFormatada(impressao.linhaDigitavel)
            }}</code>
          </p>
          <table class="tabela">
            <tbody>
              <tr>
                <th scope="row">{{ t('financeiro.cobranca.impressao.local') }}</th>
                <td>{{ impressao.localPagamento }}</td>
                <th scope="row">{{ t('financeiro.cobranca.impressao.vencimento') }}</th>
                <td>{{ impressao.vencimento ? data(impressao.vencimento) : '' }}</td>
              </tr>
              <tr>
                <th scope="row">{{ t('financeiro.cobranca.impressao.beneficiario') }}</th>
                <td>{{ impressao.beneficiario }}</td>
                <th scope="row">{{ t('financeiro.cobranca.impressao.agenciaCodigo') }}</th>
                <td>{{ impressao.agenciaCodigo }}</td>
              </tr>
              <tr>
                <th scope="row">{{ t('financeiro.cobranca.impressao.documento') }}</th>
                <td>{{ impressao.documento }}</td>
                <th scope="row">{{ t('financeiro.cobranca.boletos.nossoNumero') }}</th>
                <td>{{ impressao.carteira }}/{{ impressao.nossoNumero }}</td>
              </tr>
              <tr>
                <th scope="row">{{ t('financeiro.cobranca.impressao.emissao') }}</th>
                <td>{{ impressao.emissao ? data(impressao.emissao) : '' }}</td>
                <th scope="row">{{ t('financeiro.cobranca.impressao.valor') }}</th>
                <td>{{ reais(impressao.valor) }}</td>
              </tr>
              <tr>
                <th scope="row">{{ t('financeiro.cobranca.impressao.instrucoes') }}</th>
                <td colspan="3">
                  <span v-for="(i, n) in impressao.instrucoes" :key="n">{{ i }}<br /></span>
                </td>
              </tr>
              <tr>
                <th scope="row">{{ t('financeiro.cobranca.impressao.pagador') }}</th>
                <td colspan="3">{{ impressao.pagador }} ({{ impressao.pagadorDocumento }})</td>
              </tr>
            </tbody>
          </table>
          <svg
            v-if="barras"
            role="img"
            :aria-label="t('financeiro.cobranca.impressao.barras')"
            :viewBox="`0 0 ${barras.largura} 50`"
            preserveAspectRatio="none"
            width="412"
            height="50"
            data-testid="cb-codigo-barras"
          >
            <rect
              v-for="(b, n) in barras.barras"
              :key="n"
              :x="b.x"
              y="0"
              :width="b.largura"
              height="50"
              fill="currentColor"
            />
          </svg>
        </div>
      </section>
    </template>

    <!-- ── Remessa ── -->
    <template v-else-if="aba === 'remessa'">
      <h2>{{ t('financeiro.cobranca.abas.remessa') }}</h2>
      <form class="filtros" @submit.prevent="gerarRemessa">
        <p v-if="carteiraAtual" role="status" data-testid="cb-aguardando">
          {{ t('financeiro.cobranca.remessa.aguardando', { n: carteiraAtual.aguardandoRemessa }) }}
        </p>
        <span class="campo">
          <label for="cb-mensagem-remessa">{{ t('financeiro.cobranca.remessa.mensagem') }}</label>
          <input
            id="cb-mensagem-remessa"
            v-model="mensagemRemessa"
            maxlength="80"
            data-testid="cb-mensagem-remessa"
          />
        </span>
        <button
          type="submit"
          :disabled="gravando || !podeEmitir || !Number(carteira)"
          data-testid="cb-gerar-remessa"
        >
          {{ t('financeiro.cobranca.remessa.gerar') }}
        </button>
      </form>
      <template v-if="Number(carteira)">
        <h3>{{ t('financeiro.cobranca.remessa.lista') }}</h3>
        <ErroFaturamento v-if="remessas.error.value" :erro="remessas.error.value" />
        <table v-else-if="remessas.data.value?.length" class="tabela" data-testid="cb-remessas">
          <thead>
            <tr>
              <th scope="col">{{ t('financeiro.cobranca.remessa.sequencial') }}</th>
              <th scope="col">{{ t('financeiro.cobranca.remessa.gerada') }}</th>
              <th scope="col">{{ t('financeiro.cobranca.remessa.titulos') }}</th>
              <th scope="col">{{ t('financeiro.valor') }}</th>
              <th scope="col">{{ t('financeiro.cobranca.remessa.rejeitados') }}</th>
              <th scope="col">{{ t('financeiro.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in remessas.data.value" :key="r.id" :data-testid="`cb-remessa-${r.id}`">
              <td>{{ r.sequencial }}</td>
              <td>{{ r.geradaEm ? data(r.geradaEm) : '' }} {{ r.por }}</td>
              <td>{{ r.titulos }}</td>
              <td>{{ reais(r.valor) }}</td>
              <td>{{ r.rejeitados }}</td>
              <td>
                <button type="button" :data-testid="`cb-baixar-remessa-${r.id}`" @click="baixarArquivo(r.id)">
                  {{ t('financeiro.cobranca.remessa.baixar') }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else data-testid="cb-sem-remessa">{{ t('financeiro.cobranca.remessa.nenhuma') }}</p>
      </template>
    </template>

    <!-- ── Retorno ── -->
    <template v-else-if="aba === 'retorno'">
      <h2>{{ t('financeiro.cobranca.abas.retorno') }}</h2>
      <form class="filtros" @submit.prevent="processar">
        <span class="campo">
          <label for="cb-arquivo">{{ t('financeiro.cobranca.retorno.arquivo') }}</label>
          <input
            id="cb-arquivo"
            type="file"
            accept=".ret,.txt,text/plain"
            data-testid="cb-arquivo"
            @change="escolherArquivo"
          />
        </span>
        <button
          v-if="simulador"
          type="button"
          :disabled="!Number(carteira)"
          data-testid="cb-usar-simulador"
          @click="usarSimulador"
        >
          {{ t('financeiro.cobranca.retorno.simulador') }}
        </button>
        <button
          type="submit"
          :disabled="gravando || !podeBaixar || !Number(carteira) || !conferenciaArquivo?.ok"
          data-testid="cb-processar"
        >
          {{ t('financeiro.cobranca.retorno.processar') }}
        </button>
      </form>
      <p v-if="conferenciaArquivo?.ok" class="secundario" role="status" data-testid="cb-arquivo-ok">
        {{
          t('financeiro.cobranca.retorno.escolhido', {
            nome: arquivo.nome,
            linhas: conferenciaArquivo.linhas,
            titulos: conferenciaArquivo.titulos,
          })
        }}
      </p>
      <p v-else-if="conferenciaArquivo" role="alert" data-testid="cb-arquivo-recusado">
        {{ t('financeiro.cobranca.retorno.recusado', { motivo: conferenciaArquivo.motivo }) }}
      </p>
      <template v-if="Number(carteira)">
        <h3>{{ t('financeiro.cobranca.retorno.lidos') }}</h3>
        <ErroFaturamento v-if="retornos.error.value" :erro="retornos.error.value" />
        <p v-else-if="!retornos.data.value?.length" data-testid="cb-sem-retorno">
          {{ t('financeiro.cobranca.retorno.nenhum') }}
        </p>
        <div v-for="r in retornos.data.value ?? []" :key="r.id" :data-testid="`cb-retorno-${r.id}`">
          <p data-testid="cb-retorno-resumo">
            {{
              t('financeiro.cobranca.retorno.resumo', {
                arquivo: r.arquivo,
                liquidados: r.liquidados,
                rejeitados: r.rejeitados,
                registros: r.registros,
                total: reais(r.total),
                tarifas: reais(r.tarifas),
              })
            }}
          </p>
          <table class="tabela">
            <thead>
              <tr>
                <th scope="col">{{ t('financeiro.cobranca.boletos.nossoNumero') }}</th>
                <th scope="col">{{ t('financeiro.cobranca.boletos.pagador') }}</th>
                <th scope="col">{{ t('financeiro.cobranca.retorno.ocorrencia') }}</th>
                <th scope="col">{{ t('financeiro.cobranca.retorno.situacao') }}</th>
                <th scope="col">{{ t('financeiro.cobranca.retorno.data') }}</th>
                <th scope="col">{{ t('financeiro.cobranca.retorno.valorTitulo') }}</th>
                <th scope="col">{{ t('financeiro.cobranca.retorno.valorPago') }}</th>
                <th scope="col">{{ t('financeiro.cobranca.retorno.tarifa') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="i in r.itens" :key="i.sequencia" :data-situacao="i.situacao">
                <td>{{ i.nossoNumero }}</td>
                <td>{{ i.pagador }}</td>
                <td>
                  {{ i.ocorrencia }} — {{ i.descricao }}<template v-if="i.motivo"> ({{ i.motivo }})</template>
                </td>
                <td>{{ situacaoRetorno(i.situacao) }}</td>
                <td>{{ i.dataPagamento ? data(i.dataPagamento) : '' }}</td>
                <td>{{ i.valorTitulo === null ? '' : reais(i.valorTitulo) }}</td>
                <td>{{ reais(i.valorPago) }}</td>
                <td>{{ reais(i.tarifa) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </template>

    <!-- ── Carteiras ── -->
    <template v-else>
      <h2>{{ t('financeiro.cobranca.carteiras.lista') }}</h2>
      <table v-if="carteiras.data.value?.length" class="tabela" data-testid="cb-carteiras">
        <thead>
          <tr>
            <th scope="col">{{ t('financeiro.cobranca.carteiras.descricao') }}</th>
            <th scope="col">{{ t('financeiro.cobranca.carteiras.conta') }}</th>
            <th scope="col">{{ t('financeiro.cobranca.carteiras.faixa') }}</th>
            <th scope="col">{{ t('financeiro.cobranca.carteiras.tarifa') }}</th>
            <th scope="col">{{ t('financeiro.situacao') }}</th>
            <th scope="col">{{ t('financeiro.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="c in carteiras.data.value"
            :key="c.id"
            :data-testid="`cb-carteira-${c.id}`"
            :data-ativo="String(c.ativo)"
          >
            <td>{{ c.descricao }} ({{ c.carteira }} · {{ c.beneficiario }})</td>
            <td>{{ c.contaNome }}</td>
            <td>
              {{ c.faixa }} ·
              {{ t('financeiro.cobranca.carteiras.disponiveis', { n: c.disponiveis }) }}
            </td>
            <td>{{ c.tarifa === null ? '' : reais(c.tarifa) }}</td>
            <td>
              {{
                c.ativo
                  ? t('financeiro.cobranca.carteiras.emAberto', { n: c.emAberto })
                  : t('financeiro.cobranca.carteiras.inativa')
              }}
            </td>
            <td>
              <button
                v-if="c.ativo && podeConfigurar"
                type="button"
                :data-testid="`cb-desativar-${c.id}`"
                @click="desativarCarteira(c.id)"
              >
                {{ t('financeiro.cobranca.carteiras.desativar') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else data-testid="cb-sem-carteiras">{{ t('financeiro.cobranca.carteiras.nenhuma') }}</p>
      <form
        v-if="podeConfigurar"
        class="filtros"
        data-testid="cb-form-carteira"
        @submit.prevent="incluirCarteira"
      >
        <span class="campo">
          <SanteSelecao
            v-model="form.conta"
            :rotulo="t('financeiro.cobranca.carteiras.conta')"
            :opcoes="contas"
            obrigatorio
            data-testid="cb-carteira-conta"
          />
        </span>
        <span class="campo">
          <label for="cb-c-descricao">{{ t('financeiro.cobranca.carteiras.descricao') }}</label>
          <input id="cb-c-descricao" v-model="form.descricao" maxlength="150" data-testid="cb-c-descricao" />
        </span>
        <span class="campo">
          <label for="cb-c-codigo">{{ t('financeiro.cobranca.carteiras.codigo') }}</label>
          <input
            id="cb-c-codigo"
            v-model="form.codigoCarteira"
            inputmode="numeric"
            maxlength="10"
            data-testid="cb-c-codigo"
          />
        </span>
        <span class="campo">
          <label for="cb-c-variacao">{{ t('financeiro.cobranca.carteiras.variacao') }}</label>
          <input
            id="cb-c-variacao"
            v-model="form.variacaoCarteira"
            maxlength="10"
            data-testid="cb-c-variacao"
          />
        </span>
        <span class="campo">
          <label for="cb-c-beneficiario">{{ t('financeiro.cobranca.carteiras.beneficiario') }}</label>
          <input
            id="cb-c-beneficiario"
            v-model="form.codigoBeneficiario"
            inputmode="numeric"
            maxlength="30"
            data-testid="cb-c-beneficiario"
          />
        </span>
        <span class="campo">
          <label for="cb-c-convenio">{{ t('financeiro.cobranca.carteiras.convenio') }}</label>
          <input id="cb-c-convenio" v-model="form.convenio" maxlength="20" data-testid="cb-c-convenio" />
        </span>
        <span class="campo">
          <label for="cb-c-inicio">{{ t('financeiro.cobranca.carteiras.inicio') }}</label>
          <input
            id="cb-c-inicio"
            v-model="form.nossoNumeroInicial"
            inputmode="numeric"
            data-testid="cb-c-inicio"
          />
        </span>
        <span class="campo">
          <label for="cb-c-fim">{{ t('financeiro.cobranca.carteiras.fim') }}</label>
          <input id="cb-c-fim" v-model="form.nossoNumeroFinal" inputmode="numeric" data-testid="cb-c-fim" />
        </span>
        <span class="campo">
          <label for="cb-c-compensacao">{{ t('financeiro.cobranca.carteiras.compensacao') }}</label>
          <input
            id="cb-c-compensacao"
            v-model="form.diasCompensacao"
            inputmode="numeric"
            data-testid="cb-c-compensacao"
          />
        </span>
        <span class="campo">
          <label for="cb-c-tarifa">{{ t('financeiro.cobranca.carteiras.tarifa') }}</label>
          <input id="cb-c-tarifa" v-model="form.valorTarifa" inputmode="decimal" data-testid="cb-c-tarifa" />
        </span>
        <span class="campo">
          <label for="cb-c-local">{{ t('financeiro.cobranca.carteiras.local') }}</label>
          <input id="cb-c-local" v-model="form.localPagamento" maxlength="200" data-testid="cb-c-local" />
        </span>
        <button
          type="submit"
          :disabled="gravando || !form.conta || !form.descricao || recusaCarteira !== null"
          data-testid="cb-incluir-carteira"
        >
          {{ t('financeiro.cobranca.carteiras.incluir') }}
        </button>
      </form>
      <p v-if="recusaCarteira" role="alert" data-testid="cb-recusa-carteira">{{ recusaCarteira }}</p>
    </template>
  </section>
</template>
