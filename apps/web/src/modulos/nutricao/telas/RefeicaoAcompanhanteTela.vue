<script setup lang="ts">
// Refeição do acompanhante pelo direito (F7, 04-HOT linha 133, C1-030). Duas abas: as regras do direito (lei, convênio
// ou política interna, por fonte pagadora, acomodação, faixa de idade e refeição) e, por internação (?reg=), a decisão
// antes de lançar, o lançamento, a autorização da fonte pagadora e o cancelamento. Quem decide é o servidor; a tela
// valida a regra na hora com a mesma função do domínio e mostra a recusa pelo ErroNutricao.
import { FUNDAMENTOS_DIREITO_REFEICAO, validarRegraDireitoRefeicao } from '@sgh/dominio-pep';
import { PERMISSOES_NUTRICAO_CODIGOS as P } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import { novaChaveNutricao } from '../api-nutricao.js';
import {
  alterarRegraDireito,
  autorizarRefeicaoAcompanhante,
  cancelarRefeicaoAcompanhante,
  definirUsoRegra,
  incluirRegraDireito,
  lancarRefeicaoAcompanhante,
  lerApoioDireito,
  lerDecisaoRefeicao,
  lerRefeicoesAcompanhante,
  lerRegrasDireito,
  type DecisaoDireito,
  type RefeicaoAcompanhante,
  type RegraDireito,
  type RegraEnvio,
} from '../api-direito-refeicao.js';
import ErroNutricao from '../componentes/ErroNutricao.vue';

const { t } = useI18n();
const rota = useRoute();
const roteador = useRouter();
const cliente = useQueryClient();
const { permissoes } = usarSessao();
const podeRegrar = computed(() => permissoes.value.has(P.mapaFechar));
const podeLancar = computed(() => permissoes.value.has(P.acompanhanteRegistrar));
const T = (c: string, a?: Record<string, unknown>) =>
  a ? t(`nutricao.direitoRefeicao.${c}`, a) : t(`nutricao.direitoRefeicao.${c}`);

type Aba = 'lancamento' | 'regras';
const ABAS: Aba[] = ['lancamento', 'regras'];
const aba = ref<Aba>(rota.query['aba'] === 'regras' ? 'regras' : 'lancamento');

const hoje = new Intl.DateTimeFormat('en-CA').format(new Date());
const reais = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const inteiro = (s: string): number | null => {
  const x = s.trim();
  if (x === '') return null;
  return /^\d+$/.test(x) ? Number(x) : Number.NaN;
};

const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);
async function executar(fn: () => Promise<void>): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    await fn();
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}

const apoio = useQuery({
  queryKey: ['nutricao', 'direito-refeicao', 'apoio'],
  queryFn: lerApoioDireito,
  staleTime: 300_000,
});
const opcoesFundamento = computed(() =>
  FUNDAMENTOS_DIREITO_REFEICAO.map((f) => ({ valor: f, rotulo: T(`fundamentos.${f}`) })),
);
const opcoesFonte = computed(() => [
  { valor: null, rotulo: T('todasFontes') },
  ...(apoio.data.value?.fontes ?? []).map((x) => ({ valor: x.id, rotulo: x.descricao })),
]);
const opcoesAcomodacao = computed(() => [
  { valor: null, rotulo: T('todasAcomodacoes') },
  ...(apoio.data.value?.acomodacoes ?? []).map((x) => ({ valor: x.id, rotulo: x.descricao })),
]);
const opcoesRefeicao = computed(() =>
  (apoio.data.value?.refeicoes ?? []).map((x) => ({ valor: x.id, rotulo: x.descricao })),
);
const nomeRefeicao = (id: number) =>
  apoio.data.value?.refeicoes.find((x) => x.id === id)?.descricao ?? String(id);

// ---- Regras ----
const regras = useQuery({ queryKey: ['nutricao', 'direito-refeicao', 'regras'], queryFn: lerRegrasDireito });
const form = reactive({
  aberto: false,
  id: 0,
  versao: 0,
  descricao: '',
  fundamento: 'convenio' as (typeof FUNDAMENTOS_DIREITO_REFEICAO)[number],
  fontePagadora: null as number | null,
  acomodacao: null as number | null,
  idadeMinima: '',
  idadeMaxima: '',
  cobertoPelaFonte: true,
  exigeAutorizacao: false,
  incluidoNaDiaria: false,
  vigenciaInicio: hoje as string | null,
  vigenciaFim: null as string | null,
  refeicoes: [] as number[],
});
function novaRegra(): void {
  Object.assign(form, {
    aberto: true,
    id: 0,
    versao: 0,
    descricao: '',
    fundamento: 'convenio',
    fontePagadora: null,
    acomodacao: null,
    idadeMinima: '',
    idadeMaxima: '',
    cobertoPelaFonte: true,
    exigeAutorizacao: false,
    incluidoNaDiaria: false,
    vigenciaInicio: hoje,
    vigenciaFim: null,
    refeicoes: [],
  });
}
function editarRegra(r: RegraDireito): void {
  Object.assign(form, {
    aberto: true,
    id: r.id,
    versao: r.versao,
    descricao: r.descricao,
    fundamento: r.fundamento,
    fontePagadora: r.fontePagadora,
    acomodacao: r.acomodacao,
    idadeMinima: r.idadeMinima === null ? '' : String(r.idadeMinima),
    idadeMaxima: r.idadeMaxima === null ? '' : String(r.idadeMaxima),
    cobertoPelaFonte: r.cobertoPelaFonte,
    exigeAutorizacao: r.exigeAutorizacao,
    incluidoNaDiaria: r.incluidoNaDiaria,
    vigenciaInicio: r.vigenciaInicio.slice(0, 10),
    vigenciaFim: r.vigenciaFim ? r.vigenciaFim.slice(0, 10) : null,
    refeicoes: [...r.refeicoes],
  });
}
const envio = computed<RegraEnvio>(() => ({
  descricao: form.descricao.trim(),
  fundamento: form.fundamento,
  fontePagadora: form.fontePagadora,
  acomodacao: form.acomodacao,
  idadeMinima: inteiro(form.idadeMinima),
  idadeMaxima: inteiro(form.idadeMaxima),
  cobertoPelaFonte: form.cobertoPelaFonte,
  exigeAutorizacao: form.exigeAutorizacao,
  incluidoNaDiaria: form.incluidoNaDiaria,
  vigenciaInicio: form.vigenciaInicio ?? '',
  vigenciaFim: form.vigenciaFim,
  refeicoes: [...form.refeicoes],
}));
const problemas = computed(() => {
  const e = envio.value;
  const p = validarRegraDireitoRefeicao(e).map((x) => x.mensagem);
  if (Number.isNaN(e.idadeMinima) || Number.isNaN(e.idadeMaxima)) p.unshift(T('numeroInvalido'));
  return p;
});
const salvarRegra = () =>
  executar(async () => {
    if (problemas.value.length) return;
    const chave = novaChaveNutricao('direito-regra');
    if (form.id) await alterarRegraDireito(form.id, { ...envio.value, versao: form.versao }, chave);
    else await incluirRegraDireito(envio.value, chave);
    form.aberto = false;
    mensagem.value = T('salva');
    await cliente.invalidateQueries({ queryKey: ['nutricao', 'direito-refeicao', 'regras'] });
  });
const trocarUso = (r: RegraDireito) =>
  executar(async () => {
    await definirUsoRegra(r.id, !r.ativo, r.versao, novaChaveNutricao('direito-uso'));
    await cliente.invalidateQueries({ queryKey: ['nutricao', 'direito-refeicao', 'regras'] });
  });
const faixa = (r: RegraDireito) =>
  r.idadeMinima === null && r.idadeMaxima === null
    ? T('qualquerIdade')
    : `${r.idadeMinima ?? 0}–${r.idadeMaxima ?? '…'}`;
const vigencia = (r: RegraDireito) =>
  `${r.vigenciaInicio.slice(0, 10)} – ${r.vigenciaFim?.slice(0, 10) ?? ''}`;

// ---- Por internação ----
const regInicial = typeof rota.query['reg'] === 'string' ? rota.query['reg'] : '';
const campoReg = ref(regInicial);
const internacao = ref<number | null>(/^\d+$/.test(regInicial) ? Number(regInicial) : null);
function abrirInternacao(): void {
  const n = inteiro(campoReg.value);
  if (n === null || Number.isNaN(n)) {
    erro.value = null;
    mensagem.value = T('numeroInvalido');
    return;
  }
  internacao.value = n;
  decisao.value = null;
  void roteador.replace({ query: { ...rota.query, reg: String(n) } });
}
const lancadas = useQuery({
  queryKey: computed(() => ['nutricao', 'direito-refeicao', 'lancadas', internacao.value]),
  queryFn: () => lerRefeicoesAcompanhante(internacao.value as number),
  enabled: computed(() => internacao.value !== null),
});
const lanc = reactive({
  data: hoje as string | null,
  refeicao: null as number | null,
  quantidade: '1',
  observacao: '',
});
const decisao = ref<DecisaoDireito | null>(null);
const consultar = () =>
  executar(async () => {
    if (internacao.value === null || !lanc.data || lanc.refeicao === null) return;
    decisao.value = await lerDecisaoRefeicao(internacao.value, lanc.data, lanc.refeicao);
  });
const lancar = () =>
  executar(async () => {
    const q = inteiro(lanc.quantidade);
    if (internacao.value === null || !lanc.data || lanc.refeicao === null || !q) return;
    const r = await lancarRefeicaoAcompanhante(
      {
        internacao: internacao.value,
        data: lanc.data,
        refeicao: lanc.refeicao,
        quantidade: q,
        observacao: lanc.observacao.trim() || null,
      },
      novaChaveNutricao('refeicao-acomp'),
    );
    mensagem.value =
      r.valor !== null
        ? T('lancadaValor', { valor: reais(r.valor) })
        : T('lancada', { c: T(`coberturas.${r.cobertura}`) });
    decisao.value = null;
    await lancadas.refetch();
  });
const decidir = (r: RefeicaoAcompanhante, autorizada: boolean) =>
  executar(async () => {
    if (!autorizada && !window.confirm(T('confirmarNegar'))) return;
    await autorizarRefeicaoAcompanhante(r.id, autorizada, r.versao, novaChaveNutricao('refeicao-autoriza'));
    mensagem.value = T('decidida');
    await lancadas.refetch();
  });
const cancelando = reactive({ id: 0, motivo: '' });
function abrirCancelamento(id: number): void {
  cancelando.id = id;
  cancelando.motivo = '';
}
const cancelar = (r: RefeicaoAcompanhante) =>
  executar(async () => {
    if (cancelando.motivo.trim().length < 3) return;
    await cancelarRefeicaoAcompanhante(
      r.id,
      cancelando.motivo.trim(),
      r.versao,
      novaChaveNutricao('refeicao-cancela'),
    );
    cancelando.id = 0;
    cancelando.motivo = '';
    mensagem.value = T('cancelada');
    await lancadas.refetch();
  });
</script>

<template>
  <main class="direito" data-testid="tela-refeicao-acompanhante">
    <h1>{{ T('titulo') }}</h1>
    <p class="secundario">{{ T('texto') }}</p>

    <div class="abas" role="tablist">
      <button
        v-for="a in ABAS"
        :key="a"
        type="button"
        role="tab"
        :aria-selected="aba === a"
        :class="{ ativa: aba === a }"
        :data-testid="`aba-${a}`"
        @click="aba = a"
      >
        {{ T(`abas.${a}`) }}
      </button>
    </div>

    <SanteAlerta v-if="mensagem" variante="info" :texto="mensagem" anunciar data-testid="direito-mensagem" />
    <ErroNutricao v-if="erro" :erro="erro" />

    <!-- Por internação -->
    <section v-if="aba === 'lancamento'" role="tabpanel" data-testid="painel-lancamento">
      <form class="linha" @submit.prevent="abrirInternacao()">
        <SanteCampoTexto
          v-model="campoReg"
          :rotulo="T('internacao')"
          :max-bytes="12"
          data-testid="campo-internacao"
        />
        <SanteBotao tipo="submit" variante="secundario" :rotulo="T('abrir')" data-testid="abrir-internacao" />
      </form>

      <template v-if="internacao !== null">
        <p v-if="!podeLancar" class="secundario" data-testid="sem-lancar">{{ T('semLancar') }}</p>
        <form v-else class="linha" data-testid="form-lancamento" @submit.prevent="lancar()">
          <SanteData v-model="lanc.data" :rotulo="T('data')" editavel data-testid="lanc-data" />
          <SanteSelecao
            v-model="lanc.refeicao"
            :rotulo="T('refeicao')"
            :opcoes="opcoesRefeicao"
            obrigatorio
            data-testid="lanc-refeicao"
          />
          <SanteCampoTexto
            v-model="lanc.quantidade"
            :rotulo="T('quantidade')"
            :max-bytes="3"
            data-testid="lanc-quantidade"
          />
          <SanteCampoTexto
            v-model="lanc.observacao"
            :rotulo="T('observacao')"
            :max-bytes="200"
            data-testid="lanc-observacao"
          />
          <SanteBotao
            variante="secundario"
            :rotulo="T('decisao')"
            :desabilitado="ocupado || !lanc.data || lanc.refeicao === null"
            data-testid="consultar-decisao"
            @acionar="consultar()"
          />
          <SanteBotao
            tipo="submit"
            :rotulo="T('lancar')"
            :desabilitado="ocupado || !lanc.data || lanc.refeicao === null || !inteiro(lanc.quantidade)"
            data-testid="lancar-refeicao"
          />
        </form>

        <div v-if="decisao" class="decisao" data-testid="decisao-refeicao">
          <strong data-testid="decisao-cobertura">{{ T(`coberturas.${decisao.cobertura}`) }}</strong>
          <span>{{ decisao.motivo }}</span>
          <span>{{
            decisao.idadePaciente === null ? T('semIdade') : T('idade', { n: decisao.idadePaciente })
          }}</span>
          <span v-if="decisao.baseLegal" data-testid="decisao-base-legal">{{
            T('baseLegal', { base: decisao.baseLegal })
          }}</span>
          <span v-if="decisao.regraDescricao">{{ T('regraAplicada', { r: decisao.regraDescricao }) }}</span>
        </div>

        <h2>{{ T('lancadas') }}</h2>
        <p v-if="lancadas.isLoading.value">{{ t('nutricao.carregando') }}</p>
        <p v-else-if="!(lancadas.data.value ?? []).length" class="secundario">{{ T('nenhumaLancada') }}</p>
        <table v-else class="tabela" data-testid="tabela-lancadas">
          <thead>
            <tr>
              <th scope="col">{{ T('data') }}</th>
              <th scope="col">{{ T('refeicao') }}</th>
              <th scope="col">{{ T('quantidade') }}</th>
              <th scope="col">{{ T('decisao') }}</th>
              <th scope="col"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in lancadas.data.value" :key="r.id" :data-testid="`lancada-${r.id}`">
              <td>{{ r.data.slice(0, 10) }}</td>
              <td>{{ r.refeicaoDescricao ?? nomeRefeicao(r.refeicao) }}</td>
              <td>{{ r.quantidade }}</td>
              <td>
                {{ T(`situacoes.${r.situacao}`) }}
                <span v-if="r.conta !== null">· {{ T('naConta', { conta: r.conta }) }}</span>
                <span v-if="r.valor !== null">· {{ reais(r.valor) }}</span>
                <span v-if="r.regraDescricao" class="secundario">· {{ r.regraDescricao }}</span>
              </td>
              <td class="acoes">
                <template v-if="podeLancar && r.situacao === 'solicitada'">
                  <SanteBotao
                    variante="secundario"
                    :rotulo="T('autorizar')"
                    :desabilitado="ocupado"
                    :data-testid="`autorizar-${r.id}`"
                    @acionar="decidir(r, true)"
                  />
                  <SanteBotao
                    variante="secundario"
                    :rotulo="T('negar')"
                    :desabilitado="ocupado"
                    :data-testid="`negar-${r.id}`"
                    @acionar="decidir(r, false)"
                  />
                </template>
                <template v-if="podeLancar && r.situacao !== 'cancelada' && r.conta === null">
                  <template v-if="cancelando.id === r.id">
                    <SanteCampoTexto
                      v-model="cancelando.motivo"
                      :rotulo="T('motivoCancelar')"
                      :max-bytes="200"
                      :data-testid="`motivo-${r.id}`"
                    />
                    <SanteBotao
                      :rotulo="T('cancelar')"
                      :desabilitado="ocupado || cancelando.motivo.trim().length < 3"
                      :data-testid="`confirmar-cancelar-${r.id}`"
                      @acionar="cancelar(r)"
                    />
                  </template>
                  <SanteBotao
                    v-else
                    variante="texto"
                    :rotulo="T('cancelar')"
                    :data-testid="`cancelar-${r.id}`"
                    @acionar="abrirCancelamento(r.id)"
                  />
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </template>
    </section>

    <!-- Regras -->
    <section v-if="aba === 'regras'" role="tabpanel" data-testid="painel-regras">
      <p v-if="!podeRegrar" class="secundario" data-testid="sem-regrar">{{ T('semRegrar') }}</p>
      <SanteBotao
        v-else
        variante="secundario"
        :rotulo="T('novaRegra')"
        data-testid="nova-regra"
        @acionar="novaRegra()"
      />
      <p v-if="!(regras.data.value ?? []).length && !regras.isLoading.value" class="secundario">
        {{ T('nenhumaRegra') }}
      </p>
      <table v-else class="tabela" data-testid="tabela-regras">
        <thead>
          <tr>
            <th scope="col">{{ T('descricao') }}</th>
            <th scope="col">{{ T('fundamento') }}</th>
            <th scope="col">{{ T('fonte') }}</th>
            <th scope="col">{{ T('acomodacao') }}</th>
            <th scope="col">{{ T('faixa') }}</th>
            <th scope="col">{{ T('vigencia') }}</th>
            <th scope="col"></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="r in regras.data.value ?? []"
            :key="r.id"
            :data-testid="`regra-${r.id}`"
            :class="{ inativa: !r.ativo }"
          >
            <td>
              {{ r.descricao }}
              <span v-if="!r.ativo" class="secundario">({{ T('foraDeUso') }})</span>
            </td>
            <td>{{ T(`fundamentos.${r.fundamento}`) }}</td>
            <td>{{ r.fontePagadoraNome ?? T('todasFontes') }}</td>
            <td>{{ r.acomodacaoDescricao ?? T('todasAcomodacoes') }}</td>
            <td>{{ faixa(r) }}</td>
            <td>{{ vigencia(r) }}</td>
            <td v-if="podeRegrar" class="acoes">
              <SanteBotao
                variante="texto"
                :rotulo="T('editar')"
                :data-testid="`editar-regra-${r.id}`"
                @acionar="editarRegra(r)"
              />
              <SanteBotao
                variante="texto"
                :rotulo="r.ativo ? T('tirarDeUso') : T('voltarAoUso')"
                :desabilitado="ocupado"
                :data-testid="`uso-regra-${r.id}`"
                @acionar="trocarUso(r)"
              />
            </td>
            <td v-else></td>
          </tr>
        </tbody>
      </table>

      <form
        v-if="form.aberto && podeRegrar"
        class="formulario"
        data-testid="form-regra"
        @submit.prevent="salvarRegra()"
      >
        <div class="grade">
          <SanteCampoTexto
            v-model="form.descricao"
            :rotulo="T('descricao')"
            :max-bytes="150"
            obrigatorio
            data-testid="regra-descricao"
          />
          <SanteSelecao
            v-model="form.fundamento"
            :rotulo="T('fundamento')"
            :opcoes="opcoesFundamento"
            obrigatorio
            data-testid="regra-fundamento"
          />
          <SanteSelecao
            v-model="form.fontePagadora"
            :rotulo="T('fonte')"
            :opcoes="opcoesFonte"
            data-testid="regra-fonte"
          />
          <SanteSelecao
            v-model="form.acomodacao"
            :rotulo="T('acomodacao')"
            :opcoes="opcoesAcomodacao"
            data-testid="regra-acomodacao"
          />
          <SanteCampoTexto
            v-model="form.idadeMinima"
            :rotulo="T('idadeMinima')"
            :max-bytes="3"
            data-testid="regra-idade-minima"
          />
          <SanteCampoTexto
            v-model="form.idadeMaxima"
            :rotulo="T('idadeMaxima')"
            :max-bytes="3"
            data-testid="regra-idade-maxima"
          />
          <SanteData
            v-model="form.vigenciaInicio"
            :rotulo="T('vigenciaInicio')"
            editavel
            data-testid="regra-vigencia-inicio"
          />
          <SanteData
            v-model="form.vigenciaFim"
            :rotulo="T('vigenciaFim')"
            editavel
            data-testid="regra-vigencia-fim"
          />
        </div>
        <div class="linha">
          <label class="marca"
            ><input v-model="form.cobertoPelaFonte" type="checkbox" data-testid="regra-coberto" />
            {{ T('coberto') }}</label
          >
          <label class="marca"
            ><input v-model="form.exigeAutorizacao" type="checkbox" data-testid="regra-autorizacao" />
            {{ T('exigeAutorizacao') }}</label
          >
          <label class="marca"
            ><input v-model="form.incluidoNaDiaria" type="checkbox" data-testid="regra-diaria" />
            {{ T('incluidoNaDiaria') }}</label
          >
        </div>
        <fieldset class="linha">
          <legend>{{ T('refeicoesCobertas') }}</legend>
          <label v-for="o in opcoesRefeicao" :key="o.valor" class="marca">
            <input
              v-model="form.refeicoes"
              type="checkbox"
              :value="o.valor"
              :data-testid="`regra-refeicao-${o.valor}`"
            />
            {{ o.rotulo }}
          </label>
        </fieldset>
        <ul v-if="problemas.length" class="problemas" role="alert" data-testid="regra-problemas">
          <li v-for="p in problemas" :key="p">{{ p }}</li>
        </ul>
        <div class="linha">
          <SanteBotao
            tipo="submit"
            :rotulo="T('salvar')"
            :desabilitado="ocupado || problemas.length > 0"
            data-testid="salvar-regra"
          />
          <SanteBotao
            variante="texto"
            :rotulo="T('cancelarEdicao')"
            data-testid="cancelar-regra"
            @acionar="form.aberto = false"
          />
        </div>
      </form>
    </section>
  </main>
</template>

<style scoped>
.direito {
  display: grid;
  gap: var(--sgh-espaco-3);
}
.abas {
  display: flex;
  gap: var(--sgh-espaco-2);
  border-block-end: 1px solid var(--sgh-borda);
}
.abas button {
  background: none;
  border: 0;
  padding: var(--sgh-espaco-2) var(--sgh-espaco-3);
  cursor: pointer;
  color: inherit;
}
.abas button.ativa {
  border-block-end: 3px solid var(--sgh-primaria);
  font-weight: 600;
}
section {
  display: grid;
  gap: var(--sgh-espaco-3);
}
.linha,
.acoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-3);
  align-items: end;
}
.grade {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
  gap: var(--sgh-espaco-3);
}
.formulario {
  display: grid;
  gap: var(--sgh-espaco-3);
  padding: var(--sgh-espaco-3);
  border: 1px solid var(--sgh-borda);
  border-radius: var(--sgh-raio, 4px);
}
.decisao {
  display: grid;
  gap: var(--sgh-espaco-1);
  padding: var(--sgh-espaco-3);
  border-inline-start: 4px solid var(--sgh-primaria);
}
.tabela {
  width: 100%;
  border-collapse: collapse;
}
.tabela th,
.tabela td {
  text-align: start;
  padding: var(--sgh-espaco-2);
  border-block-end: 1px solid var(--sgh-borda);
  vertical-align: top;
}
.inativa {
  opacity: 0.6;
}
.secundario {
  color: var(--sgh-texto-secundario);
}
.problemas {
  color: var(--sgh-alerta);
  margin: 0;
}
.marca {
  display: inline-flex;
  gap: var(--sgh-espaco-1);
  align-items: center;
}
</style>
