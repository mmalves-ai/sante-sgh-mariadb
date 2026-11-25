<script setup lang="ts">
// Registro oncológico e radioterapia do paciente (09-AREA linha 69), na aba "Tumor e radioterapia" da ficha da
// oncologia. Desenho próprio, por paciente: cada tumor num cartão com a linha do tempo do estadiamento (o novo não
// apaga o anterior) e os planos de radioterapia com o progresso das frações e da dose; a sessão é um clique (a dose da
// fração já vem preenchida). As regras do domínio (@sgh/dominio-pep) conferem na hora, antes de enviar; o servidor
// confere de novo. CID, topografia e morfologia pela busca nos catálogos oficiais (CID-10 e CID-O-3).
import {
  BASES_DIAGNOSTICO,
  categoriaTnm,
  conferirEstadiamento,
  conferirPlanoRadioterapia,
  conferirTumor,
  DESFECHOS_SESSAO_RT,
  estadioDecorrente,
  LATERALIDADES_TUMOR,
  TECNICAS_RADIOTERAPIA,
  TIPOS_ESTADIAMENTO,
  type BaseDiagnostico,
  type ErroCampoOnco,
} from '@sgh/dominio-pep';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { novaChaveEspecialidade } from '../api-especialidades.js';
import {
  aprovarPlanoRt,
  buscarCatalogoOnco,
  encerrarPlanoRt,
  estadiarTumor,
  type ItemCatalogo,
  lerCadastrosOncologia,
  lerRegistroOncologico,
  planejarRadioterapia,
  type PlanoLido,
  registrarSessaoRt,
  registrarTumor,
  type TumorLido,
} from '../api-registro-oncologico.js';
import ErroEspecialidade from './ErroEspecialidade.vue';

const props = defineProps<{ reg: number; pode: boolean }>();
const { t } = useI18n();
const k = (x: string) => t(`especialidades.registroOnco.${x}`);
const cliente = useQueryClient();
const chaveConsulta = computed(() => ['especialidades', 'oncologia', 'registro', props.reg]);
const dados = useQuery({ queryKey: chaveConsulta, queryFn: () => lerRegistroOncologico(props.reg) });
const cadastros = useQuery({
  queryKey: ['especialidades', 'oncologia', 'cadastros-registro'],
  queryFn: lerCadastrosOncologia,
});
const hoje = computed(() => dados.data.value?.hoje ?? new Date().toISOString().slice(0, 10));
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);

async function gravar(
  f: () => Promise<{ mensagem: string; aviso?: string | null | undefined }>,
  depois?: () => void,
) {
  ocupado.value = true;
  erro.value = null;
  try {
    const r = await f();
    mensagem.value = r.aviso ? `${r.mensagem} ${r.aviso}` : r.mensagem;
    depois?.();
    await cliente.invalidateQueries({ queryKey: chaveConsulta.value });
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}
const errosDe = (es: readonly ErroCampoOnco[]) => es.map((e) => e.mensagem);
const opcoes = (lista: readonly string[], grupo: string) =>
  lista.map((x) => ({ valor: x, rotulo: t(`especialidades.registroOnco.${grupo}.${x}`) }));

// ── Busca nos catálogos (CID-10, topografia e morfologia da CID-O-3) ──
const busca = reactive({ cid: '', topografia: '', morfologia: '' });
const achados = reactive<Record<'cid' | 'topografia' | 'morfologia', ItemCatalogo[]>>({
  cid: [],
  topografia: [],
  morfologia: [],
});
let espera: ReturnType<typeof setTimeout> | undefined;
function buscar(catalogo: 'cid' | 'topografia' | 'morfologia') {
  clearTimeout(espera);
  espera = setTimeout(async () => {
    achados[catalogo] =
      busca[catalogo].trim().length < 2
        ? []
        : await buscarCatalogoOnco(catalogo, busca[catalogo], tumor.cid).catch(() => []);
  }, 250);
}
function escolher(catalogo: 'cid' | 'topografia' | 'morfologia', i: ItemCatalogo) {
  tumor[catalogo] = i.codigo;
  busca[catalogo] = `${i.codigo} ${i.descricao}`;
  achados[catalogo] = [];
  // A topografia sugerida pelo CID (C50.4 → C50.4; C50 → C50.9).
  if (catalogo === 'cid' && !tumor.topografia && i.codigo.startsWith('C'))
    tumor.topografia = i.codigo.length > 3 ? i.codigo : `${i.codigo}.9`;
}

// ── Tumor ──
const novoTumor = ref(false);
const tumor = reactive({
  cid: '',
  topografia: '',
  morfologia: '',
  diagnosticadoEm: '',
  baseDiagnostica: 'histologia_primario' as BaseDiagnostico,
  lateralidade: 'nao_se_aplica' as (typeof LATERALIDADES_TUMOR)[number],
  ecog: null as number | null,
  observacao: '',
});
const errosTumor = computed(() =>
  tumor.cid && tumor.diagnosticadoEm
    ? errosDe(conferirTumor({ ...tumor, morfologia: tumor.morfologia || null }, hoje.value))
    : [],
);
const podeGravarTumor = computed(
  () => !!tumor.cid && !!tumor.topografia && !!tumor.diagnosticadoEm && errosTumor.value.length === 0,
);
function gravarTumor() {
  void gravar(
    () =>
      registrarTumor(
        props.reg,
        { ...tumor, morfologia: tumor.morfologia || null, observacao: tumor.observacao.trim() || null },
        novaChaveEspecialidade('tumor'),
      ),
    () => (novoTumor.value = false),
  );
}

// ── Estadiamento ──
const estadiando = ref<number | null>(null);
const est = reactive({
  tipo: 'clinico' as (typeof TIPOS_ESTADIAMENTO)[number],
  data: '',
  t: '',
  n: '',
  m: '',
  estadio: '',
  metastases: '',
});
function abrirEstadiamento(x: TumorLido) {
  estadiando.value = x.id;
  const ultimo = x.estadiamentos[0];
  Object.assign(est, {
    tipo: 'clinico',
    data: hoje.value,
    t: ultimo?.t ?? '',
    n: ultimo?.n ?? '',
    m: ultimo?.m ?? '',
    estadio: ultimo?.estadio ?? '',
    metastases: '',
  });
}
const sitios = computed(() =>
  est.metastases
    .split(',')
    .map((x) => x.trim().toUpperCase())
    .filter(Boolean),
);
const sugerido = computed(() => {
  const [tt, nn, mm] = [categoriaTnm('T', est.t), categoriaTnm('N', est.n), categoriaTnm('M', est.m)];
  return tt && nn && mm ? estadioDecorrente(tt, nn, mm) : null;
});
function errosEst(x: TumorLido) {
  if (!est.t || !est.n || !est.m) return [];
  return errosDe(
    conferirEstadiamento(
      { ...est, estadio: est.estadio || null, metastases: sitios.value },
      { diagnosticadoEm: x.diagnosticadoEm, base: x.baseDiagnostica as BaseDiagnostico },
      hoje.value,
    ),
  );
}
function gravarEstadiamento(x: TumorLido) {
  void gravar(
    () =>
      estadiarTumor(
        props.reg,
        { tumor: x.id, ...est, estadio: est.estadio || null, metastases: sitios.value },
        novaChaveEspecialidade('estadiamento'),
      ),
    () => (estadiando.value = null),
  );
}

// ── Plano de radioterapia ──
const planejando = ref<number | null>(null);
const plano = reactive({
  regiao: '',
  aparelho: null as string | null,
  intencao: '',
  tecnica: 'conformacional' as (typeof TECNICAS_RADIOTERAPIA)[number],
  doseFracaoCgy: 200,
  fracoesPrevistas: 25,
  fracoesPorSemana: 5 as number | null,
  inicioPrevisto: null as string | null,
  energia: '',
});
const doseTotal = computed(() => plano.doseFracaoCgy * plano.fracoesPrevistas);
const errosPlano = computed(() =>
  errosDe(conferirPlanoRadioterapia({ ...plano, doseTotalCgy: doseTotal.value }, hoje.value)),
);
function gravarPlano(tumorId: number) {
  void gravar(
    () =>
      planejarRadioterapia(
        props.reg,
        {
          tumor: tumorId,
          ...plano,
          energia: plano.energia.trim() || null,
          doseTotalCgy: doseTotal.value,
          descricaoArea: null,
          concomitanteQuimioterapia: false,
        },
        novaChaveEspecialidade('plano-rt'),
      ),
    () => (planejando.value = null),
  );
}
const planosDo = (id: number) => (dados.data.value?.planos ?? []).filter((p) => p.tumor === id);
const fisico = ref<number | null>(null);
const aprovando = ref<number | null>(null);
const sessaoDe = reactive<
  Record<number, { desfecho: (typeof DESFECHOS_SESSAO_RT)[number]; dose: number | null; motivo: string }>
>({});
function abrirSessao(p: PlanoLido) {
  sessaoDe[p.id] = { desfecho: 'realizada', dose: p.doseFracaoCgy, motivo: '' };
}
function gravarSessao(p: PlanoLido) {
  const s = sessaoDe[p.id]!;
  void gravar(
    () =>
      registrarSessaoRt(
        props.reg,
        p.id,
        {
          desfecho: s.desfecho,
          doseAplicadaCgy: s.desfecho === 'realizada' ? s.dose : null,
          motivo: s.desfecho === 'realizada' ? null : s.motivo.trim() || null,
        },
        novaChaveEspecialidade('sessao-rt'),
      ),
    () => delete sessaoDe[p.id],
  );
}
const encerrando = reactive<Record<number, { situacao: 'interrompido' | 'cancelado'; motivo: string }>>({});
const ativo = (p: PlanoLido) => ['aprovado', 'em_andamento', 'pausado'].includes(p.situacao);
const encerrado = (p: PlanoLido) => ['interrompido', 'concluido', 'cancelado'].includes(p.situacao);
const pct = (p: PlanoLido) => Math.min(100, Math.round((p.doseAcumuladaCgy / p.doseTotalCgy) * 100));
</script>

<template>
  <section class="painel" aria-labelledby="onco-registro-titulo" data-testid="onco-registro">
    <h2 id="onco-registro-titulo">{{ k('tumores') }}</h2>
    <SanteAlerta
      v-if="mensagem"
      variante="info"
      :texto="mensagem"
      anunciar
      data-testid="onco-registro-mensagem"
    />
    <ErroEspecialidade v-if="erro" :erro="erro" />
    <ErroEspecialidade v-if="dados.isError.value" :erro="dados.error.value" />
    <p v-else-if="!dados.data.value" role="status">{{ k('carregando') }}</p>
    <template v-else>
      <p v-if="dados.data.value.tumores.length === 0">{{ k('nenhumTumor') }}</p>
      <article
        v-for="x in dados.data.value.tumores"
        :key="x.id"
        class="cartao-tumor"
        :data-testid="`onco-tumor-${x.id}`"
      >
        <header>
          <strong>{{ x.topografia }} {{ x.topografiaDescricao }}</strong>
          <span>· {{ x.cid }} · {{ x.morfologia ?? '—' }} {{ x.morfologiaDescricao ?? '' }}</span>
          <span
            >· {{ x.diagnosticadoEm }} ·
            {{ t(`especialidades.registroOnco.bases.${x.baseDiagnostica}`) }}</span
          >
          <span v-if="x.estadiamentos[0]" class="selo" :data-testid="`onco-tnm-${x.id}`">
            {{ x.estadiamentos[0].tnm }}
            {{ x.estadiamentos[0].estadio ? `· ${x.estadiamentos[0].estadio}` : '' }}
          </span>
        </header>
        <details>
          <summary>{{ k('linhaTempo') }} ({{ x.estadiamentos.length }})</summary>
          <p v-if="x.estadiamentos.length === 0">{{ k('semEstadiamento') }}</p>
          <ol>
            <li v-for="e in x.estadiamentos" :key="e.id">
              {{ e.data }} · {{ e.tnm }} {{ e.estadio ?? '' }} {{ e.metastases ? `· ${e.metastases}` : '' }}
            </li>
          </ol>
        </details>
        <div v-if="pode" class="acoes">
          <SanteBotao
            variante="texto"
            :rotulo="k('estadiar')"
            :data-testid="`onco-estadiar-${x.id}`"
            @click="abrirEstadiamento(x)"
          />
          <SanteBotao
            variante="texto"
            :rotulo="k('novoPlano')"
            :data-testid="`onco-planejar-${x.id}`"
            @click="planejando = x.id"
          />
        </div>
        <form v-if="estadiando === x.id" class="grade" @submit.prevent="gravarEstadiamento(x)">
          <h3>{{ k('estadiamento') }}</h3>
          <SanteSelecao
            v-model="est.tipo"
            :rotulo="k('tipoEstadiamento')"
            :opcoes="opcoes(TIPOS_ESTADIAMENTO, 'tipos')"
          />
          <SanteData v-model="est.data" :rotulo="k('data')" editavel />
          <SanteCampoTexto v-model="est.t" :rotulo="k('categoriaT')" :max-bytes="10" data-testid="onco-t" />
          <SanteCampoTexto v-model="est.n" :rotulo="k('categoriaN')" :max-bytes="10" data-testid="onco-n" />
          <SanteCampoTexto v-model="est.m" :rotulo="k('categoriaM')" :max-bytes="10" data-testid="onco-m" />
          <SanteSelecao
            v-model="est.estadio"
            :rotulo="k('estadio')"
            :opcoes="[
              { valor: '', rotulo: '—' },
              ...(cadastros.data.value?.estadios ?? []).map((e) => ({ valor: e.codigo, rotulo: e.codigo })),
            ]"
            data-testid="onco-estadio"
          />
          <p v-if="sugerido" class="dica">
            {{ t('especialidades.registroOnco.estadioSugerido', { e: sugerido }) }}
          </p>
          <SanteCampoTexto
            v-model="est.metastases"
            :rotulo="k('metastases')"
            :max-bytes="500"
            data-testid="onco-metastases"
          />
          <ul v-if="errosEst(x).length" class="erros" data-testid="onco-erros-estadiamento">
            <li v-for="m in errosEst(x)" :key="m">{{ m }}</li>
          </ul>
          <SanteBotao
            tipo="submit"
            :rotulo="k('gravarEstadiamento')"
            :desabilitado="ocupado || !est.t || !est.n || !est.m || errosEst(x).length > 0"
            data-testid="onco-gravar-estadiamento"
          />
        </form>
        <form v-if="planejando === x.id" class="grade" @submit.prevent="gravarPlano(x.id)">
          <h3>{{ k('novoPlano') }}</h3>
          <SanteSelecao
            v-model="plano.regiao"
            :rotulo="k('regiao')"
            :opcoes="
              (cadastros.data.value?.regioes ?? []).map((r) => ({ valor: r.codigo, rotulo: r.descricao }))
            "
            data-testid="onco-regiao"
          />
          <SanteSelecao
            v-model="plano.intencao"
            :rotulo="k('intencao')"
            :opcoes="
              (cadastros.data.value?.intencoes ?? []).map((r) => ({ valor: r.codigo, rotulo: r.descricao }))
            "
            data-testid="onco-intencao"
          />
          <SanteSelecao
            v-model="plano.aparelho"
            :rotulo="k('aparelho')"
            :opcoes="[
              { valor: null, rotulo: k('semAparelho') },
              ...(cadastros.data.value?.aparelhos ?? []).map((r) => ({
                valor: r.codigo,
                rotulo: r.descricao,
              })),
            ]"
          />
          <SanteSelecao
            v-model="plano.tecnica"
            :rotulo="k('tecnica')"
            :opcoes="opcoes(TECNICAS_RADIOTERAPIA, 'tecnicas')"
          />
          <div class="campo">
            <label for="onco-dose-fracao">{{ k('doseFracao') }}</label>
            <input
              id="onco-dose-fracao"
              v-model.number="plano.doseFracaoCgy"
              type="number"
              min="1"
              data-testid="onco-dose-fracao"
            />
          </div>
          <div class="campo">
            <label for="onco-fracoes">{{ k('fracoes') }}</label>
            <input
              id="onco-fracoes"
              v-model.number="plano.fracoesPrevistas"
              type="number"
              min="1"
              data-testid="onco-fracoes"
            />
          </div>
          <div class="campo">
            <label for="onco-fracoes-semana">{{ k('fracoesSemana') }}</label>
            <input
              id="onco-fracoes-semana"
              v-model.number="plano.fracoesPorSemana"
              type="number"
              min="1"
              max="14"
            />
          </div>
          <p class="dica" data-testid="onco-dose-total">{{ k('doseTotal') }}: {{ doseTotal }}</p>
          <SanteCampoTexto v-model="plano.energia" :rotulo="k('energia')" :max-bytes="30" />
          <ul v-if="errosPlano.length" class="erros" data-testid="onco-erros-plano">
            <li v-for="m in errosPlano" :key="m">{{ m }}</li>
          </ul>
          <SanteBotao
            tipo="submit"
            :rotulo="k('gravarPlano')"
            :desabilitado="ocupado || !plano.regiao || !plano.intencao || errosPlano.length > 0"
            data-testid="onco-gravar-plano"
          />
        </form>
        <section v-for="p in planosDo(x.id)" :key="p.id" class="plano" :data-testid="`onco-plano-${p.id}`">
          <h3>
            {{ p.numero }} · {{ p.regiao }} · {{ t(`especialidades.registroOnco.tecnicas.${p.tecnica}`) }} ·
            <span :data-testid="`onco-plano-situacao-${p.id}`">{{
              t(`especialidades.registroOnco.situacoes.${p.situacao}`)
            }}</span>
          </h3>
          <progress :value="pct(p)" max="100" :aria-label="k('doseAplicada')" />
          <p :data-testid="`onco-plano-progresso-${p.id}`">
            {{
              t('especialidades.registroOnco.progresso', {
                r: p.realizadas,
                f: p.fracoesPrevistas,
                d: p.doseAcumuladaCgy,
                t: p.doseTotalCgy,
              })
            }}
          </p>
          <p v-if="p.motivoEncerramento">{{ k('motivo') }}: {{ p.motivoEncerramento }}</p>
          <div v-if="pode && !encerrado(p)" class="acoes">
            <template v-if="p.situacao === 'em_planejamento'">
              <SanteBotao
                variante="texto"
                :rotulo="k('aprovar')"
                :data-testid="`onco-aprovar-${p.id}`"
                @click="aprovando = p.id"
              />
              <form
                v-if="aprovando === p.id"
                @submit.prevent="
                  gravar(
                    () =>
                      aprovarPlanoRt(
                        reg,
                        p.id,
                        { fisico, versao: p.versao },
                        novaChaveEspecialidade('aprovar-rt'),
                      ),
                    () => (aprovando = null),
                  )
                "
              >
                <div class="campo">
                  <label :for="`onco-fisico-${p.id}`">{{ k('fisico') }}</label>
                  <input
                    :id="`onco-fisico-${p.id}`"
                    v-model.number="fisico"
                    type="number"
                    min="1"
                    data-testid="onco-fisico"
                  />
                </div>
                <SanteBotao
                  tipo="submit"
                  :rotulo="k('confirmar')"
                  :desabilitado="ocupado || !fisico"
                  data-testid="onco-confirmar-aprovacao"
                />
              </form>
            </template>
            <SanteBotao
              v-if="ativo(p)"
              :rotulo="k('sessao')"
              :data-testid="`onco-sessao-${p.id}`"
              @click="abrirSessao(p)"
            />
            <SanteBotao
              variante="texto"
              :rotulo="k('encerrar')"
              :data-testid="`onco-encerrar-${p.id}`"
              @click="encerrando[p.id] = { situacao: 'interrompido', motivo: '' }"
            />
          </div>
          <form v-if="sessaoDe[p.id]" class="grade" @submit.prevent="gravarSessao(p)">
            <SanteSelecao
              v-model="sessaoDe[p.id]!.desfecho"
              :rotulo="k('desfecho')"
              :opcoes="opcoes(DESFECHOS_SESSAO_RT, 'desfechos')"
              data-testid="onco-desfecho"
            />
            <div v-if="sessaoDe[p.id]!.desfecho === 'realizada'" class="campo">
              <label :for="`onco-dose-${p.id}`">{{ k('doseAplicada') }}</label>
              <input
                :id="`onco-dose-${p.id}`"
                v-model.number="sessaoDe[p.id]!.dose"
                type="number"
                min="0"
                data-testid="onco-dose-aplicada"
              />
            </div>
            <SanteCampoTexto
              v-else
              v-model="sessaoDe[p.id]!.motivo"
              :rotulo="k('motivo')"
              :max-bytes="500"
              data-testid="onco-motivo-sessao"
            />
            <SanteBotao
              tipo="submit"
              :rotulo="k('confirmar')"
              :desabilitado="
                ocupado ||
                (sessaoDe[p.id]!.desfecho === 'realizada'
                  ? !sessaoDe[p.id]!.dose
                  : !sessaoDe[p.id]!.motivo.trim())
              "
              data-testid="onco-confirmar-sessao"
            />
          </form>
          <form
            v-if="encerrando[p.id]"
            class="grade"
            @submit.prevent="
              gravar(
                () =>
                  encerrarPlanoRt(
                    reg,
                    p.id,
                    { ...encerrando[p.id], versao: p.versao },
                    novaChaveEspecialidade('encerrar-rt'),
                  ),
                () => delete encerrando[p.id],
              )
            "
          >
            <SanteSelecao
              v-model="encerrando[p.id]!.situacao"
              :rotulo="k('encerramento')"
              :opcoes="opcoes(['interrompido', 'cancelado'], 'encerramentos')"
            />
            <SanteCampoTexto
              v-model="encerrando[p.id]!.motivo"
              :rotulo="k('motivo')"
              :max-bytes="1000"
              data-testid="onco-motivo-encerramento"
            />
            <SanteBotao
              tipo="submit"
              :rotulo="k('confirmar')"
              :desabilitado="ocupado || !encerrando[p.id]!.motivo.trim()"
            />
          </form>
          <ol class="sessoes">
            <li v-for="s in p.sessoes" :key="s.sequencia">
              #{{ s.sequencia }} · {{ t(`especialidades.registroOnco.situacoes.${s.situacao}`) }}
              {{ s.realizadaEm ?? '' }} {{ s.doseAplicadaCgy !== null ? `· ${s.doseAplicadaCgy} cGy` : '' }}
              {{ s.motivo ? `· ${s.motivo}` : '' }}
            </li>
          </ol>
        </section>
      </article>
      <p v-if="(dados.data.value.planos ?? []).length === 0 && dados.data.value.tumores.length > 0">
        {{ k('nenhumPlano') }}
      </p>

      <SanteBotao
        v-if="pode && !novoTumor"
        :rotulo="k('novoTumor')"
        data-testid="onco-novo-tumor"
        @click="novoTumor = true"
      />
      <form v-if="novoTumor" class="grade" data-testid="onco-form-tumor" @submit.prevent="gravarTumor">
        <h3>{{ k('novoTumor') }}</h3>
        <div v-for="c in ['cid', 'topografia', 'morfologia'] as const" :key="c" class="campo busca">
          <SanteCampoTexto
            v-model="busca[c]"
            :rotulo="k(c)"
            :max-bytes="100"
            :placeholder="k('buscar')"
            :data-testid="`onco-busca-${c}`"
            @update:model-value="buscar(c)"
          />
          <ul v-if="achados[c].length" class="sugestoes" role="listbox">
            <li v-for="i in achados[c]" :key="i.codigo">
              <button type="button" :data-testid="`onco-escolher-${c}-${i.codigo}`" @click="escolher(c, i)">
                {{ i.codigo }} {{ i.descricao }}
              </button>
            </li>
          </ul>
          <small v-if="tumor[c]">{{ tumor[c] }}</small>
        </div>
        <SanteData
          v-model="tumor.diagnosticadoEm"
          :rotulo="k('diagnosticadoEm')"
          editavel
          data-testid="onco-diagnosticado-em"
        />
        <SanteSelecao
          v-model="tumor.baseDiagnostica"
          :rotulo="k('base')"
          :opcoes="opcoes(BASES_DIAGNOSTICO, 'bases')"
          data-testid="onco-base"
        />
        <SanteSelecao
          v-model="tumor.lateralidade"
          :rotulo="k('lateralidade')"
          :opcoes="opcoes(LATERALIDADES_TUMOR, 'lateralidades')"
          data-testid="onco-lateralidade"
        />
        <div class="campo">
          <label for="onco-ecog">{{ k('ecog') }}</label>
          <input
            id="onco-ecog"
            v-model.number="tumor.ecog"
            type="number"
            min="0"
            max="5"
            data-testid="onco-ecog"
          />
        </div>
        <ul v-if="errosTumor.length" class="erros" data-testid="onco-erros-tumor">
          <li v-for="m in errosTumor" :key="m">{{ m }}</li>
        </ul>
        <SanteBotao
          tipo="submit"
          :rotulo="k('gravarTumor')"
          :desabilitado="ocupado || !podeGravarTumor"
          data-testid="onco-gravar-tumor"
        />
        <SanteBotao variante="texto" :rotulo="k('cancelar')" @click="novoTumor = false" />
      </form>
    </template>
  </section>
</template>

<style scoped>
.cartao-tumor {
  border: 1px solid var(--sgh-borda);
  padding: var(--sgh-espaco-3);
  margin-block: var(--sgh-espaco-3);
}
.selo {
  margin-inline-start: var(--sgh-espaco-2);
  font-weight: 600;
}
.grade {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
  gap: var(--sgh-espaco-2);
  margin-block: var(--sgh-espaco-3);
}
.grade h3 {
  grid-column: 1 / -1;
}
.erros {
  grid-column: 1 / -1;
  color: var(--sgh-alerta);
}
.acoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
}
.sugestoes button {
  background: none;
  border: none;
  text-align: start;
  cursor: pointer;
}
progress {
  inline-size: 100%;
}
</style>
