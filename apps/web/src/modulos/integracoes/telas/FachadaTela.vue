<script setup lang="ts">
// Painel de estado da fachada da API de integração da Hal-AI (M58, etapa 4; ficha, seção 7; regra 9). No
// estabelecimento ativo: a necessidade (DP-8), o estado (fachada, escrita, repasse), a prontidão para o UTF-8, o motor
// de ações em dois tempos, as superfícies com o escopo da chave de acesso, e as 78 operações do contrato com o modo, o
// motivo, as operações equivalentes do Sante SGH e o uso medido (filtro por superfície, modo e caminho). Configurar
// (integracao.fachada.configurar): um parâmetro por vez, com justificativa e a senha de novo; o servidor confere de
// novo e registra na trilha. As chaves de acesso ficam só no servidor.
import {
  MODOS_FACHADA,
  PARAMETROS_FACHADA,
  type OperacaoFachadaDescrita,
  type ParametroFachada,
  type SuperficieFachada,
  SUPERFICIES_FACHADA,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import { configurarFachada, lerPainelFachada } from '../api-fachada.js';

const { t } = useI18n();
const consulta = useQuery({ queryKey: ['integracoes', 'fachada'], queryFn: lerPainelFachada });
const painel = computed(() => consulta.data.value);
const instante = (d: string) => new Date(d).toLocaleString('pt-BR');

// ── Filtro das operações ──────────────────────────────────────────────────────────────────────────
const filtro = reactive({ superficie: '', modo: '', busca: '' });
const opcoesSuperficie = computed(() => [
  { valor: '', rotulo: t('fachada.filtros.todas') },
  ...SUPERFICIES_FACHADA.map((s) => ({ valor: s, rotulo: t(`fachada.superficies.${s}`) })),
]);
const opcoesModo = computed(() => [
  { valor: '', rotulo: t('fachada.filtros.todas') },
  ...MODOS_FACHADA.map((m) => ({ valor: m, rotulo: t(`fachada.modos.${m}`) })),
]);
const operacoes = computed<readonly OperacaoFachadaDescrita[]>(() => {
  const busca = filtro.busca.trim().toLowerCase();
  return (painel.value?.operacoes ?? []).filter(
    (o) =>
      (!filtro.superficie || o.superficie === filtro.superficie) &&
      (!filtro.modo || o.modo === filtro.modo) &&
      (!busca || o.caminho.toLowerCase().includes(busca)),
  );
});
const varianteModo = (m: string) => (m === 'servida' ? 'ok' : m === 'repassada' ? 'neutra' : 'falha');

// ── Configurar ────────────────────────────────────────────────────────────────────────────────────
const NOMES: Record<ParametroFachada, 'ligada' | 'escrita' | 'superficies' | 'destino'> = {
  [PARAMETROS_FACHADA.ligada]: 'ligada',
  [PARAMETROS_FACHADA.escrita]: 'escrita',
  [PARAMETROS_FACHADA.superficies]: 'superficies',
  [PARAMETROS_FACHADA.destino]: 'destino',
};
const opcoesParametro = computed(() =>
  (Object.keys(NOMES) as ParametroFachada[]).map((c) => ({
    valor: c,
    rotulo: t(`fachada.configurar.parametros.${NOMES[c]}`),
  })),
);
const pedido = reactive({
  chave: PARAMETROS_FACHADA.ligada as ParametroFachada,
  simNao: 'nao' as 'sim' | 'nao',
  superficies: [] as SuperficieFachada[],
  destino: '',
  justificativa: '',
  senha: '',
});
const nome = computed(() => NOMES[pedido.chave]);

function preencher(): void {
  const c = painel.value?.configuracao;
  if (!c) return;
  pedido.simNao = (nome.value === 'escrita' ? c.escrita : c.ligada) ? 'nao' : 'sim';
  pedido.superficies = [...c.superficies];
  pedido.destino = c.destino ?? '';
}
watch([() => pedido.chave, painel], preencher, { immediate: true });

const valor = computed(() =>
  nome.value === 'superficies'
    ? pedido.superficies.join(',')
    : nome.value === 'destino'
      ? pedido.destino.trim()
      : pedido.simNao,
);
const avisoEscrita = computed(() => nome.value === 'escrita' && pedido.simNao === 'sim');
const mensagem = ref<string | null>(null);
const recusa = ref<string | null>(null);
const erro = ref<unknown>(null);
const gravando = ref(false);

async function gravar(): Promise<void> {
  mensagem.value = null;
  recusa.value = null;
  erro.value = null;
  gravando.value = true;
  try {
    const r = await configurarFachada({
      chave: pedido.chave,
      valor: valor.value,
      justificativa: pedido.justificativa,
      senha: pedido.senha,
    });
    mensagem.value = t('fachada.configurar.gravado', {
      rotulo: t(`fachada.configurar.parametros.${NOMES[r.chave]}`),
    });
    pedido.senha = '';
    pedido.justificativa = '';
    await consulta.refetch();
  } catch (e) {
    if (e instanceof ErroApi && e.problema?.detail && [400, 401, 403, 409, 422].includes(e.status))
      recusa.value = e.problema.detail;
    else erro.value = e;
  } finally {
    gravando.value = false;
  }
}
</script>

<template>
  <section class="tela-fachada" aria-labelledby="titulo-fachada" data-testid="tela-fachada">
    <h1 id="titulo-fachada">{{ t('fachada.titulo') }}</h1>
    <p>{{ t('fachada.texto') }}</p>
    <p v-if="consulta.isLoading.value" role="status">{{ t('fachada.carregando') }}</p>
    <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
    <template v-else-if="painel">
      <p class="discreto">
        {{ t('fachada.hospital', { hospital: painel.hospital }) }} ·
        {{ t('fachada.versaoContrato', { versao: painel.versaoContrato }) }} ·
        {{ t('fachada.medidoDesde', { quando: instante(painel.usoDesde) }) }}
      </p>

      <ul class="cartoes">
        <li class="cartao" data-testid="cartao-necessidade">
          <h2>{{ t('fachada.necessidade') }}</h2>
          <p>
            <strong :data-situacao="painel.necessidade.situacao">{{
              t(`fachada.necessidades.${painel.necessidade.situacao}`)
            }}</strong>
          </p>
          <p>{{ painel.necessidade.motivo }}</p>
        </li>
        <li class="cartao" data-testid="cartao-estado">
          <h2>{{ t('fachada.estado.titulo') }}</h2>
          <dl>
            <dt>{{ t('fachada.estado.fachada') }}</dt>
            <dd data-testid="estado-ligada">
              {{ painel.configuracao.ligada ? t('fachada.ligada') : t('fachada.desligada') }}
            </dd>
            <dt>{{ t('fachada.estado.escrita') }}</dt>
            <dd data-testid="estado-escrita">
              {{ painel.configuracao.escrita ? t('fachada.ligada') : t('fachada.desligada') }}
            </dd>
            <dt>{{ t('fachada.estado.destino') }}</dt>
            <dd data-testid="estado-destino">
              {{
                painel.destinoConfigurado
                  ? t('fachada.estado.destinoConfigurado')
                  : t('fachada.estado.destinoAusente')
              }}
            </dd>
          </dl>
        </li>
        <li class="cartao" data-testid="cartao-prontidao">
          <h2>{{ t('fachada.prontidao.titulo') }}</h2>
          <p>
            <strong>{{
              painel.prontidaoUtf8.pronta ? t('fachada.prontidao.pronta') : t('fachada.prontidao.naoPronta')
            }}</strong>
          </p>
          <p>{{ painel.prontidaoUtf8.motivo }}</p>
          <template v-if="painel.prontidaoUtf8.usadasNaoServidas.length">
            <p>{{ t('fachada.prontidao.usadas') }}</p>
            <ul data-testid="usadas-nao-servidas">
              <li v-for="u in painel.prontidaoUtf8.usadasNaoServidas" :key="u">
                <code>{{ u }}</code>
              </li>
            </ul>
          </template>
        </li>
        <li class="cartao" data-testid="cartao-motor">
          <h2>{{ t('fachada.motor.titulo') }}</h2>
          <p>{{ t('fachada.motor.texto', { minutos: painel.motor.validadeMinutos }) }}</p>
          <p>
            {{ t('fachada.motor.pendentes', { n: painel.motor.pendentes, max: painel.motor.maxPropostas }) }}
          </p>
        </li>
      </ul>

      <h2>{{ t('fachada.totais.titulo') }}</h2>
      <table data-testid="tabela-superficies">
        <caption>
          {{
            t('fachada.totais.titulo')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('fachada.superficie') }}</th>
            <th scope="col">{{ t('fachada.situacao') }}</th>
            <th scope="col">{{ t('fachada.escopo') }}</th>
            <th scope="col">{{ t('fachada.token') }}</th>
            <th scope="col">{{ t('fachada.totais.operacoes') }}</th>
            <th scope="col">{{ t('fachada.totais.servidas') }}</th>
            <th scope="col">{{ t('fachada.totais.repassadas') }}</th>
            <th scope="col">{{ t('fachada.totais.desligadas') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in painel.superficies" :key="s.superficie" :data-testid="`superficie-${s.superficie}`">
            <th scope="row">{{ t(`fachada.superficies.${s.superficie}`) }}</th>
            <td>{{ s.ligada ? t('fachada.ligada') : t('fachada.desligada') }}</td>
            <td>{{ t(`fachada.escopos.${s.escopo}`) }}</td>
            <td>{{ s.tokenConfigurado ? t('fachada.tokenSim') : t('fachada.tokenNao') }}</td>
            <td>{{ s.operacoes }}</td>
            <td>{{ s.servidas }}</td>
            <td>{{ s.repassadas }}</td>
            <td>{{ s.desligadas }}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr data-testid="superficies-total">
            <th scope="row" colspan="4">{{ t('fachada.totais.operacoes') }}</th>
            <td>{{ painel.totais.operacoes }}</td>
            <td>{{ painel.totais.servidas }}</td>
            <td>{{ painel.totais.repassadas }}</td>
            <td>{{ painel.totais.desligadas }}</td>
          </tr>
        </tfoot>
      </table>

      <h2>{{ t('fachada.filtros.titulo') }}</h2>
      <div class="filtros">
        <SanteSelecao
          id="fachada-filtro-superficie"
          v-model="filtro.superficie"
          :rotulo="t('fachada.filtros.superficie')"
          :opcoes="opcoesSuperficie"
          data-testid="filtro-superficie"
        />
        <SanteSelecao
          id="fachada-filtro-modo"
          v-model="filtro.modo"
          :rotulo="t('fachada.filtros.modo')"
          :opcoes="opcoesModo"
          data-testid="filtro-modo"
        />
        <SanteCampoTexto
          v-model="filtro.busca"
          :rotulo="t('fachada.filtros.busca')"
          :max-bytes="120"
          data-testid="filtro-busca"
        />
      </div>
      <p role="status" data-testid="filtro-contagem">
        {{ t('fachada.filtros.mostrando', { n: operacoes.length, total: painel.operacoes.length }) }}
      </p>
      <p v-if="operacoes.length === 0">{{ t('fachada.filtros.nenhuma') }}</p>
      <table v-else data-testid="tabela-operacoes-fachada">
        <caption>
          {{
            t('fachada.filtros.mostrando', { n: operacoes.length, total: painel.operacoes.length })
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('fachada.operacao.caminho') }}</th>
            <th scope="col">{{ t('fachada.superficie') }}</th>
            <th scope="col">{{ t('fachada.modo') }}</th>
            <th scope="col">{{ t('fachada.operacao.escreve') }}</th>
            <th scope="col">{{ t('fachada.operacao.equivalentes') }}</th>
            <th scope="col">{{ t('fachada.operacao.chamadas') }}</th>
            <th scope="col">{{ t('fachada.operacao.erros') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="o in operacoes" :key="o.id" :data-testid="`operacao-${o.id}`" :data-modo="o.modo">
            <th scope="row">
              <code>{{ o.metodo }} {{ o.caminho }}</code>
              <p v-if="o.motivo" class="motivo">{{ o.motivo }}</p>
            </th>
            <td>{{ t(`fachada.superficies.${o.superficie}`) }}</td>
            <td>
              <span class="modo" :data-variante="varianteModo(o.modo)">{{
                t(`fachada.modos.${o.modo}`)
              }}</span>
            </td>
            <td>{{ o.escreve ? t('fachada.sim') : t('fachada.nao') }}</td>
            <td>
              <span v-if="o.operacoesSgh.length === 0">{{ t('fachada.operacao.semEquivalente') }}</span>
              <ul v-else class="equivalentes">
                <li v-for="e in o.operacoesSgh" :key="e.nome">
                  {{
                    t('fachada.operacao.estadoEquivalente', {
                      nome: e.nome,
                      estado: e.estado ?? t('fachada.operacao.semEstado'),
                    })
                  }}
                </li>
              </ul>
            </td>
            <td>{{ o.chamadas }}</td>
            <td>{{ o.erros }}</td>
          </tr>
        </tbody>
      </table>

      <section class="form" aria-labelledby="fachada-configurar" data-testid="form-fachada">
        <h2 id="fachada-configurar">{{ t('fachada.configurar.titulo') }}</h2>
        <p>{{ t('fachada.configurar.texto') }}</p>
        <SanteAlerta
          v-if="!painel.pode.configurar"
          :texto="t('fachada.configurar.semPermissao')"
          variante="info"
          data-testid="fachada-sem-permissao"
        />
        <form v-else class="form" @submit.prevent="gravar">
          <div class="campo">
            <SanteSelecao
              id="fachada-parametro"
              v-model="pedido.chave"
              :rotulo="t('fachada.configurar.parametro')"
              :opcoes="opcoesParametro"
              data-testid="fachada-parametro"
            />
          </div>
          <fieldset v-if="nome === 'ligada' || nome === 'escrita'">
            <legend>{{ t('fachada.configurar.valorSimNao') }}</legend>
            <label
              ><input v-model="pedido.simNao" type="radio" value="sim" data-testid="fachada-sim" />
              {{ t('fachada.ligada') }}</label
            >
            <label
              ><input v-model="pedido.simNao" type="radio" value="nao" data-testid="fachada-nao" />
              {{ t('fachada.desligada') }}</label
            >
          </fieldset>
          <fieldset v-else-if="nome === 'superficies'">
            <legend>{{ t('fachada.configurar.valorSuperficies') }}</legend>
            <label v-for="s in SUPERFICIES_FACHADA" :key="s"
              ><input
                v-model="pedido.superficies"
                type="checkbox"
                :value="s"
                :data-testid="`fachada-superficie-${s}`"
              />
              {{ t(`fachada.superficies.${s}`) }}</label
            >
          </fieldset>
          <SanteCampoTexto
            v-else
            v-model="pedido.destino"
            :rotulo="t('fachada.configurar.valorDestino')"
            :max-bytes="400"
            data-testid="fachada-destino"
          />
          <SanteAlerta
            v-if="avisoEscrita"
            :texto="t('fachada.configurar.avisoEscrita')"
            variante="aviso"
            data-testid="fachada-aviso-escrita"
          />
          <SanteCampoTexto
            v-model="pedido.justificativa"
            :rotulo="t('fachada.configurar.justificativa')"
            :max-bytes="500"
            obrigatorio
            data-testid="fachada-justificativa"
          />
          <div class="campo">
            <label for="fachada-senha">{{ t('fachada.configurar.senha') }}</label>
            <input
              id="fachada-senha"
              v-model="pedido.senha"
              type="password"
              autocomplete="current-password"
              required
              data-testid="fachada-senha"
            />
          </div>
          <SanteAlerta v-if="recusa" :texto="recusa" variante="aviso" anunciar data-testid="recusa-fachada" />
          <SanteAlerta
            v-if="mensagem"
            :texto="mensagem"
            variante="info"
            anunciar
            data-testid="fachada-gravado"
          />
          <MensagemErro v-if="erro" :erro="erro" />
          <SanteBotao
            :rotulo="t('fachada.configurar.gravar')"
            variante="primario"
            tipo="submit"
            :desabilitado="gravando"
            data-testid="fachada-gravar"
          />
        </form>
      </section>
    </template>
  </section>
</template>

<style scoped>
.discreto {
  color: var(--sgh-texto-secundario);
}
.cartoes {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
  gap: var(--sgh-espaco-2);
  padding: 0;
  list-style: none;
}
.cartao {
  border: 1px solid var(--sgh-borda);
  background: var(--sgh-fundo-elevado);
  padding: var(--sgh-espaco-2);
}
.filtros {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
}
table {
  border-collapse: collapse;
  width: 100%;
}
th,
td {
  text-align: left;
  vertical-align: top;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
.motivo {
  margin: var(--sgh-espaco-1) 0 0;
  font-weight: normal;
}
.equivalentes {
  margin: 0;
  padding-left: var(--sgh-espaco-2);
}
.modo[data-variante='ok'] {
  font-weight: 600;
}
.modo[data-variante='falha'] {
  text-decoration: underline dotted;
}
.form,
.campo {
  display: grid;
  gap: var(--sgh-espaco-2);
  max-width: 40rem;
  margin: var(--sgh-espaco-2) 0;
}
input {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
</style>
