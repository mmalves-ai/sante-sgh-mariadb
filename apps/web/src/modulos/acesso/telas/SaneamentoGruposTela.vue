<script setup lang="ts">
// "Saneamento dos grupos" (M59-F4; ficha do M59, seção 7: /administracao/acesso/grupos/saneamento). Os grupos de
// acesso amplo com a situação do plano; os usuários de cada um com a última entrada, a sugestão do grupo de
// trabalho pelo uso e a decisão; o simulador do antes e depois (regra 8); a aprovação do dono da área (com a
// senha), a aplicação (com a senha) e a retirada das opções do grupo vazio. Ler: acesso.grupo.ler; agir:
// acesso.grupo.sanear. O servidor confere tudo de novo (situação, segregação, limite de administradores).
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import {
  type DecisaoSaneamento,
  type GrupoSaneamento,
  type ItemSaneamento,
  PERMISSOES_M59_F4_CODIGOS,
  type UsuarioSaneamento,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import {
  aplicarSaneamento,
  aprovarSaneamento,
  buscarPainelSaneamento,
  decidirSaneamento,
  descartarSaneamento,
  dissolverGrupoSaneamento,
  listarUsuariosSaneamento,
  simularSaneamento,
} from '../api-saneamento.js';
import { codigoDoErro } from '../api-identidade.js';
import { dataBr } from '../identidade-tela.js';
import {
  type AcaoSaneamento,
  acoesDoUsuario,
  chaveRecusaSaneamento,
  destinoInicial,
  ordenarUsuarios,
} from '../saneamento-tela.js';

type DecisaoUsuario = Exclude<DecisaoSaneamento, 'dissolver-grupo'>;

const { t } = useI18n();
const cliente = useQueryClient();
const CHAVE = ['acesso', 'saneamento'] as const;
const podeSanear = computed(() => pode(PERMISSOES_M59_F4_CODIGOS.grupoSanear));
const aviso = ref('');

const painel = useQuery({ queryKey: [...CHAVE, 'painel'], queryFn: () => buscarPainelSaneamento() });
const janela = computed(() => painel.data.value?.janelaDias ?? 180);
const destinos = computed(() => painel.data.value?.destinos ?? []);
const opcoesDestino = computed(() =>
  destinos.value.map((d) => ({ valor: d.grupo, rotulo: `${d.grupo} (${d.opcoes})` })),
);

const grupoAberto = ref<string | null>(null);
const usuarios = useQuery({
  queryKey: computed(() => [...CHAVE, 'usuarios', grupoAberto.value]),
  queryFn: () => listarUsuariosSaneamento(grupoAberto.value ?? ''),
  enabled: computed(() => grupoAberto.value !== null),
});
const lista = computed(() => ordenarUsuarios(usuarios.data.value?.usuarios ?? []));
const opcoesUsuario = computed(() =>
  lista.value.map((u) => ({ valor: u.login, rotulo: u.nome ? `${u.login} — ${u.nome}` : u.login })),
);
const irPara = ref('');
function irParaUsuario(login: string): void {
  const u = lista.value.find((x) => x.login === login);
  irPara.value = '';
  if (u && acoesDoUsuario(u, podeSanear.value).includes('decidir')) abrirDecidir(u);
}

function abrirGrupo(g: GrupoSaneamento): void {
  grupoAberto.value = g.grupo;
  aviso.value = '';
}

async function recarregar(): Promise<void> {
  await cliente.invalidateQueries({ queryKey: CHAVE });
}

const textoDecisao = (i: ItemSaneamento): string =>
  t(`saneamento.decisoes.${i.decisao}`, { grupo: i.grupoDestino ?? '' });
const textoSituacao = (i: ItemSaneamento): string =>
  t(`saneamento.situacoes.${i.situacao}`, { area: i.aprovacao?.area ?? '', erro: i.erro ?? '' });
const textoAcesso = (u: UsuarioSaneamento): string =>
  u.ultimoAcesso === null
    ? t('saneamento.usuarios.nunca')
    : `${dataBr(u.ultimoAcesso)} (${t('saneamento.usuarios.dias', { n: u.diasSemAcesso ?? 0 })})`;

// ── estado comum dos diálogos ─────────────────────────────────────────────────────────────────
const senha = ref('');
const motivo = ref('');
const erro = ref<unknown>(null);
const falta = ref('');
const ocupado = ref(false);
const recusa = computed(() => {
  const k = chaveRecusaSaneamento(codigoDoErro(erro.value));
  return k ? t(k) : '';
});
function limpar(): void {
  senha.value = '';
  motivo.value = '';
  erro.value = null;
  falta.value = '';
}
async function executar(acao: () => Promise<void>): Promise<void> {
  if (ocupado.value) return;
  ocupado.value = true;
  erro.value = null;
  try {
    await acao();
    await recarregar();
  } catch (e) {
    erro.value = e;
  } finally {
    senha.value = '';
    ocupado.value = false;
  }
}

// ── decidir (com o simulador) ─────────────────────────────────────────────────────────────────
const dialogoDecidir = ref(false);
const decisao = ref<{ login: string; tipo: DecisaoUsuario; destino: string }>({
  login: '',
  tipo: 'trocar-grupo',
  destino: '',
});
const opcoesTipo = computed(() =>
  (['trocar-grupo', 'manter-administrador', 'bloquear'] as const).map((d) => ({
    valor: d,
    rotulo: t(`saneamento.opcoesDecisao.${d}`),
  })),
);
const simulacao = useQuery({
  queryKey: computed(() => [...CHAVE, 'simulacao', decisao.value.login, decisao.value.destino]),
  queryFn: () => simularSaneamento(decisao.value.login, decisao.value.destino),
  enabled: computed(
    () =>
      dialogoDecidir.value &&
      decisao.value.tipo === 'trocar-grupo' &&
      decisao.value.login !== '' &&
      decisao.value.destino !== '',
  ),
});
function abrirDecidir(u: UsuarioSaneamento | null): void {
  limpar();
  decisao.value = {
    login: u?.login ?? '',
    tipo: 'trocar-grupo',
    destino: u ? destinoInicial(u, destinos.value) : '',
  };
  dialogoDecidir.value = true;
}
function trocouUsuario(login: string): void {
  const u = lista.value.find((x) => x.login === login);
  if (u && decisao.value.destino === '') decisao.value.destino = destinoInicial(u, destinos.value);
}
async function decidir(): Promise<void> {
  const d = decisao.value;
  falta.value = !d.login
    ? t('saneamento.decidir.faltaUsuario')
    : d.tipo === 'trocar-grupo' && !d.destino
      ? t('saneamento.decidir.faltaDestino')
      : '';
  if (falta.value) return;
  await executar(async () => {
    await decidirSaneamento({
      login: d.login,
      decisao: d.tipo,
      grupoDestino: d.tipo === 'trocar-grupo' ? d.destino : null,
      motivo: motivo.value,
    });
    dialogoDecidir.value = false;
    aviso.value = t('saneamento.decidir.incluida', { login: d.login });
  });
}

// ── aprovar pela área, aplicar, descartar ─────────────────────────────────────────────────────
const alvo = ref<{ acao: 'aprovar' | 'aplicar'; usuario: UsuarioSaneamento; item: ItemSaneamento } | null>(
  null,
);
const area = ref('');
const dialogoAlvo = computed({
  get: () => alvo.value !== null,
  set: (v: boolean) => {
    if (!v) alvo.value = null;
  },
});
function acionar(acao: AcaoSaneamento, u: UsuarioSaneamento): void {
  aviso.value = '';
  if (acao === 'decidir') return abrirDecidir(u);
  const item = u.item;
  if (!item) return;
  if (acao === 'descartar') {
    void executar(async () => {
      await descartarSaneamento(item.id);
      aviso.value = t('saneamento.descartado', { login: u.login });
    });
    return;
  }
  limpar();
  area.value = '';
  alvo.value = { acao, usuario: u, item };
}
async function confirmarAlvo(): Promise<void> {
  const a = alvo.value;
  if (!a) return;
  await executar(async () => {
    if (a.acao === 'aprovar') {
      await aprovarSaneamento(a.item.id, { area: area.value, motivo: motivo.value }, senha.value);
      aviso.value = t('saneamento.aprovar.aprovado', { login: a.usuario.login });
    } else {
      const r = await aplicarSaneamento(a.item.id, senha.value);
      aviso.value =
        r.item.situacao === 'falhou'
          ? t('saneamento.aplicar.falhou', { login: a.usuario.login, erro: r.item.erro ?? '' })
          : t('saneamento.aplicar.aplicado', { login: a.usuario.login });
    }
    alvo.value = null;
  });
}

// ── retirar as opções do grupo vazio ──────────────────────────────────────────────────────────
const dissolvendo = ref<GrupoSaneamento | null>(null);
const dialogoDissolver = computed({
  get: () => dissolvendo.value !== null,
  set: (v: boolean) => {
    if (!v) dissolvendo.value = null;
  },
});
function abrirDissolver(g: GrupoSaneamento): void {
  limpar();
  aviso.value = '';
  dissolvendo.value = g;
}
async function dissolver(): Promise<void> {
  const g = dissolvendo.value;
  if (!g) return;
  await executar(async () => {
    const r = await dissolverGrupoSaneamento(g.grupo, motivo.value, senha.value);
    dissolvendo.value = null;
    aviso.value = t('saneamento.dissolver.feito', { grupo: g.grupo, lotes: r.lotes });
  });
}
</script>

<template>
  <section class="tela" aria-labelledby="saneamento-titulo">
    <h1 id="saneamento-titulo">{{ t('saneamento.titulo') }}</h1>
    <p>{{ t('saneamento.texto', { dias: janela }) }}</p>
    <p>
      <RouterLink to="/administracao/acesso/grupos" data-testid="saneamento-voltar">{{
        t('saneamento.voltarGrupos')
      }}</RouterLink>
    </p>
    <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="saneamento-aviso" />
    <template v-if="erro && !dialogoDecidir && !dialogoAlvo && !dialogoDissolver">
      <SanteAlerta v-if="recusa" :texto="recusa" variante="alerta" anunciar data-testid="saneamento-recusa" />
      <MensagemErro v-else :erro="erro" />
    </template>
    <p v-if="!podeSanear" data-testid="saneamento-sem-edicao">{{ t('saneamento.semEdicao') }}</p>

    <MensagemErro v-if="painel.isError.value" :erro="painel.error.value" />
    <p v-else-if="painel.isPending.value">{{ t('saneamento.carregando') }}</p>
    <template v-else-if="painel.data.value">
      <p data-testid="saneamento-administradores">
        {{
          t('saneamento.administradores', {
            n: painel.data.value.administradores.mantidos,
            max: painel.data.value.administradores.maximo,
          })
        }}
        {{ t('saneamento.ativosNoMaster', { n: painel.data.value.administradores.ativosNoMaster }) }}
      </p>
      <p
        v-if="painel.data.value.administradores.excedido"
        role="alert"
        data-testid="saneamento-administradores-excedido"
      >
        {{
          t('saneamento.administradoresExcedido', {
            n: painel.data.value.administradores.ativosNoMaster,
            max: painel.data.value.administradores.maximo,
          })
        }}
      </p>
      <div class="rolagem" tabindex="0" role="region" :aria-label="t('saneamento.painel.legenda')">
        <table data-testid="tabela-saneamento-grupos">
          <caption>
            {{
              t('saneamento.painel.legenda')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('saneamento.painel.grupo') }}</th>
              <th scope="col">{{ t('saneamento.painel.ativos') }}</th>
              <th scope="col">{{ t('saneamento.painel.opcoes') }}</th>
              <th scope="col">{{ t('saneamento.painel.semDecisao') }}</th>
              <th scope="col">{{ t('saneamento.painel.inativos') }}</th>
              <th scope="col">{{ t('saneamento.painel.propostos') }}</th>
              <th scope="col">{{ t('saneamento.painel.aprovados') }}</th>
              <th scope="col">{{ t('saneamento.painel.aplicados') }}</th>
              <th scope="col">{{ t('saneamento.painel.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="g in painel.data.value.grupos"
              :key="g.grupo"
              :data-testid="`saneamento-grupo-${g.grupo}`"
            >
              <th scope="row">{{ g.grupo }}</th>
              <template v-if="g.existe">
                <td>{{ g.ativos }}</td>
                <td>{{ g.opcoes }}</td>
                <td>{{ g.semDecisao }}</td>
                <td :data-testid="`saneamento-inativos-${g.grupo}`">{{ g.inativosNoGrupo }}</td>
                <td>{{ g.propostos }}</td>
                <td>{{ g.aprovados }}</td>
                <td>{{ g.aplicados }}</td>
                <td class="acoes">
                  <SanteBotao
                    :rotulo="t('saneamento.painel.verUsuarios')"
                    variante="texto"
                    :data-testid="`saneamento-ver-${g.grupo}`"
                    @acionar="abrirGrupo(g)"
                  />
                  <SanteBotao
                    v-if="podeSanear && g.dissolvivel"
                    :rotulo="t('saneamento.painel.dissolver')"
                    variante="texto"
                    :data-testid="`saneamento-dissolver-${g.grupo}`"
                    @acionar="abrirDissolver(g)"
                  />
                </td>
              </template>
              <td v-else colspan="7">{{ t('saneamento.painel.inexistente') }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <section v-if="grupoAberto" class="usuarios" aria-labelledby="saneamento-usuarios-titulo">
      <h2 id="saneamento-usuarios-titulo">{{ t('saneamento.usuarios.titulo', { grupo: grupoAberto }) }}</h2>
      <MensagemErro v-if="usuarios.isError.value" :erro="usuarios.error.value" />
      <p v-else-if="usuarios.isPending.value">{{ t('saneamento.carregando') }}</p>
      <template v-else>
        <SanteAlerta
          v-if="usuarios.data.value && !usuarios.data.value.usoLido"
          :texto="t('saneamento.usuarios.semUso')"
          variante="aviso"
          data-testid="saneamento-sem-uso"
        />
        <p v-if="lista.length === 0" role="status" data-testid="saneamento-sem-usuarios">
          {{ t('saneamento.usuarios.nenhum') }}
        </p>
        <template v-else>
          <div v-if="podeSanear" class="filtro">
            <SanteSelecao
              v-model="irPara"
              :rotulo="t('saneamento.usuarios.filtro')"
              :opcoes="opcoesUsuario"
              :busca="true"
              data-testid="saneamento-ir-para"
              @update:model-value="irParaUsuario"
            />
          </div>
          <div class="rolagem" tabindex="0" role="region" :aria-label="t('saneamento.usuarios.rolagem')">
            <table data-testid="tabela-saneamento-usuarios">
              <caption>
                {{
                  t('saneamento.usuarios.legenda', { n: lista.length })
                }}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{{ t('saneamento.usuarios.login') }}</th>
                  <th scope="col">{{ t('saneamento.usuarios.nome') }}</th>
                  <th scope="col">{{ t('saneamento.usuarios.ultimoAcesso') }}</th>
                  <th scope="col">{{ t('saneamento.usuarios.sugestao') }}</th>
                  <th scope="col">{{ t('saneamento.usuarios.decisao') }}</th>
                  <th scope="col">{{ t('saneamento.usuarios.situacao') }}</th>
                  <th v-if="podeSanear" scope="col">{{ t('saneamento.usuarios.acoes') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="u in lista" :key="u.login" :data-testid="`saneamento-usuario-${u.login}`">
                  <th scope="row">{{ u.login }}</th>
                  <td>
                    {{ u.nome ?? '' }}
                    <span v-if="u.bloqueado" class="marca">{{ t('saneamento.usuarios.bloqueado') }}</span>
                    <span v-else-if="!u.ativo" class="marca">{{ t('saneamento.usuarios.inativo') }}</span>
                  </td>
                  <td>{{ textoAcesso(u) }}</td>
                  <td>
                    {{
                      u.sugestao
                        ? t('saneamento.usuarios.sugestaoTexto', {
                            grupo: u.sugestao.grupo,
                            cobertas: u.sugestao.cobertas,
                            usadas: u.sugestao.usadas,
                          })
                        : t('saneamento.usuarios.semSugestao')
                    }}
                  </td>
                  <td>{{ u.item ? textoDecisao(u.item) : '—' }}</td>
                  <td>
                    <template v-if="u.item">
                      {{ textoSituacao(u.item) }}
                      <small
                        v-if="u.item.situacao === 'proposto' && u.item.exigeAprovacao"
                        class="bloco"
                        data-testid="saneamento-exige"
                      >
                        {{ t('saneamento.exigeAprovacao', { n: u.item.perdasUsadas }) }}
                      </small>
                    </template>
                    <template v-else>—</template>
                  </td>
                  <td v-if="podeSanear" class="acoes">
                    <SanteBotao
                      v-for="a in acoesDoUsuario(u, podeSanear)"
                      :key="a"
                      :rotulo="t(`saneamento.acoes.${a}`)"
                      :variante="a === 'descartar' ? 'texto' : 'secundario'"
                      :desabilitado="ocupado"
                      :data-testid="`saneamento-${a}-${u.login}`"
                      @acionar="acionar(a, u)"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
      </template>
    </section>

    <SanteDialogo v-model:visivel="dialogoDecidir" :titulo="t('saneamento.decidir.titulo')">
      <form class="form" data-testid="form-saneamento-decidir" @submit.prevent="decidir">
        <SanteAlerta
          v-if="recusa"
          :texto="recusa"
          variante="alerta"
          anunciar
          data-testid="saneamento-recusa"
        />
        <MensagemErro v-else-if="erro" :erro="erro" />
        <SanteSelecao
          v-model="decisao.login"
          :rotulo="t('saneamento.decidir.usuario')"
          :opcoes="opcoesUsuario"
          :busca="true"
          obrigatorio
          data-testid="decidir-usuario"
          @update:model-value="trocouUsuario"
        />
        <SanteSelecao
          v-model="decisao.tipo"
          :rotulo="t('saneamento.decidir.decisao')"
          :opcoes="opcoesTipo"
          obrigatorio
          data-testid="decidir-tipo"
        />
        <template v-if="decisao.tipo === 'trocar-grupo'">
          <SanteSelecao
            v-model="decisao.destino"
            :rotulo="t('saneamento.decidir.destino')"
            :opcoes="opcoesDestino"
            :busca="true"
            obrigatorio
            data-testid="decidir-destino"
          />
          <section
            v-if="decisao.login && decisao.destino"
            class="simulador"
            aria-labelledby="saneamento-simulador-titulo"
            data-testid="saneamento-simulador"
          >
            <h3 id="saneamento-simulador-titulo">{{ t('saneamento.simulador.titulo') }}</h3>
            <MensagemErro v-if="simulacao.isError.value" :erro="simulacao.error.value" />
            <p v-else-if="simulacao.isPending.value">{{ t('saneamento.simulador.carregando') }}</p>
            <template v-else-if="simulacao.data.value">
              <p data-testid="simulador-resumo">
                {{
                  t('saneamento.simulador.resumo', {
                    antes: simulacao.data.value.antes,
                    depois: simulacao.data.value.depois,
                    mantidas: simulacao.data.value.mantidas,
                    ganhas: simulacao.data.value.ganhasTotal,
                    perdidas: simulacao.data.value.perdidasTotal,
                  })
                }}
              </p>
              <p v-if="simulacao.data.value.usoLido">
                {{
                  t('saneamento.simulador.usadas', {
                    n: simulacao.data.value.perdidasUsadas,
                    dias: simulacao.data.value.janelaDias,
                  })
                }}
              </p>
              <SanteAlerta
                v-if="!simulacao.data.value.usoLido"
                :texto="t('saneamento.simulador.semUso')"
                variante="aviso"
              />
              <SanteAlerta
                v-else-if="simulacao.data.value.exigeAprovacao"
                :texto="t('saneamento.simulador.exige')"
                variante="aviso"
                data-testid="simulador-exige"
              />
              <details open>
                <summary>
                  {{ t('saneamento.simulador.perdidas', { n: simulacao.data.value.perdidasTotal }) }}
                </summary>
                <ul v-if="simulacao.data.value.perdidas.length" data-testid="simulador-perdidas">
                  <li v-for="o in simulacao.data.value.perdidas" :key="o.id" :class="{ usada: o.usos > 0 }">
                    {{ o.titulo }}
                    <strong v-if="o.usos > 0">({{ t('saneamento.simulador.usos', { n: o.usos }) }})</strong>
                  </li>
                </ul>
                <p v-else>{{ t('saneamento.simulador.nenhuma') }}</p>
                <p v-if="simulacao.data.value.perdidasTotal > simulacao.data.value.perdidas.length">
                  {{
                    t('saneamento.simulador.mais', {
                      n: simulacao.data.value.perdidasTotal - simulacao.data.value.perdidas.length,
                    })
                  }}
                </p>
              </details>
              <details>
                <summary>
                  {{ t('saneamento.simulador.ganhas', { n: simulacao.data.value.ganhasTotal }) }}
                </summary>
                <ul v-if="simulacao.data.value.ganhas.length" data-testid="simulador-ganhas">
                  <li v-for="o in simulacao.data.value.ganhas" :key="o.id">{{ o.titulo }}</li>
                </ul>
                <p v-else>{{ t('saneamento.simulador.nenhuma') }}</p>
                <p v-if="simulacao.data.value.ganhasTotal > simulacao.data.value.ganhas.length">
                  {{
                    t('saneamento.simulador.mais', {
                      n: simulacao.data.value.ganhasTotal - simulacao.data.value.ganhas.length,
                    })
                  }}
                </p>
              </details>
            </template>
          </section>
        </template>
        <label class="campo">
          <span>{{ t('saneamento.comum.motivo') }}</span>
          <input v-model="motivo" minlength="5" maxlength="200" required data-testid="decidir-motivo" />
          <small>{{ t('saneamento.comum.motivoAjuda') }}</small>
        </label>
        <SanteAlerta v-if="falta" :texto="falta" variante="aviso" anunciar />
        <div class="botoes">
          <SanteBotao
            :rotulo="t('saneamento.comum.confirmar')"
            tipo="submit"
            :desabilitado="ocupado"
            data-testid="decidir-confirmar"
          />
          <SanteBotao
            :rotulo="t('saneamento.comum.cancelar')"
            variante="texto"
            @acionar="dialogoDecidir = false"
          />
        </div>
      </form>
    </SanteDialogo>

    <SanteDialogo
      v-model:visivel="dialogoAlvo"
      :titulo="
        alvo
          ? t(alvo.acao === 'aprovar' ? 'saneamento.aprovar.titulo' : 'saneamento.aplicar.titulo', {
              login: alvo.usuario.login,
            })
          : ''
      "
    >
      <form v-if="alvo" class="form" data-testid="form-saneamento-alvo" @submit.prevent="confirmarAlvo">
        <p>{{ t(alvo.acao === 'aprovar' ? 'saneamento.aprovar.texto' : 'saneamento.aplicar.texto') }}</p>
        <p>{{ textoDecisao(alvo.item) }}</p>
        <SanteAlerta
          v-if="recusa"
          :texto="recusa"
          variante="alerta"
          anunciar
          data-testid="saneamento-recusa"
        />
        <MensagemErro v-else-if="erro" :erro="erro" />
        <template v-if="alvo.acao === 'aprovar'">
          <label class="campo">
            <span>{{ t('saneamento.aprovar.area') }}</span>
            <input v-model="area" minlength="2" maxlength="60" required data-testid="aprovar-area" />
          </label>
          <label class="campo">
            <span>{{ t('saneamento.comum.motivo') }}</span>
            <input v-model="motivo" minlength="5" maxlength="200" required data-testid="aprovar-motivo" />
            <small>{{ t('saneamento.comum.motivoAjuda') }}</small>
          </label>
        </template>
        <label class="campo">
          <span>{{ t('saneamento.comum.senha') }}</span>
          <input
            v-model="senha"
            type="password"
            autocomplete="current-password"
            required
            data-testid="alvo-senha"
          />
        </label>
        <div class="botoes">
          <SanteBotao
            :rotulo="t('saneamento.comum.confirmar')"
            tipo="submit"
            :desabilitado="ocupado"
            data-testid="alvo-confirmar"
          />
          <SanteBotao
            :rotulo="t('saneamento.comum.cancelar')"
            variante="texto"
            @acionar="dialogoAlvo = false"
          />
        </div>
      </form>
    </SanteDialogo>

    <SanteDialogo
      v-model:visivel="dialogoDissolver"
      :titulo="dissolvendo ? t('saneamento.dissolver.titulo', { grupo: dissolvendo.grupo }) : ''"
    >
      <form
        v-if="dissolvendo"
        class="form"
        data-testid="form-saneamento-dissolver"
        @submit.prevent="dissolver"
      >
        <p>{{ t('saneamento.dissolver.texto', { n: dissolvendo.opcoes }) }}</p>
        <SanteAlerta
          v-if="recusa"
          :texto="recusa"
          variante="alerta"
          anunciar
          data-testid="saneamento-recusa"
        />
        <MensagemErro v-else-if="erro" :erro="erro" />
        <label class="campo">
          <span>{{ t('saneamento.comum.motivo') }}</span>
          <input v-model="motivo" minlength="5" maxlength="200" required data-testid="dissolver-motivo" />
          <small>{{ t('saneamento.comum.motivoAjuda') }}</small>
        </label>
        <label class="campo">
          <span>{{ t('saneamento.comum.senha') }}</span>
          <input
            v-model="senha"
            type="password"
            autocomplete="current-password"
            required
            data-testid="dissolver-senha"
          />
        </label>
        <div class="botoes">
          <SanteBotao
            :rotulo="t('saneamento.comum.confirmar')"
            tipo="submit"
            :desabilitado="ocupado"
            data-testid="dissolver-confirmar"
          />
          <SanteBotao
            :rotulo="t('saneamento.comum.cancelar')"
            variante="texto"
            @acionar="dialogoDissolver = false"
          />
        </div>
      </form>
    </SanteDialogo>
  </section>
</template>

<style scoped>
.botoes,
.acoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: center;
}
.botoes {
  margin: var(--sgh-espaco-2) 0;
}
.form,
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
}
.form {
  gap: var(--sgh-espaco-2);
  max-width: 40rem;
}
.filtro {
  max-width: 32rem;
  margin: var(--sgh-espaco-2) 0;
}
.usuarios {
  margin-top: var(--sgh-espaco-4, 2rem);
}
.simulador {
  border: 1px solid var(--sgh-borda);
  padding: var(--sgh-espaco-2);
}
.simulador ul {
  max-height: 14rem;
  overflow-y: auto;
  margin: var(--sgh-espaco-1) 0;
}
.usada {
  font-weight: 600;
}
.bloco {
  display: block;
}
.marca {
  margin-left: var(--sgh-espaco-1);
  font-weight: 600;
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
  min-height: var(--sgh-alvo-minimo);
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
input:focus-visible {
  outline: 2px solid var(--sgh-foco);
  outline-offset: 2px;
}
</style>
