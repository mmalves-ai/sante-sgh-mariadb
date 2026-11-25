<script setup lang="ts">
// Fornecedores e terceiros (ficha do M28, seção 7): `/suprimentos/fornecedores`. Consulta pelo nome, fantasia ou
// código; o CNPJ/CPF aparece conferido (dígitos verificadores) e o da pessoa física mascarado; dados bancários só
// mascarados. O cadastro do fornecedor (05-SUP linha 23: incluir e alterar, contas de pagamento, avaliação periódica e
// ocorrências) abre na própria tela, pela busca do cadastro e pelo botão Novo fornecedor, para quem pode editar.
import { SanteBotao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { buscarFornecedoresCadastro, lerPainelCadastroFornecedor } from '../api-cadastro-fornecedor.js';
import { listarFornecedores, listarPrestadores, listarTerceiros } from '../api-suprimentos.js';
import AvisoSuprimentos from '../componentes/AvisoSuprimentos.vue';
import ErroSuprimentos from '../componentes/ErroSuprimentos.vue';
import FornecedorCadastroPainel from '../componentes/FornecedorCadastroPainel.vue';
import { mensagensCadastroFornecedor as MC } from '../i18n-cadastro-fornecedor.js';

const { t } = useI18n();
// O cadastro: o painel traz categorias, bancos e o que o usuário pode; a ficha abre pela busca ou vazia (novo).
const painelCadastro = useQuery({
  queryKey: ['suprimentos', 'cadastro-fornecedor', 'painel'],
  queryFn: lerPainelCadastroFornecedor,
  retry: false,
});
const termoCadastro = ref('');
const buscaCadastro = ref<string | null>(null);
const resultadoCadastro = useQuery({
  queryKey: ['suprimentos', 'cadastro-fornecedor', 'busca', buscaCadastro],
  queryFn: () => buscarFornecedoresCadastro(buscaCadastro.value ?? ''),
  enabled: computed(() => buscaCadastro.value !== null),
});
const aberto = ref<{ id: number | null; vez: number } | null>(null);
let vez = 0;
const abrir = (id: number | null) => (aberto.value = { id, vez: ++vez });
const termo = ref('');
const busca = ref('');
const lista = useQuery({
  queryKey: ['suprimentos', 'fornecedores', busca],
  queryFn: () => listarFornecedores(busca.value),
});
// Terceiros (GECADTER) e colaboradores e prestadores (GETABFUN): só consulta, pela mesma busca (D-FORN-28).
const terceiros = useQuery({
  queryKey: ['suprimentos', 'terceiros', busca],
  queryFn: () => listarTerceiros(busca.value),
});
const prestadores = useQuery({
  queryKey: ['suprimentos', 'prestadores', busca],
  queryFn: () => listarPrestadores(busca.value),
});
</script>

<template>
  <section class="tela-agenda" aria-labelledby="forn-titulo" data-testid="tela-suprimentos-fornecedores">
    <h1 id="forn-titulo">{{ t('suprimentos.fornecedores.titulo') }}</h1>
    <p>{{ t('suprimentos.fornecedores.texto') }}</p>
    <section aria-labelledby="forn-cadastro-titulo" data-testid="forn-cadastro">
      <h2 id="forn-cadastro-titulo">{{ MC.titulo }}</h2>
      <ErroSuprimentos v-if="painelCadastro.error.value" :erro="painelCadastro.error.value" />
      <p v-else-if="!painelCadastro.data.value" role="status">{{ MC.carregando }}</p>
      <template v-else>
        <form class="filtros" @submit.prevent="buscaCadastro = termoCadastro.trim()">
          <span class="campo">
            <label for="forn-cadastro-termo">{{ MC.busca }}</label>
            <input id="forn-cadastro-termo" v-model="termoCadastro" data-testid="forn-cadastro-termo" />
          </span>
          <SanteBotao
            tipo="submit"
            variante="secundario"
            :rotulo="MC.buscar"
            data-testid="forn-cadastro-buscar"
          />
          <SanteBotao
            v-if="painelCadastro.data.value.pode.editar"
            :rotulo="MC.novo"
            data-testid="forn-cadastro-novo"
            @acionar="abrir(null)"
          />
        </form>
        <ErroSuprimentos v-if="resultadoCadastro.error.value" :erro="resultadoCadastro.error.value" />
        <ul v-else-if="resultadoCadastro.data.value" data-testid="forn-cadastro-resultado">
          <li v-for="f in resultadoCadastro.data.value.itens" :key="f.id">
            {{ f.razaoSocial }}<template v-if="f.nomeFantasia"> · {{ f.nomeFantasia }}</template> ·
            {{ f.documento }} · {{ f.situacao }}
            <SanteBotao
              variante="secundario"
              :rotulo="MC.abrir"
              :data-testid="`forn-cadastro-abrir-${f.id}`"
              @acionar="abrir(f.id)"
            />
          </li>
          <li v-if="resultadoCadastro.data.value.itens.length === 0">{{ MC.nenhum }}</li>
        </ul>
        <FornecedorCadastroPainel
          v-if="aberto"
          :key="aberto.vez"
          :fornecedor-id="aberto.id"
          :painel="painelCadastro.data.value"
          @fechar="aberto = null"
        />
      </template>
    </section>
    <form class="filtros" @submit.prevent="busca = termo.trim()">
      <span class="campo">
        <label for="forn-termo">{{ t('suprimentos.fornecedores.busca') }}</label>
        <input id="forn-termo" v-model="termo" data-testid="forn-termo" />
      </span>
      <SanteBotao
        tipo="submit"
        variante="secundario"
        :rotulo="t('suprimentos.buscar')"
        data-testid="forn-buscar"
      />
    </form>
    <ErroSuprimentos v-if="lista.error.value" :erro="lista.error.value" />
    <p v-else-if="!lista.data.value" role="status">{{ t('suprimentos.carregando') }}</p>
    <template v-else>
      <table class="tabela" data-testid="forn-tabela">
        <caption>
          {{
            t('suprimentos.fornecedores.lista')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('suprimentos.codigo') }}</th>
            <th scope="col">{{ t('suprimentos.nome') }}</th>
            <th scope="col">{{ t('suprimentos.fornecedores.documento') }}</th>
            <th scope="col">{{ t('suprimentos.fornecedores.cidade') }}</th>
            <th scope="col">{{ t('suprimentos.fornecedores.banco') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="f in lista.data.value.itens" :key="f.codigo">
            <td>{{ f.codigo }}</td>
            <td>
              {{ f.nome }}
              <span v-if="f.fantasia" class="secundario"> · {{ f.fantasia }}</span>
            </td>
            <td>
              {{ f.documento || '—' }}
              <span v-if="f.documento && !f.documentoValido" class="secundario">
                · {{ t('suprimentos.fornecedores.documentoInvalido') }}</span
              >
            </td>
            <td>
              {{ f.cidade }}<template v-if="f.uf"> / {{ f.uf }}</template>
            </td>
            <td>{{ f.banco ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="lista.data.value.itens.length === 0">{{ t('suprimentos.nenhum') }}</p>
      <p v-if="lista.data.value.cortada" role="status">{{ t('suprimentos.cortada') }}</p>
    </template>
    <AvisoSuprimentos :motivo="t('suprimentos.fornecedores.edicaoTerceiros')" />
    <h2>{{ t('suprimentos.fornecedores.terceiros') }}</h2>
    <ErroSuprimentos v-if="terceiros.error.value" :erro="terceiros.error.value" />
    <p v-else-if="!terceiros.data.value" role="status">{{ t('suprimentos.carregando') }}</p>
    <template v-else>
      <table class="tabela" data-testid="forn-terceiros">
        <caption>
          {{
            t('suprimentos.fornecedores.terceiros')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('suprimentos.codigo') }}</th>
            <th scope="col">{{ t('suprimentos.nome') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in terceiros.data.value.itens" :key="x.codigo">
            <td>{{ x.codigo }}</td>
            <td>{{ x.nome }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="terceiros.data.value.itens.length === 0">{{ t('suprimentos.nenhum') }}</p>
      <p v-if="terceiros.data.value.cortada" role="status">{{ t('suprimentos.cortada') }}</p>
    </template>
    <h2>{{ t('suprimentos.fornecedores.prestadores') }}</h2>
    <ErroSuprimentos v-if="prestadores.error.value" :erro="prestadores.error.value" />
    <p v-else-if="!prestadores.data.value" role="status">{{ t('suprimentos.carregando') }}</p>
    <template v-else>
      <table class="tabela" data-testid="forn-prestadores">
        <caption>
          {{
            t('suprimentos.fornecedores.prestadores')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('suprimentos.codigo') }}</th>
            <th scope="col">{{ t('suprimentos.nome') }}</th>
            <th scope="col">{{ t('suprimentos.fornecedores.empresa') }}</th>
            <th scope="col">{{ t('suprimentos.fornecedores.cpf') }}</th>
            <th scope="col">{{ t('suprimentos.fornecedores.situacao') }}</th>
            <th scope="col">{{ t('suprimentos.fornecedores.banco') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in prestadores.data.value.itens" :key="`${x.empresa}-${x.codigo}`">
            <td>{{ x.codigo }}</td>
            <td>{{ x.nome }}</td>
            <td>{{ x.empresa }}</td>
            <td>
              {{ x.documento || '—' }}
              <span v-if="x.documento && !x.documentoValido" class="secundario">
                · {{ t('suprimentos.fornecedores.documentoInvalido') }}</span
              >
            </td>
            <td>{{ x.situacao || '—' }}</td>
            <td>{{ x.banco ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="prestadores.data.value.itens.length === 0">{{ t('suprimentos.nenhum') }}</p>
      <p v-if="prestadores.data.value.cortada" role="status">{{ t('suprimentos.cortada') }}</p>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
