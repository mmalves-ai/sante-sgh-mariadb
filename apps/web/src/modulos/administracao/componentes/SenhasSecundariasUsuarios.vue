<script setup lang="ts">
// "Usuários" > "Senhas secundárias" (M59-F3; ficha do M59, seção 5: senhas secundárias retiradas). O resumo em
// faixas (nenhum número abaixo de 5), a lista paginada no servidor de quem ainda tem senha secundária guardada (só
// o tipo, nunca o valor) e a retirada pelo gestor (a senha de novo; nunca a própria, segregação de funções; só
// depois da contingência; a operação pode estar desligada, e a tela mostra o motivo).
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { COLUNAS_SENHA_SECUNDARIA, PERMISSOES_M59_CODIGOS } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteDialogo } from '@sgh/ui';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { listarSenhasSecundarias, retirarSenhasSecundarias } from '../../acesso/api-segredos.js';
import { fmtContagem } from '../../acesso/segredos-tela.js';
import SenhaConfirmacao from './SenhaConfirmacao.vue';

const P = 'segredos.senhasSecundarias';
const { t } = useI18n();
const cliente = useQueryClient();
const busca = ref('');
const termo = ref('');
const pagina = ref(1);
let espera: ReturnType<typeof setTimeout> | undefined;
watch(busca, (b) => {
  clearTimeout(espera);
  espera = setTimeout(() => {
    termo.value = b.trim();
    pagina.value = 1;
  }, 300);
});

const lista = useQuery({
  queryKey: computed(() => ['senhas-secundarias', termo.value, pagina.value]),
  queryFn: () =>
    listarSenhasSecundarias({ ...(termo.value ? { busca: termo.value } : {}), pagina: pagina.value }),
});
const dados = computed(() => lista.data.value);
const podeRetirar = computed(() => pode(PERMISSOES_M59_CODIGOS.senhaSecundariaRetirar));
const liberada = computed(
  () => !!dados.value && !dados.value.contingenciaLigada && dados.value.receita.ligada,
);
const paginas = computed(() => Math.max(1, Math.ceil((dados.value?.total ?? 0) / 50)));

// ── retirada com a senha de novo ──────────────────────────────────────────────────────────────
const alvo = ref<string | null>(null);
const senha = ref('');
const erro = ref<unknown>(null);
const aviso = ref('');
const ocupado = ref(false);
const dialogo = computed({
  get: () => alvo.value !== null,
  set: (v: boolean) => {
    if (!v) alvo.value = null;
  },
});
function abrir(login: string): void {
  alvo.value = login;
  senha.value = '';
  erro.value = null;
}
async function confirmar(): Promise<void> {
  const login = alvo.value;
  if (!login || ocupado.value) return;
  ocupado.value = true;
  erro.value = null;
  try {
    await retirarSenhasSecundarias(login, senha.value);
    aviso.value = t(`${P}.retirada`, { login });
    alvo.value = null;
    await cliente.invalidateQueries({ queryKey: ['senhas-secundarias'] });
  } catch (e) {
    erro.value = e;
  } finally {
    senha.value = '';
    ocupado.value = false;
  }
}
</script>

<template>
  <div class="senhas-sec" data-testid="senhas-secundarias">
    <h2>{{ t(`${P}.titulo`) }}</h2>
    <p>{{ t(`${P}.texto`) }}</p>
    <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="senhas-sec-aviso" />

    <form class="filtros" role="search" @submit.prevent="termo = busca.trim()">
      <div class="campo">
        <label for="senhas-sec-busca">{{ t(`${P}.busca`) }}</label>
        <input
          id="senhas-sec-busca"
          v-model="busca"
          type="search"
          maxlength="31"
          data-testid="senhas-sec-busca"
        />
      </div>
    </form>

    <MensagemErro v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="lista.isPending.value">{{ t('segredos.comum.carregando') }}</p>
    <template v-else-if="dados">
      <section class="resumo" :aria-label="t(`${P}.resumo`)" data-testid="senhas-sec-resumo">
        <h3>{{ t(`${P}.resumo`) }}</h3>
        <p>
          {{ t(`${P}.total`) }}:
          <strong data-testid="senhas-sec-total">{{ fmtContagem(dados.usuariosComSenha) }}</strong>
        </p>
        <dl>
          <dt>{{ t(`${P}.porColuna`) }}</dt>
          <dd v-for="c in dados.porColuna" :key="c.coluna" :data-testid="`senhas-sec-tipo-${c.coluna}`">
            {{ t(`${P}.tipos.${c.coluna}`) }}: {{ fmtContagem(c.usuarios) }}
          </dd>
        </dl>
        <SanteAlerta
          :texto="
            dados.contingenciaLigada
              ? t('segredos.comum.contingenciaLigada')
              : t('segredos.comum.contingenciaDesligada')
          "
          :variante="dados.contingenciaLigada ? 'aviso' : 'info'"
          data-testid="senhas-sec-contingencia"
        />
        <SanteAlerta
          v-if="!dados.receita.ligada"
          :texto="
            dados.receita.motivo
              ? t('segredos.comum.receitaDesligada', { motivo: dados.receita.motivo })
              : t('segredos.comum.receitaDesligadaSemMotivo')
          "
          variante="info"
          data-testid="senhas-sec-desligada"
        />
      </section>

      <p v-if="dados.usuarios.length === 0" role="status" data-testid="senhas-sec-vazia">
        {{ t(`${P}.nenhum`) }}
      </p>
      <div v-else class="rolagem" tabindex="0" role="region" :aria-label="t(`${P}.rolagem`)">
        <table data-testid="tabela-senhas-sec">
          <caption>
            {{
              t(`${P}.legenda`)
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t(`${P}.login`) }}</th>
              <th scope="col">{{ t(`${P}.tem`) }}</th>
              <th v-if="podeRetirar" scope="col">{{ t(`${P}.acoes`) }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="u in dados.usuarios" :key="u.login" :data-testid="`senhas-sec-linha-${u.login}`">
              <th scope="row">{{ u.login }}</th>
              <td>
                {{
                  COLUNAS_SENHA_SECUNDARIA.filter((c) => u.colunas.includes(c))
                    .map((c) => t(`${P}.tipos.${c}`))
                    .join(', ')
                }}
              </td>
              <td v-if="podeRetirar" class="acoes">
                <span v-if="u.proprio" class="discreto">{{ t(`${P}.proprio`) }}</span>
                <SanteBotao
                  v-else-if="liberada"
                  :rotulo="t(`${P}.retirar`)"
                  variante="texto"
                  :data-testid="`senhas-sec-retirar-${u.login}`"
                  @acionar="abrir(u.login)"
                />
                <span v-else class="discreto">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="paginas">
        <SanteBotao
          :rotulo="t(`${P}.anterior`)"
          variante="texto"
          :desabilitado="pagina <= 1"
          @acionar="pagina--"
        />
        <span>{{ t(`${P}.pagina`, { n: pagina, total: paginas }) }}</span>
        <SanteBotao
          :rotulo="t(`${P}.proxima`)"
          variante="texto"
          :desabilitado="pagina >= paginas"
          @acionar="pagina++"
        />
      </div>
    </template>

    <SanteDialogo v-model:visivel="dialogo" :titulo="alvo ? t(`${P}.retirarDe`, { login: alvo }) : ''">
      <form v-if="alvo" class="form" data-testid="form-senhas-sec" @submit.prevent="confirmar">
        <p>{{ t(`${P}.retirarTexto`, { login: alvo }) }}</p>
        <MensagemErro v-if="erro" :erro="erro" />
        <SenhaConfirmacao v-model="senha" testid="senhas-sec-senha" />
        <div class="botoes">
          <SanteBotao
            :rotulo="t('segredos.comum.confirmar')"
            tipo="submit"
            :desabilitado="ocupado"
            data-testid="senhas-sec-confirmar"
          />
          <SanteBotao :rotulo="t('segredos.comum.cancelar')" variante="texto" @acionar="dialogo = false" />
        </div>
      </form>
    </SanteDialogo>
  </div>
</template>

<style scoped>
.resumo {
  margin: var(--sgh-espaco-2) 0;
}
.resumo dl {
  margin: 0;
}
.resumo dt {
  font-weight: 600;
}
.resumo dd {
  margin: 0;
}
.filtros {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: flex-end;
  margin: var(--sgh-espaco-2) 0;
}
.campo,
.form {
  display: grid;
  gap: var(--sgh-espaco-1);
}
.form {
  gap: var(--sgh-espaco-2);
}
.botoes,
.paginas,
.acoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: center;
}
.discreto {
  color: var(--sgh-texto-secundario);
}
.rolagem {
  overflow-x: auto;
}
table {
  border-collapse: collapse;
  width: 100%;
}
caption {
  text-align: left;
  font-weight: 600;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
input {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
</style>
