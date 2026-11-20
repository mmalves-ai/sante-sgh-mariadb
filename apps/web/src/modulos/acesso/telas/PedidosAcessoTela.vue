<script setup lang="ts">
// W1-01 (parte 10c): "Pedidos de acesso" (/administracao/acesso/pedidos), gestor de acessos. Lista os pedidos do
// estabelecimento (em andamento primeiro) com o nível que cada um espera; aprovar ou recusar (motivo obrigatório na
// recusa) com a senha em diálogo. O 1º e o 2º nível são de pessoas diferentes e ninguém decide o próprio pedido
// (D-W101-34: sem cadastro de gestor de setor, o 1º nível também cabe a um gestor de acessos). Aprovado o 2º nível, o
// perfil sai concedido do primeiro ao último dia pedido e expira sozinho.
import type { PedidoAcessoTela } from '@sgh/contratos';
import { tipoDoProblema } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import MensagemErro from '../../../casca/MensagemErro.vue';
import SenhaConfirmacao from '../../administracao/componentes/SenhaConfirmacao.vue';
import { buscarPedidosAcessoGestao, concederPedidoAcesso, decidirPedidoAcesso } from '../api-gestao.js';

const { t } = useI18n();
const cliente = useQueryClient();
const CHAVE = ['acesso', 'pedidos-gestao'] as const;
const consulta = useQuery({ queryKey: CHAVE, queryFn: () => buscarPedidosAcessoGestao() });
const dados = computed(() => consulta.data.value ?? null);

const filtro = ref<'andamento' | 'todos' | null>('andamento');
const opcoesFiltro = computed(() =>
  (['andamento', 'todos'] as const).map((v) => ({ valor: v, rotulo: t(`acesso.pedidos.filtros.${v}`) })),
);
/** Revisão: aprovado nos dois níveis e sem concessão (preso): a gestão concede o perfil. */
const semConcessao = (p: PedidoAcessoTela) => p.situacao === 'aprovado' && !p.concessao;
const lista = computed(() =>
  (dados.value?.pedidos ?? []).filter((p) => filtro.value === 'todos' || p.nivel !== null || semConcessao(p)),
);

const dialogo = ref(false);
const modo = ref<'decidir' | 'conceder'>('decidir');
const alvo = ref<PedidoAcessoTela | null>(null);
const decisao = ref<'aprovar' | 'recusar' | null>('aprovar');
const motivo = ref('');
const senha = ref('');
const erroSenha = ref('');
const aviso = ref('');
const recusa = ref('');
const ocupado = ref(false);

watch(dialogo, (v) => {
  if (!v) {
    senha.value = '';
    erroSenha.value = '';
  }
});

const opcoesDecisao = computed(() =>
  (['aprovar', 'recusar'] as const).map((v) => ({ valor: v, rotulo: t(`acesso.pedidos.decisoes.${v}`) })),
);
const nomeSetor = (codigo: string) => dados.value?.setores.find((s) => s.valor === codigo)?.rotulo ?? codigo;
const data = (iso: string | null) =>
  iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : '—';
const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR') : '—');
const situacaoDe = (p: PedidoAcessoTela) =>
  p.nivel
    ? t(`acesso.pedidos.aguarda.${p.nivel}`)
    : semConcessao(p)
      ? t('acesso.pedidos.semConcessao')
      : t(`acesso.pedidos.situacoes.${p.situacao}`);
const andamentoDe = (p: PedidoAcessoTela) => {
  const partes: string[] = [];
  if (p.setorPor) partes.push(t('acesso.pedidos.nivel1Por', { por: p.setorPor, em: quando(p.setorEm) }));
  if (p.acessosPor)
    partes.push(t('acesso.pedidos.nivel2Por', { por: p.acessosPor, em: quando(p.acessosEm) }));
  if (p.fechadoPor)
    partes.push(
      t('acesso.pedidos.fechadoPor', {
        por: p.fechadoPor,
        em: quando(p.fechadoEm),
        motivo: p.motivoFechamento ?? '',
      }),
    );
  return partes.join(' · ') || '—';
};

const motivoOk = computed(() => decisao.value === 'aprovar' || motivo.value.trim().length >= 10);
const pronto = computed(
  () =>
    !ocupado.value &&
    !!alvo.value &&
    senha.value.length > 0 &&
    (modo.value === 'conceder' || (!!decisao.value && motivoOk.value)),
);

function abrirConceder(p: PedidoAcessoTela) {
  modo.value = 'conceder';
  alvo.value = p;
  aviso.value = '';
  recusa.value = '';
  dialogo.value = true;
}

function abrirDecisao(p: PedidoAcessoTela, d: 'aprovar' | 'recusar') {
  modo.value = 'decidir';
  alvo.value = p;
  decisao.value = d;
  motivo.value = '';
  aviso.value = '';
  recusa.value = '';
  dialogo.value = true;
}

async function confirmar(): Promise<void> {
  if (!pronto.value || !alvo.value) return;
  ocupado.value = true;
  erroSenha.value = '';
  const p = alvo.value;
  try {
    const r =
      modo.value === 'conceder'
        ? await concederPedidoAcesso(p.id, { senha: senha.value })
        : await decidirPedidoAcesso(p.id, {
            decisao: decisao.value ?? 'aprovar',
            motivo: motivo.value.trim(),
            senha: senha.value,
          });
    aviso.value =
      r.situacao === 'concedido'
        ? t('acesso.pedidos.concedidoAviso', { login: p.login, perfil: p.perfil, fim: data(p.fim) })
        : r.situacao === 'recusado'
          ? t('acesso.pedidos.recusadoAviso', { login: p.login })
          : t('acesso.pedidos.aprovadoAviso', { login: p.login });
    dialogo.value = false;
    await cliente.invalidateQueries({ queryKey: CHAVE });
  } catch (e) {
    const pr = e instanceof ErroApi ? e.problema : null;
    const tipoP = pr ? tipoDoProblema(pr) : null;
    if (e instanceof ErroApi && (tipoP === 'reautenticacao-necessaria' || e.status === 401)) {
      erroSenha.value = t('acesso.pedidos.senhaErrada');
      senha.value = '';
      return;
    }
    dialogo.value = false;
    const codigo = (pr as { codigo?: unknown } | null)?.codigo;
    const detalheP = pr?.detail || pr?.title || '';
    recusa.value =
      codigo === 'efeito-pendente'
        ? t('acesso.pedidos.efeitoPendente', { detalhe: detalheP })
        : detalheP || t('acesso.pedidos.falha');
    await cliente.invalidateQueries({ queryKey: CHAVE });
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="tela" aria-labelledby="pg-titulo">
    <h1 id="pg-titulo">{{ t('acesso.pedidos.gestaoTitulo') }}</h1>
    <p>{{ t('acesso.pedidos.gestaoTexto') }}</p>
    <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
    <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="pg-aviso" />
    <SanteAlerta v-if="recusa" :texto="recusa" variante="aviso" anunciar data-testid="pg-recusa" />

    <template v-if="dados">
      <p v-if="dados.setorSemGestor" data-testid="pg-sem-gestor">{{ t('acesso.pedidos.semGestorSetor') }}</p>
      <SanteSelecao
        v-model="filtro"
        :rotulo="t('acesso.pedidos.campoFiltro')"
        :opcoes="opcoesFiltro"
        data-testid="pg-filtro"
      />
      <section aria-labelledby="pg-lista">
        <h2 id="pg-lista">{{ t('acesso.pedidos.gestaoLista', { n: lista.length }) }}</h2>
        <p v-if="!lista.length" data-testid="pg-nenhum">{{ t('acesso.pedidos.nenhum') }}</p>
        <div v-else class="ped__rolagem">
          <table data-testid="pg-pedidos">
            <thead>
              <tr>
                <th scope="col">{{ t('acesso.pedidos.colLogin') }}</th>
                <th scope="col">{{ t('acesso.pedidos.colPerfil') }}</th>
                <th scope="col">{{ t('acesso.pedidos.colSetor') }}</th>
                <th scope="col">{{ t('acesso.pedidos.colPeriodo') }}</th>
                <th scope="col">{{ t('acesso.pedidos.colMotivo') }}</th>
                <th scope="col">{{ t('acesso.pedidos.colSituacao') }}</th>
                <th scope="col">{{ t('acesso.pedidos.colAndamento') }}</th>
                <th scope="col">
                  <span class="oculto">{{ t('acesso.pedidos.colAcoes') }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in lista" :key="p.id" :data-testid="`pg-pedido-${p.id}`">
                <td>{{ p.login }}</td>
                <td>{{ p.perfil }}</td>
                <td>{{ nomeSetor(p.setor) }}</td>
                <td>{{ t('acesso.pedidos.periodo', { inicio: data(p.inicio), fim: data(p.fim) }) }}</td>
                <td>{{ p.motivo }}</td>
                <td>{{ situacaoDe(p) }}</td>
                <td>{{ andamentoDe(p) }}</td>
                <td class="ped__linha-acoes">
                  <template v-if="p.nivel">
                    <SanteBotao
                      :rotulo="t('acesso.pedidos.decisoes.aprovar')"
                      variante="texto"
                      :data-testid="`pg-aprovar-${p.id}`"
                      @acionar="abrirDecisao(p, 'aprovar')"
                    />
                    <SanteBotao
                      :rotulo="t('acesso.pedidos.decisoes.recusar')"
                      variante="texto"
                      :data-testid="`pg-recusar-${p.id}`"
                      @acionar="abrirDecisao(p, 'recusar')"
                    />
                  </template>
                  <SanteBotao
                    v-else-if="semConcessao(p)"
                    :rotulo="t('acesso.pedidos.conceder')"
                    variante="texto"
                    :data-testid="`pg-conceder-${p.id}`"
                    @acionar="abrirConceder(p)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>

    <SanteDialogo
      v-model:visivel="dialogo"
      :titulo="
        t(modo === 'conceder' ? 'acesso.pedidos.dialogoConceder' : 'acesso.pedidos.dialogoDecidir', {
          login: alvo?.login ?? '',
          perfil: alvo?.perfil ?? '',
        })
      "
    >
      <form class="ped__form" data-testid="pg-form" @submit.prevent="confirmar">
        <p v-if="alvo && modo === 'conceder'" data-testid="pg-texto-conceder">
          {{ t('acesso.pedidos.textoConceder', { inicio: data(alvo.inicio), fim: data(alvo.fim) }) }}
        </p>
        <p v-else-if="alvo">
          {{
            t(`acesso.pedidos.textoDecidir.${alvo.nivel ?? 'setor'}`, {
              inicio: data(alvo.inicio),
              fim: data(alvo.fim),
            })
          }}
        </p>
        <SanteSelecao
          v-if="modo === 'decidir'"
          v-model="decisao"
          :rotulo="t('acesso.pedidos.campoDecisao')"
          :opcoes="opcoesDecisao"
          obrigatorio
          data-testid="pg-decisao"
        />
        <SanteCampoTexto
          v-if="modo === 'decidir'"
          v-model="motivo"
          :rotulo="
            decisao === 'recusar' ? t('acesso.pedidos.campoMotivo') : t('acesso.pedidos.campoMotivoOpcional')
          "
          :max-bytes="200"
          data-testid="pg-motivo"
        />
        <SanteAlerta
          v-if="erroSenha"
          :texto="erroSenha"
          variante="aviso"
          anunciar
          data-testid="pg-senha-erro"
        />
        <SenhaConfirmacao v-model="senha" testid="pg-senha" />
        <div class="ped__botoes">
          <SanteBotao :rotulo="t('adm.comum.cancelar')" variante="texto" @acionar="dialogo = false" />
          <SanteBotao
            :rotulo="ocupado ? t('acesso.pedidos.gravando') : t('acesso.pedidos.gravar')"
            tipo="submit"
            :desabilitado="!pronto"
            data-testid="pg-confirmar"
          />
        </div>
      </form>
    </SanteDialogo>
  </section>
</template>

<style scoped>
.ped__botoes,
.ped__linha-acoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  margin: var(--sgh-espaco-2) 0;
}
.ped__botoes {
  justify-content: flex-end;
}
.ped__rolagem {
  overflow-x: auto;
}
table {
  border-collapse: collapse;
  width: 100%;
  margin-bottom: var(--sgh-espaco-2);
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
.ped__form {
  display: grid;
  gap: var(--sgh-espaco-2);
}
</style>
