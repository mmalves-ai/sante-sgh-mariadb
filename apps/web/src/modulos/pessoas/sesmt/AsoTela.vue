<script setup lang="ts">
// ASO e exames ocupacionais (M52.5; item `Gestão de pessoas > SESMT > ASO e exames ocupacionais`;
// `pessoas.ocupacional.ler` / `.registrar`; regras 16 e 17): o painel das pendências do SESMT (ASO, vacinas obrigatórias,
// EPI, CAT e sorologia dos ativos), o prontuário ocupacional do colaborador (situação do ASO, os ASO com os exames, o
// retificado riscado e nunca apagado) e o registro do ASO com os exames do PCMSO e a retificação com motivo. Dado de
// saúde: cada abertura do prontuário fica na trilha (servidor).
import {
  CODIGOS_PENDENCIA_SESMT,
  type ColaboradorSesmt,
  esquemaRegistrarAso,
  PENDENCIAS_SESMT,
  type PendenciaSesmt,
  RESULTADOS_EXAME_OCUPACIONAL,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import ErroPessoas from '../componentes/ErroPessoas.vue';
import { dataBr, opcoesDe, semVinculo } from '../comum.js';
import { lerApoioSesmt, lerPainelSesmt, lerProntuario, registrarAso } from './api-sesmt.js';
import PendenciasSesmt from './PendenciasSesmt.vue';
import SeletorColaborador from './SeletorColaborador.vue';

const ITEM = 'gestao-de-pessoas.sesmt.aso-e-exames-ocupacionais';
const { t } = useI18n();
const cliente = useQueryClient();
const apoio = useQuery({ queryKey: ['sesmt', 'apoio', 'aso'], queryFn: () => lerApoioSesmt('aso') });
const a = computed(() => apoio.data.value ?? null);

// ── Painel ──────────────────────────────────────────────────────────────────────────────────────────────────
const termo = ref('');
const pendencia = ref<PendenciaSesmt | null>(null);
const somentePendentes = ref(true);
const filtro = ref({
  termo: '',
  pendencia: null as PendenciaSesmt | null,
  somentePendentes: true,
  pagina: 0,
});
const painel = useQuery({
  queryKey: computed(() => ['sesmt', 'painel', filtro.value]),
  queryFn: () =>
    lerPainelSesmt({
      ...(filtro.value.termo ? { termo: filtro.value.termo } : {}),
      ...(filtro.value.pendencia ? { pendencia: filtro.value.pendencia } : {}),
      somentePendentes: filtro.value.somentePendentes,
      pagina: filtro.value.pagina,
      limite: 50,
    }),
});
function filtrar(): void {
  filtro.value = {
    termo: termo.value.trim(),
    pendencia: pendencia.value,
    somentePendentes: somentePendentes.value,
    pagina: 0,
  };
}
const opcoesPendencia = computed(() => [
  { valor: null, rotulo: t('sesmt.todos') },
  ...CODIGOS_PENDENCIA_SESMT.map((c) => ({ valor: c, rotulo: PENDENCIAS_SESMT[c] })),
]);

// ── Colaborador e prontuário ────────────────────────────────────────────────────────────────────────────────
const colaborador = ref<ColaboradorSesmt | null>(null);
const vinculo = computed(() => colaborador.value?.vinculo ?? null);
const prontuario = useQuery({
  queryKey: computed(() => ['sesmt', 'aso', vinculo.value]),
  queryFn: () => lerProntuario(vinculo.value!),
  enabled: computed(() => vinculo.value !== null),
});
const p = computed(() => prontuario.data.value ?? null);
function abrir(c: ColaboradorSesmt): void {
  colaborador.value = c;
}
const situacaoTexto = computed(() => {
  const s = p.value?.aso;
  if (!s) return '';
  const chave = {
    valido: 'valido',
    'a-vencer': 'aVencer',
    vencido: 'vencido',
    'sem-aso': 'semAso',
    encerrado: 'encerrado',
  }[s.situacao];
  const base = t(`sesmt.aso.situacao.${chave}`);
  if (s.proximo === null || s.diasParaVencer === null) return base;
  return `${base}: ${
    s.diasParaVencer < 0
      ? t('sesmt.aso.vencidoHa', { d: dataBr(s.proximo), n: -s.diasParaVencer })
      : t('sesmt.aso.vencimento', { d: dataBr(s.proximo), n: s.diasParaVencer })
  }`;
});

// ── Registro do ASO ─────────────────────────────────────────────────────────────────────────────────────────
const registrando = ref(false);
const retifica = ref<number | null>(null);
const tipo = ref<number | null>(null);
const data = ref<string | null>(null);
const conclusao = ref<number | null>(null);
const restricoes = ref('');
const medico = ref('');
const medicoConselho = ref('');
const proximo = ref<string | null>(null);
const observacao = ref('');
const motivoRetificacao = ref('');
interface ExameForm {
  exame: string;
  data: string | null;
  resultado: 'normal' | 'alterado' | null;
}
const exames = ref<ExameForm[]>([]);
const erro = ref<unknown>(null);
const aviso = ref<string | null>(null);
const opcoesTipo = computed(() =>
  (a.value?.dominios.tiposAso ?? []).map((x) => ({ valor: x.codigo, rotulo: x.rotulo })),
);
const opcoesConclusao = computed(() =>
  (a.value?.dominios.conclusoesAso ?? []).map((x) => ({ valor: x.codigo, rotulo: x.rotulo })),
);
const opcoesResultado = opcoesDe(RESULTADOS_EXAME_OCUPACIONAL);
function novo(id: number | null = null): void {
  registrando.value = true;
  retifica.value = id;
  const base = id !== null ? p.value?.asos.find((x) => x.id === id) : undefined;
  tipo.value = base?.tipo ?? null;
  data.value = base?.data ?? null;
  conclusao.value = base?.conclusao ?? null;
  restricoes.value = base?.restricoes ?? '';
  medico.value = base?.medico ?? '';
  medicoConselho.value = base?.medicoConselho ?? '';
  proximo.value = null;
  observacao.value = base?.observacao ?? '';
  motivoRetificacao.value = '';
  exames.value = (base?.exames ?? []).map((x) => ({ exame: x.exame, data: x.data, resultado: x.resultado }));
  erro.value = null;
}
watch(vinculo, () => {
  registrando.value = false;
  aviso.value = null;
});
const entrada = computed(() =>
  esquemaRegistrarAso.safeParse({
    vinculo: vinculo.value ?? 0,
    tipo: tipo.value ?? -1,
    data: data.value ?? '',
    conclusao: conclusao.value ?? -1,
    restricoes: restricoes.value.trim() || null,
    medico: medico.value.trim(),
    medicoConselho: medicoConselho.value.trim() || null,
    proximo: proximo.value,
    observacao: observacao.value.trim() || null,
    exames: exames.value.map((x) => ({
      exame: x.exame.trim(),
      data: x.data ?? '',
      resultado: x.resultado ?? '',
    })),
    retifica: retifica.value,
    motivoRetificacao: retifica.value !== null ? motivoRetificacao.value.trim() || null : null,
  }),
);
async function gravar(): Promise<void> {
  if (!entrada.value.success || vinculo.value === null) return;
  erro.value = null;
  try {
    const r = await registrarAso(vinculo.value, semVinculo(entrada.value.data));
    registrando.value = false;
    aviso.value = r.mensagem;
    await cliente.invalidateQueries({ queryKey: ['sesmt'] });
  } catch (x) {
    erro.value = x;
  }
}
</script>

<template>
  <section class="tela-pessoas" aria-labelledby="sesmt-aso-titulo" data-testid="tela-sesmt-aso">
    <h1 id="sesmt-aso-titulo">{{ t('sesmt.aso.titulo') }}</h1>
    <p>{{ t('sesmt.aso.subtitulo') }}</p>
    <ErroPessoas v-if="apoio.isError.value" :erro="apoio.error.value" />
    <p v-else-if="!a" role="status">{{ t('sesmt.carregando') }}</p>
    <template v-else>
      <SanteAlerta
        v-if="!a.gravacao.ligada"
        :texto="a.gravacao.motivo ?? ''"
        variante="info"
        data-testid="sesmt-gravacao-desligada"
      />
      <SanteAlerta
        v-else-if="!a.acoes.ocupacional"
        :texto="t('sesmt.soConsulta')"
        variante="info"
        data-testid="sesmt-so-consulta"
      />

      <section class="bloco" aria-labelledby="sesmt-painel-titulo" data-testid="painel-sesmt">
        <h2 id="sesmt-painel-titulo">{{ t('sesmt.aso.painel') }}</h2>
        <p class="secundario">{{ t('sesmt.aso.painelAjuda') }}</p>
        <form class="campos" @submit.prevent="filtrar">
          <SanteCampoTexto
            v-model="termo"
            :rotulo="t('sesmt.colaborador.buscar')"
            :max-bytes="70"
            data-testid="painel-termo"
          />
          <SanteSelecao
            v-model="pendencia"
            :rotulo="t('sesmt.aso.pendencia')"
            :opcoes="opcoesPendencia"
            busca
            data-testid="painel-pendencia"
          />
          <label class="marca"
            ><input v-model="somentePendentes" type="checkbox" data-testid="painel-somente-pendentes" />{{
              t('sesmt.aso.somentePendentes')
            }}</label
          >
          <SanteBotao
            :rotulo="t('sesmt.buscar')"
            tipo="submit"
            variante="secundario"
            data-testid="painel-filtrar"
          />
        </form>
        <ErroPessoas v-if="painel.isError.value" :erro="painel.error.value" />
        <p v-else-if="!painel.data.value" role="status">{{ t('sesmt.carregando') }}</p>
        <template v-else>
          <p class="secundario" data-testid="painel-contagem">
            {{ t('sesmt.aso.ativos', { n: painel.data.value.ativos, p: painel.data.value.total }) }}
          </p>
          <p v-if="painel.data.value.itens.length === 0">{{ t('sesmt.nenhum') }}</p>
          <table v-else class="tabela" data-testid="tabela-painel">
            <thead>
              <tr>
                <th scope="col">{{ t('sesmt.colaborador.titulo') }}</th>
                <th scope="col">{{ t('sesmt.colaborador.cargo') }}</th>
                <th scope="col">{{ t('sesmt.aso.proximo') }}</th>
                <th scope="col">{{ t('sesmt.pendencias') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="l in painel.data.value.itens" :key="l.vinculo" :data-testid="`painel-${l.vinculo}`">
                <th scope="row">
                  <SanteBotao
                    :rotulo="l.nome"
                    variante="texto"
                    :data-testid="`painel-abrir-${l.vinculo}`"
                    @acionar="abrir(l)"
                  />
                </th>
                <td>{{ l.cargo }}</td>
                <td>{{ dataBr(l.proximoAso) }}</td>
                <td><PendenciasSesmt :pendencias="l.pendencias" /></td>
              </tr>
            </tbody>
          </table>
          <div class="acoes">
            <SanteBotao
              v-if="painel.data.value.pagina > 0"
              :rotulo="t('pessoas.anterior')"
              variante="texto"
              @acionar="filtro = { ...filtro, pagina: filtro.pagina - 1 }"
            />
            <SanteBotao
              v-if="painel.data.value.pagina + 1 < painel.data.value.paginas"
              :rotulo="t('pessoas.proxima')"
              variante="texto"
              @acionar="filtro = { ...filtro, pagina: filtro.pagina + 1 }"
            />
          </div>
        </template>
      </section>

      <SeletorColaborador v-model="colaborador" tela="aso" />

      <template v-if="colaborador">
        <SanteAlerta :texto="t('sesmt.leituraAuditada')" variante="info" />
        <ErroPessoas v-if="prontuario.isError.value" :erro="prontuario.error.value" />
        <p v-else-if="!p" role="status">{{ t('sesmt.carregando') }}</p>
        <template v-else>
          <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="sesmt-aviso" />
          <section
            class="bloco"
            aria-labelledby="sesmt-prontuario-titulo"
            data-testid="prontuario-ocupacional"
          >
            <h2 id="sesmt-prontuario-titulo">{{ t('sesmt.aso.historico') }}</h2>
            <p data-testid="situacao-aso">{{ situacaoTexto }}</p>
            <PendenciasSesmt :pendencias="p.pendencias" />
            <p class="secundario">{{ p.pedidoExame.motivo }}</p>
            <p v-if="p.asos.length === 0">{{ t('sesmt.nenhum') }}</p>
            <table v-else class="tabela" data-testid="tabela-asos">
              <thead>
                <tr>
                  <th scope="col">{{ t('sesmt.aso.colunas.data') }}</th>
                  <th scope="col">{{ t('sesmt.aso.colunas.tipo') }}</th>
                  <th scope="col">{{ t('sesmt.aso.colunas.conclusao') }}</th>
                  <th scope="col">{{ t('sesmt.aso.colunas.proximo') }}</th>
                  <th scope="col">{{ t('sesmt.aso.colunas.medico') }}</th>
                  <th scope="col">{{ t('sesmt.aso.colunas.exames') }}</th>
                  <th scope="col"><span class="secundario">—</span></th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="x in p.asos"
                  :key="x.id"
                  :class="{ retificado: x.retificadoPor !== null }"
                  :data-testid="`aso-${x.id}`"
                >
                  <td>{{ dataBr(x.data) }}</td>
                  <td>{{ x.tipoRotulo }}</td>
                  <td>
                    {{ x.conclusaoRotulo }}
                    <span v-if="x.restricoes" class="secundario">{{ x.restricoes }}</span>
                  </td>
                  <td>{{ dataBr(x.proximo) }}</td>
                  <td>{{ x.medico }}</td>
                  <td>
                    <span v-if="x.exames.length === 0" class="secundario">{{
                      t('sesmt.aso.semExames')
                    }}</span>
                    <ul v-else class="sem-marca">
                      <li v-for="e in x.exames" :key="e.id">
                        {{ e.exame }} ({{ dataBr(e.data) }}): {{ RESULTADOS_EXAME_OCUPACIONAL[e.resultado] }}
                      </li>
                    </ul>
                  </td>
                  <td>
                    <span v-if="x.retificadoPor !== null" class="secundario">{{
                      t('sesmt.retificado', { id: x.retificadoPor })
                    }}</span>
                    <span v-else-if="x.retifica !== null" class="secundario">{{
                      t('sesmt.retifica', { id: x.retifica })
                    }}</span>
                    <SanteBotao
                      v-if="a.acoes.ocupacional && x.retificadoPor === null"
                      :rotulo="t('sesmt.retificar')"
                      variante="texto"
                      :data-testid="`retificar-aso-${x.id}`"
                      @acionar="novo(x.id)"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
            <div class="acoes">
              <SanteBotao
                v-if="a.acoes.ocupacional && !registrando"
                :rotulo="t('sesmt.aso.novo')"
                data-testid="novo-aso"
                @acionar="novo()"
              />
            </div>
          </section>

          <form
            v-if="registrando"
            class="bloco"
            :aria-label="
              retifica !== null ? t('sesmt.aso.retificando', { id: retifica }) : t('sesmt.aso.novo')
            "
            data-testid="form-aso"
            @submit.prevent="gravar"
          >
            <h2>
              {{ retifica !== null ? t('sesmt.aso.retificando', { id: retifica }) : t('sesmt.aso.novo') }}
            </h2>
            <SanteAlerta v-if="retifica !== null" :texto="t('sesmt.retificacaoAviso')" variante="info" />
            <div class="campos">
              <SanteSelecao
                v-model="tipo"
                :rotulo="t('sesmt.aso.tipo')"
                :opcoes="opcoesTipo"
                obrigatorio
                data-testid="aso-tipo"
              />
              <SanteData v-model="data" :rotulo="t('sesmt.data')" editavel data-testid="aso-data" />
              <SanteSelecao
                v-model="conclusao"
                :rotulo="t('sesmt.aso.conclusao')"
                :opcoes="opcoesConclusao"
                obrigatorio
                data-testid="aso-conclusao"
              />
              <SanteCampoTexto
                v-model="medico"
                :rotulo="t('sesmt.aso.medico')"
                :max-bytes="70"
                obrigatorio
                data-testid="aso-medico"
              />
              <SanteCampoTexto
                v-model="medicoConselho"
                :rotulo="t('sesmt.aso.medicoConselho')"
                :max-bytes="20"
                data-testid="aso-medico-conselho"
              />
              <SanteData
                v-model="proximo"
                :rotulo="t('sesmt.aso.proximoInformado')"
                editavel
                data-testid="aso-proximo"
              />
            </div>
            <p class="secundario">
              {{ t('sesmt.aso.proximoAjuda', { m: a.parametros.periodicidadeAsoMeses }) }}
            </p>
            <SanteCampoTexto
              v-model="restricoes"
              :rotulo="t('sesmt.aso.restricoes')"
              :max-bytes="400"
              multilinha
              data-testid="aso-restricoes"
            />
            <p class="secundario">{{ t('sesmt.aso.restricoesAjuda') }}</p>
            <SanteCampoTexto
              v-model="observacao"
              :rotulo="t('sesmt.observacao')"
              :max-bytes="400"
              multilinha
              data-testid="aso-observacao"
            />
            <fieldset class="bloco">
              <legend>{{ t('sesmt.aso.exames') }}</legend>
              <div v-for="(x, i) in exames" :key="i" class="campos" :data-testid="`aso-exame-${i}`">
                <SanteCampoTexto
                  v-model="x.exame"
                  :rotulo="t('sesmt.aso.exame')"
                  :max-bytes="80"
                  :data-testid="`aso-exame-nome-${i}`"
                />
                <SanteData
                  v-model="x.data"
                  :rotulo="t('sesmt.data')"
                  editavel
                  :data-testid="`aso-exame-data-${i}`"
                />
                <SanteSelecao
                  v-model="x.resultado"
                  :rotulo="t('sesmt.aso.resultado')"
                  :opcoes="opcoesResultado"
                  :data-testid="`aso-exame-resultado-${i}`"
                />
                <SanteBotao
                  :rotulo="t('sesmt.aso.removerExame')"
                  variante="texto"
                  @acionar="exames.splice(i, 1)"
                />
              </div>
              <SanteBotao
                :rotulo="t('sesmt.aso.incluirExame')"
                variante="secundario"
                data-testid="aso-incluir-exame"
                @acionar="exames.push({ exame: '', data: null, resultado: null })"
              />
            </fieldset>
            <template v-if="retifica !== null">
              <SanteCampoTexto
                v-model="motivoRetificacao"
                :rotulo="t('sesmt.motivoRetificacao')"
                :max-bytes="400"
                data-testid="aso-motivo-retificacao"
              />
              <p class="secundario">{{ t('sesmt.motivoAjuda') }}</p>
            </template>
            <ErroPessoas v-if="erro" :erro="erro" />
            <div class="acoes">
              <SanteBotao :rotulo="t('sesmt.cancelar')" variante="texto" @acionar="registrando = false" />
              <SanteBotao
                :rotulo="t('sesmt.gravar')"
                tipo="submit"
                :desabilitado="!entrada.success"
                data-testid="aso-gravar"
              />
            </div>
          </form>
        </template>
      </template>
    </template>
    <p>
      <RouterLink :to="`/consultas/item/${ITEM}`" data-testid="sesmt-outras-tabelas">{{
        t('pessoas.colaboradores.outrasTabelas')
      }}</RouterLink>
    </p>
  </section>
</template>

<style scoped src="../estilo-pessoas.css"></style>
<style scoped>
.retificado td {
  text-decoration: line-through;
  color: var(--p-text-muted-color);
}
.retificado td:last-child {
  text-decoration: none;
}
.sem-marca {
  margin: 0;
  padding-left: 1rem;
}
</style>
