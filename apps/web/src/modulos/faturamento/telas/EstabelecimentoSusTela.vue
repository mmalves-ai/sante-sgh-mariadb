<script setup lang="ts">
// Habilitações, serviços e classificações SUS do estabelecimento e regras por tipo de prestador (F7, 06-SUS linha 61) —
// `Faturamento > Faturamento SUS > Habilitações e serviços do estabelecimento`. Uma tela com quatro abas: cada uma inclui
// num formulário curto (competência inicial e final no lugar de datas), lista com a situação e encerra ou inativa na
// própria linha (nada apagado). A conciliação com o cadastro nacional mostra antes o que muda (entram, encerram-se na
// véspera, ficam, pedem decisão) e aplica num clique. A validação aparece enquanto se digita; a regra final é a do
// domínio na API. A crítica do BPA, da APAC e da AIH passa a usar as habilitações vigentes na competência.
import { SanteSelecao } from '@sgh/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import {
  type ConciliacaoCnesTela,
  conciliarHabilitacoesSus,
  encerrarCadastroSus,
  inativarRegraServicoSus,
  incluirHabilitacaoSus,
  incluirRegraPrestadorSus,
  incluirRegraServicoSus,
  incluirServicoSus,
  lerCadastroSus,
  lerOpcoesCadastroSus,
  type TipoEncerravel,
} from '../api-estabelecimento-sus.js';

const { t } = useI18n();
const k = (c: string) => t(`faturamentoSus.estabelecimento.${c}`);
const cliente = useQueryClient();
const cadastro = useQuery({ queryKey: ['sus', 'estabelecimento', 'cadastro'], queryFn: lerCadastroSus });
const opcoes = useQuery({ queryKey: ['sus', 'estabelecimento', 'opcoes'], queryFn: lerOpcoesCadastroSus });
const podeEditar = computed(() => pode('faturamento.susCadastro.editar'));

type Aba = 'habilitacoes' | 'servicos' | 'regrasPrestador' | 'regrasServico';
const ABAS: Aba[] = ['habilitacoes', 'servicos', 'regrasPrestador', 'regrasServico'];
const aba = ref<Aba>('habilitacoes');

const mesAtual = () => new Date().toISOString().slice(0, 7);
const inicioDe = (m: string) => `${m}-01`;
const fimDe = (m: string) => {
  const [a, mm] = m.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(a, mm, 0)).toISOString().slice(0, 10);
};
const vigencia = (i: string, f: string | null) => `${i.slice(0, 7)} → ${f ? f.slice(0, 7) : '…'}`;
const lista = (chave: keyof NonNullable<typeof opcoes.data.value>, vazio = k('campos.nenhum')) =>
  computed(() => [
    { valor: null, rotulo: vazio },
    ...(opcoes.data.value?.[chave] ?? []).map((x) => ({
      valor: x.id,
      rotulo: x.codigo ? `${x.codigo} — ${x.descricao}` : x.descricao,
    })),
  ]);
const opServicos = lista('servicos');
const opServicosSigtap = lista('servicosSigtap');
const opPrestadores = lista('prestadores');
const opTipos = lista('tiposPrestador');
const opNaturezas = lista('naturezas');
const opGrupos = lista('grupos');
const opInstrumentos = lista('instrumentos');
const opSetores = lista('setores');
const opLocais = lista('locais');
const opCaracteristica = computed(() => [
  { valor: 'proprio', rotulo: k('caracteristicas.proprio') },
  { valor: 'terceirizado', rotulo: k('caracteristicas.terceirizado') },
]);

const erro = ref<unknown>(null);
const aviso = ref('');
const acao = useMutation({
  mutationFn: (fn: () => Promise<unknown>) => fn(),
  onSuccess: () => {
    erro.value = null;
    aviso.value = k('salvo');
    encerrando.value = null;
    void cliente.invalidateQueries({ queryKey: ['sus', 'estabelecimento'] });
  },
  onError: (e) => {
    erro.value = e;
  },
});

// Habilitação
const h = reactive({
  codigo: '',
  portaria: '',
  dataPortaria: '',
  leitos: null as number | null,
  inicio: mesAtual(),
  fim: '',
});
const problemasH = computed(() => {
  const p: string[] = [];
  if (!/^\d{1,6}$/.test(h.codigo.trim())) p.push(k('problemas.codigo'));
  if (h.fim && h.fim < h.inicio) p.push(k('problemas.fim'));
  if (h.dataPortaria && !h.portaria.trim()) p.push(k('problemas.portaria'));
  return p;
});
const incluirH = () =>
  acao.mutate(() =>
    incluirHabilitacaoSus({
      codigo: h.codigo.trim(),
      numeroPortaria: h.portaria.trim() || null,
      dataPortaria: h.dataPortaria || null,
      vigenciaInicio: inicioDe(h.inicio),
      vigenciaFim: h.fim ? fimDe(h.fim) : null,
      leitosHabilitados: h.leitos === null || (h.leitos as unknown) === '' ? null : Number(h.leitos),
    }),
  );

// Conciliação com o cadastro nacional
const cn = reactive({ competencia: mesAtual(), codigos: '' });
const previa = ref<ConciliacaoCnesTela | null>(null);
const codigosCnes = () =>
  cn.codigos
    .split(/[\s,;]+/)
    .map((x) => x.trim())
    .filter((x) => /^\d{1,6}$/.test(x))
    .map((codigo) => ({ codigo }));
const conciliar = (aplicar: boolean) =>
  acao.mutate(async () => {
    const r = await conciliarHabilitacoesSus({
      competencia: cn.competencia.replace('-', ''),
      habilitacoes: codigosCnes(),
      aplicar,
    });
    previa.value = r;
    return r;
  });

// Serviço
const s = reactive({
  servico: null as number | null,
  caracteristica: 'proprio' as 'proprio' | 'terceirizado',
  prestador: null as number | null,
  inicio: mesAtual(),
  fim: '',
});
const problemasS = computed(() => {
  const p: string[] = [];
  if (s.servico === null) p.push(k('problemas.servico'));
  if (s.caracteristica === 'terceirizado' && s.prestador === null) p.push(k('problemas.prestador'));
  if (s.fim && s.fim < s.inicio) p.push(k('problemas.fim'));
  return p;
});
const incluirS = () =>
  acao.mutate(() =>
    incluirServicoSus({
      servicoClassificacao: s.servico!,
      caracteristica: s.caracteristica,
      prestadorExterno: s.caracteristica === 'terceirizado' ? s.prestador : null,
      vigenciaInicio: inicioDe(s.inicio),
      vigenciaFim: s.fim ? fimDe(s.fim) : null,
    }),
  );

// Regra por tipo de prestador
const rp = reactive({
  tipo: null as number | null,
  natureza: null as number | null,
  procedimento: '',
  grupo: null as number | null,
  servico: null as number | null,
  instrumento: null as number | null,
  permitido: true,
  geral: false,
  inicio: mesAtual(),
  fim: '',
});
const problemasRp = computed(() => {
  const p: string[] = [];
  if (rp.tipo === null) p.push(k('problemas.tipoPrestador'));
  if (rp.procedimento && !/^\d{10}$/.test(rp.procedimento)) p.push(k('problemas.procedimento'));
  if (!rp.procedimento && rp.grupo === null && rp.servico === null) p.push(k('problemas.alvo'));
  if (rp.fim && rp.fim < rp.inicio) p.push(k('problemas.fim'));
  return p;
});
const incluirRp = () =>
  acao.mutate(() =>
    incluirRegraPrestadorSus({
      geral: rp.geral,
      tipoPrestador: rp.tipo!,
      naturezaJuridica: rp.natureza,
      procedimentoCodigo: rp.procedimento || null,
      grupo: rp.grupo,
      servicoClassificacao: rp.servico,
      instrumento: rp.instrumento,
      permitido: rp.permitido,
      vigenciaInicio: inicioDe(rp.inicio),
      vigenciaFim: rp.fim ? fimDe(rp.fim) : null,
    }),
  );

// Regra do serviço automático
const rs = reactive({
  servico: null as number | null,
  procedimento: '',
  grupo: null as number | null,
  setor: null as number | null,
  local: null as number | null,
  urgencia: false,
  prioridade: 100,
});
const problemasRs = computed(() => {
  const p: string[] = [];
  if (rs.servico === null) p.push(k('problemas.servico'));
  if (rs.procedimento && !/^\d{10}$/.test(rs.procedimento)) p.push(k('problemas.procedimento'));
  if (!rs.procedimento && rs.grupo === null && rs.setor === null && rs.local === null)
    p.push(k('problemas.alvoServico'));
  const pr = Number(rs.prioridade);
  if (!Number.isInteger(pr) || pr < 1 || pr > 999) p.push(k('problemas.prioridade'));
  return p;
});
const incluirRs = () =>
  acao.mutate(() =>
    incluirRegraServicoSus({
      servicoClassificacao: rs.servico!,
      procedimentoCodigo: rs.procedimento || null,
      grupo: rs.grupo,
      setor: rs.setor,
      local: rs.local,
      urgencia: rs.urgencia,
      prioridade: Number(rs.prioridade),
    }),
  );
const inativarRs = (id: number, versao: number) => {
  if (!window.confirm(k('confirmarInativar'))) return;
  acao.mutate(() => inativarRegraServicoSus(id, versao));
};

// Encerrar na própria linha
const encerrando = ref<{ tipo: TipoEncerravel; id: number } | null>(null);
const mesFim = ref(mesAtual());
const abrirEncerrar = (tipo: TipoEncerravel, id: number) => {
  encerrando.value = { tipo, id };
  mesFim.value = mesAtual();
};
const estaEncerrando = (tipo: TipoEncerravel, id: number) =>
  encerrando.value?.tipo === tipo && encerrando.value.id === id;
const confirmarEncerrar = (versao: number) => {
  const e = encerrando.value;
  if (!e) return;
  acao.mutate(() => encerrarCadastroSus(e.tipo, e.id, fimDe(mesFim.value), versao));
};
const situacaoVig = (vigente: boolean) => k(`situacoes.${vigente ? 'vigente' : 'encerrada'}`);
const alvoRegra = (x: {
  procedimento: string | null;
  grupo: string | null;
  servicoClassificacao?: string | null;
}) => [x.procedimento, x.grupo, x.servicoClassificacao].filter(Boolean).join(' · ');
</script>

<template>
  <section class="tela" aria-labelledby="estab-sus-titulo" data-testid="tela-estabelecimento-sus">
    <h1 id="estab-sus-titulo">{{ k('titulo') }}</h1>
    <p>{{ k('explicacao') }}</p>
    <nav class="abas" role="tablist">
      <button
        v-for="a in ABAS"
        :key="a"
        type="button"
        role="tab"
        :aria-selected="aba === a"
        :data-testid="`estab-sus-aba-${a}`"
        @click="aba = a"
      >
        {{ k(`abas.${a}`) }}
      </button>
    </nav>
    <p v-if="aviso" role="status" data-testid="estab-sus-aviso">{{ aviso }}</p>
    <MensagemErro v-if="erro" :erro="erro" />
    <p v-if="!podeEditar" data-testid="estab-sus-so-consulta">{{ k('semPermissao') }}</p>
    <MensagemErro v-if="cadastro.isError.value" :erro="cadastro.error.value" />

    <!-- Habilitações -->
    <div v-if="aba === 'habilitacoes'" data-testid="estab-sus-habilitacoes">
      <form v-if="podeEditar" class="formulario" data-testid="estab-sus-hab-form" @submit.prevent="incluirH">
        <label
          >{{ k('campos.codigo') }}
          <input
            v-model="h.codigo"
            inputmode="numeric"
            maxlength="6"
            required
            data-testid="estab-sus-hab-codigo"
        /></label>
        <label
          >{{ k('campos.portaria') }}
          <input v-model="h.portaria" maxlength="60" data-testid="estab-sus-hab-portaria"
        /></label>
        <label
          >{{ k('campos.dataPortaria') }}
          <input v-model="h.dataPortaria" type="date" data-testid="estab-sus-hab-data-portaria"
        /></label>
        <label
          >{{ k('campos.leitos') }}
          <input
            v-model.number="h.leitos"
            type="number"
            min="0"
            max="9999"
            data-testid="estab-sus-hab-leitos"
        /></label>
        <label
          >{{ k('campos.inicio') }}
          <input v-model="h.inicio" type="month" required data-testid="estab-sus-hab-inicio"
        /></label>
        <label
          >{{ k('campos.fim') }} <input v-model="h.fim" type="month" data-testid="estab-sus-hab-fim"
        /></label>
        <ul v-if="problemasH.length" class="problemas" data-testid="estab-sus-hab-problemas">
          <li v-for="p in problemasH" :key="p">{{ p }}</li>
        </ul>
        <button
          type="submit"
          :disabled="problemasH.length > 0 || acao.isPending.value"
          data-testid="estab-sus-hab-incluir"
        >
          {{ k('acoes.incluir') }}
        </button>
      </form>
      <form
        v-if="podeEditar"
        class="formulario"
        data-testid="estab-sus-cnes-form"
        @submit.prevent="conciliar(false)"
      >
        <p class="ajuda">{{ k('conciliacao.titulo') }}</p>
        <label
          >{{ k('campos.competenciaCnes') }}
          <input v-model="cn.competencia" type="month" required data-testid="estab-sus-cnes-competencia"
        /></label>
        <label class="largo"
          >{{ k('campos.codigosCnes') }}
          <textarea v-model="cn.codigos" rows="2" data-testid="estab-sus-cnes-codigos"></textarea>
        </label>
        <button
          type="submit"
          :disabled="!cn.competencia || acao.isPending.value"
          data-testid="estab-sus-cnes-previa"
        >
          {{ k('acoes.previa') }}
        </button>
        <template v-if="previa">
          <p class="ajuda" data-testid="estab-sus-cnes-resumo">
            {{
              previa.aplicada
                ? k('conciliacao.aplicada')
                : t('faturamentoSus.estabelecimento.conciliacao.resumo', {
                    incluir: previa.incluir.map((x) => x.codigo).join(', ') || '0',
                    encerrar: previa.encerrar.map((x) => x.codigo).join(', ') || '0',
                    mantidas: previa.mantidas,
                    conflitos: previa.conflitos.map((x) => x.codigo).join(', ') || '0',
                  })
            }}
          </p>
          <button
            v-if="!previa.aplicada"
            type="button"
            :disabled="acao.isPending.value"
            data-testid="estab-sus-cnes-aplicar"
            @click="conciliar(true)"
          >
            {{ k('acoes.aplicar') }}
          </button>
        </template>
      </form>
      <p v-if="cadastro.data.value?.habilitacoes.length === 0" data-testid="estab-sus-hab-vazio">
        {{ k('vazio') }}
      </p>
      <table v-else-if="cadastro.data.value" data-testid="estab-sus-hab-tabela">
        <thead>
          <tr>
            <th scope="col">{{ k('colunas.habilitacao') }}</th>
            <th scope="col">{{ k('colunas.portaria') }}</th>
            <th scope="col">{{ k('colunas.leitos') }}</th>
            <th scope="col">{{ k('colunas.vigencia') }}</th>
            <th scope="col">{{ k('colunas.situacao') }}</th>
            <th scope="col">{{ k('colunas.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="x in cadastro.data.value.habilitacoes"
            :key="x.id"
            :data-testid="`estab-sus-hab-${x.id}`"
          >
            <td>{{ x.codigo }} — {{ x.descricao }}</td>
            <td>{{ x.numeroPortaria ?? '' }}</td>
            <td>{{ x.leitosHabilitados ?? '' }}</td>
            <td>{{ vigencia(x.vigenciaInicio, x.vigenciaFim) }}</td>
            <td>{{ situacaoVig(x.vigente) }}</td>
            <td>
              <template v-if="podeEditar && !x.vigenciaFim">
                <span v-if="estaEncerrando('habilitacoes', x.id)">
                  <label
                    >{{ k('campos.encerrarEm') }}
                    <input v-model="mesFim" type="month" data-testid="estab-sus-encerrar-mes"
                  /></label>
                  <button
                    type="button"
                    data-testid="estab-sus-encerrar-confirmar"
                    @click="confirmarEncerrar(x.versao)"
                  >
                    {{ k('acoes.confirmarEncerrar') }}
                  </button>
                </span>
                <button
                  v-else
                  type="button"
                  data-testid="estab-sus-hab-encerrar"
                  @click="abrirEncerrar('habilitacoes', x.id)"
                >
                  {{ k('acoes.encerrar') }}
                </button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Serviços e classificações -->
    <div v-if="aba === 'servicos'" data-testid="estab-sus-servicos">
      <form v-if="podeEditar" class="formulario" data-testid="estab-sus-serv-form" @submit.prevent="incluirS">
        <SanteSelecao
          v-model="s.servico"
          :rotulo="k('campos.servico')"
          :opcoes="opServicos"
          data-testid="estab-sus-serv-servico"
        />
        <SanteSelecao
          v-model="s.caracteristica"
          :rotulo="k('campos.caracteristica')"
          :opcoes="opCaracteristica"
          data-testid="estab-sus-serv-caracteristica"
        />
        <SanteSelecao
          v-if="s.caracteristica === 'terceirizado'"
          v-model="s.prestador"
          :rotulo="k('campos.prestador')"
          :opcoes="opPrestadores"
          data-testid="estab-sus-serv-prestador"
        />
        <label
          >{{ k('campos.inicio') }}
          <input v-model="s.inicio" type="month" required data-testid="estab-sus-serv-inicio"
        /></label>
        <label
          >{{ k('campos.fim') }} <input v-model="s.fim" type="month" data-testid="estab-sus-serv-fim"
        /></label>
        <ul v-if="problemasS.length" class="problemas" data-testid="estab-sus-serv-problemas">
          <li v-for="p in problemasS" :key="p">{{ p }}</li>
        </ul>
        <button
          type="submit"
          :disabled="problemasS.length > 0 || acao.isPending.value"
          data-testid="estab-sus-serv-incluir"
        >
          {{ k('acoes.incluir') }}
        </button>
      </form>
      <p v-if="cadastro.data.value?.servicos.length === 0">{{ k('vazio') }}</p>
      <table v-else-if="cadastro.data.value" data-testid="estab-sus-serv-tabela">
        <thead>
          <tr>
            <th scope="col">{{ k('colunas.servico') }}</th>
            <th scope="col">{{ k('colunas.prestador') }}</th>
            <th scope="col">{{ k('colunas.vigencia') }}</th>
            <th scope="col">{{ k('colunas.situacao') }}</th>
            <th scope="col">{{ k('colunas.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in cadastro.data.value.servicos" :key="x.id" :data-testid="`estab-sus-serv-${x.id}`">
            <td>{{ x.codigo }} — {{ x.descricao }}</td>
            <td>
              {{ k(`caracteristicas.${x.caracteristica}`)
              }}{{ x.prestadorNome ? `: ${x.prestadorNome}` : '' }}
            </td>
            <td>{{ vigencia(x.vigenciaInicio, x.vigenciaFim) }}</td>
            <td>{{ situacaoVig(x.vigente) }}</td>
            <td>
              <template v-if="podeEditar && !x.vigenciaFim">
                <span v-if="estaEncerrando('servicos', x.id)">
                  <input v-model="mesFim" type="month" :aria-label="k('campos.encerrarEm')" />
                  <button type="button" @click="confirmarEncerrar(x.versao)">
                    {{ k('acoes.confirmarEncerrar') }}
                  </button>
                </span>
                <button v-else type="button" @click="abrirEncerrar('servicos', x.id)">
                  {{ k('acoes.encerrar') }}
                </button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Regras por tipo de prestador -->
    <div v-if="aba === 'regrasPrestador'" data-testid="estab-sus-regras-prestador">
      <form v-if="podeEditar" class="formulario" data-testid="estab-sus-rp-form" @submit.prevent="incluirRp">
        <SanteSelecao
          v-model="rp.tipo"
          :rotulo="k('campos.tipoPrestador')"
          :opcoes="opTipos"
          data-testid="estab-sus-rp-tipo"
        />
        <SanteSelecao
          v-model="rp.natureza"
          :rotulo="k('campos.natureza')"
          :opcoes="opNaturezas"
          data-testid="estab-sus-rp-natureza"
        />
        <label
          >{{ k('campos.procedimento') }}
          <input
            v-model="rp.procedimento"
            inputmode="numeric"
            maxlength="10"
            data-testid="estab-sus-rp-procedimento"
        /></label>
        <SanteSelecao
          v-model="rp.grupo"
          :rotulo="k('campos.grupo')"
          :opcoes="opGrupos"
          data-testid="estab-sus-rp-grupo"
        />
        <SanteSelecao
          v-model="rp.servico"
          :rotulo="k('campos.servico')"
          :opcoes="opServicosSigtap"
          data-testid="estab-sus-rp-servico"
        />
        <SanteSelecao
          v-model="rp.instrumento"
          :rotulo="k('campos.instrumento')"
          :opcoes="opInstrumentos"
          data-testid="estab-sus-rp-instrumento"
        />
        <label
          ><input v-model="rp.permitido" type="checkbox" data-testid="estab-sus-rp-permitido" />
          {{ k('campos.permitido') }}</label
        >
        <label
          ><input v-model="rp.geral" type="checkbox" data-testid="estab-sus-rp-geral" />
          {{ k('campos.geral') }}</label
        >
        <label
          >{{ k('campos.inicio') }}
          <input v-model="rp.inicio" type="month" required data-testid="estab-sus-rp-inicio"
        /></label>
        <label
          >{{ k('campos.fim') }} <input v-model="rp.fim" type="month" data-testid="estab-sus-rp-fim"
        /></label>
        <ul v-if="problemasRp.length" class="problemas" data-testid="estab-sus-rp-problemas">
          <li v-for="p in problemasRp" :key="p">{{ p }}</li>
        </ul>
        <button
          type="submit"
          :disabled="problemasRp.length > 0 || acao.isPending.value"
          data-testid="estab-sus-rp-incluir"
        >
          {{ k('acoes.incluir') }}
        </button>
      </form>
      <p v-if="cadastro.data.value?.regrasPrestador.length === 0">{{ k('vazio') }}</p>
      <table v-else-if="cadastro.data.value" data-testid="estab-sus-rp-tabela">
        <thead>
          <tr>
            <th scope="col">{{ k('campos.tipoPrestador') }}</th>
            <th scope="col">{{ k('colunas.alvo') }}</th>
            <th scope="col">{{ k('colunas.regra') }}</th>
            <th scope="col">{{ k('colunas.vigencia') }}</th>
            <th scope="col">{{ k('colunas.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="x in cadastro.data.value.regrasPrestador"
            :key="x.id"
            :data-testid="`estab-sus-rp-${x.id}`"
          >
            <td>{{ x.tipoPrestador }}{{ x.geral ? ` (${k('regra.geral')})` : '' }}</td>
            <td>
              {{ alvoRegra(x) }}{{ x.naturezaJuridica ? ` · ${x.naturezaJuridica}` : ''
              }}{{ x.instrumento ? ` · ${x.instrumento}` : '' }}
            </td>
            <td>{{ k(`regra.${x.permitido ? 'permitido' : 'vedado'}`) }}</td>
            <td>{{ vigencia(x.vigenciaInicio, x.vigenciaFim) }} ({{ situacaoVig(x.vigente) }})</td>
            <td>
              <template v-if="podeEditar && !x.vigenciaFim">
                <span v-if="estaEncerrando('regras-prestador', x.id)">
                  <input v-model="mesFim" type="month" :aria-label="k('campos.encerrarEm')" />
                  <button type="button" @click="confirmarEncerrar(x.versao)">
                    {{ k('acoes.confirmarEncerrar') }}
                  </button>
                </span>
                <button v-else type="button" @click="abrirEncerrar('regras-prestador', x.id)">
                  {{ k('acoes.encerrar') }}
                </button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Serviço automático da produção -->
    <div v-if="aba === 'regrasServico'" data-testid="estab-sus-regras-servico">
      <form v-if="podeEditar" class="formulario" data-testid="estab-sus-rs-form" @submit.prevent="incluirRs">
        <SanteSelecao
          v-model="rs.servico"
          :rotulo="k('campos.servico')"
          :opcoes="opServicosSigtap"
          data-testid="estab-sus-rs-servico"
        />
        <label
          >{{ k('campos.procedimento') }}
          <input
            v-model="rs.procedimento"
            inputmode="numeric"
            maxlength="10"
            data-testid="estab-sus-rs-procedimento"
        /></label>
        <SanteSelecao
          v-model="rs.grupo"
          :rotulo="k('campos.grupo')"
          :opcoes="opGrupos"
          data-testid="estab-sus-rs-grupo"
        />
        <SanteSelecao
          v-model="rs.setor"
          :rotulo="k('campos.setor')"
          :opcoes="opSetores"
          data-testid="estab-sus-rs-setor"
        />
        <SanteSelecao
          v-model="rs.local"
          :rotulo="k('campos.local')"
          :opcoes="opLocais"
          data-testid="estab-sus-rs-local"
        />
        <label
          ><input v-model="rs.urgencia" type="checkbox" data-testid="estab-sus-rs-urgencia" />
          {{ k('campos.urgencia') }}</label
        >
        <label
          >{{ k('campos.prioridade') }}
          <input
            v-model.number="rs.prioridade"
            type="number"
            min="1"
            max="999"
            data-testid="estab-sus-rs-prioridade"
        /></label>
        <ul v-if="problemasRs.length" class="problemas" data-testid="estab-sus-rs-problemas">
          <li v-for="p in problemasRs" :key="p">{{ p }}</li>
        </ul>
        <button
          type="submit"
          :disabled="problemasRs.length > 0 || acao.isPending.value"
          data-testid="estab-sus-rs-incluir"
        >
          {{ k('acoes.incluir') }}
        </button>
      </form>
      <p v-if="cadastro.data.value?.regrasServico.length === 0">{{ k('vazio') }}</p>
      <table v-else-if="cadastro.data.value" data-testid="estab-sus-rs-tabela">
        <thead>
          <tr>
            <th scope="col">{{ k('colunas.servico') }}</th>
            <th scope="col">{{ k('colunas.alvo') }}</th>
            <th scope="col">{{ k('colunas.prioridade') }}</th>
            <th scope="col">{{ k('colunas.situacao') }}</th>
            <th scope="col">{{ k('colunas.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="x in cadastro.data.value.regrasServico"
            :key="x.id"
            :data-testid="`estab-sus-rs-${x.id}`"
          >
            <td>{{ x.servicoClassificacao }}</td>
            <td>
              {{ [x.procedimento, x.grupo, x.setor, x.local].filter(Boolean).join(' · ')
              }}{{ x.urgencia ? ` (${k('regra.urgencia')})` : '' }}
            </td>
            <td>{{ x.prioridade }}</td>
            <td>{{ k(`situacoes.${x.ativo ? 'ativa' : 'inativa'}`) }}</td>
            <td>
              <button
                v-if="podeEditar && x.ativo"
                type="button"
                data-testid="estab-sus-rs-inativar"
                @click="inativarRs(x.id, x.versao)"
              >
                {{ k('acoes.inativar') }}
              </button>
            </td>
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
.ajuda,
.largo {
  flex-basis: 100%;
}
.problemas {
  flex-basis: 100%;
  color: var(--sgh-alerta-texto);
}
</style>
