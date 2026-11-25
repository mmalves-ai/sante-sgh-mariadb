<script setup lang="ts">
// F3.8, 07-FIN linha 111: a EFD-REINF por evento na competência, vista por beneficiário. Um clique gera os eventos da
// série (um por beneficiário, o tributo com processo vai como suspenso, o aceito que mudou volta como retificador e o
// aceito que saiu da competência ganha a exclusão); os prontos para envio já vêm marcados para a transmissão ao
// simulador; o retorno (recibo ou ocorrências) é registrado na linha do evento. O processo com suspensão é mantido
// aqui, com a conferência na hora (a mesma regra do domínio). Na linha do processo: encerrar a suspensão cuja decisão
// caiu (vale até o dia), anular a lançada por engano e alterar a vara e a vigência do processo, sempre sem apagar.
// O título com retenção cujo credor não tem CPF nem CNPJ fica fora dos eventos e é avisado no alto do painel.
import {
  conferirAlteracaoProcesso,
  conferirEncerramentoSuspensao,
  conferirProcessoSuspensao,
  TRIBUTOS_PROCESSO_REINF,
} from '@sgh/dominio-financeiro';
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import { novaChave } from '../api-financeiro.js';
import {
  alterarProcessoReinf,
  encerrarSuspensaoReinf,
  type EventoReinfTela,
  gerarEventosReinf,
  gravarProcessoReinf,
  lerPainelReinf,
  lerXmlReinf,
  type ProcessoReinfTela,
  registrarRetornoReinf,
  transmitirReinf,
} from '../api-reinf.js';

const props = defineProps<{ competencia: string; podeGerar: boolean }>();
const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      titulo: 'Eventos da EFD-REINF por beneficiário',
      serie: 'Série',
      gerar: 'Gerar eventos da competência',
      transmitir: 'Transmitir marcados ao simulador',
      nenhum: 'Nenhum evento na competência.',
      beneficiario: 'Beneficiário',
      evento: 'Evento',
      situacao: 'Situação',
      bruto: 'Bruto',
      retido: 'Retido',
      suspenso: 'Suspenso',
      recibo: 'Recibo',
      retorno: 'Retorno',
      aceito: 'Aceito',
      rejeitado: 'Rejeitado',
      ocorrencias: 'Ocorrências',
      xml: 'Ver XML',
      marcar: 'Marcar para transmitir',
      retifica: 'retifica {id}',
      exclui: 'exclui {id}',
      lote: 'lote {n}',
      processos: 'Processos com suspensão',
      novoProcesso: 'Novo processo com suspensão',
      tipo: 'Tipo',
      judicial: 'Judicial',
      administrativo: 'Administrativo',
      numero: 'Número do processo',
      vara: 'Vara',
      indicativo: 'Indicativo de suspensão',
      tributo: 'Tributo suspenso',
      tributos: { inss: 'INSS', ir: 'IR', csrf: 'PIS, COFINS e CSLL' },
      benefOpcional: 'Beneficiário (CPF ou CNPJ; vazio vale para todos)',
      inicio: 'Início da vigência',
      fim: 'Fim da vigência (opcional)',
      decisao: 'Data da decisão',
      incluir: 'Incluir processo',
      todos: 'todos',
      semFim: 'sem fim',
      vigencia: '{de} a {ate}',
      semDocumento:
        '{n} título(s) com retenção nesta competência estão fora dos eventos: o credor não tem CPF nem CNPJ no cadastro (títulos {ids}). Complete o cadastro e gere de novo.',
      processo: 'Processo',
      vigenciaCol: 'Vigência da suspensão',
      situacaoSusp: 'Situação da suspensão',
      acoes: 'Ações',
      emVigor: 'em vigor',
      encerrada: 'encerrada em {dia}: {motivo}',
      anulada: 'anulada: {motivo}',
      abrir: 'Encerrar ou alterar',
      fechar: 'Fechar',
      edicao: 'Suspensão de {tributo} do processo {numero}',
      fimSuspensao: 'Último dia em que a suspensão vale',
      motivo: 'Motivo',
      encerrar: 'Encerrar suspensão',
      anular: 'Anular (lançada por engano)',
      dadosProcesso: 'Dados do processo (valem para todas as suspensões dele)',
      fimProcesso: 'Fim da vigência (opcional)',
      gravarProcesso: 'Gravar dados do processo',
    },
  },
});
const qc = useQueryClient();
const chave = computed(() => ['financeiro', 'reinf', 'painel', props.competencia]);
const painel = useQuery({
  queryKey: chave,
  queryFn: () => lerPainelReinf(props.competencia),
  enabled: computed(() => /^\d{4}-\d{2}$/.test(props.competencia)),
});
const eventos = computed(() => painel.data.value?.eventos ?? []);
const processos = computed(() => painel.data.value?.processos ?? []);
const semDocumento = computed(() => painel.data.value?.titulosSemDocumento ?? []);
const serie = ref<'R-2000' | 'R-4000'>('R-4000');
const series = [
  { valor: 'R-2000', rotulo: 'R-2000 (INSS do serviço tomado)' },
  { valor: 'R-4000', rotulo: 'R-4000 (IR e contribuições)' },
];
const marcados = ref<number[]>([]);
watch(
  eventos,
  (ev) => {
    marcados.value = ev.filter((e) => e.situacao === 'gerado' || e.situacao === 'validado').map((e) => e.id);
  },
  { immediate: true },
);
const porBeneficiario = computed(() => {
  const m = new Map<string, EventoReinfTela[]>();
  for (const e of eventos.value) m.set(e.beneficiario, [...(m.get(e.beneficiario) ?? []), e]);
  return [...m.entries()];
});
const retorno = reactive<Record<number, { recibo: string; ocorrencias: string }>>({});
const campo = (id: number) => (retorno[id] ??= { recibo: '', ocorrencias: '' });
const xml = ref<{ id: number; texto: string } | null>(null);
const erro = ref<unknown>(null);
const ok = ref<string | null>(null);
const gravando = ref(false);
async function agir(fn: () => Promise<{ mensagem: string }>) {
  erro.value = null;
  ok.value = null;
  gravando.value = true;
  try {
    ok.value = (await fn()).mensagem;
    await qc.invalidateQueries({ queryKey: ['financeiro', 'reinf'] });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
const gerar = () =>
  agir(() => gerarEventosReinf({ serie: serie.value, periodo: props.competencia }, novaChave('reinf-gerar')));
const transmitir = () =>
  agir(() =>
    transmitirReinf({ periodo: props.competencia, eventos: marcados.value }, novaChave('reinf-transmitir')),
  );
const responder = (e: EventoReinfTela, aceito: boolean) =>
  agir(() =>
    registrarRetornoReinf(
      {
        evento: e.id,
        aceito,
        recibo: aceito ? campo(e.id).recibo || null : null,
        ocorrencias: aceito ? null : campo(e.id).ocorrencias || null,
      },
      novaChave('reinf-retorno'),
    ),
  );
async function verXml(id: number) {
  erro.value = null;
  try {
    xml.value = { id, texto: (await lerXmlReinf(id)).xml };
  } catch (e) {
    erro.value = e;
  }
}

const proc = reactive({
  tipo: 'judicial' as 'judicial' | 'administrativo',
  numero: '',
  vara: '',
  indicativo: '',
  tributo: 'ir' as (typeof TRIBUTOS_PROCESSO_REINF)[number],
  beneficiario: '',
  vigenciaInicio: '',
  vigenciaFim: '',
  dataDecisao: '',
});
const tipos = computed(() => [
  { valor: 'judicial', rotulo: t('judicial') },
  { valor: 'administrativo', rotulo: t('administrativo') },
]);
const tributos = computed(() =>
  TRIBUTOS_PROCESSO_REINF.map((x) => ({ valor: x, rotulo: t(`tributos.${x}`) })),
);
// A conferência na hora: a mesma regra que a gravação aplica.
const recusaProcesso = computed(() => {
  if (!proc.numero || !proc.indicativo || !proc.vigenciaInicio) return null;
  return conferirProcessoSuspensao({
    tipo: proc.tipo,
    numero: proc.numero,
    indicativo: proc.indicativo,
    tributo: proc.tributo,
    beneficiario: proc.beneficiario.trim() || null,
    vigenciaInicio: proc.vigenciaInicio,
    vigenciaFim: proc.vigenciaFim || null,
  });
});
const processoPronto = computed(
  () =>
    !!proc.numero &&
    !!proc.indicativo &&
    !!proc.vigenciaInicio &&
    !!proc.dataDecisao &&
    (proc.tipo !== 'judicial' || !!proc.vara.trim()) &&
    !recusaProcesso.value,
);
const incluirProcesso = () =>
  agir(async () => {
    const r = await gravarProcessoReinf(
      {
        tipo: proc.tipo,
        numero: proc.numero,
        vara: proc.vara.trim() || null,
        indicativo: proc.indicativo,
        tributo: proc.tributo,
        beneficiario: proc.beneficiario.trim() || null,
        vigenciaInicio: proc.vigenciaInicio,
        vigenciaFim: proc.vigenciaFim || null,
        dataDecisao: proc.dataDecisao,
      },
      novaChave('reinf-processo'),
    );
    proc.numero = '';
    proc.beneficiario = '';
    return r;
  });

// Encerrar ou anular a suspensão e alterar os dados do processo, na linha: conferidos na hora pela regra do domínio.
const edicao = ref<ProcessoReinfTela | null>(null);
const fimSusp = reactive({ fim: '', motivo: '' });
const dados = reactive({ vara: '', vigenciaInicio: '', vigenciaFim: '' });
function abrirEdicao(p: ProcessoReinfTela) {
  edicao.value = p;
  Object.assign(fimSusp, { fim: '', motivo: '' });
  Object.assign(dados, {
    vara: p.vara ?? '',
    vigenciaInicio: p.vigenciaInicio,
    vigenciaFim: p.vigenciaFimProcesso ?? '',
  });
}
const emVigor = (p: ProcessoReinfTela) => !p.anulada && p.encerradaEm === null;
const recusaFim = (fim: string | null) =>
  edicao.value
    ? conferirEncerramentoSuspensao(
        {
          vigenciaInicio: edicao.value.vigenciaInicio,
          encerradaEm: edicao.value.encerradaEm,
          anulada: edicao.value.anulada,
        },
        { fim, motivo: fimSusp.motivo },
      )
    : null;
const recusaEncerrar = computed(() => (fimSusp.fim ? recusaFim(fimSusp.fim) : null));
const recusaDados = computed(() =>
  edicao.value && dados.vigenciaInicio
    ? conferirAlteracaoProcesso({
        tipo: edicao.value.tipo,
        vara: dados.vara.trim() || null,
        vigenciaInicio: dados.vigenciaInicio,
        vigenciaFim: dados.vigenciaFim || null,
      })
    : null,
);
const encerrar = (fim: string | null) =>
  agir(async () => {
    const r = await encerrarSuspensaoReinf(
      { suspensao: edicao.value?.suspensao, fim, motivo: fimSusp.motivo.trim() },
      novaChave('reinf-suspensao'),
    );
    edicao.value = null;
    return r;
  });
const gravarDados = () =>
  agir(async () => {
    const r = await alterarProcessoReinf(
      {
        processo: edicao.value?.id,
        vara: dados.vara.trim() || null,
        vigenciaInicio: dados.vigenciaInicio,
        vigenciaFim: dados.vigenciaFim || null,
      },
      novaChave('reinf-processo-alterar'),
    );
    edicao.value = null;
    return r;
  });
const reais = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
</script>

<template>
  <section aria-labelledby="re-titulo" data-testid="reinf-eventos">
    <h2 id="re-titulo">{{ t('titulo') }}</h2>
    <form class="filtros" @submit.prevent="gerar">
      <span class="campo">
        <SanteSelecao v-model="serie" :rotulo="t('serie')" :opcoes="series" data-testid="re-serie" />
      </span>
      <button type="submit" :disabled="gravando || !podeGerar || !competencia" data-testid="re-gerar">
        {{ t('gerar') }}
      </button>
      <button
        type="button"
        :disabled="gravando || !podeGerar || marcados.length === 0"
        data-testid="re-transmitir"
        @click="transmitir"
      >
        {{ t('transmitir') }} ({{ marcados.length }})
      </button>
    </form>
    <ErroFaturamento v-if="erro" :erro="erro" />
    <ErroFaturamento v-if="painel.error.value" :erro="painel.error.value" />
    <p v-if="ok" role="status" class="secundario" data-testid="re-ok">{{ ok }}</p>
    <p v-if="semDocumento.length > 0" role="alert" data-testid="re-sem-documento">
      {{ t('semDocumento', { n: semDocumento.length, ids: semDocumento.join(', ') }) }}
    </p>
    <p v-if="eventos.length === 0" class="secundario" data-testid="re-vazio">{{ t('nenhum') }}</p>
    <table v-else class="tabela" data-testid="re-eventos">
      <thead>
        <tr>
          <th scope="col">{{ t('beneficiario') }}</th>
          <th scope="col">{{ t('evento') }}</th>
          <th scope="col">{{ t('situacao') }}</th>
          <th scope="col">{{ t('bruto') }}</th>
          <th scope="col">{{ t('retido') }}</th>
          <th scope="col">{{ t('suspenso') }}</th>
          <th scope="col">{{ t('retorno') }}</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="[benef, lista] in porBeneficiario" :key="benef">
          <tr v-for="e in lista" :key="e.id" :data-testid="`re-evento-${e.id}`" :data-beneficiario="benef">
            <td>{{ benef }}</td>
            <td>
              <label v-if="e.situacao === 'gerado' || e.situacao === 'validado'">
                <input
                  v-model="marcados"
                  type="checkbox"
                  :value="e.id"
                  :aria-label="t('marcar')"
                  :data-testid="`re-marcar-${e.id}`"
                />
              </label>
              {{ e.evento }}
              <small v-if="e.retifica" class="secundario">
                {{
                  e.evento === 'R-9000' ? t('exclui', { id: e.retifica }) : t('retifica', { id: e.retifica })
                }}
              </small>
              <button type="button" :data-testid="`re-xml-${e.id}`" @click="verXml(e.id)">
                {{ t('xml') }}
              </button>
            </td>
            <td :data-testid="`re-situacao-${e.id}`">
              {{ e.situacao }}
              <small v-if="e.lote" class="secundario">{{ t('lote', { n: e.lote }) }}</small>
              <small v-if="e.recibo" class="secundario">{{ t('recibo') }} {{ e.recibo }}</small>
              <small v-if="e.mensagem" class="secundario">{{ e.mensagem }}</small>
            </td>
            <td>{{ reais(e.valorBruto) }}</td>
            <td>{{ reais(e.valorRetido) }}</td>
            <td>{{ reais(e.valorSuspenso) }}</td>
            <td>
              <template v-if="e.situacao === 'enviado' && podeGerar">
                <input
                  v-model="campo(e.id).recibo"
                  :aria-label="t('recibo')"
                  :placeholder="t('recibo')"
                  :data-testid="`re-recibo-${e.id}`"
                />
                <button
                  type="button"
                  :disabled="gravando"
                  :data-testid="`re-aceito-${e.id}`"
                  @click="responder(e, true)"
                >
                  {{ t('aceito') }}
                </button>
                <input
                  v-model="campo(e.id).ocorrencias"
                  :aria-label="t('ocorrencias')"
                  :placeholder="t('ocorrencias')"
                  :data-testid="`re-ocorrencias-${e.id}`"
                />
                <button
                  type="button"
                  :disabled="gravando"
                  :data-testid="`re-rejeitado-${e.id}`"
                  @click="responder(e, false)"
                >
                  {{ t('rejeitado') }}
                </button>
              </template>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
    <pre v-if="xml" class="secundario" data-testid="re-xml">{{ xml.texto }}</pre>

    <h3>{{ t('processos') }}</h3>
    <table class="tabela" data-testid="re-processos">
      <thead>
        <tr>
          <th scope="col">{{ t('processo') }}</th>
          <th scope="col">{{ t('tributo') }}</th>
          <th scope="col">{{ t('beneficiario') }}</th>
          <th scope="col">{{ t('vigenciaCol') }}</th>
          <th scope="col">{{ t('situacaoSusp') }}</th>
          <th scope="col">{{ t('acoes') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="p in processos" :key="p.suspensao" :data-testid="`re-suspensao-${p.suspensao}`">
          <td>{{ p.tipo === 'judicial' ? t('judicial') : t('administrativo') }} {{ p.numero }}</td>
          <td>{{ t(`tributos.${p.tributo}`) }} ({{ p.indicativo }})</td>
          <td>{{ p.beneficiario ?? t('todos') }}</td>
          <td>{{ t('vigencia', { de: p.vigenciaInicio, ate: p.vigenciaFim ?? t('semFim') }) }}</td>
          <td :data-testid="`re-s-situacao-${p.suspensao}`">
            <template v-if="p.anulada">{{ t('anulada', { motivo: p.motivoEncerramento ?? '' }) }}</template>
            <template v-else-if="p.encerradaEm">
              {{ t('encerrada', { dia: p.encerradaEm, motivo: p.motivoEncerramento ?? '' }) }}
            </template>
            <template v-else>{{ t('emVigor') }}</template>
          </td>
          <td>
            <button
              v-if="podeGerar && emVigor(p)"
              type="button"
              :data-testid="`re-s-abrir-${p.suspensao}`"
              @click="abrirEdicao(p)"
            >
              {{ t('abrir') }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <section v-if="edicao" aria-labelledby="re-ed-titulo" data-testid="re-edicao">
      <h4 id="re-ed-titulo">
        {{ t('edicao', { tributo: t(`tributos.${edicao.tributo}`), numero: edicao.numero }) }}
      </h4>
      <form class="filtros" @submit.prevent="encerrar(fimSusp.fim)">
        <span class="campo">
          <label for="re-s-fim">{{ t('fimSuspensao') }}</label>
          <input id="re-s-fim" v-model="fimSusp.fim" type="date" data-testid="re-s-fim" />
        </span>
        <span class="campo">
          <label for="re-s-motivo">{{ t('motivo') }}</label>
          <input id="re-s-motivo" v-model="fimSusp.motivo" maxlength="200" data-testid="re-s-motivo" />
        </span>
        <button
          type="submit"
          :disabled="gravando || !fimSusp.fim || !!recusaEncerrar"
          data-testid="re-s-encerrar"
        >
          {{ t('encerrar') }}
        </button>
        <button
          type="button"
          :disabled="gravando || !!recusaFim(null)"
          data-testid="re-s-anular"
          @click="encerrar(null)"
        >
          {{ t('anular') }}
        </button>
        <button type="button" data-testid="re-s-fechar" @click="edicao = null">{{ t('fechar') }}</button>
      </form>
      <p v-if="recusaEncerrar" role="alert" class="secundario" data-testid="re-s-recusa">
        {{ recusaEncerrar.mensagem }}
      </p>
      <form class="filtros" :aria-label="t('dadosProcesso')" @submit.prevent="gravarDados">
        <span v-if="edicao.tipo === 'judicial'" class="campo">
          <label for="re-pa-vara">{{ t('vara') }}</label>
          <input id="re-pa-vara" v-model="dados.vara" maxlength="4" data-testid="re-pa-vara" />
        </span>
        <span class="campo">
          <label for="re-pa-ini">{{ t('inicio') }}</label>
          <input id="re-pa-ini" v-model="dados.vigenciaInicio" type="date" data-testid="re-pa-inicio" />
        </span>
        <span class="campo">
          <label for="re-pa-fim">{{ t('fimProcesso') }}</label>
          <input id="re-pa-fim" v-model="dados.vigenciaFim" type="date" data-testid="re-pa-fim" />
        </span>
        <button
          type="submit"
          :disabled="gravando || !dados.vigenciaInicio || !!recusaDados"
          data-testid="re-pa-gravar"
        >
          {{ t('gravarProcesso') }}
        </button>
      </form>
      <p v-if="recusaDados" role="alert" class="secundario" data-testid="re-pa-recusa">
        {{ recusaDados.mensagem }}
      </p>
    </section>
    <form class="filtros" :aria-label="t('novoProcesso')" @submit.prevent="incluirProcesso">
      <span class="campo">
        <SanteSelecao v-model="proc.tipo" :rotulo="t('tipo')" :opcoes="tipos" data-testid="re-p-tipo" />
      </span>
      <span class="campo">
        <label for="re-p-numero">{{ t('numero') }}</label>
        <input id="re-p-numero" v-model="proc.numero" inputmode="numeric" data-testid="re-p-numero" />
      </span>
      <span v-if="proc.tipo === 'judicial'" class="campo">
        <label for="re-p-vara">{{ t('vara') }}</label>
        <input id="re-p-vara" v-model="proc.vara" maxlength="4" data-testid="re-p-vara" />
      </span>
      <span class="campo">
        <label for="re-p-ind">{{ t('indicativo') }}</label>
        <input
          id="re-p-ind"
          v-model="proc.indicativo"
          maxlength="2"
          inputmode="numeric"
          data-testid="re-p-indicativo"
        />
      </span>
      <span class="campo">
        <SanteSelecao
          v-model="proc.tributo"
          :rotulo="t('tributo')"
          :opcoes="tributos"
          data-testid="re-p-tributo"
        />
      </span>
      <span class="campo">
        <label for="re-p-benef">{{ t('benefOpcional') }}</label>
        <input
          id="re-p-benef"
          v-model="proc.beneficiario"
          inputmode="numeric"
          data-testid="re-p-beneficiario"
        />
      </span>
      <span class="campo">
        <label for="re-p-ini">{{ t('inicio') }}</label>
        <input id="re-p-ini" v-model="proc.vigenciaInicio" type="date" data-testid="re-p-inicio" />
      </span>
      <span class="campo">
        <label for="re-p-fim">{{ t('fim') }}</label>
        <input id="re-p-fim" v-model="proc.vigenciaFim" type="date" data-testid="re-p-fim" />
      </span>
      <span class="campo">
        <label for="re-p-dec">{{ t('decisao') }}</label>
        <input id="re-p-dec" v-model="proc.dataDecisao" type="date" data-testid="re-p-decisao" />
      </span>
      <button type="submit" :disabled="gravando || !podeGerar || !processoPronto" data-testid="re-p-incluir">
        {{ t('incluir') }}
      </button>
    </form>
    <p v-if="recusaProcesso" role="alert" class="secundario" data-testid="re-p-recusa">
      {{ recusaProcesso.mensagem }}
    </p>
  </section>
</template>
