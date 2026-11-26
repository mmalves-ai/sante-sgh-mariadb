<script setup lang="ts">
// Produção interna da farmácia e da central (C1-124, 05-SUP linha 12): `/farmacia/producao-interna`. Numa tela só:
// a fila das ordens de manipulação baixadas a fechar (quantidade produzida, perda, validade com hora sugerida pela
// ordem, custos indiretos com a prévia do custo do lote e as parcelas impressas), a montagem do kit a partir da
// composição do kit padrão (consumo por componente impresso) e os lotes produzidos no período. A validação é a mesma
// regra do domínio que a API aplica (conferirFechamentoProducao e conferirMontagemKit), na hora, antes de gravar; o
// saldo dos componentes no local e a validade dos lotes deles a API confere ao gravar. Nada é apagado: o lote
// produzido é registro permanente da rastreabilidade.
import type { ItemBusca } from '@sgh/contratos';
import {
  conferirFechamentoProducao,
  conferirMontagemKit,
  consumoDaMontagem,
  type CustoIndiretoDoLote,
  custoDoLote,
} from '@sgh/contratos/regras-suprimentos';
import { SanteSelecao } from '@sgh/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { pode } from '../../../casca/sessao/pode.js';
import { novaChaveContrato } from '../api-contrato.js';
import {
  type CustoMandadoTela,
  fecharOrdemProducao,
  type LoteProduzidoGravadoTela,
  montarKitProducao,
  type OrdemAFecharTela,
  painelProducaoInterna,
} from '../api-producao-interna.js';
import BuscaItem from '../componentes/BuscaItem.vue';
import ErroSuprimentos from '../componentes/ErroSuprimentos.vue';
import { mensagensProducaoInterna as M } from '../i18n-producao-interna.js';

const fmt = (s: string, v: Record<string, string | number>) =>
  s.replace(/\{(\w+)\}/g, (_x, k: string) => String(v[k] ?? ''));
const qtd = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const real = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const realUnit = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 4 });
const dataBr = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '');
const quandoBr = (d: string | null) => (d ? `${dataBr(d)} ${d.slice(11, 16)}` : '');
const numero = (s: string) => {
  const v = Number(String(s).replace(',', '.'));
  return String(s).trim() !== '' && Number.isFinite(v) ? v : NaN;
};
const diaLocal = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const podeGravar = computed(() => pode('suprimentos.manipulacao.abrir'));
const cliente = useQueryClient();
const erro = ref<unknown>(null);
const aviso = ref('');

// ------------------------------------------------ período e painel
const hoje = new Date();
const de = ref(diaLocal(new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 30)));
const ate = ref(diaLocal(hoje));
const periodo = ref({ de: de.value, ate: ate.value });
const chavePainel = computed(() => ['suprimentos', 'producao-interna', periodo.value.de, periodo.value.ate]);
const painel = useQuery({
  queryKey: chavePainel,
  queryFn: () => painelProducaoInterna(periodo.value.de, periodo.value.ate),
});
const aplicarPeriodo = () => {
  periodo.value = { de: de.value, ate: ate.value };
};
const recarregar = () => cliente.invalidateQueries({ queryKey: ['suprimentos', 'producao-interna'] });

// ------------------------------------------------ custos indiretos (comuns aos dois formulários)
const custosComValor = computed(() =>
  (painel.data.value?.custos ?? []).filter((c): c is typeof c & { valor: number } => c.valor !== null),
);
const custosSemValor = computed(() => (painel.data.value?.custos ?? []).filter((c) => c.valor === null));
/** As quantidades digitadas viram os custos do lote (só as preenchidas). */
function custosDe(q: Record<number, string>): {
  mandados: CustoMandadoTela[];
  doLote: CustoIndiretoDoLote[];
} {
  const mandados: CustoMandadoTela[] = [];
  const doLote: CustoIndiretoDoLote[] = [];
  for (const c of custosComValor.value) {
    const bruto = q[c.id] ?? '';
    if (bruto.trim() === '') continue;
    const quantidade = numero(bruto);
    mandados.push({ custo: c.id, quantidade });
    doLote.push({ custo: c.id, quantidade, valorUnitario: c.valor });
  }
  return { mandados, doLote };
}
const nomeDoCusto = (id: number) => custosComValor.value.find((c) => c.id === id)?.descricao ?? String(id);
const avisoGravado = (g: LoteProduzidoGravadoTela) =>
  fmt(g.saidaPaciente ? M.gravadoDose : M.gravado, {
    lote: g.numeroLote,
    total: real(g.valorTotal),
    unidade: realUnit(g.custoUnitario),
  });
const finalidade = (f: string) => M.finalidades[f] ?? f;

// ------------------------------------------------ fechamento da ordem baixada
const ordem = ref<OrdemAFecharTela | null>(null);
const fProduzida = ref('');
const fPerda = ref('0');
const fValidade = ref('');
const fNumeroLote = ref('');
const fAdicional = ref('0');
const fCustos = reactive<Record<number, string>>({});
let chaveFechamento = novaChaveContrato('prod-fecha');
function escolherOrdem(o: OrdemAFecharTela): void {
  ordem.value = o;
  fProduzida.value = String(o.quantidadePrevista);
  fPerda.value = '0';
  fValidade.value = o.validadeSugerida ?? '';
  fNumeroLote.value = '';
  fAdicional.value = '0';
  for (const k of Object.keys(fCustos)) delete fCustos[Number(k)];
  chaveFechamento = novaChaveContrato('prod-fecha');
}
const custosFechamento = computed(() => custosDe(fCustos));
const previaFechamento = computed(() =>
  ordem.value
    ? custoDoLote(
        ordem.value.valorInsumos,
        custosFechamento.value.doLote,
        numero(fAdicional.value) || 0,
        numero(fProduzida.value) || 0,
      )
    : null,
);
const recusasFechamento = computed(() => {
  if (!ordem.value || !painel.data.value) return [];
  const recusas = conferirFechamentoProducao({
    situacao: 'baixada',
    jaTemLote: false,
    quantidadePrevista: ordem.value.quantidadePrevista,
    quantidadeProduzida: numero(fProduzida.value),
    perda: numero(fPerda.value),
    produzidoEm: painel.data.value.agora,
    validadeEm: fValidade.value,
    numeroLote: fNumeroLote.value.trim() || null,
    custos: custosFechamento.value.doLote,
  });
  if (!(numero(fAdicional.value) >= 0))
    recusas.push({ codigo: 'adicional-invalido', mensagem: 'O valor adicional não pode ser negativo.' });
  return recusas;
});
const gravacaoFechamento = useMutation({
  mutationFn: () => {
    const o = ordem.value as OrdemAFecharTela;
    return fecharOrdemProducao(
      o.id,
      {
        versaoVista: o.versao,
        quantidadeProduzida: numero(fProduzida.value),
        perda: numero(fPerda.value),
        validadeEm: fValidade.value,
        numeroLote: fNumeroLote.value.trim() || null,
        custos: custosFechamento.value.mandados,
        valorAdicional: numero(fAdicional.value),
      },
      chaveFechamento,
    );
  },
  onSuccess: async (g) => {
    erro.value = null;
    aviso.value = avisoGravado(g);
    ordem.value = null;
    chaveFechamento = novaChaveContrato('prod-fecha');
    await recarregar();
  },
  onError: (x) => {
    erro.value = x;
  },
});

// ------------------------------------------------ montagem do kit
const kKit = ref<number | null>(null);
const kProduto = ref<ItemBusca | null>(null);
const kLocal = ref<number | null>(null);
const kQuantidade = ref('1');
const kValidade = ref('');
const kNumeroLote = ref('');
const kAdicional = ref('0');
const kCustos = reactive<Record<number, string>>({});
let chaveMontagem = novaChaveContrato('prod-kit');
const opcoesKit = computed(() => [
  { valor: null as number | null, rotulo: M.escolha },
  ...(painel.data.value?.kits ?? []).map((k) => ({
    valor: k.id as number | null,
    rotulo: `${k.codigo} · ${k.nome}`,
  })),
]);
const opcoesLocal = computed(() => [
  { valor: null as number | null, rotulo: M.escolha },
  ...(painel.data.value?.locais ?? []).map((l) => ({ valor: l.id as number | null, rotulo: l.nome })),
]);
const kitEscolhido = computed(() => painel.data.value?.kits.find((k) => k.id === kKit.value) ?? null);
const consumo = computed(() => {
  const k = kitEscolhido.value;
  const n = numero(kQuantidade.value);
  if (!k || !Number.isInteger(n) || n < 1) return [];
  return consumoDaMontagem(
    k.componentes.map((c) => ({ ...c, saldo: 0 })),
    n,
  ).map((u, i) => ({ ...u, nome: k.componentes[i]!.nome, porKit: k.componentes[i]!.quantidade }));
});
const custosKit = computed(() => custosDe(kCustos));
const recusasKit = computed(() => {
  const k = kitEscolhido.value;
  if (!k || !kProduto.value || !painel.data.value) return [];
  const recusas = conferirMontagemKit({
    kitAtivo: true,
    produto: kProduto.value.codigo,
    // O saldo do local a API confere na gravação (a leitura do painel não traz o saldo por componente).
    componentes: k.componentes.map((c) => ({ ...c, saldo: Number.POSITIVE_INFINITY })),
    quantidadeKits: numero(kQuantidade.value),
    produzidoEm: painel.data.value.agora,
    validadeEm: kValidade.value,
    numeroLote: kNumeroLote.value.trim() || null,
    custos: custosKit.value.doLote,
  });
  if (!(numero(kAdicional.value) >= 0))
    recusas.push({ codigo: 'adicional-invalido', mensagem: 'O valor adicional não pode ser negativo.' });
  return recusas;
});
const kitValido = computed(
  () => !!kitEscolhido.value && !!kProduto.value && kLocal.value !== null && recusasKit.value.length === 0,
);
const gravacaoKit = useMutation({
  mutationFn: () =>
    montarKitProducao(
      {
        kit: kKit.value as number,
        produto: (kProduto.value as ItemBusca).codigo,
        local: kLocal.value as number,
        quantidadeKits: numero(kQuantidade.value),
        validadeEm: kValidade.value,
        numeroLote: kNumeroLote.value.trim() || null,
        custos: custosKit.value.mandados,
        valorAdicional: numero(kAdicional.value),
      },
      chaveMontagem,
    ),
  onSuccess: async (g) => {
    erro.value = null;
    aviso.value = avisoGravado(g);
    chaveMontagem = novaChaveContrato('prod-kit');
    kKit.value = null;
    kProduto.value = null;
    kQuantidade.value = '1';
    kValidade.value = kNumeroLote.value = '';
    kAdicional.value = '0';
    for (const k of Object.keys(kCustos)) delete kCustos[Number(k)];
    await recarregar();
  },
  onError: (x) => {
    erro.value = x;
  },
});
</script>

<template>
  <section aria-labelledby="prod-titulo" data-testid="tela-farmacia-producao-interna">
    <h1 id="prod-titulo">{{ M.titulo }}</h1>
    <p>{{ M.texto }}</p>
    <ErroSuprimentos v-if="painel.error.value" :erro="painel.error.value" />
    <ErroSuprimentos v-if="erro" :erro="erro" />
    <p v-if="aviso" role="status" data-testid="prod-aviso">{{ aviso }}</p>
    <form class="filtros" @submit.prevent="aplicarPeriodo">
      <label class="campo">
        <span>{{ M.periodo.de }}</span>
        <input v-model="de" type="date" data-testid="prod-de" />
      </label>
      <label class="campo">
        <span>{{ M.periodo.ate }}</span>
        <input v-model="ate" type="date" data-testid="prod-ate" />
      </label>
      <button type="submit" class="botao" data-testid="prod-aplicar">{{ M.periodo.aplicar }}</button>
    </form>
    <p v-if="!painel.data.value && !painel.error.value">{{ M.carregando }}</p>
    <template v-else-if="painel.data.value">
      <!-- ------------------------------------------------ ordens baixadas a fechar -->
      <section class="painel" aria-labelledby="prod-fechar-titulo" data-testid="prod-fechar">
        <h2 id="prod-fechar-titulo">{{ M.fechar.titulo }}</h2>
        <p v-if="painel.data.value.aFechar.length === 0">{{ M.fechar.vazia }}</p>
        <table v-else class="tabela" data-testid="prod-ordens">
          <thead>
            <tr>
              <th>{{ M.fechar.colunas.numero }}</th>
              <th>{{ M.fechar.colunas.produto }}</th>
              <th>{{ M.fechar.colunas.finalidade }}</th>
              <th>{{ M.fechar.colunas.prevista }}</th>
              <th>{{ M.fechar.colunas.insumos }}</th>
              <th>{{ M.fechar.colunas.acao }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="o in painel.data.value.aFechar" :key="o.id" :data-testid="`prod-ordem-${o.id}`">
              <td>{{ o.numero }}</td>
              <td>{{ o.produtoNome }}</td>
              <td>{{ finalidade(o.finalidade) }}</td>
              <td>{{ qtd(o.quantidadePrevista) }}</td>
              <td>{{ real(o.valorInsumos) }}</td>
              <td>
                <button
                  v-if="podeGravar"
                  type="button"
                  class="link"
                  :data-testid="`prod-escolher-${o.id}`"
                  @click="escolherOrdem(o)"
                >
                  {{ M.fechar.escolher }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>

        <form
          v-if="ordem && podeGravar"
          data-testid="prod-fechamento"
          @submit.prevent="gravacaoFechamento.mutate()"
        >
          <h3>{{ fmt(M.fechar.ordem, { numero: ordem.numero, produto: ordem.produtoNome }) }}</h3>
          <p v-if="ordem.finalidade === 'prescricao'" class="secundario" data-testid="prod-dose">
            {{ M.fechar.dose }}
          </p>
          <div class="filtros">
            <label class="campo">
              <span>{{ M.fechar.produzida }}</span>
              <input v-model="fProduzida" inputmode="decimal" data-testid="prod-produzida" />
            </label>
            <label class="campo">
              <span>{{ M.fechar.perda }}</span>
              <input v-model="fPerda" inputmode="decimal" data-testid="prod-perda" />
            </label>
            <label class="campo">
              <span>{{ M.fechar.validade }}</span>
              <input v-model="fValidade" type="datetime-local" data-testid="prod-validade" />
            </label>
            <label class="campo">
              <span>{{ M.fechar.numeroLote }}</span>
              <input v-model="fNumeroLote" maxlength="50" data-testid="prod-numero-lote" />
            </label>
          </div>
          <fieldset>
            <legend>{{ M.custos.titulo }}</legend>
            <label v-for="c in custosComValor" :key="c.id" class="campo">
              <span>{{ fmt(M.custos.quantidade, { nome: c.descricao, valor: real(c.valor) }) }}</span>
              <input v-model="fCustos[c.id]" inputmode="decimal" :data-testid="`prod-custo-${c.id}`" />
            </label>
            <p v-for="c in custosSemValor" :key="c.id">{{ c.descricao }}: {{ M.custos.semValor }}</p>
            <label class="campo">
              <span>{{ M.custos.adicional }}</span>
              <input v-model="fAdicional" inputmode="decimal" data-testid="prod-adicional" />
            </label>
          </fieldset>
          <dl v-if="previaFechamento" data-testid="prod-previa">
            <dt>{{ M.custos.insumos }}</dt>
            <dd>{{ real(ordem.valorInsumos) }}</dd>
            <dt>{{ M.custos.indiretos }}</dt>
            <dd>
              {{ real(previaFechamento.valorIndireto) }}
              <ul>
                <li v-for="p in previaFechamento.custos" :key="p.custo">
                  {{
                    fmt(M.custos.parcela, {
                      nome: nomeDoCusto(p.custo),
                      quantidade: qtd(p.quantidade),
                      valor: real(p.valorUnitario),
                      total: real(p.valorTotal),
                    })
                  }}
                </li>
              </ul>
            </dd>
            <dt>{{ M.custos.adicional }}</dt>
            <dd>{{ real(numero(fAdicional) || 0) }}</dd>
            <dt>{{ M.custos.total }}</dt>
            <dd data-testid="prod-previa-total">{{ real(previaFechamento.valorTotal) }}</dd>
            <dt>{{ M.custos.porUnidade }}</dt>
            <dd data-testid="prod-previa-unidade">{{ realUnit(previaFechamento.custoUnitario) }}</dd>
          </dl>
          <ul v-if="recusasFechamento.length" data-testid="prod-fechamento-recusas">
            <li v-for="r in recusasFechamento" :key="r.codigo" role="alert">{{ r.mensagem }}</li>
          </ul>
          <button
            type="submit"
            class="botao"
            :disabled="recusasFechamento.length > 0 || gravacaoFechamento.isPending.value"
            data-testid="prod-fechar-gravar"
          >
            {{ M.fechar.gravar }}
          </button>
          <button type="button" class="link" data-testid="prod-fechar-cancelar" @click="ordem = null">
            {{ M.fechar.cancelar }}
          </button>
        </form>
      </section>

      <!-- ------------------------------------------------ montagem do kit -->
      <section class="painel" aria-labelledby="prod-kit-titulo" data-testid="prod-kit">
        <h2 id="prod-kit-titulo">{{ M.kit.titulo }}</h2>
        <p v-if="painel.data.value.kits.length === 0">{{ M.kit.vazio }}</p>
        <form v-else-if="podeGravar" data-testid="prod-montagem" @submit.prevent="gravacaoKit.mutate()">
          <div class="filtros">
            <SanteSelecao
              v-model="kKit"
              :rotulo="M.kit.kit"
              :opcoes="opcoesKit"
              class="campo"
              data-testid="prod-kit-kit"
            />
            <SanteSelecao
              v-model="kLocal"
              :rotulo="M.kit.local"
              :opcoes="opcoesLocal"
              class="campo"
              data-testid="prod-kit-local"
            />
            <label class="campo">
              <span>{{ M.kit.quantidade }}</span>
              <input v-model="kQuantidade" inputmode="numeric" data-testid="prod-kit-quantidade" />
            </label>
            <label class="campo">
              <span>{{ M.kit.validade }}</span>
              <input v-model="kValidade" type="datetime-local" data-testid="prod-kit-validade" />
            </label>
            <label class="campo">
              <span>{{ M.kit.numeroLote }}</span>
              <input v-model="kNumeroLote" maxlength="50" data-testid="prod-kit-numero-lote" />
            </label>
          </div>
          <p v-if="kProduto" data-testid="prod-kit-produto">
            {{ M.kit.produto }}: {{ kProduto.codigo }} · {{ kProduto.nome }}
            <button type="button" class="link" @click="kProduto = null">{{ M.kit.trocar }}</button>
          </p>
          <BuscaItem v-else :rotulo="M.kit.produto" testid="prod-kit-busca" @escolher="kProduto = $event" />
          <div v-if="consumo.length" data-testid="prod-kit-consumo">
            <h3>{{ M.kit.consumo }}</h3>
            <ul>
              <li v-for="u in consumo" :key="u.insumo">
                {{
                  fmt(M.kit.linhaConsumo, {
                    nome: u.nome,
                    porKit: qtd(u.porKit),
                    kits: kQuantidade,
                    total: qtd(u.quantidade),
                  })
                }}
              </li>
            </ul>
            <p>{{ M.kit.saldoNoServidor }}</p>
          </div>
          <fieldset>
            <legend>{{ M.custos.titulo }}</legend>
            <label v-for="c in custosComValor" :key="c.id" class="campo">
              <span>{{ fmt(M.custos.quantidade, { nome: c.descricao, valor: real(c.valor) }) }}</span>
              <input v-model="kCustos[c.id]" inputmode="decimal" :data-testid="`prod-kit-custo-${c.id}`" />
            </label>
            <label class="campo">
              <span>{{ M.custos.adicional }}</span>
              <input v-model="kAdicional" inputmode="decimal" data-testid="prod-kit-adicional" />
            </label>
          </fieldset>
          <ul v-if="recusasKit.length" data-testid="prod-kit-recusas">
            <li v-for="r in recusasKit" :key="r.codigo" role="alert">{{ r.mensagem }}</li>
          </ul>
          <button
            type="submit"
            class="botao"
            :disabled="!kitValido || gravacaoKit.isPending.value"
            data-testid="prod-kit-gravar"
          >
            {{ M.kit.gravar }}
          </button>
        </form>
      </section>

      <!-- ------------------------------------------------ lotes produzidos -->
      <section class="painel" aria-labelledby="prod-lotes-titulo">
        <h2 id="prod-lotes-titulo">{{ M.lotes.titulo }}</h2>
        <p v-if="painel.data.value.lotes.length === 0">{{ M.lotes.vazio }}</p>
        <table v-else class="tabela" data-testid="prod-lotes">
          <thead>
            <tr>
              <th>{{ M.lotes.colunas.lote }}</th>
              <th>{{ M.lotes.colunas.tipo }}</th>
              <th>{{ M.lotes.colunas.produto }}</th>
              <th>{{ M.lotes.colunas.origem }}</th>
              <th>{{ M.lotes.colunas.quantidade }}</th>
              <th>{{ M.lotes.colunas.perda }}</th>
              <th>{{ M.lotes.colunas.produzido }}</th>
              <th>{{ M.lotes.colunas.validade }}</th>
              <th>{{ M.lotes.colunas.total }}</th>
              <th>{{ M.lotes.colunas.unidade }}</th>
              <th>{{ M.lotes.colunas.situacao }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="l in painel.data.value.lotes" :key="l.id">
              <td>{{ l.numeroLote }}</td>
              <td>{{ M.lotes.tipos[l.tipo] }}</td>
              <td>{{ l.produtoNome }}</td>
              <td>
                {{ l.ordemNumero !== null ? fmt(M.lotes.ordem, { numero: l.ordemNumero }) : l.kitNome }}
              </td>
              <td>{{ qtd(l.quantidadeProduzida) }}</td>
              <td>{{ qtd(l.perda) }}</td>
              <td>{{ quandoBr(l.produzidoEm) }}</td>
              <td>{{ quandoBr(l.validadeEm) }}</td>
              <td>{{ real(l.valorTotal) }}</td>
              <td>{{ l.custoUnitario !== null ? realUnit(l.custoUnitario) : '' }}</td>
              <td>{{ l.situacao }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </section>
</template>
