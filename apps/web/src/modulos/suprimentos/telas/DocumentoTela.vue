<script setup lang="ts">
// Um documento de estoque (saída, devolução, transferência, nota, balanço): `/suprimentos/documentos/:tipo/:ano/:mes/:doc`.
// O cabeçalho, os itens com o valor posto pelo banco, os lotes, o já devolvido e as ocorrências do novo (estorno,
// desconsolidação, divergência) com autor e data. Leitura auditada (o paciente aparece). A nota consolidada pode ser
// desconsolidada (permissão crítica, com motivo); a correção padrão de uma saída é a devolução.
import type { TipoDocumentoEstoque } from '@sgh/contratos';
import { SanteBotao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { desconsolidar, lerDocumento, novaChave } from '../api-suprimentos.js';
import ErroSuprimentos from '../componentes/ErroSuprimentos.vue';
import { chaveDoc, data, qtd, quando, reais, usarSuprimentos } from '../usar-suprimentos.js';

const { t } = useI18n();
const rota = useRoute();
const cliente = useQueryClient();
const { pode, nomeLocal } = usarSuprimentos();
const tipo = computed(() => String(rota.params['tipo']) as TipoDocumentoEstoque);
const chave = computed(() => ({
  ano: Number(rota.params['ano']),
  mes: Number(rota.params['mes']),
  doc: Number(rota.params['doc']),
}));
const doc = useQuery({
  queryKey: computed(() => ['suprimentos', 'documento', tipo.value, chave.value]),
  queryFn: () => lerDocumento(tipo.value, chave.value),
});
const motivo = ref('');
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
async function desfazer(): Promise<void> {
  erro.value = null;
  try {
    const r = await desconsolidar(
      { tipo: tipo.value, documento: doc.data.value?.id, motivo: motivo.value },
      novaChave('desconsolidar'),
    );
    mensagem.value = r.mensagem;
    await cliente.invalidateQueries({ queryKey: ['suprimentos'] });
  } catch (x) {
    erro.value = x;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="doc-titulo" data-testid="tela-suprimentos-documento">
    <h1 id="doc-titulo">{{ t(`suprimentos.tipos.${tipo}`) }} {{ chaveDoc(chave) }}</h1>
    <ErroSuprimentos v-if="doc.isError.value" :erro="doc.error.value" />
    <p v-else-if="!doc.data.value" role="status">{{ t('suprimentos.carregando') }}</p>
    <template v-else>
      <div class="painel">
        <p>
          {{ data(doc.data.value.data) }} {{ doc.data.value.hora }} · {{ nomeLocal(doc.data.value.local) }}
          <template v-if="doc.data.value.localDestino">
            {{ t('suprimentos.para', { l: nomeLocal(doc.data.value.localDestino) }) }}</template
          >
          · {{ doc.data.value.usuario }}
        </p>
        <p v-if="doc.data.value.paciente" data-testid="doc-paciente">
          {{ t('suprimentos.paciente') }}: {{ doc.data.value.paciente.nome }} ({{
            doc.data.value.paciente.atendimento
          }})
        </p>
        <p v-if="doc.data.value.nota">
          {{ doc.data.value.nota.fornecedorNome }} · {{ t('suprimentos.notas.numero') }}
          {{ doc.data.value.nota.numero }}/{{ doc.data.value.nota.serie }}
        </p>
        <p>
          <strong data-testid="doc-consolidado">{{
            doc.data.value.consolidado ? t('suprimentos.consolidado') : t('suprimentos.naoConsolidado')
          }}</strong>
          · {{ t('suprimentos.valor') }} {{ reais(doc.data.value.valor) }}
        </p>
        <p v-if="doc.data.value.observacao">{{ doc.data.value.observacao }}</p>
      </div>
      <table class="tabela" data-testid="doc-itens">
        <caption>
          {{
            t('suprimentos.itens')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('suprimentos.item') }}</th>
            <th scope="col">{{ t('suprimentos.quantidade') }}</th>
            <th scope="col">{{ t('suprimentos.valor') }}</th>
            <th scope="col">{{ t('suprimentos.lotes') }}</th>
            <th scope="col">{{ t('suprimentos.devolvido') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in doc.data.value.itensDetalhe" :key="i.id">
            <td>{{ i.item }} · {{ i.nome }}</td>
            <td>{{ qtd(i.quantidade) }}</td>
            <td>{{ reais(i.valor) }}</td>
            <td>
              {{
                i.lotes.map((l) => `${l.lote} (${data(l.validade)}) ${qtd(l.quantidade)}`).join('; ') || '—'
              }}
            </td>
            <td>{{ qtd(i.devolvido) }}</td>
          </tr>
        </tbody>
      </table>
      <section v-if="doc.data.value.ocorrencias.length" class="painel">
        <h2>{{ t('suprimentos.ocorrencias') }}</h2>
        <ul>
          <li v-for="(o, k) in doc.data.value.ocorrencias" :key="k">
            {{ quando(o.em) }} · {{ o.tipo }} · {{ o.autor }} · {{ o.motivo }}
          </li>
        </ul>
      </section>
      <section
        v-if="tipo === 'nota' && doc.data.value.consolidado && pode('suprimentos.desconsolidarDocumento')"
        class="painel"
      >
        <h2>{{ t('suprimentos.desconsolidar.titulo') }}</h2>
        <p>{{ t('suprimentos.desconsolidar.texto') }}</p>
        <span class="campo">
          <label for="doc-motivo">{{ t('suprimentos.motivo') }}</label>
          <input id="doc-motivo" v-model="motivo" maxlength="250" />
        </span>
        <SanteBotao
          variante="destrutivo"
          :rotulo="t('suprimentos.desconsolidar.acao')"
          :confirmacao="t('suprimentos.desconsolidar.confirma')"
          :desabilitado="motivo.trim().length < 10"
          @acionar="desfazer"
        />
      </section>
      <p v-if="mensagem" role="status">{{ mensagem }}</p>
      <ErroSuprimentos v-if="erro" :erro="erro" />
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
