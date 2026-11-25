<script setup lang="ts">
// RAAS da atenção psicossocial e da atenção domiciliar (F8, 06-SUS linha 64) — `Faturamento > Faturamento SUS > RAAS
// psicossocial e domiciliar`. Uma tela, com a visão por paciente: a busca pelo prontuário ou nome filtra o painel e
// já preenche o paciente do registro novo. O painel da competência e do tipo traz a contagem de ações e de críticas;
// o registro abre ao lado com as ações (lançar e retirar, sem apagar), as críticas, a conclusão com o destino e a
// continuação na competência seguinte. Crítica e remessa por competência e tipo; a remessa devolve o arquivo para
// baixar e a tela avisa enquanto o leiaute não foi conferido contra o oficial. A validação aparece enquanto se digita,
// com as mesmas regras do domínio que a API aplica.
import {
  conferirAcaoRaas,
  conferirCabecalhoRaas,
  conferirConclusaoRaas,
  LOCAIS_RAAS,
  type LocalRaas,
  REGISTRO_DO_TIPO_RAAS,
  TIPOS_RAAS,
  type TipoRaas,
} from '@sgh/dominio-faturamento';
import { SanteSelecao } from '@sgh/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import {
  buscarPacientesRaas,
  concluirRegistroRaas,
  continuarRegistroRaas,
  criticarRaas,
  gerarRemessaRaas,
  incluirRegistroRaas,
  lancarAcaoRaas,
  lerOpcoesRaas,
  lerPainelRaas,
  lerRegistroRaas,
  type PacienteRaas,
  retirarAcaoRaas,
} from '../api-raas.js';
import { mensagensRaas } from '../i18n-raas.js';

const { t } = useI18n({ useScope: 'local', messages: mensagensRaas });
const cliente = useQueryClient();
const podeRegistrar = computed(() => pode('faturamento.susRaas.registrar'));
const podeGerar = computed(() => pode('faturamento.susRaas.gerar'));
const CID = /^[A-Za-z]\d{2}\.?\d?$/;

const competenciaAtual = () => {
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  return hoje.slice(0, 4) + hoje.slice(5, 7);
};
const competencia = ref(competenciaAtual());
const competenciaValida = computed(() => /^\d{4}(0[1-9]|1[0-2])$/.test(competencia.value));
const tipo = ref<TipoRaas | null>(null);
const opTipos = computed(() => [
  { valor: null, rotulo: t('todosTipos') },
  ...TIPOS_RAAS.map((x) => ({ valor: x, rotulo: t(`tipos.${x}`) })),
]);
const opTiposNovo = computed(() => TIPOS_RAAS.map((x) => ({ valor: x, rotulo: t(`tipos.${x}`) })));
const opLocais = computed(() => LOCAIS_RAAS.map((x) => ({ valor: x, rotulo: t(`locais.${x}`) })));

// Paciente em foco (visão por paciente).
const busca = ref('');
const termo = ref('');
let espera: ReturnType<typeof setTimeout> | undefined;
watch(busca, (b) => {
  clearTimeout(espera);
  espera = setTimeout(() => (termo.value = b.trim()), 300);
});
const achados = useQuery({
  queryKey: computed(() => ['sus', 'raas', 'pacientes', termo.value]),
  queryFn: () => buscarPacientesRaas(termo.value),
  enabled: computed(() => termo.value.length >= 2),
});
const paciente = ref<PacienteRaas | null>(null);
const escolherPaciente = (p: PacienteRaas | null) => {
  paciente.value = p;
  busca.value = '';
  termo.value = '';
};

const painel = useQuery({
  queryKey: computed(() => ['sus', 'raas', 'painel', competencia.value, tipo.value, paciente.value?.id]),
  queryFn: () =>
    lerPainelRaas({ competencia: competencia.value, tipo: tipo.value, paciente: paciente.value?.id ?? null }),
  enabled: competenciaValida,
});
const opcoes = useQuery({ queryKey: ['sus', 'raas', 'opcoes'], queryFn: lerOpcoesRaas });
const resumo = computed(() => {
  const r = painel.data.value?.registros ?? [];
  return t('resumo', {
    registros: r.length,
    acoes: r.reduce((s, x) => s + x.acoes, 0),
    criticas: r.reduce((s, x) => s + x.criticasAbertas, 0),
    bloqueantes: r.reduce((s, x) => s + x.bloqueantes, 0),
  });
});

const erro = ref<unknown>(null);
const aviso = ref('');
const conteudoRemessa = ref<{ nome: string; url: string } | null>(null);
const acao = useMutation({
  mutationFn: async (fn: () => Promise<string>) => fn(),
  onSuccess: (msg) => {
    erro.value = null;
    aviso.value = msg || t('salvo');
    void cliente.invalidateQueries({ queryKey: ['sus', 'raas'] });
  },
  onError: (e) => {
    erro.value = e;
    aviso.value = '';
  },
});

// ---------- Registro novo ----------
const novo = ref<null | {
  tipo: TipoRaas;
  dataAdmissao: string;
  cidPrincipal: string;
  cidSecundarios: string;
  cidAssociado: string;
  esf: boolean;
  cnesEsf: string;
  responsavel: string;
}>(null);
const abrirNovo = () => {
  novo.value = {
    tipo: tipo.value ?? 'atencao_psicossocial',
    dataAdmissao: '',
    cidPrincipal: '',
    cidSecundarios: '',
    cidAssociado: '',
    esf: false,
    cnesEsf: '',
    responsavel: '',
  };
};
const secundarios = computed(() =>
  (novo.value?.cidSecundarios ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean),
);
const problemasNovo = computed(() => {
  const n = novo.value;
  if (!n) return [];
  const p: string[] = [];
  if (!paciente.value) p.push(t('registro.semPaciente'));
  if (!n.dataAdmissao) p.push(t('registro.dataAdmissao'));
  if (!CID.test(n.cidPrincipal.trim())) p.push(`${t('registro.cidPrincipal')}: ${t('registro.cidInvalido')}`);
  if (secundarios.value.length > 3) p.push(t('registro.secundariosDemais'));
  if ([...secundarios.value, n.cidAssociado.trim()].some((c) => c && !CID.test(c)))
    p.push(t('registro.cidInvalido'));
  if (competenciaValida.value && n.dataAdmissao)
    p.push(
      ...conferirCabecalhoRaas({
        tipo: n.tipo,
        competencia: competencia.value,
        dataAdmissao: n.dataAdmissao,
        dataConclusao: null,
        destino: null,
        estrategiaSaudeFamilia: n.esf,
        cnesSaudeFamilia: n.cnesEsf.trim() || null,
      }).map((x) => x.mensagem),
    );
  return p;
});
const gravarNovo = () => {
  const n = novo.value;
  const pac = paciente.value;
  if (!n || !pac || problemasNovo.value.length) return;
  acao.mutate(async () => {
    const r = await incluirRegistroRaas({
      tipo: n.tipo,
      competencia: competencia.value,
      paciente: pac.id,
      dataAdmissao: n.dataAdmissao,
      cidPrincipal: n.cidPrincipal.trim(),
      cidSecundarios: secundarios.value,
      cidAssociado: n.cidAssociado.trim() || null,
      estrategiaSaudeFamilia: n.esf,
      cnesSaudeFamilia: n.esf ? n.cnesEsf.trim() : null,
      responsavel: n.responsavel.trim() || null,
    });
    novo.value = null;
    aberto.value = r.id;
    return '';
  });
};

// ---------- Registro aberto ----------
const aberto = ref<number | null>(null);
const detalhe = useQuery({
  queryKey: computed(() => ['sus', 'raas', 'registro', aberto.value]),
  queryFn: () => lerRegistroRaas(aberto.value!),
  enabled: computed(() => aberto.value !== null),
});
const editavel = computed(() => podeRegistrar.value && detalhe.data.value?.situacao === 'aberto');
const formAcao = ref({
  procedimento: '',
  cbo: '',
  dataInicio: '',
  dataFim: '',
  quantidade: 1,
  local: 'unidade' as LocalRaas,
  cid: '',
});
watch(aberto, () => {
  formAcao.value = {
    procedimento: '',
    cbo: '',
    dataInicio: '',
    dataFim: '',
    quantidade: 1,
    local: 'unidade',
    cid: '',
  };
});
const problemasAcao = computed(() => {
  const d = detalhe.data.value;
  if (!d) return [];
  const a = formAcao.value;
  const p: string[] = [];
  if (!/^\d{10}$/.test(a.procedimento)) p.push(t('acao.procedimentoInvalido'));
  if (a.cbo && !/^[0-9A-Za-z]{6}$/.test(a.cbo)) p.push(t('acao.cboInvalido'));
  if (a.cid.trim() && !CID.test(a.cid.trim())) p.push(`${t('acao.cid')}: ${t('registro.cidInvalido')}`);
  if (a.dataInicio)
    p.push(
      // O instrumento do procedimento é conferido pela API, que conhece a tabela unificada.
      ...conferirAcaoRaas(
        d.tipo,
        d.competencia,
        d.dataAdmissao,
        {
          procedimento: a.procedimento,
          registros: [REGISTRO_DO_TIPO_RAAS[d.tipo]],
          cbo: a.cbo || null,
          cnsProfissional: null,
          dataInicio: a.dataInicio,
          dataFim: a.dataFim || null,
          quantidade: Number(a.quantidade),
          local: a.local,
          cid: a.cid.trim() || null,
        },
        d.dataConclusao,
      ).map((x) => x.mensagem),
    );
  else p.push(t('acao.dataInicio'));
  return p;
});
const lancar = () => {
  const d = detalhe.data.value;
  const a = formAcao.value;
  if (!d || problemasAcao.value.length) return;
  acao.mutate(async () => {
    await lancarAcaoRaas(d.id, {
      procedimento: a.procedimento,
      cbo: a.cbo,
      dataInicio: a.dataInicio,
      dataFim: a.dataFim || null,
      quantidade: Number(a.quantidade),
      local: a.local,
      cid: a.cid.trim() || null,
      versao: d.versao,
    });
    formAcao.value = { ...formAcao.value, procedimento: '', quantidade: 1, cid: '' };
    return '';
  });
};
const retirar = (id: number, versao: number) =>
  acao.mutate(async () => {
    await retirarAcaoRaas(id, versao);
    return '';
  });

const conclusao = ref({ data: '', destino: null as number | null });
const opDestinos = computed(() => [
  { valor: null, rotulo: t('conclusao.escolhaDestino') },
  ...(opcoes.data.value?.destinos ?? []).map((x) => ({ valor: x.id, rotulo: x.descricao })),
]);
const problemasConclusao = computed(() => {
  const d = detalhe.data.value;
  if (!d || !conclusao.value.data) return [];
  return conferirCabecalhoRaas({
    tipo: d.tipo,
    competencia: d.competencia,
    dataAdmissao: d.dataAdmissao,
    dataConclusao: conclusao.value.data,
    destino: conclusao.value.destino,
    estrategiaSaudeFamilia: false,
    cnesSaudeFamilia: null,
  })
    .concat(conferirConclusaoRaas(conclusao.value.data, d.acoes))
    .map((x) => x.mensagem);
});
const concluir = () => {
  const d = detalhe.data.value;
  const { data, destino } = conclusao.value;
  if (!d || !data || destino === null || problemasConclusao.value.length) return;
  acao.mutate(async () => {
    await concluirRegistroRaas(d.id, { dataConclusao: data, destino, versao: d.versao });
    return '';
  });
};
const continuar = () => {
  const d = detalhe.data.value;
  if (!d) return;
  acao.mutate(async () => {
    const r = await continuarRegistroRaas(d.id, d.versao);
    return t('continuado', { numero: r.numero, competencia: r.competencia });
  });
};

// ---------- Crítica e remessa ----------
const remessa = ref({ orgao: '', indicador: 'M' as 'M' | 'E' });
const opIndicador = computed(() => [
  { valor: 'M', rotulo: t('remessa.municipal') },
  { valor: 'E', rotulo: t('remessa.estadual') },
]);
const orgaoValido = computed(
  () => remessa.value.orgao.trim().length >= 3 && remessa.value.orgao.trim().length <= 40,
);
const criticar = () => {
  const tp = tipo.value;
  if (!tp || !competenciaValida.value) return;
  acao.mutate(async () => {
    const r = await criticarRaas({ competencia: competencia.value, tipo: tp });
    return t('criticaFeita', r);
  });
};
const gerar = () => {
  const tp = tipo.value;
  if (!tp || !competenciaValida.value || !orgaoValido.value) return;
  acao.mutate(async () => {
    const r = await gerarRemessaRaas({
      competencia: competencia.value,
      tipo: tp,
      orgaoDestino: remessa.value.orgao.trim(),
      indicadorDestino: remessa.value.indicador,
    });
    if (conteudoRemessa.value) URL.revokeObjectURL(conteudoRemessa.value.url);
    conteudoRemessa.value = {
      nome: r.nome,
      url: URL.createObjectURL(new Blob([r.conteudo], { type: 'text/plain' })),
    };
    return t('remessa.gerada', { numero: r.numero, registros: r.registros, substituidas: r.substituidas });
  });
};
</script>

<template>
  <section class="tela" aria-labelledby="raas-titulo" data-testid="tela-raas">
    <h1 id="raas-titulo">{{ t('titulo') }}</h1>
    <p>{{ t('explicacao') }}</p>

    <div class="filtros">
      <label
        >{{ t('competencia') }}
        <input
          v-model="competencia"
          inputmode="numeric"
          maxlength="6"
          :aria-invalid="!competenciaValida"
          data-testid="raas-competencia"
      /></label>
      <SanteSelecao v-model="tipo" :rotulo="t('tipo')" :opcoes="opTipos" data-testid="raas-tipo" />
      <label
        >{{ t('buscarPaciente') }}
        <input v-model="busca" type="search" autocomplete="off" data-testid="raas-busca-paciente"
      /></label>
    </div>
    <ul v-if="termo.length >= 2 && achados.data.value" data-testid="raas-pacientes">
      <li v-if="!achados.data.value.pacientes.length">{{ t('semPaciente') }}</li>
      <li v-for="p in achados.data.value.pacientes" :key="p.id">
        <button type="button" :data-testid="`raas-paciente-${p.id}`" @click="escolherPaciente(p)">
          {{ p.prontuario }} — {{ p.nome }}
        </button>
      </li>
    </ul>
    <p v-if="paciente" data-testid="raas-paciente-escolhido">
      {{ t('pacienteEscolhido', { nome: paciente.nome, prontuario: paciente.prontuario }) }}
      <button type="button" @click="escolherPaciente(null)">{{ t('verTodos') }}</button>
    </p>

    <p v-if="aviso" role="status" data-testid="raas-aviso">{{ aviso }}</p>
    <MensagemErro v-if="erro" :erro="erro" />
    <MensagemErro v-if="painel.error.value" :erro="painel.error.value" />
    <p v-if="!podeRegistrar" data-testid="raas-so-consulta">{{ t('soConsulta') }}</p>

    <template v-if="painel.data.value">
      <p data-testid="raas-resumo">
        {{ resumo }} ·
        {{
          painel.data.value.situacaoCompetencia
            ? t('situacaoCompetencia', { situacao: painel.data.value.situacaoCompetencia })
            : t('competenciaNaoAberta')
        }}
        <span v-if="painel.data.value.criticadaEm">
          ·
          {{
            t('criticadaEm', { quando: painel.data.value.criticadaEm.slice(0, 16).replace('T', ' ') })
          }}</span
        >
      </p>
      <p
        v-if="!painel.data.value.conferidoContraOficial"
        class="alerta"
        data-testid="raas-leiaute-nao-conferido"
      >
        {{ t('leiauteNaoConferido') }}
      </p>

      <div class="acoes">
        <button v-if="podeRegistrar" type="button" data-testid="raas-novo" @click="abrirNovo">
          {{ t('novoRegistro') }}
        </button>
        <button
          v-if="podeRegistrar"
          type="button"
          :disabled="!tipo || acao.isPending.value"
          :title="tipo ? '' : t('escolhaTipo')"
          data-testid="raas-criticar"
          @click="criticar"
        >
          {{ t('criticar') }}
        </button>
      </div>

      <form v-if="novo" class="ficha" data-testid="raas-form-registro" @submit.prevent="gravarNovo">
        <h2>{{ t('registro.novo') }}</h2>
        <SanteSelecao
          v-model="novo.tipo"
          :rotulo="t('tipo')"
          :opcoes="opTiposNovo"
          data-testid="raas-registro-tipo"
        />
        <label
          >{{ t('registro.dataAdmissao') }}
          <input v-model="novo.dataAdmissao" type="date" data-testid="raas-registro-admissao"
        /></label>
        <label
          >{{ t('registro.cidPrincipal') }}
          <input v-model="novo.cidPrincipal" maxlength="5" data-testid="raas-registro-cid"
        /></label>
        <label
          >{{ t('registro.cidSecundarios') }}
          <input v-model="novo.cidSecundarios" data-testid="raas-registro-cids-secundarios"
        /></label>
        <label
          >{{ t('registro.cidAssociado') }}
          <input v-model="novo.cidAssociado" maxlength="5" data-testid="raas-registro-cid-associado"
        /></label>
        <label
          ><input v-model="novo.esf" type="checkbox" data-testid="raas-registro-esf" />
          {{ t('registro.esf') }}</label
        >
        <label v-if="novo.esf"
          >{{ t('registro.cnesEsf') }}
          <input
            v-model="novo.cnesEsf"
            inputmode="numeric"
            maxlength="7"
            data-testid="raas-registro-cnes-esf"
        /></label>
        <label
          >{{ t('registro.responsavel') }}
          <input v-model="novo.responsavel" maxlength="150" data-testid="raas-registro-responsavel"
        /></label>
        <ul v-if="problemasNovo.length" class="problemas" data-testid="raas-registro-problemas">
          <li v-for="p in problemasNovo" :key="p">{{ p }}</li>
        </ul>
        <div class="acoes">
          <button
            type="submit"
            :disabled="problemasNovo.length > 0 || acao.isPending.value"
            data-testid="raas-registro-gravar"
          >
            {{ t('gravar') }}
          </button>
          <button type="button" @click="novo = null">{{ t('fechar') }}</button>
        </div>
      </form>

      <table data-testid="raas-registros">
        <thead>
          <tr>
            <th>{{ t('colunas.numero') }}</th>
            <th>{{ t('colunas.paciente') }}</th>
            <th>{{ t('colunas.tipo') }}</th>
            <th>{{ t('colunas.admissao') }}</th>
            <th>{{ t('colunas.situacao') }}</th>
            <th>{{ t('colunas.acoes') }}</th>
            <th>{{ t('colunas.criticas') }}</th>
            <th>
              <span class="sr-only">{{ t('abrir') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!painel.data.value.registros.length">
            <td colspan="8">{{ t('vazio') }}</td>
          </tr>
          <tr v-for="r in painel.data.value.registros" :key="r.id" :data-testid="`raas-registro-${r.id}`">
            <td>{{ r.numero }}</td>
            <td>{{ r.prontuario }} — {{ r.pacienteNome }}</td>
            <td>{{ t(`tipos.${r.tipo}`) }}</td>
            <td>{{ r.dataAdmissao }}</td>
            <td>{{ r.situacao }}</td>
            <td>{{ r.acoes }}</td>
            <td :class="{ problemas: r.bloqueantes > 0 }">{{ r.criticasAbertas }}</td>
            <td>
              <button type="button" :data-testid="`raas-abrir-${r.id}`" @click="aberto = r.id">
                {{ t('abrir') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      <section v-if="detalhe.data.value" class="ficha" data-testid="raas-detalhe">
        <h2>
          {{ t('registro.titulo', { numero: detalhe.data.value.numero }) }} —
          {{ detalhe.data.value.pacienteNome }} ({{ t(`tipos.${detalhe.data.value.tipo}`) }},
          {{ detalhe.data.value.competencia }})
        </h2>
        <button type="button" @click="aberto = null">{{ t('fechar') }}</button>

        <table data-testid="raas-acoes">
          <caption>
            {{
              t('acao.titulo')
            }}
          </caption>
          <tbody>
            <tr v-if="!detalhe.data.value.acoes.length">
              <td>{{ t('acao.vazio') }}</td>
            </tr>
            <tr v-for="a in detalhe.data.value.acoes" :key="a.id" :data-testid="`raas-acao-${a.id}`">
              <td>{{ a.sequencia }}</td>
              <td>{{ a.procedimento }} {{ a.procedimentoDescricao }}</td>
              <td>{{ a.cbo }}</td>
              <td>{{ a.dataInicio }}{{ a.dataFim ? ` a ${a.dataFim}` : '' }}</td>
              <td>{{ a.quantidade }}</td>
              <td>{{ t(`locais.${a.local}`) }}</td>
              <td>
                <button
                  v-if="editavel"
                  type="button"
                  :data-testid="`raas-retirar-${a.id}`"
                  @click="retirar(a.id, a.versao)"
                >
                  {{ t('acao.retirar') }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>

        <form v-if="editavel" class="ficha" data-testid="raas-form-acao" @submit.prevent="lancar">
          <label
            >{{ t('acao.procedimento') }}
            <input
              v-model="formAcao.procedimento"
              inputmode="numeric"
              maxlength="10"
              data-testid="raas-acao-procedimento"
          /></label>
          <label
            >{{ t('acao.cbo') }} <input v-model="formAcao.cbo" maxlength="6" data-testid="raas-acao-cbo"
          /></label>
          <label
            >{{ t('acao.dataInicio') }}
            <input v-model="formAcao.dataInicio" type="date" data-testid="raas-acao-inicio"
          /></label>
          <label
            >{{ t('acao.dataFim') }}
            <input v-model="formAcao.dataFim" type="date" data-testid="raas-acao-fim"
          /></label>
          <label
            >{{ t('acao.quantidade') }}
            <input
              v-model.number="formAcao.quantidade"
              type="number"
              min="1"
              max="9999"
              data-testid="raas-acao-quantidade"
          /></label>
          <SanteSelecao
            v-model="formAcao.local"
            :rotulo="t('acao.local')"
            :opcoes="opLocais"
            data-testid="raas-acao-local"
          />
          <label
            >{{ t('acao.cid') }} <input v-model="formAcao.cid" maxlength="5" data-testid="raas-acao-cid"
          /></label>
          <ul v-if="problemasAcao.length" class="problemas" data-testid="raas-acao-problemas">
            <li v-for="p in problemasAcao" :key="p">{{ p }}</li>
          </ul>
          <div class="acoes">
            <button
              type="submit"
              :disabled="problemasAcao.length > 0 || acao.isPending.value"
              data-testid="raas-acao-lancar"
            >
              {{ t('acao.nova') }}
            </button>
          </div>
        </form>

        <div data-testid="raas-criticas">
          <h3>{{ t('criticas.titulo') }}</h3>
          <p v-if="!detalhe.data.value.criticas.length">{{ t('criticas.vazio') }}</p>
          <ul v-else>
            <li
              v-for="k in detalhe.data.value.criticas"
              :key="k.id"
              :class="{ problemas: k.gravidade === 'bloqueante' }"
            >
              {{ k.regra }} · {{ k.gravidade }} · {{ k.descricao }}
            </li>
          </ul>
        </div>

        <form
          v-if="editavel && !detalhe.data.value.dataConclusao"
          class="ficha"
          data-testid="raas-form-conclusao"
          @submit.prevent="concluir"
        >
          <h3>{{ t('conclusao.titulo') }}</h3>
          <label
            >{{ t('conclusao.data') }}
            <input v-model="conclusao.data" type="date" data-testid="raas-conclusao-data"
          /></label>
          <SanteSelecao
            v-model="conclusao.destino"
            :rotulo="t('conclusao.destino')"
            :opcoes="opDestinos"
            data-testid="raas-conclusao-destino"
          />
          <p v-if="opcoes.data.value && !opcoes.data.value.destinos.length" data-testid="raas-sem-destinos">
            {{ t('conclusao.semDestinos') }}
          </p>
          <ul v-if="problemasConclusao.length" class="problemas" data-testid="raas-conclusao-problemas">
            <li v-for="p in problemasConclusao" :key="p">{{ p }}</li>
          </ul>
          <div class="acoes">
            <button
              type="submit"
              :disabled="
                !conclusao.data ||
                conclusao.destino === null ||
                problemasConclusao.length > 0 ||
                acao.isPending.value
              "
              data-testid="raas-concluir"
            >
              {{ t('conclusao.concluir') }}
            </button>
            <button
              v-if="!detalhe.data.value.continuacao"
              type="button"
              :disabled="acao.isPending.value"
              data-testid="raas-continuar"
              @click="continuar"
            >
              {{ t('continuar') }}
            </button>
          </div>
        </form>
      </section>

      <section class="ficha" data-testid="raas-remessa">
        <h2>{{ t('remessa.titulo') }}</h2>
        <template v-if="podeGerar">
          <label
            >{{ t('remessa.orgao') }}
            <input v-model="remessa.orgao" maxlength="40" data-testid="raas-remessa-orgao"
          /></label>
          <SanteSelecao
            v-model="remessa.indicador"
            :rotulo="t('remessa.indicador')"
            :opcoes="opIndicador"
            data-testid="raas-remessa-indicador"
          />
          <p v-if="remessa.orgao && !orgaoValido" class="problemas">{{ t('remessa.orgaoCurto') }}</p>
          <button
            type="button"
            :disabled="!tipo || !orgaoValido || acao.isPending.value"
            :title="tipo ? '' : t('escolhaTipo')"
            data-testid="raas-gerar"
            @click="gerar"
          >
            {{ t('remessa.gerar') }}
          </button>
          <a
            v-if="conteudoRemessa"
            :href="conteudoRemessa.url"
            :download="conteudoRemessa.nome"
            data-testid="raas-baixar"
            >{{ t('remessa.baixar', { nome: conteudoRemessa.nome }) }}</a
          >
        </template>
        <table v-if="painel.data.value.remessas.length" data-testid="raas-remessas">
          <caption>
            {{
              t('remessa.lista')
            }}
          </caption>
          <tbody>
            <tr v-for="x in painel.data.value.remessas" :key="x.id">
              <td>{{ x.numero }}</td>
              <td>{{ x.tipo in mensagensRaas['pt-BR'].tipos ? t(`tipos.${x.tipo}`) : x.tipo }}</td>
              <td>{{ x.situacao }}</td>
              <td>{{ x.registros }}</td>
              <td>{{ x.nomeArquivo }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </section>
</template>

<style scoped>
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
caption {
  text-align: left;
  font-weight: 600;
}
.ficha,
.filtros,
.acoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
  margin: var(--sgh-espaco-2) 0;
}
.ficha h2,
.ficha h3,
.ficha table,
.ficha form,
.ficha > div,
.problemas,
.acoes {
  flex-basis: 100%;
}
.problemas,
.alerta {
  color: var(--sgh-alerta-texto);
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
</style>
