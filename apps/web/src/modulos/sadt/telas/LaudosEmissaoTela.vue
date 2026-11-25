<script setup lang="ts">
// Laudos: emissão, impressão e autenticação (ficha do M26, seção 7; regra 11): `/sadt/laudos/emissao`. Os exames
// liberados do dia por atendimento; emitir junta os do mesmo atendimento num laudo em PDF/A com o código de
// autenticação e o QR da validação pública (sem conteúdo clínico); reemitir gera a 2ª via, com o motivo. O PDF abre
// como arquivo do navegador. Cada exame mostra as emissões e as 2ªs vias (código, quando, quem); o código de
// autenticação impresso se confere aqui.
import type { ExameSadt } from '@sgh/contratos';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  abrirPdf,
  conferirCodigoLaudo,
  emitirLaudo,
  listarExamesSadt,
  listarLaudosDoExame,
  novaChave,
} from '../api-sadt.js';
import AvisoSadt from '../componentes/AvisoSadt.vue';
import ErroSadt from '../componentes/ErroSadt.vue';
import PacienteSadt from '../componentes/PacienteSadt.vue';
import { hojeLocal, quando, usarSadt } from '../usar-sadt.js';

const { t } = useI18n();
const cliente = useQueryClient();
const setor = ref('laboratorio');
const data = ref(hojeLocal());
const { pode, motivoSetor, gravacao } = usarSadt(setor);
const lista = useQuery({
  queryKey: computed(() => ['sadt', 'exames', 'liberados', setor.value, data.value]),
  queryFn: () => listarExamesSadt({ setor: setor.value, data: data.value, situacao: 'liberados' }),
});
const setores = computed(() =>
  (['laboratorio', 'imagem', 'metodosGraficos', 'endoscopia'] as const).map((s) => ({
    valor: s,
    rotulo: t(`sadt.setores.${s}`),
  })),
);
/** Os liberados por atendimento (um laudo junta os exames do mesmo atendimento). */
const grupos = computed(() => {
  const m = new Map<string, ExameSadt[]>();
  for (const e of lista.data.value?.itens ?? [])
    m.set(e.atendimento.cabecalho, [...(m.get(e.atendimento.cabecalho) ?? []), e]);
  return [...m.entries()].map(([atendimento, exames]) => ({ atendimento, exames }));
});
const podeImprimir = computed(
  () =>
    gravacao.data.value !== undefined &&
    (pode(setor.value, 'sadt.emitirLaudo') ||
      gravacao.data.value.setores[setor.value as 'laboratorio']?.ligada === true),
);
// As emissões de um exame (o novo e as impressões do outro sistema), abertas sob demanda.
const historicoDe = ref<number | null>(null);
const historico = useQuery({
  queryKey: computed(() => ['sadt', 'laudos', 'exame', historicoDe.value]),
  queryFn: () => listarLaudosDoExame(historicoDe.value as number),
  enabled: computed(() => historicoDe.value !== null),
});
// A conferência do código de autenticação impresso no laudo.
const codigo = ref('');
const conferindo = ref(false);
const conferido = ref<{
  valido: boolean;
  superado?: boolean | undefined;
  numero: string | null;
  emitidoEm: string | null;
  exames: number;
} | null>(null);
const erroCodigo = ref<unknown>(null);
async function conferirCodigo(): Promise<void> {
  conferido.value = null;
  erroCodigo.value = null;
  conferindo.value = true;
  try {
    conferido.value = await conferirCodigoLaudo(codigo.value);
  } catch (x) {
    erroCodigo.value = x;
  } finally {
    conferindo.value = false;
  }
}
const motivoVia = ref<Record<string, string>>({});
const ocupado = ref(false);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
async function emitir(atendimento: string, exames: readonly ExameSadt[], segundaVia: boolean): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const r = await emitirLaudo(
      {
        exames: exames.map((e) => e.id),
        segundaVia,
        ...(segundaVia ? { motivoSegundaVia: motivoVia.value[atendimento] ?? '' } : {}),
      },
      novaChave(segundaVia ? 'via' : 'laudo'),
    );
    mensagem.value = r.mensagem;
    if (r.pdf) abrirPdf(r.pdf, `laudo-${r.codigo}.pdf`);
    await cliente.invalidateQueries({ queryKey: ['sadt'] });
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="laudos-titulo" data-testid="tela-sadt-laudos">
    <h1 id="laudos-titulo">{{ t('sadt.laudos.titulo') }}</h1>
    <p>{{ t('sadt.laudos.texto') }}</p>
    <AvisoSadt :motivo="motivoSetor" />
    <div class="filtros">
      <SanteSelecao v-model="setor" :rotulo="t('sadt.setor')" :opcoes="setores" />
      <span class="campo">
        <label for="laudos-data">{{ t('sadt.data') }}</label>
        <input id="laudos-data" v-model="data" type="date" />
      </span>
    </div>
    <form class="filtros" data-testid="laudos-conferir" @submit.prevent="conferirCodigo">
      <span class="campo">
        <label for="laudos-codigo">{{ t('sadt.laudos.codigo') }}</label>
        <input id="laudos-codigo" v-model="codigo" maxlength="40" data-testid="laudos-codigo" />
      </span>
      <SanteBotao
        tipo="submit"
        variante="secundario"
        :rotulo="t('sadt.laudos.conferir')"
        :desabilitado="conferindo || codigo.trim().length < 8"
      />
    </form>
    <p v-if="conferindo" role="status">{{ t('sadt.carregando') }}</p>
    <p v-else-if="conferido" role="status" data-testid="laudos-codigo-resultado">
      {{
        conferido.valido
          ? t('sadt.laudos.validoNumero', {
              numero: conferido.numero ?? '',
              em: quando(conferido.emitidoEm),
              n: conferido.exames,
            })
          : t('sadt.portal.invalido')
      }}
      <strong v-if="conferido.valido && conferido.superado" data-testid="laudos-codigo-superado">
        {{ t('sadt.laudos.superado') }}
      </strong>
    </p>
    <ErroSadt v-if="erroCodigo" :erro="erroCodigo" />
    <ErroSadt v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!lista.data.value" role="status">{{ t('sadt.carregando') }}</p>
    <p v-else-if="grupos.length === 0">{{ t('sadt.nenhum') }}</p>
    <div
      v-for="g in grupos"
      :key="g.atendimento"
      class="painel"
      :data-testid="`laudo-atendimento-${g.atendimento}`"
    >
      <h2>{{ t('sadt.atendimento') }} {{ g.atendimento }}</h2>
      <p><PacienteSadt :paciente="g.exames[0]!.paciente" /></p>
      <ul>
        <li v-for="e in g.exames" :key="e.id">
          {{ e.exame.nome }} · {{ e.estadoRotulo }}
          <SanteBotao
            variante="texto"
            :rotulo="t('sadt.laudos.emitidos')"
            :data-testid="`laudo-historico-${e.id}`"
            @acionar="historicoDe = historicoDe === e.id ? null : e.id"
          />
          <template v-if="historicoDe === e.id">
            <p v-if="historico.isLoading.value" role="status">{{ t('sadt.carregando') }}</p>
            <ErroSadt v-else-if="historico.isError.value" :erro="historico.error.value" />
            <p v-else-if="(historico.data.value ?? []).length === 0">{{ t('sadt.laudos.nenhumaEmissao') }}</p>
            <ul v-else :data-testid="`laudo-emissoes-${e.id}`">
              <li v-for="l in historico.data.value" :key="l.codigo">
                {{
                  t('sadt.laudos.emissao', {
                    numero: l.numero,
                    codigo: l.codigo,
                    em: quando(l.emitidoEm),
                    por: l.emitidoPor,
                    vias: l.segundasVias,
                  })
                }}
              </li>
            </ul>
          </template>
        </li>
      </ul>
      <div v-if="podeImprimir" class="filtros">
        <SanteBotao
          v-if="g.exames.some((e) => e.estado === 'liberado')"
          :rotulo="t('sadt.laudos.emitir')"
          :desabilitado="ocupado"
          :data-testid="`laudo-emitir-${g.atendimento}`"
          @acionar="emitir(g.atendimento, g.exames, false)"
        />
        <template v-else>
          <span class="campo">
            <label :for="`via-${g.atendimento}`">{{ t('sadt.laudos.motivoSegundaVia') }}</label>
            <input
              :id="`via-${g.atendimento}`"
              v-model="motivoVia[g.atendimento]"
              :data-testid="`laudo-motivo-${g.atendimento}`"
            />
          </span>
          <SanteBotao
            variante="secundario"
            :rotulo="t('sadt.laudos.segundaVia')"
            :desabilitado="ocupado || (motivoVia[g.atendimento] ?? '').trim().length < 5"
            :data-testid="`laudo-via-${g.atendimento}`"
            @acionar="emitir(g.atendimento, g.exames, true)"
          />
        </template>
      </div>
    </div>
    <p v-if="mensagem" role="status" data-testid="laudos-mensagem">{{ mensagem }}</p>
    <ErroSadt v-if="erro" :erro="erro" />
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
