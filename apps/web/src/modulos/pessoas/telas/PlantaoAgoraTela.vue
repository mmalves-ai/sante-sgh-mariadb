<script setup lang="ts">
// Quem está de plantão agora (M52.3; item `Gestão de pessoas > Escala de plantão (médica e de enfermagem)`; rota
// `/pessoas/plantao-agora`; `pessoas.plantao.ler`; consulta usada pelo prontuário, pelo NIR e pelo pronto atendimento):
// os plantões presenciais, de diarista e de sobreaviso em curso no instante (agora ou o dia e a hora escolhidos), com o
// plantão que atravessa a meia-noite marcado "desde ontem", o conselho e a especialidade, e o sobreaviso com o tempo de
// chegada. Quem tem `pessoas.sobreaviso.acionar` aciona o sobreaviso, registra a chegada (o atraso aparece) e cancela o
// acionamento feito por engano (regra 10). Modo painel (`?painel=1`): atualiza a cada minuto, sem os formulários.
import {
  CODIGOS_TIPO_PLANTAO,
  type PlantaoAgoraLinha,
  type ResultadoEscala,
  TIPOS_PLANTAO,
  type TipoPlantao,
} from '@sgh/contratos';
import { instanteDaChegada } from '@sgh/dominio-pessoas';
import {
  SanteAlerta,
  SanteBotao,
  SanteCampoTexto,
  SanteData,
  SanteDialogo,
  SanteHora,
  SanteSelecao,
} from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { acionarSobreaviso, cancelarAcionamento, lerPlantaoAgora, registrarChegada } from '../api-plantao.js';
import { inteiroDe } from '../escala-comum.js';
import ErroPessoas from '../componentes/ErroPessoas.vue';

const { t } = useI18n();
const qc = useQueryClient();
const rota = useRoute();
const router = useRouter();
const painel = computed(() => rota.query['painel'] === '1');

const dia = ref<string | null>(null);
const hora = ref<string | null>(null);
const unidade = ref<number | null>(null);
const setor = ref('');
const especialidade = ref<string | null>(null);
const tipo = ref<TipoPlantao | null>(null);
const filtro = ref<{
  instante?: string;
  unidade?: number;
  setor?: string;
  especialidade?: string;
  tipo?: TipoPlantao;
}>({});
const consulta = useQuery({
  queryKey: computed(() => ['pessoas', 'plantao-agora', filtro.value]),
  queryFn: () => lerPlantaoAgora(filtro.value),
  refetchInterval: computed(() => (painel.value && !filtro.value.instante ? 60_000 : false)),
});
const r = computed(() => consulta.data.value ?? null);
const horaDe = (hhmm: string | null) =>
  hhmm && /^\d{4}$/.test(hhmm) ? `${hhmm.slice(0, 2)}:${hhmm.slice(2)}` : null;
/** Sem hora, vai vazio e a API recusa com a mensagem do campo. */
const instanteDaChegadaOuVazio = (acionadoEm: string, h: string | null) =>
  h ? instanteDaChegada(acionadoEm, h) : '';
function consultar(): void {
  const h = horaDe(hora.value);
  filtro.value = {
    ...(dia.value && h ? { instante: `${dia.value}T${h}` } : {}),
    ...(unidade.value !== null ? { unidade: unidade.value } : {}),
    ...(setor.value.trim() ? { setor: setor.value.trim() } : {}),
    ...(especialidade.value ? { especialidade: especialidade.value } : {}),
    ...(tipo.value ? { tipo: tipo.value } : {}),
  };
}
function agora(): void {
  dia.value = null;
  hora.value = null;
  consultar();
}
function alternarPainel(): void {
  void router.replace({ query: painel.value ? {} : { painel: '1' } });
}

const opcoesUnidade = computed(() => [
  { valor: null, rotulo: t('pessoas.agora.todas') },
  ...(r.value?.unidades ?? []).map((u) => ({ valor: u.codigo, rotulo: u.rotulo })),
]);
const opcoesEspecialidade = computed(() => [
  { valor: null, rotulo: t('pessoas.agora.todas') },
  ...(r.value?.especialidades ?? []).map((e) => ({ valor: String(e.codigo), rotulo: e.rotulo })),
]);
const opcoesTipo = computed(() => [
  { valor: null, rotulo: t('pessoas.agora.todos') },
  ...CODIGOS_TIPO_PLANTAO.map((c) => ({ valor: c, rotulo: TIPOS_PLANTAO[c] })),
]);
const hm = (i: string) => i.slice(11, 16);
const faixa = (a: string, b: string) => `${hm(a)}–${hm(b)}`;
const dm = (i: string) => `${i.slice(8, 10)}/${i.slice(5, 7)} ${i.slice(11, 16)}`;
const onde = (l: PlantaoAgoraLinha) =>
  [l.unidadeNome ?? String(l.unidade), l.setor].filter(Boolean).join(' · ');

// ── Acionamento ──
type Acao = 'acionar' | 'chegada' | 'cancelar';
const dialogo = ref(false);
/** Cada abertura monta o diálogo de novo (reabrir logo depois de fechar não pode perder a abertura). */
const chaveDialogo = ref(0);
const alvo = ref<PlantaoAgoraLinha | null>(null);
const acao = ref<Acao>('acionar');
const motivo = ref('');
const atendimento = ref('');
const chegou = ref<string | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);
const resultado = ref<ResultadoEscala | null>(null);
function abrir(l: PlantaoAgoraLinha, qual: Acao): void {
  alvo.value = l;
  acao.value = qual;
  motivo.value = '';
  atendimento.value = '';
  chegou.value = null;
  erro.value = null;
  chaveDialogo.value++;
  dialogo.value = true;
}
const tituloDialogo = computed(() =>
  acao.value === 'acionar'
    ? t('pessoas.agora.dialogoAcionar')
    : acao.value === 'chegada'
      ? t('pessoas.agora.dialogoChegada')
      : t('pessoas.agora.dialogoCancelar'),
);
async function confirmar(): Promise<void> {
  const l = alvo.value;
  if (!l) return;
  erro.value = null;
  ocupado.value = true;
  try {
    const a = l.acionamento;
    const x =
      acao.value === 'acionar'
        ? await acionarSobreaviso({
            plantao: l.plantao,
            motivo: motivo.value.trim(),
            atendimento: inteiroDe(atendimento.value),
          })
        : acao.value === 'chegada'
          ? await registrarChegada(a!.id, {
              versao: a!.versao,
              // A data vem do acionamento (não do instante consultado): a hora antes da do acionamento é do dia seguinte.
              chegouEm: instanteDaChegadaOuVazio(a!.acionadoEm, horaDe(chegou.value)),
            })
          : await cancelarAcionamento(a!.id, { versao: a!.versao, motivo: motivo.value.trim() });
    resultado.value = x;
    dialogo.value = false;
    await qc.invalidateQueries({ queryKey: ['pessoas', 'plantao-agora'] });
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section
    class="tela-pessoas"
    :class="{ painel }"
    aria-labelledby="pes-agora-titulo"
    data-testid="tela-plantao-agora"
  >
    <h1 id="pes-agora-titulo">{{ t('pessoas.agora.titulo') }}</h1>
    <p>{{ t('pessoas.agora.subtitulo') }}</p>
    <p class="acoes">
      <RouterLink v-if="!painel" to="/pessoas/escala/trocas">{{ t('pessoas.agora.trocas') }}</RouterLink>
      <SanteBotao
        :rotulo="painel ? t('pessoas.agora.sairPainel') : t('pessoas.agora.painel')"
        variante="texto"
        data-testid="alternar-painel"
        @acionar="alternarPainel"
      />
    </p>
    <form
      v-if="!painel"
      class="campos"
      :aria-label="t('pessoas.agora.consultar')"
      @submit.prevent="consultar"
    >
      <SanteData v-model="dia" :rotulo="t('pessoas.agora.dia')" editavel data-testid="agora-dia" />
      <SanteHora v-model="hora" :rotulo="t('pessoas.agora.hora')" editavel data-testid="agora-hora" />
      <SanteSelecao
        v-model="unidade"
        :rotulo="t('pessoas.agora.unidade')"
        :opcoes="opcoesUnidade"
        busca
        data-testid="agora-unidade"
      />
      <SanteCampoTexto
        v-model="setor"
        :rotulo="t('pessoas.agora.setor')"
        :max-bytes="60"
        data-testid="agora-setor"
      />
      <SanteSelecao
        v-model="especialidade"
        :rotulo="t('pessoas.agora.especialidade')"
        :opcoes="opcoesEspecialidade"
        busca
        data-testid="agora-especialidade"
      />
      <SanteSelecao
        v-model="tipo"
        :rotulo="t('pessoas.agora.tipo')"
        :opcoes="opcoesTipo"
        data-testid="agora-tipo"
      />
      <div class="acoes">
        <SanteBotao :rotulo="t('pessoas.agora.consultar')" tipo="submit" data-testid="consultar-plantao" />
        <SanteBotao
          :rotulo="t('pessoas.agora.agora')"
          variante="secundario"
          data-testid="agora"
          @acionar="agora"
        />
      </div>
    </form>
    <ErroPessoas v-if="consulta.isError.value" :erro="consulta.error.value" />
    <p v-else-if="!r" role="status">{{ t('pessoas.carregando') }}</p>
    <template v-else>
      <p role="status" data-testid="agora-instante">
        {{ t('pessoas.agora.instante', { instante: dm(r.instante) }) }}
      </p>
      <SanteAlerta
        v-if="!painel && !r.acoes.acionar && r.linhas.some((l) => l.tipo === 'sobreaviso')"
        :texto="r.acoes.motivo ?? t('pessoas.agora.soConsulta')"
        variante="info"
      />
      <SanteAlerta
        v-if="resultado"
        :texto="resultado.mensagem"
        variante="info"
        anunciar
        data-testid="agora-resultado"
      />
      <SanteAlerta
        v-for="(al, i) in resultado?.alertas ?? []"
        :key="i"
        :texto="al"
        variante="aviso"
        data-testid="agora-alerta"
      />
      <SanteAlerta v-if="r.truncado" :texto="t('pessoas.agora.truncado')" variante="aviso" />
      <p v-if="r.linhas.length === 0" data-testid="agora-vazio">{{ t('pessoas.agora.vazio') }}</p>
      <table v-else class="tabela" data-testid="tabela-plantao-agora">
        <thead>
          <tr>
            <th scope="col">{{ t('pessoas.agora.colunas.nome') }}</th>
            <th scope="col">{{ t('pessoas.agora.colunas.conselho') }}</th>
            <th scope="col">{{ t('pessoas.agora.colunas.especialidade') }}</th>
            <th scope="col">{{ t('pessoas.agora.colunas.onde') }}</th>
            <th scope="col">{{ t('pessoas.agora.colunas.tipo') }}</th>
            <th scope="col">{{ t('pessoas.agora.colunas.horario') }}</th>
            <th scope="col">{{ t('pessoas.agora.colunas.sobreaviso') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in r.linhas" :key="l.plantao" :data-testid="`agora-${l.plantao}`">
            <th scope="row">{{ l.nome }}</th>
            <td>{{ l.conselho ?? '' }}</td>
            <td>{{ l.especialidade ?? '' }}</td>
            <td>{{ onde(l) }}</td>
            <td>{{ TIPOS_PLANTAO[l.tipo] }}</td>
            <td>
              {{ faixa(l.inicio, l.fim) }}
              <span v-if="l.desdeOntem" class="secundario">({{ t('pessoas.agora.desdeOntem') }})</span>
            </td>
            <td>
              <template v-if="l.tipo === 'sobreaviso'">
                <span>{{ t('pessoas.agora.chegada', { min: l.chegadaMin ?? 0 }) }}</span>
                <template v-if="l.acionamento">
                  <br />
                  <span v-if="l.acionamento.situacao === 'acionado'" :data-testid="`acionado-${l.plantao}`">
                    {{
                      t('pessoas.agora.acionado', {
                        em: hm(l.acionamento.acionadoEm),
                        prazo: hm(l.acionamento.prazoChegada),
                      })
                    }}
                  </span>
                  <span v-else-if="l.acionamento.situacao === 'chegou'" :data-testid="`chegou-${l.plantao}`">
                    {{ t('pessoas.agora.chegou', { em: hm(l.acionamento.chegouEm ?? '') }) }}
                  </span>
                  <span v-else>{{ t('pessoas.agora.cancelado') }}</span>
                  <strong v-if="l.acionamento.atrasado"> · {{ t('pessoas.agora.atrasado') }}</strong>
                </template>
                <div v-if="!painel && r.acoes.acionar" class="acoes">
                  <SanteBotao
                    v-if="l.acionamento?.situacao !== 'acionado'"
                    :rotulo="t('pessoas.agora.acionar')"
                    variante="secundario"
                    :data-testid="`acionar-${l.plantao}`"
                    @acionar="abrir(l, 'acionar')"
                  />
                  <template v-else>
                    <SanteBotao
                      :rotulo="t('pessoas.agora.registrarChegada')"
                      variante="secundario"
                      :data-testid="`chegada-${l.plantao}`"
                      @acionar="abrir(l, 'chegada')"
                    />
                    <SanteBotao
                      :rotulo="t('pessoas.agora.cancelarAcionamento')"
                      variante="texto"
                      :data-testid="`cancelar-acionamento-${l.plantao}`"
                      @acionar="abrir(l, 'cancelar')"
                    />
                  </template>
                </div>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </template>

    <SanteDialogo
      v-if="dialogo"
      :key="chaveDialogo"
      v-model:visivel="dialogo"
      :titulo="tituloDialogo"
      largura="36rem"
    >
      <div v-if="alvo" class="bloco" data-testid="dialogo-sobreaviso">
        <p>
          <strong>{{ alvo.nome }}</strong> · {{ TIPOS_PLANTAO[alvo.tipo] }} {{ faixa(alvo.inicio, alvo.fim) }}
        </p>
        <template v-if="acao === 'acionar'">
          <SanteCampoTexto
            v-model="motivo"
            :rotulo="t('pessoas.agora.motivo')"
            :max-bytes="400"
            multilinha
            obrigatorio
            data-testid="acionar-motivo"
          />
          <SanteCampoTexto
            v-model="atendimento"
            :rotulo="t('pessoas.agora.atendimento')"
            :max-bytes="10"
            data-testid="acionar-atendimento"
          />
        </template>
        <SanteHora
          v-else-if="acao === 'chegada'"
          v-model="chegou"
          :rotulo="t('pessoas.agora.chegouEm')"
          editavel
          data-testid="chegada-hora"
        />
        <SanteCampoTexto
          v-else
          v-model="motivo"
          :rotulo="t('pessoas.agora.motivoCancelamento')"
          :max-bytes="400"
          multilinha
          obrigatorio
          data-testid="acionamento-cancelar-motivo"
        />
        <ErroPessoas v-if="erro" :erro="erro" />
        <div class="acoes">
          <SanteBotao
            :rotulo="t('pessoas.agora.confirmar')"
            :desabilitado="ocupado"
            data-testid="confirmar-sobreaviso"
            @acionar="confirmar"
          />
          <SanteBotao :rotulo="t('pessoas.agora.fechar')" variante="texto" @acionar="dialogo = false" />
        </div>
      </div>
    </SanteDialogo>
  </section>
</template>

<style scoped src="../estilo-pessoas.css"></style>
<style scoped>
.painel {
  max-width: none;
  font-size: 1.125rem;
}
</style>
