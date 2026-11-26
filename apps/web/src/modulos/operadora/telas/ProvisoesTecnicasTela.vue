<script setup lang="ts">
// Contabilidade regulatória da operadora (08-SGO L111, C3-026): o plano de contas padrão da ANS, o mapa das contas
// contábeis próprias para ele (por operadora), o balancete no padrão da ANS numa data e as provisões técnicas por
// competência (cálculo pela metodologia da ANS ou pela nota técnica atuarial, contabilização da variação e
// cancelamento). As regras (conta-mãe, mapa só em conta analítica, rollup, PEONA) estão no domínio e no servidor; a
// tela só monta o pedido e mostra a resposta.
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { lerApoioAns } from '../api-ans.js';
import {
  type BalanceteAns,
  buscarContasContabeis,
  calcularProvisoes,
  cancelarProvisao,
  contabilizarProvisao,
  type ContaAns,
  encerrarMapa,
  incluirContaAns,
  incluirMapa,
  lerBalanceteAns,
  lerMapa,
  lerPlanoAns,
  lerProvisoes,
  type MapaConta,
  type MetodoProvisao,
  type PedidoCalculo,
  type Provisao,
} from '../api-provisao-tecnica.js';
import { mensagensProvisaoTecnica } from '../i18n-provisao-tecnica.js';

const { t } = useI18n({ useScope: 'local', messages: { 'pt-BR': mensagensProvisaoTecnica } });
type Aba = 'plano' | 'mapa' | 'balancete' | 'provisoes';
const aba = ref<Aba>('plano');
const operadoras = ref<{ valor: number | null; rotulo: string }[]>([]);
const operadora = ref<number | null>(null);
const erro = ref<string | null>(null);
const aviso = ref<string | null>(null);
const moeda = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const centavos = (c: number) => moeda(c / 100);
const dataBr = (v: string | null) => (v ? v.split('-').reverse().join('/') : t('vazio'));
const ehData = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const numero = (v: string): number | null => {
  const s = v.trim().replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Number(s);
};
const simNao = computed(() => [
  { valor: false, rotulo: t('nao') },
  { valor: true, rotulo: t('sim') },
]);

async function tentar<T>(fn: () => Promise<T>, ok?: string): Promise<T | null> {
  erro.value = null;
  aviso.value = null;
  try {
    const r = await fn();
    if (ok) aviso.value = ok;
    return r;
  } catch (e) {
    erro.value = e instanceof Error ? e.message : String(e);
    return null;
  }
}

void tentar(async () => {
  const a = await lerApoioAns();
  operadoras.value = a.operadoras.map((o) => ({ valor: o.id, rotulo: `${o.nome} (${o.registroAns})` }));
  if (a.operadoras.length === 1) operadora.value = a.operadoras[0]!.id;
});

// ---------------------------------------------------------- contas contábeis (busca remota) --------------------------
const contasOpcoes = ref<{ valor: number | null; rotulo: string }[]>([]);
const conhecidas = new Map<number, string>();
async function buscarContas(termo: string) {
  if (termo.trim().length < 1) return;
  const r = await tentar(() => buscarContasContabeis(termo));
  if (!r) return;
  for (const c of r) conhecidas.set(c.id, `${c.classificacao} ${c.descricao}`);
  const ids = new Set(r.map((c) => c.id));
  for (const v of [
    contaPropria.value,
    contaPeona.value,
    contaPesl.value,
    contaDespesa.value,
    contaReversao.value,
  ])
    if (v !== null) ids.add(v);
  contasOpcoes.value = [...ids].map((id) => ({ valor: id, rotulo: conhecidas.get(id) ?? String(id) }));
}

// ---------------------------------------------------------- plano padrão da ANS -------------------------------------
const plano = ref<ContaAns[]>([]);
const codigo = ref('');
const descricao = ref('');
const tipoConta = ref<'sintetica' | 'analitica' | null>(null);
const natureza = ref<'devedora' | 'credora' | 'nenhuma'>('nenhuma');
const inicioConta = ref('');
const fonte = ref(t('plano.versaoFontePadrao'));
const tiposConta = computed(() =>
  (['sintetica', 'analitica'] as const).map((v) => ({ valor: v, rotulo: t(`plano.tipos.${v}`) })),
);
const naturezas = computed(() =>
  (['nenhuma', 'devedora', 'credora'] as const).map((v) => ({ valor: v, rotulo: t(`plano.naturezas.${v}`) })),
);
const podeIncluirConta = computed(
  () =>
    /^\d+$/.test(codigo.value.trim()) &&
    descricao.value.trim() !== '' &&
    tipoConta.value !== null &&
    ehData(inicioConta.value) &&
    fonte.value.trim() !== '',
);
async function carregarPlano() {
  plano.value = (await tentar(lerPlanoAns)) ?? [];
}
async function incluirConta() {
  if (!podeIncluirConta.value || tipoConta.value === null) return;
  const r = await tentar(
    () =>
      incluirContaAns({
        codigo: codigo.value.trim(),
        descricao: descricao.value.trim(),
        tipo: tipoConta.value!,
        natureza: natureza.value === 'nenhuma' ? null : natureza.value,
        modalidades: null,
        vigenciaInicio: inicioConta.value,
        vigenciaFim: null,
        versaoFonte: fonte.value.trim(),
      }),
    t('salvo'),
  );
  if (r) {
    codigo.value = '';
    descricao.value = '';
    await carregarPlano();
    aviso.value = t('salvo');
  }
}

// ---------------------------------------------------------- mapa das contas -----------------------------------------
const mapas = ref<MapaConta[]>([]);
const contaPropria = ref<number | null>(null);
const contaAns = ref<string | null>(null);
const duplica = ref(false);
const inicioMapa = ref('');
const fimMapa = ref<Record<number, string>>({});
const contasAnsAnaliticas = computed(() =>
  plano.value
    .filter((c) => c.tipo === 'analitica' && c.vigenciaFim === null)
    .map((c) => ({ valor: c.codigo, rotulo: `${c.codigo} ${c.descricao}` })),
);
const podeMapear = computed(
  () =>
    operadora.value !== null &&
    contaPropria.value !== null &&
    contaAns.value !== null &&
    ehData(inicioMapa.value),
);
async function carregarMapa() {
  if (operadora.value === null) return;
  mapas.value = (await tentar(() => lerMapa(operadora.value!))) ?? [];
}
async function mapear() {
  if (!podeMapear.value) return;
  const r = await tentar(() =>
    incluirMapa(operadora.value!, {
      contaContabil: contaPropria.value!,
      contaAns: contaAns.value!,
      duplicaValor: duplica.value,
      grupo: null,
      subgrupo: null,
      paginaDiops: null,
      linhaDiops: null,
      vigenciaInicio: inicioMapa.value,
      vigenciaFim: null,
    }),
  );
  if (r) {
    contaPropria.value = null;
    await carregarMapa();
    aviso.value = t('salvo');
  }
}
async function encerrar(m: MapaConta) {
  const fim = fimMapa.value[m.id] ?? '';
  if (!ehData(fim)) return;
  const r = await tentar(() => encerrarMapa(m.id, m.versao, fim));
  if (r) {
    await carregarMapa();
    aviso.value = t('mapa.encerrado');
  }
}

// ---------------------------------------------------------- balancete no padrão da ANS ------------------------------
const dataBalancete = ref('');
const balancete = ref<BalanceteAns | null>(null);
async function montarBalancete() {
  if (operadora.value === null || !ehData(dataBalancete.value)) return;
  balancete.value = await tentar(() => lerBalanceteAns(operadora.value!, dataBalancete.value));
}

// ---------------------------------------------------------- provisões técnicas -------------------------------------
const provisoes = ref<Provisao[]>([]);
const competencia = ref('');
const metodo = ref<MetodoProvisao>('metodologia_ans');
const metodos = computed(() =>
  (['metodologia_ans', 'nota_tecnica_atuarial'] as const).map((v) => ({
    valor: v,
    rotulo: t(`provisoes.metodos.${v}`),
  })),
);
const contaPeona = ref<number | null>(null);
const contaPesl = ref<number | null>(null);
const origemBase = ref<'sistema' | 'informada'>('sistema');
const origens = computed(() =>
  (['sistema', 'informada'] as const).map((v) => ({ valor: v, rotulo: t(`provisoes.origens.${v}`) })),
);
const contraprestacoes = ref('');
const eventos = ref('');
const avisados = ref('');
const valorPeona = ref('');
const valorPesl = ref('');
const notaTecnica = ref('');
const contaDespesa = ref<number | null>(null);
const contaReversao = ref<number | null>(null);
const motivo = ref<Record<number, string>>({});
const competenciaIso = computed(() =>
  /^\d{4}-(0[1-9]|1[0-2])$/.test(competencia.value.trim()) ? `${competencia.value.trim()}-01` : null,
);
const vigente = computed(
  () =>
    provisoes.value.find((p) => p.competencia === competenciaIso.value && p.situacao === 'calculada') ?? null,
);
const situacaoProvisao = (s: Provisao['situacao']) => t(`provisoes.situacoes.${s}`);
const tipoProvisao = (s: Provisao['itens'][number]['tipo']) => t(`provisoes.tipos.${s}`);

function montarPedido(): PedidoCalculo | null {
  if (competenciaIso.value === null || contaPeona.value === null || contaPesl.value === null) return null;
  const contas = { peona: contaPeona.value, pesl: contaPesl.value };
  if (metodo.value === 'metodologia_ans') {
    let base: PedidoCalculo['base'] = null;
    if (origemBase.value === 'informada') {
      const [c, e, a] = [numero(contraprestacoes.value), numero(eventos.value), numero(avisados.value)];
      if (c === null || e === null || a === null) return null;
      base = { contraprestacoes: c, eventos: e, avisadosNaoPagos: a };
    }
    return {
      competencia: competenciaIso.value,
      metodo: 'metodologia_ans',
      contas,
      base,
      informados: [],
      notaTecnica: null,
      versao: vigente.value?.versao ?? null,
    };
  }
  const [p, s] = [numero(valorPeona.value), numero(valorPesl.value)];
  if (p === null || s === null || notaTecnica.value.trim() === '') return null;
  return {
    competencia: competenciaIso.value,
    metodo: 'nota_tecnica_atuarial',
    contas,
    base: null,
    informados: [
      { tipo: 'peona', valor: p, observacao: null },
      { tipo: 'pesl', valor: s, observacao: null },
    ],
    notaTecnica: notaTecnica.value.trim(),
    versao: vigente.value?.versao ?? null,
  };
}
const podeCalcular = computed(() => montarPedido() !== null);
async function carregarProvisoes() {
  provisoes.value = (await tentar(lerProvisoes)) ?? [];
}
async function calcular() {
  const pedido = montarPedido();
  if (!pedido) {
    erro.value = t('provisoes.valorInvalido');
    return;
  }
  const r = await tentar(() => calcularProvisoes(pedido));
  if (r) {
    await carregarProvisoes();
    aviso.value = t('salvo');
  }
}
async function contabilizar(p: Provisao) {
  if (contaDespesa.value === null) return;
  const r = await tentar(() =>
    contabilizarProvisao(p.id, p.versao, contaDespesa.value!, contaReversao.value),
  );
  if (r) {
    await carregarProvisoes();
    aviso.value = t('salvo');
  }
}
async function cancelar(p: Provisao) {
  const m = (motivo.value[p.id] ?? '').trim();
  if (!m) return;
  const r = await tentar(() => cancelarProvisao(p.id, p.versao, m));
  if (r) {
    await carregarProvisoes();
    aviso.value = t('salvo');
  }
}

void carregarPlano();
void carregarProvisoes();
watch(operadora, () => {
  balancete.value = null;
  void carregarMapa();
});
</script>

<template>
  <section class="provisoes" data-testid="tela-provisoes-tecnicas">
    <h1>{{ t('titulo') }}</h1>
    <p class="provisoes__ajuda">{{ t('explicacao') }}</p>
    <SanteSelecao
      id="prov-operadora"
      v-model="operadora"
      :rotulo="t('operadora')"
      :opcoes="operadoras"
      data-testid="prov-operadora"
    />
    <nav class="provisoes__linha" :aria-label="t('abasRotulo')">
      <SanteBotao
        v-for="a in ['plano', 'mapa', 'balancete', 'provisoes'] as const"
        :key="a"
        :rotulo="t(`abas.${a}`)"
        :variante="aba === a ? 'primario' : 'secundario'"
        :data-testid="`aba-${a}`"
        @click="aba = a"
      />
    </nav>
    <SanteAlerta v-if="erro" :texto="erro" variante="alerta" anunciar data-testid="prov-erro" />
    <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="prov-aviso" />

    <div v-if="aba === 'plano'" class="provisoes__painel" data-testid="painel-plano">
      <div class="provisoes__linha">
        <SanteCampoTexto
          id="plano-codigo"
          v-model="codigo"
          :max-bytes="30"
          :rotulo="t('plano.codigo')"
          data-testid="plano-codigo"
        />
        <SanteCampoTexto
          id="plano-descricao"
          v-model="descricao"
          :max-bytes="255"
          :rotulo="t('plano.descricao')"
          data-testid="plano-descricao"
        />
        <SanteSelecao
          id="plano-tipo"
          v-model="tipoConta"
          :rotulo="t('plano.tipo')"
          :opcoes="tiposConta"
          data-testid="plano-tipo"
        />
        <SanteSelecao
          id="plano-natureza"
          v-model="natureza"
          :rotulo="t('plano.natureza')"
          :opcoes="naturezas"
          data-testid="plano-natureza"
        />
        <SanteCampoTexto
          id="plano-inicio"
          v-model="inicioConta"
          :max-bytes="10"
          :rotulo="t('plano.vigenciaInicio')"
          data-testid="plano-inicio"
        />
        <SanteCampoTexto
          id="plano-fonte"
          v-model="fonte"
          :max-bytes="30"
          :rotulo="t('plano.versaoFonte')"
          data-testid="plano-fonte"
        />
        <SanteBotao
          :rotulo="t('plano.incluir')"
          :desabilitado="!podeIncluirConta"
          data-testid="plano-incluir"
          @click="incluirConta"
        />
      </div>
      <p v-if="!plano.length">{{ t('nenhum') }}</p>
      <table v-else class="provisoes__tabela" data-testid="plano-tabela">
        <thead>
          <tr>
            <th scope="col">{{ t('plano.codigo') }}</th>
            <th scope="col">{{ t('plano.descricao') }}</th>
            <th scope="col">{{ t('plano.tipo') }}</th>
            <th scope="col">{{ t('plano.grau') }}</th>
            <th scope="col">{{ t('plano.vigencia') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in plano" :key="c.id" :data-testid="`plano-conta-${c.codigo}`">
            <td>{{ c.codigo }}</td>
            <td>{{ c.descricao }}</td>
            <td>{{ t(`plano.tipos.${c.tipo}`) }}</td>
            <td>{{ c.grau }}</td>
            <td>{{ t('periodo', { inicio: dataBr(c.vigenciaInicio), fim: dataBr(c.vigenciaFim) }) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="aba === 'mapa'" class="provisoes__painel" data-testid="painel-mapa">
      <p v-if="operadora === null">{{ t('escolhaOperadora') }}</p>
      <template v-else>
        <div class="provisoes__linha">
          <SanteSelecao
            id="mapa-propria"
            v-model="contaPropria"
            :rotulo="t('mapa.contaContabil')"
            :opcoes="contasOpcoes"
            :buscar="buscarContas"
            data-testid="mapa-propria"
          />
          <SanteSelecao
            id="mapa-ans"
            v-model="contaAns"
            :rotulo="t('mapa.contaAns')"
            :opcoes="contasAnsAnaliticas"
            data-testid="mapa-ans"
          />
          <SanteSelecao
            id="mapa-duplica"
            v-model="duplica"
            :rotulo="t('mapa.duplicaValor')"
            :opcoes="simNao"
            data-testid="mapa-duplica"
          />
          <SanteCampoTexto
            id="mapa-inicio"
            v-model="inicioMapa"
            :max-bytes="10"
            :rotulo="t('mapa.vigenciaInicio')"
            data-testid="mapa-inicio"
          />
          <SanteBotao
            :rotulo="t('mapa.incluir')"
            :desabilitado="!podeMapear"
            data-testid="mapa-incluir"
            @click="mapear"
          />
        </div>
        <p v-if="!mapas.length">{{ t('nenhum') }}</p>
        <table v-else class="provisoes__tabela" data-testid="mapa-tabela">
          <thead>
            <tr>
              <th scope="col">{{ t('mapa.colunas.propria') }}</th>
              <th scope="col">{{ t('mapa.colunas.ans') }}</th>
              <th scope="col">{{ t('mapa.colunas.vigencia') }}</th>
              <th scope="col">{{ t('mapa.colunas.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in mapas" :key="m.id" :data-testid="`mapa-linha-${m.id}`">
              <td>{{ m.classificacao }} {{ m.contaDescricao }}</td>
              <td>{{ m.contaAns }} {{ m.contaAnsDescricao }}</td>
              <td>{{ t('periodo', { inicio: dataBr(m.vigenciaInicio), fim: dataBr(m.vigenciaFim) }) }}</td>
              <td class="provisoes__linha">
                <template v-if="m.ativo && m.vigenciaFim === null">
                  <SanteCampoTexto
                    :id="`mapa-fim-${m.id}`"
                    v-model="fimMapa[m.id]"
                    :max-bytes="10"
                    :rotulo="t('mapa.fim')"
                    :data-testid="`mapa-fim-${m.id}`"
                  />
                  <SanteBotao
                    :rotulo="t('mapa.encerrar')"
                    variante="destrutivo"
                    :confirmacao="t('mapa.confirmarEncerrar')"
                    :data-testid="`mapa-encerrar-${m.id}`"
                    @click="encerrar(m)"
                  />
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </template>
    </div>

    <div v-if="aba === 'balancete'" class="provisoes__painel" data-testid="painel-balancete">
      <p v-if="operadora === null">{{ t('escolhaOperadora') }}</p>
      <template v-else>
        <div class="provisoes__linha">
          <SanteCampoTexto
            id="balancete-data"
            v-model="dataBalancete"
            :max-bytes="10"
            :rotulo="t('balancete.data')"
            data-testid="balancete-data"
          />
          <SanteBotao
            :rotulo="t('balancete.montar')"
            data-testid="balancete-montar"
            @click="montarBalancete"
          />
        </div>
        <template v-if="balancete">
          <table class="provisoes__tabela" data-testid="balancete-tabela">
            <thead>
              <tr>
                <th scope="col">{{ t('balancete.colunas.codigo') }}</th>
                <th scope="col">{{ t('balancete.colunas.descricao') }}</th>
                <th scope="col">{{ t('balancete.colunas.saldo') }}</th>
                <th scope="col">{{ t('balancete.colunas.parcelas') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="l in balancete.linhas" :key="l.codigo" :data-testid="`balancete-linha-${l.codigo}`">
                <td :style="{ paddingLeft: `${l.grau}ch` }">{{ l.codigo }}</td>
                <td>{{ l.descricao }}</td>
                <td>{{ centavos(l.saldoCentavos) }}</td>
                <td>
                  <span v-for="p in l.parcelas" :key="p.classificacao" class="provisoes__parcela">
                    {{ p.classificacao }}: {{ centavos(p.saldoCentavos) }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
          <template v-if="balancete.semMapa.length">
            <h2>{{ t('balancete.semMapa') }}</h2>
            <ul data-testid="balancete-sem-mapa">
              <li v-for="s in balancete.semMapa" :key="s.contaContabil">
                {{ s.classificacao }}: {{ centavos(s.saldoCentavos) }}
              </li>
            </ul>
          </template>
          <p data-testid="balancete-diferenca">
            {{
              balancete.diferencaCentavos === 0
                ? t('balancete.fecha')
                : t('balancete.diferenca', { valor: centavos(balancete.diferencaCentavos) })
            }}
          </p>
        </template>
      </template>
    </div>

    <div v-if="aba === 'provisoes'" class="provisoes__painel" data-testid="painel-provisoes">
      <p class="provisoes__ajuda">{{ t('provisoes.ajudaMetodo') }}</p>
      <div class="provisoes__linha">
        <SanteCampoTexto
          id="prov-competencia"
          v-model="competencia"
          :max-bytes="7"
          :rotulo="t('provisoes.competencia')"
          data-testid="prov-competencia"
        />
        <SanteSelecao
          id="prov-metodo"
          v-model="metodo"
          :rotulo="t('provisoes.metodo')"
          :opcoes="metodos"
          data-testid="prov-metodo"
        />
        <SanteSelecao
          id="prov-conta-peona"
          v-model="contaPeona"
          :rotulo="t('provisoes.contaPeona')"
          :opcoes="contasOpcoes"
          :buscar="buscarContas"
          data-testid="prov-conta-peona"
        />
        <SanteSelecao
          id="prov-conta-pesl"
          v-model="contaPesl"
          :rotulo="t('provisoes.contaPesl')"
          :opcoes="contasOpcoes"
          :buscar="buscarContas"
          data-testid="prov-conta-pesl"
        />
      </div>
      <div v-if="metodo === 'metodologia_ans'" class="provisoes__linha">
        <SanteSelecao
          id="prov-origem"
          v-model="origemBase"
          :rotulo="t('provisoes.origemBase')"
          :opcoes="origens"
          data-testid="prov-origem"
        />
        <template v-if="origemBase === 'informada'">
          <SanteCampoTexto
            id="prov-contraprestacoes"
            v-model="contraprestacoes"
            :max-bytes="20"
            :rotulo="t('provisoes.contraprestacoes')"
            data-testid="prov-contraprestacoes"
          />
          <SanteCampoTexto
            id="prov-eventos"
            v-model="eventos"
            :max-bytes="20"
            :rotulo="t('provisoes.eventos')"
            data-testid="prov-eventos"
          />
          <SanteCampoTexto
            id="prov-avisados"
            v-model="avisados"
            :max-bytes="20"
            :rotulo="t('provisoes.avisados')"
            data-testid="prov-avisados"
          />
        </template>
      </div>
      <div v-else class="provisoes__linha">
        <SanteCampoTexto
          id="prov-valor-peona"
          v-model="valorPeona"
          :max-bytes="20"
          :rotulo="t('provisoes.valorPeona')"
          data-testid="prov-valor-peona"
        />
        <SanteCampoTexto
          id="prov-valor-pesl"
          v-model="valorPesl"
          :max-bytes="20"
          :rotulo="t('provisoes.valorPesl')"
          data-testid="prov-valor-pesl"
        />
        <SanteCampoTexto
          id="prov-nota"
          v-model="notaTecnica"
          :max-bytes="200"
          :rotulo="t('provisoes.notaTecnica')"
          data-testid="prov-nota"
        />
      </div>
      <div class="provisoes__linha">
        <SanteBotao
          :rotulo="vigente ? t('provisoes.recalcular') : t('provisoes.calcular')"
          :desabilitado="!podeCalcular"
          data-testid="prov-calcular"
          @click="calcular"
        />
      </div>
      <div class="provisoes__linha">
        <SanteSelecao
          id="prov-conta-despesa"
          v-model="contaDespesa"
          :rotulo="t('provisoes.contaDespesa')"
          :opcoes="contasOpcoes"
          :buscar="buscarContas"
          data-testid="prov-conta-despesa"
        />
        <SanteSelecao
          id="prov-conta-reversao"
          v-model="contaReversao"
          :rotulo="t('provisoes.contaReversao')"
          :opcoes="contasOpcoes"
          :buscar="buscarContas"
          data-testid="prov-conta-reversao"
        />
      </div>
      <p v-if="!provisoes.length">{{ t('nenhum') }}</p>
      <table v-else class="provisoes__tabela" data-testid="prov-tabela">
        <thead>
          <tr>
            <th scope="col">{{ t('provisoes.colunas.competencia') }}</th>
            <th scope="col">{{ t('provisoes.colunas.metodo') }}</th>
            <th scope="col">{{ t('provisoes.colunas.situacao') }}</th>
            <th scope="col">{{ t('provisoes.colunas.total') }}</th>
            <th scope="col">{{ t('provisoes.colunas.itens') }}</th>
            <th scope="col">{{ t('provisoes.colunas.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in provisoes" :key="p.id" :data-testid="`prov-linha-${p.id}`">
            <td>{{ p.competencia.slice(0, 7) }}</td>
            <td>{{ t(`provisoes.metodos.${p.metodo}`) }}</td>
            <td :data-testid="`prov-situacao-${p.id}`">{{ situacaoProvisao(p.situacao) }}</td>
            <td>{{ moeda(p.total) }}</td>
            <td>
              <span v-for="i in p.itens" :key="i.id" class="provisoes__parcela">
                {{
                  t('provisoes.item', {
                    tipo: tipoProvisao(i.tipo),
                    conta: i.classificacao,
                    valor: moeda(i.valor),
                    anterior: i.valorAnterior === null ? t('vazio') : moeda(i.valorAnterior),
                  })
                }}
              </span>
            </td>
            <td class="provisoes__linha">
              <template v-if="p.situacao === 'calculada'">
                <SanteBotao
                  :rotulo="t('provisoes.contabilizar')"
                  :desabilitado="contaDespesa === null"
                  :data-testid="`prov-contabilizar-${p.id}`"
                  @click="contabilizar(p)"
                />
              </template>
              <template v-if="p.situacao === 'aberta' || p.situacao === 'calculada'">
                <SanteCampoTexto
                  :id="`prov-motivo-${p.id}`"
                  v-model="motivo[p.id]"
                  :max-bytes="500"
                  :rotulo="t('provisoes.motivo')"
                  :data-testid="`prov-motivo-${p.id}`"
                />
                <SanteBotao
                  :rotulo="t('provisoes.cancelar')"
                  variante="destrutivo"
                  :confirmacao="t('provisoes.confirmarCancelar')"
                  :data-testid="`prov-cancelar-${p.id}`"
                  @click="cancelar(p)"
                />
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.provisoes,
.provisoes__painel {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
}
.provisoes__linha {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: flex-end;
}
.provisoes__ajuda {
  color: var(--sgh-texto-secundario);
}
.provisoes__parcela {
  display: block;
}
.provisoes__tabela {
  width: 100%;
  border-collapse: collapse;
}
.provisoes__tabela th,
.provisoes__tabela td {
  text-align: left;
  padding: var(--sgh-espaco-1);
}
</style>
