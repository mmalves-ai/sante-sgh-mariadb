<script setup lang="ts">
// "Perfis e permissões" (ADR 0022; acesso.perfil.gerir). Quatro partes: (1) o usuário do SPDATA, com as
// permissões efetivas e a origem de cada uma (grupo, papel, flag, perfil do Sante SGH) e o que a segregação
// retirou; perfis do Sante SGH (conceder com início, fim e motivo; revogar), papéis SBIS e grupo; (2) grupos do
// legado (criar, desativar, reativar, conceder e retirar opções); (3) papéis SBIS (opções); (4) o mapa grupo →
// perfil e perfil → permissão (propostas aprovadas ou recusadas). As permissões do legado mudam pelas receitas
// do executor (gravadas como o SPDATA grava); receita desligada aparece com o motivo (POL-3). Toda gravação pede
// a senha (reautenticação) e invalida o cache das permissões: vale na hora.
import type {
  ChaveMapa,
  EfetivasTela,
  GrupoGestaoTela,
  LinhaMapaTela,
  MapaGestaoTela,
  OperacaoGestaoLegado,
  OperacaoGestaoTela,
  OrigemPermissaoTela,
  PapelGestaoTela,
  PerfilConcedidoTela,
  SituacaoMapa,
  UsuarioGestaoTela,
} from '@sgh/contratos';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import MapaDecisaoDialogo from '../componentes/MapaDecisaoDialogo.vue';
import PerfilAlteracaoDialogo from '../componentes/PerfilAlteracaoDialogo.vue';
import PerfilRevogacaoDialogo from '../componentes/PerfilRevogacaoDialogo.vue';
import {
  buscarEfetivas,
  buscarGruposGestao,
  buscarMapaGestao,
  buscarOperacoesGestao,
  buscarPapeisGestao,
  buscarUsuariosGestao,
  concederPerfil,
  executarLegado,
  invalidarCache,
  lerOpcoes,
} from '../api-gestao.js';

const { t, te } = useI18n();
type Aba = 'usuario' | 'grupos' | 'papeis' | 'mapa';
const aba = ref<Aba>('usuario');
const senha = ref('');
const aviso = ref('');
const erro = ref('');
const ocupado = ref(false);

const operacoes = ref<OperacaoGestaoTela[]>([]);
const desligadas = computed(() => operacoes.value.filter((o) => !o.ligada));
const ligada = (op: OperacaoGestaoLegado) => operacoes.value.find((o) => o.operacao === op)?.ligada ?? false;

function mensagem(e: unknown): string {
  if (e instanceof ErroApi) {
    const codigo = (e.problema as { codigo?: string } | null)?.codigo;
    if (codigo && te(`acesso.perfis.recusas.${codigo}`)) return t(`acesso.perfis.recusas.${codigo}`);
    if (e.status === 401) return t('acesso.perfis.recusas.senha');
    if (e.status === 403) return t('acesso.perfis.recusas.semPermissao');
  }
  return t('acesso.perfis.erroGenerico');
}

/** Toda gravação: exige a senha, mostra o resultado e recarrega o que a tela mostra. */
async function gravar(fn: () => Promise<unknown>, depois: () => Promise<void>): Promise<void> {
  aviso.value = '';
  erro.value = '';
  if (!senha.value) {
    erro.value = t('acesso.perfis.senhaObrigatoria');
    return;
  }
  ocupado.value = true;
  try {
    await fn();
    aviso.value = t('acesso.perfis.gravado');
    await depois();
  } catch (e) {
    erro.value = mensagem(e);
  } finally {
    ocupado.value = false;
  }
}

// ── Usuário ──────────────────────────────────────────────────────────────────────────────────
const busca = ref('');
const encontrados = ref<UsuarioGestaoTela[]>([]);
const efetivas = ref<EfetivasTela | null>(null);
const novoPerfil = ref({ perfil: '', inicio: '', fim: '', motivo: '' });
const novoGrupoDoUsuario = ref('');
const papelEscolhido = ref<number>(3);

async function procurar(): Promise<void> {
  erro.value = '';
  try {
    encontrados.value = await buscarUsuariosGestao(busca.value);
  } catch (e) {
    erro.value = mensagem(e);
  }
}

async function abrirUsuario(login: string): Promise<void> {
  erro.value = '';
  try {
    efetivas.value = await buscarEfetivas(login);
  } catch (e) {
    erro.value = mensagem(e);
  }
}

const recarregarUsuario = async () => {
  if (efetivas.value) await abrirUsuario(efetivas.value.usuario.login);
};

function origemTexto(o: OrigemPermissaoTela): string {
  switch (o.tipo) {
    case 'grupo':
      return t('acesso.perfis.origens.grupo', { grupo: o.grupo, opcao: o.opcao });
    case 'papel':
      return t('acesso.perfis.origens.papel', { opcao: o.opcao });
    case 'flag':
      return t('acesso.perfis.origens.flag', { flag: o.flag });
    case 'perfil':
      return t('acesso.perfis.origens.perfil', { perfil: o.perfil, via: t(`acesso.perfis.vias.${o.via}`) });
    case 'acesso-total':
      return t('acesso.perfis.origens.acessoTotal');
    default:
      return t('acesso.perfis.origens.todos');
  }
}

/** As listas do formulário são obrigatórias: sem escolha, nada é gravado. */
function exigirEscolha(...valores: string[]): boolean {
  if (valores.every((v) => v !== '')) return true;
  aviso.value = '';
  erro.value = t('acesso.perfis.escolhaObrigatoria');
  return false;
}

const conceder = () => {
  if (!exigirEscolha(novoPerfil.value.perfil)) return Promise.resolve();
  return gravar(async () => {
    const u = efetivas.value;
    if (!u) return;
    const p = novoPerfil.value;
    await concederPerfil({
      login: u.usuario.login,
      perfil: p.perfil,
      motivo: p.motivo,
      senha: senha.value,
      ...(p.inicio ? { inicio: new Date(p.inicio).toISOString() } : {}),
      ...(p.fim ? { fim: new Date(p.fim).toISOString() } : {}),
    });
    novoPerfil.value = { perfil: '', inicio: '', fim: '', motivo: '' };
  }, recarregarUsuario);
};

// W0-09: revogar pede o motivo e a senha num diálogo próprio (não usa a senha do topo).
const revogando = ref<PerfilConcedidoTela | null>(null);
const dialogoRevogar = ref(false);
function abrirRevogar(c: PerfilConcedidoTela): void {
  revogando.value = c;
  dialogoRevogar.value = true;
}
async function revogado(): Promise<void> {
  erro.value = '';
  aviso.value = t('acesso.perfis.revogacao.revogada');
  await recarregarUsuario();
}

// W0-09: Alterar a vigência e o motivo, em diálogo com justificativa e senha; o histórico fica no diálogo.
const alterando = ref<PerfilConcedidoTela | null>(null);
const dialogoAlterar = ref(false);
function abrirAlterar(c: PerfilConcedidoTela): void {
  alterando.value = c;
  dialogoAlterar.value = true;
}
async function alterado(): Promise<void> {
  erro.value = '';
  aviso.value = t('acesso.perfis.alteracao.alterada');
  await recarregarUsuario();
}

const legadoDoUsuario = (op: OperacaoGestaoLegado, entrada: Record<string, unknown>) =>
  gravar(() => executarLegado(op, entrada, senha.value), recarregarUsuario);

const invalidar = async (login: string | null) => {
  aviso.value = '';
  erro.value = '';
  try {
    await invalidarCache(login);
    aviso.value = t('acesso.perfis.cacheInvalidado');
  } catch (e) {
    erro.value = mensagem(e);
  }
};

// ── Grupos e papéis ───────────────────────────────────────────────────────────────────────────
const grupos = ref<GrupoGestaoTela[]>([]);
const papeis = ref<PapelGestaoTela[]>([]);
const novoGrupo = ref('');
const grupoAberto = ref('');
const opcoesAConceder = ref('');
const opcoesARetirar = ref<number[]>([]);
const papelAberto = ref<number | null>(null);
const opcoesPapelAConceder = ref('');
const opcoesPapelARetirar = ref<number[]>([]);

async function carregarGruposEPapeis(): Promise<void> {
  try {
    [grupos.value, papeis.value] = await Promise.all([buscarGruposGestao(), buscarPapeisGestao()]);
  } catch (e) {
    erro.value = mensagem(e);
  }
}

const grupoSelecionado = computed(() => grupos.value.find((g) => g.grupo === grupoAberto.value) ?? null);
const papelSelecionado = computed(() => papeis.value.find((p) => p.papel === papelAberto.value) ?? null);

const legadoDeGrupo = (op: OperacaoGestaoLegado, entrada: Record<string, unknown>) =>
  gravar(
    () => executarLegado(op, entrada, senha.value),
    async () => {
      opcoesAConceder.value = '';
      opcoesARetirar.value = [];
      opcoesPapelAConceder.value = '';
      opcoesPapelARetirar.value = [];
      await carregarGruposEPapeis();
    },
  );

// ── Mapa ─────────────────────────────────────────────────────────────────────────────────────
const mapa = ref<MapaGestaoTela | null>(null);
const propostaGrupo = ref({ grupo: '', perfil: '' });
const propostaPermissao = ref({ perfil: '', permissao: '' });

async function carregarMapa(): Promise<void> {
  try {
    mapa.value = await buscarMapaGestao();
  } catch (e) {
    erro.value = mensagem(e);
  }
}

function chaveDe(l: LinhaMapaTela) {
  return l.tipo === 'grupo-perfil'
    ? { tipo: 'grupo-perfil' as const, grupo: l.grupo ?? '', perfil: l.perfil }
    : { tipo: 'perfil-permissao' as const, perfil: l.perfil, permissao: l.permissao ?? '' };
}

// W0-09: toda decisão (aprovar, recusar, propor, voltar a 'proposta') abre o diálogo com a prévia de quem perde o
// acesso, o motivo e a senha; confirmada, o servidor invalida o cache e a permissão efetiva muda na hora.
const decisao = ref<{ chave: ChaveMapa; situacao: SituacaoMapa; linhaId: string | null } | null>(null);
const dialogoDecisao = ref(false);
function abrirDecisao(chave: ChaveMapa, situacao: SituacaoMapa, linhaId: string | null): void {
  aviso.value = '';
  erro.value = '';
  decisao.value = { chave, situacao, linhaId };
  dialogoDecisao.value = true;
}
async function decidido(): Promise<void> {
  aviso.value = t('acesso.perfis.decisaoMapa.feita');
  await carregarMapa();
}
const decidir = (l: LinhaMapaTela, situacao: SituacaoMapa) => abrirDecisao(chaveDe(l), situacao, l.id);

const proporGrupo = () => {
  if (!exigirEscolha(propostaGrupo.value.grupo, propostaGrupo.value.perfil)) return;
  abrirDecisao({ tipo: 'grupo-perfil', ...propostaGrupo.value }, 'proposta', null);
};
const proporPermissao = () => {
  if (!exigirEscolha(propostaPermissao.value.perfil)) return;
  abrirDecisao({ tipo: 'perfil-permissao', ...propostaPermissao.value }, 'proposta', null);
};

// Opções das listas (mesma ordem de antes).
const opcoesGruposAtivos = computed(() =>
  grupos.value.filter((x) => x.ativo).map((g) => ({ valor: g.grupo, rotulo: g.grupo })),
);
const opcoesGrupos = computed(() => grupos.value.map((g) => ({ valor: g.grupo, rotulo: g.grupo })));
const opcoesPapeis = computed(() => papeis.value.map((p) => ({ valor: p.papel, rotulo: p.nome })));
const opcoesPerfis = computed(() => (mapa.value?.perfis ?? []).map((p) => ({ valor: p, rotulo: p })));

onMounted(async () => {
  try {
    operacoes.value = await buscarOperacoesGestao();
  } catch (e) {
    erro.value = mensagem(e);
  }
  await Promise.all([carregarGruposEPapeis(), carregarMapa()]);
});
</script>

<template>
  <section class="tela" aria-labelledby="perfis-titulo">
    <h1 id="perfis-titulo">{{ t('acesso.perfis.titulo') }}</h1>
    <p>{{ t('acesso.perfis.texto') }}</p>

    <div class="perfis__senha">
      <label>
        <span>{{ t('acesso.perfis.senha') }}</span>
        <input v-model="senha" type="password" autocomplete="current-password" data-testid="perfis-senha" />
      </label>
      <small>{{ t('acesso.perfis.senhaAjuda') }}</small>
    </div>

    <div v-if="desligadas.length > 0" class="perfis__desligadas" role="note" data-testid="perfis-desligadas">
      <strong>{{ t('acesso.perfis.desligadas') }}</strong>
      <ul>
        <li v-for="o in desligadas" :key="o.operacao">{{ o.rotulo }}: {{ o.motivo }}</li>
      </ul>
    </div>

    <p v-if="aviso" role="status" class="perfis__aviso" data-testid="perfis-aviso">{{ aviso }}</p>
    <p v-if="erro" role="alert" class="perfis__erro" data-testid="perfis-erro">{{ erro }}</p>

    <div role="tablist" class="perfis__abas">
      <button
        v-for="a in ['usuario', 'grupos', 'papeis', 'mapa'] as const"
        :key="a"
        type="button"
        role="tab"
        :aria-selected="aba === a"
        :data-testid="`aba-${a}`"
        @click="aba = a"
      >
        {{ t(`acesso.perfis.abas.${a}`) }}
      </button>
    </div>

    <!-- ── Usuário ── -->
    <div v-if="aba === 'usuario'" role="tabpanel">
      <form class="perfis__linha" @submit.prevent="procurar">
        <label>
          <span>{{ t('acesso.perfis.buscar') }}</span>
          <input v-model="busca" minlength="2" maxlength="40" data-testid="perfis-busca" />
        </label>
        <SanteBotao :rotulo="t('acesso.perfis.procurar')" tipo="submit" data-testid="perfis-procurar" />
      </form>
      <ul v-if="encontrados.length > 0" class="perfis__lista">
        <li v-for="u in encontrados" :key="u.login">
          <button type="button" :data-testid="`perfis-usuario-${u.login}`" @click="abrirUsuario(u.login)">
            {{ u.login }} · {{ u.nome }} · {{ u.grupo ?? t('acesso.perfis.semGrupo') }}
          </button>
        </li>
      </ul>

      <article v-if="efetivas" class="perfis__usuario" data-testid="perfis-efetivas">
        <h2>{{ efetivas.usuario.login }} · {{ efetivas.usuario.nome }}</h2>
        <p>
          {{
            t('acesso.perfis.grupoAtual', { grupo: efetivas.usuario.grupo ?? t('acesso.perfis.semGrupo') })
          }}
          <button type="button" data-testid="perfis-invalidar" @click="invalidar(efetivas.usuario.login)">
            {{ t('acesso.perfis.invalidar') }}
          </button>
        </p>

        <h3>{{ t('acesso.perfis.legadoTitulo') }}</h3>
        <div class="perfis__linha">
          <SanteSelecao
            v-model="novoGrupoDoUsuario"
            :rotulo="t('acesso.perfis.trocarGrupo')"
            :opcoes="opcoesGruposAtivos"
            data-testid="perfis-novo-grupo"
          />
          <button
            type="button"
            :disabled="ocupado || !novoGrupoDoUsuario || !ligada('acesso.trocarGrupoUsuario')"
            data-testid="perfis-trocar-grupo"
            @click="
              legadoDoUsuario('acesso.trocarGrupoUsuario', {
                login: efetivas.usuario.login,
                grupo: novoGrupoDoUsuario,
              })
            "
          >
            {{ t('acesso.perfis.trocar') }}
          </button>
        </div>
        <table>
          <caption>
            {{
              t('acesso.perfis.papeis')
            }}
          </caption>
          <tbody>
            <tr v-for="p in efetivas.papeis" :key="p.papel">
              <th scope="row">{{ p.nome }}</th>
              <td>{{ p.ativo ? t('acesso.perfis.ativo') : t('acesso.perfis.inativo') }}</td>
              <td>
                <button
                  v-if="p.ativo"
                  type="button"
                  :disabled="ocupado || !ligada('acesso.revogarPapelUsuario')"
                  @click="
                    legadoDoUsuario('acesso.revogarPapelUsuario', {
                      login: efetivas.usuario.login,
                      papel: p.papel,
                    })
                  "
                >
                  {{ t('acesso.perfis.retirar') }}
                </button>
                <button
                  v-else
                  type="button"
                  :disabled="ocupado || !ligada('acesso.reativarPapelUsuario')"
                  @click="
                    legadoDoUsuario('acesso.reativarPapelUsuario', {
                      login: efetivas.usuario.login,
                      papel: p.papel,
                    })
                  "
                >
                  {{ t('acesso.perfis.reativar') }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <div class="perfis__linha">
          <SanteSelecao
            v-model="papelEscolhido"
            :rotulo="t('acesso.perfis.concederPapel')"
            :opcoes="opcoesPapeis"
            data-testid="perfis-papel"
          />
          <button
            type="button"
            :disabled="ocupado || !ligada('acesso.concederPapelUsuario')"
            data-testid="perfis-conceder-papel"
            @click="
              legadoDoUsuario('acesso.concederPapelUsuario', {
                login: efetivas.usuario.login,
                papel: papelEscolhido,
              })
            "
          >
            {{ t('acesso.perfis.conceder') }}
          </button>
        </div>

        <h3>{{ t('acesso.perfis.perfisTitulo') }}</h3>
        <ul>
          <li v-for="p in efetivas.perfis" :key="p.perfil">
            {{ p.perfil }} ({{ p.origens.map((o) => t(`acesso.perfis.vias.${o}`)).join(', ') }})
          </li>
          <li v-if="efetivas.perfis.length === 0">{{ t('acesso.perfis.nenhumPerfil') }}</li>
        </ul>
        <form class="perfis__form" data-testid="perfis-conceder" @submit.prevent="conceder">
          <SanteSelecao
            v-model="novoPerfil.perfil"
            obrigatorio
            :rotulo="t('acesso.perfis.perfil')"
            :opcoes="opcoesPerfis"
            data-testid="perfis-perfil"
          />
          <label>
            <span>{{ t('acesso.perfis.inicio') }}</span>
            <input v-model="novoPerfil.inicio" type="datetime-local" />
          </label>
          <label>
            <span>{{ t('acesso.perfis.fim') }}</span>
            <input v-model="novoPerfil.fim" type="datetime-local" />
          </label>
          <label>
            <span>{{ t('acesso.perfis.motivo') }}</span>
            <input
              v-model="novoPerfil.motivo"
              required
              minlength="3"
              maxlength="200"
              data-testid="perfis-motivo"
            />
          </label>
          <SanteBotao
            :rotulo="t('acesso.perfis.concederPerfil')"
            tipo="submit"
            :desabilitado="ocupado"
            data-testid="perfis-conceder-perfil"
          />
        </form>
        <table v-if="efetivas.concessoes.length > 0" data-testid="perfis-concessoes">
          <caption>
            {{
              t('acesso.perfis.historico')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('acesso.perfis.perfil') }}</th>
              <th scope="col">{{ t('acesso.perfis.inicio') }}</th>
              <th scope="col">{{ t('acesso.perfis.fim') }}</th>
              <th scope="col">{{ t('acesso.perfis.motivo') }}</th>
              <th scope="col">{{ t('acesso.perfis.situacao') }}</th>
              <th scope="col">
                <span class="sr-only">{{ t('acesso.perfis.acoes') }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in efetivas.concessoes" :key="c.id">
              <td>{{ c.perfil }}</td>
              <td>{{ new Date(c.inicio).toLocaleString('pt-BR') }}</td>
              <td>{{ c.fim ? new Date(c.fim).toLocaleString('pt-BR') : '—' }}</td>
              <td>{{ c.motivo ?? '—' }}</td>
              <td>
                {{
                  c.revogadoEm
                    ? c.revogadoMotivo
                      ? t('acesso.perfis.revogacao.revogadaPor', {
                          quem: c.revogadoPor ?? '—',
                          motivo: c.revogadoMotivo,
                        })
                      : t('acesso.perfis.revogada')
                    : c.vigente
                      ? t('acesso.perfis.vigente')
                      : t('acesso.perfis.foraDoPrazo')
                }}
              </td>
              <td>
                <template v-if="!c.revogadoEm">
                  <button
                    type="button"
                    :disabled="ocupado"
                    :data-testid="`perfis-alterar-${c.id}`"
                    @click="abrirAlterar(c)"
                  >
                    {{ t('acesso.perfis.alterar') }}
                  </button>
                  <button
                    type="button"
                    :disabled="ocupado"
                    :data-testid="`perfis-revogar-${c.id}`"
                    @click="abrirRevogar(c)"
                  >
                    {{ t('acesso.perfis.revogar') }}
                  </button>
                </template>
                <small v-if="c.alteracoes">{{ t('acesso.perfis.alteracoesN', { n: c.alteracoes }) }}</small>
              </td>
            </tr>
          </tbody>
        </table>

        <h3>{{ t('acesso.perfis.efetivas', { n: efetivas.permissoes.length }) }}</h3>
        <table data-testid="perfis-permissoes">
          <thead>
            <tr>
              <th scope="col">{{ t('acesso.perfis.permissao') }}</th>
              <th scope="col">{{ t('acesso.perfis.descricao') }}</th>
              <th scope="col">{{ t('acesso.perfis.origem') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in efetivas.permissoes" :key="p.codigo">
              <td>
                <code>{{ p.codigo }}</code>
              </td>
              <td>{{ p.descricao }}</td>
              <td>{{ p.origens.map(origemTexto).join('; ') }}</td>
            </tr>
          </tbody>
        </table>
        <template v-if="efetivas.retiradas.length > 0">
          <h3>{{ t('acesso.perfis.retiradas') }}</h3>
          <ul data-testid="perfis-retiradas">
            <li v-for="r in efetivas.retiradas" :key="r.permissao">
              <code>{{ r.permissao }}</code
              >: {{ t(`acesso.perfis.motivos.${r.motivo}`) }}
            </li>
          </ul>
        </template>
      </article>
    </div>

    <!-- ── Grupos ── -->
    <div v-if="aba === 'grupos'" role="tabpanel">
      <form class="perfis__linha" @submit.prevent="legadoDeGrupo('acesso.criarGrupo', { nome: novoGrupo })">
        <label>
          <span>{{ t('acesso.perfis.novoGrupo') }}</span>
          <input v-model="novoGrupo" maxlength="50" data-testid="perfis-novo-grupo-nome" />
        </label>
        <SanteBotao
          :rotulo="t('acesso.perfis.criarGrupo')"
          tipo="submit"
          :desabilitado="ocupado || !novoGrupo || !ligada('acesso.criarGrupo')"
          data-testid="perfis-criar-grupo"
        />
      </form>
      <table data-testid="perfis-grupos">
        <tbody>
          <tr v-for="g in grupos" :key="g.grupo">
            <th scope="row">
              <button type="button" @click="grupoAberto = g.grupo">{{ g.grupo }}</button>
            </th>
            <td>{{ g.ativo ? t('acesso.perfis.ativo') : t('acesso.perfis.inativo') }}</td>
            <td>{{ t('acesso.perfis.nOpcoes', { n: g.opcoes.length }) }}</td>
            <td>
              <button
                v-if="g.ativo"
                type="button"
                :disabled="ocupado || !ligada('acesso.desativarGrupo')"
                @click="legadoDeGrupo('acesso.desativarGrupo', { nome: g.grupo })"
              >
                {{ t('acesso.perfis.desativar') }}
              </button>
              <button
                v-else
                type="button"
                :disabled="ocupado || !ligada('acesso.reativarGrupo')"
                @click="legadoDeGrupo('acesso.reativarGrupo', { nome: g.grupo })"
              >
                {{ t('acesso.perfis.reativar') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <article v-if="grupoSelecionado" class="perfis__opcoes" data-testid="perfis-opcoes-grupo">
        <h2>{{ t('acesso.perfis.opcoesDe', { nome: grupoSelecionado.grupo }) }}</h2>
        <label>
          <span>{{ t('acesso.perfis.concederOpcoes') }}</span>
          <input v-model="opcoesAConceder" data-testid="perfis-opcoes-conceder" />
        </label>
        <button
          type="button"
          :disabled="
            ocupado || lerOpcoes(opcoesAConceder).length === 0 || !ligada('acesso.concederOpcoesGrupo')
          "
          data-testid="perfis-conceder-opcoes"
          @click="
            legadoDeGrupo('acesso.concederOpcoesGrupo', {
              grupo: grupoSelecionado.grupo,
              opcoes: lerOpcoes(opcoesAConceder),
            })
          "
        >
          {{ t('acesso.perfis.conceder') }}
        </button>
        <fieldset>
          <legend>{{ t('acesso.perfis.retirarOpcoes') }}</legend>
          <label v-for="o in grupoSelecionado.opcoes" :key="o" class="perfis__opcao">
            <input v-model="opcoesARetirar" type="checkbox" :value="o" />{{ o }}
          </label>
        </fieldset>
        <button
          type="button"
          :disabled="ocupado || opcoesARetirar.length === 0 || !ligada('acesso.revogarOpcoesGrupo')"
          @click="
            legadoDeGrupo('acesso.revogarOpcoesGrupo', {
              grupo: grupoSelecionado.grupo,
              opcoes: opcoesARetirar,
            })
          "
        >
          {{ t('acesso.perfis.retirar') }}
        </button>
      </article>
    </div>

    <!-- ── Papéis SBIS ── -->
    <div v-if="aba === 'papeis'" role="tabpanel">
      <table>
        <tbody>
          <tr v-for="p in papeis" :key="p.papel">
            <th scope="row">
              <button type="button" @click="papelAberto = p.papel">{{ p.nome }}</button>
            </th>
            <td>{{ t('acesso.perfis.nOpcoes', { n: p.opcoes.length }) }}</td>
          </tr>
        </tbody>
      </table>
      <article v-if="papelSelecionado" class="perfis__opcoes">
        <h2>{{ t('acesso.perfis.opcoesDe', { nome: papelSelecionado.nome }) }}</h2>
        <label>
          <span>{{ t('acesso.perfis.concederOpcoes') }}</span>
          <input v-model="opcoesPapelAConceder" />
        </label>
        <button
          type="button"
          :disabled="
            ocupado || lerOpcoes(opcoesPapelAConceder).length === 0 || !ligada('acesso.concederOpcoesPapel')
          "
          @click="
            legadoDeGrupo('acesso.concederOpcoesPapel', {
              papel: papelSelecionado.papel,
              opcoes: lerOpcoes(opcoesPapelAConceder),
            })
          "
        >
          {{ t('acesso.perfis.conceder') }}
        </button>
        <fieldset>
          <legend>{{ t('acesso.perfis.retirarOpcoes') }}</legend>
          <label v-for="o in papelSelecionado.opcoes" :key="o" class="perfis__opcao">
            <input v-model="opcoesPapelARetirar" type="checkbox" :value="o" />{{ o }}
          </label>
        </fieldset>
        <button
          type="button"
          :disabled="ocupado || opcoesPapelARetirar.length === 0 || !ligada('acesso.revogarOpcoesPapel')"
          @click="
            legadoDeGrupo('acesso.revogarOpcoesPapel', {
              papel: papelSelecionado.papel,
              opcoes: opcoesPapelARetirar,
            })
          "
        >
          {{ t('acesso.perfis.retirar') }}
        </button>
      </article>
    </div>

    <!-- ── Mapa ── -->
    <div v-if="aba === 'mapa' && mapa" role="tabpanel">
      <h2>{{ t('acesso.perfis.mapaGrupo') }}</h2>
      <table data-testid="perfis-mapa-grupo">
        <thead>
          <tr>
            <th scope="col">{{ t('acesso.perfis.grupo') }}</th>
            <th scope="col">{{ t('acesso.perfis.perfil') }}</th>
            <th scope="col">{{ t('acesso.perfis.situacao') }}</th>
            <th scope="col">{{ t('acesso.perfis.decisao') }}</th>
            <th scope="col">
              <span class="sr-only">{{ t('acesso.perfis.acoes') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in mapa.grupoPerfil" :key="`${l.grupo}|${l.perfil}`">
            <td>{{ l.grupo }}</td>
            <td>{{ l.perfil }}</td>
            <td>{{ t(`acesso.perfis.situacoes.${l.situacao}`) }}</td>
            <td>
              {{
                l.aprovadoPor
                  ? `${l.aprovadoPor} · ${new Date(l.aprovadoEm ?? '').toLocaleString('pt-BR')}`
                  : '—'
              }}
            </td>
            <td>
              <button
                v-if="l.situacao !== 'aprovada'"
                type="button"
                :disabled="ocupado"
                :data-testid="`aprovar-${l.grupo}-${l.perfil}`"
                @click="decidir(l, 'aprovada')"
              >
                {{ t('acesso.perfis.aprovar') }}
              </button>
              <button
                v-if="l.situacao !== 'recusada'"
                type="button"
                :disabled="ocupado"
                :data-testid="`recusar-${l.grupo}-${l.perfil}`"
                @click="decidir(l, 'recusada')"
              >
                {{ t('acesso.perfis.recusar') }}
              </button>
              <button
                v-if="l.situacao !== 'proposta' && l.id"
                type="button"
                :disabled="ocupado"
                :data-testid="`voltar-${l.grupo}-${l.perfil}`"
                @click="decidir(l, 'proposta')"
              >
                {{ t('acesso.perfis.voltarProposta') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <form class="perfis__linha" data-testid="perfis-propor-grupo" @submit.prevent="proporGrupo">
        <SanteSelecao
          v-model="propostaGrupo.grupo"
          obrigatorio
          :rotulo="t('acesso.perfis.grupo')"
          :opcoes="opcoesGrupos"
          data-testid="propor-grupo"
        />
        <SanteSelecao
          v-model="propostaGrupo.perfil"
          obrigatorio
          :rotulo="t('acesso.perfis.perfil')"
          :opcoes="opcoesPerfis"
          data-testid="propor-perfil"
        />
        <SanteBotao
          :rotulo="t('acesso.perfis.propor')"
          tipo="submit"
          :desabilitado="ocupado"
          data-testid="propor"
        />
      </form>

      <h2>{{ t('acesso.perfis.mapaPermissao') }}</h2>
      <table>
        <tbody>
          <tr v-for="l in mapa.perfilPermissao" :key="`${l.perfil}|${l.permissao}|${l.origem}`">
            <td>{{ l.perfil }}</td>
            <td>
              <code>{{ l.permissao }}</code>
            </td>
            <td>
              {{
                l.origem === 'catalogo'
                  ? t('acesso.perfis.doCatalogo')
                  : t(`acesso.perfis.situacoes.${l.situacao}`)
              }}
            </td>
            <td>
              <template v-if="l.origem !== 'catalogo'">
                <button
                  v-if="l.situacao !== 'aprovada'"
                  type="button"
                  :disabled="ocupado"
                  @click="decidir(l, 'aprovada')"
                >
                  {{ t('acesso.perfis.aprovar') }}
                </button>
                <button
                  v-if="l.situacao !== 'recusada'"
                  type="button"
                  :disabled="ocupado"
                  @click="decidir(l, 'recusada')"
                >
                  {{ t('acesso.perfis.recusar') }}
                </button>
                <button
                  v-if="l.situacao !== 'proposta' && l.id"
                  type="button"
                  :disabled="ocupado"
                  :data-testid="`voltar-${l.perfil}-${l.permissao}`"
                  @click="decidir(l, 'proposta')"
                >
                  {{ t('acesso.perfis.voltarProposta') }}
                </button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
      <form class="perfis__linha" @submit.prevent="proporPermissao">
        <SanteSelecao
          v-model="propostaPermissao.perfil"
          obrigatorio
          :rotulo="t('acesso.perfis.perfil')"
          :opcoes="opcoesPerfis"
        />
        <label>
          <span>{{ t('acesso.perfis.permissao') }}</span>
          <input v-model="propostaPermissao.permissao" required maxlength="120" />
        </label>
        <SanteBotao :rotulo="t('acesso.perfis.propor')" tipo="submit" :desabilitado="ocupado" />
      </form>
      <p>
        <button type="button" @click="invalidar(null)">{{ t('acesso.perfis.invalidarTodos') }}</button>
      </p>
    </div>

    <PerfilAlteracaoDialogo v-model:visivel="dialogoAlterar" :concessao="alterando" @alterado="alterado" />
    <PerfilRevogacaoDialogo v-model:visivel="dialogoRevogar" :concessao="revogando" @revogado="revogado" />
    <MapaDecisaoDialogo
      v-model:visivel="dialogoDecisao"
      :chave="decisao?.chave ?? null"
      :situacao="decisao?.situacao ?? 'proposta'"
      :linha-id="decisao?.linhaId ?? null"
      @decidido="decidido"
    />
  </section>
</template>

<style scoped>
table {
  border-collapse: collapse;
  width: 100%;
  margin-block: var(--sgh-espaco-2);
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
label {
  display: inline-flex;
  flex-direction: column;
  gap: var(--sgh-espaco-1);
}
input,
select,
button {
  min-height: var(--sgh-alvo-minimo);
  font: inherit;
}
.perfis__linha,
.perfis__form {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--sgh-espaco-2);
  margin-block: var(--sgh-espaco-2);
}
.perfis__abas {
  display: flex;
  gap: var(--sgh-espaco-1);
  margin-block: var(--sgh-espaco-3);
}
.perfis__abas [aria-selected='true'] {
  font-weight: 700;
  border-bottom: 3px solid var(--sgh-foco);
}
.perfis__senha,
.perfis__desligadas {
  padding: var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda-forte);
  border-radius: 4px;
  margin-block: var(--sgh-espaco-2);
}
.perfis__erro {
  color: var(--sgh-alerta);
}
.perfis__opcao {
  flex-direction: row;
  margin-inline-end: var(--sgh-espaco-2);
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
</style>
