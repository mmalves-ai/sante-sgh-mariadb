<script setup lang="ts">
// Transferência, baixa e inventário de bens (M54, etapa 6; item `Controladoria > Patrimônio > Transferência, baixa e
// inventário de bens`; `patrimonio.movimento.ler`): as transferências aguardando aceite (quem recebe aceita ou recusa
// com o motivo, `patrimonio.movimento.aceitar`; quem pediu cancela; D-ACEITE-546), o registro de transferência,
// empréstimo, comodato (com o contrato) e devolução (`patrimonio.movimento.registrar`; o bem lido pelo QR ou pela
// plaqueta, com a versão), o histórico por situação e o caminho para o inventário pelo celular. A baixa fica na ficha do
// bem (permissão e senha próprias). O servidor confere tudo de novo.
import {
  type BemPatrimonial,
  type MovimentoBem,
  SITUACOES_MOVIMENTO_BEM,
  type SituacaoMovimentoBem,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteOpcoes, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import MensagemErro from '../../casca/MensagemErro.vue';
import {
  cancelarMovimento,
  decidirMovimento,
  type EntradaMovimento,
  lerApoioPatrimonio,
  lerBem,
  lerBemPorCodigo,
  lerMovimentos,
  registrarMovimento,
} from './api-patrimonio.js';
import { dataBr, hojeLocal, instante, rotuloCentro } from './comum-patrimonio.js';
import ErroPatrimonio from './ErroPatrimonio.vue';

type Aba = 'pendentes' | 'registrar' | 'historico';
const props = defineProps<{ hoje?: string }>();
const { t } = useI18n();
const rota = useRoute();
const cliente = useQueryClient();
const hoje = computed(() => props.hoje ?? hojeLocal());

const apoio = useQuery({
  queryKey: ['patrimonio', 'apoio', 'movimentos'],
  queryFn: () => lerApoioPatrimonio('movimentos'),
});
const a = computed(() => apoio.data.value ?? null);
const aba = ref<Aba>('pendentes');
const abas = computed(() =>
  (['pendentes', 'registrar', 'historico'] as const).filter(
    (x) => x !== 'registrar' || a.value?.acoes.registrar,
  ),
);
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);

// ── Pendentes: aceitar, recusar, cancelar ───────────────────────────────────────────────────────────────────────────
const pendentes = useQuery({
  queryKey: ['patrimonio', 'movimentos', 'pendente'],
  queryFn: () => lerMovimentos({ situacao: 'pendente' }),
});
const decidindo = ref<{ id: number; acao: 'recusar' | 'cancelar' } | null>(null);
const motivo = ref('');
async function agir(m: MovimentoBem, acao: 'aceitar' | 'recusar' | 'cancelar') {
  ocupado.value = true;
  erro.value = null;
  mensagem.value = null;
  try {
    if (acao === 'cancelar') {
      await cancelarMovimento(m.id, { motivo: motivo.value.trim(), versao: m.versao });
      mensagem.value = t('patrimonio.movimentos.cancelado');
    } else {
      await decidirMovimento(m.id, {
        aceitar: acao === 'aceitar',
        motivo: motivo.value.trim() || null,
        versao: m.versao,
      });
      mensagem.value = t(`patrimonio.movimentos.${acao === 'aceitar' ? 'aceito' : 'recusado'}`);
    }
    decidindo.value = null;
    motivo.value = '';
    await cliente.invalidateQueries({ queryKey: ['patrimonio'] });
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}

// ── Registrar ───────────────────────────────────────────────────────────────────────────────────────────────────────
type TipoRegistro = EntradaMovimento['tipo'];
const codigo = ref('');
const bem = ref<BemPatrimonial | null>(null);
const erroBem = ref<unknown>(null);
async function buscarBem() {
  erroBem.value = null;
  try {
    bem.value = await lerBemPorCodigo(codigo.value.trim());
    ajustarTipo();
  } catch (e) {
    bem.value = null;
    erroBem.value = e;
  }
}
const tipo = ref<TipoRegistro>('transferencia');
const tiposPossiveis = computed<TipoRegistro[]>(() =>
  bem.value?.situacao === 'emprestado' ? ['devolucao'] : ['transferencia', 'emprestimo', 'comodato'],
);
function ajustarTipo() {
  if (!tiposPossiveis.value.includes(tipo.value)) tipo.value = tiposPossiveis.value[0]!;
}
const f = ref({
  data: hoje.value as string | null,
  motivo: '',
  destino: null as number | null,
  destinoResponsavel: '',
  terceiro: '',
  retornoPrevisto: null as string | null,
  termoNumero: '',
});
const opcoesDestino = computed(() =>
  (a.value?.centros ?? [])
    .filter((c) => c.ativo && c.id !== bem.value?.centro.id)
    .map((c) => ({ valor: c.id as number | null, rotulo: rotuloCentro(c) })),
);
const pronto = computed(() => {
  if (!bem.value || !f.value.data || !f.value.motivo.trim()) return false;
  if (tipo.value === 'transferencia') return f.value.destino !== null;
  if (tipo.value === 'emprestimo') return f.value.terceiro.trim() !== '';
  if (tipo.value === 'comodato') return f.value.terceiro.trim() !== '' && f.value.termoNumero.trim() !== '';
  return true;
});
function corpo(): EntradaMovimento | null {
  const b = bem.value;
  if (!b || !f.value.data) return null;
  const base = { bem: b.id, versao: b.versao, data: f.value.data, motivo: f.value.motivo.trim() };
  if (tipo.value === 'transferencia')
    return {
      tipo: 'transferencia',
      ...base,
      destino: f.value.destino ?? 0,
      destinoResponsavel: f.value.destinoResponsavel.trim() || null,
    };
  if (tipo.value === 'emprestimo' || tipo.value === 'comodato')
    return {
      tipo: tipo.value,
      ...base,
      terceiro: f.value.terceiro.trim(),
      retornoPrevisto: f.value.retornoPrevisto,
      termoNumero: f.value.termoNumero.trim() || null,
    };
  return { tipo: 'devolucao', ...base };
}
async function registrar() {
  const c = corpo();
  if (!c || !pronto.value) return;
  ocupado.value = true;
  erro.value = null;
  mensagem.value = null;
  try {
    const r = await registrarMovimento(c);
    mensagem.value = t('patrimonio.movimentos.registrado', {
      tipo: t(`patrimonio.tiposMovimento.${r.movimento.tipo}`),
    });
    bem.value = r.bem;
    f.value = {
      ...f.value,
      motivo: '',
      destino: null,
      destinoResponsavel: '',
      terceiro: '',
      termoNumero: '',
    };
    ajustarTipo();
    await cliente.invalidateQueries({ queryKey: ['patrimonio'] });
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}
// Da ficha do bem: `?bem=<id>` abre o registro com o bem escolhido.
const daRota = Number(rota?.query?.['bem']);
if (Number.isInteger(daRota) && daRota > 0) {
  aba.value = 'registrar';
  void lerBem(daRota)
    .then((b) => {
      bem.value = b;
      ajustarTipo();
    })
    .catch((e: unknown) => (erroBem.value = e));
}

// ── Histórico ───────────────────────────────────────────────────────────────────────────────────────────────────────
const situacao = ref<SituacaoMovimentoBem | null>(null);
const historico = useQuery({
  queryKey: computed(() => ['patrimonio', 'movimentos', 'historico', situacao.value]),
  queryFn: () => lerMovimentos({ situacao: situacao.value }),
  enabled: computed(() => aba.value === 'historico'),
});
const opcoesSituacao = computed(() => [
  { valor: null as SituacaoMovimentoBem | null, rotulo: t('patrimonio.todas') },
  ...SITUACOES_MOVIMENTO_BEM.map((s) => ({
    valor: s as SituacaoMovimentoBem | null,
    rotulo: t(`patrimonio.situacoesMovimento.${s}`),
  })),
]);
const para = (m: MovimentoBem) => (m.destino ? rotuloCentro(m.destino) : m.terceiro ? m.terceiro : '—');
</script>

<template>
  <section class="tela-patrimonio" aria-labelledby="mov-titulo" data-testid="tela-movimentos">
    <h1 id="mov-titulo">{{ t('patrimonio.movimentos.titulo') }}</h1>
    <p>{{ t('patrimonio.movimentos.descricao') }}</p>
    <MensagemErro v-if="apoio.isError.value" :erro="apoio.error.value" />
    <p v-else-if="!a" role="status">{{ t('patrimonio.carregando') }}</p>
    <template v-else>
      <SanteAlerta
        v-if="!a.liberacao.ligada"
        :texto="t('patrimonio.desligado')"
        variante="info"
        data-testid="patrimonio-desligado"
      />
      <RouterLink v-if="a.acoes.contar" to="/patrimonio/inventario" data-testid="mov-ir-inventario">{{
        t('patrimonio.movimentos.irInventario')
      }}</RouterLink>
      <div class="acoes" role="tablist">
        <SanteBotao
          v-for="x in abas"
          :key="x"
          role="tab"
          :aria-selected="aba === x"
          :variante="aba === x ? 'primario' : 'secundario'"
          :rotulo="t(`patrimonio.movimentos.abas.${x}`)"
          :data-testid="`mov-aba-${x}`"
          @acionar="aba = x"
        />
      </div>
      <p v-if="mensagem" role="status" class="ok" data-testid="mov-mensagem">{{ mensagem }}</p>
      <ErroPatrimonio v-if="erro" :erro="erro" />

      <section
        v-if="aba === 'pendentes'"
        class="bloco"
        aria-labelledby="mov-pend-titulo"
        data-testid="mov-pendentes"
      >
        <h2 id="mov-pend-titulo">{{ t('patrimonio.movimentos.abas.pendentes') }}</h2>
        <MensagemErro v-if="pendentes.isError.value" :erro="pendentes.error.value" />
        <p v-else-if="!pendentes.data.value" role="status">{{ t('patrimonio.carregando') }}</p>
        <p v-else-if="pendentes.data.value.length === 0" data-testid="mov-sem-pendentes">
          {{ t('patrimonio.movimentos.nenhumPendente') }}
        </p>
        <ul v-else class="cartoes">
          <li v-for="m in pendentes.data.value" :key="m.id" class="bloco" :data-testid="`pendente-${m.id}`">
            <strong>{{ m.bem.plaqueta }}: {{ m.bem.descricao }}</strong>
            <span>{{ `${rotuloCentro(m.origem)} → ${para(m)}` }}</span>
            <span class="secundario">{{ dataBr(m.data) }}: {{ m.motivo }}</span>
            <span class="secundario">{{
              t('patrimonio.movimentos.solicitado', { por: m.solicitadoPor, em: instante(m.solicitadoEm) })
            }}</span>
            <div v-if="decidindo?.id === m.id" class="campos">
              <SanteCampoTexto
                v-model="motivo"
                :rotulo="
                  decidindo.acao === 'recusar'
                    ? t('patrimonio.movimentos.motivoRecusa')
                    : t('patrimonio.movimentos.motivoCancelamento')
                "
                :max-bytes="400"
                obrigatorio
                :data-testid="`pendente-motivo-${m.id}`"
              />
              <SanteBotao
                :rotulo="
                  decidindo.acao === 'recusar'
                    ? t('patrimonio.movimentos.recusar')
                    : t('patrimonio.movimentos.cancelarPedido')
                "
                :desabilitado="ocupado || !motivo.trim()"
                :data-testid="`pendente-confirmar-${m.id}`"
                @acionar="agir(m, decidindo.acao)"
              />
              <SanteBotao variante="texto" :rotulo="t('patrimonio.voltar')" @acionar="decidindo = null" />
            </div>
            <div v-else class="acoes">
              <template v-if="a.acoes.aceitar">
                <SanteBotao
                  :rotulo="t('patrimonio.movimentos.aceitar')"
                  :desabilitado="ocupado"
                  :data-testid="`pendente-aceitar-${m.id}`"
                  @acionar="agir(m, 'aceitar')"
                />
                <SanteBotao
                  variante="secundario"
                  :rotulo="t('patrimonio.movimentos.recusar')"
                  :data-testid="`pendente-recusar-${m.id}`"
                  @acionar="
                    decidindo = { id: m.id, acao: 'recusar' };
                    motivo = '';
                  "
                />
              </template>
              <SanteBotao
                v-if="a.acoes.registrar"
                variante="texto"
                :rotulo="t('patrimonio.movimentos.cancelarPedido')"
                :data-testid="`pendente-cancelar-${m.id}`"
                @acionar="
                  decidindo = { id: m.id, acao: 'cancelar' };
                  motivo = '';
                "
              />
            </div>
          </li>
        </ul>
      </section>

      <section
        v-else-if="aba === 'registrar'"
        class="bloco"
        aria-labelledby="mov-reg-titulo"
        data-testid="mov-registrar"
      >
        <h2 id="mov-reg-titulo">{{ t('patrimonio.movimentos.abas.registrar') }}</h2>
        <form class="campos" @submit.prevent="buscarBem">
          <SanteCampoTexto
            v-model="codigo"
            :rotulo="t('patrimonio.movimentos.lerBem')"
            :max-bytes="80"
            data-testid="mov-codigo"
          />
          <SanteBotao
            tipo="submit"
            variante="secundario"
            :rotulo="t('patrimonio.movimentos.buscarBem')"
            data-testid="mov-buscar"
          />
        </form>
        <ErroPatrimonio v-if="erroBem" :erro="erroBem" />
        <template v-if="bem">
          <p data-testid="mov-bem">
            {{
              t('patrimonio.movimentos.bemAchado', {
                plaqueta: bem.plaqueta,
                descricao: bem.descricao,
                setor: rotuloCentro(bem.centro),
                situacao: t(`patrimonio.situacoesBem.${bem.situacao}`),
              })
            }}
          </p>
          <SanteAlerta
            v-if="bem.situacao === 'baixado'"
            :texto="t('patrimonio.recusas.baixado')"
            variante="aviso"
          />
          <SanteAlerta
            v-else-if="bem.movimentoPendente"
            :texto="t('patrimonio.recusas.pendente')"
            variante="aviso"
            data-testid="mov-bem-pendente"
          />
          <form v-else class="bloco" @submit.prevent="registrar">
            <SanteOpcoes
              v-model="tipo"
              :legenda="t('patrimonio.movimentos.tipo')"
              :opcoes="tiposPossiveis.map((x) => ({ valor: x, rotulo: t(`patrimonio.tiposMovimento.${x}`) }))"
              nome="tipo-movimento"
              data-testid="mov-tipo"
            />
            <div class="campos">
              <SanteData
                v-model="f.data"
                :rotulo="t('patrimonio.data')"
                editavel
                :maximo="hoje"
                data-testid="mov-data"
              />
              <template v-if="tipo === 'transferencia'">
                <SanteSelecao
                  v-model="f.destino"
                  :rotulo="t('patrimonio.movimentos.destino')"
                  :opcoes="opcoesDestino"
                  busca
                  data-testid="mov-destino"
                />
                <SanteCampoTexto
                  v-model="f.destinoResponsavel"
                  :rotulo="t('patrimonio.movimentos.destinoResponsavel')"
                  :max-bytes="80"
                  data-testid="mov-destino-responsavel"
                />
              </template>
              <template v-else-if="tipo === 'emprestimo' || tipo === 'comodato'">
                <SanteCampoTexto
                  v-model="f.terceiro"
                  :rotulo="t('patrimonio.movimentos.terceiro')"
                  :max-bytes="120"
                  obrigatorio
                  data-testid="mov-terceiro"
                />
                <SanteData
                  v-model="f.retornoPrevisto"
                  :rotulo="t('patrimonio.movimentos.retornoPrevisto')"
                  editavel
                  data-testid="mov-retorno"
                />
                <SanteCampoTexto
                  v-model="f.termoNumero"
                  :rotulo="
                    tipo === 'comodato'
                      ? t('patrimonio.movimentos.termoComodato')
                      : t('patrimonio.movimentos.termoEmprestimo')
                  "
                  :max-bytes="40"
                  :obrigatorio="tipo === 'comodato'"
                  data-testid="mov-termo"
                />
              </template>
              <SanteCampoTexto
                v-model="f.motivo"
                :rotulo="t('patrimonio.motivo')"
                :max-bytes="400"
                multilinha
                obrigatorio
                data-testid="mov-motivo"
              />
            </div>
            <p v-if="tipo === 'transferencia'" class="secundario">
              {{ t('patrimonio.movimentos.pendenteAviso') }}
            </p>
            <p class="secundario">{{ t('patrimonio.movimentos.baixaNaFicha') }}</p>
            <div class="acoes">
              <SanteBotao
                tipo="submit"
                :rotulo="t('patrimonio.gravar')"
                :desabilitado="ocupado || !pronto"
                data-testid="mov-gravar"
              />
            </div>
          </form>
        </template>
      </section>

      <section v-else class="bloco" aria-labelledby="mov-hist-titulo" data-testid="mov-historico">
        <h2 id="mov-hist-titulo">{{ t('patrimonio.movimentos.abas.historico') }}</h2>
        <div class="campos">
          <SanteSelecao
            v-model="situacao"
            :rotulo="t('patrimonio.movimentos.situacao')"
            :opcoes="opcoesSituacao"
            data-testid="mov-hist-situacao"
          />
        </div>
        <MensagemErro v-if="historico.isError.value" :erro="historico.error.value" />
        <p v-else-if="!historico.data.value" role="status">{{ t('patrimonio.carregando') }}</p>
        <p v-else-if="historico.data.value.length === 0">{{ t('patrimonio.movimentos.nenhum') }}</p>
        <div v-else class="rolagem">
          <table class="tabela" data-testid="tabela-movimentos">
            <thead>
              <tr>
                <th scope="col">{{ t('patrimonio.data') }}</th>
                <th scope="col">{{ t('patrimonio.movimentos.bem') }}</th>
                <th scope="col">{{ t('patrimonio.movimentos.tipo') }}</th>
                <th scope="col">{{ t('patrimonio.movimentos.origem') }}</th>
                <th scope="col">{{ t('patrimonio.movimentos.destino') }}</th>
                <th scope="col">{{ t('patrimonio.movimentos.situacao') }}</th>
                <th scope="col">{{ t('patrimonio.movimentos.termo') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in historico.data.value" :key="m.id" :data-testid="`movimento-${m.id}`">
                <td>{{ dataBr(m.data) }}</td>
                <td>{{ m.bem.plaqueta }}: {{ m.bem.descricao }}</td>
                <td>{{ t(`patrimonio.tiposMovimento.${m.tipo}`) }}</td>
                <td>{{ rotuloCentro(m.origem) }}</td>
                <td>{{ para(m) }}</td>
                <td>
                  {{ t(`patrimonio.situacoesMovimento.${m.situacao}`) }}
                  <span v-if="m.decididoPor" class="secundario">
                    ({{
                      t('patrimonio.movimentos.decidido', { por: m.decididoPor, em: instante(m.decididoEm) })
                    }})
                  </span>
                </td>
                <td>{{ m.termoNumero ?? '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </section>
</template>

<style scoped src="./estilo-patrimonio.css"></style>
<style scoped>
.cartoes {
  display: grid;
  gap: 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
</style>
