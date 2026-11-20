<script setup lang="ts">
// Webservices TISS por operadora (ficha do M31, seção 7): `/integracao/tiss`. A configuração do cadastro de origem só em
// leitura (versões, transações, URLs e webservices; nunca login, senha ou certificado) e o endpoint do novo por operadora
// e transação, com a REFERÊNCIA à credencial no cofre (a senha nunca passa pela tela). Editar é crítico.
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import AvisoFaturamento from '../../faturamento/componentes/AvisoFaturamento.vue';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../../faturamento/componentes/MensagemFaturamento.vue';
import { editarEndpoint, lerConfiguracao, novaChave } from '../api-tiss.js';
import { quando, usarTiss } from '../usar-tiss.js';

const { t } = useI18n();
const qc = useQueryClient();
const { pode, motivoFuncionalidade } = usarTiss('integracao');
const c = useQuery({ queryKey: ['tiss', 'configuracao'], queryFn: () => lerConfiguracao() });
const convenio = ref('');
const transacao = ref('ENVIO_LOTE_GUIAS');
const url = ref('');
const cofre = ref('');
const ativo = ref('nao');
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const gravando = ref(false);
const convenios = computed(() =>
  (c.data.value?.convenios ?? []).map((x) => ({
    valor: String(x.convenio),
    rotulo: `${x.convenio} — ${x.nome}`,
  })),
);
const transacoes = computed(() =>
  (c.data.value?.transacoes ?? []).map((x) => ({ valor: x.tipo, rotulo: x.nome })),
);
async function gravar() {
  erro.value = null;
  mensagem.value = null;
  gravando.value = true;
  try {
    const r = await editarEndpoint(
      {
        convenio: Number(convenio.value),
        transacao: transacao.value,
        url: url.value.trim(),
        referenciaCofre: cofre.value.trim(),
        ativo: ativo.value === 'sim',
      },
      novaChave('endpoint'),
    );
    mensagem.value = r.mensagem;
    await qc.invalidateQueries({ queryKey: ['tiss', 'configuracao'] });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="ws-titulo" data-testid="tela-tiss-webservices">
    <h1 id="ws-titulo">{{ t('tiss.webservices.titulo') }}</h1>
    <p>{{ t('tiss.webservices.texto') }}</p>
    <AvisoFaturamento :motivo="motivoFuncionalidade('integracaoTiss')" />
    <ErroFaturamento v-if="c.error.value" :erro="c.error.value" />
    <p v-else-if="!c.data.value" role="status">{{ t('tiss.carregando') }}</p>
    <template v-else>
      <p data-testid="ws-versao">
        {{ t('tiss.webservices.versaoGerada', { versao: c.data.value.versaoGerada }) }}
      </p>
      <h2>{{ t('tiss.webservices.convenios') }}</h2>
      <table class="tabela" data-testid="ws-convenios">
        <thead>
          <tr>
            <th scope="col">{{ t('tiss.convenio') }}</th>
            <th scope="col">{{ t('tiss.webservices.registroAns') }}</th>
            <th scope="col">{{ t('tiss.webservices.codigoPrestador') }}</th>
            <th scope="col">{{ t('tiss.webservices.versaoConfigurada') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in c.data.value.convenios" :key="x.convenio">
            <td>{{ x.convenio }} — {{ x.nome }}</td>
            <td>{{ x.registroAns ?? '—' }}</td>
            <td>{{ x.codigoPrestador ?? t('tiss.webservices.semCodigo') }}</td>
            <td>{{ x.versaoConfigurada ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
      <h2>{{ t('tiss.webservices.cadastroOrigem') }}</h2>
      <table class="tabela" data-testid="ws-origem">
        <thead>
          <tr>
            <th scope="col">{{ t('tiss.convenio') }}</th>
            <th scope="col">{{ t('tiss.loteTela.transacao') }}</th>
            <th scope="col">{{ t('tiss.webservices.url') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(w, i) in c.data.value.webservicesOutroSistema" :key="i">
            <td>{{ w.convenio }}</td>
            <td>{{ c.data.value.transacoes.find((x) => x.id === w.transacao)?.nome ?? w.transacao }}</td>
            <td>
              <code>{{ w.url }}</code>
            </td>
          </tr>
        </tbody>
      </table>
      <h2>{{ t('tiss.webservices.endpoints') }}</h2>
      <p v-if="c.data.value.endpoints.length === 0">{{ t('tiss.nenhum') }}</p>
      <table v-else class="tabela" data-testid="ws-endpoints">
        <thead>
          <tr>
            <th scope="col">{{ t('tiss.convenio') }}</th>
            <th scope="col">{{ t('tiss.loteTela.transacao') }}</th>
            <th scope="col">{{ t('tiss.webservices.url') }}</th>
            <th scope="col">{{ t('tiss.webservices.cofre') }}</th>
            <th scope="col">{{ t('tiss.webservices.ativo') }}</th>
            <th scope="col">{{ t('tiss.autor') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in c.data.value.endpoints" :key="`${x.convenio}-${x.transacao}`">
            <td>{{ x.convenio }}</td>
            <td>{{ x.transacao }}</td>
            <td>
              <code>{{ x.url }}</code>
            </td>
            <td>
              <code>{{ x.referenciaCofre }}</code>
            </td>
            <td>{{ x.ativo ? t('tiss.sim') : t('tiss.nao') }}</td>
            <td>{{ x.alteradoPor }} · {{ quando(x.alteradoEm) }}</td>
          </tr>
        </tbody>
      </table>
      <form v-if="pode('editarEndpoint')" class="formulario" data-testid="ws-form" @submit.prevent="gravar">
        <h2>{{ t('tiss.webservices.editar') }}</h2>
        <span class="campo"
          ><SanteSelecao
            v-model="convenio"
            :rotulo="t('tiss.convenio')"
            :opcoes="convenios"
            data-testid="ws-convenio"
        /></span>
        <span class="campo"
          ><SanteSelecao
            v-model="transacao"
            :rotulo="t('tiss.loteTela.transacao')"
            :opcoes="transacoes"
            data-testid="ws-transacao"
        /></span>
        <span class="campo">
          <label for="ws-url">{{ t('tiss.webservices.url') }}</label>
          <input id="ws-url" v-model="url" type="url" maxlength="250" required data-testid="ws-url" />
        </span>
        <span class="campo">
          <label for="ws-cofre">{{ t('tiss.webservices.cofre') }}</label>
          <input
            id="ws-cofre"
            v-model="cofre"
            maxlength="130"
            required
            :placeholder="t('tiss.webservices.exemploCofre')"
            data-testid="ws-cofre"
          />
        </span>
        <span class="campo">
          <SanteSelecao
            v-model="ativo"
            :rotulo="t('tiss.webservices.ativo')"
            :opcoes="[
              { valor: 'nao', rotulo: t('tiss.nao') },
              { valor: 'sim', rotulo: t('tiss.sim') },
            ]"
            data-testid="ws-ativo"
          />
        </span>
        <p class="secundario">{{ t('tiss.webservices.aviso') }}</p>
        <button type="submit" :disabled="gravando || !convenio" data-testid="ws-gravar">
          {{ t('tiss.gravar') }}
        </button>
      </form>
    </template>
    <ErroFaturamento v-if="erro" :erro="erro" />
    <MensagemFaturamento :texto="mensagem" testid="ws-mensagem" />
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
