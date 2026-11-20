<script setup lang="ts">
// Médicos solicitantes SUS (M51, etapa 2; ficha, seção 7) — `Faturamento > Faturamento SUS > Médicos solicitantes SUS`:
// o cadastro dos solicitantes SUS pelo CRUD genérico (lista com busca, inclusão e alteração; CPF e CNS conferidos pelo
// dígito; exportação com justificativa, porque é dado pessoal do profissional) e a consulta ao cadastro geral de
// médicos solicitantes (número do conselho ou nome, busca no servidor) para conferir o conselho antes de incluir.
import type { MedicoSolicitanteAchado } from '@sgh/contratos';
import { SanteBotao, SanteCampoTexto } from '@sgh/ui';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import DominiosIndiceTela from '../../config/telas/DominiosIndiceTela.vue';
import { buscarSolicitantesCadastroGeral } from '../api-sus.js';

const { t } = useI18n();
const termo = ref('');
const achados = ref<MedicoSolicitanteAchado[] | null>(null);
const erro = ref<unknown>(null);
const aviso = ref<string | null>(null);
const buscando = ref(false);
const podeConsultar = pode('faturamento.susSolicitante.ler');

async function buscar(): Promise<void> {
  aviso.value = null;
  erro.value = null;
  if (termo.value.trim().length < 2) {
    aviso.value = t('faturamentoSus.solicitantes.termoCurto');
    return;
  }
  buscando.value = true;
  try {
    achados.value = await buscarSolicitantesCadastroGeral(termo.value.trim());
  } catch (e) {
    erro.value = e;
  } finally {
    buscando.value = false;
  }
}
</script>

<template>
  <section class="tela" aria-labelledby="solicitantes-titulo" data-testid="tela-solicitantes-sus">
    <h1 id="solicitantes-titulo">{{ t('faturamentoSus.solicitantes.titulo') }}</h1>
    <p>{{ t('faturamentoSus.solicitantes.explicacao') }}</p>
    <DominiosIndiceTela subitem="susSolicitantes" :embutido="true" />

    <section
      v-if="podeConsultar"
      aria-labelledby="solicitantes-geral-titulo"
      data-testid="solicitantes-geral"
    >
      <h2 id="solicitantes-geral-titulo">{{ t('faturamentoSus.solicitantes.cadastroGeral') }}</h2>
      <form class="linha" data-testid="form-solicitantes-geral" @submit.prevent="buscar">
        <SanteCampoTexto
          v-model="termo"
          :rotulo="t('faturamentoSus.solicitantes.termo')"
          :max-bytes="60"
          data-testid="solicitantes-termo"
        />
        <SanteBotao
          :rotulo="t('faturamentoSus.solicitantes.buscar')"
          tipo="submit"
          :desabilitado="buscando"
          data-testid="botao-buscar-solicitantes"
        />
      </form>
      <p v-if="aviso" role="alert">{{ aviso }}</p>
      <MensagemErro v-if="erro" :erro="erro" />
      <template v-else-if="achados">
        <p v-if="achados.length === 0">{{ t('faturamentoSus.solicitantes.nenhum') }}</p>
        <table v-else data-testid="tabela-solicitantes-geral">
          <thead>
            <tr>
              <th scope="col">{{ t('faturamentoSus.solicitantes.conselho') }}</th>
              <th scope="col">{{ t('faturamentoSus.solicitantes.nome') }}</th>
              <th scope="col">{{ t('faturamentoSus.solicitantes.uf') }}</th>
              <th scope="col">{{ t('faturamentoSus.solicitantes.cbo') }}</th>
              <th scope="col">{{ t('faturamentoSus.solicitantes.situacao') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in achados" :key="m.id">
              <td>{{ m.conselho }}</td>
              <td>{{ m.nome }}</td>
              <td>{{ m.uf ?? '—' }}</td>
              <td>{{ m.cbo ?? '—' }}</td>
              <td>
                {{
                  m.ativo ? t('faturamentoSus.solicitantes.ativo') : t('faturamentoSus.solicitantes.inativo')
                }}
              </td>
            </tr>
          </tbody>
        </table>
      </template>
    </section>
  </section>
</template>

<style scoped>
table {
  border-collapse: collapse;
  width: 100%;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
.linha {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
  margin: var(--sgh-espaco-2) 0;
}
</style>
