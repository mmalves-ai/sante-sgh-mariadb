<script setup lang="ts">
// Consignados (M46, etapa 4; ficha, seção 7; regra 10; operações suprimentos.registrarRemessaConsignado e
// suprimentos.reporConsignado). O material que o fornecedor deixa no hospital e só é faturado quando usado:
//   - Saldo por fornecedor: remessas + reposições − consumidos − devolvidos, com as parcelas impressas, o que falta
//     repor e faturar e o saldo do cadastro do estoque (só consulta);
//   - Consumos em sala: os consumos do OPME consignado (a etapa 3) com a reposição e o faturamento; escolher os consumos
//     de um fornecedor e de um item e registrar a reposição (a nota de remessa da reposição) ou ligar a nota fiscal de
//     faturamento já registrada na entrada por nota do estoque;
//   - Registrar remessa: o fornecedor, o item, a quantidade, a nota de remessa e o lote ou a série;
//   - Devolver ao fornecedor: o não usado, até o saldo, com o motivo;
//   - Movimentos: o histórico.
// O indicador do consumo sem faturamento vai com o numerador e o denominador. O servidor confere tudo de novo.
import { type ConsumoConsignado, type SaldoConsignado } from '@sgh/contratos';
import { consumoConsignadoAtrasado } from '@sgh/dominio-suprimentos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  buscarFornecedoresConsignado,
  buscarItensConsignado,
  lerNotasConsignado,
  lerPainelConsignado,
  registrarRemessaConsignado,
  reporConsignado,
} from '../api-consignado.js';
import BuscaCodigoNome from '../componentes/BuscaCodigoNome.vue';
import ErroSuprimentos from '../componentes/ErroSuprimentos.vue';
import TaxaConsignacaoPainel from '../componentes/TaxaConsignacaoPainel.vue';
import './estilo-opme.css';

type Aba = 'saldo' | 'consumos' | 'remessa' | 'devolucao' | 'movimentos' | 'taxas';
const { t } = useI18n();
const aba = ref<Aba>('saldo');
const fornecedor = ref<number | null>(null);
const painel = useQuery({
  queryKey: computed(() => ['consignado', fornecedor.value]),
  queryFn: () => lerPainelConsignado(fornecedor.value),
});
const dados = computed(() => painel.data.value ?? null);
const podeRegistrar = computed(() => dados.value?.gravacao.operacoes['registrar']?.pode === true);
const erro = ref<unknown>(null);
const mensagem = ref('');
const aviso = ref('');
const enviando = ref(false);
const diaHora = (x: string) => `${x.slice(8, 10)}/${x.slice(5, 7)}/${x.slice(0, 4)} ${x.slice(11, 16)}`;
const dia = (x: string) => `${x.slice(8, 10)}/${x.slice(5, 7)}/${x.slice(0, 4)}`;
const num = (n: number) => String(n).replace('.', ',');

const buscarFornecedor = (termo: string) => buscarFornecedoresConsignado(termo);
const buscarItem = async (termo: string) => {
  const r = await buscarItensConsignado(termo);
  return {
    itens: r.itens.map((i) => ({
      codigo: i.codigo,
      nome: i.nome,
      detalhe: i.consignado ? t('consignado.remessa.consignadoNoCadastro') : i.unidade,
    })),
  };
};

const indicador = computed(() => {
  const i = dados.value?.indicador;
  if (!i || i.consumos === 0) return t('consignado.indicadorVazio');
  return t('consignado.indicador', {
    semFaturamento: i.semFaturamento,
    consumos: i.consumos,
    semReposicao: i.semReposicao,
    atrasados: i.atrasados,
    dias: i.diasAlerta,
  });
});
const nomeFornecedor = (f: number | null) =>
  f === null ? '—' : (dados.value?.saldos.find((s) => s.fornecedor === f)?.fornecedorNome ?? String(f));

async function executar(fn: () => Promise<{ mensagem: string; aviso: string | null }>): Promise<boolean> {
  erro.value = null;
  mensagem.value = '';
  aviso.value = '';
  enviando.value = true;
  try {
    const r = await fn();
    mensagem.value = r.mensagem;
    aviso.value = r.aviso ?? '';
    await painel.refetch();
    return true;
  } catch (e) {
    erro.value = e;
    return false;
  } finally {
    enviando.value = false;
  }
}

// ── Consumos: reposição e faturamento ───────────────────────────────────────────────────────────────────────

const escolhidos = ref<number[]>([]);
const consumosEscolhidos = computed<ConsumoConsignado[]>(() =>
  (dados.value?.consumos ?? []).filter((c) => escolhidos.value.includes(c.consumo)),
);
const grupoEscolhido = computed(() => {
  const xs = consumosEscolhidos.value;
  if (xs.length === 0) return null;
  const f = xs[0]!.fornecedor;
  const i = xs[0]!.item;
  return xs.every((x) => x.fornecedor === f && x.item === i) ? { fornecedor: f!, item: i } : 'misturado';
});
const acao = ref<'reposicao' | 'faturamento' | null>(null);
const formRepor = reactive({
  nfNumero: '',
  nfSerie: '',
  nfEmissao: '',
  lote: '',
  serie: '',
  ano: 0,
  mes: 0,
  doc: 0,
});
// A nota da entrada do estoque escolhida numa lista com busca (as notas do fornecedor com o item), não digitada à mão
// (revisão do M46.4; ADR 0027).
const notas = useQuery({
  queryKey: computed(() => {
    const g = grupoEscolhido.value;
    return ['consignado-notas', g && g !== 'misturado' ? `${g.fornecedor}:${g.item}` : null];
  }),
  queryFn: () => {
    const g = grupoEscolhido.value as { fornecedor: number; item: number };
    return lerNotasConsignado(g.fornecedor, g.item);
  },
  enabled: computed(
    () =>
      acao.value === 'faturamento' && grupoEscolhido.value !== null && grupoEscolhido.value !== 'misturado',
  ),
});
const notaEscolhida = computed<string | null>({
  get: () => (formRepor.doc ? `${formRepor.ano}/${formRepor.mes}/${formRepor.doc}` : null),
  set: (v) => {
    const [ano, mes, doc] = (v ?? '0/0/0').split('/').map(Number) as [number, number, number];
    Object.assign(formRepor, { ano, mes, doc });
  },
});
const opcoesNotas = computed(() => [
  { valor: null, rotulo: t('consignado.consumos.notaEscolha') },
  ...(notas.data.value?.itens ?? []).map((n) => ({
    valor: `${n.ano}/${n.mes}/${n.doc}`,
    rotulo: t('consignado.consumos.notaRotulo', {
      numero: n.numero ?? '—',
      serie: n.serie ?? '—',
      emissao: n.emissao ? dia(n.emissao) : '—',
      doc: n.doc,
      mes: n.mes,
      ano: n.ano,
    }),
  })),
]);
function alternar(c: ConsumoConsignado): void {
  escolhidos.value = escolhidos.value.includes(c.consumo)
    ? escolhidos.value.filter((x) => x !== c.consumo)
    : [...escolhidos.value, c.consumo];
}
async function repor(): Promise<void> {
  const g = grupoEscolhido.value;
  if (!g || g === 'misturado' || !acao.value) return;
  const ok = await executar(() =>
    reporConsignado({
      tipo: acao.value,
      fornecedor: g.fornecedor,
      item: g.item,
      consumos: [...escolhidos.value],
      nfNumero: acao.value === 'reposicao' && formRepor.nfNumero.trim() ? formRepor.nfNumero.trim() : null,
      nfSerie: acao.value === 'reposicao' && formRepor.nfSerie.trim() ? formRepor.nfSerie.trim() : null,
      nfEmissao: acao.value === 'reposicao' && formRepor.nfEmissao ? formRepor.nfEmissao : null,
      nfEntrada:
        acao.value === 'faturamento'
          ? { ano: Number(formRepor.ano), mes: Number(formRepor.mes), doc: Number(formRepor.doc) }
          : null,
      lote: formRepor.lote.trim() || null,
      serie: formRepor.serie.trim() || null,
    }),
  );
  if (ok) {
    escolhidos.value = [];
    acao.value = null;
    Object.assign(formRepor, {
      nfNumero: '',
      nfSerie: '',
      nfEmissao: '',
      lote: '',
      serie: '',
      ano: 0,
      mes: 0,
      doc: 0,
    });
  }
}
const atrasado = (c: ConsumoConsignado) =>
  dados.value ? consumoConsignadoAtrasado(c, dados.value.hoje, dados.value.indicador.diasAlerta) : false;

// ── Remessa ─────────────────────────────────────────────────────────────────────────────────────────────────

const formRemessa = reactive({
  fornecedor: null as number | null,
  item: null as number | null,
  quantidade: 1,
  nfNumero: '',
  nfSerie: '',
  nfEmissao: new Date().toISOString().slice(0, 10),
  lote: '',
  serie: '',
  validade: '',
});
async function registrarRemessa(): Promise<void> {
  if (formRemessa.fornecedor === null || formRemessa.item === null) return;
  const ok = await executar(() =>
    registrarRemessaConsignado({
      fornecedor: formRemessa.fornecedor,
      item: formRemessa.item,
      quantidade: Number(formRemessa.quantidade),
      nfNumero: formRemessa.nfNumero.trim(),
      nfSerie: formRemessa.nfSerie.trim() || null,
      nfEmissao: formRemessa.nfEmissao,
      lote: formRemessa.lote.trim() || null,
      serie: formRemessa.serie.trim() || null,
      validade: formRemessa.validade || null,
    }),
  );
  if (ok)
    Object.assign(formRemessa, {
      quantidade: 1,
      nfNumero: '',
      nfSerie: '',
      lote: '',
      serie: '',
      validade: '',
    });
}

// ── Devolução ao fornecedor ─────────────────────────────────────────────────────────────────────────────────

const linhaDevolucao = ref<string | null>(null);
const opcoesDevolucao = computed(() =>
  (dados.value?.saldos ?? [])
    .filter((s) => s.saldo > 0)
    .map((s) => ({
      valor: `${s.fornecedor}:${s.item}` as string | null,
      rotulo: `${s.fornecedorNome ?? s.fornecedor} · ${s.item} ${s.itemNome ?? ''} (${num(s.saldo)})`,
    })),
);
const saldoDevolucao = computed<SaldoConsignado | null>(
  () => dados.value?.saldos.find((s) => `${s.fornecedor}:${s.item}` === linhaDevolucao.value) ?? null,
);
const formDevolucao = reactive({ quantidade: 1, motivo: '' });
async function devolver(): Promise<void> {
  const s = saldoDevolucao.value;
  if (!s) return;
  const ok = await executar(() =>
    reporConsignado({
      tipo: 'devolucao',
      fornecedor: s.fornecedor,
      item: s.item,
      quantidade: Number(formDevolucao.quantidade),
      motivo: formDevolucao.motivo.trim(),
    }),
  );
  if (ok) Object.assign(formDevolucao, { quantidade: 1, motivo: '' });
}
const abas: Aba[] = ['saldo', 'consumos', 'remessa', 'devolucao', 'movimentos', 'taxas'];
</script>

<template>
  <section class="tela-opme" aria-labelledby="consig-titulo" data-testid="tela-consignados">
    <h1 id="consig-titulo">{{ t('consignado.titulo') }}</h1>
    <div class="abas" role="tablist">
      <SanteBotao
        v-for="a in abas"
        :key="a"
        role="tab"
        :aria-selected="aba === a"
        variante="secundario"
        :rotulo="t(`consignado.abas.${a}`)"
        :data-testid="`consig-aba-${a}`"
        @acionar="aba = a"
      />
    </div>
    <ErroSuprimentos v-if="erro" :erro="erro" />
    <p v-if="mensagem" role="status" data-testid="consig-mensagem">{{ mensagem }}</p>
    <SanteAlerta v-if="aviso" variante="aviso" :texto="aviso" data-testid="consig-aviso" />

    <div class="barra">
      <BuscaCodigoNome
        v-model="fornecedor"
        :rotulo="t('consignado.filtroFornecedor')"
        :rotulo-buscar="t('consignado.buscarFornecedor')"
        :rotulo-escolhido="t('consignado.fornecedorEscolhido')"
        :rotulo-nenhum="t('consignado.fornecedorNenhum')"
        :rotulo-vazio="t('consignado.todosFornecedores')"
        :buscar="buscarFornecedor"
        testid="consig-filtro-fornecedor"
      />
    </div>

    <ErroSuprimentos v-if="painel.isError.value" :erro="painel.error.value" />
    <p v-else-if="!dados" role="status">{{ t('consignado.carregando') }}</p>
    <template v-else>
      <SanteAlerta
        v-if="!dados.gravacao.ligada"
        variante="aviso"
        :texto="dados.gravacao.motivo ?? t('consignado.emConsulta')"
        data-testid="consig-desligado"
      />
      <SanteAlerta
        :variante="dados.indicador.semFaturamento > 0 ? 'aviso' : 'info'"
        :texto="indicador"
        data-testid="consig-indicador"
      />
      <SanteAlerta
        v-if="dados.semFornecedor > 0"
        variante="aviso"
        :texto="t('consignado.semFornecedor', { n: dados.semFornecedor })"
      />
      <p v-if="dados.cortada" class="secundario">{{ t('consignado.cortada') }}</p>

      <!-- Saldo por fornecedor -->
      <template v-if="aba === 'saldo'">
        <p v-if="dados.saldos.length === 0">{{ t('consignado.saldo.nenhum') }}</p>
        <div v-else class="rolagem">
          <table class="grade">
            <caption class="secundario">
              {{
                t('consignado.saldo.legenda')
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t('consignado.saldo.colFornecedor') }}</th>
                <th scope="col">{{ t('consignado.saldo.colItem') }}</th>
                <th scope="col">{{ t('consignado.saldo.colRemessas') }}</th>
                <th scope="col">{{ t('consignado.saldo.colReposicoes') }}</th>
                <th scope="col">{{ t('consignado.saldo.colConsumidos') }}</th>
                <th scope="col">{{ t('consignado.saldo.colDevolvidos') }}</th>
                <th scope="col">{{ t('consignado.saldo.colSaldo') }}</th>
                <th scope="col">{{ t('consignado.saldo.colARepor') }}</th>
                <th scope="col">{{ t('consignado.saldo.colAFaturar') }}</th>
                <th scope="col">{{ t('consignado.saldo.colCadastro') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="s in dados.saldos"
                :key="`${s.fornecedor}:${s.item}`"
                :data-testid="`consig-saldo-${s.fornecedor}-${s.item}`"
              >
                <td>{{ s.fornecedor }} · {{ s.fornecedorNome ?? '—' }}</td>
                <td>{{ s.item }} · {{ s.itemNome ?? '—' }}</td>
                <td>{{ num(s.remessas) }}</td>
                <td>{{ num(s.reposicoes) }}</td>
                <td>{{ num(s.consumidos) }}</td>
                <td>{{ num(s.devolvidos) }}</td>
                <td :data-testid="`consig-saldo-valor-${s.fornecedor}-${s.item}`">
                  <strong>{{ num(s.saldo) }}</strong>
                  <span class="secundario">
                    ({{
                      t('consignado.saldo.conta', {
                        remessas: num(s.remessas),
                        reposicoes: num(s.reposicoes),
                        consumidos: num(s.consumidos),
                        devolvidos: num(s.devolvidos),
                        saldo: num(s.saldo),
                      })
                    }})
                  </span>
                </td>
                <td>{{ s.aRepor }}</td>
                <td>{{ s.aFaturar }}</td>
                <td>{{ s.saldoCadastro === null ? '—' : num(s.saldoCadastro) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <!-- Consumos em sala -->
      <template v-else-if="aba === 'consumos'">
        <p v-if="dados.consumos.length === 0">{{ t('consignado.consumos.nenhum') }}</p>
        <div v-else class="rolagem">
          <table class="grade">
            <thead>
              <tr>
                <th scope="col">
                  <span class="sgh-visualmente-oculto">{{
                    t('consignado.consumos.escolher', { consumo: '' })
                  }}</span>
                </th>
                <th scope="col">{{ t('consignado.consumos.colData') }}</th>
                <th scope="col">{{ t('consignado.consumos.colAtendimento') }}</th>
                <th scope="col">{{ t('consignado.consumos.colFornecedor') }}</th>
                <th scope="col">{{ t('consignado.consumos.colItem') }}</th>
                <th scope="col">{{ t('consignado.consumos.colRastreio') }}</th>
                <th scope="col">{{ t('consignado.consumos.colQuantidade') }}</th>
                <th scope="col">{{ t('consignado.consumos.colReposicao') }}</th>
                <th scope="col">{{ t('consignado.consumos.colFaturamento') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in dados.consumos" :key="c.consumo" :data-testid="`consig-consumo-${c.consumo}`">
                <td>
                  <input
                    type="checkbox"
                    :checked="escolhidos.includes(c.consumo)"
                    :aria-label="t('consignado.consumos.escolher', { consumo: c.consumo })"
                    :data-testid="`consig-escolher-${c.consumo}`"
                    @change="alternar(c)"
                  />
                </td>
                <td>{{ diaHora(c.em) }}</td>
                <td>{{ c.atendimento }}</td>
                <td>{{ nomeFornecedor(c.fornecedor) }}</td>
                <td>{{ c.item }} · {{ c.itemNome ?? '—' }}</td>
                <td>{{ c.lote ?? c.serie ?? '—' }}</td>
                <td>{{ num(c.quantidade) }}</td>
                <td :data-testid="`consig-reposicao-${c.consumo}`">
                  {{ c.reposicao ? diaHora(c.reposicao.em) : t('consignado.consumos.pendente') }}
                  <span v-if="!c.reposicao && atrasado(c)" class="alerta">{{
                    t('consignado.consumos.atrasado')
                  }}</span>
                </td>
                <td :data-testid="`consig-faturamento-${c.consumo}`">
                  {{
                    c.faturamento
                      ? c.faturamento.nf
                        ? t('consignado.consumos.nf', c.faturamento.nf)
                        : diaHora(c.faturamento.em)
                      : t('consignado.consumos.pendente')
                  }}
                  <span v-if="!c.faturamento && atrasado(c)" class="alerta">{{
                    t('consignado.consumos.atrasado')
                  }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <template v-if="grupoEscolhido">
          <p v-if="grupoEscolhido === 'misturado'" role="alert">{{ t('consignado.consumos.misturados') }}</p>
          <template v-else>
            <p role="status" data-testid="consig-escolhidos">
              {{
                t('consignado.consumos.escolhidos', {
                  n: escolhidos.length,
                  fornecedor: nomeFornecedor(grupoEscolhido.fornecedor),
                  item: grupoEscolhido.item,
                })
              }}
            </p>
            <div class="barra">
              <SanteBotao
                variante="secundario"
                :rotulo="t('consignado.consumos.repor')"
                :desabilitado="!podeRegistrar"
                data-testid="consig-acao-repor"
                @acionar="acao = 'reposicao'"
              />
              <SanteBotao
                variante="secundario"
                :rotulo="t('consignado.consumos.faturar')"
                :desabilitado="!podeRegistrar"
                data-testid="consig-acao-faturar"
                @acionar="acao = 'faturamento'"
              />
            </div>
            <section
              v-if="acao"
              class="cartao"
              aria-labelledby="consig-repor"
              data-testid="consig-form-repor"
            >
              <h2 id="consig-repor">
                {{
                  acao === 'reposicao'
                    ? t('consignado.consumos.reposicaoTitulo')
                    : t('consignado.consumos.faturamentoTitulo')
                }}
              </h2>
              <p v-if="acao === 'faturamento'" class="secundario">
                {{ t('consignado.consumos.faturamentoAjuda') }}
              </p>
              <div v-if="acao === 'reposicao'" class="barra">
                <span class="campo">
                  <label for="consig-rep-nf">{{ t('consignado.remessa.nfNumero') }}</label>
                  <input
                    id="consig-rep-nf"
                    v-model="formRepor.nfNumero"
                    inputmode="numeric"
                    maxlength="20"
                    data-testid="consig-rep-nf"
                  />
                </span>
                <span class="campo">
                  <label for="consig-rep-serie-nf">{{ t('consignado.remessa.nfSerie') }}</label>
                  <input id="consig-rep-serie-nf" v-model="formRepor.nfSerie" maxlength="5" />
                </span>
                <span class="campo">
                  <label for="consig-rep-emissao">{{ t('consignado.remessa.nfEmissao') }}</label>
                  <input
                    id="consig-rep-emissao"
                    v-model="formRepor.nfEmissao"
                    type="date"
                    data-testid="consig-rep-emissao"
                  />
                </span>
                <span class="campo">
                  <label for="consig-rep-lote">{{ t('consignado.remessa.lote') }}</label>
                  <input
                    id="consig-rep-lote"
                    v-model="formRepor.lote"
                    maxlength="30"
                    data-testid="consig-rep-lote"
                  />
                </span>
              </div>
              <div v-else class="barra">
                <SanteSelecao
                  v-model="notaEscolhida"
                  :rotulo="t('consignado.consumos.nota')"
                  :opcoes="opcoesNotas"
                  :busca="true"
                  obrigatorio
                  data-testid="consig-fat-nota"
                />
                <p
                  v-if="notas.isSuccess.value && (notas.data.value?.itens.length ?? 0) === 0"
                  role="status"
                  data-testid="consig-fat-sem-notas"
                >
                  {{ t('consignado.consumos.semNotas') }}
                </p>
              </div>
              <div class="barra">
                <SanteBotao
                  :rotulo="t('consignado.enviar')"
                  :desabilitado="enviando || !podeRegistrar"
                  data-testid="consig-repor-gravar"
                  @acionar="repor"
                />
                <SanteBotao variante="secundario" :rotulo="t('consignado.cancelar')" @acionar="acao = null" />
              </div>
            </section>
          </template>
        </template>
      </template>

      <!-- Remessa -->
      <section
        v-else-if="aba === 'remessa'"
        class="cartao"
        aria-labelledby="consig-remessa"
        data-testid="consig-form-remessa"
      >
        <h2 id="consig-remessa">{{ t('consignado.abas.remessa') }}</h2>
        <div class="barra">
          <BuscaCodigoNome
            v-model="formRemessa.fornecedor"
            :rotulo="t('consignado.filtroFornecedor')"
            :rotulo-buscar="t('consignado.buscarFornecedor')"
            :rotulo-escolhido="t('consignado.fornecedorEscolhido')"
            :rotulo-nenhum="t('consignado.fornecedorNenhum')"
            :buscar="buscarFornecedor"
            testid="consig-rem-fornecedor"
          />
        </div>
        <div class="barra">
          <BuscaCodigoNome
            v-model="formRemessa.item"
            :rotulo="t('consignado.remessa.item')"
            :rotulo-buscar="t('consignado.remessa.buscarItem')"
            :rotulo-escolhido="t('consignado.remessa.itemEscolhido')"
            :rotulo-nenhum="t('consignado.remessa.itemNenhum')"
            :buscar="buscarItem"
            testid="consig-rem-item"
          />
        </div>
        <div class="barra">
          <span class="campo">
            <label for="consig-rem-qtd">{{ t('consignado.remessa.quantidade') }}</label>
            <input
              id="consig-rem-qtd"
              v-model.number="formRemessa.quantidade"
              type="number"
              min="0.001"
              step="0.001"
              data-testid="consig-rem-qtd"
            />
          </span>
          <span class="campo">
            <label for="consig-rem-nf">{{ t('consignado.remessa.nfNumero') }}</label>
            <input
              id="consig-rem-nf"
              v-model="formRemessa.nfNumero"
              inputmode="numeric"
              maxlength="20"
              data-testid="consig-rem-nf"
            />
          </span>
          <span class="campo">
            <label for="consig-rem-nfserie">{{ t('consignado.remessa.nfSerie') }}</label>
            <input id="consig-rem-nfserie" v-model="formRemessa.nfSerie" maxlength="5" />
          </span>
          <span class="campo">
            <label for="consig-rem-emissao">{{ t('consignado.remessa.nfEmissao') }}</label>
            <input
              id="consig-rem-emissao"
              v-model="formRemessa.nfEmissao"
              type="date"
              data-testid="consig-rem-emissao"
            />
          </span>
        </div>
        <div class="barra">
          <span class="campo">
            <label for="consig-rem-lote">{{ t('consignado.remessa.lote') }}</label>
            <input
              id="consig-rem-lote"
              v-model="formRemessa.lote"
              maxlength="30"
              data-testid="consig-rem-lote"
            />
          </span>
          <span class="campo">
            <label for="consig-rem-serie">{{ t('consignado.remessa.serie') }}</label>
            <input id="consig-rem-serie" v-model="formRemessa.serie" maxlength="40" />
          </span>
          <span class="campo">
            <label for="consig-rem-validade">{{ t('consignado.remessa.validade') }}</label>
            <input
              id="consig-rem-validade"
              v-model="formRemessa.validade"
              type="date"
              data-testid="consig-rem-validade"
            />
          </span>
        </div>
        <SanteBotao
          :rotulo="t('consignado.remessa.registrar')"
          :desabilitado="
            enviando || !podeRegistrar || formRemessa.fornecedor === null || formRemessa.item === null
          "
          data-testid="consig-rem-gravar"
          @acionar="registrarRemessa"
        />
      </section>

      <!-- Devolução ao fornecedor -->
      <section
        v-else-if="aba === 'devolucao'"
        class="cartao"
        aria-labelledby="consig-devolucao"
        data-testid="consig-form-devolucao"
      >
        <h2 id="consig-devolucao">{{ t('consignado.abas.devolucao') }}</h2>
        <SanteSelecao
          v-model="linhaDevolucao"
          :rotulo="t('consignado.devolucao.item')"
          :opcoes="opcoesDevolucao"
          :busca="true"
          data-testid="consig-dev-item"
        />
        <p v-if="saldoDevolucao" role="status">
          {{ t('consignado.devolucao.saldoAtual', { saldo: num(saldoDevolucao.saldo) }) }}
        </p>
        <div class="barra">
          <span class="campo">
            <label for="consig-dev-qtd">{{ t('consignado.devolucao.quantidade') }}</label>
            <input
              id="consig-dev-qtd"
              v-model.number="formDevolucao.quantidade"
              type="number"
              min="0.001"
              step="0.001"
              data-testid="consig-dev-qtd"
            />
          </span>
          <span class="campo">
            <label for="consig-dev-motivo">{{ t('consignado.devolucao.motivo') }}</label>
            <input
              id="consig-dev-motivo"
              v-model="formDevolucao.motivo"
              maxlength="400"
              data-testid="consig-dev-motivo"
            />
          </span>
        </div>
        <SanteBotao
          :rotulo="t('consignado.devolucao.registrar')"
          :desabilitado="enviando || !podeRegistrar || !saldoDevolucao"
          data-testid="consig-dev-gravar"
          @acionar="devolver"
        />
      </section>

      <!-- Taxa de comercialização por faixa de valor (05-SUP linha 24) -->
      <TaxaConsignacaoPainel
        v-else-if="aba === 'taxas'"
        :fornecedor="fornecedor"
        :pode-registrar="podeRegistrar"
      />

      <!-- Movimentos -->
      <template v-else>
        <p v-if="dados.movimentos.length === 0">{{ t('consignado.movimentos.nenhum') }}</p>
        <div v-else class="rolagem">
          <table class="grade">
            <thead>
              <tr>
                <th scope="col">{{ t('consignado.movimentos.colQuando') }}</th>
                <th scope="col">{{ t('consignado.movimentos.colTipo') }}</th>
                <th scope="col">{{ t('consignado.movimentos.colFornecedor') }}</th>
                <th scope="col">{{ t('consignado.movimentos.colItem') }}</th>
                <th scope="col">{{ t('consignado.movimentos.colQuantidade') }}</th>
                <th scope="col">{{ t('consignado.movimentos.colDocumento') }}</th>
                <th scope="col">{{ t('consignado.movimentos.colUsuario') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="m in dados.movimentos"
                :key="m.id"
                :data-testid="`consig-mov-${m.id}`"
                :data-tipo="m.tipo"
              >
                <td>{{ diaHora(m.em) }}</td>
                <td>{{ t(`consignado.tipos.${m.tipo}`) }}</td>
                <td>{{ m.fornecedor }} · {{ m.fornecedorNome ?? '—' }}</td>
                <td>{{ m.item }} · {{ m.itemNome ?? '—' }}</td>
                <td>{{ num(m.quantidade) }}</td>
                <td>
                  {{
                    m.nfEntrada
                      ? t('consignado.consumos.nf', m.nfEntrada)
                      : m.nfNumero
                        ? `${m.nfNumero}${m.nfSerie ? `-${m.nfSerie}` : ''}${m.nfEmissao ? ` · ${dia(m.nfEmissao)}` : ''}`
                        : (m.motivo ?? '—')
                  }}
                </td>
                <td>{{ m.usuario }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </template>
  </section>
</template>
