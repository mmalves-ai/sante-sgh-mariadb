<script setup lang="ts">
// A regra do banco de horas de cada regime (M52.4; tela "Regimes e banco de horas"; `pessoas.regime.ler` / `.editar`;
// regra 14): o destino das horas extras e o início de cada ciclo pelos códigos do ramo, o primeiro ciclo, a duração do
// ciclo e se a falta debita. O saldo de cada colaborador é a soma dos movimentos (no espelho de ponto), nunca editável.
// W0-06: a regra se desativa e se reativa com motivo (a desativada não lança no banco nos próximos fechamentos).
import { DESTINOS_BANCO, type DestinoBanco, INICIOS_BANCO, type InicioBanco } from '@sgh/contratos';
import { SanteBotao, SanteCampoTexto, SanteOpcoes, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import DialogoMotivo from '../componentes/DialogoMotivo.vue';
import ErroPessoas from '../componentes/ErroPessoas.vue';
import { lerRegimes } from '../api-escala.js';
import { gravarRegraBanco, lerRegrasBanco, situacaoRegraBanco } from './api-ponto.js';

const props = defineProps<{ podeEditar: boolean }>();
const { t } = useI18n();
const qc = useQueryClient();
const regimes = useQuery({ queryKey: ['pessoas', 'regimes', 'lista'], queryFn: lerRegimes });
const regras = useQuery({ queryKey: ['ponto', 'regras-banco'], queryFn: lerRegrasBanco });
const regime = ref<number | null>(null);
const destino = ref<number | null>(2);
const inicio = ref<number | null>(4);
const desde = ref('');
const ciclo = ref('6');
const faltaDebita = ref<'sim' | 'nao'>('nao');
const erro = ref<unknown>(null);
const aviso = ref<string | null>(null);
const atual = computed(() => regras.data.value?.itens.find((r) => r.regime === regime.value) ?? null);
watch(atual, (r) => {
  if (!r) return;
  destino.value = r.destino;
  inicio.value = r.inicio;
  desde.value = r.desde;
  ciclo.value = String(r.cicloMeses);
  faltaDebita.value = r.faltaDebita ? 'sim' : 'nao';
});
const nomeRegime = (id: number) => regimes.data.value?.itens.find((r) => r.id === id)?.nome ?? String(id);
const opcoesRegime = computed(() =>
  (regimes.data.value?.itens ?? []).map((r) => ({ valor: r.id, rotulo: `${r.codigo} · ${r.nome}` })),
);
const opcoesDestino = ([1, 2, 3] as const).map((c) => ({ valor: c, rotulo: DESTINOS_BANCO[c] }));
const opcoesInicio = ([1, 2, 3, 4] as const).map((c) => ({ valor: c, rotulo: INICIOS_BANCO[c] }));
const opcoesFalta = computed(() => [
  { valor: 'nao' as const, rotulo: 'Não' },
  { valor: 'sim' as const, rotulo: 'Sim' },
]);
const valido = computed(
  () =>
    regime.value !== null &&
    destino.value !== null &&
    inicio.value !== null &&
    /^\d{4}-(0[1-9]|1[0-2])$/.test(desde.value) &&
    /^([1-9]|1[0-2])$/.test(ciclo.value),
);
const dialogoSituacao = ref(false);
const mudando = ref<{ regime: number; versao: number; ativo: boolean } | null>(null);
function pedirSituacao(r: { regime: number; versao: number; ativo?: boolean }): void {
  mudando.value = { regime: r.regime, versao: r.versao, ativo: r.ativo === false };
  dialogoSituacao.value = true;
}
const mudarSituacao = (motivo: string) =>
  situacaoRegraBanco(mudando.value!.regime, {
    versao: mudando.value!.versao,
    ativo: mudando.value!.ativo,
    motivo,
  });
async function aposSituacao(r: unknown): Promise<void> {
  aviso.value = (r as { mensagem: string }).mensagem;
  await qc.invalidateQueries({ queryKey: ['ponto', 'regras-banco'] });
}
async function gravar(): Promise<void> {
  if (!valido.value) return;
  erro.value = null;
  try {
    const r = await gravarRegraBanco({
      regime: regime.value!,
      destino: destino.value!,
      inicio: inicio.value!,
      desde: desde.value,
      cicloMeses: Number(ciclo.value),
      faltaDebita: faltaDebita.value === 'sim',
      versao: atual.value?.versao ?? null,
    });
    aviso.value = r.mensagem;
    await qc.invalidateQueries({ queryKey: ['ponto', 'regras-banco'] });
  } catch (x) {
    erro.value = x;
  }
}
</script>

<template>
  <section class="bloco" aria-labelledby="regra-banco-titulo" data-testid="bloco-regra-banco">
    <h2 id="regra-banco-titulo">{{ t('ponto.regra.titulo') }}</h2>
    <p class="secundario">{{ t('ponto.regra.ajuda') }}</p>
    <ErroPessoas v-if="regras.isError.value" :erro="regras.error.value" />
    <table
      v-else-if="(regras.data.value?.itens.length ?? 0) > 0"
      class="tabela"
      data-testid="tabela-regras-banco"
    >
      <thead>
        <tr>
          <th scope="col">{{ t('ponto.regra.regime') }}</th>
          <th scope="col">{{ t('ponto.regra.destino') }}</th>
          <th scope="col">{{ t('ponto.regra.inicio') }}</th>
          <th scope="col">{{ t('ponto.regra.ciclo') }}</th>
          <th scope="col">{{ t('pessoas.acoes') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in regras.data.value?.itens ?? []" :key="r.regime">
          <th scope="row">{{ nomeRegime(r.regime) }}</th>
          <td>{{ DESTINOS_BANCO[r.destino as DestinoBanco] }}</td>
          <td>{{ INICIOS_BANCO[r.inicio as InicioBanco] }}</td>
          <td>
            {{ r.cicloMeses }} · {{ r.desde }}
            <span v-if="r.ativo === false" class="secundario" :data-testid="`regra-inativa-${r.regime}`">
              · {{ t('pessoas.crud.regraInativa', { motivo: r.motivoSituacao ?? '' }) }}
            </span>
          </td>
          <td>
            <SanteBotao
              v-if="props.podeEditar"
              :rotulo="r.ativo === false ? t('pessoas.crud.reativarRegra') : t('pessoas.crud.desativarRegra')"
              variante="texto"
              :data-testid="`situacao-regra-${r.regime}`"
              @acionar="pedirSituacao(r)"
            />
          </td>
        </tr>
      </tbody>
    </table>
    <DialogoMotivo
      v-model:visivel="dialogoSituacao"
      :titulo="t('pessoas.crud.regraTitulo')"
      :texto="mudando?.ativo ? t('pessoas.crud.reativarTexto') : t('pessoas.crud.desativarTexto')"
      :confirmar="mudando?.ativo ? t('pessoas.crud.reativarRegra') : t('pessoas.crud.desativarRegra')"
      :variante="mudando?.ativo ? 'primario' : 'destrutivo'"
      :acao="mudarSituacao"
      testid="dialogo-situacao-regra"
      @feito="aposSituacao"
    />
    <form
      v-if="props.podeEditar"
      class="campos"
      :aria-label="t('ponto.regra.gravar')"
      @submit.prevent="gravar"
    >
      <SanteSelecao
        v-model="regime"
        :rotulo="t('ponto.regra.regime')"
        :opcoes="opcoesRegime"
        data-testid="regra-regime"
      />
      <SanteSelecao
        v-model="destino"
        :rotulo="t('ponto.regra.destino')"
        :opcoes="opcoesDestino"
        data-testid="regra-destino"
      />
      <SanteSelecao
        v-model="inicio"
        :rotulo="t('ponto.regra.inicio')"
        :opcoes="opcoesInicio"
        data-testid="regra-inicio"
      />
      <SanteCampoTexto v-model="desde" :rotulo="t('ponto.regra.desde')" :max-bytes="7" />
      <SanteCampoTexto v-model="ciclo" :rotulo="t('ponto.regra.ciclo')" :max-bytes="2" />
      <SanteOpcoes v-model="faltaDebita" :legenda="t('ponto.regra.faltaDebita')" :opcoes="opcoesFalta" />
      <ErroPessoas v-if="erro" :erro="erro" />
      <p v-if="aviso" role="status" data-testid="regra-aviso">{{ aviso }}</p>
      <div class="acoes">
        <SanteBotao
          :rotulo="t('ponto.regra.gravar')"
          tipo="submit"
          :desabilitado="!valido"
          data-testid="regra-gravar"
        />
      </div>
    </form>
  </section>
</template>

<style scoped src="../estilo-pessoas.css"></style>
