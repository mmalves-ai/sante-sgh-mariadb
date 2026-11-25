<script setup lang="ts">
// F7, 07-FIN linha 90: `/financeiro/receber/pix`. A cobrança Pix do título a receber numa tela só:
// - Cobrar: busca a parcela em aberto pelo pagador ou título, escolhe a chave e gera a cobrança; a regra do servidor
//   (conferirCobrancaPix) roda a cada tecla e o copia e cola sai pronto, com o botão de copiar.
// - Cobranças: os Pix recebidos de cada cobrança, com o que baixou a parcela, o pago a mais e o devolvido; a devolução
//   mostra na hora (planejarDevolucaoPix) se sai do pago a mais ou se volta ao saldo da parcela; cancelar pede motivo;
//   fora de produção, o simulador paga a cobrança e o retorno baixa a parcela como o do prestador.
// - Chaves Pix: a chave da conta conferida a cada tecla (conferirChavePix), com o tipo sugerido; desativar guarda o
//   histórico.
import {
  type MotivoDevolucaoPix,
  type TipoChavePix,
  MOTIVOS_DEVOLUCAO_PIX,
  conferirChavePix,
  conferirCobrancaPix,
  planejarDevolucaoPix,
  tipoProvavelChavePix,
} from '@sgh/dominio-financeiro';
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../../faturamento/componentes/MensagemFaturamento.vue';
import { novaChave } from '../api-financeiro.js';
import {
  type CobrancaPixTela as Cobranca,
  type ParcelaPix,
  type PixRecebidoTela,
  cancelarCobrancaPix,
  devolverPix,
  emitirCobrancaPix,
  lerChavesPix,
  lerCobrancasPix,
  lerParcelasParaPix,
  manterChavePix,
  pagarPixSimulado,
} from '../api-pix.js';
import { data, opcoesContas, quando, reais, usarFinanceiro } from '../usar-financeiro.js';

const { t, te } = useI18n();
const qc = useQueryClient();
const rota = useRoute();
const { apoio, gravacao, tem } = usarFinanceiro();
const podeEmitir = computed(() => tem('financeiro.cobrancaBancaria.emitir'));
const podeConfigurar = computed(() => tem('financeiro.cobrancaBancaria.configurar'));
const podeBaixar = computed(() => tem('financeiro.tituloReceber.baixar'));
const simulador = computed(() => gravacao.data.value?.destinoExterno === 'simulador');
const situacaoTexto = (s: string) =>
  te(`financeiro.pix.situacoes.${s}`) ? t(`financeiro.pix.situacoes.${s}`) : s;
const hojeIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const numeroDe = (v: string) =>
  v.trim() ? Number(v.trim().replace(/\./g, '').replace(',', '.')) : Number.NaN;

type Aba = 'cobrar' | 'cobrancas' | 'chaves';
const ABAS: readonly Aba[] = ['cobrar', 'cobrancas', 'chaves'];
const aba = ref<Aba>(ABAS.includes(rota.query['aba'] as Aba) ? (rota.query['aba'] as Aba) : 'cobrar');
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

// ── Chaves (servem à aba Cobrar e à aba Chaves) ──
const chaves = useQuery({ queryKey: ['financeiro', 'pix', 'chaves'], queryFn: () => lerChavesPix() });
const chavesAtivas = computed(() => (chaves.data.value ?? []).filter((k) => k.ativa));
const opcoesChave = computed(() => [
  { valor: '', rotulo: t('financeiro.escolha') },
  ...chavesAtivas.value.map((k) => ({
    valor: String(k.id),
    rotulo: `${k.contaDescricao} · ${t(`financeiro.pix.tipos.${k.tipo}`)} · ${k.chave}`,
  })),
]);

// ── Cobrar ──
const busca = ref('');
const buscaAplicada = ref('');
let atraso: ReturnType<typeof setTimeout> | undefined;
watch(busca, (v) => {
  clearTimeout(atraso);
  atraso = setTimeout(() => (buscaAplicada.value = v.trim()), 300);
});
const parcelas = useQuery({
  queryKey: computed(() => ['financeiro', 'pix', 'parcelas', buscaAplicada.value]),
  queryFn: () => lerParcelasParaPix(buscaAplicada.value),
  enabled: computed(() => aba.value === 'cobrar'),
});
const parcela = ref<ParcelaPix | null>(null);
const pedido = reactive({ chave: '', modalidade: 'imediata', valor: '', vencimento: '', descricao: '' });
watch(
  chavesAtivas,
  (lista) => {
    // A chave padrão (ou a única) já vem escolhida.
    if (pedido.chave) return;
    const k = lista.find((c) => c.padrao) ?? (lista.length === 1 ? lista[0] : undefined);
    if (k) pedido.chave = String(k.id);
  },
  { immediate: true },
);
const opcoesModalidade = computed(() =>
  (['imediata', 'com_vencimento'] as const).map((m) => ({
    valor: m,
    rotulo: t(`financeiro.pix.modalidades.${m}`),
  })),
);
const gerada = ref<Cobranca | null>(null);
const copiado = ref(false);
function escolherParcela(p: ParcelaPix) {
  parcela.value = p;
  gerada.value = null;
  Object.assign(pedido, { valor: '', vencimento: p.vencimento ?? '', descricao: '' });
}
const valorPedido = computed(() =>
  pedido.valor.trim() ? numeroDe(pedido.valor) : (parcela.value?.saldo ?? 0),
);
/** A regra do servidor a cada tecla: a recusa aparece antes de gerar. */
const recusaCobranca = computed(() => {
  const p = parcela.value;
  if (!p) return null;
  const r = conferirCobrancaPix({
    modalidade: pedido.modalidade as 'imediata' | 'com_vencimento',
    valor: valorPedido.value,
    saldoParcela: p.saldo,
    situacaoParcela: 'aberta',
    hoje: hojeIso(),
    vencimento: pedido.vencimento || null,
    // A tela não traz o documento: com vencimento, só se sabe que existe.
    pagadorDocumento: p.temDocumento ? '00000000000' : null,
    cobrancaAtivaNaParcela: p.cobrancaAtiva !== null,
    chaveAtiva: chavesAtivas.value.some((k) => String(k.id) === pedido.chave),
  });
  return r.ok ? null : r.mensagem;
});
const gerar = () => {
  const p = parcela.value;
  if (!p) return;
  return gravar(
    () =>
      emitirCobrancaPix(
        {
          parcela: p.parcela,
          chave: Number(pedido.chave),
          modalidade: pedido.modalidade as 'imediata' | 'com_vencimento',
          ...(pedido.valor.trim() ? { valor: valorPedido.value } : {}),
          ...(pedido.modalidade === 'com_vencimento' ? { vencimento: pedido.vencimento } : {}),
          ...(pedido.descricao.trim() ? { descricao: pedido.descricao.trim() } : {}),
        },
        novaChave('emitir-cobranca-pix'),
      ),
    async () => {
      await recarregar();
      const lista = await lerCobrancasPix({ situacao: 'ativa', busca: p.titulo });
      gerada.value = lista.find((c) => c.parcela === p.parcela) ?? null;
      parcela.value = null;
    },
  );
};
async function copiar(texto: string) {
  copiado.value = false;
  await globalThis.navigator?.clipboard?.writeText(texto).catch(() => undefined);
  copiado.value = true;
}

// ── Cobranças ──
const SITUACOES = [
  'ativa',
  'concluida',
  'removida_usuario',
  'removida_prestador',
  'expirada',
  'devolvida',
] as const;
const filtroSituacao = ref('');
const buscaCobranca = ref('');
const buscaCobrancaAplicada = ref('');
let atrasoCobranca: ReturnType<typeof setTimeout> | undefined;
watch(buscaCobranca, (v) => {
  clearTimeout(atrasoCobranca);
  atrasoCobranca = setTimeout(() => (buscaCobrancaAplicada.value = v.trim()), 300);
});
const opcoesSituacao = computed(() => [
  { valor: '', rotulo: t('financeiro.todas') },
  ...SITUACOES.map((s) => ({ valor: s, rotulo: situacaoTexto(s) })),
]);
const cobrancas = useQuery({
  queryKey: computed(() => [
    'financeiro',
    'pix',
    'cobrancas',
    filtroSituacao.value,
    buscaCobrancaAplicada.value,
  ]),
  queryFn: () =>
    lerCobrancasPix({ situacao: filtroSituacao.value || null, busca: buscaCobrancaAplicada.value }),
  enabled: computed(() => aba.value === 'cobrancas'),
});
const pagarSimulado = (c: Cobranca) =>
  gravar(() => pagarPixSimulado({ cobranca: c.id }, novaChave('pix-simulado')), recarregar);

const cancelando = ref<Cobranca | null>(null);
const motivoCancelamento = ref('');
const cancelar = () =>
  gravar(
    () =>
      cancelarCobrancaPix(
        { cobranca: cancelando.value?.id ?? 0, motivo: motivoCancelamento.value.trim() },
        novaChave('cancelar-cobranca-pix'),
      ),
    async () => {
      cancelando.value = null;
      motivoCancelamento.value = '';
      await recarregar();
    },
  );

const devolvendo = ref<PixRecebidoTela | null>(null);
const devolucao = reactive({ valor: '', motivo: 'MD06' });
const opcoesMotivo = computed(() =>
  (Object.keys(MOTIVOS_DEVOLUCAO_PIX) as MotivoDevolucaoPix[]).map((m) => ({
    valor: m,
    rotulo: t(`financeiro.pix.motivos.${m}`),
  })),
);
function pedirDevolucao(r: PixRecebidoTela) {
  devolvendo.value = r;
  Object.assign(devolucao, {
    valor: (r.excedenteLivre > 0 ? r.excedenteLivre : r.podeDevolver).toFixed(2).replace('.', ','),
    motivo: r.excedenteLivre > 0 ? 'SL02' : 'MD06',
  });
}
/** A regra do servidor na hora: sai do pago a mais ou volta ao saldo da parcela. */
const planoDevolucao = computed(() => {
  const r = devolvendo.value;
  if (!r) return null;
  return planejarDevolucaoPix({
    valorPago: r.valor,
    principalAtual: r.baixado,
    jaDevolvido: r.devolvido,
    pedido: numeroDe(devolucao.valor),
    pagoEm: r.pagoEm ?? hojeIso(),
    hoje: hojeIso(),
  });
});
const devolver = () =>
  gravar(
    () =>
      devolverPix(
        {
          retorno: devolvendo.value?.retorno ?? 0,
          valor: numeroDe(devolucao.valor),
          motivo: devolucao.motivo as MotivoDevolucaoPix,
        },
        novaChave('devolver-pix'),
      ),
    async () => {
      devolvendo.value = null;
      await recarregar();
    },
  );

// ── Chaves Pix ──
const contas = computed(() => opcoesContas(apoio.data.value?.contas, t('financeiro.escolha')));
const TIPOS: readonly TipoChavePix[] = ['cpf', 'cnpj', 'email', 'telefone', 'aleatoria'];
const opcoesTipo = computed(() => TIPOS.map((x) => ({ valor: x, rotulo: t(`financeiro.pix.tipos.${x}`) })));
const novaChavePix = reactive({ conta: '', tipo: 'aleatoria', chave: '', padrao: true });
const tipoSugerido = computed(() => {
  const s = novaChavePix.chave.trim() ? tipoProvavelChavePix(novaChavePix.chave) : null;
  return s && s !== novaChavePix.tipo ? s : null;
});
/** A regra do servidor a cada tecla: a chave inválida aparece antes de gravar. */
const conferenciaChave = computed(() =>
  novaChavePix.chave.trim() ? conferirChavePix(novaChavePix.tipo as TipoChavePix, novaChavePix.chave) : null,
);
const incluirChave = () => {
  const c = conferenciaChave.value;
  if (!c?.ok) return;
  return gravar(
    () =>
      manterChavePix(
        {
          acao: 'incluir',
          conta: Number(novaChavePix.conta),
          tipo: c.tipo,
          chave: c.chave,
          padrao: novaChavePix.padrao,
        },
        novaChave('chave-pix'),
      ),
    async () => {
      Object.assign(novaChavePix, { chave: '', padrao: true });
      await recarregar();
    },
  );
};
const desativarChave = (id: number) =>
  gravar(() => manterChavePix({ acao: 'desativar', chave: id }, novaChave('chave-pix')), recarregar);
</script>

<template>
  <section class="tela-agenda" aria-labelledby="px-titulo" data-testid="tela-fin-pix">
    <h1 id="px-titulo">{{ t('financeiro.pix.titulo') }}</h1>
    <p>{{ t('financeiro.pix.texto') }}</p>
    <p v-if="simulador" class="secundario" data-testid="px-simulador">{{ t('financeiro.pix.simulador') }}</p>
    <div class="filtros" role="group" :aria-label="t('financeiro.pix.titulo')">
      <button
        v-for="a in ABAS"
        :key="a"
        type="button"
        :aria-pressed="aba === a"
        :data-testid="`px-aba-${a}`"
        @click="trocarAba(a)"
      >
        {{ t(`financeiro.pix.abas.${a}`) }}
      </button>
    </div>
    <ErroFaturamento v-if="erro" :erro="erro" />
    <MensagemFaturamento :texto="mensagem" testid="px-mensagem" />
    <ErroFaturamento v-if="chaves.error.value" :erro="chaves.error.value" />

    <!-- ── Cobrar ── -->
    <template v-if="aba === 'cobrar'">
      <h2>{{ t('financeiro.pix.cobrar.parcelas') }}</h2>
      <div class="filtros">
        <span class="campo">
          <label for="px-busca">{{ t('financeiro.pix.cobrar.buscar') }}</label>
          <input id="px-busca" v-model="busca" type="search" data-testid="px-busca" />
        </span>
      </div>
      <ErroFaturamento v-if="parcelas.error.value" :erro="parcelas.error.value" />
      <table v-else-if="parcelas.data.value?.length" class="tabela" data-testid="px-parcelas">
        <thead>
          <tr>
            <th scope="col">{{ t('financeiro.pix.cobrar.pagador') }}</th>
            <th scope="col">{{ t('financeiro.pix.cobrar.titulo') }}</th>
            <th scope="col">{{ t('financeiro.vencimento') }}</th>
            <th scope="col">{{ t('financeiro.valor') }}</th>
            <th scope="col">{{ t('financeiro.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in parcelas.data.value" :key="p.parcela" :data-testid="`px-parcela-${p.parcela}`">
            <td>{{ p.pagador }}</td>
            <td>{{ p.titulo }}/{{ p.sequencia }}</td>
            <td>{{ p.vencimento ? data(p.vencimento) : '' }}</td>
            <td>{{ reais(p.saldo) }}</td>
            <td>
              <small v-if="p.cobrancaAtiva !== null" class="secundario">
                {{ t('financeiro.pix.cobrar.jaTem') }}
              </small>
              <button
                v-else
                type="button"
                :disabled="!podeEmitir"
                :data-testid="`px-escolher-${p.parcela}`"
                @click="escolherParcela(p)"
              >
                {{ t('financeiro.pix.cobrar.escolher') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else data-testid="px-sem-parcela">{{ t('financeiro.pix.cobrar.nenhuma') }}</p>

      <form v-if="parcela" class="filtros" data-testid="px-pedido" @submit.prevent="gerar">
        <p class="campo-largo" data-testid="px-parcela-escolhida">
          {{
            t('financeiro.pix.cobrar.escolhida', {
              titulo: parcela.titulo,
              sequencia: parcela.sequencia,
              pagador: parcela.pagador,
              saldo: reais(parcela.saldo),
            })
          }}
        </p>
        <p v-if="!chavesAtivas.length" class="secundario" data-testid="px-sem-chave">
          {{ t('financeiro.pix.cobrar.semChave') }}
        </p>
        <span class="campo">
          <SanteSelecao
            v-model="pedido.chave"
            :rotulo="t('financeiro.pix.cobrar.chave')"
            :opcoes="opcoesChave"
            obrigatorio
            data-testid="px-chave"
          />
        </span>
        <span class="campo">
          <SanteSelecao
            v-model="pedido.modalidade"
            :rotulo="t('financeiro.pix.cobrar.modalidade')"
            :opcoes="opcoesModalidade"
            obrigatorio
            data-testid="px-modalidade"
          />
        </span>
        <span class="campo">
          <label for="px-valor">{{ t('financeiro.pix.cobrar.valor') }}</label>
          <input id="px-valor" v-model="pedido.valor" inputmode="decimal" data-testid="px-valor" />
        </span>
        <span v-if="pedido.modalidade === 'com_vencimento'" class="campo">
          <label for="px-vencimento">{{ t('financeiro.pix.cobrar.vencimento') }}</label>
          <input id="px-vencimento" v-model="pedido.vencimento" type="date" data-testid="px-vencimento" />
        </span>
        <span class="campo">
          <label for="px-descricao">{{ t('financeiro.pix.cobrar.descricao') }}</label>
          <input id="px-descricao" v-model="pedido.descricao" maxlength="140" data-testid="px-descricao" />
        </span>
        <button
          type="submit"
          :disabled="gravando || !podeEmitir || recusaCobranca !== null"
          data-testid="px-gerar"
        >
          {{ t('financeiro.pix.cobrar.gerar') }}
        </button>
        <p v-if="recusaCobranca" role="alert" data-testid="px-recusa-cobranca">{{ recusaCobranca }}</p>
      </form>

      <section v-if="gerada" class="cartao" data-testid="px-gerada" aria-labelledby="px-gerada-titulo">
        <h2 id="px-gerada-titulo">{{ t('financeiro.pix.cobrar.gerada') }}</h2>
        <p>{{ gerada.pagador }} · {{ reais(gerada.valor) }} · {{ gerada.txid }}</p>
        <label for="px-copia-cola">{{ t('financeiro.pix.cobrar.copiaECola') }}</label>
        <textarea
          id="px-copia-cola"
          :value="gerada.copiaECola ?? ''"
          readonly
          rows="3"
          data-testid="px-copia-cola"
        />
        <button
          type="button"
          :disabled="!gerada.copiaECola"
          data-testid="px-copiar"
          @click="copiar(gerada.copiaECola ?? '')"
        >
          {{ t('financeiro.pix.cobrar.copiar') }}
        </button>
        <span v-if="copiado" role="status" data-testid="px-copiado">{{
          t('financeiro.pix.cobrar.copiado')
        }}</span>
      </section>
    </template>

    <!-- ── Cobranças ── -->
    <template v-if="aba === 'cobrancas'">
      <div class="filtros">
        <span class="campo">
          <SanteSelecao
            v-model="filtroSituacao"
            :rotulo="t('financeiro.pix.cobrancas.filtro')"
            :opcoes="opcoesSituacao"
            data-testid="px-filtro-situacao"
          />
        </span>
        <span class="campo">
          <label for="px-busca-cobranca">{{ t('financeiro.pix.cobrancas.buscar') }}</label>
          <input
            id="px-busca-cobranca"
            v-model="buscaCobranca"
            type="search"
            data-testid="px-busca-cobranca"
          />
        </span>
      </div>
      <ErroFaturamento v-if="cobrancas.error.value" :erro="cobrancas.error.value" />
      <table v-else-if="cobrancas.data.value?.length" class="tabela" data-testid="px-cobrancas">
        <thead>
          <tr>
            <th scope="col">{{ t('financeiro.pix.cobrancas.pagador') }}</th>
            <th scope="col">{{ t('financeiro.valor') }}</th>
            <th scope="col">{{ t('financeiro.situacao') }}</th>
            <th scope="col">{{ t('financeiro.pix.cobrancas.recebidos') }}</th>
            <th scope="col">{{ t('financeiro.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="c in cobrancas.data.value"
            :key="c.id"
            :data-testid="`px-cobranca-${c.id}`"
            :data-situacao="c.situacao"
          >
            <td>
              {{ c.pagador ?? '' }}
              <small class="secundario">{{ c.titulo ?? '' }} · {{ c.txid }}</small>
            </td>
            <td>{{ reais(c.valor) }}</td>
            <td>{{ situacaoTexto(c.situacao) }}</td>
            <td>
              <span v-if="!c.recebidos.length" class="secundario">{{
                t('financeiro.pix.cobrancas.semPix')
              }}</span>
              <ul v-else>
                <li v-for="r in c.recebidos" :key="r.retorno" :data-testid="`px-recebido-${r.retorno}`">
                  {{
                    t('financeiro.pix.cobrancas.recebido', {
                      valor: reais(r.valor),
                      quando: r.pagoEm ? quando(r.pagoEm) : '',
                      baixado: reais(r.baixado),
                      devolvido: reais(r.devolvido),
                    })
                  }}
                  <small
                    v-if="r.excedenteLivre > 0"
                    class="secundario"
                    :data-testid="`px-excedente-${r.retorno}`"
                  >
                    ({{ t('financeiro.pix.cobrancas.excedente', { valor: reais(r.excedenteLivre) }) }})
                  </small>
                  <small v-if="r.aviso" class="secundario">({{ r.aviso }})</small>
                  <button
                    v-if="podeBaixar && r.podeDevolver > 0"
                    type="button"
                    :data-testid="`px-devolver-${r.retorno}`"
                    @click="pedirDevolucao(r)"
                  >
                    {{ t('financeiro.pix.cobrancas.devolver') }}
                  </button>
                </li>
              </ul>
            </td>
            <td>
              <button
                v-if="simulador && podeBaixar && c.situacao === 'ativa'"
                type="button"
                :disabled="gravando"
                :data-testid="`px-pagar-simulado-${c.id}`"
                @click="pagarSimulado(c)"
              >
                {{ t('financeiro.pix.cobrancas.pagarSimulado') }}
              </button>
              <button
                v-if="podeEmitir && c.situacao === 'ativa'"
                type="button"
                :data-testid="`px-cancelar-${c.id}`"
                @click="cancelando = c"
              >
                {{ t('financeiro.pix.cobrancas.cancelar') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else data-testid="px-sem-cobranca">{{ t('financeiro.pix.cobrancas.nenhuma') }}</p>

      <form v-if="cancelando" class="filtros" data-testid="px-form-cancelar" @submit.prevent="cancelar">
        <span class="campo">
          <label for="px-motivo-cancelamento">{{ t('financeiro.pix.cobrancas.motivoCancelamento') }}</label>
          <input
            id="px-motivo-cancelamento"
            v-model="motivoCancelamento"
            maxlength="300"
            data-testid="px-motivo-cancelamento"
          />
        </span>
        <button
          type="submit"
          :disabled="gravando || motivoCancelamento.trim().length < 3"
          data-testid="px-confirmar-cancelamento"
        >
          {{ t('financeiro.pix.cobrancas.confirmarCancelamento') }}
        </button>
        <button type="button" @click="cancelando = null">{{ t('financeiro.cancelar') }}</button>
      </form>

      <form v-if="devolvendo" class="filtros" data-testid="px-form-devolver" @submit.prevent="devolver">
        <h2 class="campo-largo">
          {{ t('financeiro.pix.cobrancas.devolucao', { fimAFim: devolvendo.fimAFim }) }}
        </h2>
        <span class="campo">
          <label for="px-valor-devolver">{{ t('financeiro.pix.cobrancas.valorDevolver') }}</label>
          <input
            id="px-valor-devolver"
            v-model="devolucao.valor"
            inputmode="decimal"
            data-testid="px-valor-devolver"
          />
        </span>
        <span class="campo">
          <SanteSelecao
            v-model="devolucao.motivo"
            :rotulo="t('financeiro.pix.cobrancas.motivo')"
            :opcoes="opcoesMotivo"
            obrigatorio
            data-testid="px-motivo-devolucao"
          />
        </span>
        <p v-if="planoDevolucao && !planoDevolucao.ok" role="alert" data-testid="px-recusa-devolucao">
          {{ planoDevolucao.mensagem }}
        </p>
        <p v-else-if="planoDevolucao?.ok" role="status" data-testid="px-plano-devolucao">
          {{
            planoDevolucao.reverteBaixa > 0
              ? t('financeiro.pix.cobrancas.planoReverte', {
                  excedente: reais(planoDevolucao.doExcedente),
                  reverte: reais(planoDevolucao.reverteBaixa),
                })
              : t('financeiro.pix.cobrancas.planoExcedente')
          }}
        </p>
        <button
          type="submit"
          :disabled="gravando || !planoDevolucao?.ok"
          data-testid="px-confirmar-devolucao"
        >
          {{ t('financeiro.pix.cobrancas.confirmarDevolucao') }}
        </button>
        <button type="button" @click="devolvendo = null">{{ t('financeiro.cancelar') }}</button>
      </form>
    </template>

    <!-- ── Chaves Pix ── -->
    <template v-if="aba === 'chaves'">
      <h2>{{ t('financeiro.pix.chaves.lista') }}</h2>
      <table v-if="chaves.data.value?.length" class="tabela" data-testid="px-chaves">
        <thead>
          <tr>
            <th scope="col">{{ t('financeiro.pix.chaves.conta') }}</th>
            <th scope="col">{{ t('financeiro.pix.chaves.tipo') }}</th>
            <th scope="col">{{ t('financeiro.pix.chaves.chave') }}</th>
            <th scope="col">{{ t('financeiro.situacao') }}</th>
            <th scope="col">{{ t('financeiro.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="k in chaves.data.value"
            :key="k.id"
            :data-testid="`px-chave-${k.id}`"
            :data-ativa="String(k.ativa)"
          >
            <td>{{ k.contaDescricao }}</td>
            <td>{{ t(`financeiro.pix.tipos.${k.tipo}`) }}</td>
            <td>
              <code>{{ k.chave }}</code>
              <small v-if="k.padrao" class="secundario">({{ t('financeiro.pix.chaves.padrao') }})</small>
            </td>
            <td>{{ k.ativa ? t('financeiro.pix.chaves.ativa') : t('financeiro.pix.chaves.inativa') }}</td>
            <td>
              <button
                v-if="podeConfigurar && k.ativa"
                type="button"
                :disabled="gravando"
                :data-testid="`px-desativar-${k.id}`"
                @click="desativarChave(k.id)"
              >
                {{ t('financeiro.pix.chaves.desativar') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else data-testid="px-sem-chaves">{{ t('financeiro.pix.chaves.nenhuma') }}</p>

      <form v-if="podeConfigurar" class="filtros" data-testid="px-form-chave" @submit.prevent="incluirChave">
        <span class="campo">
          <SanteSelecao
            v-model="novaChavePix.conta"
            :rotulo="t('financeiro.pix.chaves.conta')"
            :opcoes="contas"
            obrigatorio
            data-testid="px-chave-conta"
          />
        </span>
        <span class="campo">
          <SanteSelecao
            v-model="novaChavePix.tipo"
            :rotulo="t('financeiro.pix.chaves.tipo')"
            :opcoes="opcoesTipo"
            obrigatorio
            data-testid="px-chave-tipo"
          />
        </span>
        <span class="campo">
          <label for="px-chave-valor">{{ t('financeiro.pix.chaves.chave') }}</label>
          <input
            id="px-chave-valor"
            v-model="novaChavePix.chave"
            maxlength="100"
            data-testid="px-chave-valor"
          />
        </span>
        <label class="campo">
          <input v-model="novaChavePix.padrao" type="checkbox" data-testid="px-chave-padrao" />
          {{ t('financeiro.pix.chaves.padrao') }}
        </label>
        <button
          type="submit"
          :disabled="gravando || !Number(novaChavePix.conta) || !conferenciaChave?.ok"
          data-testid="px-incluir-chave"
        >
          {{ t('financeiro.pix.chaves.incluir') }}
        </button>
        <p v-if="tipoSugerido" class="secundario" data-testid="px-tipo-sugerido">
          {{ t('financeiro.pix.chaves.sugestao', { tipo: t(`financeiro.pix.tipos.${tipoSugerido}`) }) }}
        </p>
        <p v-if="conferenciaChave && !conferenciaChave.ok" role="alert" data-testid="px-recusa-chave">
          {{ conferenciaChave.mensagem }}
        </p>
      </form>
    </template>
  </section>
</template>
