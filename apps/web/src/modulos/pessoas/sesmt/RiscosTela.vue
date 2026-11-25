<script setup lang="ts">
// Riscos ocupacionais, EPI/EPC e PPP (M52.5; item `Gestão de pessoas > SESMT > Riscos ocupacionais, EPI/EPC e PPP`;
// `pessoas.risco.ler` / `pessoas.risco.editar`, `pessoas.epi.entregar`; regra 19, NR-32 e NR-6): o mapa de riscos por
// função (fator de risco da tabela do eSocial com a busca, grupo, eficácia do EPC) e o EPI exigido, com a vigência
// encerrada e nunca apagada; o EPI do colaborador (o que a função exige, o que falta, as entregas com o CA e a
// assinatura conferida, o comprovante), a leitura do dosímetro com a dose do ano e as parcelas, e a exposição a
// quimioterápico; e os domínios do item embutidos (CRUD genérico).
import {
  type ColaboradorSesmt,
  type EpiDoColaborador,
  esquemaEncerrarLinhaRisco,
  esquemaLinhaRisco,
  esquemaRegistroEpi,
  type LinhaRiscoResposta,
  type OpcaoSesmtTexto,
  TIPOS_LINHA_RISCO,
  TIPOS_REGISTRO_EPI,
  type TipoLinhaRisco,
  type TipoRegistroEpi,
} from '@sgh/contratos';
import {
  SanteAlerta,
  SanteBotao,
  SanteCampoTexto,
  SanteData,
  SanteDialogo,
  SanteOpcoes,
  SanteSelecao,
} from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import GrupoDominiosTela from '../../config/telas/GrupoDominiosTela.vue';
import DialogoMotivo from '../componentes/DialogoMotivo.vue';
import ErroPessoas from '../componentes/ErroPessoas.vue';
import { dataBr, opcoesDe } from '../comum.js';
import {
  assinarEntrega,
  cancelarEntregaEpi,
  buscarFatores,
  encerrarLinhaRisco,
  incluirLinhaRisco,
  lerApoioSesmt,
  lerEpiDoColaborador,
  lerMapaRiscos,
  registrarEpi,
  urlComprovante,
  urlPpp,
} from './api-sesmt.js';
import HistoricoSesmt from './HistoricoSesmt.vue';
import PendenciasSesmt from './PendenciasSesmt.vue';
import SeletorColaborador from './SeletorColaborador.vue';

const { t } = useI18n();
const cliente = useQueryClient();
const apoio = useQuery({ queryKey: ['sesmt', 'apoio', 'riscos'], queryFn: () => lerApoioSesmt('riscos') });
const a = computed(() => apoio.data.value ?? null);
const aviso = ref<string | null>(null);
async function recarregar(msg: string): Promise<void> {
  aviso.value = msg;
  await cliente.invalidateQueries({ queryKey: ['sesmt'] });
}

// ── Mapa de riscos ──────────────────────────────────────────────────────────────────────────────────────────
const funcaoFiltro = ref('');
const vigentes = ref(true);
const filtro = ref({ funcao: '', vigentes: true });
const mapa = useQuery({
  queryKey: computed(() => ['sesmt', 'riscos', filtro.value]),
  queryFn: () => lerMapaRiscos(filtro.value.funcao, filtro.value.vigentes),
});
const descreverLinha = (l: LinhaRiscoResposta) =>
  l.tipo === 'risco'
    ? [l.fatorRisco, l.fatorRiscoRotulo, l.grupoRiscoRotulo, l.epcRotulo].filter(Boolean).join(' · ')
    : (l.epi ?? '');
const incluindo = ref(false);
const lFuncao = ref('');
const lUnidade = ref<number | null>(null);
const lSetor = ref('');
const lTipo = ref<TipoLinhaRisco>('risco');
const lFatorTermo = ref('');
const lFatores = ref<readonly OpcaoSesmtTexto[]>([]);
const lFator = ref<string | null>(null);
const lGrupo = ref<string | null>(null);
const lEpc = ref<number | null>(null);
const lEpi = ref('');
const lDescricao = ref('');
const lInicio = ref<string | null>(null);
const lErro = ref<unknown>(null);
const opcoesTipoLinha = opcoesDe(TIPOS_LINHA_RISCO);
const opcoesFator = computed(() =>
  lFatores.value.map((f) => ({ valor: f.codigo, rotulo: `${f.codigo} · ${f.rotulo}` })),
);
const opcoesUnidade = computed(() => [
  { valor: null, rotulo: '—' },
  ...(a.value?.dominios.unidades ?? []).map((u) => ({ valor: u.codigo, rotulo: u.rotulo })),
]);
const opcoesGrupo = computed(() =>
  (a.value?.dominios.gruposRisco ?? []).map((g) => ({ valor: g.codigo, rotulo: g.rotulo })),
);
const opcoesEpc = computed(() => [
  { valor: null, rotulo: '—' },
  ...(a.value?.dominios.eficaciasEpc ?? []).map((g) => ({ valor: g.codigo, rotulo: g.rotulo })),
]);
async function buscarFator(): Promise<void> {
  lErro.value = null;
  if (lFatorTermo.value.trim().length < 2) return;
  try {
    lFatores.value = (await buscarFatores(lFatorTermo.value.trim())).itens;
    lFator.value = lFatores.value[0]?.codigo ?? null;
  } catch (x) {
    lErro.value = x;
  }
}
const lEntrada = computed(() =>
  esquemaLinhaRisco.safeParse({
    unidade: lUnidade.value,
    setor: lSetor.value.trim() || null,
    funcao: lFuncao.value.trim(),
    tipo: lTipo.value,
    fatorRisco: lTipo.value === 'risco' ? lFator.value : null,
    grupoRisco: lTipo.value === 'risco' ? lGrupo.value : null,
    epc: lTipo.value === 'risco' ? lEpc.value : null,
    epi: lTipo.value === 'epi' ? lEpi.value.trim() || null : null,
    descricao: lDescricao.value.trim() || null,
    inicio: lInicio.value ?? '',
  }),
);
async function gravarLinha(): Promise<void> {
  if (!lEntrada.value.success) return;
  lErro.value = null;
  try {
    const r = await incluirLinhaRisco(lEntrada.value.data);
    incluindo.value = false;
    lEpi.value = '';
    lFatores.value = [];
    lFator.value = null;
    await recarregar(r.mensagem);
  } catch (x) {
    lErro.value = x;
  }
}
const encerrando = ref<LinhaRiscoResposta | null>(null);
const dialogoFim = computed({
  get: () => encerrando.value !== null,
  set: (v: boolean) => {
    if (!v) encerrando.value = null;
  },
});
const fim = ref<string | null>(null);
const motivoFim = ref('');
const fErro = ref<unknown>(null);
const fEntrada = computed(() =>
  esquemaEncerrarLinhaRisco.safeParse({
    id: encerrando.value?.id ?? 0,
    fim: fim.value ?? '',
    motivo: motivoFim.value.trim(),
  }),
);
async function gravarFim(): Promise<void> {
  if (!fEntrada.value.success || !encerrando.value) return;
  fErro.value = null;
  try {
    const r = await encerrarLinhaRisco(encerrando.value.id, {
      fim: fEntrada.value.data.fim,
      motivo: fEntrada.value.data.motivo,
    });
    encerrando.value = null;
    motivoFim.value = '';
    await recarregar(r.mensagem);
  } catch (x) {
    fErro.value = x;
  }
}

// ── EPI do colaborador ──────────────────────────────────────────────────────────────────────────────────────
const colaborador = ref<ColaboradorSesmt | null>(null);
const vinculo = computed(() => colaborador.value?.vinculo ?? null);
const epi = useQuery({
  queryKey: computed(() => ['sesmt', 'epi', vinculo.value]),
  queryFn: () => lerEpiDoColaborador(vinculo.value!),
  enabled: computed(() => vinculo.value !== null),
});
const e = computed(() => epi.data.value ?? null);
const rTipo = ref<TipoRegistroEpi>('epi');
const opcoesTipoRegistro = opcoesDe(TIPOS_REGISTRO_EPI);
const rData = ref<string | null>(null);
const rEpi = ref('');
const rCa = ref('');
const rCaValidade = ref<string | null>(null);
const rQuantidade = ref('1');
const rInicio = ref<string | null>(null);
const rDose = ref('');
const rDosimetro = ref('');
const rAgente = ref('');
const rDuracao = ref('');
const rObs = ref('');
const rErro = ref<unknown>(null);
const num = (s: string) => (s.trim() === '' ? NaN : Number(s.replace(',', '.')));
const rEntrada = computed(() => {
  const base = {
    vinculo: vinculo.value ?? 0,
    data: rData.value ?? '',
    observacao: rObs.value.trim() || null,
  };
  if (rTipo.value === 'epi')
    return esquemaRegistroEpi.safeParse({
      ...base,
      tipo: 'epi',
      epi: rEpi.value.trim(),
      caNumero: rCa.value.trim(),
      caValidade: rCaValidade.value ?? '',
      quantidade: num(rQuantidade.value),
    });
  if (rTipo.value === 'dosimetria')
    return esquemaRegistroEpi.safeParse({
      ...base,
      tipo: 'dosimetria',
      periodoInicio: rInicio.value ?? '',
      doseMsv: num(rDose.value),
      dosimetro: rDosimetro.value.trim(),
    });
  return esquemaRegistroEpi.safeParse({
    ...base,
    tipo: 'quimio',
    agente: rAgente.value.trim(),
    duracaoMin: num(rDuracao.value),
  });
});
async function gravarRegistro(): Promise<void> {
  if (!rEntrada.value.success || vinculo.value === null) return;
  rErro.value = null;
  try {
    const r = await registrarEpi(vinculo.value, rEntrada.value.data);
    rEpi.value = '';
    rCa.value = '';
    rDose.value = '';
    rAgente.value = '';
    await recarregar(r.mensagem);
  } catch (x) {
    rErro.value = x;
  }
}
async function conferirAssinatura(id: number): Promise<void> {
  rErro.value = null;
  try {
    await recarregar((await assinarEntrega(id)).mensagem);
  } catch (x) {
    rErro.value = x;
  }
}
// W0-06: o registro lançado por engano se cancela com motivo (fica guardado; não conta na pendência nem na dose).
// C1-119: o registro é endereçado pelo tipo junto do id (cada tipo tem numeração própria).
type RegistroLista = EpiDoColaborador['registros'][number];
const cancelando = ref<{ id: number; tipo: RegistroLista['tipo'] } | null>(null);
const chaveRegistro = (r: RegistroLista) => (r.tipo === 'epi' ? String(r.id) : `${r.tipo}-${r.id}`);
const dlgCancelar = computed({
  get: () => cancelando.value !== null,
  set: (v: boolean) => {
    if (!v) cancelando.value = null;
  },
});
const cancelar = (motivo: string) => cancelarEntregaEpi(cancelando.value!.id, motivo, cancelando.value!.tipo);
const situacaoDose = (s: string) =>
  t(
    `sesmt.riscos.doseSituacao.${s === 'acima-limite' ? 'acimaLimite' : s === 'acima-teto' ? 'acimaTeto' : 'normal'}`,
  );
</script>

<template>
  <section class="tela-pessoas" aria-labelledby="sesmt-riscos-titulo" data-testid="tela-sesmt-riscos">
    <h1 id="sesmt-riscos-titulo">{{ t('sesmt.riscos.titulo') }}</h1>
    <p>{{ t('sesmt.riscos.subtitulo') }}</p>
    <ErroPessoas v-if="apoio.isError.value" :erro="apoio.error.value" />
    <p v-else-if="!a" role="status">{{ t('sesmt.carregando') }}</p>
    <template v-else>
      <SanteAlerta v-if="!a.gravacao.ligada" :texto="a.gravacao.motivo ?? ''" variante="info" />
      <SanteAlerta
        v-else-if="!a.acoes.risco && !a.acoes.epi"
        :texto="t('sesmt.soConsulta')"
        variante="info"
      />
      <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="sesmt-aviso" />

      <section class="bloco" aria-labelledby="sesmt-mapa" data-testid="mapa-riscos">
        <h2 id="sesmt-mapa">{{ t('sesmt.riscos.mapa') }}</h2>
        <form class="campos" @submit.prevent="filtro = { funcao: funcaoFiltro.trim(), vigentes }">
          <SanteCampoTexto
            v-model="funcaoFiltro"
            :rotulo="t('sesmt.riscos.funcao')"
            :max-bytes="60"
            data-testid="mapa-funcao"
          />
          <label class="marca"
            ><input v-model="vigentes" type="checkbox" data-testid="mapa-vigentes" />{{
              t('sesmt.riscos.vigentes')
            }}</label
          >
          <SanteBotao
            :rotulo="t('sesmt.buscar')"
            tipo="submit"
            variante="secundario"
            data-testid="mapa-filtrar"
          />
          <SanteBotao
            v-if="a.acoes.risco && !incluindo"
            :rotulo="t('sesmt.riscos.novo')"
            data-testid="nova-linha-risco"
            @acionar="incluindo = true"
          />
        </form>
        <ErroPessoas v-if="mapa.isError.value" :erro="mapa.error.value" />
        <p v-else-if="!mapa.data.value" role="status">{{ t('sesmt.carregando') }}</p>
        <p v-else-if="mapa.data.value.linhas.length === 0">{{ t('sesmt.nenhum') }}</p>
        <table v-else class="tabela" data-testid="tabela-mapa">
          <thead>
            <tr>
              <th scope="col">{{ t('sesmt.riscos.funcao') }}</th>
              <th scope="col">{{ t('sesmt.riscos.tipo') }}</th>
              <th scope="col">{{ t('sesmt.riscos.fator') }}</th>
              <th scope="col">{{ t('sesmt.colaborador.lotacao') }}</th>
              <th scope="col">{{ t('sesmt.riscos.vigencia') }}</th>
              <th scope="col"><span class="secundario">—</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="l in mapa.data.value.linhas" :key="l.id" :data-testid="`linha-risco-${l.id}`">
              <th scope="row">{{ l.funcao }}</th>
              <td>{{ TIPOS_LINHA_RISCO[l.tipo] }}</td>
              <td>{{ descreverLinha(l) }}</td>
              <td>{{ [l.unidadeNome, l.setor].filter(Boolean).join(' · ') || '—' }}</td>
              <td>
                {{ l.fim ? `${dataBr(l.inicio)} – ${dataBr(l.fim)}` : dataBr(l.inicio) }}
              </td>
              <td>
                <SanteBotao
                  v-if="a.acoes.risco && !l.fim"
                  :rotulo="t('sesmt.riscos.encerrar')"
                  variante="texto"
                  :data-testid="`encerrar-linha-${l.id}`"
                  @acionar="
                    encerrando = l;
                    fim = null;
                  "
                />
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <form
        v-if="incluindo"
        class="bloco"
        :aria-label="t('sesmt.riscos.novo')"
        data-testid="form-linha-risco"
        @submit.prevent="gravarLinha"
      >
        <h2>{{ t('sesmt.riscos.novo') }}</h2>
        <SanteOpcoes
          v-model="lTipo"
          :legenda="t('sesmt.riscos.tipo')"
          :opcoes="opcoesTipoLinha"
          data-testid="linha-tipo"
        />
        <div class="campos">
          <SanteCampoTexto
            v-model="lFuncao"
            :rotulo="t('sesmt.riscos.funcao')"
            :max-bytes="60"
            data-testid="linha-funcao"
          />
          <SanteSelecao
            v-model="lUnidade"
            :rotulo="t('sesmt.riscos.unidade')"
            :opcoes="opcoesUnidade"
            busca
            data-testid="linha-unidade"
          />
          <SanteCampoTexto
            v-model="lSetor"
            :rotulo="t('sesmt.riscos.setor')"
            :max-bytes="60"
            data-testid="linha-setor"
          />
          <SanteData
            v-model="lInicio"
            :rotulo="t('sesmt.riscos.inicio')"
            editavel
            data-testid="linha-inicio"
          />
        </div>
        <template v-if="lTipo === 'risco'">
          <div class="campos">
            <SanteCampoTexto
              v-model="lFatorTermo"
              :rotulo="t('sesmt.riscos.fatorBuscar')"
              :max-bytes="60"
              data-testid="linha-fator-termo"
            />
            <SanteBotao
              :rotulo="t('sesmt.buscar')"
              variante="secundario"
              data-testid="linha-fator-buscar"
              @acionar="buscarFator"
            />
            <SanteSelecao
              v-model="lFator"
              :rotulo="t('sesmt.riscos.fator')"
              :opcoes="opcoesFator"
              busca
              data-testid="linha-fator"
            />
            <SanteSelecao
              v-model="lGrupo"
              :rotulo="t('sesmt.riscos.grupo')"
              :opcoes="opcoesGrupo"
              data-testid="linha-grupo"
            />
            <SanteSelecao
              v-model="lEpc"
              :rotulo="t('sesmt.riscos.epc')"
              :opcoes="opcoesEpc"
              data-testid="linha-epc"
            />
          </div>
          <p class="secundario">{{ t('sesmt.riscos.fatorAjuda') }}</p>
        </template>
        <SanteCampoTexto
          v-else
          v-model="lEpi"
          :rotulo="t('sesmt.riscos.epi')"
          :max-bytes="80"
          data-testid="linha-epi"
        />
        <SanteCampoTexto
          v-model="lDescricao"
          :rotulo="t('sesmt.riscos.descricao')"
          :max-bytes="400"
          data-testid="linha-descricao"
        />
        <ErroPessoas v-if="lErro" :erro="lErro" />
        <div class="acoes">
          <SanteBotao :rotulo="t('sesmt.cancelar')" variante="texto" @acionar="incluindo = false" />
          <SanteBotao
            :rotulo="t('sesmt.gravar')"
            tipo="submit"
            :desabilitado="!lEntrada.success"
            data-testid="linha-gravar"
          />
        </div>
      </form>

      <SanteDialogo v-model:visivel="dialogoFim" :titulo="t('sesmt.riscos.encerrar')">
        <form class="bloco" data-testid="form-fim-linha" @submit.prevent="gravarFim">
          <p v-if="encerrando">{{ encerrando.funcao }} · {{ descreverLinha(encerrando) }}</p>
          <SanteData v-model="fim" :rotulo="t('sesmt.riscos.fim')" editavel data-testid="fim-linha-data" />
          <SanteCampoTexto
            v-model="motivoFim"
            :rotulo="t('sesmt.motivo')"
            :max-bytes="400"
            data-testid="fim-linha-motivo"
          />
          <p class="secundario">{{ t('sesmt.motivoAjuda') }}</p>
          <ErroPessoas v-if="fErro" :erro="fErro" />
          <div class="acoes">
            <SanteBotao :rotulo="t('sesmt.cancelar')" variante="texto" @acionar="encerrando = null" />
            <SanteBotao
              :rotulo="t('sesmt.riscos.encerrar')"
              tipo="submit"
              :desabilitado="!fEntrada.success"
              data-testid="fim-linha-gravar"
            />
          </div>
        </form>
      </SanteDialogo>

      <section class="bloco" aria-labelledby="sesmt-epi-colab" data-testid="epi-colaborador">
        <h2 id="sesmt-epi-colab">{{ t('sesmt.riscos.colaborador') }}</h2>
        <SeletorColaborador v-model="colaborador" tela="riscos" />
        <template v-if="colaborador">
          <SanteAlerta :texto="t('sesmt.leituraAuditada')" variante="info" />
          <ErroPessoas v-if="epi.isError.value" :erro="epi.error.value" />
          <p v-else-if="!e" role="status">{{ t('sesmt.carregando') }}</p>
          <template v-else>
            <PendenciasSesmt :pendencias="e.pendencias" />
            <p>
              <a :href="urlPpp(e.colaborador.vinculo)" target="_blank" rel="noopener" data-testid="ppp-pdf">{{
                t('sesmt.riscos.ppp')
              }}</a>
              · {{ t('sesmt.riscos.pppAjuda') }}
            </p>
            <h3>{{ t('sesmt.riscos.riscosDaFuncao') }}</h3>
            <p v-if="e.riscos.length === 0">{{ t('sesmt.nenhum') }}</p>
            <ul v-else data-testid="riscos-da-funcao">
              <li v-for="l in e.riscos" :key="l.id">
                {{ TIPOS_LINHA_RISCO[l.tipo] }}: {{ descreverLinha(l) }}
              </li>
            </ul>
            <SanteAlerta
              v-if="e.episFaltando.length"
              :texto="t('sesmt.riscos.faltando', { l: e.episFaltando.join(', ') })"
              variante="aviso"
              data-testid="epis-faltando"
            />
            <p data-testid="dose-ano">
              {{
                t('sesmt.riscos.dose', {
                  a: e.dose.ano,
                  t: `${e.dose.parcelasMsv.join(' + ') || '0'} = ${e.dose.totalMsv}`,
                  p: situacaoDose(e.dose.situacao),
                })
              }}
            </p>
            <h3>{{ t('sesmt.riscos.registros') }}</h3>
            <p v-if="e.registros.length === 0">{{ t('sesmt.nenhum') }}</p>
            <table v-else class="tabela" data-testid="tabela-registros-epi">
              <thead>
                <tr>
                  <th scope="col">{{ t('sesmt.data') }}</th>
                  <th scope="col">{{ t('sesmt.riscos.tipo') }}</th>
                  <th scope="col">{{ t('sesmt.riscos.epiNome') }}</th>
                  <th scope="col">{{ t('sesmt.riscos.assinatura') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="r in e.registros"
                  :key="chaveRegistro(r)"
                  :class="{ secundario: r.canceladoEm }"
                  :data-testid="`registro-epi-${chaveRegistro(r)}`"
                >
                  <td>
                    {{ dataBr(r.data) }}
                    <div v-if="r.canceladoEm" :data-testid="`epi-cancelada-${chaveRegistro(r)}`">
                      {{
                        t('sesmt.riscos.cancelada', {
                          d: dataBr(r.canceladoEm.slice(0, 10)),
                          p: r.canceladoPor ?? '',
                          m: r.motivoCancelamento ?? '',
                        })
                      }}
                    </div>
                  </td>
                  <td>{{ TIPOS_REGISTRO_EPI[r.tipo] }}</td>
                  <td>
                    <template v-if="r.tipo === 'epi'">
                      {{ r.epi }} · {{ t('sesmt.riscos.caNumero') }} {{ r.caNumero }} ({{
                        dataBr(r.caValidade)
                      }}) ·
                      {{ r.quantidade }}
                    </template>
                    <template v-else-if="r.tipo === 'dosimetria'">
                      {{ `${dataBr(r.periodoInicio)} – ${dataBr(r.data)}` }} · {{ r.doseMsv }} ·
                      {{ r.dosimetro }}
                    </template>
                    <template v-else>{{ r.agente }} · {{ r.duracaoMin }}</template>
                  </td>
                  <td>
                    <template v-if="r.tipo === 'epi'">
                      {{ r.assinatura === 'assinada' ? t('sesmt.sim') : t('sesmt.nao') }}
                      <a
                        :href="urlComprovante(r.id)"
                        target="_blank"
                        rel="noopener"
                        :data-testid="`comprovante-${r.id}`"
                        >{{ t('sesmt.riscos.comprovante') }}</a
                      >
                      <SanteBotao
                        v-if="a.acoes.epi && r.assinatura === 'pendente' && !r.canceladoEm"
                        :rotulo="t('sesmt.riscos.conferirAssinatura')"
                        variante="texto"
                        :data-testid="`assinar-${r.id}`"
                        @acionar="conferirAssinatura(r.id)"
                      />
                    </template>
                    <SanteBotao
                      v-if="a.acoes.epi && !r.canceladoEm"
                      :rotulo="t('sesmt.riscos.cancelar')"
                      variante="texto"
                      :data-testid="`cancelar-epi-${chaveRegistro(r)}`"
                      @acionar="cancelando = { id: r.id, tipo: r.tipo }"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
            <p class="secundario">{{ t('sesmt.riscos.conferirAjuda') }}</p>
            <HistoricoSesmt :correcoes="e.correcoes ?? []" testid="epi-historico" />
            <DialogoMotivo
              v-model:visivel="dlgCancelar"
              :titulo="t('sesmt.riscos.cancelarTitulo', { id: cancelando?.id ?? '' })"
              :texto="t('sesmt.riscos.cancelarTexto')"
              :confirmar="t('sesmt.riscos.cancelar')"
              :acao="cancelar"
              testid="dlg-cancelar-epi"
              @feito="(r) => recarregar((r as { mensagem: string }).mensagem)"
            />
            <form
              v-if="a.acoes.epi && !colaborador.desligamento"
              class="bloco"
              :aria-label="t('sesmt.riscos.entregar')"
              data-testid="form-registro-epi"
              @submit.prevent="gravarRegistro"
            >
              <SanteOpcoes
                v-model="rTipo"
                :legenda="t('sesmt.riscos.tipo')"
                :opcoes="opcoesTipoRegistro"
                data-testid="registro-epi-tipo"
              />
              <div class="campos">
                <SanteData
                  v-model="rData"
                  :rotulo="rTipo === 'dosimetria' ? t('sesmt.riscos.periodoFim') : t('sesmt.data')"
                  editavel
                  data-testid="registro-epi-data"
                />
                <template v-if="rTipo === 'epi'">
                  <SanteCampoTexto
                    v-model="rEpi"
                    :rotulo="t('sesmt.riscos.epiNome')"
                    :max-bytes="80"
                    data-testid="registro-epi-nome"
                  />
                  <SanteCampoTexto
                    v-model="rCa"
                    :rotulo="t('sesmt.riscos.caNumero')"
                    :max-bytes="12"
                    data-testid="registro-epi-ca"
                  />
                  <SanteData
                    v-model="rCaValidade"
                    :rotulo="t('sesmt.riscos.caValidade')"
                    editavel
                    data-testid="registro-epi-ca-validade"
                  />
                  <SanteCampoTexto
                    v-model="rQuantidade"
                    :rotulo="t('sesmt.riscos.quantidade')"
                    :max-bytes="3"
                    data-testid="registro-epi-quantidade"
                  />
                </template>
                <template v-else-if="rTipo === 'dosimetria'">
                  <SanteData
                    v-model="rInicio"
                    :rotulo="t('sesmt.riscos.periodoInicio')"
                    editavel
                    data-testid="registro-epi-inicio"
                  />
                  <SanteCampoTexto
                    v-model="rDose"
                    :rotulo="t('sesmt.riscos.doseMsv')"
                    :max-bytes="10"
                    data-testid="registro-epi-dose"
                  />
                  <SanteCampoTexto
                    v-model="rDosimetro"
                    :rotulo="t('sesmt.riscos.dosimetro')"
                    :max-bytes="30"
                    data-testid="registro-epi-dosimetro"
                  />
                </template>
                <template v-else>
                  <SanteCampoTexto
                    v-model="rAgente"
                    :rotulo="t('sesmt.riscos.agente')"
                    :max-bytes="80"
                    data-testid="registro-epi-agente"
                  />
                  <SanteCampoTexto
                    v-model="rDuracao"
                    :rotulo="t('sesmt.riscos.duracaoMin')"
                    :max-bytes="4"
                    data-testid="registro-epi-duracao"
                  />
                </template>
              </div>
              <SanteCampoTexto
                v-model="rObs"
                :rotulo="t('sesmt.observacao')"
                :max-bytes="400"
                data-testid="registro-epi-obs"
              />
              <ErroPessoas v-if="rErro" :erro="rErro" />
              <div class="acoes">
                <SanteBotao
                  :rotulo="t('sesmt.gravar')"
                  tipo="submit"
                  :desabilitado="!rEntrada.success"
                  data-testid="registro-epi-gravar"
                />
              </div>
            </form>
          </template>
        </template>
      </section>
    </template>
    <GrupoDominiosTela subitem="rhRiscosOcupacionaisEpiEpc" embutida />
  </section>
</template>

<style scoped src="../estilo-pessoas.css"></style>
<style scoped>
h3 {
  font-size: 1rem;
  margin: 0.5rem 0 0;
}
</style>
