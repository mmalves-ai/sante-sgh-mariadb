<script setup lang="ts">
// Dicionário ortográfico pessoal (ficha do M27, seções 5 e 7): `/preferencias/dicionario`. As palavras que o corretor
// aceita para o próprio usuário, com incluir e excluir pelas receitas do CRUD (as mesmas linhas que o outro sistema lê:
// o dicionário é um só). Sem a gravação liberada no estabelecimento, a tela fica só para consulta com o motivo.
import { esquemaPalavraDicionario } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { pode } from '../../../casca/sessao/pode.js';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import { donoDaSessao, excluirPalavra, incluirPalavra, lerDicionario, novaChave } from '../api-inicio.js';
import ErroTrabalho from '../componentes/ErroTrabalho.vue';
import { filtrarPalavras } from '../regras-tela.js';

const { t } = useI18n();
const cliente = useQueryClient();
const { sessao } = usarSessao();
const dicionario = useQuery({
  queryKey: computed(() => ['dicionario', donoDaSessao(sessao.value)]),
  queryFn: () => lerDicionario(),
});
const podeEditar = computed(() => pode('acesso.dicionario.editar'));
const motivoIncluir = computed(() => dicionario.data.value?.gravacao.incluir ?? null);
const motivoExcluir = computed(() => dicionario.data.value?.gravacao.excluir ?? null);
const nova = ref('');
const filtro = ref('');
const erroCampo = ref<string | null>(null);
const erro = ref<unknown>(null);
const aviso = ref<string | null>(null);
const ocupado = ref(false);
const lista = computed(() => filtrarPalavras(dicionario.data.value?.palavras ?? [], filtro.value));

async function gravar(acao: () => Promise<unknown>, feito: string): Promise<void> {
  erro.value = null;
  aviso.value = null;
  ocupado.value = true;
  try {
    await acao();
    aviso.value = feito;
    await cliente.invalidateQueries({ queryKey: ['dicionario'] });
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}
async function incluir(): Promise<void> {
  const v = esquemaPalavraDicionario.safeParse({ palavra: nova.value });
  if (!v.success) {
    erroCampo.value = v.error.issues[0]?.message ?? null;
    return;
  }
  erroCampo.value = null;
  const p = v.data.palavra;
  await gravar(() => incluirPalavra(p, novaChave('dic-incluir')), t('trabalho.dicionario.incluida', { p }));
  if (!erro.value) nova.value = '';
}
const excluir = (p: string) =>
  gravar(() => excluirPalavra(p, novaChave('dic-excluir')), t('trabalho.dicionario.excluida', { p }));
</script>

<template>
  <section class="tela-agenda" aria-labelledby="dic-titulo" data-testid="tela-dicionario">
    <h1 id="dic-titulo">{{ t('trabalho.dicionario.titulo') }}</h1>
    <p>{{ t('trabalho.dicionario.texto') }}</p>
    <ErroTrabalho v-if="dicionario.isError.value" :erro="dicionario.error.value" />
    <p v-else-if="!dicionario.data.value" role="status">{{ t('trabalho.carregando') }}</p>
    <template v-else>
      <p v-if="motivoIncluir" class="painel" data-testid="dic-so-consulta">
        <SanteAlerta
          variante="info"
          :texto="t('trabalho.dicionario.gravacaoDesligada', { motivo: motivoIncluir })"
        />
      </p>
      <form
        v-if="podeEditar && !motivoIncluir"
        class="filtros"
        novalidate
        data-testid="dic-form"
        @submit.prevent="incluir"
      >
        <SanteCampoTexto
          v-model="nova"
          :rotulo="t('trabalho.dicionario.palavra')"
          :max-bytes="50"
          data-testid="dic-palavra"
        />
        <SanteBotao
          tipo="submit"
          :rotulo="t('trabalho.dicionario.incluir')"
          :desabilitado="ocupado"
          data-testid="dic-incluir"
        />
      </form>
      <p v-if="erroCampo" class="erro" role="alert" data-testid="dic-erro-campo">{{ erroCampo }}</p>
      <p v-if="aviso" role="status" data-testid="dic-aviso">{{ aviso }}</p>
      <ErroTrabalho v-if="erro" :erro="erro" />
      <p class="secundario" data-testid="dic-total">
        {{
          t('trabalho.dicionario.total', {
            n: dicionario.data.value.palavras.length,
            teto: dicionario.data.value.teto,
          })
        }}
      </p>
      <SanteCampoTexto
        v-if="dicionario.data.value.palavras.length > 10"
        v-model="filtro"
        :rotulo="t('trabalho.dicionario.filtrar')"
        :max-bytes="50"
        data-testid="dic-filtro"
      />
      <p v-if="dicionario.data.value.palavras.length === 0">{{ t('trabalho.dicionario.vazio') }}</p>
      <ul v-else class="palavras" :aria-label="t('trabalho.dicionario.lista')" data-testid="dic-lista">
        <li v-for="p in lista" :key="p.palavra" :data-testid="`dic-${p.palavra}`">
          <span>{{ p.palavra }}</span>
          <SanteBotao
            v-if="podeEditar && !motivoExcluir"
            variante="destrutivo"
            :rotulo="t('trabalho.dicionario.excluir')"
            :confirmacao="t('trabalho.dicionario.excluirConfirma', { p: p.palavra })"
            :aria-label="`${t('trabalho.dicionario.excluir')} ${p.palavra}`"
            :desabilitado="ocupado"
            :data-testid="`dic-excluir-${p.palavra}`"
            @acionar="excluir(p.palavra)"
          />
        </li>
      </ul>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style scoped>
.palavras {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
  gap: var(--sgh-espaco-2);
}
.palavras li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda);
  border-radius: 6px;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
}
.erro {
  font-weight: 600;
  margin: 0;
}
</style>
