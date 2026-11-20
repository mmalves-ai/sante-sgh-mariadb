<script setup lang="ts">
// Observação (ficha do M20, seção 7): `/pa/observacao`. Os leitos e as poltronas de observação do pronto atendimento
// com a ocupação e o tempo; o aviso antes e o destaque a partir de 24 h (Portaria SAS 312/2002); pôr o paciente do
// quadro no leito livre e tirar (com 24 h ou mais, só com a justificativa da permanência). W0-07: transferir de leito
// numa operação só (o servidor libera e aloca na mesma transação; se falhar, o paciente fica no leito de origem), com
// o motivo; a contagem das 24 horas continua a da entrada na observação.
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { exigeJustificativaSaida } from '@sgh/dominio-atendimento';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  alocarObservacao,
  lerObservacaoPa,
  lerQuadroPa,
  liberarObservacao,
  novaChave,
  transferirObservacao,
} from '../api-atendimento.js';
import DialogoAlteracaoNir from '../../adt/componentes/DialogoAlteracaoNir.vue';
import AvisoAtendimento from '../componentes/AvisoAtendimento.vue';
import ErroAtendimento from '../componentes/ErroAtendimento.vue';
import { usarAtendimento } from '../usar-atendimento.js';

const { t } = useI18n();
const cliente = useQueryClient();
const { gravacao, motivoPa } = usarAtendimento();
const obs = useQuery({
  queryKey: ['atendimento', 'observacao'],
  queryFn: () => lerObservacaoPa(),
  refetchInterval: 30_000,
});
const quadro = useQuery({ queryKey: ['atendimento', 'quadro'], queryFn: () => lerQuadroPa() });
const podeAlocar = computed(() => gravacao.data.value?.operacoes['pa:observacao']?.pode ?? false);
const ocupados = computed(
  () => new Set((obs.data.value?.leitos ?? []).flatMap((l) => (l.ocupacao ? [l.ocupacao.reg] : []))),
);
const candidatos = computed(() => [
  { valor: '', rotulo: t('atendimento.escolha') },
  ...(quadro.data.value?.colunas ?? [])
    .flatMap((c) => c.cartoes)
    .filter((k) => !ocupados.value.has(k.reg))
    .map((k) => ({ valor: String(k.reg), rotulo: `${k.paciente} (${k.reg})` })),
]);
const escolhido = ref<Record<number, string>>({});
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);
async function alocar(leito: number): Promise<void> {
  const reg = Number(escolhido.value[leito] ?? 0);
  if (!reg) return;
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const r = await alocarObservacao(reg, { leito }, novaChave('observacao'));
    mensagem.value = r.mensagem;
    await cliente.invalidateQueries({ queryKey: ['atendimento'] });
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
// ── W0-07: transferência de leito ──
const transf = ref<{ reg: number; paciente: string; leito: number } | null>(null);
const dTransferir = ref(false);
const refTransferir = ref<InstanceType<typeof DialogoAlteracaoNir> | null>(null);
const destino = ref('');
const destinos = computed(() => [
  { valor: '', rotulo: t('atendimento.escolha') },
  ...(obs.data.value?.leitos ?? [])
    .filter((l) => l.ativo && !l.ocupacao)
    .map((l) => ({ valor: String(l.id), rotulo: `${l.local} · ${l.tipo} ${l.codigo}` })),
]);
function abrirTransferir(reg: number, paciente: string, leito: number): void {
  transf.value = { reg, paciente, leito };
  destino.value = '';
  dTransferir.value = true;
}
function transferir(d: { motivo: string }): void {
  const x = transf.value;
  if (!x || !destino.value) return;
  void refTransferir.value?.executar(async () => {
    const r = await transferirObservacao(
      x.reg,
      { leito: Number(destino.value), motivo: d.motivo },
      novaChave('transferir-observacao'),
    );
    mensagem.value = r.mensagem;
    await cliente.invalidateQueries({ queryKey: ['atendimento'] });
  });
}
const saida = ref<{ reg: number; paciente: string; horas: number } | null>(null);
const justificativa = ref('');
const dialogo = computed({
  get: () => saida.value !== null,
  set: (v: boolean) => {
    if (!v) saida.value = null;
  },
});
async function liberar(): Promise<void> {
  const s = saida.value;
  if (!s) return;
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const r = await liberarObservacao(
      s.reg,
      justificativa.value.trim() ? { justificativa: justificativa.value } : {},
      novaChave('liberar-observacao'),
    );
    mensagem.value = r.mensagem;
    saida.value = null;
    justificativa.value = '';
    await cliente.invalidateQueries({ queryKey: ['atendimento'] });
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
const horasTexto = (h: number) => t('atendimento.horas', { n: String(h).replace('.', ',') });
</script>

<template>
  <section class="tela-agenda" aria-labelledby="obs-titulo" data-testid="tela-observacao-pa">
    <h1 id="obs-titulo">{{ t('atendimento.observacao.titulo') }}</h1>
    <p>{{ t('atendimento.observacao.texto') }}</p>
    <AvisoAtendimento :motivo="motivoPa" />
    <ErroAtendimento v-if="obs.isError.value" :erro="obs.error.value" />
    <p v-else-if="!obs.data.value" role="status">{{ t('atendimento.carregando') }}</p>
    <template v-else>
      <table class="tabela" data-testid="tabela-observacao">
        <caption>
          {{
            t('atendimento.observacao.legenda', {
              n: obs.data.value.leitos.length,
              historico: obs.data.value.historico,
            })
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('atendimento.observacao.leito') }}</th>
            <th scope="col">{{ t('atendimento.paciente') }}</th>
            <th scope="col">{{ t('atendimento.observacao.tempo') }}</th>
            <th scope="col">{{ t('atendimento.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in obs.data.value.leitos" :key="l.id" :data-testid="`leito-${l.id}`">
            <td>{{ l.local }} · {{ l.tipo }} {{ l.codigo }}</td>
            <td>{{ l.ocupacao ? l.ocupacao.paciente : t('atendimento.observacao.livre') }}</td>
            <td>
              <template v-if="l.ocupacao">
                {{ horasTexto(l.ocupacao.horas) }}
                <SanteAlerta
                  v-if="l.ocupacao.alerta === 'aviso'"
                  variante="aviso"
                  :texto="t('atendimento.observacao.aviso')"
                />
                <SanteAlerta
                  v-else-if="l.ocupacao.alerta === 'excedido'"
                  variante="alerta"
                  :texto="t('atendimento.observacao.excedido')"
                />
              </template>
            </td>
            <td class="acoes">
              <template v-if="podeAlocar && l.ativo">
                <template v-if="!l.ocupacao">
                  <SanteSelecao
                    :model-value="escolhido[l.id] ?? ''"
                    :rotulo="t('atendimento.observacao.pacientePara', { leito: l.codigo })"
                    ocultar-rotulo
                    :opcoes="candidatos"
                    :data-testid="`obs-paciente-${l.id}`"
                    @update:model-value="(v: string) => (escolhido[l.id] = v)"
                  />
                  <SanteBotao
                    variante="secundario"
                    :rotulo="t('atendimento.observacao.alocar')"
                    :desabilitado="!escolhido[l.id] || ocupado"
                    :data-testid="`obs-alocar-${l.id}`"
                    @acionar="alocar(l.id)"
                  />
                </template>
                <SanteBotao
                  v-if="l.ocupacao"
                  variante="texto"
                  :rotulo="t('crudNir.transferir')"
                  :desabilitado="ocupado"
                  :data-testid="`obs-transferir-${l.id}`"
                  @acionar="abrirTransferir(l.ocupacao.reg, l.ocupacao.paciente, l.id)"
                />
                <SanteBotao
                  v-if="l.ocupacao"
                  variante="secundario"
                  :rotulo="t('atendimento.observacao.liberar')"
                  :desabilitado="ocupado"
                  :data-testid="`obs-liberar-${l.id}`"
                  @acionar="
                    saida = { reg: l.ocupacao.reg, paciente: l.ocupacao.paciente, horas: l.ocupacao.horas }
                  "
                />
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </template>
    <p v-if="mensagem" role="status" data-testid="obs-mensagem">{{ mensagem }}</p>
    <ErroAtendimento v-if="erro" :erro="erro" />
    <DialogoAlteracaoNir
      ref="refTransferir"
      v-model:visivel="dTransferir"
      :titulo="t('crudNir.transferirTitulo', { paciente: transf?.paciente ?? '' })"
      :texto="t('crudNir.transferirTexto')"
      :rotulo-confirmar="t('crudNir.transferir')"
      :incompleto="!destino"
      testid="dialogo-transferir-observacao"
      @confirmar="transferir"
    >
      <SanteSelecao
        v-model="destino"
        :rotulo="t('crudNir.leitoDestino')"
        :opcoes="destinos"
        :busca="true"
        data-testid="transferir-destino"
      />
    </DialogoAlteracaoNir>
    <SanteDialogo v-model:visivel="dialogo" :titulo="t('atendimento.observacao.liberar')">
      <form v-if="saida" class="filtros" @submit.prevent="liberar">
        <p>
          {{
            t('atendimento.observacao.liberarTexto', {
              paciente: saida.paciente,
              horas: horasTexto(saida.horas),
            })
          }}
        </p>
        <SanteCampoTexto
          v-model="justificativa"
          :rotulo="t('atendimento.observacao.justificativa')"
          :max-bytes="200"
          multilinha
          :obrigatorio="exigeJustificativaSaida(saida.horas)"
        />
        <SanteBotao
          tipo="submit"
          :rotulo="t('atendimento.observacao.confirmarSaida')"
          :desabilitado="
            ocupado || (exigeJustificativaSaida(saida.horas) && justificativa.trim().length < 10)
          "
          data-testid="obs-confirmar-saida"
        />
      </form>
    </SanteDialogo>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
