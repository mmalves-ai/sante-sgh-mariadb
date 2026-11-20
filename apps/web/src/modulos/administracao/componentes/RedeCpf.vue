<script setup lang="ts">
// "Usuários" > "Identidade única" > "A pessoa na rede" (W1-01, parte 11c; identidade única na rede e gestão central):
// procura a pessoa pelo CPF (ou pelo login de uma conta daqui) em cada estabelecimento da rede e mostra as contas, o
// grupo e os perfis; "Bloquear em todos" pede o motivo e a senha (diálogo único) e mostra o resultado por conta. O
// CPF vai no corpo do pedido e nunca volta do servidor.
import type { PainelRedeCpf, ResultadoBloqueioRedeCpf } from '@sgh/contratos';
import { SanteBotao, SanteDialogoGravacao, type PedidoGravacao } from '@sgh/ui';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { bloquearNaRede, buscarRedeCpf } from '../api.js';
import { CAMINHO_LISTA_USUARIOS } from '../usuarios-tela.js';

const props = defineProps<{ loginInicial?: string | undefined }>();
const P = 'adm.usuarios.cpf.rede';
const { t } = useI18n();

const por = ref<'cpf' | 'login'>(props.loginInicial ? 'login' : 'cpf');
const valor = ref(props.loginInicial ?? '');
const painel = ref<PainelRedeCpf | null>(null);
const resultado = ref<ResultadoBloqueioRedeCpf | null>(null);
const erro = ref<unknown>(null);
const carregando = ref(false);
const dialogo = ref(false);
const ocupado = ref(false);
/** O alvo da última procura (o bloqueio usa o mesmo, não o que estiver digitado depois). */
const alvo = ref<{ cpf?: string; login?: string } | null>(null);

const podeBloquear = computed(() => pode('acesso.usuario.bloquear'));
const caminhoFicha = (login: string) => `${CAMINHO_LISTA_USUARIOS}/${encodeURIComponent(login)}`;
const valido = computed(() =>
  por.value === 'cpf' ? valor.value.replace(/\D/g, '').length === 11 : valor.value.trim().length > 0,
);

async function procurar(): Promise<void> {
  if (!valido.value) return;
  const a = por.value === 'cpf' ? { cpf: valor.value.replace(/\D/g, '') } : { login: valor.value.trim() };
  carregando.value = true;
  erro.value = null;
  resultado.value = null;
  try {
    painel.value = await buscarRedeCpf(a);
    alvo.value = a;
  } catch (e) {
    painel.value = null;
    erro.value = e;
  } finally {
    carregando.value = false;
  }
}

onMounted(() => {
  if (props.loginInicial) void procurar();
});

const pedido = computed<PedidoGravacao | null>(() =>
  alvo.value
    ? {
        titulo: t(`${P}.bloquearTitulo`),
        texto: t(`${P}.bloquearTexto`),
        motivo: t(`${P}.motivo`),
        motivoObrigatorio: true,
        senha: true,
        confirmar: t(`${P}.bloquearTodos`),
        gravar: async ({ senha, motivo }) => {
          resultado.value = await bloquearNaRede(alvo.value!, motivo, senha);
        },
      }
    : null,
);
async function feito(): Promise<void> {
  // Relê a rede para mostrar a situação nova de cada conta.
  const r = resultado.value;
  if (alvo.value) painel.value = await buscarRedeCpf(alvo.value).catch(() => painel.value);
  resultado.value = r;
}
function falhou(e: unknown): void {
  erro.value = e;
}
const situacao = (c: { ativo: boolean; bloqueado: boolean }) =>
  c.bloqueado
    ? t('adm.usuarios.cpf.bloqueado')
    : c.ativo
      ? t('adm.usuarios.cpf.ativo')
      : t('adm.usuarios.cpf.inativo');
</script>

<template>
  <section class="rede-cpf" aria-labelledby="rede-cpf-titulo" data-testid="rede-cpf">
    <h3 id="rede-cpf-titulo">{{ t(`${P}.titulo`) }}</h3>
    <p>{{ t(`${P}.texto`) }}</p>
    <form class="rede-cpf__busca" data-testid="rede-cpf-form" @submit.prevent="procurar">
      <fieldset class="rede-cpf__por">
        <legend>{{ t(`${P}.por`) }}</legend>
        <label
          ><input v-model="por" type="radio" value="cpf" data-testid="rede-cpf-por-cpf" />
          {{ t(`${P}.porCpf`) }}</label
        >
        <label
          ><input v-model="por" type="radio" value="login" data-testid="rede-cpf-por-login" />
          {{ t(`${P}.porLogin`) }}</label
        >
      </fieldset>
      <label for="rede-cpf-valor" class="rotulo">{{ t(`${P}.valor`) }}</label>
      <input
        id="rede-cpf-valor"
        v-model="valor"
        class="entrada"
        :inputmode="por === 'cpf' ? 'numeric' : 'text'"
        :maxlength="por === 'cpf' ? 14 : 30"
        autocomplete="off"
        data-testid="rede-cpf-valor"
      />
      <SanteBotao
        :rotulo="t(`${P}.procurar`)"
        tipo="submit"
        :desabilitado="!valido || carregando"
        data-testid="rede-cpf-procurar"
      />
    </form>

    <MensagemErro v-if="erro" :erro="erro" />
    <p v-if="carregando">{{ t('adm.comum.carregando') }}</p>

    <template v-if="painel && !carregando">
      <p data-testid="rede-cpf-resumo">
        {{ t(`${P}.resumo`, { total: painel.totalContas, n: painel.aBloquear }) }}
      </p>
      <div
        v-for="e in painel.estabelecimentos"
        :key="e.codigo"
        class="rede-cpf__est"
        :data-testid="`rede-cpf-est-${e.codigo}`"
      >
        <h4>{{ e.nome }}</h4>
        <p v-if="e.situacao === 'indisponivel'" class="nota">{{ t(`${P}.indisponivel`) }}</p>
        <p v-else-if="e.contas.length === 0" class="nota">{{ t(`${P}.nenhumaConta`) }}</p>
        <table v-else class="tabela">
          <thead>
            <tr>
              <th scope="col">{{ t('adm.usuarios.cpf.login') }}</th>
              <th scope="col">{{ t('adm.usuarios.cpf.grupo') }}</th>
              <th scope="col">{{ t(`${P}.perfis`) }}</th>
              <th scope="col">{{ t('adm.usuarios.cpf.situacao') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in e.contas" :key="c.login" :data-testid="`rede-cpf-conta-${e.codigo}-${c.login}`">
              <td>
                <RouterLink
                  v-if="e.codigo === painel.estabelecimentos[0]?.codigo"
                  :to="caminhoFicha(c.login)"
                  >{{ c.login }}</RouterLink
                >
                <span v-else>{{ c.login }}</span>
              </td>
              <td>{{ c.grupo ?? '' }}</td>
              <td>{{ c.perfis.length ? c.perfis.join(', ') : t(`${P}.semPerfis`) }}</td>
              <td>{{ situacao(c) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <SanteBotao
        v-if="podeBloquear && painel.aBloquear > 0"
        :rotulo="t(`${P}.bloquearTodos`)"
        variante="secundario"
        data-testid="rede-cpf-bloquear"
        @acionar="dialogo = true"
      />
    </template>

    <div v-if="resultado" class="rede-cpf__resultado" role="status" data-testid="rede-cpf-resultado">
      <p>{{ t(`${P}.feito`, { n: resultado.bloqueados }) }}</p>
      <ul>
        <li
          v-for="(r, i) in resultado.resultados"
          :key="i"
          :data-testid="`rede-cpf-res-${r.estabelecimento}-${r.login ?? 'banco'}`"
        >
          {{ r.estabelecimento }}<template v-if="r.login"> · {{ r.login }}</template
          >: {{ t(`${P}.resultado.${r.resultado}`) }}
          <template v-if="r.detalhe"> ({{ r.detalhe }})</template>
        </li>
      </ul>
    </div>

    <SanteDialogoGravacao
      v-model:visivel="dialogo"
      v-model:ocupado="ocupado"
      :pedido="pedido"
      @feito="feito"
      @falha="falhou"
    />
  </section>
</template>

<style scoped>
.rede-cpf {
  display: grid;
  gap: var(--sgh-espaco-3);
}
.rede-cpf__busca {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: var(--sgh-espaco-2);
}
.rede-cpf__por {
  border: 0;
  padding: 0;
  margin: 0;
  display: flex;
  gap: var(--sgh-espaco-2);
}
.rede-cpf__est {
  padding: var(--sgh-espaco-3);
  border: 1px solid var(--sgh-borda);
  border-radius: var(--sgh-raio);
}
.rede-cpf__est h4 {
  margin: 0 0 var(--sgh-espaco-2);
}
.tabela {
  width: 100%;
  border-collapse: collapse;
}
.tabela th,
.tabela td {
  text-align: left;
  padding: var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
.entrada {
  min-width: 14rem;
}
.nota {
  color: var(--sgh-texto-secundario);
}
</style>
