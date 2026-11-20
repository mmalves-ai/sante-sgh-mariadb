<script setup lang="ts">
// W1-01 (parte 10c): "Meus pedidos de acesso" (/preferencias/pedidos-acesso). A própria pessoa pede um perfil
// (perfil, setor por combo com busca, primeiro e último dia, motivo), acompanha os dois níveis de aprovação e cancela
// o próprio pedido antes da concessão (motivo e senha em diálogo). Aprovado o 2º nível, o perfil fica concedido até o
// último dia e expira sozinho. A tela "Sem permissão" abre esta com ?novo=1 (o formulário já aberto).
import type { PedidoAcessoTela } from '@sgh/contratos';
import { PERMISSOES_ACESSO, tipoDoProblema } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import SenhaConfirmacao from '../../administracao/componentes/SenhaConfirmacao.vue';
import { buscarMeusPedidosAcesso, cancelarPedidoAcesso, pedirAcesso } from '../api-gestao.js';

const { t } = useI18n();
const rota = useRoute();
const cliente = useQueryClient();
const { permissoes } = usarSessao();
const podePedir = computed(() => permissoes.value.has(PERMISSOES_ACESSO.preferenciaEditar));
const CHAVE = ['acesso', 'meus-pedidos'] as const;
const consulta = useQuery({ queryKey: CHAVE, queryFn: () => buscarMeusPedidosAcesso() });
const dados = computed(() => consulta.data.value ?? null);

const dialogo = ref(false);
const acao = ref<'pedir' | 'cancelar'>('pedir');
const alvo = ref<PedidoAcessoTela | null>(null);
const perfil = ref<string | null>(null);
const setor = ref<string | null>(null);
const inicio = ref('');
const fim = ref('');
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

const opcoesPerfil = computed(() => (dados.value?.perfis ?? []).map((p) => ({ valor: p, rotulo: p })));
const opcoesSetor = computed(() =>
  (dados.value?.setores ?? []).map((s) => ({ valor: s.valor, rotulo: `${s.rotulo} (${s.valor})` })),
);
const nomeSetor = (codigo: string) => dados.value?.setores.find((s) => s.valor === codigo)?.rotulo ?? codigo;

const data = (iso: string | null) =>
  iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : '—';
const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR') : '—');
const situacaoDe = (p: PedidoAcessoTela) => t(`acesso.pedidos.situacoes.${p.situacao}`);
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
  if (p.nivel) partes.push(t(`acesso.pedidos.aguarda.${p.nivel}`));
  return partes.join(' · ') || '—';
};
// Revisão (achado 2): 'aprovado' (concessão a caminho) não se cancela; só o que espera decisão.
const cancelavel = (p: PedidoAcessoTela) => p.nivel !== null;

const dia = /^\d{4}-\d{2}-\d{2}$/;
const motivoOk = computed(() => motivo.value.trim().length >= 10);
const periodoOk = computed(() => dia.test(inicio.value) && dia.test(fim.value) && fim.value >= inicio.value);
const pronto = computed(() => {
  if (ocupado.value || !motivoOk.value) return false;
  if (acao.value === 'cancelar') return !!alvo.value && senha.value.length > 0;
  return !!perfil.value && !!setor.value && periodoOk.value;
});

function limpar() {
  motivo.value = '';
  aviso.value = '';
  recusa.value = '';
}
function abrirPedir() {
  acao.value = 'pedir';
  perfil.value = null;
  setor.value = null;
  inicio.value = dados.value?.hoje ?? '';
  fim.value = '';
  limpar();
  dialogo.value = true;
}
function abrirCancelar(p: PedidoAcessoTela) {
  acao.value = 'cancelar';
  alvo.value = p;
  limpar();
  dialogo.value = true;
}

// Vindo da tela "Sem permissão" (?novo=1): abre o formulário assim que os perfis chegarem.
const pedidoAutomatico = ref(rota.query['novo'] === '1');
function abrirSeVeioDo403() {
  if (pedidoAutomatico.value && dados.value && podePedir.value) {
    pedidoAutomatico.value = false;
    abrirPedir();
  }
}
onMounted(abrirSeVeioDo403);
watch(dados, abrirSeVeioDo403);

async function confirmar(): Promise<void> {
  if (!pronto.value) return;
  ocupado.value = true;
  erroSenha.value = '';
  try {
    if (acao.value === 'pedir') {
      await pedirAcesso({
        perfil: perfil.value ?? '',
        setor: setor.value ?? '',
        inicio: inicio.value,
        fim: fim.value,
        motivo: motivo.value.trim(),
      });
      aviso.value = t('acesso.pedidos.pedidoAviso', { perfil: perfil.value ?? '' });
    } else {
      await cancelarPedidoAcesso(alvo.value?.id ?? '', { motivo: motivo.value.trim(), senha: senha.value });
      aviso.value = t('acesso.pedidos.canceladoAviso', { perfil: alvo.value?.perfil ?? '' });
    }
    dialogo.value = false;
    await cliente.invalidateQueries({ queryKey: CHAVE });
  } catch (e) {
    const p = e instanceof ErroApi ? e.problema : null;
    const tipoP = p ? tipoDoProblema(p) : null;
    if (
      acao.value === 'cancelar' &&
      e instanceof ErroApi &&
      (tipoP === 'reautenticacao-necessaria' || e.status === 401)
    ) {
      erroSenha.value = t('acesso.pedidos.senhaErrada');
      senha.value = '';
      return;
    }
    dialogo.value = false;
    recusa.value = p?.detail || p?.title || t('acesso.pedidos.falha');
    await cliente.invalidateQueries({ queryKey: CHAVE });
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="tela" aria-labelledby="mp-titulo">
    <h1 id="mp-titulo">{{ t('acesso.pedidos.meusTitulo') }}</h1>
    <p>{{ t('acesso.pedidos.meusTexto') }}</p>
    <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
    <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="mp-aviso" />
    <SanteAlerta v-if="recusa" :texto="recusa" variante="aviso" anunciar data-testid="mp-recusa" />

    <template v-if="dados">
      <div v-if="podePedir" class="ped__acoes">
        <SanteBotao
          :rotulo="t('acesso.pedidos.pedir')"
          :desabilitado="!dados.perfis.length"
          data-testid="mp-pedir"
          @acionar="abrirPedir"
        />
      </div>
      <p v-if="!dados.perfis.length" data-testid="mp-sem-perfis">{{ t('acesso.pedidos.semPerfis') }}</p>

      <section aria-labelledby="mp-lista">
        <h2 id="mp-lista">{{ t('acesso.pedidos.meus', { n: dados.pedidos.length }) }}</h2>
        <p v-if="!dados.pedidos.length" data-testid="mp-nenhum">{{ t('acesso.pedidos.nenhum') }}</p>
        <div v-else class="ped__rolagem">
          <table data-testid="mp-pedidos">
            <thead>
              <tr>
                <th scope="col">{{ t('acesso.pedidos.colPerfil') }}</th>
                <th scope="col">{{ t('acesso.pedidos.colSetor') }}</th>
                <th scope="col">{{ t('acesso.pedidos.colPeriodo') }}</th>
                <th scope="col">{{ t('acesso.pedidos.colSituacao') }}</th>
                <th scope="col">{{ t('acesso.pedidos.colAndamento') }}</th>
                <th scope="col">
                  <span class="oculto">{{ t('acesso.pedidos.colAcoes') }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in dados.pedidos" :key="p.id" :data-testid="`mp-pedido-${p.id}`">
                <td>{{ p.perfil }}</td>
                <td>{{ nomeSetor(p.setor) }}</td>
                <td>{{ t('acesso.pedidos.periodo', { inicio: data(p.inicio), fim: data(p.fim) }) }}</td>
                <td>{{ situacaoDe(p) }}</td>
                <td>{{ p.motivo }} · {{ andamentoDe(p) }}</td>
                <td>
                  <SanteBotao
                    v-if="podePedir && cancelavel(p)"
                    :rotulo="t('acesso.pedidos.cancelar')"
                    variante="texto"
                    :data-testid="`mp-cancelar-${p.id}`"
                    @acionar="abrirCancelar(p)"
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
        acao === 'pedir'
          ? t('acesso.pedidos.dialogoPedir')
          : t('acesso.pedidos.dialogoCancelar', { perfil: alvo?.perfil ?? '' })
      "
    >
      <form class="ped__form" data-testid="mp-form" @submit.prevent="confirmar">
        <template v-if="acao === 'pedir'">
          <SanteSelecao
            v-model="perfil"
            :rotulo="t('acesso.pedidos.campoPerfil')"
            :opcoes="opcoesPerfil"
            busca
            obrigatorio
            data-testid="mp-perfil"
          />
          <SanteSelecao
            v-model="setor"
            :rotulo="t('acesso.pedidos.campoSetor')"
            :opcoes="opcoesSetor"
            busca
            obrigatorio
            data-testid="mp-setor"
          />
          <div class="ped__datas">
            <div class="campo">
              <label for="mp-inicio">{{ t('acesso.pedidos.campoInicio') }}</label>
              <input id="mp-inicio" v-model="inicio" type="date" :min="dados?.hoje" data-testid="mp-inicio" />
            </div>
            <div class="campo">
              <label for="mp-fim">{{
                t('acesso.pedidos.campoFim', { n: dados?.periodoMaximoDias ?? 365 })
              }}</label>
              <input id="mp-fim" v-model="fim" type="date" :min="inicio" data-testid="mp-fim" />
            </div>
          </div>
          <p>{{ t('acesso.pedidos.textoPedir') }}</p>
        </template>
        <p v-else>{{ t('acesso.pedidos.textoCancelar') }}</p>
        <SanteCampoTexto
          v-model="motivo"
          :rotulo="t('acesso.pedidos.campoMotivo')"
          :max-bytes="200"
          data-testid="mp-motivo"
        />
        <template v-if="acao === 'cancelar'">
          <SanteAlerta
            v-if="erroSenha"
            :texto="erroSenha"
            variante="aviso"
            anunciar
            data-testid="mp-senha-erro"
          />
          <SenhaConfirmacao v-model="senha" testid="mp-senha" />
        </template>
        <div class="ped__botoes">
          <SanteBotao :rotulo="t('adm.comum.cancelar')" variante="texto" @acionar="dialogo = false" />
          <SanteBotao
            :rotulo="ocupado ? t('acesso.pedidos.gravando') : t('acesso.pedidos.gravar')"
            tipo="submit"
            :desabilitado="!pronto"
            data-testid="mp-confirmar"
          />
        </div>
      </form>
    </SanteDialogo>
  </section>
</template>

<style scoped>
.ped__acoes,
.ped__botoes,
.ped__datas {
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
.ped__form,
.campo {
  display: grid;
  gap: var(--sgh-espaco-2);
}
input {
  font: inherit;
  min-height: var(--sgh-alvo-minimo);
  max-width: 12rem;
}
</style>
