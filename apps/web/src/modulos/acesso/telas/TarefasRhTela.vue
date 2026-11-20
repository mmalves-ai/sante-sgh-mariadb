<script setup lang="ts">
// W1-01 (parte 11a3): "Tarefas do RH" (/administracao/acesso/rh). As tarefas são DERIVADAS dos vínculos da gestão
// de pessoas (D-W101-35): criar acesso na admissão (abre a criação do usuário com o nome e o perfil sugerido pelo
// cargo), revisar acesso na mudança de cargo/função/lotação e suspender nas férias/afastamento (com o parâmetro
// ligado). Cada tarefa se resolve como feita ou dispensada, com motivo e a senha (reautenticação em diálogo); a
// resolução é imutável e fica consultável. Suspender feita = bloqueio pelo executor, na mesma requisição. Abaixo, o
// mapa cargo → perfil sugerido (incluir, trocar, retirar; cada mudança é uma linha nova com histórico).
import type { TarefaRhTela, TipoTarefaRhTela } from '@sgh/contratos';
import { tipoDoProblema } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import MensagemErro from '../../../casca/MensagemErro.vue';
import SenhaConfirmacao from '../../administracao/componentes/SenhaConfirmacao.vue';
import {
  buscarPerfisCargoRh,
  buscarTarefasRh,
  definirPerfilCargoRh,
  resolverTarefaRh,
} from '../api-gestao.js';

const { t } = useI18n();
const cliente = useQueryClient();
const CHAVE_TAREFAS = ['acesso', 'rh', 'tarefas'] as const;
const CHAVE_MAPA = ['acesso', 'rh', 'perfis-cargo'] as const;
const tarefas = useQuery({ queryKey: CHAVE_TAREFAS, queryFn: () => buscarTarefasRh() });
const mapa = useQuery({ queryKey: CHAVE_MAPA, queryFn: () => buscarPerfisCargoRh() });
const dados = computed(() => tarefas.data.value ?? null);
const dadosMapa = computed(() => mapa.data.value ?? null);

type Acao = 'feita' | 'dispensada' | 'cargo' | 'retirar-cargo';
const dialogo = ref(false);
const acao = ref<Acao>('feita');
const tarefa = ref<TarefaRhTela | null>(null);
const login = ref('');
const cargo = ref<string | null>(null);
const perfil = ref<string | null>(null);
const motivo = ref('');
const senha = ref('');
const erroSenha = ref('');
const aviso = ref('');
const recusa = ref('');
const ocupado = ref(false);

watch(dialogo, (aberto) => {
  if (!aberto) {
    senha.value = '';
    erroSenha.value = '';
  }
});

const data = (iso: string | null) =>
  iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : '—';
const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR') : '—');
const tipo = (x: TipoTarefaRhTela) => t(`acesso.rh.tipos.${x}`);
const chaveTarefa = (x: { tipo: string; vinculo: number; ref: string }) => `${x.tipo}-${x.vinculo}-${x.ref}`;

/** A criação do usuário (lista de usuários) já aberta com o nome e o perfil sugerido do colaborador. */
function caminhoCriar(x: TarefaRhTela): string {
  const q = new URLSearchParams({ novo: '1', nome: x.nome });
  if (x.perfilSugerido) q.set('perfil', x.perfilSugerido);
  return `/administracao/acesso/usuarios?${q.toString()}`;
}

const pedeLogin = computed(() => acao.value === 'feita' && tarefa.value?.tipo === 'criar-acesso');
const opcoesCargo = computed(() => {
  const d = dadosMapa.value;
  const cargos = new Set<string>([...(d?.cargos ?? []), ...Object.keys(d?.vigentes ?? {})]);
  return [...cargos].sort((a, b) => a.localeCompare(b)).map((c) => ({ valor: c, rotulo: c }));
});
const opcoesPerfil = computed(() => (dadosMapa.value?.perfis ?? []).map((p) => ({ valor: p, rotulo: p })));
const vigentes = computed(() =>
  Object.entries(dadosMapa.value?.vigentes ?? {}).sort(([a], [b]) => a.localeCompare(b)),
);

const pronto = computed(() => {
  if (ocupado.value || senha.value.length === 0 || motivo.value.trim().length < 10) return false;
  if (acao.value === 'cargo') return !!cargo.value && !!perfil.value;
  if (acao.value === 'retirar-cargo') return !!cargo.value;
  return !!tarefa.value && (!pedeLogin.value || login.value.trim().length > 0);
});

const titulo = computed(() => {
  if (acao.value === 'cargo') return t('acesso.rh.dialogoCargo');
  if (acao.value === 'retirar-cargo') return t('acesso.rh.dialogoRetirarCargo', { cargo: cargo.value ?? '' });
  const x = tarefa.value;
  return t(acao.value === 'feita' ? 'acesso.rh.dialogoFeita' : 'acesso.rh.dialogoDispensar', {
    tipo: x ? tipo(x.tipo) : '',
    nome: x?.nome ?? '',
  });
});

function limpar() {
  motivo.value = '';
  aviso.value = '';
  recusa.value = '';
  dialogo.value = true;
}
function abrirTarefa(a: 'feita' | 'dispensada', x: TarefaRhTela) {
  acao.value = a;
  tarefa.value = x;
  login.value = '';
  limpar();
}
function abrirCargo(a: 'cargo' | 'retirar-cargo', c: string | null = null, p: string | null = null) {
  acao.value = a;
  tarefa.value = null;
  cargo.value = c;
  perfil.value = p;
  limpar();
}

async function confirmar(): Promise<void> {
  if (!pronto.value) return;
  ocupado.value = true;
  erroSenha.value = '';
  try {
    if (acao.value === 'cargo' || acao.value === 'retirar-cargo') {
      const c = cargo.value ?? '';
      const retirar = acao.value === 'retirar-cargo';
      await definirPerfilCargoRh({
        cargo: c,
        perfil: retirar ? null : perfil.value,
        motivo: motivo.value.trim(),
        senha: senha.value,
      });
      aviso.value = retirar
        ? t('acesso.rh.cargoRetirado', { cargo: c })
        : t('acesso.rh.cargoGravado', { cargo: c, perfil: perfil.value ?? '' });
      dialogo.value = false;
      await Promise.all([
        cliente.invalidateQueries({ queryKey: CHAVE_MAPA }),
        cliente.invalidateQueries({ queryKey: CHAVE_TAREFAS }),
      ]);
      return;
    }
    const x = tarefa.value as TarefaRhTela;
    const r = await resolverTarefaRh({
      tipo: x.tipo,
      vinculo: x.vinculo,
      ref: x.ref,
      situacao: acao.value === 'feita' ? 'feita' : 'dispensada',
      login: pedeLogin.value ? login.value.trim() : null,
      motivo: motivo.value.trim(),
      senha: senha.value,
    });
    aviso.value =
      acao.value === 'dispensada'
        ? t('acesso.rh.dispensadaAviso', { nome: x.nome })
        : r.bloqueado
          ? t('acesso.rh.suspensaAviso', { nome: x.nome, login: x.login ?? '' })
          : t('acesso.rh.feitaAviso', { nome: x.nome });
    dialogo.value = false;
    await cliente.invalidateQueries({ queryKey: CHAVE_TAREFAS });
  } catch (e) {
    const p = e instanceof ErroApi ? e.problema : null;
    const tipoP = p ? tipoDoProblema(p) : null;
    if (e instanceof ErroApi && (tipoP === 'reautenticacao-necessaria' || e.status === 401)) {
      erroSenha.value = t('acesso.rh.senhaErrada');
      senha.value = '';
      return;
    }
    dialogo.value = false;
    const codigo = (p as { codigo?: unknown } | null)?.codigo;
    recusa.value =
      codigo === 'efeito-pendente'
        ? t('acesso.rh.efeitoPendente', { detalhe: p?.detail ?? '' })
        : p?.detail || p?.title || t('acesso.rh.falha');
    await cliente.invalidateQueries({ queryKey: CHAVE_TAREFAS });
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="tela" aria-labelledby="rh-titulo">
    <h1 id="rh-titulo">{{ t('acesso.rh.titulo') }}</h1>
    <p>{{ t('acesso.rh.texto') }}</p>
    <MensagemErro v-if="tarefas.isError.value" :erro="tarefas.error.value" />
    <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="rh-aviso" />
    <SanteAlerta v-if="recusa" :texto="recusa" variante="aviso" anunciar data-testid="rh-recusa" />

    <template v-if="dados">
      <ul class="rh__parametros" data-testid="rh-parametros">
        <li>
          {{
            dados.parametros.suspenderAfastamento
              ? t('acesso.rh.suspenderLigada', { n: dados.parametros.diasMinimosAfastamento })
              : t('acesso.rh.suspenderDesligada')
          }}
        </li>
        <li>{{ t('acesso.rh.hoje', { data: data(dados.hoje) }) }}</li>
      </ul>
      <SanteAlerta
        v-if="!dados.bloqueio.ligada"
        :texto="t('acesso.rh.bloqueioDesligado', { motivo: dados.bloqueio.motivo ?? '' })"
        variante="aviso"
        data-testid="rh-bloqueio-desligado"
      />

      <section aria-labelledby="rh-abertas">
        <h2 id="rh-abertas">{{ t('acesso.rh.abertas', { n: dados.tarefas.length }) }}</h2>
        <p v-if="!dados.tarefas.length" data-testid="rh-tarefas-nenhuma">{{ t('acesso.rh.nenhuma') }}</p>
        <div v-else class="rh__rolagem">
          <table data-testid="rh-tarefas">
            <thead>
              <tr>
                <th scope="col">{{ t('acesso.rh.colTipo') }}</th>
                <th scope="col">{{ t('acesso.rh.colNome') }}</th>
                <th scope="col">{{ t('acesso.rh.colCargo') }}</th>
                <th scope="col">{{ t('acesso.rh.colSetor') }}</th>
                <th scope="col">{{ t('acesso.rh.colDesde') }}</th>
                <th scope="col">{{ t('acesso.rh.colUsuario') }}</th>
                <th scope="col">{{ t('acesso.rh.colPerfil') }}</th>
                <th scope="col">
                  <span class="oculto">{{ t('acesso.rh.colAcoes') }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="x in dados.tarefas"
                :key="chaveTarefa(x)"
                :data-testid="`rh-tarefa-${chaveTarefa(x)}`"
              >
                <td>{{ tipo(x.tipo) }}</td>
                <td>
                  {{ x.nome }}
                  <small v-if="x.detalhe.length" class="rh__detalhe">{{ x.detalhe.join(' · ') }}</small>
                </td>
                <td>{{ x.cargo }}</td>
                <td>{{ x.setor ?? '—' }}</td>
                <td>{{ data(x.desde) }}</td>
                <td>{{ x.login ?? '—' }}</td>
                <td>{{ x.perfilSugerido ?? t('acesso.rh.semSugestao') }}</td>
                <td class="rh__linha-acoes">
                  <RouterLink
                    v-if="x.tipo === 'criar-acesso'"
                    :to="caminhoCriar(x)"
                    :data-testid="`rh-criar-${chaveTarefa(x)}`"
                    >{{ t('acesso.rh.criarUsuario') }}</RouterLink
                  >
                  <RouterLink
                    v-else-if="x.login"
                    :to="`/administracao/acesso/usuarios/${encodeURIComponent(x.login)}`"
                    :data-testid="`rh-ficha-${chaveTarefa(x)}`"
                    >{{ t('acesso.rh.abrirFicha') }}</RouterLink
                  >
                  <SanteBotao
                    :rotulo="
                      x.tipo === 'suspender-acesso' ? t('acesso.rh.suspender') : t('acesso.rh.concluir')
                    "
                    variante="texto"
                    :desabilitado="x.tipo === 'suspender-acesso' && (!x.login || !dados.bloqueio.ligada)"
                    :data-testid="`rh-feita-${chaveTarefa(x)}`"
                    @acionar="abrirTarefa('feita', x)"
                  />
                  <SanteBotao
                    :rotulo="t('acesso.rh.dispensar')"
                    variante="texto"
                    :data-testid="`rh-dispensar-${chaveTarefa(x)}`"
                    @acionar="abrirTarefa('dispensada', x)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <details v-if="dados.resolvidas.length" class="rh__historico" data-testid="rh-resolvidas">
        <summary>{{ t('acesso.rh.resolvidas', { n: dados.resolvidas.length }) }}</summary>
        <ul>
          <li v-for="r in dados.resolvidas" :key="r.id">
            {{ quando(r.resolvidoEm) }} · {{ tipo(r.tipo) }} · {{ t(`acesso.rh.situacoes.${r.situacao}`) }}
            <template v-if="r.login"> · {{ r.login }}</template> · {{ r.resolvidoPor }} · {{ r.motivo }}
          </li>
        </ul>
      </details>
    </template>

    <section aria-labelledby="rh-mapa" class="rh__mapa">
      <h2 id="rh-mapa">{{ t('acesso.rh.mapaTitulo') }}</h2>
      <p>{{ t('acesso.rh.mapaTexto') }}</p>
      <MensagemErro v-if="mapa.isError.value" :erro="mapa.error.value" />
      <template v-if="dadosMapa">
        <SanteBotao
          :rotulo="t('acesso.rh.incluirCargo')"
          variante="secundario"
          data-testid="rh-cargo-incluir"
          @acionar="abrirCargo('cargo')"
        />
        <p v-if="!vigentes.length" data-testid="rh-mapa-nenhum">{{ t('acesso.rh.mapaNenhum') }}</p>
        <div v-else class="rh__rolagem">
          <table data-testid="rh-mapa">
            <thead>
              <tr>
                <th scope="col">{{ t('acesso.rh.colCargo') }}</th>
                <th scope="col">{{ t('acesso.rh.colPerfil') }}</th>
                <th scope="col">
                  <span class="oculto">{{ t('acesso.rh.colAcoes') }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="[c, p] in vigentes" :key="c" :data-testid="`rh-cargo-${c}`">
                <td>{{ c }}</td>
                <td>{{ p }}</td>
                <td class="rh__linha-acoes">
                  <SanteBotao
                    :rotulo="t('acesso.rh.trocarPerfil')"
                    variante="texto"
                    :data-testid="`rh-cargo-trocar-${c}`"
                    @acionar="abrirCargo('cargo', c, p)"
                  />
                  <SanteBotao
                    :rotulo="t('acesso.rh.retirarCargo')"
                    variante="texto"
                    :data-testid="`rh-cargo-retirar-${c}`"
                    @acionar="abrirCargo('retirar-cargo', c)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <details v-if="dadosMapa.historico.length" class="rh__historico" data-testid="rh-mapa-historico">
          <summary>{{ t('acesso.rh.mapaHistorico', { n: dadosMapa.historico.length }) }}</summary>
          <ul>
            <li v-for="h in dadosMapa.historico" :key="h.id">
              {{ quando(h.criadoEm) }} · {{ h.cargo }} ·
              {{ h.situacao === 'vigente' ? (h.perfil ?? '—') : t('acesso.rh.retirado') }} ·
              {{ h.criadoPor }} ·
              {{ h.motivo }}
            </li>
          </ul>
        </details>
      </template>
    </section>

    <SanteDialogo v-model:visivel="dialogo" :titulo="titulo">
      <form class="rh__form" data-testid="rh-form" @submit.prevent="confirmar">
        <template v-if="acao === 'cargo'">
          <SanteSelecao
            v-model="cargo"
            :rotulo="t('acesso.rh.colCargo')"
            :opcoes="opcoesCargo"
            busca
            obrigatorio
            data-testid="rh-cargo"
          />
          <SanteSelecao
            v-model="perfil"
            :rotulo="t('acesso.rh.colPerfil')"
            :opcoes="opcoesPerfil"
            busca
            obrigatorio
            data-testid="rh-perfil"
          />
        </template>
        <p v-else-if="acao === 'retirar-cargo'">{{ t('acesso.rh.textoRetirarCargo') }}</p>
        <template v-else-if="tarefa">
          <p v-if="acao === 'feita' && tarefa.tipo === 'suspender-acesso'">
            {{ t('acesso.rh.textoSuspender', { login: tarefa.login ?? '' }) }}
          </p>
          <SanteCampoTexto
            v-if="pedeLogin"
            v-model="login"
            :rotulo="t('acesso.rh.campoLogin')"
            :max-bytes="20"
            data-testid="rh-login"
          />
        </template>
        <SanteCampoTexto
          v-model="motivo"
          :rotulo="t('acesso.rh.campoMotivo')"
          :max-bytes="200"
          data-testid="rh-motivo"
        />
        <SanteAlerta
          v-if="erroSenha"
          :texto="erroSenha"
          variante="aviso"
          anunciar
          data-testid="rh-senha-erro"
        />
        <SenhaConfirmacao v-model="senha" testid="rh-senha" />
        <div class="rh__botoes">
          <SanteBotao :rotulo="t('adm.comum.cancelar')" variante="texto" @acionar="dialogo = false" />
          <SanteBotao
            :rotulo="ocupado ? t('acesso.rh.gravando') : t('acesso.rh.gravar')"
            tipo="submit"
            :desabilitado="!pronto"
            data-testid="rh-confirmar"
          />
        </div>
      </form>
    </SanteDialogo>
  </section>
</template>

<style scoped>
.rh__parametros {
  margin: var(--sgh-espaco-2) 0;
}
.rh__linha-acoes,
.rh__botoes {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sgh-espaco-2);
}
.rh__botoes {
  justify-content: flex-end;
  margin-top: var(--sgh-espaco-2);
}
.rh__rolagem {
  overflow-x: auto;
}
.rh__detalhe {
  display: block;
  color: var(--sgh-texto-suave, inherit);
}
.rh__mapa,
.rh__historico {
  margin-top: var(--sgh-espaco-3, 1.5rem);
}
table {
  border-collapse: collapse;
  width: 100%;
  margin: var(--sgh-espaco-2) 0;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
.rh__form {
  display: grid;
  gap: var(--sgh-espaco-2);
}
</style>
