<script setup lang="ts">
// Nota fiscal da fatura ou da conta (F3.7, 06-FAT linha 36): `/faturamento/faturas/:id/notas-fiscais` e
// `/faturamento/contas/:id/notas-fiscais`. Numa tela só: quanto o alvo vale, quanto já está documentado e quanto falta;
// as notas ligadas com a situação da nota (a cancelada fica à vista, marcada como "não documenta mais"); desligar pede
// o motivo, conferido enquanto se digita; as notas candidatas que servem a este alvo (mesma fonte pagadora ou tomador
// que é o paciente ou um responsável; nenhuma emitida para outro alvo), com as emitidas para este primeiro e o valor já
// sugerido (o menor entre o saldo da nota e o que falta). Ligar é um clique; o valor pode ser trocado e é conferido
// enquanto se digita, pela mesma regra do servidor. Embaixo, o histórico do vínculo (quem ligou, ajustou, desligou e
// por quê).
import { validarDesligamentoNota, validarVinculoNota } from '@sgh/dominio-faturamento';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { novaChave } from '../api-faturamento.js';
import {
  type DocumentacaoFiscal,
  desvincularNota,
  lerDocumentacaoFiscal,
  type TipoAlvo,
  vincularNota,
} from '../api-nota-vinculo.js';
import ErroFaturamento from '../componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../componentes/MensagemFaturamento.vue';
import { quando } from '../usar-faturamento.js';

const props = defineProps<{ id: string; tipo: TipoAlvo }>();
const alvoId = computed(() => Number(props.id));
const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      tituloFatura: 'Nota fiscal da fatura {numero}',
      tituloConta: 'Nota fiscal da conta {numero}',
      valor: 'Valor a documentar',
      documentado: 'Documentado por nota',
      falta: 'Falta documentar',
      sem_nota: 'Sem nota',
      parcial: 'Documentada em parte',
      documentada: 'Documentada',
      ligadas: 'Notas ligadas',
      semLigadas: 'Nenhuma nota ligada ainda.',
      candidatas: 'Notas disponíveis',
      semCandidatas: 'Nenhuma nota da mesma fonte pagadora com saldo.',
      nota: 'Nota',
      rps: 'RPS',
      emitida: 'Emitida em',
      situacao: 'Situação',
      valorNota: 'Valor da nota',
      saldoNota: 'Saldo da nota',
      apropriado: 'Valor documentado',
      paraEste: 'emitida para este',
      ligar: 'Ligar',
      desligar: 'Desligar',
      motivo: 'Motivo do desligamento',
      confirmarDesligar: 'Confirmar desligamento',
      naoDocumenta: 'não documenta mais',
      historico: 'Histórico do vínculo',
      semHistorico: 'Sem eventos.',
      quando: 'Quando',
      acao: 'Ação',
      de: 'De',
      para: 'Para',
      ligado: 'Ligada',
      ajustado: 'Valor ajustado',
      desligado: 'Desligada',
      religado: 'Religada',
      gravado: 'Gravado.',
    },
  },
});
const qc = useQueryClient();
const consulta = useQuery({
  queryKey: ['faturamento', 'nota-fiscal', () => props.tipo, alvoId],
  queryFn: () => lerDocumentacaoFiscal(props.tipo, alvoId.value),
});
const dados = computed<DocumentacaoFiscal | undefined>(() => consulta.data.value);
const valores = reactive<Record<number, number>>({});
const motivos = reactive<Record<number, string>>({});
const desligando = ref<number | null>(null);
const erroMotivo = (id: number) => Object.values(validarDesligamentoNota(motivos[id])).join(' ') || null;
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const gravando = ref(false);
let chave = novaChave('nota-fiscal');

const dinheiro = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const valorDe = (c: DocumentacaoFiscal['candidatas'][number]) => valores[c.id] ?? c.sugerido;
function errosDe(c: DocumentacaoFiscal['candidatas'][number]): string | null {
  const d = dados.value;
  if (!d) return null;
  const nota = {
    situacao: c.situacao,
    valorServicos: c.valorServicos,
    valorJaApropriado: c.valorServicos - c.saldoNota,
    // A candidata já vem filtrada pelo servidor (serve a este alvo); aqui se confere só o valor e a situação.
    fontePagadoraId: d.alvo.fontePagadoraId,
  };
  const alvo = {
    tipo: d.alvo.tipo,
    situacao: d.alvo.situacao,
    valorDocumentavel: d.alvo.valorDocumentavel,
    valorJaDocumentado: d.alvo.valorDocumentado,
    fontePagadoraId: d.alvo.fontePagadoraId,
  };
  const e = validarVinculoNota(nota, alvo, { valorApropriado: Number(valorDe(c)) });
  return Object.values(e).join(' ') || null;
}

async function acao(f: () => Promise<unknown>) {
  erro.value = null;
  mensagem.value = null;
  gravando.value = true;
  try {
    await f();
    mensagem.value = t('gravado');
    chave = novaChave('nota-fiscal');
    await qc.invalidateQueries({ queryKey: ['faturamento', 'nota-fiscal'] });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
const ligar = (c: DocumentacaoFiscal['candidatas'][number]) =>
  acao(() =>
    vincularNota(
      { tipo: props.tipo, alvoId: alvoId.value, notaServicoId: c.id, valorApropriado: Number(valorDe(c)) },
      chave,
    ),
  );
const desligar = (id: number, versao: number) =>
  acao(async () => {
    await desvincularNota(id, versao, (motivos[id] ?? '').trim(), chave);
    desligando.value = null;
    delete motivos[id];
  });
</script>

<template>
  <section class="tela" data-testid="nota-fiscal-alvo">
    <ErroFaturamento v-if="consulta.error.value" :erro="consulta.error.value" />
    <template v-else-if="dados">
      <h1>
        {{
          dados.alvo.tipo === 'fatura'
            ? t('tituloFatura', { numero: dados.alvo.numero })
            : t('tituloConta', { numero: dados.alvo.numero })
        }}
      </h1>
      <dl class="resumo" data-testid="nf-resumo">
        <dt>{{ t('valor') }}</dt>
        <dd>{{ dinheiro(dados.alvo.valorDocumentavel) }}</dd>
        <dt>{{ t('documentado') }}</dt>
        <dd>{{ dinheiro(dados.alvo.valorDocumentado) }}</dd>
        <dt>{{ t('falta') }}</dt>
        <dd data-testid="nf-falta">{{ dinheiro(dados.alvo.saldo) }}</dd>
        <dt>{{ t('situacao') }}</dt>
        <dd data-testid="nf-documentacao">{{ t(dados.alvo.documentacao) }}</dd>
      </dl>
      <ErroFaturamento v-if="erro" :erro="erro" />
      <MensagemFaturamento v-if="mensagem" :texto="mensagem" />

      <h2>{{ t('ligadas') }}</h2>
      <table v-if="dados.ligadas.length" class="tabela" data-testid="nf-ligadas">
        <thead>
          <tr>
            <th scope="col">{{ t('nota') }}</th>
            <th scope="col">{{ t('rps') }}</th>
            <th scope="col">{{ t('emitida') }}</th>
            <th scope="col">{{ t('situacao') }}</th>
            <th scope="col">{{ t('apropriado') }}</th>
            <th scope="col"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in dados.ligadas" :key="l.id">
            <td>{{ l.numeroNota ?? '—' }}</td>
            <td>{{ l.rps }}</td>
            <td>{{ l.emitidaEm ? quando(l.emitidaEm) : '—' }}</td>
            <td :data-testid="`nf-situacao-${l.id}`">
              {{ l.situacaoNota }}
              <strong v-if="!l.documenta" class="erro">({{ t('naoDocumenta') }})</strong>
            </td>
            <td :class="{ riscado: !l.documenta }">{{ dinheiro(l.valorApropriado) }}</td>
            <td>
              <button
                v-if="desligando !== l.id"
                type="button"
                :disabled="gravando"
                :data-testid="`nf-desligar-${l.id}`"
                @click="desligando = l.id"
              >
                {{ t('desligar') }}
              </button>
              <template v-else>
                <label>
                  {{ t('motivo') }}
                  <input
                    v-model="motivos[l.id]"
                    type="text"
                    maxlength="500"
                    :aria-invalid="erroMotivo(l.id) ? 'true' : 'false'"
                    :data-testid="`nf-motivo-${l.id}`"
                  />
                </label>
                <small v-if="erroMotivo(l.id)" class="erro">{{ erroMotivo(l.id) }}</small>
                <button
                  type="button"
                  :disabled="gravando || !!erroMotivo(l.id)"
                  :data-testid="`nf-confirmar-desligar-${l.id}`"
                  @click="desligar(l.id, l.versao)"
                >
                  {{ t('confirmarDesligar') }}
                </button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else>{{ t('semLigadas') }}</p>

      <h2>{{ t('candidatas') }}</h2>
      <table v-if="dados.candidatas.length" class="tabela" data-testid="nf-candidatas">
        <thead>
          <tr>
            <th scope="col">{{ t('nota') }}</th>
            <th scope="col">{{ t('rps') }}</th>
            <th scope="col">{{ t('emitida') }}</th>
            <th scope="col">{{ t('valorNota') }}</th>
            <th scope="col">{{ t('saldoNota') }}</th>
            <th scope="col">{{ t('apropriado') }}</th>
            <th scope="col"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in dados.candidatas" :key="c.id">
            <td>
              {{ c.numeroNota ?? '—' }}
              <small v-if="c.emitidaParaEste">({{ t('paraEste') }})</small>
            </td>
            <td>{{ c.rps }}</td>
            <td>{{ c.emitidaEm ? quando(c.emitidaEm) : '—' }}</td>
            <td>{{ dinheiro(c.valorServicos) }}</td>
            <td>{{ dinheiro(c.saldoNota) }}</td>
            <td>
              <input
                type="number"
                step="0.01"
                min="0"
                :value="valorDe(c)"
                :aria-invalid="errosDe(c) ? 'true' : 'false'"
                :data-testid="`nf-valor-${c.id}`"
                @input="valores[c.id] = Number(($event.target as HTMLInputElement).value)"
              />
              <small v-if="errosDe(c)" class="erro">{{ errosDe(c) }}</small>
            </td>
            <td>
              <button
                type="button"
                :disabled="gravando || !!errosDe(c)"
                :data-testid="`nf-ligar-${c.id}`"
                @click="ligar(c)"
              >
                {{ t('ligar') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else>{{ t('semCandidatas') }}</p>

      <h2>{{ t('historico') }}</h2>
      <table v-if="dados.historico.length" class="tabela" data-testid="nf-historico">
        <thead>
          <tr>
            <th scope="col">{{ t('quando') }}</th>
            <th scope="col">{{ t('acao') }}</th>
            <th scope="col">{{ t('nota') }}</th>
            <th scope="col">{{ t('de') }}</th>
            <th scope="col">{{ t('para') }}</th>
            <th scope="col">{{ t('motivo') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="h in dados.historico" :key="h.id">
            <td>{{ h.em ? quando(h.em) : '—' }}</td>
            <td>{{ t(h.acao) }}</td>
            <td>{{ h.notaServicoId }} ({{ h.situacaoNota }})</td>
            <td>{{ h.valorAnterior === null ? '—' : dinheiro(h.valorAnterior) }}</td>
            <td>{{ h.valor === null ? '—' : dinheiro(h.valor) }}</td>
            <td>{{ h.motivo ?? '' }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else>{{ t('semHistorico') }}</p>
    </template>
  </section>
</template>
