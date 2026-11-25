<script setup lang="ts">
// Áreas e escala da atenção domiciliar (C2-105, 03-PEP linha 143), em `/internacao/domiciliar/areas`, aberta pelo
// painel da internação domiciliar. Numa tela só: as áreas com as faixas de CEP (a sobreposição com outra área ativa
// aparece na hora), a busca da área pelo CEP, a equipe de cada área (vínculo com prioridade e vigência), a escala
// semanal (o choque com outro turno do profissional e o profissional fora da área aparecem na hora) e a grade dos
// próximos 7 dias com as vagas de cada turno. Mesmas regras do domínio que a API aplica; nada se apaga.
import {
  conferirAreaDomiciliar,
  conferirEscalaDomiciliar,
  conferirProfissionalArea,
  DIAS_SEMANA_ESCALA,
  vigenciasSeCruzam,
} from '@sgh/dominio-internacao';
import { SanteSelecao } from '@sgh/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  agirAreaDomiciliar,
  agirTurnoDomiciliar,
  type AreaDomiciliar,
  areaDoCepDomiciliar,
  criarTurnoDomiciliar,
  encerrarVinculoArea,
  lerAreasDomiciliares,
  lerEscalasDomiciliares,
  lerGradeDomiciliar,
  salvarAreaDomiciliar,
  vincularProfissionalArea,
} from '../api-area-escala-domiciliar.js';
import { pode } from '../../../casca/sessao/pode.js';
import ErroAdt from '../componentes/ErroAdt.vue';

const { t } = useI18n();
const cliente = useQueryClient();
const podeGravar = computed(() => pode('internacao.internacao.criar'));
const D = 'adt.areaEscalaDomiciliar';
type Id = number | '';
const nulo = (v: Id) => (v === '' ? null : v);
const hoje = () => new Date().toISOString().slice(0, 10);

const dados = useQuery({ queryKey: ['adt', 'domiciliar', 'areas'], queryFn: lerAreasDomiciliares });
const escalas = useQuery({ queryKey: ['adt', 'domiciliar', 'escalas'], queryFn: lerEscalasDomiciliares });
const inicioGrade = ref(hoje());
const grade = useQuery({
  queryKey: computed(() => ['adt', 'domiciliar', 'grade', inicioGrade.value]),
  queryFn: () => lerGradeDomiciliar(inicioGrade.value || hoje()),
});
const recarregar = () => cliente.invalidateQueries({ queryKey: ['adt', 'domiciliar'] });

const comVazio = (vazio: string, itens: readonly { id: number; nome: string }[]) => [
  { valor: '' as Id, rotulo: vazio },
  ...itens.map((x) => ({ valor: x.id as Id, rotulo: x.nome })),
];
const areas = computed(() => dados.data.value?.areas ?? []);
const opAreas = computed(() =>
  comVazio(
    t(`${D}.nenhuma`),
    areas.value.filter((a) => a.ativo).map((a) => ({ id: a.id, nome: `${a.codigo} · ${a.descricao}` })),
  ),
);
const opProfs = computed(() => comVazio(t(`${D}.escolha`), dados.data.value?.profissionais ?? []));
const opProgramas = computed(() => comVazio(t(`${D}.nenhuma`), dados.data.value?.programas ?? []));
const opTipos = computed(() => comVazio(t(`${D}.todos`), dados.data.value?.tiposChamado ?? []));
const opDias = computed(() =>
  DIAS_SEMANA_ESCALA.map((d) => ({ valor: d as number | '', rotulo: t(`${D}.dias.${d}`) })),
);
const cepVisivel = (c: string) => `${c.slice(0, 5)}-${c.slice(5)}`;

const erro = ref<unknown>(null);
const aviso = ref('');
const acao = useMutation({
  mutationFn: (fn: () => Promise<unknown>) => fn(),
  onSuccess: () => {
    erro.value = null;
    aviso.value = t(`${D}.feito`);
    void recarregar();
  },
  onError: (e) => {
    aviso.value = '';
    erro.value = e;
  },
});
const executar = (fn: () => Promise<unknown>, depois?: () => void) =>
  acao.mutate(fn, { onSuccess: () => depois?.() });

// ------------------------------------------------------------ área
const editando = ref<AreaDomiciliar | null>(null);
const codigo = ref('');
const descricao = ref('');
const programa = ref<Id>('');
const faixaVazia = () => ({ cepInicial: '', cepFinal: '' });
const faixas = ref([faixaVazia()]);
const limparArea = () => {
  editando.value = null;
  codigo.value = '';
  descricao.value = '';
  programa.value = '';
  faixas.value = [faixaVazia()];
};
const editar = (a: AreaDomiciliar) => {
  editando.value = a;
  codigo.value = a.codigo;
  descricao.value = a.descricao;
  programa.value = a.programa ?? '';
  faixas.value = a.faixas.length
    ? a.faixas.map((f) => ({ cepInicial: cepVisivel(f.cepInicial), cepFinal: cepVisivel(f.cepFinal) }))
    : [faixaVazia()];
};
const faixasPreenchidas = computed(() => faixas.value.filter((f) => f.cepInicial || f.cepFinal));
const problemasArea = computed(() =>
  conferirAreaDomiciliar({
    codigo: codigo.value,
    descricao: descricao.value,
    faixas: faixasPreenchidas.value,
    faixasOutrasAreas: areas.value
      .filter((a) => a.ativo && a.id !== editando.value?.id)
      .flatMap((a) =>
        a.faixas.map((f) => ({ area: a.codigo, cepInicial: f.cepInicial, cepFinal: f.cepFinal })),
      ),
  }),
);
const salvarArea = () =>
  executar(
    () =>
      salvarAreaDomiciliar(editando.value?.id ?? null, {
        codigo: codigo.value,
        descricao: descricao.value,
        programa: nulo(programa.value),
        faixas: faixasPreenchidas.value,
        ...(editando.value ? { versao: editando.value.versao } : {}),
      }),
    limparArea,
  );

const cep = ref('');
const achado = ref<{ area: number | null } | null>(null);
const nomeArea = (id: number | null) => {
  const a = areas.value.find((x) => x.id === id);
  return a ? `${a.codigo} · ${a.descricao}` : '';
};
const procurarCep = async () => {
  try {
    erro.value = null;
    achado.value = await areaDoCepDomiciliar(cep.value);
  } catch (e) {
    erro.value = e;
  }
};

// ------------------------------------------------------------ vínculo
const areaVinc = ref<Id>('');
const profVinc = ref<Id>('');
const prioridade = ref(1);
const inicioVinc = ref(hoje());
const fimVinc = ref('');
const problemasVinc = computed(() =>
  areaVinc.value === '' || profVinc.value === ''
    ? []
    : conferirProfissionalArea({
        prioridade: Number(prioridade.value),
        vigenciaInicio: inicioVinc.value,
        vigenciaFim: fimVinc.value || null,
        outrosVinculos: (areas.value.find((a) => a.id === areaVinc.value)?.profissionais ?? [])
          .filter((v) => v.profissional === profVinc.value)
          .map((v) => ({ inicio: v.vigenciaInicio, fim: v.vigenciaFim })),
      }),
);
const vincular = () =>
  executar(() =>
    vincularProfissionalArea(Number(areaVinc.value), {
      profissional: nulo(profVinc.value),
      prioridade: Number(prioridade.value),
      vigenciaInicio: inicioVinc.value,
      vigenciaFim: fimVinc.value || null,
    }),
  );
const ultimoDia = ref(hoje());

// ------------------------------------------------------------ escala
const areaT = ref<Id>('');
const profT = ref<Id>('');
const tipoT = ref<Id>('');
const diaT = ref<number | ''>(2);
const horaIni = ref('08:00');
const horaFim = ref('12:00');
const quantidade = ref(4);
const extra = ref(false);
const feriado = ref(false);
const inicioT = ref(hoje());
const fimT = ref('');
const profissionalNaArea = computed(() => {
  if (areaT.value === '') return null;
  const a = areas.value.find((x) => x.id === areaT.value);
  return (a?.profissionais ?? []).some(
    (v) =>
      v.profissional === profT.value &&
      vigenciasSeCruzam(
        { inicio: v.vigenciaInicio, fim: v.vigenciaFim },
        { inicio: inicioT.value, fim: inicioT.value },
      ),
  );
});
const problemasTurno = computed(() =>
  profT.value === ''
    ? []
    : conferirEscalaDomiciliar({
        diaSemana: Number(diaT.value),
        horaInicio: horaIni.value,
        horaFim: horaFim.value,
        vigenciaInicio: inicioT.value,
        vigenciaFim: fimT.value || null,
        quantidade: Number(quantidade.value),
        profissionalNaArea: profissionalNaArea.value,
        outrosTurnos: (escalas.data.value ?? []).filter((e) => e.ativo && e.profissional === profT.value),
      }),
);
const criarTurno = () =>
  executar(() =>
    criarTurnoDomiciliar({
      area: nulo(areaT.value),
      profissional: nulo(profT.value),
      tipoChamado: nulo(tipoT.value),
      diaSemana: Number(diaT.value),
      horaInicio: horaIni.value,
      horaFim: horaFim.value,
      quantidade: Number(quantidade.value),
      permiteExtra: extra.value,
      atendeFeriado: feriado.value,
      vigenciaInicio: inicioT.value,
      vigenciaFim: fimT.value || null,
    }),
  );
const vigenciaTxt = (inicio: string, fim: string | null) =>
  `${inicio} · ${fim ? t(`${D}.ate`, { fim }) : t(`${D}.semFim`)}`;
</script>

<template>
  <section class="tela-agenda" aria-labelledby="area-escala-titulo" data-testid="tela-area-escala-domiciliar">
    <h1 id="area-escala-titulo">{{ t(`${D}.titulo`) }}</h1>
    <p>{{ t(`${D}.texto`) }}</p>
    <p class="acoes">
      <RouterLink :to="{ name: 'adt.domiciliar' }" data-testid="area-escala-ir-painel">{{
        t(`${D}.irPainel`)
      }}</RouterLink>
    </p>
    <ErroAdt v-if="dados.isError.value" :erro="dados.error.value" />
    <ErroAdt v-if="escalas.isError.value" :erro="escalas.error.value" />
    <ErroAdt v-if="erro" :erro="erro" />
    <p v-if="aviso" role="status" data-testid="area-escala-aviso">{{ aviso }}</p>
    <p v-if="!podeGravar" role="note" data-testid="area-escala-somente-leitura">
      {{ t(`${D}.somenteLeitura`) }}
    </p>

    <!-- Áreas -->
    <h2>{{ t(`${D}.areas`) }}</h2>
    <form class="filtros" data-testid="area-cep-form" @submit.prevent="procurarCep">
      <label
        >{{ t(`${D}.cep`) }}
        <input v-model="cep" maxlength="9" inputmode="numeric" required data-testid="area-cep"
      /></label>
      <button type="submit" data-testid="area-cep-procurar">{{ t(`${D}.procurarCep`) }}</button>
      <span v-if="achado" role="status" data-testid="area-cep-resultado">{{
        achado.area ? t(`${D}.areaDoCep`, { area: nomeArea(achado.area) }) : t(`${D}.semAreaCep`)
      }}</span>
    </form>
    <p v-if="!areas.length && dados.isSuccess.value">{{ t(`${D}.vazio`) }}</p>
    <table v-else data-testid="area-lista">
      <thead>
        <tr>
          <th>{{ t(`${D}.codigo`) }}</th>
          <th>{{ t(`${D}.descricao`) }}</th>
          <th>{{ t(`${D}.faixas`) }}</th>
          <th>{{ t(`${D}.equipe`) }}</th>
          <th>{{ t(`${D}.situacao`) }}</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="a in areas" :key="a.id" :data-testid="`area-${a.id}`">
          <td>{{ a.codigo }}</td>
          <td>{{ a.descricao }}</td>
          <td>
            {{ a.faixas.map((f) => `${cepVisivel(f.cepInicial)} a ${cepVisivel(f.cepFinal)}`).join('; ') }}
          </td>
          <td>
            <ul>
              <li v-for="v in a.profissionais" :key="v.id" :data-testid="`area-vinculo-${v.id}`">
                {{ v.prioridade }}. {{ v.nome }} · {{ vigenciaTxt(v.vigenciaInicio, v.vigenciaFim) }}
                <button
                  v-if="
                    podeGravar &&
                    (!v.vigenciaFim || v.vigenciaFim > ultimoDia) &&
                    ultimoDia >= v.vigenciaInicio
                  "
                  type="button"
                  :data-testid="`area-vinculo-encerrar-${v.id}`"
                  @click="executar(() => encerrarVinculoArea(v.id, v.versao, ultimoDia))"
                >
                  {{ t(`${D}.encerrar`) }}
                </button>
              </li>
            </ul>
          </td>
          <td>{{ a.ativo ? t(`${D}.ativa`) : t(`${D}.inativa`) }}</td>
          <td>
            <template v-if="podeGravar">
              <button type="button" :data-testid="`area-editar-${a.id}`" @click="editar(a)">
                {{ t(`${D}.editar`) }}
              </button>
              <button
                type="button"
                :data-testid="`area-${a.ativo ? 'inativar' : 'reativar'}-${a.id}`"
                @click="executar(() => agirAreaDomiciliar(a.id, a.ativo ? 'inativar' : 'reativar', a.versao))"
              >
                {{ a.ativo ? t(`${D}.inativar`) : t(`${D}.reativar`) }}
              </button>
            </template>
          </td>
        </tr>
      </tbody>
    </table>
    <label v-if="podeGravar"
      >{{ t(`${D}.ultimoDia`) }} <input v-model="ultimoDia" type="date" data-testid="area-ultimo-dia"
    /></label>

    <form v-if="podeGravar" class="filtros" data-testid="area-form" @submit.prevent="salvarArea">
      <h3>{{ editando ? t(`${D}.editando`, { codigo: editando.codigo }) : t(`${D}.novaArea`) }}</h3>
      <label
        >{{ t(`${D}.codigo`) }}
        <input v-model="codigo" maxlength="30" required :readonly="!!editando" data-testid="area-codigo"
      /></label>
      <label
        >{{ t(`${D}.descricao`) }}
        <input v-model="descricao" maxlength="150" required data-testid="area-descricao"
      /></label>
      <SanteSelecao
        v-model="programa"
        :rotulo="t(`${D}.programa`)"
        :opcoes="opProgramas"
        data-testid="area-programa"
      />
      <fieldset data-testid="area-faixas">
        <legend>{{ t(`${D}.faixas`) }}</legend>
        <p v-for="(f, i) in faixas" :key="i">
          <label
            >{{ t(`${D}.cepInicial`) }}
            <input
              v-model="f.cepInicial"
              maxlength="9"
              inputmode="numeric"
              :data-testid="`area-faixa-inicio-${i}`"
          /></label>
          <label
            >{{ t(`${D}.cepFinal`) }}
            <input
              v-model="f.cepFinal"
              maxlength="9"
              inputmode="numeric"
              :data-testid="`area-faixa-fim-${i}`"
          /></label>
          <button
            v-if="faixas.length > 1"
            type="button"
            :data-testid="`area-faixa-tirar-${i}`"
            @click="faixas.splice(i, 1)"
          >
            {{ t(`${D}.tirarFaixa`) }}
          </button>
        </p>
        <button type="button" data-testid="area-faixa-incluir" @click="faixas.push(faixaVazia())">
          {{ t(`${D}.incluirFaixa`) }}
        </button>
      </fieldset>
      <ul v-if="problemasArea.length" class="problemas" data-testid="area-problemas">
        <li v-for="p in problemasArea" :key="p.campo + p.mensagem">{{ p.mensagem }}</li>
      </ul>
      <button
        type="submit"
        :disabled="problemasArea.length > 0 || acao.isPending.value"
        data-testid="area-salvar"
      >
        {{ t(`${D}.salvarArea`) }}
      </button>
      <button v-if="editando" type="button" data-testid="area-cancelar-edicao" @click="limparArea">
        {{ t(`${D}.cancelarEdicao`) }}
      </button>
    </form>

    <form v-if="podeGravar" class="filtros" data-testid="area-vinculo-form" @submit.prevent="vincular">
      <h3>{{ t(`${D}.vinculo`) }}</h3>
      <SanteSelecao
        v-model="areaVinc"
        :rotulo="t(`${D}.area`)"
        :opcoes="opAreas"
        data-testid="area-vinculo-area"
      />
      <SanteSelecao
        v-model="profVinc"
        :rotulo="t(`${D}.profissional`)"
        :opcoes="opProfs"
        data-testid="area-vinculo-profissional"
      />
      <label
        >{{ t(`${D}.prioridade`) }}
        <input
          v-model.number="prioridade"
          type="number"
          min="1"
          max="99"
          data-testid="area-vinculo-prioridade"
      /></label>
      <label
        >{{ t(`${D}.inicio`) }}
        <input v-model="inicioVinc" type="date" required data-testid="area-vinculo-inicio"
      /></label>
      <label
        >{{ t(`${D}.fim`) }} <input v-model="fimVinc" type="date" data-testid="area-vinculo-fim"
      /></label>
      <ul v-if="problemasVinc.length" class="problemas" data-testid="area-vinculo-problemas">
        <li v-for="p in problemasVinc" :key="p.campo + p.mensagem">{{ p.mensagem }}</li>
      </ul>
      <button
        type="submit"
        :disabled="areaVinc === '' || profVinc === '' || problemasVinc.length > 0 || acao.isPending.value"
        data-testid="area-vinculo-salvar"
      >
        {{ t(`${D}.vincular`) }}
      </button>
    </form>

    <!-- Escala -->
    <h2>{{ t(`${D}.escala`) }}</h2>
    <form v-if="podeGravar" class="filtros" data-testid="escala-form" @submit.prevent="criarTurno">
      <h3>{{ t(`${D}.novoTurno`) }}</h3>
      <SanteSelecao v-model="areaT" :rotulo="t(`${D}.area`)" :opcoes="opAreas" data-testid="escala-area" />
      <SanteSelecao
        v-model="profT"
        :rotulo="t(`${D}.profissional`)"
        :opcoes="opProfs"
        data-testid="escala-profissional"
      />
      <SanteSelecao
        v-model="tipoT"
        :rotulo="t(`${D}.tipoChamado`)"
        :opcoes="opTipos"
        data-testid="escala-tipo"
      />
      <SanteSelecao v-model="diaT" :rotulo="t(`${D}.dia`)" :opcoes="opDias" data-testid="escala-dia" />
      <label
        >{{ t(`${D}.horaInicio`) }}
        <input v-model="horaIni" type="time" required data-testid="escala-hora-inicio"
      /></label>
      <label
        >{{ t(`${D}.horaFim`) }} <input v-model="horaFim" type="time" required data-testid="escala-hora-fim"
      /></label>
      <label
        >{{ t(`${D}.quantidade`) }}
        <input v-model.number="quantidade" type="number" min="1" max="200" data-testid="escala-quantidade"
      /></label>
      <label
        ><input v-model="extra" type="checkbox" data-testid="escala-extra" /> {{ t(`${D}.extra`) }}</label
      >
      <label
        ><input v-model="feriado" type="checkbox" data-testid="escala-feriado" />
        {{ t(`${D}.feriado`) }}</label
      >
      <label
        >{{ t(`${D}.inicio`) }} <input v-model="inicioT" type="date" required data-testid="escala-inicio"
      /></label>
      <label>{{ t(`${D}.fim`) }} <input v-model="fimT" type="date" data-testid="escala-fim" /></label>
      <ul v-if="problemasTurno.length" class="problemas" data-testid="escala-problemas">
        <li v-for="p in problemasTurno" :key="p.campo + p.mensagem">{{ p.mensagem }}</li>
      </ul>
      <button
        type="submit"
        :disabled="profT === '' || problemasTurno.length > 0 || acao.isPending.value"
        data-testid="escala-salvar"
      >
        {{ t(`${D}.criarTurno`) }}
      </button>
    </form>

    <table v-if="escalas.data.value?.length" data-testid="escala-lista">
      <thead>
        <tr>
          <th>{{ t(`${D}.dia`) }}</th>
          <th>{{ t(`${D}.turnos`) }}</th>
          <th>{{ t(`${D}.profissional`) }}</th>
          <th>{{ t(`${D}.area`) }}</th>
          <th>{{ t(`${D}.tipoChamado`) }}</th>
          <th>{{ t(`${D}.quantidade`) }}</th>
          <th>{{ t(`${D}.vigencia`) }}</th>
          <th>{{ t(`${D}.situacao`) }}</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="e in escalas.data.value" :key="e.id" :data-testid="`escala-${e.id}`">
          <td>{{ t(`${D}.dias.${e.diaSemana}`) }}</td>
          <td>{{ t(`${D}.turno`, { inicio: e.horaInicio, fim: e.horaFim }) }}</td>
          <td>{{ e.profissionalNome }}</td>
          <td>{{ e.areaNome ?? '' }}</td>
          <td>{{ e.tipoNome ?? t(`${D}.todos`) }}</td>
          <td>{{ e.quantidade }}{{ e.permiteExtra ? ` + ${t(`${D}.extra`)}` : '' }}</td>
          <td>{{ vigenciaTxt(e.vigenciaInicio, e.vigenciaFim) }}</td>
          <td>{{ e.ativo ? t(`${D}.ativa`) : t(`${D}.inativa`) }}</td>
          <td>
            <template v-if="podeGravar">
              <button
                v-if="(!e.vigenciaFim || e.vigenciaFim > ultimoDia) && ultimoDia >= e.vigenciaInicio"
                type="button"
                :data-testid="`escala-encerrar-${e.id}`"
                @click="executar(() => agirTurnoDomiciliar(e.id, 'encerrar', e.versao, ultimoDia))"
              >
                {{ t(`${D}.encerrar`) }}
              </button>
              <button
                type="button"
                :data-testid="`escala-${e.ativo ? 'inativar' : 'reativar'}-${e.id}`"
                @click="
                  executar(() => agirTurnoDomiciliar(e.id, e.ativo ? 'inativar' : 'reativar', e.versao))
                "
              >
                {{ e.ativo ? t(`${D}.inativar`) : t(`${D}.reativar`) }}
              </button>
            </template>
          </td>
        </tr>
      </tbody>
    </table>

    <h2>{{ t(`${D}.grade`) }}</h2>
    <label
      >{{ t(`${D}.gradeDe`) }} <input v-model="inicioGrade" type="date" data-testid="escala-grade-inicio"
    /></label>
    <ErroAdt v-if="grade.isError.value" :erro="grade.error.value" />
    <ul v-if="grade.data.value" data-testid="escala-grade">
      <li v-for="d in grade.data.value.dias" :key="d.data" :data-testid="`escala-grade-${d.data}`">
        <strong>{{ d.data }}</strong>
        <span v-if="d.feriado" :data-testid="`escala-grade-feriado-${d.data}`">
          · {{ t(`${D}.diaFeriado`) }}</span
        >
        <span v-if="!d.turnos.length"> · {{ t(`${D}.vazio`) }}</span>
        <span v-for="tu in d.turnos" :key="tu.id">
          {{
            t(`${D}.turnoGrade`, {
              inicio: tu.horaInicio,
              fim: tu.horaFim,
              profissional: tu.profissionalNome ?? '',
              vagas: t(`${D}.vagas`, { ocupadas: tu.ocupadas, quantidade: tu.quantidade, livres: tu.livres }),
            })
          }}
        </span>
      </li>
    </ul>
  </section>
</template>
