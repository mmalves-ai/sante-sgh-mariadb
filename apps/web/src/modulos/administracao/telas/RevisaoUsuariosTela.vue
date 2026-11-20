<script setup lang="ts">
// Revisão dos usuários sem grupo e dos logins de painel (M43, ficha campo 7; regras 4 e 5): para o gestor de acessos
// do estabelecimento ativo. Cada ativo sem grupo recebe um grupo de trabalho (troca de grupo) ou é bloqueado; o login
// de TV ou de totem só é bloqueado com o aparelho no token, válido e conferido no setor (o servidor confere de novo).
// As gravações são as da tela de usuários (senha de novo; nada é apagado). A leitura da lista vai à trilha.
import type { RevisaoFimCoexistencia } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { bloquear, lerRevisaoUsuarios, trocarGrupo } from '../api.js';
import SenhaConfirmacao from '../componentes/SenhaConfirmacao.vue';

const { t } = useI18n();
const cliente = useQueryClient();
const consulta = useQuery({ queryKey: ['adm', 'revisao-onda5'], queryFn: () => lerRevisaoUsuarios() });
const r = computed<RevisaoFimCoexistencia | undefined>(() => consulta.data.value);
const podeEditar = computed(() => pode('acesso.usuario.editar'));
const podeBloquear = computed(() => pode('acesso.usuario.bloquear'));
const opcoesGrupo = computed(() => (r.value?.gruposDestino ?? []).map((g) => ({ valor: g, rotulo: g })));
const destino = reactive<Record<string, string | null>>({});
const dia = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—');

type Acao = { tipo: 'grupo'; login: string; grupo: string } | { tipo: 'bloquear'; login: string };
const acao = ref<Acao | null>(null);
const senha = ref('');
const erro = ref<unknown>(null);
const recusa = ref<string | null>(null);
const aviso = ref<string | null>(null);
const salvando = ref(false);
const dialogo = computed({
  get: () => acao.value !== null,
  set: (v: boolean) => {
    if (!v) acao.value = null;
  },
});
const pergunta = computed(() => {
  const a = acao.value;
  if (!a) return '';
  return a.tipo === 'grupo'
    ? t('coexistencia.fim.revisao.confirmarGrupo', { grupo: a.grupo, login: a.login })
    : t('coexistencia.fim.revisao.confirmarBloqueio', { login: a.login });
});
function abrir(a: Acao): void {
  senha.value = '';
  erro.value = null;
  recusa.value = null;
  aviso.value = null;
  acao.value = a;
}
async function confirmar(): Promise<void> {
  const a = acao.value;
  if (!a) return;
  salvando.value = true;
  erro.value = null;
  recusa.value = null;
  try {
    if (a.tipo === 'grupo') await trocarGrupo(a.login, a.grupo, senha.value);
    else await bloquear(a.login, true, senha.value);
    aviso.value = t('coexistencia.fim.revisao.feito', { login: a.login });
    acao.value = null;
    await cliente.invalidateQueries({ queryKey: ['adm', 'revisao-onda5'] });
  } catch (e) {
    // A recusa de negócio (regra 4: a TV ainda usa o login) mostra o motivo do servidor.
    if (e instanceof ErroApi && e.status === 409 && e.problema?.detail) recusa.value = e.problema.detail;
    else erro.value = e;
  } finally {
    salvando.value = false;
    senha.value = '';
  }
}
</script>

<template>
  <section class="tela" aria-labelledby="revisao-titulo" data-testid="tela-revisao-onda5">
    <h1 id="revisao-titulo">{{ t('coexistencia.fim.revisao.titulo') }}</h1>
    <p>{{ t('coexistencia.fim.revisao.explicacao') }}</p>
    <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="revisao-aviso" />
    <SanteAlerta v-if="recusa" :texto="recusa" variante="alerta" anunciar data-testid="revisao-recusa" />
    <MensagemErro v-if="erro" :erro="erro" />
    <MensagemErro v-if="consulta.error.value" :erro="consulta.error.value" />
    <p v-else-if="!r" role="status">{{ t('coexistencia.carregando') }}</p>
    <template v-else>
      <p data-testid="revisao-contagem">
        {{
          t('coexistencia.fim.revisao.contagem', {
            ativos: r.contagem.ativos,
            semGrupo: r.contagem.ativosSemGrupo,
            nulo: r.contagem.ativosGrupoNulo,
            livres: r.contagem.paineisLivres,
            bloqueados: r.contagem.paineisBloqueados,
          })
        }}
      </p>

      <section aria-labelledby="revisao-sem-grupo" data-testid="revisao-sem-grupo">
        <h2 id="revisao-sem-grupo">{{ t('coexistencia.fim.revisao.semGrupo') }}</h2>
        <p v-if="r.listaVazia" data-testid="revisao-vazia">{{ t('coexistencia.fim.revisao.vazia') }}</p>
        <table v-if="r.semGrupo.length > 0" class="tabela">
          <caption>
            {{
              t('coexistencia.fim.revisao.semGrupo')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('coexistencia.fim.revisao.login') }}</th>
              <th scope="col">{{ t('coexistencia.fim.revisao.grupoAtual') }}</th>
              <th scope="col">{{ t('coexistencia.fim.revisao.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="u in r.semGrupo" :key="u.login" :data-testid="`sem-grupo-${u.login}`">
              <th scope="row">{{ u.loginVazio ? t('coexistencia.fim.revisao.loginVazio') : u.login }}</th>
              <td>{{ u.grupo || t('coexistencia.fim.revisao.grupoVazio') }}</td>
              <td>
                <p v-if="u.loginVazio && u.excecao" data-testid="login-vazio-excecao">
                  {{
                    t('coexistencia.fim.revisao.loginVazioExcecao', {
                      data: dia(u.excecao.decididaEm),
                      decisao: u.excecao.decisao,
                    })
                  }}
                </p>
                <p v-else-if="u.loginVazio" data-testid="login-vazio-pendente">
                  {{ t('coexistencia.fim.revisao.loginVazioPendente') }}
                </p>
                <div v-else class="acoes-linha">
                  <SanteSelecao
                    v-if="podeEditar"
                    :id="`destino-${u.login}`"
                    :model-value="destino[u.login] ?? null"
                    @update:model-value="(v) => (destino[u.login] = v === null ? null : String(v))"
                    :rotulo="t('coexistencia.fim.revisao.grupoDestino')"
                    :opcoes="opcoesGrupo"
                    busca
                    :data-testid="`destino-${u.login}`"
                  />
                  <SanteBotao
                    v-if="podeEditar"
                    :rotulo="t('coexistencia.fim.revisao.atribuirGrupo')"
                    :desabilitado="!destino[u.login]"
                    :data-testid="`atribuir-${u.login}`"
                    @acionar="abrir({ tipo: 'grupo', login: u.login, grupo: destino[u.login] ?? '' })"
                  />
                  <SanteBotao
                    v-if="podeBloquear"
                    variante="secundario"
                    :rotulo="t('coexistencia.fim.revisao.bloquear')"
                    :data-testid="`bloquear-${u.login}`"
                    @acionar="abrir({ tipo: 'bloquear', login: u.login })"
                  />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section aria-labelledby="revisao-paineis" data-testid="revisao-paineis">
        <h2 id="revisao-paineis">{{ t('coexistencia.fim.revisao.paineis') }}</h2>
        <p data-testid="paineis-resolvidos">
          {{
            r.paineisResolvidos
              ? t('coexistencia.fim.revisao.paineisResolvidos')
              : t('coexistencia.fim.revisao.paineisPendentes')
          }}
        </p>
        <p>
          <RouterLink to="/recepcao/senhas/paineis" data-testid="ir-dispositivos">{{
            t('coexistencia.fim.revisao.irDispositivos')
          }}</RouterLink>
        </p>
        <p v-if="r.paineis.length === 0">{{ t('coexistencia.fim.revisao.nenhumPainel') }}</p>
        <table v-else class="tabela">
          <caption>
            {{
              t('coexistencia.fim.revisao.paineis')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('coexistencia.fim.revisao.login') }}</th>
              <th scope="col">{{ t('coexistencia.situacao') }}</th>
              <th scope="col">{{ t('coexistencia.fim.revisao.dispositivo') }}</th>
              <th scope="col">{{ t('coexistencia.fim.revisao.conferidoEm') }}</th>
              <th scope="col">{{ t('coexistencia.fim.revisao.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in r.paineis" :key="p.login" :data-testid="`painel-${p.login}`">
              <th scope="row">{{ p.login }}</th>
              <td data-testid="situacao">
                {{ t(`coexistencia.fim.revisao.situacoesPainel.${p.situacao}`) }}
              </td>
              <td>{{ p.dispositivoNome ?? (p.dispositivo === null ? '—' : `#${p.dispositivo}`) }}</td>
              <td>{{ dia(p.conferidoEm) }}</td>
              <td>
                <SanteBotao
                  v-if="podeBloquear && p.situacao === 'pode-bloquear'"
                  variante="secundario"
                  :rotulo="t('coexistencia.fim.revisao.bloquear')"
                  :data-testid="`bloquear-${p.login}`"
                  @acionar="abrir({ tipo: 'bloquear', login: p.login })"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>

    <SanteDialogo v-model:visivel="dialogo" :titulo="t('coexistencia.fim.revisao.titulo')" largura="32rem">
      <p data-testid="revisao-pergunta">{{ pergunta }}</p>
      <SenhaConfirmacao v-model="senha" testid="revisao-senha" />
      <template #rodape>
        <SanteBotao
          variante="secundario"
          :rotulo="t('coexistencia.fim.revisao.cancelar')"
          @acionar="acao = null"
        />
        <SanteBotao
          :rotulo="t('coexistencia.gravar')"
          :desabilitado="!senha || salvando"
          data-testid="revisao-confirmar"
          @acionar="confirmar"
        />
      </template>
    </SanteDialogo>
  </section>
</template>

<style scoped>
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
  vertical-align: top;
}
.acoes-linha {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
}
</style>
