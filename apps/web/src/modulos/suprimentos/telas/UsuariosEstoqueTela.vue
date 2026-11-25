<script setup lang="ts">
// Usuários do estoque e permissões por local (ficha do M28, seção 7): `/suprimentos/usuarios-locais`. Permissão
// sensível do gestor de acessos. Mostra, por usuário, os locais × tipos de movimento (GELOCUSU), os centros de custo
// e as classes do escopo e as marcas (autorizar requisição, pedido, necessidade; desbloquear o fechamento; lançar
// controlado). A edição abre o cadastro do escopo do usuário (F3.6-1, 05-SUP linha 3).
import { SanteBotao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { lerUsuarioEstoque, listarUsuariosEstoque } from '../api-suprimentos.js';
import { pode } from '../../../casca/sessao/pode.js';
import ErroSuprimentos from '../componentes/ErroSuprimentos.vue';

const { t } = useI18n();
const termo = ref('');
const busca = ref('');
const escolhido = ref('');
const podeEditar = computed(() => pode('acesso.escopo.editar'));
const lista = useQuery({
  queryKey: ['suprimentos', 'usuarios', busca],
  queryFn: () => listarUsuariosEstoque(busca.value),
});
const escopo = useQuery({
  queryKey: computed(() => ['suprimentos', 'usuario', escolhido.value]),
  queryFn: () => lerUsuarioEstoque(escolhido.value),
  enabled: computed(() => escolhido.value !== ''),
});
const TIPOS: Record<string, string> = {
  S: 'Saída',
  E: 'Entrada',
  D: 'Devolução',
  TO: 'Transferência (origem)',
  TD: 'Transferência (destino)',
  I: 'Inventário',
  R: 'Requisição',
  V: 'Saída a terceiro',
};
const tipos = (ts: readonly string[]) => ts.map((x) => TIPOS[x] ?? x).join(', ');
const sim = (b: boolean) => (b ? t('suprimentos.sim') : t('suprimentos.nao'));
</script>

<template>
  <section class="tela-agenda" aria-labelledby="usu-titulo" data-testid="tela-suprimentos-usuarios">
    <h1 id="usu-titulo">{{ t('suprimentos.usuarios.titulo') }}</h1>
    <p>{{ t('suprimentos.usuarios.texto') }}</p>
    <p v-if="podeEditar" class="atalhos">
      <RouterLink to="/suprimentos/usuarios-estoque/escopo" data-testid="usu-escopo">{{
        t('cadastroEstoque.atalhos.escopoUsuarios')
      }}</RouterLink>
    </p>
    <form class="filtros" @submit.prevent="busca = termo.trim()">
      <span class="campo">
        <label for="usu-termo">{{ t('suprimentos.usuarios.busca') }}</label>
        <input id="usu-termo" v-model="termo" data-testid="usu-termo" />
      </span>
      <SanteBotao
        tipo="submit"
        variante="secundario"
        :rotulo="t('suprimentos.buscar')"
        data-testid="usu-buscar"
      />
    </form>
    <ErroSuprimentos v-if="lista.error.value" :erro="lista.error.value" />
    <ul v-else-if="lista.data.value" data-testid="usu-lista">
      <li v-for="u in lista.data.value" :key="u.usuario">
        <SanteBotao
          variante="texto"
          :rotulo="`${u.usuario} · ${u.nome} · ${t('suprimentos.usuarios.nLocais', { n: u.locais })}`"
          :data-testid="`usu-${u.usuario}`"
          @acionar="escolhido = u.usuario"
        />
      </li>
    </ul>
    <ErroSuprimentos v-if="escopo.error.value" :erro="escopo.error.value" />
    <div v-if="escopo.data.value" class="painel" data-testid="usu-escopo">
      <h2>{{ escopo.data.value.usuario }} · {{ escopo.data.value.nome }}</h2>
      <table class="tabela">
        <caption>
          {{
            t('suprimentos.usuarios.locais')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('suprimentos.local') }}</th>
            <th scope="col">{{ t('suprimentos.usuarios.tipos') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in escopo.data.value.locais" :key="l.local">
            <td>{{ l.local }} · {{ l.localNome }}</td>
            <td>{{ tipos(l.tipos) }}</td>
          </tr>
        </tbody>
      </table>
      <h3>{{ t('suprimentos.usuarios.centros') }}</h3>
      <p>
        {{
          escopo.data.value.centrosCusto.map((c) => `${c.codigo} · ${c.nome}`).join('; ') ||
          t('suprimentos.usuarios.semRestricao')
        }}
      </p>
      <h3>{{ t('suprimentos.usuarios.classes') }}</h3>
      <p>
        {{
          escopo.data.value.classes.map((c) => `${c.codigo} · ${c.nome}`).join('; ') ||
          t('suprimentos.usuarios.semRestricao')
        }}
      </p>
      <h3>{{ t('suprimentos.usuarios.marcas') }}</h3>
      <dl class="ficha">
        <dt>{{ t('suprimentos.usuarios.autorizarRequisicao') }}</dt>
        <dd>{{ sim(escopo.data.value.flags.autorizarRequisicao) }}</dd>
        <dt>{{ t('suprimentos.usuarios.autorizarPedido') }}</dt>
        <dd>{{ sim(escopo.data.value.flags.autorizarPedido) }}</dd>
        <dt>{{ t('suprimentos.usuarios.autorizarNecessidade') }}</dt>
        <dd>{{ sim(escopo.data.value.flags.autorizarNecessidade) }}</dd>
        <dt>{{ t('suprimentos.usuarios.desbloquearFechamento') }}</dt>
        <dd>{{ sim(escopo.data.value.flags.desbloquearFechamento) }}</dd>
        <dt>{{ t('suprimentos.usuarios.lancarControlado') }}</dt>
        <dd>{{ sim(escopo.data.value.flags.lancarControlado) }}</dd>
      </dl>
    </div>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style scoped>
.ficha {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--sgh-espaco-1) var(--sgh-espaco-3);
}
.ficha dd {
  margin: 0;
}
</style>
