<script setup lang="ts">
// Regimes e banco de horas (M52.2; item `Gestão de pessoas > Programação de escala e banco de horas`;
// `pessoas.regime.ler`): os modelos de regime e jornada do estabelecimento (sigla, tipo de jornada e tempo parcial dos
// domínios do RH, duração do plantão, descanso mínimo, limite semanal e o acordo que autoriza a exceção da
// interjornada; regras 5 e 6), a inclusão e a alteração (`pessoas.regime.editar`), o regime de cada colaborador com a
// vigência (só inclusão) e os domínios do item embutidos (CRUD genérico: horários, horas, banco de horas).
import type { RegimeLido } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import GrupoDominiosTela from '../../config/telas/GrupoDominiosTela.vue';
import {
  alterarRegime,
  anularVigencia,
  atribuirRegime,
  incluirRegime,
  lerApoioRegimes,
  lerColaboradoresEscala,
  lerVigencias,
} from '../api-escala.js';
import { dataBr } from '../comum.js';
import { horasTexto, inteiroDe } from '../escala-comum.js';
import DialogoMotivo from '../componentes/DialogoMotivo.vue';
import ErroPessoas from '../componentes/ErroPessoas.vue';
import RegraBancoRegime from '../ponto/RegraBancoRegime.vue';

const ITEM = 'gestao-de-pessoas.programacao-de-escala-e-banco-de-horas';
const { t } = useI18n();
const qc = useQueryClient();
const apoio = useQuery({ queryKey: ['pessoas', 'regimes', 'apoio'], queryFn: lerApoioRegimes });
const a = computed(() => apoio.data.value ?? null);
const pode = computed(() => a.value?.acoes.editarRegime ?? false);
// W0-06: a vigência lançada por engano se anula com motivo (fica no histórico; o servidor recusa se o ponto fechado a usou).
const dialogoAnular = ref(false);
const anulando = ref<number | null>(null);
function pedirAnulacao(vigencia: number): void {
  anulando.value = vigencia;
  dialogoAnular.value = true;
}
const anular = (motivo: string) => anularVigencia(anulando.value!, motivo);
async function aposAnular(): Promise<void> {
  await qc.invalidateQueries({ queryKey: ['pessoas', 'regimes'] });
  await qc.invalidateQueries({ queryKey: ['pessoas', 'escala'] });
}

const resultado = ref<string | null>(null);
const erro = ref<unknown>(null);
const aviso = ref<string | null>(null);
const ocupado = ref(false);
async function gravar(fn: () => Promise<{ mensagem: string }>): Promise<boolean> {
  erro.value = null;
  resultado.value = null;
  ocupado.value = true;
  try {
    resultado.value = (await fn()).mensagem;
    await qc.invalidateQueries({ queryKey: ['pessoas', 'regimes'] });
    await qc.invalidateQueries({ queryKey: ['pessoas', 'escala'] });
    return true;
  } catch (e) {
    erro.value = e;
    return false;
  } finally {
    ocupado.value = false;
  }
}

// ── Formulário do regime ──
interface Form {
  id: number | null;
  versao: number;
  codigo: string;
  nome: string;
  jornada: number | null;
  contratoParcial: number;
  folgaPadrao: number | null;
  plantaoHoras: string;
  descansoHoras: string;
  limite: string;
  acordo: string;
  ativo: boolean;
}
const vazio = (): Form => ({
  id: null,
  versao: 0,
  codigo: '',
  nome: '',
  jornada: null,
  contratoParcial: 0,
  folgaPadrao: null,
  plantaoHoras: '12',
  descansoHoras: '11',
  limite: '44',
  acordo: '',
  ativo: true,
});
const form = ref<Form>(vazio());
function editar(r: RegimeLido): void {
  form.value = {
    id: r.id,
    versao: r.versao,
    codigo: r.codigo,
    nome: r.nome,
    jornada: r.jornada,
    contratoParcial: r.contratoParcial,
    folgaPadrao: r.folgaPadrao,
    plantaoHoras: String(r.minutosPlantao / 60),
    descansoHoras: String(r.descansoMinimoMin / 60),
    limite: String(r.limiteSemanalHoras),
    acordo: r.acordo ?? '',
    ativo: r.ativo,
  };
}
const opcoesJornada = computed(() =>
  (a.value?.jornadas ?? []).map((x) => ({ valor: x.codigo, rotulo: x.rotulo })),
);
const opcoesParcial = computed(() =>
  (a.value?.temposParciais ?? []).map((x) => ({ valor: x.codigo, rotulo: x.rotulo })),
);
const opcoesFolga = computed(() => [
  { valor: null, rotulo: t('pessoas.regimes.form.semFolga') },
  ...(a.value?.folgas ?? []).map((x) => ({ valor: x.codigo, rotulo: x.rotulo })),
]);
const opcoesAtivo = computed(() => [
  { valor: 'T', rotulo: t('pessoas.sim') },
  { valor: 'F', rotulo: t('pessoas.nao') },
]);
const ativoTexto = computed({
  get: () => (form.value.ativo ? 'T' : 'F'),
  set: (v: string | number | null) => {
    form.value.ativo = v === 'T';
  },
});
async function gravarRegime(): Promise<void> {
  aviso.value = null;
  const f = form.value;
  const plantao = inteiroDe(f.plantaoHoras);
  const descanso = inteiroDe(f.descansoHoras);
  const limite = inteiroDe(f.limite);
  if (plantao === null || descanso === null || limite === null || f.jornada === null)
    return void (aviso.value = t('pessoas.regimes.form.numeroInvalido'));
  const campos = {
    codigo: f.codigo.trim(),
    nome: f.nome.trim(),
    jornada: f.jornada,
    contratoParcial: f.contratoParcial,
    folgaPadrao: f.folgaPadrao,
    minutosPlantao: plantao * 60,
    descansoMinimoMin: descanso * 60,
    limiteSemanalHoras: limite,
    acordo: f.acordo.trim() || null,
    ativo: f.ativo,
  };
  const ok = await gravar(() =>
    f.id === null ? incluirRegime(campos) : alterarRegime({ ...campos, id: f.id, versao: f.versao }),
  );
  if (ok) form.value = vazio();
}

// ── Regime do colaborador ──
const termo = ref('');
const termoBuscado = ref('');
const colaboradores = useQuery({
  queryKey: computed(() => ['pessoas', 'regimes', 'colaboradores', termoBuscado.value]),
  queryFn: () => lerColaboradoresEscala(termoBuscado.value, 'regimes'),
});
const vinculo = ref<number | null>(null);
const regime = ref<number | null>(null);
const desde = ref<string | null>(null);
const opcoesColaborador = computed(() =>
  (colaboradores.data.value?.itens ?? []).map((c) => ({
    valor: c.vinculo,
    rotulo: [
      c.nome,
      c.matricula,
      c.cargo,
      c.regime ? `${c.regime.codigo} desde ${dataBr(c.regime.desde)}` : null,
    ]
      .filter(Boolean)
      .join(' · '),
  })),
);
const opcoesRegime = computed(() =>
  (a.value?.regimes ?? [])
    .filter((r) => r.ativo)
    .map((r) => ({ valor: r.id, rotulo: `${r.codigo} · ${r.nome}` })),
);
const vigencias = useQuery({
  queryKey: computed(() => ['pessoas', 'regimes', 'vigencias', vinculo.value]),
  queryFn: () => lerVigencias(vinculo.value!),
  enabled: computed(() => vinculo.value !== null),
});
async function atribuir(): Promise<void> {
  aviso.value = null;
  if (vinculo.value === null || regime.value === null || !desde.value)
    return void (aviso.value = t('pessoas.regimes.atribuir.escolha'));
  await gravar(() => atribuirRegime({ vinculo: vinculo.value!, regime: regime.value!, desde: desde.value! }));
}
</script>

<template>
  <section class="tela-pessoas" aria-labelledby="pes-regimes-titulo" data-testid="tela-regimes">
    <h1 id="pes-regimes-titulo">{{ t('pessoas.regimes.titulo') }}</h1>
    <p>{{ t('pessoas.regimes.subtitulo') }}</p>
    <ErroPessoas v-if="apoio.isError.value" :erro="apoio.error.value" />
    <p v-else-if="!a" role="status">{{ t('pessoas.carregando') }}</p>
    <template v-else>
      <SanteAlerta
        v-if="!a.gravacao.ligada"
        :texto="a.gravacao.motivo ?? t('pessoas.escala.gravacaoDesligada')"
        variante="info"
        data-testid="regimes-gravacao-desligada"
      />
      <div role="status" aria-live="polite">
        <SanteAlerta v-if="resultado" :texto="resultado" variante="info" data-testid="regimes-resultado" />
      </div>
      <ErroPessoas v-if="erro" :erro="erro" />
      <SanteAlerta v-if="aviso" :texto="aviso" variante="aviso" anunciar />

      <p v-if="a.regimes.length === 0" data-testid="regimes-vazio">{{ t('pessoas.regimes.vazio') }}</p>
      <table v-else class="tabela" data-testid="tabela-regimes">
        <thead>
          <tr>
            <th scope="col">{{ t('pessoas.regimes.colunas.codigo') }}</th>
            <th scope="col">{{ t('pessoas.regimes.colunas.nome') }}</th>
            <th scope="col">{{ t('pessoas.regimes.colunas.jornada') }}</th>
            <th scope="col">{{ t('pessoas.regimes.colunas.parcial') }}</th>
            <th scope="col">{{ t('pessoas.regimes.colunas.plantao') }}</th>
            <th scope="col">{{ t('pessoas.regimes.colunas.descanso') }}</th>
            <th scope="col">{{ t('pessoas.regimes.colunas.limite') }}</th>
            <th scope="col">{{ t('pessoas.regimes.colunas.acordo') }}</th>
            <th scope="col">{{ t('pessoas.regimes.colunas.ativo') }}</th>
            <th v-if="pode" scope="col">{{ t('pessoas.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in a.regimes" :key="r.id" :data-testid="`regime-${r.codigo}`">
            <th scope="row">{{ r.codigo }}</th>
            <td>{{ r.nome }}</td>
            <td>{{ r.jornadaNome ?? r.jornada }}</td>
            <td>{{ r.contratoParcialNome ?? r.contratoParcial }}</td>
            <td>{{ horasTexto(r.minutosPlantao) }}</td>
            <td>{{ horasTexto(r.descansoMinimoMin) }}</td>
            <td>{{ horasTexto(r.limiteEfetivoHoras * 60) }}</td>
            <td>{{ r.acordo ?? '' }}</td>
            <td>{{ r.ativo ? t('pessoas.sim') : t('pessoas.nao') }}</td>
            <td v-if="pode">
              <SanteBotao
                :rotulo="t('pessoas.regimes.editarRegime', { codigo: r.codigo })"
                variante="texto"
                :data-testid="`editar-regime-${r.codigo}`"
                @acionar="editar(r)"
              />
            </td>
          </tr>
        </tbody>
      </table>

      <form
        v-if="pode"
        class="bloco"
        aria-labelledby="pes-regime-form"
        data-testid="form-regime"
        @submit.prevent="gravarRegime"
      >
        <h2 id="pes-regime-form">
          {{
            form.id === null ? t('pessoas.regimes.form.tituloNovo') : t('pessoas.regimes.form.tituloEdicao')
          }}
        </h2>
        <div class="campos">
          <SanteCampoTexto
            v-model="form.codigo"
            :rotulo="t('pessoas.regimes.form.codigo')"
            :max-bytes="20"
            obrigatorio
            data-testid="regime-codigo"
          />
          <SanteCampoTexto
            v-model="form.nome"
            :rotulo="t('pessoas.regimes.form.nome')"
            :max-bytes="60"
            obrigatorio
            data-testid="regime-nome"
          />
          <SanteSelecao
            v-model="form.jornada"
            :rotulo="t('pessoas.regimes.form.jornada')"
            :opcoes="opcoesJornada"
            obrigatorio
            data-testid="regime-jornada"
          />
          <SanteSelecao
            v-model="form.contratoParcial"
            :rotulo="t('pessoas.regimes.form.parcial')"
            :opcoes="opcoesParcial"
            data-testid="regime-parcial"
          />
          <SanteSelecao
            v-model="form.folgaPadrao"
            :rotulo="t('pessoas.regimes.form.folga')"
            :opcoes="opcoesFolga"
            data-testid="regime-folga"
          />
          <SanteCampoTexto
            v-model="form.plantaoHoras"
            :rotulo="t('pessoas.regimes.form.plantao')"
            :max-bytes="2"
            data-testid="regime-plantao"
          />
          <SanteCampoTexto
            v-model="form.descansoHoras"
            :rotulo="t('pessoas.regimes.form.descanso')"
            :max-bytes="2"
            data-testid="regime-descanso"
          />
          <SanteCampoTexto
            v-model="form.limite"
            :rotulo="t('pessoas.regimes.form.limite')"
            :max-bytes="2"
            data-testid="regime-limite"
          />
          <SanteSelecao
            v-model="ativoTexto"
            :rotulo="t('pessoas.regimes.form.ativo')"
            :opcoes="opcoesAtivo"
            data-testid="regime-ativo"
          />
        </div>
        <SanteCampoTexto
          v-model="form.acordo"
          :rotulo="t('pessoas.regimes.form.acordo')"
          :max-bytes="120"
          data-testid="regime-acordo"
        />
        <p class="secundario">{{ t('pessoas.regimes.form.acordoAjuda') }}</p>
        <div class="acoes">
          <SanteBotao
            :rotulo="t('pessoas.regimes.form.gravar')"
            tipo="submit"
            :desabilitado="ocupado"
            data-testid="gravar-regime"
          />
          <SanteBotao
            v-if="form.id !== null"
            :rotulo="t('pessoas.regimes.form.cancelarEdicao')"
            variante="texto"
            @acionar="form = vazio()"
          />
        </div>
      </form>

      <section class="bloco" aria-labelledby="pes-regime-atribuir" data-testid="bloco-atribuir-regime">
        <h2 id="pes-regime-atribuir">{{ t('pessoas.regimes.atribuir.titulo') }}</h2>
        <p class="secundario">{{ t('pessoas.regimes.atribuir.ajuda') }}</p>
        <div class="campos">
          <SanteCampoTexto
            v-model="termo"
            :rotulo="t('pessoas.plantao.buscar')"
            :max-bytes="70"
            data-testid="regime-buscar-colaborador"
          />
          <SanteBotao
            :rotulo="t('pessoas.plantao.buscarBotao')"
            variante="secundario"
            @acionar="termoBuscado = termo.trim()"
          />
          <SanteSelecao
            v-model="vinculo"
            :rotulo="t('pessoas.regimes.atribuir.colaborador')"
            :opcoes="opcoesColaborador"
            busca
            data-testid="regime-colaborador"
          />
          <template v-if="pode">
            <SanteSelecao
              v-model="regime"
              :rotulo="t('pessoas.regimes.atribuir.regime')"
              :opcoes="opcoesRegime"
              busca
              data-testid="regime-escolhido"
            />
            <SanteData
              v-model="desde"
              :rotulo="t('pessoas.regimes.atribuir.desde')"
              editavel
              data-testid="regime-desde"
            />
          </template>
        </div>
        <div v-if="pode" class="acoes">
          <SanteBotao
            :rotulo="t('pessoas.regimes.atribuir.registrar')"
            :desabilitado="ocupado"
            data-testid="atribuir-regime"
            @acionar="atribuir"
          />
        </div>
        <template v-if="vinculo !== null">
          <h3>{{ t('pessoas.regimes.atribuir.vigencias') }}</h3>
          <ErroPessoas v-if="vigencias.isError.value" :erro="vigencias.error.value" />
          <p v-else-if="(vigencias.data.value ?? []).length === 0" data-testid="sem-vigencia">
            {{ t('pessoas.regimes.atribuir.semVigencia') }}
          </p>
          <ul v-else data-testid="vigencias">
            <li
              v-for="v in vigencias.data.value"
              :key="v.id ?? v.desde"
              :class="{ anulada: !!v.anulada }"
              :data-testid="`vigencia-${v.id}`"
            >
              <span :class="{ riscado: !!v.anulada }"
                >{{ v.codigo }} · {{ dataBr(v.desde) }} · {{ v.por }}</span
              >
              <span v-if="v.anulada" class="secundario">
                ·
                {{
                  t('pessoas.crud.anulada', {
                    em: v.anulada.em.replace('T', ' '),
                    por: v.anulada.por,
                    motivo: v.anulada.motivo,
                  })
                }}
              </span>
              <SanteBotao
                v-else-if="pode && v.id"
                :rotulo="t('pessoas.crud.anular')"
                variante="texto"
                :data-testid="`anular-vigencia-${v.id}`"
                @acionar="pedirAnulacao(v.id)"
              />
            </li>
          </ul>
          <DialogoMotivo
            v-model:visivel="dialogoAnular"
            :titulo="t('pessoas.crud.anularTitulo')"
            :texto="t('pessoas.crud.anularTexto')"
            :confirmar="t('pessoas.crud.anular')"
            :acao="anular"
            testid="dialogo-anular-vigencia"
            @feito="aposAnular"
          />
        </template>
      </section>
    </template>

    <!-- M52.4: a regra do banco de horas de cada regime (o saldo é a soma dos movimentos, no espelho de ponto). -->
    <RegraBancoRegime v-if="a" :pode-editar="pode" />
    <GrupoDominiosTela subitem="rhProgramacaoEscalaBancoHoras" embutida />
    <p>
      <RouterLink :to="`/consultas/item/${ITEM}`" data-testid="regimes-outras-tabelas">{{
        t('pessoas.regimes.outrasTabelas')
      }}</RouterLink>
    </p>
  </section>
</template>

<style scoped src="../estilo-pessoas.css"></style>
