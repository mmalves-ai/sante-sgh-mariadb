<script setup lang="ts">
// "Usuários" (M10, ficha seção 7): lista paginada no servidor com busca por login ou nome, grupo e situação; a
// criação pede o login exato, o nome completo, o grupo e, opcionalmente, o CPF, com a senha de novo. M59-F2: a vista
// "Senhas e segundo fator" mostra a situação da senha e do segundo fator, com a retirada e a revogação.
// M59-F3: a vista "Senhas secundárias" mostra quem ainda as tem guardadas, com a retirada.
// Redesenho (17/11/2026): cabeçalho com contador e ação principal, vistas em abas, filtros compactos (situação em
// segmentos), tabela com avatar, nome e login em duas linhas, grupo em etiqueta e situação em pílulas (texto +
// cor, nunca só cor); a linha inteira abre a ficha e o login continua sendo o link acessível (Ctrl/meio-clique abrem
// em outra aba). Busca, grupo, situação e página ficam na query da rota: ao voltar da ficha, a lista está como era.
import { PERMISSOES_M59_CODIGOS, cpfValido } from '@sgh/contratos';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/vue-query';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteDialogo, SanteIcone, SanteSelecao } from '@sgh/ui';
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { buscarOpcoesUsuarios, criarUsuario, listarUsuarios } from '../api.js';
import AtalhoAlcadas from '../componentes/AtalhoAlcadas.vue';
import AtalhoVinculoConta from '../componentes/AtalhoVinculoConta.vue';
import CpfUsuarios from '../componentes/CpfUsuarios.vue';
import IdentidadeUsuarios from '../componentes/IdentidadeUsuarios.vue';
import SenhasSecundariasUsuarios from '../componentes/SenhasSecundariasUsuarios.vue';
import SenhaConfirmacao from '../componentes/SenhaConfirmacao.vue';
import {
  CAMINHO_LISTA_USUARIOS,
  SITUACOES_USUARIOS as SITUACOES,
  type SituacaoUsuarios,
  dataHora,
  filtrosDaQuery,
  iniciais,
  mostrarAbaAtiva,
  queryDosFiltros,
  usarAbasRolaveis,
} from '../usuarios-tela.js';

const { t, n: numero } = useI18n();
const roteador = useRouter();
const rota = useRoute();
// M59-F2: a mesma tela mostra o cadastro (M10) ou a situação das senhas e do segundo fator (?vista=identidade).
// M59-F3: e as senhas secundárias (?vista=senhas-secundarias), para quem tem acesso.senhaSecundaria.ler.
// W1-01 (parte 3c): e a identidade única (?vista=cpf): contas sem CPF e CPF repetido entre logins.
type Vista = 'cadastro' | 'identidade' | 'senhas-secundarias' | 'cpf';
const podeSenhasSecundarias = computed(() => pode(PERMISSOES_M59_CODIGOS.senhaSecundariaLer));
const vista = computed<Vista>({
  get: () => {
    const v = rota.query['vista'];
    if (v === 'identidade') return 'identidade';
    if (v === 'cpf') return 'cpf';
    if (v === 'senhas-secundarias' && podeSenhasSecundarias.value) return 'senhas-secundarias';
    return 'cadastro';
  },
  set: (v) => void roteador.replace({ query: { ...rota.query, vista: v === 'cadastro' ? undefined : v } }),
});
const opcoesVista = computed(() => [
  { valor: 'cadastro' as const, rotulo: t('identidade.usuarios.abaCadastro') },
  { valor: 'identidade' as const, rotulo: t('identidade.usuarios.aba') },
  { valor: 'cpf' as const, rotulo: t('adm.usuarios.abaCpf') },
  ...(podeSenhasSecundarias.value
    ? [{ valor: 'senhas-secundarias' as const, rotulo: t('segredos.senhasSecundarias.aba') }]
    : []),
]);
/** Abas com setas (padrão WAI-ARIA): a seta move o foco e escolhe; Home e End vão às pontas. */
const abas = ref<HTMLButtonElement[]>([]);
const listaAbas = ref<HTMLElement | null>(null);
const rolagemAbas = usarAbasRolaveis(listaAbas);
watch(vista, () => void nextTick(() => mostrarAbaAtiva(listaAbas.value)));
function teclaAba(e: KeyboardEvent, i: number): void {
  const total = opcoesVista.value.length;
  const destino =
    e.key === 'ArrowRight'
      ? (i + 1) % total
      : e.key === 'ArrowLeft'
        ? (i - 1 + total) % total
        : e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? total - 1
            : -1;
  if (destino < 0) return;
  e.preventDefault();
  vista.value = opcoesVista.value[destino]!.valor;
  void nextTick(() => abas.value[destino]?.focus());
}

const cliente = useQueryClient();
const inicial = filtrosDaQuery(rota.query);
const busca = ref(inicial.busca);
const termo = ref(inicial.busca);
const grupo = ref(inicial.grupo);
const situacao = ref<SituacaoUsuarios>(inicial.situacao);
const pagina = ref(inicial.pagina);
const POR_PAGINA = 50;
let espera: ReturnType<typeof setTimeout> | undefined;
watch(busca, (b) => {
  clearTimeout(espera);
  espera = setTimeout(() => {
    termo.value = b;
    pagina.value = 1;
  }, 300);
});
watch([grupo, situacao], () => (pagina.value = 1));
// A query da rota acompanha os filtros (replace: o Voltar do navegador não passa por cada tecla).
watch([termo, grupo, situacao, pagina], () => {
  void roteador.replace({
    query: {
      ...rota.query,
      ...queryDosFiltros({
        busca: termo.value,
        grupo: grupo.value,
        situacao: situacao.value,
        pagina: pagina.value,
      }),
    },
  });
});
const consulta = useQuery({
  placeholderData: keepPreviousData,
  queryKey: computed(() => ['adm', 'usuarios', termo.value, grupo.value, situacao.value, pagina.value]),
  queryFn: () =>
    listarUsuarios({
      busca: termo.value,
      grupo: grupo.value,
      situacao: situacao.value,
      pagina: pagina.value,
      porPagina: POR_PAGINA,
    }),
});
const opcoes = useQuery({ queryKey: ['adm', 'usuarios-opcoes'], queryFn: () => buscarOpcoesUsuarios() });
const total = computed(() => consulta.data.value?.total ?? 0);
const totalPaginas = computed(() => Math.max(1, Math.ceil(total.value / POR_PAGINA)));
const intervalo = computed(() =>
  t('adm.usuarios.intervalo', {
    de: numero(total.value === 0 ? 0 : (pagina.value - 1) * POR_PAGINA + 1),
    ate: numero(Math.min(pagina.value * POR_PAGINA, total.value)),
    total: numero(total.value),
  }),
);
const filtrando = computed(() => busca.value !== '' || grupo.value !== '' || situacao.value !== 'todos');
function limparFiltros(): void {
  busca.value = '';
  termo.value = '';
  grupo.value = '';
  situacao.value = 'todos';
}
const podeCriar = computed(() => pode('acesso.usuario.criar'));
// M43 (ficha, campo 7): a revisão dos sem grupo e dos logins de painel é da área de usuários (permissões do M10).

const dialogo = ref(false);
const novo = ref({ login: '', nomeCompleto: '', grupo: '', cpf: '' });
const senha = ref('');
const erro = ref<unknown>(null);
const aviso = ref('');
const salvando = ref(false);
const opcoesFiltroGrupo = computed(() => [
  { valor: '', rotulo: t('adm.usuarios.todosGrupos') },
  ...(opcoes.data.value?.grupos ?? []).map((g) => ({ valor: g.nome, rotulo: g.nome })),
]);
const opcoesNovoGrupo = computed(() =>
  (opcoes.data.value?.grupos ?? []).filter((x) => x.ativo).map((g) => ({ valor: g.nome, rotulo: g.nome })),
);
/** O grupo é obrigatório na criação: sem escolha, a gravação não sai. */
const faltaGrupo = ref(false);
/** O CPF é conferido ao sair do campo (e ao salvar), não a cada tecla. */
const cpfTocado = ref(false);
const cpfProblema = computed<'' | 'tamanho' | 'digito'>(() => {
  const c = novo.value.cpf;
  if (!cpfTocado.value || c === '') return '';
  if (!/^\d{11}$/.test(c)) return 'tamanho';
  return cpfValido(c) ? '' : 'digito';
});
const cpfRuim = computed(() => cpfProblema.value !== '');
function abrir(): void {
  novo.value = { login: '', nomeCompleto: '', grupo: '', cpf: '' };
  senha.value = '';
  erro.value = null;
  faltaGrupo.value = false;
  cpfTocado.value = false;
  perfilSugerido.value = '';
  dialogo.value = true;
}
// W1-01 (parte 11a3): "Criar usuário" das Tarefas do RH abre a criação já com o nome do colaborador e mostra o
// perfil sugerido pelo cargo (concedido na ficha depois de criar). Os parâmetros saem da query ao abrir.
const perfilSugerido = ref('');
function abrirDaQuery(): void {
  if (rota.query['novo'] !== '1' || !podeCriar.value) return;
  const nome = rota.query['nome'];
  const perfil = rota.query['perfil'];
  abrir();
  if (typeof nome === 'string') novo.value.nomeCompleto = nome;
  perfilSugerido.value = typeof perfil === 'string' ? perfil : '';
  void roteador.replace({ query: { ...rota.query, novo: undefined, nome: undefined, perfil: undefined } });
}
abrirDaQuery();
const senhaNova = ref<{ login: string; senha: string; trocaObrigatoria: boolean } | null>(null);
const dialogoInicial = ref(false);
const copiada = ref(false);
watch(dialogoInicial, (v) => {
  if (!v) senhaNova.value = null;
});
async function copiarInicial(): Promise<void> {
  if (!senhaNova.value) return;
  try {
    await navigator.clipboard?.writeText(senhaNova.value.senha);
    copiada.value = true;
  } catch {
    copiada.value = false;
  }
}
async function criar(): Promise<void> {
  faltaGrupo.value = !novo.value.grupo;
  cpfTocado.value = true;
  if (faltaGrupo.value || cpfRuim.value) return;
  salvando.value = true;
  erro.value = null;
  try {
    const login = novo.value.login.trim();
    const r = await criarUsuario(
      {
        login: novo.value.login,
        nomeCompleto: novo.value.nomeCompleto,
        grupo: novo.value.grupo,
        ...(novo.value.cpf ? { cpf: novo.value.cpf } : {}),
      },
      senha.value,
    );
    dialogo.value = false;
    // A senha inicial vem na mesma resposta e aparece uma vez só (fechar apaga); sem ela, o aviso diz o que fazer.
    if (r.senhaProvisoria) {
      senhaNova.value = { login, senha: r.senhaProvisoria, trocaObrigatoria: r.trocaObrigatoria !== false };
      copiada.value = false;
      dialogoInicial.value = true;
      aviso.value = t('adm.usuarios.criadoComSenha', { login });
    } else aviso.value = r.senhaPendente ?? t('adm.usuarios.criado');
    await cliente.invalidateQueries({ queryKey: ['adm', 'usuarios'] });
  } catch (e) {
    erro.value = e;
  } finally {
    salvando.value = false;
    senha.value = '';
  }
}
const caminhoFicha = (login: string) => `${CAMINHO_LISTA_USUARIOS}/${encodeURIComponent(login)}`;
/**
 * Clique na linha: abre a ficha. Não age quando o clique foi no próprio link (ele já navega, com Ctrl e meio-clique
 * do navegador), quando há texto selecionado (quem arrasta para copiar o nome ou o login) ou fora do botão principal;
 * com Ctrl/Cmd, abre em outra aba como o link faria.
 */
function clicarLinha(e: MouseEvent, login: string): void {
  if ((e.target as HTMLElement).closest('a, button')) return;
  if (e.button !== 0) return;
  if ((window.getSelection?.()?.toString() ?? '') !== '') return;
  const caminho = caminhoFicha(login);
  if (e.ctrlKey || e.metaKey) {
    window.open(roteador.resolve(caminho).href, '_blank', 'noopener');
    return;
  }
  void roteador.push(caminho);
}
</script>

<template>
  <section class="tela usuarios" aria-labelledby="usuarios-titulo">
    <header class="cabecalho">
      <div class="cabecalho__titulo">
        <h1 id="usuarios-titulo">{{ t('adm.usuarios.titulo') }}</h1>
        <span
          v-if="vista === 'cadastro' && consulta.data.value"
          class="contador"
          data-testid="usuarios-total"
          >{{ t('adm.usuarios.contagem', { n: numero(total) }, total) }}</span
        >
      </div>
      <p class="cabecalho__texto">{{ t('adm.usuarios.subtitulo') }}</p>
      <div class="cabecalho__acoes">
        <SanteBotao
          v-if="podeCriar"
          :rotulo="t('adm.usuarios.novo')"
          data-testid="novo-usuario"
          @acionar="abrir"
        />
        <AtalhoVinculoConta v-if="podeCriar" />
        <AtalhoAlcadas />
      </div>
    </header>

    <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar />

    <div
      ref="listaAbas"
      :class="['abas', { 'abas--antes': rolagemAbas.antes.value, 'abas--depois': rolagemAbas.depois.value }]"
      role="tablist"
      :aria-label="t('adm.usuarios.vistas')"
      data-testid="usuarios-vista"
    >
      <button
        v-for="(o, i) in opcoesVista"
        :id="`usuarios-aba-${o.valor}`"
        :key="o.valor"
        ref="abas"
        type="button"
        role="tab"
        class="aba"
        :aria-selected="vista === o.valor ? 'true' : 'false'"
        :aria-controls="`usuarios-painel-${o.valor}`"
        :tabindex="vista === o.valor ? 0 : -1"
        @click="vista = o.valor"
        @keydown="teclaAba($event, i)"
      >
        {{ o.rotulo }}
      </button>
    </div>

    <div
      :id="`usuarios-painel-${vista}`"
      class="painel"
      role="tabpanel"
      :aria-labelledby="`usuarios-aba-${vista}`"
    >
      <IdentidadeUsuarios v-if="vista === 'identidade'" />
      <SenhasSecundariasUsuarios v-else-if="vista === 'senhas-secundarias'" />
      <CpfUsuarios v-else-if="vista === 'cpf'" />
      <template v-else>
        <form class="filtros" role="search" @submit.prevent="termo = busca">
          <div class="busca">
            <label for="usuarios-busca" class="sgh-visualmente-oculto">{{ t('adm.usuarios.busca') }}</label>
            <SanteIcone nome="busca" class="busca__icone" />
            <input
              id="usuarios-busca"
              v-model="busca"
              type="search"
              :placeholder="t('adm.usuarios.buscaDica')"
              autocomplete="off"
              data-testid="usuarios-busca"
            />
          </div>
          <div class="filtros__grupo">
            <SanteSelecao
              id="usuarios-grupo"
              v-model="grupo"
              :rotulo="t('adm.usuarios.grupo')"
              ocultar-rotulo
              :opcoes="opcoesFiltroGrupo"
              data-testid="usuarios-grupo"
            />
          </div>
          <fieldset class="segmentos" data-testid="usuarios-situacao">
            <legend class="sgh-visualmente-oculto">{{ t('adm.usuarios.situacao') }}</legend>
            <label
              v-for="s in SITUACOES"
              :key="s"
              :class="['segmento', { 'segmento--ativo': situacao === s }]"
            >
              <input v-model="situacao" type="radio" name="usuarios-situacao" :value="s" />
              <span>{{ t(`adm.usuarios.situacoes.${s}`) }}</span>
            </label>
          </fieldset>
        </form>

        <div v-if="consulta.isError.value" class="falha">
          <MensagemErro :erro="consulta.error.value" />
          <SanteBotao
            :rotulo="t('adm.ficha.tentarDeNovo')"
            variante="secundario"
            data-testid="usuarios-tentar"
            @acionar="consulta.refetch()"
          />
        </div>
        <div
          v-else-if="consulta.isPending.value"
          class="cartao-tabela esqueleto"
          aria-busy="true"
          data-testid="usuarios-carregando"
        >
          <span class="sgh-visualmente-oculto" role="status">{{ t('adm.comum.carregando') }}</span>
          <div v-for="i in 7" :key="i" class="esqueleto__linha" aria-hidden="true">
            <span class="esqueleto__bloco esqueleto__bloco--avatar" />
            <span class="esqueleto__bloco esqueleto__bloco--nome" />
            <span class="esqueleto__bloco esqueleto__bloco--curto" />
          </div>
        </div>
        <template v-else-if="consulta.data.value">
          <p v-if="consulta.data.value.destino === 'memoria'" class="nota">{{ t('adm.comum.memoria') }}</p>
          <div
            v-if="consulta.data.value.itens.length === 0"
            class="cartao-tabela vazio"
            data-testid="usuarios-vazio"
          >
            <SanteIcone nome="busca" tamanho="2rem" class="vazio__icone" />
            <p>{{ t('adm.usuarios.vazio') }}</p>
            <SanteBotao
              v-if="filtrando"
              :rotulo="t('adm.usuarios.limpar')"
              variante="secundario"
              @acionar="limparFiltros"
            />
          </div>
          <div
            v-else
            :class="['cartao-tabela', { 'cartao-tabela--atualizando': consulta.isPlaceholderData.value }]"
            :aria-busy="consulta.isPlaceholderData.value ? 'true' : undefined"
          >
            <div class="rolagem" tabindex="0" role="region" :aria-label="t('adm.comum.rolagem')">
              <table data-testid="tabela-usuarios">
                <caption class="sgh-visualmente-oculto">
                  {{
                    t('adm.usuarios.legenda')
                  }}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">{{ t('adm.usuarios.colunaUsuario') }}</th>
                    <th scope="col">{{ t('adm.usuarios.grupo') }}</th>
                    <th scope="col">{{ t('adm.usuarios.situacao') }}</th>
                    <th scope="col">{{ t('adm.usuarios.ultimoAcesso') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="u in consulta.data.value.itens"
                    :key="u.login"
                    class="linha"
                    @click="clicarLinha($event, u.login)"
                  >
                    <th scope="row" class="celula-usuario">
                      <span class="usuario">
                        <span class="avatar" aria-hidden="true">{{ iniciais(u.nome, u.login) }}</span>
                        <span class="usuario__textos">
                          <span :class="['usuario__nome', { 'usuario__nome--vazio': !u.nome }]">{{
                            u.nome || t('adm.usuarios.semNome')
                          }}</span>
                          <RouterLink
                            class="usuario__login"
                            :to="caminhoFicha(u.login)"
                            :aria-label="t('adm.usuarios.abrir', { login: u.login })"
                            :data-testid="`abrir-usuario-${u.login}`"
                            >{{ u.login }}</RouterLink
                          >
                        </span>
                      </span>
                    </th>
                    <td>
                      <span v-if="u.grupo" class="etiqueta">{{ u.grupo }}</span>
                      <span v-else class="apagado">{{ t('adm.usuarios.semGrupo') }}</span>
                    </td>
                    <td>
                      <span class="pilulas">
                        <span :class="['pilula', u.ativo ? 'pilula--ok' : 'pilula--neutra']">{{
                          u.ativo ? t('adm.comum.ativo') : t('adm.comum.inativo')
                        }}</span>
                        <span v-if="u.bloqueado" class="pilula pilula--alerta">
                          <SanteIcone nome="cadeado" tamanho="0.95em" />{{ t('adm.usuarios.bloqueado') }}
                        </span>
                      </span>
                    </td>
                    <td class="data">
                      <span class="data__rotulo">{{ t('adm.usuarios.ultimoAcesso') }}: </span>
                      <span v-if="u.ultimoAcesso">{{ dataHora(u.ultimoAcesso) }}</span>
                      <span v-else class="apagado">{{ t('adm.usuarios.nunca') }}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="paginas">
              <span role="status">{{ intervalo }}</span>
              <span v-if="totalPaginas > 1" class="paginas__botoes">
                <SanteBotao
                  :rotulo="t('adm.comum.anterior')"
                  variante="texto"
                  :desabilitado="pagina <= 1"
                  @acionar="pagina--"
                />
                <span class="paginas__n">{{ pagina }} / {{ totalPaginas }}</span>
                <SanteBotao
                  :rotulo="t('adm.comum.proxima')"
                  variante="texto"
                  :desabilitado="pagina >= totalPaginas"
                  @acionar="pagina++"
                />
              </span>
            </div>
          </div>
        </template>
      </template>
    </div>

    <!-- A senha inicial da conta recém-criada: uma vez, só para quem criou (fechar apaga) -->
    <SanteDialogo
      v-model:visivel="dialogoInicial"
      :titulo="senhaNova ? t('adm.ficha.provisoria.titulo', { login: senhaNova.login }) : ''"
    >
      <div v-if="senhaNova" class="form" data-testid="senha-provisoria">
        <p>{{ t('adm.ficha.provisoria.texto') }}</p>
        <SanteAlerta
          v-if="!senhaNova.trocaObrigatoria"
          :texto="t('adm.ficha.provisoria.semTroca')"
          variante="aviso"
          data-testid="senha-provisoria-sem-troca"
        />
        <code class="senha-inicial" data-testid="senha-provisoria-valor">{{ senhaNova.senha }}</code>
        <div class="senha-inicial__acoes">
          <SanteBotao
            :rotulo="copiada ? t('adm.ficha.provisoria.copiada') : t('adm.ficha.provisoria.copiar')"
            variante="texto"
            data-testid="senha-provisoria-copiar"
            @acionar="copiarInicial"
          />
          <RouterLink
            :to="caminhoFicha(senhaNova.login)"
            class="senha-inicial__ficha"
            data-testid="senha-provisoria-ficha"
            >{{ t('adm.usuarios.abrir', { login: senhaNova.login }) }}</RouterLink
          >
          <SanteBotao
            :rotulo="t('adm.ficha.provisoria.fechar')"
            data-testid="senha-provisoria-fechar"
            @acionar="dialogoInicial = false"
          />
        </div>
      </div>
    </SanteDialogo>

    <SanteDialogo v-model:visivel="dialogo" :titulo="t('adm.usuarios.novo')" largura="42rem">
      <form class="form" data-testid="form-novo-usuario" @submit.prevent="criar">
        <MensagemErro v-if="erro" :erro="erro" />
        <SanteAlerta
          v-if="perfilSugerido"
          :texto="t('adm.usuarios.perfilSugerido', { perfil: perfilSugerido })"
          variante="info"
          data-testid="novo-perfil-sugerido"
        />
        <fieldset class="bloco">
          <legend>{{ t('adm.usuarios.identificacao') }}</legend>
          <div class="grade">
            <div class="grade__campo">
              <SanteCampoTexto
                v-model="novo.login"
                :rotulo="t('adm.usuarios.loginRotulo')"
                :max-bytes="31"
                obrigatorio
                data-testid="novo-login"
              />
            </div>
            <div class="grade__campo">
              <SanteSelecao
                id="novo-grupo"
                v-model="novo.grupo"
                class="selecao-empilhada"
                obrigatorio
                :rotulo="t('adm.usuarios.grupo')"
                :opcoes="opcoesNovoGrupo"
                data-testid="novo-grupo"
              />
            </div>
            <div class="grade__campo grade__campo--largo">
              <SanteCampoTexto
                v-model="novo.nomeCompleto"
                :rotulo="t('adm.usuarios.nome')"
                :max-bytes="70"
                obrigatorio
                data-testid="novo-nome"
              />
            </div>
            <div class="grade__campo">
              <label for="novo-cpf" class="rotulo">{{ t('adm.usuarios.cpfRotulo') }}</label>
              <input
                id="novo-cpf"
                v-model="novo.cpf"
                class="entrada"
                inputmode="numeric"
                maxlength="11"
                pattern="\d{11}"
                autocomplete="off"
                :aria-invalid="cpfRuim ? 'true' : undefined"
                aria-describedby="novo-cpf-dica"
                data-testid="novo-cpf"
                @blur="cpfTocado = true"
              />
              <small id="novo-cpf-dica" :class="['dica', { 'dica--erro': cpfRuim }]" aria-live="polite">{{
                cpfProblema === 'tamanho'
                  ? t('adm.usuarios.cpfTamanho')
                  : cpfProblema === 'digito'
                    ? t('adm.usuarios.cpfDigito')
                    : t('adm.usuarios.cpfDica')
              }}</small>
            </div>
          </div>
          <SanteAlerta
            v-if="faltaGrupo"
            :texto="t('adm.usuarios.faltaGrupo')"
            variante="aviso"
            anunciar
            data-testid="novo-falta-grupo"
          />
        </fieldset>
        <fieldset class="bloco bloco--confirmacao">
          <legend>{{ t('adm.usuarios.confirmacao') }}</legend>
          <SenhaConfirmacao v-model="senha" testid="novo-senha" />
        </fieldset>
        <div class="botoes">
          <SanteBotao :rotulo="t('adm.comum.cancelar')" variante="texto" @acionar="dialogo = false" />
          <SanteBotao
            :rotulo="t('adm.comum.salvar')"
            tipo="submit"
            :desabilitado="salvando"
            data-testid="criar-usuario"
          />
        </div>
      </form>
    </SanteDialogo>
  </section>
</template>

<style scoped>
.senha-inicial {
  display: block;
  padding: var(--sgh-espaco-2);
  font-size: 1.25rem;
  letter-spacing: 0.08em;
  text-align: center;
  user-select: all;
  overflow-wrap: anywhere;
}
.senha-inicial__acoes {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: var(--sgh-espaco-2);
}
.usuarios {
  display: grid;
  gap: var(--sgh-espaco-3);
  min-width: 0;
}
/* Cabeçalho: título com contador, texto curto e as ações à direita (embaixo no celular). */
.cabecalho {
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-areas:
    'titulo acoes'
    'texto acoes';
  gap: var(--sgh-espaco-1) var(--sgh-espaco-3);
  align-items: center;
}
.cabecalho__titulo {
  grid-area: titulo;
  display: flex;
  align-items: baseline;
  gap: var(--sgh-espaco-2);
  flex-wrap: wrap;
}
.cabecalho__titulo h1 {
  margin: 0;
}
.cabecalho__texto {
  grid-area: texto;
  margin: 0;
  color: var(--sgh-texto-secundario);
}
.cabecalho__acoes {
  grid-area: acoes;
  display: flex;
  align-items: center;
  gap: var(--sgh-espaco-3);
  flex-wrap: wrap;
  justify-content: flex-end;
}
.contador {
  padding: 2px var(--sgh-espaco-2);
  border-radius: 999px;
  background: var(--sgh-fundo-sutil);
  border: 1px solid var(--sgh-borda);
  font-size: var(--sgh-fonte-pequena);
  color: var(--sgh-texto-secundario);
  white-space: nowrap;
}
.link-discreto {
  color: var(--sgh-link);
  font-size: var(--sgh-fonte-pequena);
}
/* Abas das vistas. */
.abas {
  display: flex;
  gap: var(--sgh-espaco-1);
  border-bottom: 1px solid var(--sgh-borda);
  overflow-x: auto;
  scrollbar-width: none;
}
/* Abas que não cabem (celular): a borda some em degradê do lado em que há mais abas (a máscara usa só o alfa). */
.abas--depois {
  mask-image: linear-gradient(to right, var(--sgh-texto) calc(100% - 3rem), transparent);
}
.abas--antes {
  mask-image: linear-gradient(to left, var(--sgh-texto) calc(100% - 3rem), transparent);
}
.abas--antes.abas--depois {
  mask-image: linear-gradient(
    to right,
    transparent,
    var(--sgh-texto) 3rem,
    var(--sgh-texto) calc(100% - 3rem),
    transparent
  );
}
.aba {
  font: inherit;
  padding: var(--sgh-espaco-2) var(--sgh-espaco-3);
  min-height: var(--sgh-alvo-minimo);
  border: 0;
  border-bottom: 3px solid transparent;
  background: transparent;
  color: var(--sgh-texto-secundario);
  cursor: pointer;
  white-space: nowrap;
  margin-bottom: -1px;
}
.aba:hover {
  color: var(--sgh-texto);
}
.aba[aria-selected='true'] {
  color: var(--sgh-texto);
  border-bottom-color: var(--sgh-primaria);
  font-weight: 600;
}
.aba:focus-visible {
  outline: 3px solid var(--sgh-foco);
  outline-offset: -3px;
}
.painel {
  display: grid;
  gap: var(--sgh-espaco-3);
  min-width: 0;
}
/* Filtros numa barra só: busca larga, grupo e situação em segmentos. */
.filtros {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: center;
}
.busca {
  position: relative;
  flex: 1 1 16rem;
  min-width: 0;
}
.busca__icone {
  position: absolute;
  left: var(--sgh-espaco-2);
  top: 50%;
  transform: translateY(-50%);
  color: var(--sgh-texto-secundario);
  pointer-events: none;
}
.busca input {
  width: 100%;
  min-height: var(--sgh-alvo-minimo);
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2) var(--sgh-espaco-1) calc(var(--sgh-espaco-2) + 1.6em);
}
.filtros__grupo {
  flex: 0 1 14rem;
  min-width: 10rem;
}
.segmentos {
  display: inline-flex;
  margin: 0;
  padding: 2px;
  border: 1px solid var(--sgh-borda);
  border-radius: var(--p-button-border-radius, 6px);
  background: var(--sgh-fundo-sutil);
  flex-wrap: wrap;
}
.segmento {
  position: relative;
  display: inline-flex;
  align-items: center;
  min-height: calc(var(--sgh-alvo-minimo) - 6px);
  padding: 0 var(--sgh-espaco-3);
  border-radius: var(--p-button-border-radius, 6px);
  cursor: pointer;
  color: var(--sgh-texto-secundario);
  font-size: var(--sgh-fonte-pequena);
}
.segmento input {
  position: absolute;
  opacity: 0;
  inset: 0;
  margin: 0;
  cursor: pointer;
}
.segmento--ativo {
  background: var(--sgh-fundo-elevado);
  color: var(--sgh-texto);
  font-weight: 600;
  box-shadow: inset 0 0 0 1px var(--sgh-borda);
}
.segmento:has(input:focus-visible) {
  outline: 3px solid var(--sgh-foco);
  outline-offset: 1px;
}
.carregando,
.nota {
  margin: 0;
  color: var(--sgh-texto-secundario);
  font-size: var(--sgh-fonte-pequena);
}
/* Tabela em cartão. */
.cartao-tabela {
  border: 1px solid var(--sgh-borda);
  border-radius: var(--p-button-border-radius, 6px);
  background: var(--sgh-fundo-elevado);
  overflow: hidden;
  min-width: 0;
}
.cartao-tabela--atualizando {
  opacity: 0.7;
  transition: opacity 0.15s;
}
.falha {
  display: grid;
  gap: var(--sgh-espaco-2);
  justify-items: start;
}
/* Esqueleto do carregamento: linhas com a forma da tabela (o layout não pula quando chegam os dados). */
.esqueleto__linha {
  display: flex;
  align-items: center;
  gap: var(--sgh-espaco-3);
  padding: var(--sgh-espaco-2) var(--sgh-espaco-3);
  border-bottom: 1px solid var(--sgh-borda);
}
.esqueleto__linha:last-child {
  border-bottom: 0;
}
.esqueleto__bloco {
  display: block;
  height: 0.9rem;
  border-radius: var(--p-button-border-radius, 6px);
  background: var(--sgh-fundo-sutil);
  animation: pulsar 1.4s ease-in-out infinite;
}
.esqueleto__bloco--avatar {
  flex: none;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 50%;
}
.esqueleto__bloco--nome {
  flex: 0 1 16rem;
}
.esqueleto__bloco--curto {
  flex: 0 1 6rem;
  margin-left: auto;
}
@keyframes pulsar {
  50% {
    opacity: 0.45;
  }
}
@media (prefers-reduced-motion: reduce) {
  .esqueleto__bloco {
    animation: none;
  }
  .cartao-tabela--atualizando {
    transition: none;
  }
}
.rolagem {
  overflow-x: auto;
}
table {
  border-collapse: collapse;
  width: 100%;
}
thead th {
  background: var(--sgh-fundo-sutil);
  color: var(--sgh-texto-secundario);
  font-size: var(--sgh-fonte-pequena);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-2) var(--sgh-espaco-3);
  border-bottom: 1px solid var(--sgh-borda);
  vertical-align: middle;
}
tbody tr:last-child > * {
  border-bottom: 0;
}
.linha {
  cursor: pointer;
}
.linha:hover > * {
  background: var(--sgh-fundo-sutil);
}
.celula-usuario {
  font-weight: 400;
  min-width: 14rem;
}
.usuario {
  display: flex;
  align-items: center;
  gap: var(--sgh-espaco-2);
  font-weight: 400;
  min-width: 14rem;
}
.avatar {
  flex: none;
  display: inline-grid;
  place-items: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 50%;
  background: var(--sgh-primaria-suave);
  color: var(--sgh-primaria);
  font-weight: 700;
  font-size: var(--sgh-fonte-pequena);
}
.usuario__textos {
  display: grid;
  min-width: 0;
}
.usuario__nome {
  font-weight: 600;
  color: var(--sgh-texto);
}
.usuario__nome--vazio,
.apagado {
  color: var(--sgh-texto-secundario);
  font-style: italic;
  font-weight: 400;
}
.usuario__login {
  font-family: var(--sgh-fonte-codigo);
  font-size: var(--sgh-fonte-pequena);
  color: var(--sgh-link);
  width: fit-content;
}
.etiqueta {
  display: inline-block;
  padding: 1px var(--sgh-espaco-2);
  border-radius: var(--p-button-border-radius, 6px);
  border: 1px solid var(--sgh-borda);
  background: var(--sgh-fundo-sutil);
  font-size: var(--sgh-fonte-pequena);
  font-family: var(--sgh-fonte-codigo);
  white-space: nowrap;
}
.pilulas {
  display: inline-flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-1);
}
.pilula {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px var(--sgh-espaco-2);
  border-radius: 999px;
  font-size: var(--sgh-fonte-pequena);
  font-weight: 600;
  border: 1px solid currentcolor;
  white-space: nowrap;
}
.pilula--ok {
  color: var(--sgh-sucesso);
}
.pilula--neutra {
  color: var(--sgh-texto-secundario);
}
.pilula--alerta {
  color: var(--sgh-alerta);
  background: var(--sgh-alerta-suave);
}
.data {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
/* O rótulo da data só aparece no modo cartão (celular), onde o cabeçalho da tabela fica oculto. */
.data__rotulo {
  display: none;
}
.vazio {
  display: grid;
  justify-items: center;
  gap: var(--sgh-espaco-2);
  padding: calc(var(--sgh-espaco-4) * 2) var(--sgh-espaco-4);
  color: var(--sgh-texto-secundario);
  text-align: center;
}
.vazio__icone {
  opacity: 0.6;
}
.vazio p {
  margin: 0;
}
.paginas {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  padding: var(--sgh-espaco-1) var(--sgh-espaco-3);
  border-top: 1px solid var(--sgh-borda);
  color: var(--sgh-texto-secundario);
  font-size: var(--sgh-fonte-pequena);
}
.paginas__botoes {
  display: inline-flex;
  align-items: center;
  gap: var(--sgh-espaco-1);
}
.paginas__n {
  font-variant-numeric: tabular-nums;
}
/* Diálogo de novo usuário em grade. */
.form {
  display: grid;
  gap: var(--sgh-espaco-3);
}
.bloco {
  margin: 0;
  padding: 0;
  border: 0;
  display: grid;
  gap: var(--sgh-espaco-2);
  min-width: 0;
}
.bloco legend {
  font-weight: 600;
  padding: 0;
  margin-bottom: var(--sgh-espaco-2);
}
.bloco--confirmacao {
  padding-top: var(--sgh-espaco-3);
  border-top: 1px solid var(--sgh-borda);
}
.grade {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--sgh-espaco-3);
}
.grade__campo {
  display: grid;
  gap: var(--sgh-espaco-1);
  align-content: start;
  min-width: 0;
}
.grade__campo--largo {
  grid-column: 1 / -1;
}
.rotulo {
  font-weight: 600;
}
.dica {
  margin: 0;
  color: var(--sgh-texto-secundario);
  font-size: var(--sgh-fonte-pequena);
}
.dica--erro {
  color: var(--sgh-alerta);
  font-weight: 600;
}
/* O grupo com o rótulo acima, como os outros campos do diálogo. */
.grade__campo .selecao-empilhada {
  display: grid;
  gap: var(--sgh-espaco-1);
}
.selecao-empilhada :deep(.sgh-selecao__rotulo) {
  font-weight: 600;
}
.selecao-empilhada :deep(.sgh-selecao__campo) {
  width: 100%;
}
.botoes {
  display: flex;
  justify-content: flex-end;
  gap: var(--sgh-espaco-2);
}
input.entrada,
.busca input {
  font: inherit;
  border: 1px solid var(--sgh-borda-forte);
  border-radius: var(--p-button-border-radius, 6px);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
  min-height: var(--sgh-alvo-minimo);
}
input.entrada {
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  width: 100%;
}
input.entrada[aria-invalid='true'] {
  border-color: var(--sgh-alerta);
}
/* Celular: o cabeçalho empilha; a tabela vira lista de cartões (sem rolagem lateral). */
@media (width <= 40rem) {
  .cabecalho {
    grid-template-columns: 1fr;
    grid-template-areas: 'titulo' 'texto' 'acoes';
  }
  .cabecalho__acoes {
    justify-content: space-between;
  }
  .filtros__grupo {
    flex: 1 1 100%;
  }
  .segmentos {
    width: 100%;
  }
  .segmento {
    flex: 1 1 auto;
    justify-content: center;
  }
  thead {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
  table,
  tbody,
  tr,
  th,
  td {
    display: block;
  }
  tbody tr {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: var(--sgh-espaco-1) var(--sgh-espaco-2);
    padding: var(--sgh-espaco-2) var(--sgh-espaco-3);
    border-bottom: 1px solid var(--sgh-borda);
  }
  tbody tr:last-child {
    border-bottom: 0;
  }
  tbody tr > * {
    padding: 0;
    border: 0;
  }
  .celula-usuario {
    grid-column: 1 / -1;
    min-width: 0;
  }
  .data {
    grid-column: 1 / -1;
    color: var(--sgh-texto-secundario);
    font-size: var(--sgh-fonte-pequena);
  }
  .data__rotulo {
    display: inline;
  }
  .grade {
    grid-template-columns: 1fr;
  }
}
</style>
