<script setup lang="ts">
// "Permissões, menus e papéis SBIS" (M10, ficha seção 7): a árvore de opções do menu por módulo (remontada sem
// chave de pai: salto de nível aparece marcado, nunca com pai adivinhado), as opções do grupo marcadas, e
// conceder ou retirar as selecionadas com a senha (receitas do ADR 0022). Ao lado, a política de senha (só
// consulta), os papéis SBIS e os tipos de acesso ao prontuário.
import type { NoOpcaoTela } from '@sgh/contratos';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { PERMISSOES_M59_F2_CODIGOS, tipoDoProblema } from '@sgh/contratos';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { buscarArvore, buscarPainelPermissoes, opcoesDoGrupo } from '../api.js';
import EstadoGravacoes from '../componentes/EstadoGravacoes.vue';
import SenhaConfirmacao from '../componentes/SenhaConfirmacao.vue';

const { t } = useI18n();
const cliente = useQueryClient();
// M59.2: a política do segundo fator mora neste item do menu (ficha, §7); o link só para quem pode lê-la.
const podePolitica2fa = computed(() => pode(PERMISSOES_M59_F2_CODIGOS.politica2faLer));
const podePoliticaSenha = computed(() => pode('acesso.perfil.gerir'));
const modulo = ref<number | null>(null);
const grupo = ref('');
const selecionadas = ref<Set<number>>(new Set());
const senha = ref('');
const aviso = ref('');
const recusa = ref('');
const erro = ref<unknown>(null);
// M59-F1: as contas do banco de dados abrem daqui (o item do menu é este).
const podeContasBanco = computed(() => pode('acesso.contaBanco.ler'));
const painel = useQuery({ queryKey: ['adm', 'permissoes'], queryFn: () => buscarPainelPermissoes() });
const arvore = useQuery({
  queryKey: computed(() => ['adm', 'arvore', modulo.value, grupo.value]),
  queryFn: () => buscarArvore({ modulo: modulo.value, grupo: grupo.value }),
});
watch([modulo, grupo], () => (selecionadas.value = new Set()));
const nos = computed(() => new Map((arvore.data.value?.nos ?? []).map((n) => [n.id, n])));
const marcadas = computed(() => new Set(arvore.data.value?.alvo?.opcoes ?? []));
const raizes = computed(() => arvore.data.value?.modulos.find((m) => m.id === modulo.value)?.raizes ?? []);

/** Lista em profundidade (a árvore é desenhada como lista indentada, acessível pelo teclado). */
const linhas = computed(() => {
  const r: { no: NoOpcaoTela; profundidade: number }[] = [];
  const visitar = (id: number, p: number) => {
    const no = nos.value.get(id);
    if (!no) return;
    r.push({ no, profundidade: p });
    for (const f of no.filhos) visitar(f, p + 1);
  };
  for (const id of raizes.value) visitar(id, 0);
  return r;
});
function alternar(id: number): void {
  const s = new Set(selecionadas.value);
  if (s.has(id)) s.delete(id);
  else s.add(id);
  selecionadas.value = s;
}
async function aplicar(acao: 'conceder' | 'revogar'): Promise<void> {
  aviso.value = '';
  recusa.value = '';
  erro.value = null;
  try {
    await opcoesDoGrupo(acao, grupo.value, [...selecionadas.value], senha.value);
    aviso.value = t('adm.comum.gravado');
    selecionadas.value = new Set();
    await cliente.invalidateQueries({ queryKey: ['adm', 'arvore'] });
  } catch (e) {
    if (e instanceof ErroApi && e.problema && tipoDoProblema(e.problema) === 'recusa-de-negocio')
      recusa.value = e.problema.detail ?? e.problema.title ?? '';
    else erro.value = e;
  } finally {
    senha.value = '';
  }
}
const pol = computed(() => painel.data.value?.politica);
const exigencias = computed(() => {
  const e = pol.value?.exige;
  if (!e) return '';
  return Object.entries(e)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .join(', ');
});
const opcoesModulo = computed(() => [
  { valor: null, rotulo: t('adm.permissoes.escolhaModulo') },
  ...(arvore.data.value?.modulos ?? []).map((m) => ({ valor: m.id, rotulo: m.nome })),
]);
const opcoesGrupo = computed(() => [
  { valor: '', rotulo: t('adm.permissoes.nenhumGrupo') },
  ...(painel.data.value?.grupos ?? []).map((g) => ({
    valor: g.nome,
    rotulo: `${g.nome}${g.ativo ? '' : ` (${t('adm.comum.inativo')})`}`,
  })),
]);
const podeConceder = computed(() => pode('acesso.opcao.conceder'));
const podeRevogar = computed(() => pode('acesso.opcao.revogar'));
</script>

<template>
  <section class="tela" aria-labelledby="permissoes-titulo">
    <h1 id="permissoes-titulo">{{ t('adm.permissoes.titulo') }}</h1>
    <p>{{ t('adm.permissoes.texto') }}</p>
    <p>
      <router-link to="/administracao/acesso/perfis">{{ t('adm.permissoes.perfis') }}</router-link> ·
      <router-link to="/administracao/acesso/mapa">{{ t('adm.permissoes.mapa') }}</router-link>
      <template v-if="podeContasBanco">
        ·
        <router-link to="/administracao/acesso/contas-banco" data-testid="abrir-contas-banco">{{
          t('adm.contasBanco.abrir')
        }}</router-link>
      </template>
      <template v-if="podePolitica2fa">
        ·
        <router-link to="/administracao/acesso/2fa" data-testid="ir-politica-2fa">{{
          t('adm.permissoes.politica2fa')
        }}</router-link>
      </template>
    </p>
    <MensagemErro v-if="painel.isError.value" :erro="painel.error.value" />
    <template v-if="painel.data.value">
      <EstadoGravacoes :operacoes="painel.data.value.operacoes" />
      <form class="filtros" @submit.prevent>
        <div class="campo">
          <SanteSelecao
            id="perm-modulo"
            v-model="modulo"
            :rotulo="t('adm.permissoes.modulo')"
            :opcoes="opcoesModulo"
            data-testid="perm-modulo"
          />
        </div>
        <div class="campo">
          <SanteSelecao
            id="perm-grupo"
            v-model="grupo"
            :rotulo="t('adm.permissoes.grupo')"
            :opcoes="opcoesGrupo"
            data-testid="perm-grupo"
          />
        </div>
      </form>
      <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar />
      <SanteAlerta v-if="recusa" :texto="recusa" variante="aviso" anunciar data-testid="perm-recusa" />
      <MensagemErro v-if="erro" :erro="erro" />
      <MensagemErro v-if="arvore.isError.value" :erro="arvore.error.value" />
      <template v-if="modulo !== null && arvore.data.value">
        <p v-if="arvore.data.value.avisos.length">
          {{ t('adm.permissoes.avisos', { n: arvore.data.value.avisos.length }) }}
        </p>
        <p v-if="arvore.data.value.alvo" role="status">
          {{ t('adm.permissoes.marcadas', { n: marcadas.size }) }} ·
          {{ t('adm.permissoes.selecionadas', { n: selecionadas.size }) }}
        </p>
        <ul class="arvore" data-testid="arvore-opcoes" :aria-label="t('adm.permissoes.modulo')">
          <li
            v-for="l in linhas"
            :key="l.no.id"
            :style="{ paddingLeft: `${l.profundidade * 1.25}rem` }"
            :class="{ inativa: !l.no.ativo }"
          >
            <label v-if="grupo && l.no.id > 0">
              <input
                type="checkbox"
                :checked="selecionadas.has(l.no.id)"
                :disabled="!l.no.ativo"
                :data-testid="`opcao-${l.no.id}`"
                @change="alternar(l.no.id)"
              />
              <span :class="{ marcada: marcadas.has(l.no.id) }">{{ l.no.titulo }}</span>
            </label>
            <span v-else>{{ l.no.titulo }}</span>
            <small v-if="marcadas.has(l.no.id)"> {{ t('adm.permissoes.temNoGrupo') }}</small>
            <small v-if="!l.no.ativo"> ({{ t('adm.permissoes.inativa') }})</small>
            <small v-if="l.no.salto"> ({{ t('adm.permissoes.salto') }})</small>
            <small v-if="l.no.permissao" class="permissao">
              — {{ t('adm.permissoes.permissao', { p: l.no.permissao }) }}</small
            >
          </li>
        </ul>
        <div v-if="grupo && selecionadas.size > 0" class="acoes">
          <SenhaConfirmacao v-model="senha" testid="perm-senha" />
          <SanteBotao
            v-if="podeConceder"
            :rotulo="t('adm.permissoes.conceder')"
            data-testid="perm-conceder"
            @acionar="aplicar('conceder')"
          />
          <SanteBotao
            v-if="podeRevogar"
            :rotulo="t('adm.permissoes.revogar')"
            variante="secundario"
            data-testid="perm-revogar"
            @acionar="aplicar('revogar')"
          />
        </div>
      </template>

      <section aria-labelledby="perm-politica">
        <h2 id="perm-politica">{{ t('adm.permissoes.politica') }}</h2>
        <!-- W1-01 (parte 5): a política se edita por versão com vigência na tela própria. -->
        <p v-if="podePoliticaSenha">
          <router-link to="/administracao/acesso/politica-senha" data-testid="ir-politica-senha">{{
            t('adm.permissoes.editarPolitica')
          }}</router-link>
          ·
          <router-link to="/administracao/acesso/contas-dormentes" data-testid="ir-contas-dormentes">{{
            t('adm.permissoes.contasDormentes')
          }}</router-link>
          ·
          <router-link to="/administracao/acesso/recertificacao" data-testid="ir-recertificacao">{{
            t('adm.permissoes.recertificacao')
          }}</router-link>
          ·
          <router-link to="/administracao/acesso/pedidos" data-testid="ir-pedidos-acesso">{{
            t('adm.permissoes.pedidosAcesso')
          }}</router-link>
          ·
          <router-link to="/administracao/acesso/rh" data-testid="ir-tarefas-rh">{{
            t('adm.permissoes.tarefasRh')
          }}</router-link>
        </p>
        <ul v-if="pol" data-testid="politica-senha">
          <li v-if="pol.trocaDias">{{ t('adm.permissoes.trocaDias', { n: pol.trocaDias }) }}</li>
          <li v-if="pol.reutilizacaoDias">
            {{ t('adm.permissoes.reutilizacao', { n: pol.reutilizacaoDias }) }}
          </li>
          <li v-if="pol.tentativasBloqueio">
            {{ t('adm.permissoes.tentativas', { n: pol.tentativasBloqueio }) }}
          </li>
          <li>{{ t('adm.permissoes.minimo', { n: pol.minimoCaracteres ?? 0, novo: pol.minimoDoNovo }) }}</li>
          <li v-if="exigencias">{{ t('adm.permissoes.exigencias', { lista: exigencias }) }}</li>
        </ul>
      </section>
      <section aria-labelledby="perm-papeis">
        <h2 id="perm-papeis">{{ t('adm.permissoes.papeis') }}</h2>
        <table>
          <caption class="oculto">
            {{
              t('adm.permissoes.papeis')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('adm.comum.nome') }}</th>
              <th scope="col">{{ t('adm.permissoes.usuarios') }}</th>
              <th scope="col">{{ t('adm.permissoes.opcoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in painel.data.value.papeis" :key="p.papel">
              <th scope="row">{{ p.nome }}</th>
              <td>{{ p.usuariosAtivos }}</td>
              <td>{{ p.opcoes }}</td>
            </tr>
          </tbody>
        </table>
      </section>
      <section aria-labelledby="perm-prontuario">
        <h2 id="perm-prontuario">{{ t('adm.permissoes.acessoProntuario') }}</h2>
        <ul>
          <li v-for="x in painel.data.value.acessoProntuario" :key="x.id">{{ x.descricao }}</li>
        </ul>
      </section>
    </template>
  </section>
</template>

<style scoped>
section + section {
  margin-top: var(--sgh-espaco-4);
}
.filtros,
.acoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: flex-end;
  margin: var(--sgh-espaco-2) 0;
}
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
}
.arvore {
  list-style: none;
  padding: 0;
  max-height: 32rem;
  overflow: auto;
  border: 1px solid var(--sgh-borda);
}
.arvore li {
  padding-top: 2px;
  padding-bottom: 2px;
}
.inativa {
  color: var(--sgh-texto-secundario);
}
.marcada {
  font-weight: 600;
}
.permissao {
  color: var(--sgh-texto-secundario);
}
table {
  border-collapse: collapse;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
.oculto {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
</style>
