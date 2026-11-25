<script setup lang="ts">
// Conferência, liberação e retificação (ficha do M26, seção 7): `/sadt/resultados/liberacao`. Os resultados digitados
// a conferir com os valores, a referência e o valor crítico destacado; libera o responsável técnico habilitado da
// sessão (decidido no servidor pelo vínculo; regra 8). O crítico pede a confirmação e o aviso sai na mesma gravação.
// Os liberados ficam abaixo, por dia e por paciente ou atendimento (o resultado liberado ontem também se retifica), com a
// retificação (motivo obrigatório; a versão anterior fica guardada e quem já viu é avisado, regra 4) e o histórico das
// versões. Daqui se chega ao painel do valor crítico (avisos, comunicação, faixas e prazos) e aos indicadores (TAT).
import { SanteAlerta, SanteBotao, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { pode as podePermissao } from '../../../casca/sessao/pode.js';
import { liberarResultadoDoExame, retificarResultadoDoExame } from '../api-resultado.js';
import {
  lerConferencia,
  lerDigitacao,
  listarExamesSadt,
  listarLiberacao,
  novaChave,
  retificarResultado,
} from '../api-sadt.js';
import AvisoSadt from '../componentes/AvisoSadt.vue';
import ErroSadt from '../componentes/ErroSadt.vue';
import PacienteSadt from '../componentes/PacienteSadt.vue';
import { hojeLocal, quando, usarSadt } from '../usar-sadt.js';

const { t } = useI18n();
const cliente = useQueryClient();
const setor = ref('laboratorio');
const { gravacao, pode, motivoSetor } = usarSadt(setor);
const fila = useQuery({
  queryKey: computed(() => ['sadt', 'liberacao', setor.value]),
  queryFn: () => listarLiberacao(setor.value),
});
const veCriticos = podePermissao('sadt.valorCritico.ler');
const veIndicadores = podePermissao('sadt.indicador.ler');
const dataLiberados = ref(hojeLocal());
const termoLiberados = ref('');
const termoAplicado = ref('');
const liberados = useQuery({
  queryKey: computed(() => [
    'sadt',
    'exames',
    'liberados',
    setor.value,
    dataLiberados.value,
    termoAplicado.value,
  ]),
  queryFn: () =>
    listarExamesSadt({
      setor: setor.value,
      data: dataLiberados.value || hojeLocal(),
      situacao: 'liberados',
      termo: termoAplicado.value || null,
    }),
});
const setores = computed(() =>
  (['laboratorio', 'imagem', 'metodosGraficos', 'endoscopia'] as const).map((s) => ({
    valor: s,
    rotulo: t(`sadt.setores.${s}`),
  })),
);
const podeLiberar = computed(() => pode(setor.value, 'sadt.liberarExame'));
const podeRetificar = computed(() => pode(setor.value, 'sadt.retificarResultado'));
const habilitacao = computed(() => gravacao.data.value?.habilitacao);
const confirmados = ref<Record<number, boolean>>({});
const ocupado = ref(false);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
async function liberar(id: number, versao: string | null): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const r = await liberarResultadoDoExame(
      { id, versao },
      confirmados.value[id] === true,
      novaChave('liberar'),
    );
    mensagem.value =
      r.mensagem ?? t(r.gravado?.critico ? 'sadt.liberacao.liberadoCritico' : 'sadt.liberacao.liberado');
    await cliente.invalidateQueries({ queryKey: ['sadt'] });
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}

// ── Retificação ─────────────────────────────────────────────────────────────────────────────────────
const retificando = ref(false);
const alvo = ref<number | null>(null);
const motivo = ref('');
const novos = ref<Record<number, string>>({});
const ficha = useQuery({
  queryKey: computed(() => ['sadt', 'digitacao', alvo.value]),
  queryFn: () => lerDigitacao(alvo.value as number),
  enabled: computed(() => alvo.value !== null),
});
// O histórico das versões do resultado (liberada e retificadas, com o motivo e quantos já tinham visto).
const conferencia = useQuery({
  queryKey: computed(() => ['sadt', 'conferencia', alvo.value]),
  queryFn: () => lerConferencia(alvo.value as number),
  enabled: computed(() => alvo.value !== null),
});
function abrirRetificacao(id: number) {
  alvo.value = id;
  motivo.value = '';
  novos.value = {};
  retificando.value = true;
}
/** Validação na hora: a retificação de valores só grava com ao menos um valor novo digitado. */
const temMudanca = computed(() => Object.values(novos.value).some((v) => (v ?? '').trim() !== ''));
async function retificar(): Promise<void> {
  const f = ficha.data.value;
  if (!f) return;
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const elementos = Object.entries(novos.value)
      .filter(([, v]) => v.trim() !== '')
      .map(([k, v]) => {
        const n = Number(v.replace(',', '.'));
        return {
          elemento: Number(k),
          numerico: Number.isFinite(n) ? n : null,
          alfa: Number.isFinite(n) ? null : v.trim(),
        };
      });
    // Sem valor mudado e com laudo, é a retificação do laudo (texto), que segue pela operação do laudo.
    const r =
      f.laudo && elementos.length === 0
        ? {
            gravado: null,
            mensagem: (
              await retificarResultado(
                f.exame.id,
                {
                  versao: f.exame.versao,
                  motivo: motivo.value,
                  elementos: [],
                  laudo: { texto: f.laudo.texto, html: f.laudo.html },
                },
                novaChave('retificar'),
              )
            ).mensagem,
          }
        : await retificarResultadoDoExame(
            f.exame,
            { elementos, motivo: motivo.value },
            novaChave('retificar'),
          );
    mensagem.value =
      r.mensagem ?? t(r.gravado?.critico ? 'sadt.liberacao.retificadoCritico' : 'sadt.liberacao.retificado');
    retificando.value = false;
    await cliente.invalidateQueries({ queryKey: ['sadt'] });
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="liberacao-titulo" data-testid="tela-sadt-liberacao">
    <h1 id="liberacao-titulo">{{ t('sadt.liberacao.titulo') }}</h1>
    <p>{{ t('sadt.liberacao.texto') }}</p>
    <AvisoSadt :motivo="motivoSetor" />
    <p
      v-if="habilitacao && !habilitacao.liberarLaboratorio && setor === 'laboratorio'"
      role="status"
      data-testid="liberacao-sem-habilitacao"
    >
      {{ t('sadt.liberacao.habilitacao', { motivo: habilitacao.motivo ?? '' }) }}
    </p>
    <p v-if="veCriticos || veIndicadores" class="acoes">
      <RouterLink v-if="veCriticos" to="/sadt/valores-criticos" data-testid="liberacao-ir-criticos">{{
        t('sadt.criticos.titulo')
      }}</RouterLink>
      <RouterLink v-if="veIndicadores" to="/sadt/indicadores" data-testid="liberacao-ir-indicadores">{{
        t('sadt.parametros.titulo')
      }}</RouterLink>
    </p>
    <div class="filtros">
      <SanteSelecao v-model="setor" :rotulo="t('sadt.setor')" :opcoes="setores" />
    </div>
    <ErroSadt v-if="fila.isError.value" :erro="fila.error.value" />
    <p v-else-if="!fila.data.value" role="status">{{ t('sadt.carregando') }}</p>
    <p v-else-if="fila.data.value.itens.length === 0">{{ t('sadt.nenhum') }}</p>
    <div
      v-for="i in fila.data.value?.itens ?? []"
      :key="i.exame.id"
      class="painel"
      :data-testid="`liberacao-${i.exame.id}`"
    >
      <h2>{{ i.exame.exame.nome }}</h2>
      <p>
        <PacienteSadt :paciente="i.exame.paciente" />
        <span v-if="i.digitadoPor" class="secundario">
          · {{ t('sadt.liberacao.digitadoPor', { quem: i.digitadoPor }) }}</span
        >
      </p>
      <SanteAlerta
        v-if="i.critico"
        variante="alerta"
        :texto="t('sadt.critico')"
        data-testid="liberacao-critico"
      />
      <table class="tabela">
        <caption>
          {{
            t('sadt.valor')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('sadt.digitacao.elemento') }}</th>
            <th scope="col">{{ t('sadt.valor') }}</th>
            <th scope="col">{{ t('sadt.referencia') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="v in i.valores" :key="v.elemento">
            <td>{{ v.elemento }}</td>
            <td>
              <strong v-if="v.critico || v.foraDaFaixa">{{ v.valor }} {{ v.unidade ?? '' }}</strong>
              <template v-else>{{ v.valor }} {{ v.unidade ?? '' }}</template>
              <span v-if="v.critico" class="secundario"> · {{ t('sadt.critico') }}</span>
              <span v-else-if="v.foraDaFaixa" class="secundario"> · {{ t('sadt.digitacao.fora') }}</span>
            </td>
            <td>{{ v.referencia ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
      <div v-if="podeLiberar" class="acoes">
        <label v-if="i.critico">
          <input
            v-model="confirmados[i.exame.id]"
            type="checkbox"
            :data-testid="`liberacao-confirmar-${i.exame.id}`"
          />
          {{ t('sadt.liberacao.confirmarCritico') }}
        </label>
        <SanteBotao
          :rotulo="t('sadt.liberacao.liberar')"
          :desabilitado="ocupado || (i.critico && !confirmados[i.exame.id])"
          :data-testid="`liberacao-liberar-${i.exame.id}`"
          @acionar="liberar(i.exame.id, i.exame.versao)"
        />
      </div>
    </div>

    <section class="painel" aria-labelledby="liberados-titulo">
      <h2 id="liberados-titulo">{{ t('sadt.situacoes.liberados') }}</h2>
      <form class="filtros" @submit.prevent="termoAplicado = termoLiberados.trim()">
        <span class="campo">
          <label for="liberados-data">{{ t('sadt.data') }}</label>
          <input id="liberados-data" v-model="dataLiberados" type="date" data-testid="liberados-data" />
        </span>
        <span class="campo">
          <label for="liberados-termo">{{ t('sadt.liberacao.buscarLiberados') }}</label>
          <input id="liberados-termo" v-model="termoLiberados" type="search" data-testid="liberados-termo" />
        </span>
        <SanteBotao tipo="submit" variante="secundario" :rotulo="t('sadt.buscar')" />
      </form>
      <ErroSadt v-if="liberados.isError.value" :erro="liberados.error.value" />
      <p v-else-if="!liberados.data.value" role="status">{{ t('sadt.carregando') }}</p>
      <p v-else-if="liberados.data.value.itens.length === 0">{{ t('sadt.nenhum') }}</p>
      <table v-else class="tabela" data-testid="tabela-liberados">
        <caption>
          {{
            t('sadt.situacoes.liberados')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('sadt.paciente') }}</th>
            <th scope="col">{{ t('sadt.exame') }}</th>
            <th scope="col">{{ t('sadt.situacao') }}</th>
            <th scope="col">{{ t('sadt.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in liberados.data.value?.itens ?? []" :key="e.id">
            <td><PacienteSadt :paciente="e.paciente" /></td>
            <td>
              {{ e.exame.nome }} <span class="secundario">· {{ quando(e.pedidoEm) }}</span>
            </td>
            <td>{{ e.estadoRotulo }}</td>
            <td>
              <SanteBotao
                v-if="podeRetificar"
                variante="secundario"
                :rotulo="t('sadt.liberacao.retificar')"
                :data-testid="`liberados-retificar-${e.id}`"
                @acionar="abrirRetificacao(e.id)"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <SanteDialogo v-model:visivel="retificando" :titulo="t('sadt.liberacao.retificarTitulo')">
      <p>{{ t('sadt.liberacao.retificarTexto') }}</p>
      <template v-if="ficha.data.value">
        <span v-for="el in ficha.data.value.elementos" :key="el.codigo" class="campo">
          <label :for="`retificar-${el.codigo}`"
            >{{ el.nome }} ({{ el.valor?.numerico ?? el.valor?.alfa ?? '—' }})</label
          >
          <input
            :id="`retificar-${el.codigo}`"
            v-model="novos[el.codigo]"
            :data-testid="`retificar-valor-${el.codigo}`"
          />
        </span>
      </template>
      <section
        v-if="conferencia.data.value?.versoes.length"
        aria-labelledby="retificar-versoes"
        data-testid="retificar-versoes"
      >
        <h3 id="retificar-versoes">{{ t('sadt.liberacao.versoes') }}</h3>
        <ul>
          <li v-for="v in conferencia.data.value.versoes" :key="v.versao">
            {{
              t('sadt.liberacao.versao', {
                n: v.versao,
                em: quando(v.em),
                motivo: v.motivo ? ` · ${v.motivo}` : '',
              })
            }}
            <span class="secundario"> · {{ t('sadt.liberacao.viramAntes', { n: v.viramAntes }) }}</span>
          </li>
        </ul>
      </section>
      <span class="campo">
        <label for="retificar-motivo">{{ t('sadt.motivo') }}</label>
        <textarea id="retificar-motivo" v-model="motivo" rows="2" data-testid="retificar-motivo" />
      </span>
      <template #rodape>
        <SanteBotao variante="texto" :rotulo="t('sadt.cancelar')" @acionar="retificando = false" />
        <SanteBotao
          :rotulo="t('sadt.liberacao.retificar')"
          :desabilitado="ocupado || motivo.trim().length < 5 || (!temMudanca && !ficha.data.value?.laudo)"
          data-testid="retificar-gravar"
          @acionar="retificar"
        />
      </template>
    </SanteDialogo>
    <p v-if="mensagem" role="status" data-testid="liberacao-mensagem">{{ mensagem }}</p>
    <ErroSadt v-if="erro" :erro="erro" />
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
