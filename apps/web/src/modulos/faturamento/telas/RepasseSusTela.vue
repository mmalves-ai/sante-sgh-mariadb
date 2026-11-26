<script setup lang="ts">
// Repasse da produção SUS aos profissionais (F7, 06-SUS linha 62) — `Faturamento > Faturamento SUS > Repasse da
// produção SUS`. Três abas: as regras do repasse SUS (modalidade, procedimento ou grupo, ocupação, papel, base e
// percentual, vigência por competência), as regras do rateio do SADT da AIH e a apuração (escolhe a apuração em
// apuração, apura a produção aprovada da competência na versão lida e mostra totais, pendências e as linhas). A
// conferência da regra e do rateio é a mesma do domínio (@sgh/dominio-repasse), na hora; a final é a da API.
import {
  BASES_REPASSE_SUS,
  conferirRateioSadt,
  conferirRegraSus,
  MODALIDADES_REPASSE_SUS,
  PAPEIS_REGRA_SUS,
} from '@sgh/dominio-repasse';
import { SanteSelecao } from '@sgh/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { buscarProfissionais } from '../../cadastro/api-cadastro.js';
import {
  apurarRepasseSus,
  encerrarRepasseSus,
  type EntradaRegraSus,
  incluirRateioSadt,
  incluirRegraRepasseSus,
  lerLinhasRepasseSus,
  lerPainelRepasseSus,
  type ResumoApuracaoSus,
} from '../api-repasse-sus.js';
import { mensagensRepasseSus } from '../i18n-repasse-sus.js';

const { t } = useI18n({ useScope: 'local', messages: { 'pt-BR': mensagensRepasseSus } });
const cliente = useQueryClient();
const painel = useQuery({ queryKey: ['sus', 'repasse', 'painel'], queryFn: lerPainelRepasseSus });
const podeEditar = computed(() => pode('repasse.parametro.editar'));
const podeApurar = computed(() => pode('repasse.apuracao.apurar'));

type Aba = 'regras' | 'rateios' | 'apuracao';
const ABAS: Aba[] = ['regras', 'rateios', 'apuracao'];
const aba = ref<Aba>('regras');

const mesAtual = () => new Date().toISOString().slice(0, 7);
const inicioDe = (m: string) => `${m}-01`;
const fimDe = (m: string) => {
  const [a, mm] = m.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(a, mm, 0)).toISOString().slice(0, 10);
};
const vigencia = (i: string, f: string | null) => `${i.slice(0, 7)} → ${f ? f.slice(0, 7) : '…'}`;
const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const reais = (v: number) => moeda.format(v);
const numOuNull = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')));
const txtOuNull = (v: string) => (v.trim() === '' ? null : v.trim());

const opModalidades = computed(() =>
  MODALIDADES_REPASSE_SUS.map((m) => ({ valor: m, rotulo: t(`modalidades.${m}`) })),
);
const opPapeis = computed(() => PAPEIS_REGRA_SUS.map((p) => ({ valor: p, rotulo: t(`papeis.${p}`) })));
const opBases = computed(() => BASES_REPASSE_SUS.map((b) => ({ valor: b, rotulo: t(`bases.${b}`) })));

const erro = ref<unknown>(null);
const aviso = ref('');
const acao = useMutation({
  mutationFn: (fn: () => Promise<unknown>) => fn(),
  onSuccess: () => {
    erro.value = null;
    void cliente.invalidateQueries({ queryKey: ['sus', 'repasse'] });
  },
  onError: (e) => {
    erro.value = e;
    aviso.value = '';
  },
});

// Regra do repasse SUS.
const r = reactive({
  codigo: '',
  descricao: '',
  modalidade: 'ambulatorial' as EntradaRegraSus['modalidade'],
  procedimento: '',
  grupo: '',
  ocupacao: '',
  papel: 'todos' as EntradaRegraSus['papel'],
  base: 'total' as EntradaRegraSus['base'],
  percentualPago: '',
  percentualDesconto: '',
  valorFixo: '',
  valorDesconto: '',
  valorPonto: '',
  prioridade: '100',
  inicio: mesAtual(),
  fim: '',
});
const entradaRegra = computed<EntradaRegraSus>(() => ({
  codigo: r.codigo.trim(),
  descricao: r.descricao.trim(),
  modalidade: r.modalidade,
  procedimento: txtOuNull(r.procedimento),
  grupo: txtOuNull(r.grupo),
  ocupacao: txtOuNull(r.ocupacao),
  papel: r.papel,
  base: r.base,
  percentualPago: numOuNull(r.percentualPago),
  percentualDesconto: numOuNull(r.percentualDesconto),
  valorFixo: numOuNull(r.valorFixo),
  valorDesconto: numOuNull(r.valorDesconto),
  valorPonto: numOuNull(r.valorPonto),
  prioridade: Number(r.prioridade || '100'),
  inicio: r.inicio ? inicioDe(r.inicio) : '',
  fim: r.fim ? fimDe(r.fim) : null,
}));
const problemasRegra = computed(() => {
  const e = entradaRegra.value;
  return conferirRegraSus({
    ...e,
    procedimento: e.procedimento === null ? null : 1,
    grupo: e.grupo === null ? null : 1,
  });
});
const regraPronta = computed(
  () => r.codigo.trim() !== '' && r.descricao.trim() !== '' && problemasRegra.value.length === 0,
);
const incluirRegra = () => {
  if (!regraPronta.value) return;
  acao.mutate(async () => {
    await incluirRegraRepasseSus(entradaRegra.value);
    aviso.value = t('salvo');
    Object.assign(r, { codigo: '', descricao: '', procedimento: '', grupo: '', ocupacao: '' });
  });
};

// Regra do rateio do SADT da AIH.
const s = reactive({
  procedimento: '',
  grupo: '',
  profissional: null as number | null,
  consideraSadt: true,
  usaPeso: false,
  pesoPercentual: '',
  tetoPercentual: '',
  inicio: mesAtual(),
  fim: '',
});
const opProfissionais = ref<{ valor: number | null; rotulo: string }[]>([
  { valor: null, rotulo: t('campos.qualquerProfissional') },
]);
const buscarProf = (termo: string) => {
  if (termo.trim().length < 3) return;
  buscarProfissionais(termo.trim())
    .then((lista) => {
      const escolhido = opProfissionais.value.find((o) => o.valor !== null && o.valor === s.profissional);
      opProfissionais.value = [
        { valor: null, rotulo: t('campos.qualquerProfissional') },
        ...(escolhido && !lista.itens.some((p) => p.id === escolhido.valor) ? [escolhido] : []),
        ...lista.itens.map((p) => ({ valor: p.id, rotulo: p.nome })),
      ];
    })
    .catch((e: unknown) => {
      erro.value = e;
    });
};
const entradaRateio = computed(() => ({
  procedimento: txtOuNull(s.procedimento),
  grupo: txtOuNull(s.grupo),
  profissional: s.profissional,
  consideraSadt: s.consideraSadt,
  usaPeso: s.usaPeso,
  pesoPercentual: s.usaPeso ? numOuNull(s.pesoPercentual) : null,
  tetoPercentual: numOuNull(s.tetoPercentual),
  inicio: s.inicio ? inicioDe(s.inicio) : '',
  fim: s.fim ? fimDe(s.fim) : null,
}));
const problemasRateio = computed(() => {
  const e = entradaRateio.value;
  return conferirRateioSadt({
    ...e,
    procedimento: e.procedimento === null ? null : 1,
    grupo: e.grupo === null ? null : 1,
  });
});
const incluirRateio = () => {
  if (problemasRateio.value.length) return;
  acao.mutate(async () => {
    await incluirRateioSadt(entradaRateio.value);
    aviso.value = t('salvo');
    Object.assign(s, {
      procedimento: '',
      grupo: '',
      profissional: null,
      pesoPercentual: '',
      tetoPercentual: '',
    });
  });
};

// Encerramento da vigência na própria linha (versão lida, último dia da competência).
const encerrando = ref<{ tipo: 'regras' | 'rateios'; id: number } | null>(null);
const mesFim = ref(mesAtual());
const encerrar = (tipo: 'regras' | 'rateios', id: number, versao: number) =>
  acao.mutate(async () => {
    await encerrarRepasseSus(tipo, id, versao, fimDe(mesFim.value));
    aviso.value = t('encerrado');
    encerrando.value = null;
  });

// Apuração.
const apuracaoId = ref<number | null>(null);
const opApuracoes = computed(() => [
  { valor: null, rotulo: t('campos.escolhaApuracao') },
  ...(painel.data.value?.apuracoes ?? []).map((a) => ({
    valor: a.id,
    rotulo: `${a.numero} — ${a.competencia.slice(0, 7)}`,
  })),
]);
const apuracaoEscolhida = computed(
  () => painel.data.value?.apuracoes.find((a) => a.id === apuracaoId.value) ?? null,
);
const linhas = useQuery({
  queryKey: computed(() => ['sus', 'repasse', 'linhas', apuracaoId.value]),
  queryFn: () => lerLinhasRepasseSus(apuracaoId.value as number),
  enabled: computed(() => apuracaoId.value !== null),
});
const resumo = ref<ResumoApuracaoSus | null>(null);
const apurar = () => {
  const a = apuracaoEscolhida.value;
  if (!a) return;
  acao.mutate(async () => {
    resumo.value = await apurarRepasseSus(a.id, a.versao);
    aviso.value = t('salvo');
  });
};
const textoResumo = computed(() =>
  resumo.value
    ? t('apuracao.resumo', {
        linhas: resumo.value.linhas,
        repasse: reais(resumo.value.totalRepasse),
        glosa: reais(resumo.value.totalGlosa),
        excluidas: resumo.value.excluidas,
      })
    : '',
);
const alvo = (p: string | null, g: string | null) =>
  p ?? (g ? `${t('campos.grupo')}: ${g}` : t('campos.todos'));
</script>

<template>
  <section class="tela" aria-labelledby="repasse-sus-titulo" data-testid="tela-repasse-sus">
    <h1 id="repasse-sus-titulo">{{ t('titulo') }}</h1>
    <p>{{ t('explicacao') }}</p>
    <nav class="abas" role="tablist">
      <button
        v-for="a in ABAS"
        :key="a"
        type="button"
        role="tab"
        :aria-selected="aba === a"
        :data-testid="`repasse-sus-aba-${a}`"
        @click="aba = a"
      >
        {{ t(`abas.${a}`) }}
      </button>
    </nav>
    <p v-if="aviso" role="status" data-testid="repasse-sus-aviso">{{ aviso }}</p>
    <MensagemErro v-if="erro" :erro="erro" />
    <p v-if="!podeEditar" data-testid="repasse-sus-so-consulta">{{ t('semPermissao') }}</p>
    <MensagemErro v-if="painel.isError.value" :erro="painel.error.value" />
    <p v-if="painel.isLoading.value">{{ t('carregando') }}</p>

    <div v-if="aba === 'regras'" data-testid="repasse-sus-regras">
      <form
        v-if="podeEditar"
        class="formulario"
        data-testid="repasse-sus-regra-form"
        @submit.prevent="incluirRegra"
      >
        <label
          >{{ t('campos.codigo') }}
          <input v-model="r.codigo" maxlength="30" data-testid="repasse-sus-regra-codigo"
        /></label>
        <label class="largo"
          >{{ t('campos.descricao') }}
          <input v-model="r.descricao" maxlength="150" data-testid="repasse-sus-regra-descricao"
        /></label>
        <SanteSelecao
          v-model="r.modalidade"
          :rotulo="t('campos.modalidade')"
          :opcoes="opModalidades"
          data-testid="repasse-sus-regra-modalidade"
        />
        <SanteSelecao
          v-model="r.papel"
          :rotulo="t('campos.papel')"
          :opcoes="opPapeis"
          data-testid="repasse-sus-regra-papel"
        />
        <SanteSelecao
          v-model="r.base"
          :rotulo="t('campos.base')"
          :opcoes="opBases"
          data-testid="repasse-sus-regra-base"
        />
        <label
          >{{ t('campos.procedimento') }}
          <input v-model="r.procedimento" maxlength="20" data-testid="repasse-sus-regra-procedimento"
        /></label>
        <label
          >{{ t('campos.grupo') }}
          <input v-model="r.grupo" maxlength="20" data-testid="repasse-sus-regra-grupo"
        /></label>
        <label
          >{{ t('campos.ocupacao') }}
          <input v-model="r.ocupacao" maxlength="20" data-testid="repasse-sus-regra-ocupacao"
        /></label>
        <label
          >{{ t('campos.percentualPago') }}
          <input v-model="r.percentualPago" inputmode="decimal" data-testid="repasse-sus-regra-percentual"
        /></label>
        <label
          >{{ t('campos.percentualDesconto') }}
          <input v-model="r.percentualDesconto" inputmode="decimal" data-testid="repasse-sus-regra-desconto"
        /></label>
        <label v-if="r.base === 'valor_fixo'"
          >{{ t('campos.valorFixo') }}
          <input v-model="r.valorFixo" inputmode="decimal" data-testid="repasse-sus-regra-valor-fixo"
        /></label>
        <label
          >{{ t('campos.valorDesconto') }}
          <input v-model="r.valorDesconto" inputmode="decimal" data-testid="repasse-sus-regra-valor-desconto"
        /></label>
        <label v-if="r.base === 'pontos'"
          >{{ t('campos.valorPonto') }}
          <input v-model="r.valorPonto" inputmode="decimal" data-testid="repasse-sus-regra-valor-ponto"
        /></label>
        <label
          >{{ t('campos.prioridade') }}
          <input v-model="r.prioridade" inputmode="numeric" data-testid="repasse-sus-regra-prioridade"
        /></label>
        <label
          >{{ t('campos.inicio') }}
          <input v-model="r.inicio" type="month" required data-testid="repasse-sus-regra-inicio"
        /></label>
        <label
          >{{ t('campos.fim') }} <input v-model="r.fim" type="month" data-testid="repasse-sus-regra-fim"
        /></label>
        <ul v-if="problemasRegra.length" class="problemas" data-testid="repasse-sus-regra-problemas">
          <li v-for="p in problemasRegra" :key="p">{{ t(`problemas.${p}`) }}</li>
        </ul>
        <button
          type="submit"
          :disabled="!regraPronta || acao.isPending.value"
          data-testid="repasse-sus-regra-incluir"
        >
          {{ t('acoes.incluir') }}
        </button>
      </form>
      <p v-if="painel.data.value?.regras.length === 0" data-testid="repasse-sus-regras-vazio">
        {{ t('regrasVazias') }}
      </p>
      <table v-else-if="painel.data.value" data-testid="repasse-sus-regras-tabela">
        <thead>
          <tr>
            <th scope="col">{{ t('campos.codigo') }}</th>
            <th scope="col">{{ t('campos.modalidade') }}</th>
            <th scope="col">{{ t('campos.alvo') }}</th>
            <th scope="col">{{ t('campos.papel') }}</th>
            <th scope="col">{{ t('campos.base') }}</th>
            <th scope="col">{{ t('campos.valores') }}</th>
            <th scope="col">{{ t('campos.vigencia') }}</th>
            <th scope="col">{{ t('campos.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in painel.data.value.regras" :key="x.id" :data-testid="`repasse-sus-regra-${x.id}`">
            <td>{{ x.codigo }} — {{ x.descricao }}</td>
            <td>{{ t(`modalidades.${x.modalidade}`) }}</td>
            <td>
              {{ alvo(x.procedimentoCodigo, x.grupoCodigo)
              }}{{ x.ocupacaoCodigo ? ` · ${x.ocupacaoCodigo}` : '' }}
            </td>
            <td>{{ t(`papeis.${x.papel}`) }}</td>
            <td>{{ t(`bases.${x.base}`) }}</td>
            <td>
              {{ x.percentualPago ?? '' }}{{ x.percentualPago !== null ? '%' : '' }}
              {{ x.valorFixo !== null ? reais(x.valorFixo) : '' }}
              {{ x.valorPonto !== null ? reais(x.valorPonto) : '' }}
            </td>
            <td>{{ vigencia(x.inicio, x.fim) }}</td>
            <td>
              <template v-if="podeEditar && !x.fim">
                <span v-if="encerrando?.tipo === 'regras' && encerrando.id === x.id" class="encerrar">
                  <label
                    >{{ t('acoes.encerrarEm') }}
                    <input v-model="mesFim" type="month" data-testid="repasse-sus-encerrar-mes"
                  /></label>
                  <button
                    type="button"
                    data-testid="repasse-sus-encerrar-confirmar"
                    @click="encerrar('regras', x.id, x.versao)"
                  >
                    {{ t('acoes.confirmar') }}
                  </button>
                  <button type="button" @click="encerrando = null">{{ t('acoes.cancelar') }}</button>
                </span>
                <button
                  v-else
                  type="button"
                  data-testid="repasse-sus-regra-encerrar"
                  @click="encerrando = { tipo: 'regras', id: x.id }"
                >
                  {{ t('acoes.encerrar') }}
                </button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="aba === 'rateios'" data-testid="repasse-sus-rateios">
      <form
        v-if="podeEditar"
        class="formulario"
        data-testid="repasse-sus-rateio-form"
        @submit.prevent="incluirRateio"
      >
        <label
          >{{ t('campos.procedimento') }}
          <input v-model="s.procedimento" maxlength="20" data-testid="repasse-sus-rateio-procedimento"
        /></label>
        <label
          >{{ t('campos.grupo') }}
          <input v-model="s.grupo" maxlength="20" data-testid="repasse-sus-rateio-grupo"
        /></label>
        <SanteSelecao
          v-model="s.profissional"
          :rotulo="t('campos.profissional')"
          :opcoes="opProfissionais"
          :buscar="buscarProf"
          data-testid="repasse-sus-rateio-profissional"
        />
        <label class="marca"
          ><input v-model="s.consideraSadt" type="checkbox" data-testid="repasse-sus-rateio-considera" />
          {{ t('campos.consideraSadt') }}</label
        >
        <label class="marca"
          ><input v-model="s.usaPeso" type="checkbox" data-testid="repasse-sus-rateio-usa-peso" />
          {{ t('campos.usaPeso') }}</label
        >
        <label v-if="s.usaPeso"
          >{{ t('campos.pesoPercentual') }}
          <input v-model="s.pesoPercentual" inputmode="decimal" data-testid="repasse-sus-rateio-peso"
        /></label>
        <label
          >{{ t('campos.tetoPercentual') }}
          <input v-model="s.tetoPercentual" inputmode="decimal" data-testid="repasse-sus-rateio-teto"
        /></label>
        <label
          >{{ t('campos.inicio') }}
          <input v-model="s.inicio" type="month" required data-testid="repasse-sus-rateio-inicio"
        /></label>
        <label
          >{{ t('campos.fim') }} <input v-model="s.fim" type="month" data-testid="repasse-sus-rateio-fim"
        /></label>
        <ul v-if="problemasRateio.length" class="problemas" data-testid="repasse-sus-rateio-problemas">
          <li v-for="p in problemasRateio" :key="p">{{ t(`problemas.${p}`) }}</li>
        </ul>
        <button
          type="submit"
          :disabled="problemasRateio.length > 0 || acao.isPending.value"
          data-testid="repasse-sus-rateio-incluir"
        >
          {{ t('acoes.incluir') }}
        </button>
      </form>
      <p v-if="painel.data.value?.rateios.length === 0" data-testid="repasse-sus-rateios-vazio">
        {{ t('rateiosVazios') }}
      </p>
      <table v-else-if="painel.data.value" data-testid="repasse-sus-rateios-tabela">
        <thead>
          <tr>
            <th scope="col">{{ t('campos.alvo') }}</th>
            <th scope="col">{{ t('campos.profissional') }}</th>
            <th scope="col">{{ t('campos.consideraSadt') }}</th>
            <th scope="col">{{ t('campos.pesoPercentual') }}</th>
            <th scope="col">{{ t('campos.tetoPercentual') }}</th>
            <th scope="col">{{ t('campos.vigencia') }}</th>
            <th scope="col">{{ t('campos.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in painel.data.value.rateios" :key="x.id" :data-testid="`repasse-sus-rateio-${x.id}`">
            <td>{{ alvo(x.procedimentoCodigo, x.grupoCodigo) }}</td>
            <td>{{ x.profissionalNome ?? t('campos.qualquerProfissional') }}</td>
            <td>{{ x.consideraSadt ? t('campos.sim') : t('campos.nao') }}</td>
            <td>{{ x.usaPeso ? `${x.pesoPercentual}%` : '' }}</td>
            <td>{{ x.tetoPercentual !== null ? `${x.tetoPercentual}%` : '' }}</td>
            <td>{{ vigencia(x.inicio, x.fim) }}</td>
            <td>
              <template v-if="podeEditar && !x.fim">
                <span v-if="encerrando?.tipo === 'rateios' && encerrando.id === x.id" class="encerrar">
                  <label
                    >{{ t('acoes.encerrarEm') }}
                    <input v-model="mesFim" type="month" data-testid="repasse-sus-encerrar-mes"
                  /></label>
                  <button
                    type="button"
                    data-testid="repasse-sus-encerrar-confirmar"
                    @click="encerrar('rateios', x.id, x.versao)"
                  >
                    {{ t('acoes.confirmar') }}
                  </button>
                  <button type="button" @click="encerrando = null">{{ t('acoes.cancelar') }}</button>
                </span>
                <button
                  v-else
                  type="button"
                  data-testid="repasse-sus-rateio-encerrar"
                  @click="encerrando = { tipo: 'rateios', id: x.id }"
                >
                  {{ t('acoes.encerrar') }}
                </button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="aba === 'apuracao'" data-testid="repasse-sus-apuracao">
      <p v-if="painel.data.value?.apuracoes.length === 0" data-testid="repasse-sus-apuracao-vazia">
        {{ t('apuracao.vazia') }}
      </p>
      <div v-else class="formulario">
        <SanteSelecao
          v-model="apuracaoId"
          :rotulo="t('campos.apuracao')"
          :opcoes="opApuracoes"
          data-testid="repasse-sus-apuracao-escolha"
        />
        <button
          v-if="podeApurar"
          type="button"
          :disabled="!apuracaoEscolhida || acao.isPending.value"
          data-testid="repasse-sus-apurar"
          @click="apurar"
        >
          {{ t('acoes.apurar') }}
        </button>
      </div>
      <template v-if="resumo">
        <p data-testid="repasse-sus-resumo">{{ textoResumo }}</p>
        <h2>{{ t('apuracao.pendencias') }}</h2>
        <p v-if="resumo.pendencias.length === 0">{{ t('apuracao.semPendencia') }}</p>
        <ul v-else data-testid="repasse-sus-pendencias">
          <li v-for="p in resumo.pendencias" :key="`${p.instrumento}-${p.origem}-${p.motivo}`">
            {{
              t('apuracao.pendencia', {
                instrumento: p.instrumento.toUpperCase(),
                origem: p.origem,
                motivo: t(`apuracao.motivos.${p.motivo}`),
              })
            }}
          </li>
        </ul>
      </template>
      <MensagemErro v-if="linhas.isError.value" :erro="linhas.error.value" />
      <p
        v-if="apuracaoId !== null && linhas.data.value?.length === 0"
        data-testid="repasse-sus-linhas-vazias"
      >
        {{ t('apuracao.linhasVazias') }}
      </p>
      <table v-else-if="linhas.data.value?.length" data-testid="repasse-sus-linhas">
        <thead>
          <tr>
            <th scope="col">{{ t('apuracao.sequencia') }}</th>
            <th scope="col">{{ t('apuracao.instrumento') }}</th>
            <th scope="col">{{ t('apuracao.executante') }}</th>
            <th scope="col">{{ t('apuracao.papel') }}</th>
            <th scope="col">{{ t('apuracao.regra') }}</th>
            <th scope="col">{{ t('apuracao.base') }}</th>
            <th scope="col">{{ t('apuracao.percentual') }}</th>
            <th scope="col">{{ t('apuracao.glosa') }}</th>
            <th scope="col">{{ t('apuracao.repasse') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="l in linhas.data.value"
            :key="l.sequencia"
            :data-testid="`repasse-sus-linha-${l.sequencia}`"
          >
            <td>{{ l.sequencia }}</td>
            <td>{{ l.instrumento.toUpperCase() }}</td>
            <td>{{ l.executanteNome }}</td>
            <td>{{ l.papel }}</td>
            <td>{{ l.regraCodigo ?? '' }}</td>
            <td>{{ reais(l.base) }}</td>
            <td>{{ l.percentual ?? '' }}</td>
            <td>{{ reais(l.glosa) }}</td>
            <td>{{ reais(l.repasse) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.abas {
  display: flex;
  gap: var(--sgh-espaco-1);
  margin: var(--sgh-espaco-2) 0;
}
.abas [aria-selected='true'] {
  font-weight: 600;
  border-bottom: 2px solid var(--sgh-borda);
}
table {
  border-collapse: collapse;
  margin: var(--sgh-espaco-2) 0;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
.formulario {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
  margin: var(--sgh-espaco-2) 0;
}
.largo {
  flex-basis: 100%;
}
.problemas {
  flex-basis: 100%;
  color: var(--sgh-alerta-texto);
}
.encerrar {
  display: inline-flex;
  gap: var(--sgh-espaco-1);
  align-items: end;
}
</style>
