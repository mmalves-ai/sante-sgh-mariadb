<script setup lang="ts">
// Cadastro editável do catálogo da prescrição (03-PEP L106, C1-115), na tela de cada cadastro:
//   - frequências: inclui e altera numa linha (tipo, intervalo ou doses, dias, validade, setores onde vale) e as
//     condições "se necessário" com o disparo pelo sinal vital;
//   - itens não padronizados: inclusão com unidade, vias e justificativa (código NP gerado pelo sistema);
//   - parâmetros do item: os complementos de um item (frequências aceitas, regra no setor, sinônimos de busca,
//     conflitos), incluir e retirar num clique; o item não padronizado sai de uso e volta pelo mesmo painel.
// A validação na hora é a mesma regra do servidor (@sgh/dominio-pep); retirar nunca apaga.
import {
  DIAS_SEMANA_FREQUENCIA,
  MENSAGENS_CADASTRO_CATALOGO,
  type ProblemaCadastro,
  problemasDaCondicao,
  problemasDaFrequencia,
  problemasDaRegraSetor,
  problemasDoConflito,
  problemasDoNaoPadronizado,
  problemasDoSinonimo,
  TIPOS_FREQUENCIA,
  type TipoFrequencia,
} from '@sgh/dominio-pep';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../../casca/MensagemErro.vue';
import { pode } from '../../../../casca/sessao/pode.js';
import {
  type FrequenciaCadastrada,
  gravarCondicao,
  gravarFrequencia,
  incluirComplemento,
  incluirNaoPadronizado,
  lerApoioCatalogo,
  lerComplementos,
  listarCondicoes,
  listarFrequencias,
  retirarComplemento,
  situacaoNaoPadronizado,
  type TipoComplemento,
} from '../../api-catalogo-prescricao.js';

const props = defineProps<{ secao: 'frequencias' | 'naoPadronizados' | 'parametrosItem' }>();
const { t } = useI18n();
const qc = useQueryClient();
const apoio = useQuery({
  queryKey: ['presc', 'catalogo', 'apoio'],
  queryFn: () => lerApoioCatalogo(),
  staleTime: 300_000,
});
const freqs = useQuery({
  queryKey: ['presc', 'catalogo', 'frequencias'],
  queryFn: () => listarFrequencias(),
  enabled: computed(() => props.secao === 'frequencias'),
});
const conds = useQuery({
  queryKey: ['presc', 'catalogo', 'condicoes'],
  queryFn: () => listarCondicoes(),
  enabled: computed(() => props.secao === 'frequencias'),
});
const erro = ref<unknown>(null);
const aviso = ref('');
const textos = (ps: readonly ProblemaCadastro[]) =>
  ps.map((p) => MENSAGENS_CADASTRO_CATALOGO[p.codigo] ?? p.codigo);
const inteiro = (s: string): number | null => (s.trim() && Number.isFinite(Number(s)) ? Number(s) : null);
const opcoes = (
  l: readonly { id: number; nome: string }[] | undefined,
  vazio = t('pep.catalogo.escolha'),
) => [{ valor: '', rotulo: vazio }, ...(l ?? []).map((x) => ({ valor: String(x.id), rotulo: x.nome }))];
async function tentar(fn: () => Promise<unknown>, ok: string, chaves: string[][]): Promise<boolean> {
  erro.value = null;
  aviso.value = '';
  try {
    await fn();
    aviso.value = ok;
    for (const k of chaves) await qc.invalidateQueries({ queryKey: k });
    return true;
  } catch (e) {
    erro.value = e;
    return false;
  }
}

// ── frequência ──
const ROTULO_TIPO = (tipo: string): string =>
  (TIPOS_FREQUENCIA as readonly string[]).includes(tipo) ? t(`pep.catalogo.tipo.${tipo}`) : tipo;
const f = reactive({
  id: 0,
  versao: 0,
  codigo: '',
  descricao: '',
  resumo: '',
  tipo: 'intervalo' as TipoFrequencia,
  intervaloHoras: '',
  doses: '',
  validade: '',
  horarioFixo: false,
  escopo: 'todos' as 'todos' | 'somente_listados' | 'exceto_listados',
  dias: [] as string[],
  setores: [] as number[],
});
// Cada formulário aparece só para quem pode gravar pela rota dele (a leitura do catálogo continua para todos).
const podeFreq = computed(() => pode('pep.frequenciaPrescricao.editar'));
const podeCond = computed(
  () => pode('pep.condicaoSeNecessario.editar') || pode('pep.condicaoSeNecessario.criar'),
);
const podeNpCriar = computed(() => pode('pep.itemNaoPadronizado.criar'));
const podeNpInativar = computed(() => pode('pep.itemNaoPadronizado.inativar'));
const podeComp = computed(() => pode('pep.parametroClinicoItem.editar'));
const somenteLeitura = computed(() =>
  props.secao === 'frequencias'
    ? !podeFreq.value || !podeCond.value
    : props.secao === 'naoPadronizados'
      ? !podeNpCriar.value
      : !podeComp.value,
);

const entradaFrequencia = computed(() => {
  const h = inteiro(f.intervaloHoras);
  return {
    ...(f.id ? { id: f.id, versao: f.versao } : {}),
    codigo: f.codigo,
    descricao: f.descricao,
    descricaoResumida: f.resumo.trim() || null,
    tipo: f.tipo,
    intervaloMinutos: f.tipo === 'intervalo' && h !== null ? Math.round(h * 60) : null,
    dosesPorDia: f.tipo === 'vezes_ao_dia' ? inteiro(f.doses) : null,
    limiteHoras: f.tipo === 'agora' || f.tipo === 'dose_unica' ? inteiro(f.validade) : null,
    horarioFixo: f.horarioFixo,
    uso: 'todos' as const,
    dias: f.tipo === 'dias_semana' ? (f.dias as (typeof DIAS_SEMANA_FREQUENCIA)[number][]) : [],
    escopoSetor: f.escopo,
    setores: f.escopo === 'todos' ? [] : f.setores,
  };
});
const faltaFrequencia = computed(() => textos(problemasDaFrequencia(entradaFrequencia.value)));
function editarFrequencia(x: FrequenciaCadastrada): void {
  Object.assign(f, {
    id: x.id,
    versao: x.versao,
    codigo: x.codigo,
    descricao: x.descricao,
    resumo: x.descricaoResumida ?? '',
    tipo: x.tipo as TipoFrequencia,
    intervaloHoras: x.intervaloMinutos ? String(x.intervaloMinutos / 60) : '',
    doses: x.dosesPorDia ? String(x.dosesPorDia) : '',
    validade: x.limiteHoras ? String(x.limiteHoras) : '',
    horarioFixo: x.horarioFixo,
    escopo: x.escopoSetor,
    dias: [...x.dias],
    setores: [...x.setores],
  });
}
function novaFrequencia(): void {
  Object.assign(f, {
    id: 0,
    versao: 0,
    codigo: '',
    descricao: '',
    resumo: '',
    intervaloHoras: '',
    doses: '',
    validade: '',
    dias: [],
    setores: [],
    escopo: 'todos',
    horarioFixo: false,
  });
}
async function salvarFrequencia(): Promise<void> {
  if (faltaFrequencia.value.length) return;
  if (
    await tentar(() => gravarFrequencia(entradaFrequencia.value), t('pep.catalogo.freq.gravada'), [
      ['presc', 'catalogo'],
      ['presc', 'dominios'],
    ])
  )
    novaFrequencia();
}

// ── condição se necessário ──
const c = reactive({ id: 0, versao: 0, codigo: '', descricao: '', parametro: '', limiar: '', ativo: true });
const entradaCondicao = computed(() => ({
  ...(c.id ? { id: c.id, versao: c.versao } : {}),
  codigo: c.codigo,
  descricao: c.descricao,
  parametroVital: inteiro(c.parametro),
  limiar: c.limiar.trim() ? Number(c.limiar.replace(',', '.')) : null,
  ativo: c.ativo,
}));
const faltaCondicao = computed(() => textos(problemasDaCondicao(entradaCondicao.value)));
async function salvarCondicao(): Promise<void> {
  if (faltaCondicao.value.length) return;
  if (
    await tentar(() => gravarCondicao(entradaCondicao.value), t('pep.catalogo.cond.gravada'), [
      ['presc', 'catalogo'],
    ])
  )
    Object.assign(c, { id: 0, versao: 0, codigo: '', descricao: '', parametro: '', limiar: '', ativo: true });
}

// ── item não padronizado ──
const n = reactive({
  descricao: '',
  tipo: '',
  unidade: '',
  via: '',
  vias: [] as number[],
  justificativa: '',
});
const entradaNp = computed(() => ({
  descricao: n.descricao,
  tipoItem: inteiro(n.tipo) ?? 0,
  unidade: inteiro(n.unidade),
  principioAtivo: null,
  vias: n.vias,
  justificativa: n.justificativa,
}));
const faltaNp = computed(() => [
  ...(n.tipo ? [] : [t('pep.catalogo.np.faltaTipo')]),
  ...textos(problemasDoNaoPadronizado(entradaNp.value)),
]);
function somarVia(): void {
  const v = inteiro(n.via);
  if (v !== null && !n.vias.includes(v)) n.vias.push(v);
  n.via = '';
}
const nomeVia = (id: number) => apoio.data.value?.vias.find((x) => x.id === id)?.nome ?? String(id);
async function salvarNp(): Promise<void> {
  if (faltaNp.value.length) return;
  if (
    await tentar(() => incluirNaoPadronizado(entradaNp.value), t('pep.catalogo.np.incluido'), [
      ['presc', 'cadastro'],
    ])
  )
    Object.assign(n, { descricao: '', via: '', vias: [], justificativa: '' });
}

// ── complementos do item ──
const itemTexto = ref('');
const item = ref<number | null>(null);
const comp = useQuery({
  queryKey: computed(() => ['presc', 'catalogo', 'complementos', item.value]),
  queryFn: () => lerComplementos(item.value!),
  enabled: computed(() => props.secao === 'parametrosItem' && item.value !== null),
});
const k = reactive({
  frequencia: '',
  setor: '',
  bloqueado: false,
  motivo: '',
  restrito: false,
  termo: '',
  conflitante: '',
  gravidade: 'alerta',
  motivoConflito: '',
});
const faltaSetor = computed(() =>
  textos(
    problemasDaRegraSetor({
      setor: inteiro(k.setor),
      local: null,
      padronizado: true,
      usoRestrito: k.restrito,
      bloqueado: k.bloqueado,
      motivoBloqueio: k.motivo || null,
      via: null,
      frequencia: null,
      quantidadePadrao: null,
      dosePadrao: null,
    }),
  ),
);
const faltaSinonimo = computed(() =>
  comp.data.value && k.termo
    ? textos(
        problemasDoSinonimo(
          k.termo,
          comp.data.value.item.descricao,
          comp.data.value.sinonimos.map((x) => x.termo),
        ),
      )
    : [],
);
const faltaConflito = computed(() => {
  const o = inteiro(k.conflitante);
  if (!comp.data.value || o === null) return [];
  return textos(
    problemasDoConflito(
      comp.data.value.item.id,
      o,
      k.gravidade as 'alerta' | 'impeditivo',
      k.motivoConflito || null,
      comp.data.value.conflitos.map((x) => [comp.data.value!.item.id, x.conflitante] as const),
    ),
  );
});
const chavesItem = () => [['presc', 'catalogo', 'complementos', item.value as unknown as string]];
async function incluir(corpo: Record<string, unknown>, ok: string): Promise<void> {
  if (item.value === null) return;
  const i = item.value;
  if (await tentar(() => incluirComplemento(i, corpo), ok, chavesItem()))
    Object.assign(k, {
      frequencia: '',
      setor: '',
      bloqueado: false,
      motivo: '',
      restrito: false,
      termo: '',
      conflitante: '',
      motivoConflito: '',
    });
}
async function retirar(tipo: TipoComplemento, id: number, versao: number): Promise<void> {
  if (item.value === null) return;
  const i = item.value;
  await tentar(() => retirarComplemento(i, tipo, id, versao), t('pep.catalogo.comp.retirado'), chavesItem());
}
async function trocarSituacao(): Promise<void> {
  const it = comp.data.value?.item;
  if (!it) return;
  await tentar(
    () => situacaoNaoPadronizado(it.id, it.versao, !it.ativo),
    it.ativo ? t('pep.catalogo.comp.tiradoDeUso') : t('pep.catalogo.comp.deVoltaAoUso'),
    chavesItem(),
  );
}
</script>

<template>
  <section class="edicao" data-testid="edicao-catalogo" :aria-label="t('pep.catalogo.rotuloSecao')">
    <SanteAlerta v-if="aviso" variante="info" :texto="aviso" data-testid="catalogo-aviso" />
    <MensagemErro v-if="erro" :erro="erro" />
    <SanteAlerta
      v-if="somenteLeitura"
      variante="info"
      :texto="t('pep.catalogo.somenteLeitura')"
      data-testid="catalogo-somente-leitura"
    />

    <template v-if="secao === 'frequencias'">
      <form v-if="podeFreq" class="painel" data-testid="form-frequencia" @submit.prevent="salvarFrequencia">
        <h2>{{ f.id ? t('pep.catalogo.freq.alterar') : t('pep.catalogo.freq.nova') }}</h2>
        <div class="linha">
          <SanteCampoTexto
            id="fr-codigo"
            v-model="f.codigo"
            :max-bytes="30"
            :rotulo="t('pep.catalogo.freq.codigo')"
            data-testid="fr-codigo"
          />
          <SanteCampoTexto
            id="fr-descricao"
            v-model="f.descricao"
            :max-bytes="150"
            :rotulo="t('pep.catalogo.np.descricao')"
            data-testid="fr-descricao"
          />
          <SanteCampoTexto
            id="fr-resumo"
            v-model="f.resumo"
            :max-bytes="15"
            :rotulo="t('pep.catalogo.freq.resumo')"
            data-testid="fr-resumo"
          />
          <SanteSelecao
            id="fr-tipo"
            v-model="f.tipo"
            :rotulo="t('pep.catalogo.freq.tipo')"
            :opcoes="TIPOS_FREQUENCIA.map((tp) => ({ valor: tp, rotulo: ROTULO_TIPO(tp) }))"
            data-testid="fr-tipo"
          />
        </div>
        <div class="linha">
          <SanteCampoTexto
            v-if="f.tipo === 'intervalo'"
            id="fr-intervalo"
            v-model="f.intervaloHoras"
            :max-bytes="6"
            :rotulo="t('pep.catalogo.freq.intervalo')"
            data-testid="fr-intervalo"
          />
          <SanteCampoTexto
            v-if="f.tipo === 'vezes_ao_dia'"
            id="fr-doses"
            v-model="f.doses"
            :max-bytes="2"
            :rotulo="t('pep.catalogo.freq.doses')"
            data-testid="fr-doses"
          />
          <SanteCampoTexto
            v-if="f.tipo === 'agora' || f.tipo === 'dose_unica'"
            id="fr-validade"
            v-model="f.validade"
            :max-bytes="4"
            :rotulo="t('pep.catalogo.freq.validade')"
            data-testid="fr-validade"
          />
          <label v-if="f.tipo === 'intervalo' || f.tipo === 'vezes_ao_dia'" class="marca">
            <input v-model="f.horarioFixo" type="checkbox" data-testid="fr-fixo" />
            {{ t('pep.catalogo.freq.gradeSetor') }}
          </label>
        </div>
        <fieldset v-if="f.tipo === 'dias_semana'" class="linha" data-testid="fr-dias">
          <legend>{{ t('pep.catalogo.freq.dias') }}</legend>
          <label v-for="d in DIAS_SEMANA_FREQUENCIA" :key="d" class="marca">
            <input v-model="f.dias" type="checkbox" :value="d" /> {{ d }}
          </label>
        </fieldset>
        <div class="linha">
          <SanteSelecao
            id="fr-escopo"
            v-model="f.escopo"
            :rotulo="t('pep.catalogo.freq.setores')"
            :opcoes="[
              { valor: 'todos', rotulo: t('pep.catalogo.freq.escopoTodos') },
              { valor: 'somente_listados', rotulo: t('pep.catalogo.freq.escopoSomente') },
              { valor: 'exceto_listados', rotulo: t('pep.catalogo.freq.escopoExceto') },
            ]"
            data-testid="fr-escopo"
          />
        </div>
        <fieldset v-if="f.escopo !== 'todos'" class="linha" data-testid="fr-setores">
          <legend>{{ t('pep.catalogo.freq.setoresMarcados') }}</legend>
          <label v-for="s in apoio.data.value?.setores ?? []" :key="s.id" class="marca">
            <input v-model="f.setores" type="checkbox" :value="s.id" /> {{ s.nome }}
          </label>
        </fieldset>
        <p v-if="faltaFrequencia.length" class="falta" role="status" data-testid="fr-falta">
          {{ faltaFrequencia.join(' ') }}
        </p>
        <div class="linha">
          <SanteBotao
            :rotulo="t('pep.catalogo.freq.gravar')"
            tipo="submit"
            :desabilitado="faltaFrequencia.length > 0"
            data-testid="fr-salvar"
          />
          <SanteBotao
            v-if="f.id"
            :rotulo="t('pep.catalogo.freq.cancelar')"
            variante="texto"
            @acionar="novaFrequencia"
          />
        </div>
      </form>
      <table data-testid="frequencias-cadastradas">
        <caption>
          {{
            t('pep.catalogo.freq.cadastradas')
          }}
        </caption>
        <tbody>
          <tr v-for="x in freqs.data.value ?? []" :key="x.id" :class="{ inativa: !x.ativo }">
            <th scope="row">{{ x.descricao }}</th>
            <td>{{ x.codigo }}</td>
            <td>{{ ROTULO_TIPO(x.tipo) }}</td>
            <td>
              <SanteBotao
                v-if="podeFreq"
                :rotulo="t('pep.catalogo.freq.alterarItem', { nome: x.descricao })"
                variante="texto"
                @acionar="editarFrequencia(x)"
              />
            </td>
          </tr>
        </tbody>
      </table>

      <form v-if="podeCond" class="painel" data-testid="form-condicao" @submit.prevent="salvarCondicao">
        <h2>{{ c.id ? t('pep.catalogo.cond.alterar') : t('pep.catalogo.cond.nova') }}</h2>
        <div class="linha">
          <SanteCampoTexto
            id="cd-codigo"
            v-model="c.codigo"
            :max-bytes="30"
            :rotulo="t('pep.catalogo.freq.codigo')"
            data-testid="cd-codigo"
          />
          <SanteCampoTexto
            id="cd-descricao"
            v-model="c.descricao"
            :max-bytes="150"
            :rotulo="t('pep.catalogo.cond.descricao')"
            data-testid="cd-descricao"
          />
          <SanteSelecao
            id="cd-parametro"
            v-model="c.parametro"
            :rotulo="t('pep.catalogo.cond.parametro')"
            :opcoes="opcoes(apoio.data.value?.parametros, t('pep.catalogo.cond.semDisparo'))"
            data-testid="cd-parametro"
          />
          <SanteCampoTexto
            id="cd-limiar"
            v-model="c.limiar"
            :max-bytes="12"
            :rotulo="t('pep.catalogo.cond.limiar')"
            data-testid="cd-limiar"
          />
        </div>
        <p v-if="faltaCondicao.length" class="falta" role="status" data-testid="cd-falta">
          {{ faltaCondicao.join(' ') }}
        </p>
        <SanteBotao
          :rotulo="t('pep.catalogo.cond.gravar')"
          tipo="submit"
          :desabilitado="faltaCondicao.length > 0"
          data-testid="cd-salvar"
        />
      </form>
      <ul class="lista" data-testid="condicoes-cadastradas">
        <li v-for="x in conds.data.value ?? []" :key="x.id" :class="{ inativa: !x.ativo }">
          {{ x.descricao
          }}<template v-if="x.parametro">{{
            t('pep.catalogo.cond.disparo', { parametro: x.parametro, limiar: x.limiar })
          }}</template>
          <SanteBotao
            v-if="podeCond"
            :rotulo="
              x.ativo
                ? t('pep.catalogo.cond.tirar', { nome: x.descricao })
                : t('pep.catalogo.cond.voltar', { nome: x.descricao })
            "
            variante="texto"
            @acionar="
              tentar(
                () =>
                  gravarCondicao({
                    id: x.id,
                    versao: x.versao,
                    codigo: x.codigo,
                    descricao: x.descricao,
                    parametroVital: x.parametroVital,
                    limiar: x.limiar,
                    ativo: !x.ativo,
                  }),
                t('pep.catalogo.cond.gravada'),
                [['presc', 'catalogo']],
              )
            "
          />
        </li>
      </ul>
    </template>

    <form
      v-else-if="secao === 'naoPadronizados' && podeNpCriar"
      class="painel"
      data-testid="form-nao-padronizado"
      @submit.prevent="salvarNp"
    >
      <h2>{{ t('pep.catalogo.np.titulo') }}</h2>
      <div class="linha">
        <SanteCampoTexto
          id="np-descricao"
          v-model="n.descricao"
          :max-bytes="200"
          :rotulo="t('pep.catalogo.np.descricao')"
          data-testid="np-descricao"
        />
        <SanteSelecao
          id="np-tipo"
          v-model="n.tipo"
          :rotulo="t('pep.catalogo.np.tipo')"
          :opcoes="opcoes(apoio.data.value?.tipos)"
          data-testid="np-tipo"
        />
        <SanteSelecao
          id="np-unidade"
          v-model="n.unidade"
          :rotulo="t('pep.catalogo.np.unidade')"
          :opcoes="opcoes(apoio.data.value?.unidades)"
          data-testid="np-unidade"
        />
      </div>
      <div class="linha">
        <SanteSelecao
          id="np-via"
          v-model="n.via"
          :rotulo="t('pep.catalogo.np.via')"
          :opcoes="opcoes(apoio.data.value?.vias)"
          data-testid="np-via"
        />
        <SanteBotao
          :rotulo="t('pep.catalogo.np.somarVia')"
          variante="texto"
          :desabilitado="!n.via"
          data-testid="np-somar-via"
          @acionar="somarVia"
        />
        <span v-for="v in n.vias" :key="v" class="etiqueta">
          {{ nomeVia(v) }}
          <SanteBotao
            :rotulo="t('pep.catalogo.np.tirarVia', { nome: nomeVia(v) })"
            variante="texto"
            @acionar="n.vias = n.vias.filter((x) => x !== v)"
          />
        </span>
      </div>
      <SanteCampoTexto
        id="np-justificativa"
        v-model="n.justificativa"
        :max-bytes="1000"
        multilinha
        :rotulo="t('pep.catalogo.np.justificativa')"
        data-testid="np-justificativa"
      />
      <p v-if="faltaNp.length" class="falta" role="status" data-testid="np-falta">{{ faltaNp.join(' ') }}</p>
      <SanteBotao
        :rotulo="t('pep.catalogo.np.incluir')"
        tipo="submit"
        :desabilitado="faltaNp.length > 0"
        data-testid="np-salvar"
      />
    </form>

    <template v-else-if="secao === 'parametrosItem'">
      <form class="linha" data-testid="form-item-complementos" @submit.prevent="item = inteiro(itemTexto)">
        <SanteCampoTexto
          id="cp-item"
          v-model="itemTexto"
          :max-bytes="12"
          :rotulo="t('pep.catalogo.comp.numeroItem')"
          data-testid="cp-item"
        />
        <SanteBotao
          :rotulo="t('pep.catalogo.comp.abrir')"
          tipo="submit"
          :desabilitado="inteiro(itemTexto) === null"
          data-testid="cp-abrir"
        />
      </form>
      <MensagemErro v-if="comp.isError.value" :erro="comp.error.value" />
      <section v-else-if="comp.data.value" class="painel" data-testid="complementos-item">
        <h2>{{ comp.data.value.item.descricao }}</h2>
        <SanteBotao
          v-if="!comp.data.value.item.padronizado && podeNpInativar"
          :rotulo="
            comp.data.value.item.ativo
              ? t('pep.catalogo.comp.tirarDeUso')
              : t('pep.catalogo.comp.voltarAoUso')
          "
          variante="texto"
          data-testid="cp-situacao"
          @acionar="trocarSituacao"
        />
        <h3>{{ t('pep.catalogo.comp.frequencias') }}</h3>
        <ul class="lista">
          <li v-for="x in comp.data.value.frequencias" :key="x.id">
            {{ x.nome }}
            <SanteBotao
              v-if="podeComp"
              :rotulo="t('pep.catalogo.comp.retirar', { nome: x.nome })"
              variante="texto"
              @acionar="retirar('frequencia', x.id, x.versao)"
            />
          </li>
        </ul>
        <div v-if="podeComp" class="linha">
          <SanteSelecao
            id="cp-frequencia"
            v-model="k.frequencia"
            :rotulo="t('pep.catalogo.comp.frequencia')"
            :opcoes="opcoes(apoio.data.value?.frequencias)"
            data-testid="cp-frequencia"
          />
          <SanteBotao
            :rotulo="t('pep.catalogo.comp.aceitarFrequencia')"
            :desabilitado="!k.frequencia"
            data-testid="cp-incluir-frequencia"
            @acionar="
              incluir(
                { tipo: 'frequencia', frequencia: inteiro(k.frequencia) },
                t('pep.catalogo.comp.frequenciaAceita'),
              )
            "
          />
        </div>
        <h3>{{ t('pep.catalogo.comp.setores') }}</h3>
        <ul class="lista">
          <li v-for="x in comp.data.value.setores" :key="x.id">
            {{ x.nome ?? t('pep.catalogo.comp.estabelecimentoInteiro')
            }}{{ x.usoRestrito ? t('pep.catalogo.comp.usoRestritoMarca') : ''
            }}{{ x.bloqueado ? t('pep.catalogo.comp.bloqueadoMarca', { motivo: x.motivoBloqueio }) : '' }}
            <SanteBotao
              v-if="podeComp"
              :rotulo="
                t('pep.catalogo.comp.retirarRegra', {
                  nome: x.nome ?? t('pep.catalogo.comp.estabelecimento'),
                })
              "
              variante="texto"
              @acionar="retirar('setor', x.id, x.versao)"
            />
          </li>
        </ul>
        <div v-if="podeComp" class="linha">
          <SanteSelecao
            id="cp-setor"
            v-model="k.setor"
            :rotulo="t('pep.catalogo.comp.setor')"
            :opcoes="opcoes(apoio.data.value?.setores, t('pep.catalogo.comp.estabelecimentoInteiro'))"
            data-testid="cp-setor"
          />
          <label class="marca"
            ><input v-model="k.restrito" type="checkbox" data-testid="cp-restrito" />
            {{ t('pep.catalogo.comp.restrito') }}</label
          >
          <label class="marca"
            ><input v-model="k.bloqueado" type="checkbox" data-testid="cp-bloqueado" />
            {{ t('pep.catalogo.comp.bloqueado') }}</label
          >
          <SanteCampoTexto
            v-if="k.bloqueado"
            id="cp-motivo"
            v-model="k.motivo"
            :max-bytes="200"
            :rotulo="t('pep.catalogo.comp.motivoBloqueio')"
            data-testid="cp-motivo"
          />
          <SanteBotao
            :rotulo="t('pep.catalogo.comp.gravarSetor')"
            :desabilitado="faltaSetor.length > 0"
            data-testid="cp-incluir-setor"
            @acionar="
              incluir(
                {
                  tipo: 'setor',
                  setor: inteiro(k.setor),
                  usoRestrito: k.restrito,
                  bloqueado: k.bloqueado,
                  motivoBloqueio: k.bloqueado ? k.motivo : null,
                },
                t('pep.catalogo.comp.setorGravado'),
              )
            "
          />
        </div>
        <p v-if="faltaSetor.length" class="falta" role="status">{{ faltaSetor.join(' ') }}</p>
        <h3>{{ t('pep.catalogo.comp.sinonimos') }}</h3>
        <ul class="lista">
          <li v-for="x in comp.data.value.sinonimos" :key="x.id">
            {{ x.termo }}
            <SanteBotao
              v-if="podeComp"
              :rotulo="t('pep.catalogo.comp.retirar', { nome: x.termo })"
              variante="texto"
              @acionar="retirar('sinonimo', x.id, x.versao)"
            />
          </li>
        </ul>
        <div v-if="podeComp" class="linha">
          <SanteCampoTexto
            id="cp-termo"
            v-model="k.termo"
            :max-bytes="100"
            :rotulo="t('pep.catalogo.comp.termo')"
            data-testid="cp-termo"
          />
          <SanteBotao
            :rotulo="t('pep.catalogo.comp.incluirSinonimo')"
            :desabilitado="!k.termo || faltaSinonimo.length > 0"
            data-testid="cp-incluir-sinonimo"
            @acionar="incluir({ tipo: 'sinonimo', termo: k.termo }, t('pep.catalogo.comp.sinonimoIncluido'))"
          />
        </div>
        <p v-if="faltaSinonimo.length" class="falta" role="status" data-testid="cp-falta-sinonimo">
          {{ faltaSinonimo.join(' ') }}
        </p>
        <h3>{{ t('pep.catalogo.comp.conflitos') }}</h3>
        <ul class="lista">
          <li v-for="x in comp.data.value.conflitos" :key="x.id">
            {{ x.nome }} · {{ x.gravidade }}{{ x.motivo ? ` · ${x.motivo}` : '' }}
            <SanteBotao
              v-if="podeComp"
              :rotulo="t('pep.catalogo.comp.retirarConflito', { nome: x.nome })"
              variante="texto"
              @acionar="retirar('conflito', x.id, x.versao)"
            />
          </li>
        </ul>
        <div v-if="podeComp" class="linha">
          <SanteCampoTexto
            id="cp-conflitante"
            v-model="k.conflitante"
            :max-bytes="12"
            :rotulo="t('pep.catalogo.comp.outroItem')"
            data-testid="cp-conflitante"
          />
          <SanteSelecao
            id="cp-gravidade"
            v-model="k.gravidade"
            :rotulo="t('pep.catalogo.comp.gravidade')"
            :opcoes="[
              { valor: 'alerta', rotulo: t('pep.catalogo.comp.alerta') },
              { valor: 'impeditivo', rotulo: t('pep.catalogo.comp.impeditivo') },
            ]"
            data-testid="cp-gravidade"
          />
          <SanteCampoTexto
            id="cp-motivo-conflito"
            v-model="k.motivoConflito"
            :max-bytes="300"
            :rotulo="t('pep.catalogo.comp.motivo')"
            data-testid="cp-motivo-conflito"
          />
          <SanteBotao
            :rotulo="t('pep.catalogo.comp.incluirConflito')"
            :desabilitado="inteiro(k.conflitante) === null || faltaConflito.length > 0"
            data-testid="cp-incluir-conflito"
            @acionar="
              incluir(
                {
                  tipo: 'conflito',
                  conflitante: inteiro(k.conflitante),
                  gravidade: k.gravidade,
                  motivo: k.motivoConflito || null,
                },
                t('pep.catalogo.comp.conflitoIncluido'),
              )
            "
          />
        </div>
        <p v-if="faltaConflito.length" class="falta" role="status">{{ faltaConflito.join(' ') }}</p>
      </section>
    </template>
  </section>
</template>

<style scoped>
.edicao,
.painel {
  display: grid;
  gap: var(--sgh-espaco-3);
}
.linha {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
}
.lista {
  list-style: none;
  padding: 0;
  display: grid;
  gap: var(--sgh-espaco-1);
}
.marca {
  display: inline-flex;
  gap: var(--sgh-espaco-1);
  align-items: center;
}
.falta {
  color: var(--sgh-alerta);
  margin: 0;
}
.inativa {
  opacity: 0.6;
}
.etiqueta {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--sgh-borda);
  padding: 0 var(--sgh-espaco-1);
}
h2,
h3 {
  margin: 0;
}
</style>
