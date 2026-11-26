<script setup lang="ts">
// LALUR/LACS e apuração do IRPJ e da CSLL do lucro real (C3-023, 07-FIN linha 115, F7): o estabelecimento e o período,
// os ajustes da parte A com a ligação à parte B, as contas da parte B, a configuração da provisão, a apuração com a
// compensação de 30%, a provisão, o fechamento e o bloco M da ECF. O servidor confere cada regra de novo.
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../casca/MensagemErro.vue';
import { pode } from '../../casca/sessao/pode.js';
import {
  abrirApuracaoLalur,
  apurarLalur,
  excluirAjusteLalur,
  estornarProvisaoLalur,
  fecharLalur,
  incluirAjusteLalur,
  incluirContaParteB,
  lerApoioLalur,
  lerApuracaoLalur,
  provisionarLalur,
  salvarConfiguracaoLalur,
} from './api-lalur.js';

const { t } = useI18n();
const k = (c: string, p?: Record<string, unknown>) => t(`lalur.${c}`, p ?? {});
const cliente = useQueryClient();
const podeEditar = computed(() => pode('contabil.lalur.editar'));
const podeApurar = computed(() => pode('contabil.lalur.apurar'));
const reais = (centavos: number) =>
  (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const estabelecimento = ref<number | null>(null);
const apoio = useQuery({
  queryKey: computed(() => ['lalur', 'apoio', estabelecimento.value]),
  queryFn: () => lerApoioLalur(estabelecimento.value),
});
watch(
  () => apoio.data.value?.estabelecimento,
  (e) => {
    if (estabelecimento.value === null && e) estabelecimento.value = e;
  },
  { immediate: true },
);
const apuracao = ref<number | null>(null);
watch(
  () => apoio.data.value?.apuracoes,
  (as) => {
    if (apuracao.value === null && as?.length) apuracao.value = as[0]!.id;
  },
  { immediate: true },
);
const detalhe = useQuery({
  queryKey: computed(() => ['lalur', 'apuracao', apuracao.value]),
  queryFn: () => lerApuracaoLalur(apuracao.value!),
  enabled: computed(() => apuracao.value !== null),
});

const opEstabelecimentos = computed(() =>
  (apoio.data.value?.estabelecimentos ?? []).map((e) => ({ valor: e.id as number | null, rotulo: e.nome })),
);
const opApuracoes = computed(() =>
  (apoio.data.value?.apuracoes ?? []).map((a) => ({
    valor: a.id as number | null,
    rotulo: `${k(`formas.${a.forma}`)} ${a.inicio} a ${a.fim} (${k(`situacoes.${a.situacao}`)})`,
  })),
);
const opFormas = computed(() =>
  (apoio.data.value?.formas ?? []).map((f) => ({ valor: f, rotulo: k(`formas.${f}`) })),
);
const opContas = computed(() =>
  (apoio.data.value?.contasContabeis ?? []).map((c) => ({
    valor: c.id as number | null,
    rotulo: `${c.classificacao} ${c.descricao}`,
  })),
);
const contasB = computed(() => apoio.data.value?.contasParteB ?? []);
const opContasB = (tributo?: 'irpj' | 'csll') => [
  { valor: null as number | null, rotulo: k(tributo ? 'apurar.nenhuma' : 'ajustes.semContaB') },
  ...contasB.value
    .filter((c) => !tributo || c.tributo === tributo || c.tributo === 'ambos')
    .map((c) => ({ valor: c.id as number | null, rotulo: `${c.codigo} ${c.descricao}` })),
];
const opTipos = ['adicao', 'exclusao'].map((x) => ({ valor: x, rotulo: k(`ajustes.tipos.${x}`) }));
const opEfeitos = ['constitui', 'baixa'].map((x) => ({ valor: x, rotulo: k(`ajustes.efeitos.${x}`) }));
const opTributos = ['irpj', 'csll', 'ambos'].map((x) => ({ valor: x, rotulo: k(`parteB.tributos.${x}`) }));
const opNaturezas = ['devedor', 'credor'].map((x) => ({ valor: x, rotulo: k(`parteB.naturezas.${x}`) }));

const erro = ref<unknown>(null);
const aviso = ref('');
const acao = useMutation({
  mutationFn: (fn: () => Promise<{ mensagem: string; resultado: Record<string, unknown> }>) => fn(),
  onSuccess: (r) => {
    erro.value = null;
    aviso.value = r.mensagem;
    if (typeof r.resultado['apuracao'] === 'number' && apuracao.value === null)
      apuracao.value = r.resultado['apuracao'];
    void cliente.invalidateQueries({ queryKey: ['lalur'] });
  },
  onError: (e) => {
    erro.value = e;
    aviso.value = '';
  },
});

const abrir = reactive({ forma: 'trimestral', inicio: '', fim: '' });
const abrirPeriodo = () => {
  if (estabelecimento.value === null) return;
  acao.mutate(() => abrirApuracaoLalur({ estabelecimento: estabelecimento.value, ...abrir }));
};

const cfg = reactive({
  irpjDebito: null as number | null,
  irpjCredito: null as number | null,
  csllDebito: null as number | null,
  csllCredito: null as number | null,
  aliquotaIrpj: 15,
  aliquotaAdicional: 10,
  limiteAdicionalMensal: 20000,
  aliquotaCsll: 9,
});
watch(
  () => apoio.data.value?.configuracao,
  (c) => {
    if (c) Object.assign(cfg, c);
  },
  { immediate: true },
);
const salvarCfg = () =>
  acao.mutate(() => salvarConfiguracaoLalur({ estabelecimento: estabelecimento.value, ...cfg }));

const novaB = reactive({
  codigo: '',
  descricao: '',
  tributo: 'irpj',
  natureza: 'devedor',
  saldoInicial: 0,
  dataSaldoInicial: '',
});
const incluirB = () =>
  acao.mutate(() => incluirContaParteB({ estabelecimento: estabelecimento.value, ...novaB }));

const ajuste = reactive({
  tipo: 'adicao',
  descricao: '',
  data: '',
  valor: 0,
  irpj: true,
  csll: true,
  codigoTabelaDinamica: '',
  contaB: null as number | null,
  efeito: 'constitui',
});
const incluirAjuste = () => {
  if (apuracao.value === null) return;
  const { contaB, efeito, codigoTabelaDinamica, ...resto } = ajuste;
  acao.mutate(() =>
    incluirAjusteLalur(apuracao.value!, {
      ...resto,
      codigoTabelaDinamica: codigoTabelaDinamica || null,
      parteB: contaB ? { conta: contaB, efeito } : null,
    }),
  );
};

const calc = reactive({
  contaPrejuizo: null as number | null,
  contaBaseNegativa: null as number | null,
  deducoesIrpj: 0,
  deducoesCsll: 0,
});
const ap = computed(() => detalhe.data.value?.apuracao);
const situacao = computed(() => ap.value?.situacao ?? '');
const versao = computed(() => ap.value?.versao ?? 1);
const apurar = () => acao.mutate(() => apurarLalur(apuracao.value!, { versao: versao.value, ...calc }));
const provisionar = () => acao.mutate(() => provisionarLalur(apuracao.value!, versao.value));
const justificativaEstorno = ref('');
const estornar = () =>
  acao.mutate(() => estornarProvisaoLalur(apuracao.value!, versao.value, justificativaEstorno.value));
const fechar = () =>
  acao.mutate(() =>
    fecharLalur(apuracao.value!, {
      versao: versao.value,
      contaPrejuizo: calc.contaPrejuizo,
      contaBaseNegativa: calc.contaBaseNegativa,
    }),
  );
const ajustavel = computed(() => situacao.value === 'aberta' || situacao.value === 'apurada');
</script>

<template>
  <section class="tela" data-testid="tela-lalur" :aria-label="k('titulo')">
    <h1>{{ k('titulo') }}</h1>
    <p>{{ k('explicacao') }}</p>
    <MensagemErro v-if="apoio.isError.value" :erro="apoio.error.value" />
    <p v-else-if="apoio.isPending.value">{{ k('carregando') }}</p>
    <div class="formulario">
      <SanteSelecao
        v-model="estabelecimento"
        :rotulo="k('estabelecimento')"
        :opcoes="opEstabelecimentos"
        data-testid="lalur-estabelecimento"
        @update:model-value="apuracao = null"
      />
      <SanteSelecao
        v-if="opApuracoes.length"
        v-model="apuracao"
        :rotulo="k('apuracao')"
        :opcoes="opApuracoes"
        data-testid="lalur-apuracao"
      />
      <p v-else>{{ k('semApuracao') }}</p>
    </div>
    <SanteAlerta
      v-if="aviso"
      variante="info"
      icone="info"
      :texto="aviso"
      anunciar
      data-testid="lalur-aviso"
    />
    <MensagemErro v-if="erro" :erro="erro" />

    <section v-if="detalhe.data.value" :aria-label="k('ajustes.titulo')">
      <h2>{{ k('ajustes.titulo') }}</h2>
      <table v-if="detalhe.data.value.ajustes.length" data-testid="lalur-ajustes">
        <thead>
          <tr>
            <th>{{ k('ajustes.tipo') }}</th>
            <th>{{ k('ajustes.descricao') }}</th>
            <th>{{ k('ajustes.codigo') }}</th>
            <th>{{ k('ajustes.tributos') }}</th>
            <th>{{ k('ajustes.contaB') }}</th>
            <th>{{ k('ajustes.valor') }}</th>
            <th>
              <span class="sr-only">{{ k('ajustes.excluir') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in detalhe.data.value.ajustes" :key="a.id">
            <td>{{ k(`ajustes.tipos.${a.tipo}`) }}</td>
            <td>{{ a.descricao }}</td>
            <td>{{ a.codigo ?? '' }}</td>
            <td>{{ [a.irpj ? 'IRPJ' : '', a.csll ? 'CSLL' : ''].filter(Boolean).join(' e ') }}</td>
            <td>{{ a.contaParteB ?? '' }}</td>
            <td>{{ reais(a.valorCentavos) }}</td>
            <td>
              <SanteBotao
                v-if="podeEditar && ajustavel && a.tipo !== 'compensacao_prejuizo'"
                variante="secundario"
                :rotulo="k('ajustes.excluir')"
                :data-testid="`lalur-excluir-${a.id}`"
                @acionar="acao.mutate(() => excluirAjusteLalur(apuracao!, a.id, a.versao))"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else>{{ k('ajustes.vazio') }}</p>
      <form
        v-if="podeEditar && ajustavel"
        class="formulario"
        data-testid="lalur-form-ajuste"
        @submit.prevent="incluirAjuste"
      >
        <SanteSelecao
          v-model="ajuste.tipo"
          :rotulo="k('ajustes.tipo')"
          :opcoes="opTipos"
          data-testid="lalur-ajuste-tipo"
        />
        <label
          >{{ k('ajustes.descricao') }}
          <input v-model="ajuste.descricao" required maxlength="500" data-testid="lalur-ajuste-descricao"
        /></label>
        <label
          >{{ k('ajustes.data') }}
          <input v-model="ajuste.data" type="date" required data-testid="lalur-ajuste-data"
        /></label>
        <label
          >{{ k('ajustes.valor') }}
          <input
            v-model.number="ajuste.valor"
            type="number"
            min="0.01"
            step="0.01"
            required
            data-testid="lalur-ajuste-valor"
        /></label>
        <label
          >{{ k('ajustes.codigo') }}
          <input v-model="ajuste.codigoTabelaDinamica" maxlength="10" data-testid="lalur-ajuste-codigo"
        /></label>
        <label class="marcar"><input v-model="ajuste.irpj" type="checkbox" /> {{ k('ajustes.irpj') }}</label>
        <label class="marcar"><input v-model="ajuste.csll" type="checkbox" /> {{ k('ajustes.csll') }}</label>
        <SanteSelecao
          v-model="ajuste.contaB"
          :rotulo="k('ajustes.contaB')"
          :opcoes="opContasB()"
          data-testid="lalur-ajuste-conta-b"
        />
        <SanteSelecao
          v-if="ajuste.contaB"
          v-model="ajuste.efeito"
          :rotulo="k('ajustes.efeito')"
          :opcoes="opEfeitos"
          data-testid="lalur-ajuste-efeito"
        />
        <SanteBotao tipo="submit" :rotulo="k('ajustes.botao')" data-testid="lalur-incluir-ajuste" />
      </form>

      <h2>{{ k('apurar.titulo') }}</h2>
      <dl class="totais" data-testid="lalur-totais">
        <dt>{{ k('apurar.lucro') }}</dt>
        <dd>{{ reais(detalhe.data.value.apuracao.lucroAntes) }}</dd>
        <dt>{{ k('apurar.baseIrpj') }}</dt>
        <dd>{{ reais(detalhe.data.value.apuracao.baseIrpj) }}</dd>
        <dt>{{ k('apurar.baseCsll') }}</dt>
        <dd>{{ reais(detalhe.data.value.apuracao.baseCsll) }}</dd>
        <dt>{{ k('apurar.irpj') }}</dt>
        <dd>{{ reais(detalhe.data.value.apuracao.irpjRecolher) }}</dd>
        <dt>{{ k('apurar.csll') }}</dt>
        <dd>{{ reais(detalhe.data.value.apuracao.csllRecolher) }}</dd>
      </dl>
      <div v-if="podeApurar && situacao !== 'fechada'" class="formulario">
        <SanteSelecao
          v-model="calc.contaPrejuizo"
          :rotulo="k('apurar.contaPrejuizo')"
          :opcoes="opContasB('irpj')"
          data-testid="lalur-conta-prejuizo"
        />
        <SanteSelecao
          v-model="calc.contaBaseNegativa"
          :rotulo="k('apurar.contaBaseNegativa')"
          :opcoes="opContasB('csll')"
          data-testid="lalur-conta-base-negativa"
        />
        <label
          >{{ k('apurar.deducoesIrpj') }}
          <input
            v-model.number="calc.deducoesIrpj"
            type="number"
            min="0"
            step="0.01"
            data-testid="lalur-deducoes-irpj"
        /></label>
        <label
          >{{ k('apurar.deducoesCsll') }}
          <input
            v-model.number="calc.deducoesCsll"
            type="number"
            min="0"
            step="0.01"
            data-testid="lalur-deducoes-csll"
        /></label>
        <SanteBotao
          v-if="ajustavel"
          :rotulo="k('apurar.botao')"
          data-testid="lalur-apurar"
          @acionar="apurar"
        />
        <SanteBotao
          v-if="situacao === 'apurada'"
          variante="secundario"
          :rotulo="k('apurar.provisionar')"
          data-testid="lalur-provisionar"
          @acionar="provisionar"
        />
        <template v-if="situacao === 'provisionada'">
          <label
            >{{ k('apurar.justificativaEstorno') }}
            <input
              v-model="justificativaEstorno"
              type="text"
              maxlength="400"
              data-testid="lalur-justificativa-estorno"
          /></label>
          <SanteBotao
            variante="secundario"
            :rotulo="k('apurar.estornar')"
            data-testid="lalur-estornar"
            @acionar="estornar"
          />
        </template>
        <SanteBotao
          v-if="situacao === 'apurada' || situacao === 'provisionada'"
          variante="secundario"
          :rotulo="k('apurar.fechar')"
          data-testid="lalur-fechar"
          @acionar="fechar"
        />
      </div>
      <template v-if="detalhe.data.value.memoria.length">
        <h3>{{ k('apurar.memoria') }}</h3>
        <ul data-testid="lalur-memoria">
          <li v-for="(l, i) in detalhe.data.value.memoria" :key="i">{{ l }}</li>
        </ul>
      </template>

      <h2>{{ k('ecf.titulo') }}</h2>
      <a :href="`/api/contabil/lalur/apuracoes/${apuracao}/ecf`" download data-testid="lalur-baixar-ecf">{{
        k('ecf.baixar')
      }}</a>
      <ul
        v-if="detalhe.data.value.ecf.avisos.length"
        :aria-label="k('ecf.avisos')"
        data-testid="lalur-ecf-avisos"
      >
        <li v-for="(a, i) in detalhe.data.value.ecf.avisos" :key="i">{{ a }}</li>
      </ul>
      <pre class="ecf" tabindex="0" data-testid="lalur-ecf">{{
        detalhe.data.value.ecf.linhas.join('\n')
      }}</pre>
    </section>

    <section v-if="podeEditar" :aria-label="k('abrir.titulo')">
      <h2>{{ k('abrir.titulo') }}</h2>
      <form class="formulario" data-testid="lalur-form-abrir" @submit.prevent="abrirPeriodo">
        <SanteSelecao
          v-model="abrir.forma"
          :rotulo="k('abrir.forma')"
          :opcoes="opFormas"
          data-testid="lalur-forma"
        />
        <label
          >{{ k('abrir.inicio') }}
          <input v-model="abrir.inicio" type="date" required data-testid="lalur-inicio"
        /></label>
        <label
          >{{ k('abrir.fim') }} <input v-model="abrir.fim" type="date" required data-testid="lalur-fim"
        /></label>
        <SanteBotao tipo="submit" :rotulo="k('abrir.botao')" data-testid="lalur-abrir" />
      </form>
    </section>

    <section :aria-label="k('parteB.titulo')">
      <h2>{{ k('parteB.titulo') }}</h2>
      <table v-if="contasB.length" data-testid="lalur-contas-b">
        <thead>
          <tr>
            <th>{{ k('parteB.codigo') }}</th>
            <th>{{ k('parteB.descricao') }}</th>
            <th>{{ k('parteB.tributo') }}</th>
            <th>{{ k('parteB.natureza') }}</th>
            <th>{{ k('parteB.saldo') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in contasB" :key="c.id">
            <td>{{ c.codigo }}</td>
            <td>{{ c.descricao }}</td>
            <td>{{ k(`parteB.tributos.${c.tributo}`) }}</td>
            <td>{{ k(`parteB.naturezas.${c.natureza}`) }}</td>
            <td>{{ reais(c.saldoCentavos) }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else>{{ k('parteB.vazia') }}</p>
      <form v-if="podeEditar" class="formulario" data-testid="lalur-form-conta-b" @submit.prevent="incluirB">
        <label
          >{{ k('parteB.codigo') }}
          <input v-model="novaB.codigo" required maxlength="30" data-testid="lalur-b-codigo"
        /></label>
        <label
          >{{ k('parteB.descricao') }}
          <input v-model="novaB.descricao" required maxlength="150" data-testid="lalur-b-descricao"
        /></label>
        <SanteSelecao
          v-model="novaB.tributo"
          :rotulo="k('parteB.tributo')"
          :opcoes="opTributos"
          data-testid="lalur-b-tributo"
        />
        <SanteSelecao
          v-model="novaB.natureza"
          :rotulo="k('parteB.natureza')"
          :opcoes="opNaturezas"
          data-testid="lalur-b-natureza"
        />
        <label
          >{{ k('parteB.saldoInicial') }}
          <input
            v-model.number="novaB.saldoInicial"
            type="number"
            min="0"
            step="0.01"
            data-testid="lalur-b-saldo"
        /></label>
        <label
          >{{ k('parteB.data') }}
          <input v-model="novaB.dataSaldoInicial" type="date" required data-testid="lalur-b-data"
        /></label>
        <SanteBotao tipo="submit" :rotulo="k('parteB.botao')" data-testid="lalur-incluir-conta-b" />
      </form>
    </section>

    <section v-if="podeEditar" :aria-label="k('configuracao.titulo')">
      <h2>{{ k('configuracao.titulo') }}</h2>
      <form class="formulario" data-testid="lalur-form-configuracao" @submit.prevent="salvarCfg">
        <SanteSelecao
          v-model="cfg.irpjDebito"
          :rotulo="k('configuracao.irpjDebito')"
          :opcoes="opContas"
          data-testid="lalur-cfg-irpj-debito"
        />
        <SanteSelecao
          v-model="cfg.irpjCredito"
          :rotulo="k('configuracao.irpjCredito')"
          :opcoes="opContas"
          data-testid="lalur-cfg-irpj-credito"
        />
        <SanteSelecao
          v-model="cfg.csllDebito"
          :rotulo="k('configuracao.csllDebito')"
          :opcoes="opContas"
          data-testid="lalur-cfg-csll-debito"
        />
        <SanteSelecao
          v-model="cfg.csllCredito"
          :rotulo="k('configuracao.csllCredito')"
          :opcoes="opContas"
          data-testid="lalur-cfg-csll-credito"
        />
        <label
          >{{ k('configuracao.aliquotaIrpj') }}
          <input v-model.number="cfg.aliquotaIrpj" type="number" min="0" max="100" step="0.0001"
        /></label>
        <label
          >{{ k('configuracao.aliquotaAdicional') }}
          <input v-model.number="cfg.aliquotaAdicional" type="number" min="0" max="100" step="0.0001"
        /></label>
        <label
          >{{ k('configuracao.limite') }}
          <input v-model.number="cfg.limiteAdicionalMensal" type="number" min="0" step="0.01"
        /></label>
        <label
          >{{ k('configuracao.aliquotaCsll') }}
          <input v-model.number="cfg.aliquotaCsll" type="number" min="0" max="100" step="0.0001"
        /></label>
        <SanteBotao tipo="submit" :rotulo="k('configuracao.botao')" data-testid="lalur-salvar-configuracao" />
      </form>
    </section>
  </section>
</template>

<style scoped>
.formulario {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
  margin: var(--sgh-espaco-2) 0;
}
.marcar {
  display: flex;
  gap: var(--sgh-espaco-1);
  align-items: center;
}
table {
  border-collapse: collapse;
  margin: var(--sgh-espaco-2) 0;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
}
.totais {
  display: grid;
  grid-template-columns: max-content max-content;
  gap: var(--sgh-espaco-1) var(--sgh-espaco-3);
}
.ecf {
  overflow-x: auto;
  max-width: 100%;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
</style>
