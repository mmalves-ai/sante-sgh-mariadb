<script setup lang="ts">
// Espelho de ponto do colaborador na competência (M52.4; `pessoas.ponto.ler`; regras 11, 13 e 14): o espelho (dias,
// totais, eventos para a folha, banco de horas, contas e trilha), os ajustes com a decisão (quem pediu não aprova), o
// lançamento do ajuste ou da justificativa, o fechamento e a reabertura do período, o acerto do banco e o PDF. A
// marcação original nunca muda: o ajuste é um registro novo, com motivo, que só vale aprovado.
import {
  CODIGOS_TIPO_AJUSTE,
  esquemaLancarAjuste,
  SITUACOES_AJUSTE,
  TIPOS_AJUSTE,
  type TipoAjuste,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRoute } from 'vue-router';
import ErroPessoas from '../componentes/ErroPessoas.vue';
import { dataBr } from '../comum.js';
import {
  acertarBanco,
  decidirAjuste,
  desistirAjuste,
  fecharPeriodo,
  lancarAjuste,
  lerApoioPonto,
  lerEspelho,
  reabrirPeriodo,
  urlEspelhoPdf,
} from './api-ponto.js';
import EspelhoConteudo from './EspelhoConteudo.vue';
import DialogoMotivo from '../componentes/DialogoMotivo.vue';
import { usarSessao } from '../../../casca/sessao/sessao.js';

const { t } = useI18n();
const rota = useRoute();
const cliente = useQueryClient();
const vinculo = computed(() => Number(rota.params['vinculo']));
const competencia = computed(() => String(rota.params['competencia']));
const apoio = useQuery({ queryKey: ['ponto', 'apoio'], queryFn: lerApoioPonto });
const espelho = useQuery({
  queryKey: computed(() => ['ponto', 'espelho', vinculo.value, competencia.value]),
  queryFn: () => lerEspelho(vinculo.value, competencia.value),
});
const e = computed(() => espelho.data.value ?? null);
const a = computed(() => apoio.data.value ?? null);

// W0-06: o próprio solicitante desiste do ajuste pendente (o servidor confere quem pediu; outra pessoa recebe 403).
const { sessao } = usarSessao();
const meuLogin = computed(() => {
  const u = sessao.value?.usuario;
  return String(u?.login ?? u?.id ?? '').toUpperCase();
});
const ehMeu = (pedidoPor: string) => meuLogin.value !== '' && pedidoPor.toUpperCase() === meuLogin.value;
const dialogoDesistir = ref(false);
const desistindo = ref<number | null>(null);
function pedirDesistencia(id: number): void {
  desistindo.value = id;
  dialogoDesistir.value = true;
}
const desistir = (motivo: string) => desistirAjuste(desistindo.value!, motivo);
async function aposDesistir(r: unknown): Promise<void> {
  aviso.value = (r as { mensagem: string }).mensagem;
  await cliente.invalidateQueries({ queryKey: ['ponto'] });
}

const aviso = ref<string | null>(null);
const erro = ref<unknown>(null);
async function agir(fn: () => Promise<{ mensagem: string }>): Promise<boolean> {
  erro.value = null;
  try {
    aviso.value = (await fn()).mensagem;
    await cliente.invalidateQueries({ queryKey: ['ponto'] });
    return true;
  } catch (x) {
    erro.value = x;
    return false;
  }
}

// Lançar ajuste.
const tipo = ref<TipoAjuste>('justificativa');
const dia = ref<string | null>(null);
const dataMarcacao = ref<string | null>(null);
const horaMarcacao = ref('');
const periodo = ref<number | null>(null);
const marcacao = ref<number | null>(null);
const movimento = ref<number | null>(null);
const justificativa = ref<number | null>(null);
const minutos = ref('');
const motivo = ref('');
watch(dia, (d) => {
  if (d && !dataMarcacao.value) dataMarcacao.value = d;
});
const opcoesTipo = CODIGOS_TIPO_AJUSTE.map((c) => ({ valor: c, rotulo: TIPOS_AJUSTE[c] }));
const opc = (xs: readonly { codigo: number; rotulo: string }[] | undefined) =>
  (xs ?? []).map((x) => ({ valor: x.codigo, rotulo: x.rotulo }));
const opcoesMarcacao = computed(() =>
  (e.value?.dias ?? [])
    .flatMap((d) => d.marcacoes)
    .filter((m) => m.id !== null && !m.desconsiderada && (!dia.value || m.instante.slice(0, 10) >= dia.value))
    .slice(0, 60)
    .map((m) => ({ valor: m.id!, rotulo: `${dataBr(m.instante.slice(0, 10))} ${m.instante.slice(11, 16)}` })),
);
const entrada = computed(() =>
  esquemaLancarAjuste.safeParse({
    vinculo: vinculo.value,
    tipo: tipo.value,
    dia: dia.value ?? '',
    marcacao: tipo.value === 'desconsiderar' ? marcacao.value : null,
    instante:
      tipo.value === 'inclusao' &&
      dataMarcacao.value &&
      /^([01]\d|2[0-3]):[0-5]\d$/.test(horaMarcacao.value.trim())
        ? `${dataMarcacao.value}T${horaMarcacao.value.trim()}`
        : null,
    movimento: tipo.value === 'justificativa' ? movimento.value : null,
    justificativa: tipo.value === 'justificativa' ? justificativa.value : null,
    periodo: tipo.value === 'inclusao' ? periodo.value : null,
    minutos: tipo.value === 'justificativa' && minutos.value.trim() ? Number(minutos.value) : null,
    motivo: motivo.value.trim(),
  }),
);
async function lancar(): Promise<void> {
  if (!entrada.value.success) return;
  if (await agir(() => lancarAjuste(entrada.value.data!))) {
    motivo.value = '';
    horaMarcacao.value = '';
    marcacao.value = null;
  }
}

// Decisão.
const motivoRecusa = ref<Record<number, string>>({});
const decidir = (id: number, d: 'aprovar' | 'recusar') =>
  agir(() => decidirAjuste(id, d, d === 'recusar' ? (motivoRecusa.value[id] ?? '').trim() : null));

// Período e banco.
const motivoReabertura = ref('');
const acerto = ref('');
const motivoAcerto = ref('');
const fechar = () => agir(() => fecharPeriodo({ vinculo: vinculo.value, competencia: competencia.value }));
const reabrir = () =>
  agir(() =>
    reabrirPeriodo({
      vinculo: vinculo.value,
      competencia: competencia.value,
      motivo: motivoReabertura.value.trim(),
    }),
  );
const acertar = () =>
  agir(() =>
    acertarBanco({
      vinculo: vinculo.value,
      competencia: competencia.value,
      minutos: Number(acerto.value.replace('+', '')),
      motivo: motivoAcerto.value.trim(),
    }),
  );
</script>

<template>
  <section class="tela-pessoas" aria-labelledby="espelho-titulo" data-testid="tela-espelho-ponto">
    <h1 id="espelho-titulo">{{ t('ponto.espelho.titulo') }}</h1>
    <div class="acoes">
      <RouterLink to="/pessoas/ponto">{{ t('ponto.voltar') }}</RouterLink>
      <a v-if="e" :href="urlEspelhoPdf(vinculo, competencia)" data-testid="espelho-pdf">{{
        t('ponto.espelho.pdf')
      }}</a>
    </div>
    <SanteAlerta :texto="t('ponto.leituraAuditada')" variante="info" />
    <ErroPessoas v-if="espelho.isError.value" :erro="espelho.error.value" />
    <p v-else-if="!e" role="status">{{ t('ponto.carregando') }}</p>
    <template v-else>
      <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="espelho-aviso" />
      <ErroPessoas v-if="erro" :erro="erro" />
      <SanteAlerta
        v-if="e.acoes.motivo"
        :texto="e.acoes.motivo"
        variante="info"
        data-testid="espelho-acoes-motivo"
      />
      <SanteAlerta
        v-if="e.diasInconsistentes > 0"
        :texto="t('ponto.espelho.inconsistentes', { n: e.diasInconsistentes })"
        variante="aviso"
        data-testid="espelho-inconsistentes"
      />
      <EspelhoConteudo :espelho="e" />

      <section class="bloco" aria-labelledby="espelho-ajustes" data-testid="espelho-ajustes">
        <h2 id="espelho-ajustes">{{ t('ponto.ajustes.titulo') }}</h2>
        <p class="secundario">{{ t('ponto.ajustes.ajuda') }}</p>
        <p v-if="e.ajustes.length === 0">{{ t('ponto.ajustes.nenhum') }}</p>
        <table v-else class="tabela">
          <thead>
            <tr>
              <th scope="col">{{ t('ponto.ajustes.dia') }}</th>
              <th scope="col">{{ t('ponto.ajustes.tipo') }}</th>
              <th scope="col">{{ t('ponto.motivo') }}</th>
              <th scope="col">{{ t('ponto.ajustes.pedidoPor') }}</th>
              <th scope="col">{{ t('ponto.ajustes.situacao') }}</th>
              <th scope="col">{{ t('ponto.ajustes.decisao') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="x in e.ajustes" :key="x.id" :data-testid="`ajuste-${x.id}`">
              <th scope="row">{{ dataBr(x.dia) }}</th>
              <td>
                {{ x.tipoRotulo }}
                <span class="secundario">
                  {{ x.instante ? x.instante.slice(11, 16) : '' }} {{ x.movimentoRotulo ?? '' }}
                  {{ x.periodoRotulo ?? '' }}
                  {{ x.minutos ? `${x.minutos} min` : '' }}
                </span>
              </td>
              <td>{{ x.motivo }}</td>
              <td>{{ x.pedidoPor }}</td>
              <td>
                {{ SITUACOES_AJUSTE[x.situacao] }}
                <span v-if="x.decididoPor" class="secundario">· {{ x.decididoPor }}</span>
                <span v-if="x.motivoDecisao" class="secundario">· {{ x.motivoDecisao }}</span>
              </td>
              <td>
                <SanteBotao
                  v-if="x.situacao === 'pendente' && ehMeu(x.pedidoPor)"
                  :rotulo="t('pessoas.crud.desistir')"
                  variante="secundario"
                  :data-testid="`desistir-${x.id}`"
                  @acionar="pedirDesistencia(x.id)"
                />
                <div v-if="x.situacao === 'pendente' && e.acoes.aprovar" class="acoes">
                  <SanteBotao
                    :rotulo="t('ponto.ajustes.aprovar')"
                    :data-testid="`aprovar-${x.id}`"
                    @acionar="decidir(x.id, 'aprovar')"
                  />
                  <SanteCampoTexto
                    :model-value="motivoRecusa[x.id] ?? ''"
                    :rotulo="t('ponto.ajustes.motivoRecusa')"
                    :max-bytes="400"
                    @update:model-value="(v: string) => (motivoRecusa[x.id] = v)"
                  />
                  <SanteBotao
                    :rotulo="t('ponto.ajustes.recusar')"
                    variante="secundario"
                    :desabilitado="(motivoRecusa[x.id] ?? '').trim().length < 10"
                    :data-testid="`recusar-${x.id}`"
                    @acionar="decidir(x.id, 'recusar')"
                  />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <DialogoMotivo
          v-model:visivel="dialogoDesistir"
          :titulo="t('pessoas.crud.desistirTitulo')"
          :texto="t('pessoas.crud.desistirTexto')"
          :confirmar="t('pessoas.crud.desistir')"
          :acao="desistir"
          testid="dialogo-desistir-ajuste"
          @feito="aposDesistir"
        />
      </section>

      <form
        v-if="e.acoes.justificar"
        class="bloco"
        :aria-label="t('ponto.ajustes.lancar')"
        data-testid="form-ajuste"
        @submit.prevent="lancar"
      >
        <h2>{{ t('ponto.ajustes.lancar') }}</h2>
        <div class="campos">
          <SanteSelecao
            v-model="tipo"
            :rotulo="t('ponto.ajustes.tipo')"
            :opcoes="opcoesTipo"
            data-testid="ajuste-tipo"
          />
          <SanteData v-model="dia" :rotulo="t('ponto.ajustes.dia')" editavel data-testid="ajuste-dia" />
          <template v-if="tipo === 'inclusao'">
            <SanteData v-model="dataMarcacao" :rotulo="t('ponto.ajustes.dataMarcacao')" editavel />
            <SanteCampoTexto
              v-model="horaMarcacao"
              :rotulo="t('ponto.ajustes.horaMarcacao')"
              :max-bytes="5"
            />
            <SanteSelecao
              v-model="periodo"
              :rotulo="t('ponto.ajustes.periodo')"
              :opcoes="opc(a?.dominios.periodos)"
            />
          </template>
          <SanteSelecao
            v-else-if="tipo === 'desconsiderar'"
            v-model="marcacao"
            :rotulo="t('ponto.ajustes.marcacao')"
            :opcoes="opcoesMarcacao"
            data-testid="ajuste-marcacao"
          />
          <template v-else>
            <SanteSelecao
              v-model="movimento"
              :rotulo="t('ponto.ajustes.movimento')"
              :opcoes="opc(a?.dominios.movimentos)"
              data-testid="ajuste-movimento"
            />
            <SanteSelecao
              v-model="justificativa"
              :rotulo="t('ponto.ajustes.justificativa')"
              :opcoes="opc(a?.dominios.justificativas)"
            />
            <SanteCampoTexto v-model="minutos" :rotulo="t('ponto.ajustes.minutosAbono')" :max-bytes="4" />
          </template>
        </div>
        <SanteCampoTexto
          v-model="motivo"
          :rotulo="t('ponto.motivo')"
          :max-bytes="400"
          data-testid="ajuste-motivo"
        />
        <p class="secundario">{{ t('ponto.motivoAjuda') }}</p>
        <div class="acoes">
          <SanteBotao
            :rotulo="t('ponto.gravar')"
            tipo="submit"
            :desabilitado="!entrada.success"
            data-testid="ajuste-gravar"
          />
        </div>
      </form>

      <section class="bloco" aria-labelledby="espelho-periodo" data-testid="espelho-periodo">
        <h2 id="espelho-periodo">{{ t('ponto.periodo.titulo') }}</h2>
        <template v-if="e.acoes.fechar">
          <p class="secundario">{{ t('ponto.periodo.fecharAjuda') }}</p>
          <div class="acoes">
            <SanteBotao :rotulo="t('ponto.periodo.fechar')" data-testid="periodo-fechar" @acionar="fechar" />
          </div>
        </template>
        <template v-if="e.acoes.reabrir">
          <SanteCampoTexto
            v-model="motivoReabertura"
            :rotulo="t('ponto.periodo.motivoReabertura')"
            :max-bytes="400"
          />
          <div class="acoes">
            <SanteBotao
              :rotulo="t('ponto.periodo.reabrir')"
              variante="secundario"
              :desabilitado="motivoReabertura.trim().length < 10"
              data-testid="periodo-reabrir"
              @acionar="reabrir"
            />
          </div>
        </template>
        <template v-if="e.acoes.aprovar && e.banco.regra">
          <div class="campos">
            <SanteCampoTexto v-model="acerto" :rotulo="t('ponto.banco.acerto')" :max-bytes="6" />
            <SanteCampoTexto v-model="motivoAcerto" :rotulo="t('ponto.motivo')" :max-bytes="400" />
          </div>
          <div class="acoes">
            <SanteBotao
              :rotulo="t('ponto.banco.lancarAcerto')"
              variante="secundario"
              :desabilitado="!/^[+-]?\d{1,5}$/.test(acerto.trim()) || motivoAcerto.trim().length < 10"
              @acionar="acertar"
            />
          </div>
        </template>
      </section>
    </template>
  </section>
</template>

<style scoped src="../estilo-pessoas.css"></style>
