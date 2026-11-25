<script setup lang="ts">
// Lotes de trabalho da bancada dentro do mapa de trabalho (F3.5, 05-SADT linha 8). Um clique abre o lote com os exames
// em análise fora de lote (o servidor ordena: urgentes primeiro, até o limite do modelo de mapa, e numera a posição no
// suporte); o lote mostra a ordem do suporte, imprime (a hora fica registrada) e fecha (o que não foi processado volta
// à fila da bancada). Tudo na própria tela do mapa, sem trocar de página.
import { SanteBotao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, nextTick, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { novaChave } from '../api-sadt.js';
import { abrirLote, fecharLote, imprimirLote, lerLotes } from '../api-lote-trabalho.js';
import { quando } from '../usar-sadt.js';
import ErroSadt from './ErroSadt.vue';

const props = defineProps<{ bancada: number; data: string; temFila: boolean }>();
const { t } = useI18n();
const cliente = useQueryClient();
const lotes = useQuery({
  queryKey: computed(() => ['sadt', 'lotes', props.data]),
  queryFn: () => lerLotes(props.data),
  retry: false,
});
const daBancada = computed(() => (lotes.data.value ?? []).filter((l) => l.bancada === props.bancada));
const emAndamento = (s: string) => s === 'aberto' || s === 'em_processamento';
const ocupado = ref(false);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const expandido = ref<number | null>(null);

async function executar(acao: () => Promise<void>): Promise<void> {
  ocupado.value = true;
  erro.value = null;
  mensagem.value = null;
  try {
    await acao();
    await cliente.invalidateQueries({ queryKey: ['sadt', 'lotes'] });
    await cliente.invalidateQueries({ queryKey: ['sadt', 'mapa'] });
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}
const abrir = () =>
  executar(async () => {
    const l = await abrirLote(props.bancada, novaChave('lote-abrir'));
    expandido.value = l.id;
    mensagem.value = t('sadt.lote.abertoOk', { numero: l.numero, n: l.itens.length });
  });
const fechar = (id: number) =>
  executar(async () => {
    const l = await fecharLote(id, novaChave('lote-fechar'));
    mensagem.value = t('sadt.lote.fechadoOk', {
      numero: l.numero,
      processados: l.itens.filter((i) => i.situacao === 'processado').length,
      pendentes: l.itens.filter((i) => i.situacao === 'pendente').length,
    });
  });
const imprimir = (id: number) =>
  executar(async () => {
    await imprimirLote(id, novaChave('lote-imprimir'));
    expandido.value = id;
    await nextTick();
    window.print();
  });
</script>

<template>
  <div class="lotes-trabalho" data-testid="lotes-trabalho">
    <h3>{{ t('sadt.lote.titulo') }}</h3>
    <p v-if="lotes.isError.value" class="secundario" data-testid="lotes-indisponivel">
      {{ t('sadt.lote.indisponivel') }}
    </p>
    <template v-else>
      <SanteBotao
        :rotulo="t('sadt.lote.abrir')"
        :desabilitado="ocupado || !temFila"
        :title="t('sadt.lote.abrirDica')"
        data-testid="lote-abrir"
        @acionar="abrir()"
      />
      <p v-if="lotes.data.value && daBancada.length === 0" class="secundario">{{ t('sadt.lote.nenhum') }}</p>
      <details
        v-for="l in daBancada"
        :key="l.id"
        :open="expandido === l.id || emAndamento(l.situacao)"
        data-testid="lote"
      >
        <summary>
          {{
            t('sadt.lote.resumo', {
              numero: l.numero,
              situacao: t(`sadt.lote.situacao.${l.situacao}`),
              n: l.itens.length,
            })
          }}
          <span class="secundario">
            ·
            {{
              l.analistaNome ? t('sadt.lote.analista', { nome: l.analistaNome }) : t('sadt.lote.semAnalista')
            }}
            <template v-if="l.impressoEm">
              · {{ t('sadt.lote.impressoEm', { quando: quando(l.impressoEm) }) }}</template
            >
            <template v-if="l.fechadoEm">
              · {{ t('sadt.lote.fechadoEm', { quando: quando(l.fechadoEm) }) }}</template
            >
          </span>
        </summary>
        <table class="tabela">
          <thead>
            <tr>
              <th scope="col">{{ t('sadt.lote.posicao') }}</th>
              <th scope="col">{{ t('sadt.lote.exame') }}</th>
              <th scope="col">{{ t('sadt.lote.paciente') }}</th>
              <th scope="col">{{ t('sadt.lote.amostra') }}</th>
              <th scope="col">{{ t('sadt.lote.situacaoItem') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="i in l.itens" :key="i.id" data-testid="lote-item">
              <td>{{ i.posicaoSuporte ?? i.sequencia }}</td>
              <td>
                {{ i.exameNome }}<strong v-if="i.urgente"> · {{ t('sadt.urgente') }}</strong>
              </td>
              <td>{{ i.paciente }}</td>
              <td>{{ i.amostra ?? '—' }}</td>
              <td>
                {{ t(`sadt.lote.item.${i.situacao}`) }}<span v-if="i.motivo"> ({{ i.motivo }})</span>
              </td>
            </tr>
          </tbody>
        </table>
        <div class="acoes">
          <SanteBotao
            v-if="l.situacao !== 'cancelado'"
            :rotulo="t('sadt.lote.imprimir')"
            :desabilitado="ocupado"
            data-testid="lote-imprimir"
            @acionar="imprimir(l.id)"
          />
          <SanteBotao
            v-if="emAndamento(l.situacao)"
            :rotulo="t('sadt.lote.fechar')"
            :desabilitado="ocupado"
            data-testid="lote-fechar"
            @acionar="fechar(l.id)"
          />
        </div>
      </details>
    </template>
    <p v-if="mensagem" role="status" data-testid="lote-mensagem">{{ mensagem }}</p>
    <ErroSadt v-if="erro" :erro="erro" />
  </div>
</template>
