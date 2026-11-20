<script setup lang="ts">
// "Usuários" > "Senhas e segundo fator" (M59-F2; ficha do M59, seção 7: a tela do M10 com as colunas novas). O resumo
// do estabelecimento em faixas (nenhum número abaixo de 5), a lista paginada no servidor com a situação da senha
// (só a classe, nunca o valor) e do segundo fator, o filtro pela situação da senha e as ações do gestor de acessos:
// retirar a senha antiga (só com a credencial forte e depois da contingência; a operação pode estar desligada, e o
// servidor diz o motivo) e revogar o segundo fator (troca de celular). As duas pedem a senha de novo.
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import {
  PERMISSOES_M59_F2_CODIGOS,
  SITUACOES_CREDENCIAL,
  SITUACOES_SEGUNDO_FATOR,
  type SituacaoCredencial,
  type UsuarioIdentidade,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { computed, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import {
  buscarResumoIdentidade,
  listarUsuariosIdentidade,
  retirarSenhaAntiga,
  revogarSegundoFatorDe,
} from '../../acesso/api-identidade.js';
import SenhaConfirmacao from './SenhaConfirmacao.vue';

const { t } = useI18n();
const cliente = useQueryClient();
const busca = ref('');
const termo = ref('');
const senhaFiltro = ref<'' | SituacaoCredencial>('');
const pagina = ref(1);
let espera: ReturnType<typeof setTimeout> | undefined;
watch(busca, (b) => {
  clearTimeout(espera);
  espera = setTimeout(() => {
    termo.value = b.trim();
    pagina.value = 1;
  }, 300);
});
watch(senhaFiltro, () => (pagina.value = 1));

const resumo = useQuery({ queryKey: ['identidade', 'resumo'], queryFn: () => buscarResumoIdentidade() });
const lista = useQuery({
  queryKey: computed(() => ['identidade', 'usuarios', termo.value, senhaFiltro.value, pagina.value]),
  queryFn: () =>
    listarUsuariosIdentidade({
      ...(termo.value ? { busca: termo.value } : {}),
      ...(senhaFiltro.value ? { senha: senhaFiltro.value } : {}),
      pagina: pagina.value,
    }),
});
const podeRetirar = computed(() => pode(PERMISSOES_M59_F2_CODIGOS.senhaLegadoRetirar));
const podeRevogar = computed(() => pode(PERMISSOES_M59_F2_CODIGOS.politica2faEditar));
const comAcoes = computed(() => podeRetirar.value || podeRevogar.value);
const podePolitica2fa = computed(() => pode(PERMISSOES_M59_F2_CODIGOS.politica2faLer));
const opcoesSenha = computed(() => [
  { valor: '' as const, rotulo: t('identidade.usuarios.todas') },
  ...SITUACOES_CREDENCIAL.map((s) => ({ valor: s, rotulo: t(`identidade.situacaoSenha.${s}`) })),
]);
const contingencia = computed(() => resumo.data.value?.contingencia ?? true);
const podeRetirarDe = (u: UsuarioIdentidade): boolean =>
  podeRetirar.value && !contingencia.value && u.senha === 'forte' && u.senhaLegadoPresente;
const podeRevogarDe = (u: UsuarioIdentidade): boolean =>
  podeRevogar.value && (u.segundoFator === 'ativo' || u.segundoFator === 'pendente');

// ── ação com a senha de novo ───────────────────────────────────────────────────────────────────
type Acao = { tipo: 'retirar' | 'revogar'; login: string };
const acao = ref<Acao | null>(null);
const senha = ref('');
const erro = ref<unknown>(null);
const aviso = ref('');
const ocupado = ref(false);
const dialogo = computed({
  get: () => acao.value !== null,
  set: (v: boolean) => {
    if (!v) acao.value = null;
  },
});
function abrir(tipo: Acao['tipo'], login: string): void {
  acao.value = { tipo, login };
  senha.value = '';
  erro.value = null;
}
async function confirmar(): Promise<void> {
  const a = acao.value;
  if (!a || ocupado.value) return;
  ocupado.value = true;
  erro.value = null;
  try {
    if (a.tipo === 'retirar') await retirarSenhaAntiga(a.login, senha.value);
    else await revogarSegundoFatorDe(a.login, senha.value);
    aviso.value = t(a.tipo === 'retirar' ? 'identidade.usuarios.retirada' : 'identidade.usuarios.revogado', {
      login: a.login,
    });
    acao.value = null;
    await cliente.invalidateQueries({ queryKey: ['identidade'] });
  } catch (e) {
    erro.value = e;
  } finally {
    senha.value = '';
    ocupado.value = false;
  }
}
</script>

<template>
  <div class="identidade" data-testid="identidade-usuarios">
    <h2>{{ t('identidade.usuarios.titulo') }}</h2>
    <p>{{ t('identidade.usuarios.texto') }}</p>
    <p v-if="podePolitica2fa">
      <RouterLink to="/administracao/acesso/2fa" data-testid="identidade-ir-politica-2fa">{{
        t('identidade.usuarios.politica2fa')
      }}</RouterLink>
    </p>
    <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="identidade-aviso" />

    <MensagemErro v-if="resumo.isError.value" :erro="resumo.error.value" />
    <template v-else-if="resumo.data.value">
      <SanteAlerta
        v-if="!resumo.data.value.tabelasProntas"
        :texto="t('identidade.comum.indisponivel')"
        variante="info"
        data-testid="identidade-indisponivel"
      />
      <section class="resumo" :aria-label="t('identidade.usuarios.resumo')" data-testid="identidade-resumo">
        <h3>{{ t('identidade.usuarios.resumo') }}</h3>
        <p>
          {{ t('identidade.usuarios.ativos') }}:
          <strong data-testid="identidade-ativos">{{ resumo.data.value.ativos }}</strong>
        </p>
        <div class="resumo__colunas">
          <dl>
            <dt>{{ t('identidade.usuarios.porSenha') }}</dt>
            <dd v-for="s in SITUACOES_CREDENCIAL" :key="s" :data-testid="`identidade-senha-${s}`">
              {{ t(`identidade.situacaoSenha.${s}`) }}: {{ resumo.data.value.porSenha[s] ?? 0 }}
            </dd>
          </dl>
          <dl>
            <dt>{{ t('identidade.usuarios.porFator') }}</dt>
            <dd v-for="s in SITUACOES_SEGUNDO_FATOR" :key="s" :data-testid="`identidade-fator-${s}`">
              {{ t(`identidade.situacaoFator.${s}`) }}: {{ resumo.data.value.porSegundoFator[s] ?? 0 }}
            </dd>
          </dl>
        </div>
        <SanteAlerta
          :texto="
            resumo.data.value.contingencia
              ? t('identidade.usuarios.contingenciaLigada')
              : t('identidade.usuarios.contingenciaDesligada')
          "
          :variante="resumo.data.value.contingencia ? 'aviso' : 'info'"
          data-testid="identidade-contingencia"
        />
      </section>
    </template>

    <form class="filtros" role="search" @submit.prevent="termo = busca.trim()">
      <div class="campo">
        <label for="identidade-busca">{{ t('identidade.usuarios.busca') }}</label>
        <input
          id="identidade-busca"
          v-model="busca"
          type="search"
          maxlength="60"
          data-testid="identidade-busca"
        />
      </div>
      <div class="campo">
        <SanteSelecao
          v-model="senhaFiltro"
          :rotulo="t('identidade.usuarios.filtroSenha')"
          :opcoes="opcoesSenha"
          data-testid="identidade-filtro-senha"
        />
      </div>
    </form>

    <MensagemErro v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="lista.isPending.value">{{ t('identidade.comum.carregando') }}</p>
    <template v-else-if="lista.data.value">
      <p v-if="lista.data.value.itens.length === 0" role="status" data-testid="identidade-vazia">
        {{ t('identidade.usuarios.nenhum') }}
      </p>
      <div v-else class="rolagem" tabindex="0" role="region" :aria-label="t('identidade.usuarios.rolagem')">
        <table data-testid="tabela-identidade">
          <caption>
            {{
              t('identidade.usuarios.legenda')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('identidade.usuarios.login') }}</th>
              <th scope="col">{{ t('identidade.usuarios.nome') }}</th>
              <th scope="col">{{ t('identidade.usuarios.grupo') }}</th>
              <th scope="col">{{ t('identidade.usuarios.senha') }}</th>
              <th scope="col">{{ t('identidade.usuarios.senhaAntiga') }}</th>
              <th scope="col">{{ t('identidade.usuarios.fator') }}</th>
              <th v-if="comAcoes" scope="col">{{ t('identidade.usuarios.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="u in lista.data.value.itens"
              :key="u.login"
              :data-testid="`identidade-linha-${u.login}`"
            >
              <th scope="row">{{ u.login }}</th>
              <td>{{ u.nome }}</td>
              <td>{{ u.grupo ?? '—' }}</td>
              <td :data-testid="`identidade-senha-de-${u.login}`">
                {{ t(`identidade.situacaoSenha.${u.senha}`) }}
              </td>
              <td>
                {{ u.senhaLegadoPresente ? t('identidade.usuarios.sim') : t('identidade.usuarios.nao') }}
              </td>
              <td :data-testid="`identidade-fator-de-${u.login}`">
                {{ t(`identidade.situacaoFator.${u.segundoFator}`) }}
              </td>
              <td v-if="comAcoes" class="acoes">
                <SanteBotao
                  v-if="podeRetirarDe(u)"
                  :rotulo="t('identidade.usuarios.retirar')"
                  variante="texto"
                  :data-testid="`identidade-retirar-${u.login}`"
                  @acionar="abrir('retirar', u.login)"
                />
                <SanteBotao
                  v-if="podeRevogarDe(u)"
                  :rotulo="t('identidade.usuarios.revogar')"
                  variante="texto"
                  :data-testid="`identidade-revogar-${u.login}`"
                  @acionar="abrir('revogar', u.login)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="paginas">
        <SanteBotao
          :rotulo="t('identidade.usuarios.anterior')"
          variante="texto"
          :desabilitado="pagina <= 1"
          @acionar="pagina--"
        />
        <span>{{ t('identidade.usuarios.pagina', { n: pagina }) }}</span>
        <SanteBotao
          :rotulo="t('identidade.usuarios.proxima')"
          variante="texto"
          :desabilitado="!lista.data.value.temMais"
          @acionar="pagina++"
        />
      </div>
    </template>

    <SanteDialogo
      v-model:visivel="dialogo"
      :titulo="
        acao
          ? t(acao.tipo === 'retirar' ? 'identidade.usuarios.retirarDe' : 'identidade.usuarios.revogarDe', {
              login: acao.login,
            })
          : ''
      "
    >
      <form v-if="acao" class="form" data-testid="form-identidade-acao" @submit.prevent="confirmar">
        <p>
          {{
            t(
              acao.tipo === 'retirar'
                ? 'identidade.usuarios.retirarTexto'
                : 'identidade.usuarios.revogarTexto',
              {
                login: acao.login,
              },
            )
          }}
        </p>
        <MensagemErro v-if="erro" :erro="erro" />
        <SenhaConfirmacao v-model="senha" testid="identidade-acao-senha" />
        <div class="botoes">
          <SanteBotao
            :rotulo="t('identidade.comum.confirmar')"
            tipo="submit"
            :desabilitado="ocupado"
            data-testid="identidade-acao-confirmar"
          />
          <SanteBotao :rotulo="t('identidade.comum.cancelar')" variante="texto" @acionar="dialogo = false" />
        </div>
      </form>
    </SanteDialogo>
  </div>
</template>

<style scoped>
.resumo {
  margin: var(--sgh-espaco-2) 0;
}
.resumo__colunas {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-4);
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
