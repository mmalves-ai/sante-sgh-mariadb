<script setup lang="ts">
// Regras e bloqueio de visita por paciente (M50, etapa 5; item `Hotelaria e apoio > Portaria e visitantes > Regras e
// bloqueio de visita por paciente`; `hotelaria.visita.regrar`): a regra de cada unidade (horário, visitantes ao mesmo
// tempo, idade mínima, UTI, isolamento, duração), pela versão lida; o bloqueio por paciente (pedido do paciente ou da
// família, ordem judicial com o número do processo, sigilo de presença) para todos, para uma pessoa ou com um limite
// menor, e a revogação com o motivo; o expurgo dos cadastros com o prazo de retenção vencido. O relatório de contatos
// (`hotelaria.visita.contatos`) tem tela própria (/portaria/contatos); o bloqueio clínico é da enfermagem (outra tela).
import type { RegraVisitaLida, VisitanteLido } from '@sgh/contratos';
import { rotaDoSubitem } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteDialogo, SanteOpcoes, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  bloquearVisita,
  buscarVisitantes,
  definirRegraVisita,
  expurgarVisitantes,
  type InternadoDaUnidade,
  lerInternadosRegras,
  lerRegrasPortaria,
  revogarBloqueio,
} from '../api-portaria.js';
import ErroPortaria from '../componentes/ErroPortaria.vue';

const { t } = useI18n();
const cliente = useQueryClient();
const painel = useQuery({ queryKey: ['portaria', 'regras'], queryFn: () => lerRegrasPortaria() });
const p = computed(() => painel.data.value);
const pode = (op: string) => p.value?.gravacao.operacoes[op]?.pode === true;
const erro = ref<unknown>(null);
const mensagem = ref('');
const hora = (x: string) => `${x.slice(8, 10)}/${x.slice(5, 7)} ${x.slice(11, 16)}`;
const recarregar = () => cliente.invalidateQueries({ queryKey: ['portaria', 'regras'] });
async function executar(fn: () => Promise<{ mensagem: string }>): Promise<boolean> {
  erro.value = null;
  try {
    mensagem.value = (await fn()).mensagem;
    await recarregar();
    return true;
  } catch (x) {
    erro.value = x;
    return false;
  }
}
const opcoesUnidade = computed(() => [
  { valor: '*', rotulo: t('portaria.regras.todas') },
  ...(p.value?.unidades ?? []).map((u) => ({ valor: u.unidade, rotulo: u.nome })),
]);
const nomeUnidade = (u: string) =>
  u === '*' ? t('portaria.regras.todas') : (p.value?.unidades.find((x) => x.unidade === u)?.nome ?? u);

// ── Regra ──
const regra = ref({
  unidade: '*',
  horaInicio: '14:00',
  horaFim: '20:00',
  maxSimultaneos: '2',
  idadeMinima: '12',
  uti: false,
  isolamento: 'orientar' as 'orientar' | 'bloquear',
  duracaoMaxMin: '120',
  observacao: '',
});
const regraAtual = computed<RegraVisitaLida | undefined>(() =>
  p.value?.regras.find((r) => r.unidade === regra.value.unidade && !r.padrao),
);
function editar(r: RegraVisitaLida): void {
  regra.value = {
    unidade: r.unidade,
    horaInicio: r.horaInicio,
    horaFim: r.horaFim,
    maxSimultaneos: String(r.maxSimultaneos),
    idadeMinima: String(r.idadeMinima),
    uti: r.uti,
    isolamento: r.isolamento,
    duracaoMaxMin: String(r.duracaoMaxMin),
    observacao: r.observacao ?? '',
  };
}
const opcoesIsolamento = computed(() => [
  { valor: 'orientar' as const, rotulo: t('portaria.regras.isolamento.orientar') },
  { valor: 'bloquear' as const, rotulo: t('portaria.regras.isolamento.bloquear') },
]);
function gravarRegra(): Promise<boolean> {
  const r = regra.value;
  return executar(() =>
    definirRegraVisita({
      unidade: r.unidade,
      horaInicio: r.horaInicio,
      horaFim: r.horaFim,
      maxSimultaneos: Number(r.maxSimultaneos),
      idadeMinima: Number(r.idadeMinima),
      uti: r.uti,
      isolamento: r.isolamento,
      duracaoMaxMin: Number(r.duracaoMaxMin),
      observacao: r.observacao.trim() || null,
      versao: regraAtual.value?.versao ?? null,
    }),
  );
}

// ── Bloqueio ──
const unidadeBloqueio = ref('');
const internados = ref<InternadoDaUnidade[]>([]);
watch(unidadeBloqueio, async (u) => {
  internados.value = [];
  bloqueio.value.internacao = null;
  if (!u) return;
  try {
    internados.value = await lerInternadosRegras(u);
  } catch (x) {
    erro.value = x;
  }
});
const bloqueio = ref({
  internacao: null as number | null,
  motivo: 'pedido' as 'pedido' | 'judicial' | 'sigilo',
  abrangencia: 'todos' as 'todos' | 'visitante' | 'limite',
  limite: '1',
  incluiAcompanhante: false,
  justificativa: '',
  documento: '',
  fim: '',
});
const opcoesInternados = computed(() => [
  { valor: null, rotulo: '—' },
  ...internados.value.map((i) => ({
    valor: i.internacao as number | null,
    rotulo: `${i.leito} · ${i.nome}`,
  })),
]);
const opcoesMotivo = computed(() =>
  (['pedido', 'judicial', 'sigilo'] as const).map((m) => ({ valor: m, rotulo: t(`portaria.motivos.${m}`) })),
);
const opcoesAbrangencia = computed(() =>
  (['todos', 'visitante', 'limite'] as const).map((m) => ({
    valor: m,
    rotulo: t(`portaria.abrangencias.${m}`),
  })),
);
const buscaPessoa = ref('');
const pessoas = ref<VisitanteLido[]>([]);
const pessoa = ref<number | null>(null);
async function buscarPessoa(): Promise<void> {
  try {
    pessoas.value = await buscarVisitantes({ busca: buscaPessoa.value });
  } catch (x) {
    erro.value = x;
  }
}
const opcoesPessoas = computed(() => [
  { valor: null, rotulo: '—' },
  ...pessoas.value.map((v) => ({
    valor: v.id as number | null,
    rotulo: `${v.nome} · ${v.documentoMascarado}`,
  })),
]);
const prontoParaBloquear = computed(() => {
  const b = bloqueio.value;
  if (b.internacao === null || b.justificativa.trim().length < 10) return false;
  if (b.motivo === 'judicial' && b.documento.trim().length < 3) return false;
  if (b.abrangencia === 'visitante' && pessoa.value === null) return false;
  return pode('regrar');
});
async function bloquear(): Promise<void> {
  const b = bloqueio.value;
  const ok = await executar(() =>
    bloquearVisita({
      internacao: b.internacao,
      motivo: b.motivo,
      abrangencia: b.motivo === 'sigilo' ? 'todos' : b.abrangencia,
      visitante: b.abrangencia === 'visitante' ? pessoa.value : null,
      limite: b.abrangencia === 'limite' ? Number(b.limite) : null,
      incluiAcompanhante: b.motivo === 'judicial' && b.incluiAcompanhante,
      justificativa: b.justificativa,
      documento: b.documento.trim() || null,
      fim: b.fim || null,
    }),
  );
  if (ok) bloqueio.value = { ...bloqueio.value, justificativa: '', documento: '', fim: '' };
}
const revogando = ref<number | null>(null);
const motivoRevogacao = ref('');
const dialogoRevogar = computed({
  get: () => revogando.value !== null,
  set: (v: boolean) => {
    if (!v) revogando.value = null;
  },
});
async function revogar(): Promise<void> {
  if (revogando.value === null) return;
  if (await executar(() => revogarBloqueio(revogando.value!, motivoRevogacao.value))) {
    revogando.value = null;
    motivoRevogacao.value = '';
  }
}
</script>

<template>
  <section class="tela-portaria" aria-labelledby="rg-titulo" data-testid="tela-portaria-regras">
    <h1 id="rg-titulo">{{ t('portaria.regras.titulo') }}</h1>
    <p>{{ t('portaria.regras.subtitulo') }}</p>
    <nav class="barra" :aria-label="t('portaria.navegacao')">
      <RouterLink to="/portaria">{{ t('portaria.links.portaria') }}</RouterLink>
      <RouterLink to="/portaria/acompanhantes">{{ t('portaria.links.acompanhantes') }}</RouterLink>
      <RouterLink :to="rotaDoSubitem('portariaCadastros')" data-testid="rg-link-tipos">{{
        t('portaria.links.tipos')
      }}</RouterLink>
    </nav>
    <p v-if="painel.isLoading.value">{{ t('portaria.carregando') }}</p>
    <ErroPortaria v-else-if="painel.error.value" :erro="painel.error.value" />
    <template v-else-if="p">
      <SanteAlerta
        v-if="!p.gravacao.ligada"
        variante="info"
        :texto="p.gravacao.motivo ?? t('portaria.desligada')"
      />
      <p v-if="mensagem" role="status" data-testid="rg-mensagem">{{ mensagem }}</p>
      <ErroPortaria v-if="erro" :erro="erro" />

      <section class="cartao" aria-labelledby="rg-regras">
        <h2 id="rg-regras">{{ t('portaria.regras.unidades') }}</h2>
        <div class="rolagem">
          <table class="grade" data-testid="rg-tabela">
            <thead>
              <tr>
                <th scope="col">{{ t('portaria.regras.unidade') }}</th>
                <th scope="col">{{ t('portaria.regras.horario') }}</th>
                <th scope="col">{{ t('portaria.regras.limite') }}</th>
                <th scope="col">{{ t('portaria.regras.idade') }}</th>
                <th scope="col">{{ t('portaria.regras.uti') }}</th>
                <th scope="col">{{ t('portaria.regras.isolamentoCol') }}</th>
                <th scope="col">{{ t('portaria.regras.duracao') }}</th>
                <th scope="col">{{ t('portaria.acoes') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in p.regras" :key="r.unidade" :data-testid="`rg-regra-${r.unidade}`">
                <td>
                  {{ nomeUnidade(r.unidade) }}
                  <span v-if="r.padrao" class="secundario"> · {{ t('portaria.regras.padrao') }}</span>
                </td>
                <td>{{ t('portaria.regras.intervalo', { inicio: r.horaInicio, fim: r.horaFim }) }}</td>
                <td>{{ r.maxSimultaneos }}</td>
                <td>{{ r.idadeMinima }}</td>
                <td>{{ r.uti ? t('portaria.sim') : t('portaria.nao') }}</td>
                <td>{{ t(`portaria.regras.isolamento.${r.isolamento}`) }}</td>
                <td>{{ t('portaria.regras.minutos', { n: r.duracaoMaxMin }) }}</td>
                <td>
                  <SanteBotao variante="texto" :rotulo="t('portaria.regras.editar')" @acionar="editar(r)" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <form class="registro" data-testid="rg-form" @submit.prevent="gravarRegra">
          <div class="campos">
            <SanteSelecao
              v-model="regra.unidade"
              :rotulo="t('portaria.regras.unidade')"
              :opcoes="opcoesUnidade"
              data-testid="rg-unidade"
            />
            <span class="campo">
              <label for="rg-inicio">{{ t('portaria.regras.inicio') }}</label>
              <input id="rg-inicio" v-model="regra.horaInicio" type="time" data-testid="rg-inicio" />
            </span>
            <span class="campo">
              <label for="rg-fim">{{ t('portaria.regras.fim') }}</label>
              <input id="rg-fim" v-model="regra.horaFim" type="time" data-testid="rg-fim" />
            </span>
            <span class="campo">
              <label for="rg-max">{{ t('portaria.regras.limite') }}</label>
              <input
                id="rg-max"
                v-model="regra.maxSimultaneos"
                type="number"
                min="1"
                max="10"
                data-testid="rg-max"
              />
            </span>
            <span class="campo">
              <label for="rg-idade">{{ t('portaria.regras.idade') }}</label>
              <input id="rg-idade" v-model="regra.idadeMinima" type="number" min="0" max="18" />
            </span>
            <span class="campo">
              <label for="rg-duracao">{{ t('portaria.regras.duracao') }}</label>
              <input
                id="rg-duracao"
                v-model="regra.duracaoMaxMin"
                type="number"
                min="15"
                max="1440"
                data-testid="rg-duracao"
              />
            </span>
            <label class="barra">
              <input v-model="regra.uti" type="checkbox" />
              {{ t('portaria.regras.uti') }}
            </label>
          </div>
          <SanteOpcoes
            v-model="regra.isolamento"
            :legenda="t('portaria.regras.isolamentoCol')"
            :opcoes="opcoesIsolamento"
            nome="rg-isolamento"
          />
          <span class="campo">
            <label for="rg-obs">{{ t('portaria.regras.observacao') }}</label>
            <input id="rg-obs" v-model="regra.observacao" maxlength="200" />
          </span>
          <SanteBotao
            tipo="submit"
            :rotulo="t('portaria.regras.gravar')"
            :desabilitado="!pode('regrar')"
            data-testid="rg-gravar"
          />
        </form>
      </section>

      <section class="cartao" aria-labelledby="rg-bloqueios">
        <h2 id="rg-bloqueios">{{ t('portaria.bloqueios.titulo') }}</h2>
        <p class="secundario">{{ t('portaria.bloqueios.ajuda') }}</p>
        <form class="registro" data-testid="rg-form-bloqueio" @submit.prevent="bloquear">
          <div class="campos">
            <SanteSelecao
              v-model="unidadeBloqueio"
              :rotulo="t('portaria.regras.unidade')"
              :opcoes="[
                { valor: '', rotulo: '—' },
                ...(p.unidades ?? []).map((u) => ({ valor: u.unidade, rotulo: u.nome })),
              ]"
              data-testid="rg-bloq-unidade"
            />
            <SanteSelecao
              v-model="bloqueio.internacao"
              :rotulo="t('portaria.bloqueios.paciente')"
              :opcoes="opcoesInternados"
              data-testid="rg-bloq-paciente"
            />
            <SanteSelecao
              v-model="bloqueio.motivo"
              :rotulo="t('portaria.bloqueios.motivo')"
              :opcoes="opcoesMotivo"
              data-testid="rg-bloq-motivo"
            />
            <SanteSelecao
              v-if="bloqueio.motivo !== 'sigilo'"
              v-model="bloqueio.abrangencia"
              :rotulo="t('portaria.bloqueios.abrangencia')"
              :opcoes="opcoesAbrangencia"
              data-testid="rg-bloq-abrangencia"
            />
            <span v-if="bloqueio.abrangencia === 'limite' && bloqueio.motivo !== 'sigilo'" class="campo">
              <label for="rg-bloq-limite">{{ t('portaria.bloqueios.limite') }}</label>
              <input id="rg-bloq-limite" v-model="bloqueio.limite" type="number" min="1" max="10" />
            </span>
            <span v-if="bloqueio.motivo === 'judicial'" class="campo">
              <label for="rg-bloq-documento">{{ t('portaria.bloqueios.documento') }}</label>
              <input
                id="rg-bloq-documento"
                v-model="bloqueio.documento"
                maxlength="60"
                data-testid="rg-bloq-documento"
              />
            </span>
            <span class="campo">
              <label for="rg-bloq-fim">{{ t('portaria.bloqueios.fim') }}</label>
              <input id="rg-bloq-fim" v-model="bloqueio.fim" type="date" />
            </span>
          </div>
          <div v-if="bloqueio.abrangencia === 'visitante' && bloqueio.motivo !== 'sigilo'" class="barra">
            <span class="campo">
              <label for="rg-bloq-busca">{{ t('portaria.bloqueios.buscaPessoa') }}</label>
              <input id="rg-bloq-busca" v-model="buscaPessoa" maxlength="70" data-testid="rg-bloq-busca" />
            </span>
            <SanteBotao
              variante="secundario"
              :rotulo="t('portaria.visitante.buscar')"
              :desabilitado="buscaPessoa.trim().length < 3"
              @acionar="buscarPessoa"
            />
            <SanteSelecao
              v-model="pessoa"
              :rotulo="t('portaria.bloqueios.pessoa')"
              :opcoes="opcoesPessoas"
              data-testid="rg-bloq-pessoa"
            />
          </div>
          <label v-if="bloqueio.motivo === 'judicial'" class="barra">
            <input v-model="bloqueio.incluiAcompanhante" type="checkbox" />
            {{ t('portaria.bloqueios.incluiAcompanhante') }}
          </label>
          <span class="campo">
            <label for="rg-bloq-just">{{ t('portaria.bloqueios.justificativa') }}</label>
            <input
              id="rg-bloq-just"
              v-model="bloqueio.justificativa"
              maxlength="200"
              data-testid="rg-bloq-justificativa"
            />
          </span>
          <SanteBotao
            tipo="submit"
            :rotulo="t('portaria.bloqueios.bloquear')"
            :desabilitado="!prontoParaBloquear"
            data-testid="rg-bloquear"
          />
        </form>
        <p v-if="p.bloqueios.length === 0">{{ t('portaria.bloqueios.nenhum') }}</p>
        <div v-else class="rolagem">
          <table class="grade" data-testid="rg-bloqueios">
            <thead>
              <tr>
                <th scope="col">{{ t('portaria.bloqueios.paciente') }}</th>
                <th scope="col">{{ t('portaria.bloqueios.motivo') }}</th>
                <th scope="col">{{ t('portaria.bloqueios.abrangencia') }}</th>
                <th scope="col">{{ t('portaria.bloqueios.justificativa') }}</th>
                <th scope="col">{{ t('portaria.bloqueios.vigencia') }}</th>
                <th scope="col">{{ t('portaria.acoes') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="b in p.bloqueios" :key="b.id" :data-testid="`rg-bloqueio-${b.id}`">
                <td>{{ b.paciente }} · {{ b.unidade }}</td>
                <td>
                  {{ t(`portaria.motivos.${b.motivo}`)
                  }}<span v-if="b.documento" class="secundario"> · {{ b.documento }}</span>
                </td>
                <td>
                  {{ t(`portaria.abrangencias.${b.abrangencia}`) }}
                  <span v-if="b.visitante" class="secundario"> · {{ b.visitante.nome }}</span>
                  <span v-if="b.limite" class="secundario"> · {{ b.limite }}</span>
                  <span v-if="b.incluiAcompanhante" class="secundario">
                    · {{ t('portaria.bloqueios.comAcompanhante') }}</span
                  >
                </td>
                <td>{{ b.justificativa }}</td>
                <td>
                  {{
                    t('portaria.bloqueios.periodo', {
                      inicio: hora(b.inicio),
                      fim: b.fim
                        ? t('portaria.bloqueios.ateData', {
                            data: `${b.fim.slice(8, 10)}/${b.fim.slice(5, 7)}/${b.fim.slice(0, 4)}`,
                          })
                        : t('portaria.bloqueios.ateRevogar'),
                    })
                  }}
                </td>
                <td>
                  <SanteBotao
                    v-if="b.motivo !== 'clinico'"
                    variante="texto"
                    :rotulo="t('portaria.bloqueios.revogar')"
                    :desabilitado="!pode('regrar')"
                    :data-testid="`rg-revogar-${b.id}`"
                    @acionar="revogando = b.id"
                  />
                  <span v-else class="secundario">{{ t('portaria.bloqueios.daEnfermagem') }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="cartao" aria-labelledby="rg-expurgo">
        <h2 id="rg-expurgo">{{ t('portaria.expurgo.titulo') }}</h2>
        <p data-testid="rg-vencidos">{{ t('portaria.expurgo.texto', { n: p.vencidos }) }}</p>
        <SanteBotao
          variante="destrutivo"
          :rotulo="t('portaria.expurgo.executar')"
          :confirmacao="t('portaria.expurgo.confirmar')"
          :desabilitado="!pode('regrar') || p.vencidos === 0"
          @acionar="executar(() => expurgarVisitantes())"
        />
      </section>
    </template>

    <SanteDialogo v-model:visivel="dialogoRevogar" :titulo="t('portaria.bloqueios.revogar')">
      <div class="campo">
        <label for="rg-motivo">{{ t('portaria.bloqueios.motivoRevogacao') }}</label>
        <input id="rg-motivo" v-model="motivoRevogacao" maxlength="200" data-testid="rg-motivo-revogacao" />
        <SanteBotao
          :rotulo="t('portaria.confirmar')"
          :desabilitado="motivoRevogacao.trim().length < 10"
          data-testid="rg-revogar-confirmar"
          @acionar="revogar"
        />
      </div>
    </SanteDialogo>
  </section>
</template>

<style src="../estilo-portaria.css"></style>
